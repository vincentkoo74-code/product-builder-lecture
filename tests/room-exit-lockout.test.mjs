import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const migration = readFileSync(
  new URL('supabase/migrations/20260905100000_room_membership_terminal_exit.sql', root),
  'utf8'
);

function functionBody(name) {
  const asyncMarker = `\n    async function ${name}(`;
  const syncMarker = `\n    function ${name}(`;
  const start = html.indexOf(asyncMarker) >= 0
    ? html.indexOf(asyncMarker)
    : html.indexOf(syncMarker);
  if (start < 0) throw new Error(`missing ${name}`);
  const next = html.indexOf('\n    function ', start + asyncMarker.length);
  const nextAsync = html.indexOf('\n    async function ', start + asyncMarker.length);
  const end = [next, nextAsync].filter(i => i > start).sort((a, b) => a - b)[0];
  return html.slice(start, end < 0 ? html.length : end);
}

describe('KR terminal room exit / re-entry lockout contract', () => {
  it('creates a durable auth-owner exit ledger independent of participant ids', () => {
    expect(migration).toContain('create table if not exists public.room_membership_exits');
    expect(migration).toContain('primary key (room_id, owner_user_id)');
    expect(migration).toContain('owner_user_id uuid not null references auth.users(id) on delete cascade');
    expect(migration).not.toMatch(/primary key \(.*participant_id/i);
  });

  it('keeps the exit record after participant deletion and serializes exit/rejoin races', () => {
    expect(migration).toContain('no foreign key to public.rooms');
    expect(migration).toContain('delete from public.participants p');
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
  });

  it('blocks direct PostgREST participant INSERT with restrictive RLS and trigger enforcement', () => {
    expect(migration).toContain('on public.participants as restrictive');
    expect(migration).toContain('participants_not_terminally_exited_insert');
    expect(migration).toContain('create trigger participants_terminal_room_reentry_guard');
    expect(migration).toContain("raise exception 'terminal room exit prevents re-entry'");
  });

  it('exposes only a fixed-path, non-public canonical exit RPC', () => {
    expect(migration).toContain('create or replace function public.exit_room_permanently(');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = pg_catalog, public');
    expect(migration).toContain('revoke all on function public.exit_room_permanently(text, text, uuid) from public');
    expect(migration).toContain("p_exit_reason not in ('explicit_leave', 'system_ejection', 'post_match_timeout')");
  });

  it('requires auth.uid and rejects a non-host trying to exit another member', () => {
    expect(migration).toContain("raise exception 'authenticated identity required'");
    expect(migration).toContain('target <> caller');
    expect(migration).toContain("raise exception 'only the room host may exit another membership'");
  });

  it('is idempotent and preserves the first terminal-exit record', () => {
    expect(migration).toContain('on conflict on constraint room_membership_exits_pkey do nothing');
    expect(migration).toContain('return query');
  });

  it('routes explicit leave through the canonical RPC rather than a participant-id delete', () => {
    const leave = functionBody('_doLeaveRoom');
    expect(leave).toContain("db.rpc('exit_room_permanently'");
    expect(leave).toContain("p_exit_reason: 'explicit_leave'");
    expect(leave).not.toContain(".delete().eq('id', state.currentUserId)");
  });

  it('routes deferred system cleanup through the same terminal primitive', () => {
    const deferred = functionBody('processDeferredLeaves');
    expect(deferred).toContain("db.rpc('exit_room_permanently'");
    expect(deferred).toContain('p_owner_user_id: member.owner_user_id');
  });

  it('clears room-scoped state after an explicit exit instead of retaining a reclaim hint', () => {
    const leave = functionBody('_doLeaveRoom');
    expect(leave).toContain('clearRoomScopedCache(exitRoomCode)');
  });

  it('requires a server terminal-exit check for manual room-code entry', () => {
    const join = functionBody('joinRoom');
    expect(join).toContain('await ensureRoomReentryAllowed(code)');
    expect(join).toContain('이미 종료한 게임방입니다. 새로운 방에서 게임을 시작해주세요.');
  });

  it('uses the same entry check for replay/QR/deep-link routes that converge on join', () => {
    const replay = functionBody('requestReplayFromJoinedRoom');
    expect(replay).toContain('await ensureRoomReentryAllowed(code)');
    expect(html).toContain('await joinRoom();');
    expect(html).toContain('await joinFromQrCode(');
  });

  it('does not reclaim an exited room after a cold launch even with a persisted room code', () => {
    const recovery = functionBody('restoreOwnedRoomOnStartup');
    expect(recovery).toContain('await currentUserHasTerminalRoomExit(roomCode)');
    expect(recovery).toContain('eligibleMemberships');
  });

  it('retains active reconnect behavior when no terminal record exists', () => {
    const recovery = functionBody('restoreOwnedRoomOnStartup');
    expect(recovery).toContain('owner_user_id", ownerUserId');
    expect(recovery).toContain('applyOwnedRoomRecovery');
  });

  it('does not make history a membership source', () => {
    const history = functionBody('showAccountStatsPopup');
    expect(history).toContain('.from("user_game_history")');
    expect(history).not.toContain('joinRoom(');
    expect(migration).toContain('does not erase game/account history');
  });
});
