import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.MARU_LOCAL_SUPABASE_URL;
const anonKey = process.env.MARU_LOCAL_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error('local Supabase URL/anon key are required');

const prefix = `R2EXIT_${Date.now().toString(36).toUpperCase()}`;
const room = (suffix) => `${prefix}_${suffix}`;
const client = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(label) {
  const db = client();
  const { data, error } = await db.auth.signInAnonymously();
  assert.equal(error, null, `${label} anonymous sign-in`);
  assert.match(data?.user?.id || '', /^[0-9a-f-]{36}$/i, `${label} auth uid`);
  return { db, user: data.user, session: data.session };
}

async function insertRoom(db, id) {
  const { error } = await db.from('rooms').insert({ id, status: 'waiting', penalty: '' });
  assert.equal(error, null, `create ${id}`);
}

async function insertParticipant(db, { id, room_id, name, is_host = false }) {
  return db.from('participants').insert({ id, room_id, name, is_host });
}

async function hasExited(db, roomId) {
  const { data, error } = await db.rpc('current_user_has_exited_room', { p_room_id: roomId });
  assert.equal(error, null, `exit lookup ${roomId}`);
  return data;
}

const A = await signIn('A');
const B = await signIn('B');
const unauthed = client();

const roomA = room('A');
await insertRoom(A.db, roomA);
let result = await insertParticipant(A.db, { id: `${roomA}_HOST`, room_id: roomA, name: 'R2EXIT_A', is_host: true });
assert.equal(result.error, null, 'EXIT-DB-01 A active membership');
const active = await A.db.from('participants').select('id,room_id,is_host,owner_user_id').eq('room_id', roomA).maybeSingle();
assert.equal(active.error, null, 'read active membership');
assert.equal(active.data?.owner_user_id, A.user.id, 'owner binding is auth.uid');
assert.equal(await hasExited(A.db, roomA), false, 'EXIT-DB-02 disconnect leaves membership active');
assert.equal(active.data?.id, `${roomA}_HOST`, 'EXIT-DB-03 active reconnect resolves same participant');

const firstExit = await A.db.rpc('exit_room_permanently', { p_room_id: roomA, p_exit_reason: 'explicit_leave' });
assert.equal(firstExit.error, null, 'EXIT-DB-04 explicit terminal exit');
assert.equal(firstExit.data?.[0]?.owner_user_id, A.user.id, 'terminal record owner');
assert.equal(firstExit.data?.[0]?.exit_reason, 'explicit_leave', 'terminal record reason');
const firstExitedAt = firstExit.data?.[0]?.exited_at;
const removed = await A.db.from('participants').select('id').eq('room_id', roomA).eq('owner_user_id', A.user.id);
assert.equal(removed.error, null, 'EXIT-DB-05 membership read after exit');
assert.equal(removed.data?.length, 0, 'EXIT-DB-05 active membership removed');
assert.equal(await hasExited(A.db, roomA), true, 'EXIT-DB-08 restart recovery sees terminal state');

result = await insertParticipant(A.db, { id: `${roomA}_REINSERT`, room_id: roomA, name: 'R2EXIT_A' });
assert.notEqual(result.error, null, 'EXIT-DB-06 direct same-room insert denied');
result = await insertParticipant(A.db, { id: `${roomA}_OLDID`, room_id: roomA, name: 'R2EXIT_A' });
assert.notEqual(result.error, null, 'EXIT-DB-12 old participant id cannot bypass lockout');

result = await insertParticipant(B.db, { id: `${roomA}_B`, room_id: roomA, name: 'R2EXIT_B' });
assert.equal(result.error, null, 'EXIT-DB-09 B may join because B never exited');

const secondExit = await A.db.rpc('exit_room_permanently', { p_room_id: roomA, p_exit_reason: 'explicit_leave' });
assert.equal(secondExit.error, null, 'EXIT-DB-13 repeat exit is idempotent');
assert.equal(secondExit.data?.[0]?.exited_at, firstExitedAt, 'repeat exit preserves original evidence');

const roomB = room('B');
await insertRoom(A.db, roomB);
result = await insertParticipant(A.db, { id: `${roomB}_HOST`, room_id: roomB, name: 'R2EXIT_A', is_host: true });
assert.equal(result.error, null, 'EXIT-DB-10 A may create a different room');

const roomC = room('C');
await insertRoom(B.db, roomC);
result = await insertParticipant(B.db, { id: `${roomC}_HOST`, room_id: roomC, name: 'R2EXIT_B', is_host: true });
assert.equal(result.error, null, 'Room C host');
result = await insertParticipant(A.db, { id: `${roomC}_A`, room_id: roomC, name: 'R2EXIT_A' });
assert.equal(result.error, null, 'EXIT-DB-11 A may join another eligible room');

const roomD = room('D');
await insertRoom(A.db, roomD);
result = await insertParticipant(A.db, { id: `${roomD}_HOST`, room_id: roomD, name: 'R2EXIT_A', is_host: true });
assert.equal(result.error, null, 'Room D A host');
result = await insertParticipant(B.db, { id: `${roomD}_B`, room_id: roomD, name: 'R2EXIT_B' });
assert.equal(result.error, null, 'Room D B participant');
const crossExit = await B.db.rpc('exit_room_permanently', {
  p_room_id: roomD,
  p_exit_reason: 'system_ejection',
  p_owner_user_id: A.user.id,
});
assert.notEqual(crossExit.error, null, 'EXIT-DB-15 B cannot exit A membership');
const stillActive = await A.db.from('participants').select('id').eq('room_id', roomD).eq('owner_user_id', A.user.id).maybeSingle();
assert.equal(stillActive.data?.id, `${roomD}_HOST`, 'A membership remains after B denial');

const forgedExit = await unauthed.rpc('exit_room_permanently', { p_room_id: roomD, p_exit_reason: 'explicit_leave' });
assert.notEqual(forgedExit.error, null, 'EXIT-DB-14 unauthenticated caller cannot forge exit');

const roomFuture = room('FUTURE');
await insertRoom(A.db, roomFuture);
result = await insertParticipant(A.db, { id: `${roomFuture}_HOST`, room_id: roomFuture, name: 'R2EXIT_A', is_host: true });
assert.equal(result.error, null, 'future exit fixture');
const futureExit = await A.db.rpc('exit_room_permanently', { p_room_id: roomFuture, p_exit_reason: 'post_match_timeout' });
assert.equal(futureExit.error, null, 'future auto-eject reason uses canonical primitive');
assert.equal(futureExit.data?.[0]?.exit_reason, 'post_match_timeout', 'future reason is preserved');

console.log(JSON.stringify({
  status: 'PASS',
  prefix,
  rooms: [roomA, roomB, roomC, roomD, roomFuture],
  checks: 15,
}));
