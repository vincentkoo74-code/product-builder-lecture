// JP-E2E-JWT-FIDELITY — 실제 JWT 검증 + 목표 보안(GRANT/RLS) 하의 권한 충실도
//
// 이 스위트는 **로컬 전용**이다. Tokyo 프로덕션에 아무것도 하지 않는다.
// 로컬 스택에는 Tokyo 배포 예정인 보안 5종이 **이미 적용돼 있다**(로컬에서만).
// 권한을 우회하지 않는다 — 토큰은 롤을 주장하고, 강제는 PostgREST + PostgreSQL 이 한다.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { anonToken, authedToken, expiredToken, wrongSignatureToken,
         noRoleClaimToken, forgedRoleToken, bearer, claimShape } from './jwt-harness.mjs';

const S = '/private/tmp/claude-501/-Users-vk/068eb9e5-39ce-42b9-adf4-8b07a5ef8b3e/scratchpad';
const REST = `http://127.0.0.1:${fs.readFileSync(`${S}/sec-restport`, 'utf8').trim()}`;

let ANON, USER_A, USER_B, uidA, uidB;
const report = { claimShapes: {}, matrix: {}, negative: {} };

test.beforeAll(async () => {
  ANON = await anonToken();
  uidA = randomUUID(); uidB = randomUUID();
  USER_A = await authedToken(uidA);
  USER_B = await authedToken(uidB);
  report.claimShapes = {
    anon: claimShape('anon'),
    authenticated: claimShape('authenticated', { sub: '<uuid>' }),
  };
  // auth.users 는 **플랫폼 테이블**이다(가입이 만드는 행). 테스트 소유자 2명을 심는 것은
  // 환경 구성이지 RLS 우회가 아니다 — 권한 검증은 전부 PostgREST + 토큰 경로로만 한다.
  execFileSync('psql', [`postgres://postgres@127.0.0.1:55601/jp_sec`, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into auth.users (id, email) values
       ('${uidA}','zz_${uidA.slice(0, 8)}@local.test'),
       ('${uidB}','zz_${uidB.slice(0, 8)}@local.test')
     on conflict (id) do nothing;`],
    { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } });
});

const req = (path, { token, method = 'GET', body = null, prefer = null } = {}) => {
  const headers = { 'content-type': 'application/json', ...(token ? bearer(token) : {}) };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${REST}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
};
const mkRoom = () => ({ id: Math.random().toString(36).slice(2, 6).toUpperCase(), status: 'waiting', round: 1 });

// ───────────────────────────────────────────── §10 JWT 검증 (부정 경로 우선)

test.describe('[JWT] §10 토큰 검증', () => {
  test('1) 잘못된 서명 → 거부', async () => {
    const r = await req('rooms?select=id&limit=1', { token: await wrongSignatureToken() });
    report.negative.wrongSignature = r.status;
    expect(r.status, '다른 키로 서명한 토큰이 통과하면 안 된다').toBe(401);
  });

  test('2) 만료된 토큰 → 거부', async () => {
    const r = await req('rooms?select=id&limit=1', { token: await expiredToken() });
    report.negative.expired = r.status;
    expect(r.status).toBe(401);
  });

  test('3) role 클레임 없음 → 설정대로 매핑된다 (권한 상승 없음)', async () => {
    const t = await noRoleClaimToken();
    const rooms = await req('rooms?select=id&limit=1', { token: t });
    const stats = await req('user_game_stats?select=user_id&limit=1', { token: t });
    report.negative.noRoleClaim = { rooms: rooms.status, user_game_stats: stats.status };
    // PostgREST 는 role 클레임이 없으면 db-anon-role 로 떨어진다 — **상승이 아니라 하강**이어야 한다.
    expect(rooms.status, 'anon 수준 접근').toBe(200);
    expect(stats.status, 'role 없는 토큰이 authenticated 권한을 얻으면 안 된다').not.toBe(200);
  });

  test('4) 유효 서명이라도 위조 롤은 DB 권한을 넘지 못한다', async () => {
    // 로컬 비밀로 service_role 을 주장해도, 그 롤에 없는 권한은 여전히 막힌다.
    const t = await forgedRoleToken('service_role');
    const r = await req('user_game_stats?select=user_id&limit=1', { token: t });
    report.negative.forgedServiceRole = r.status;
    expect(r.status, 'service_role 은 stats 권한이 revoke 돼 있다').not.toBe(200);
  });

  test('5) 토큰 없음 → db-anon-role 로 동작한다', async () => {
    expect((await req('rooms?select=id&limit=1')).status).toBe(200);
    expect((await req('user_game_stats?select=user_id&limit=1')).status).not.toBe(200);
  });
});

// ───────────────────────────────────────────── §6 게스트/anon 권한 매트릭스

test.describe('[JWT] §6 게스트(anon) 권한 매트릭스', () => {
  test('rooms: SELECT/INSERT/UPDATE 허용, DELETE 거부', async () => {
    const room = mkRoom();
    const ins = await req('rooms', { token: ANON, method: 'POST', body: room, prefer: 'return=representation' });
    const sel = await req(`rooms?id=eq.${room.id}&select=id`, { token: ANON });
    const upd = await req(`rooms?id=eq.${room.id}`, { token: ANON, method: 'PATCH',
      body: { status: 'ready' }, prefer: 'return=representation' });
    const del = await req(`rooms?id=eq.${room.id}`, { token: ANON, method: 'DELETE' });
    report.matrix.anon_rooms = { insert: ins.status, select: sel.status, update: upd.status, delete: del.status };
    expect(ins.status, 'INSERT').toBe(201);
    expect(sel.status, 'SELECT').toBe(200);
    expect(upd.status, 'UPDATE').toBe(200);
    expect(del.status, 'DELETE 는 GRANT 에서 제거돼 있어야 한다').not.toBeLessThan(400);
    // 실제로 남아 있는지 권위 확인 — 상태 코드만 믿지 않는다.
    expect((await (await req(`rooms?id=eq.${room.id}&select=id`, { token: ANON })).json())).toHaveLength(1);
  });

  test('participants: SELECT/INSERT/UPDATE/DELETE 모두 허용 (게임플레이 필요)', async () => {
    const room = mkRoom();
    await req('rooms', { token: ANON, method: 'POST', body: room });
    const pid = `p_${Date.now()}`;
    const ins = await req('participants', { token: ANON, method: 'POST',
      body: { id: pid, room_id: room.id, name: 'zz_jwt', is_host: false }, prefer: 'return=representation' });
    const sel = await req(`participants?id=eq.${pid}&select=id`, { token: ANON });
    const upd = await req(`participants?id=eq.${pid}`, { token: ANON, method: 'PATCH',
      body: { is_ready: true }, prefer: 'return=representation' });
    const del = await req(`participants?id=eq.${pid}`, { token: ANON, method: 'DELETE',
      prefer: 'return=representation' });
    report.matrix.anon_participants = { insert: ins.status, select: sel.status, update: upd.status, delete: del.status };
    expect([ins.status, sel.status, upd.status, del.status]).toEqual([201, 200, 200, 200]);
    expect(await (await req(`participants?id=eq.${pid}&select=id`, { token: ANON })).json()).toHaveLength(0);
  });

  test('통계/이력 테이블은 게스트에게 완전히 닫혀 있다', async () => {
    const out = {};
    for (const t of ['user_game_stats', 'user_game_history']) {
      out[`${t}_select`] = (await req(`${t}?select=user_id&limit=1`, { token: ANON })).status;
      out[`${t}_insert`] = (await req(t, { token: ANON, method: 'POST', body: { user_id: uidA } })).status;
    }
    report.matrix.anon_stats = out;
    for (const [k, v] of Object.entries(out)) expect(v, k).not.toBeLessThan(400);
  });
});

// ───────────────────────────────────────────── §7~9 authenticated / 소유자 RLS

test.describe('[JWT] §7~9 authenticated 권한 · 소유자 RLS · 교차 사용자 차단', () => {
  test.beforeAll(async () => {
    // 소유자 행을 각 사용자 **자신의 토큰으로** 만든다 — RLS 를 우회해 심지 않는다.
    for (const [uid, tok] of [[uidA, USER_A], [uidB, USER_B]]) {
      const a = await req('user_game_stats', { token: tok, method: 'POST',
        body: { user_id: uid, display_name: `zz_${uid.slice(0, 4)}`, games_played: 1 } });
      const b = await req('user_game_history', { token: tok, method: 'POST',
        body: { user_id: uid, room_id: 'ZZZZ', round: 1, result: 'draw' } });
      // 조용히 실패하면 뒤 테스트가 통째로 공허해진다 — 여기서 세운다.
      expect(a.status, `stats 시드(${uid}): ${await a.clone().text()}`).toBe(201);
      expect(b.status, `history 시드(${uid}): ${await b.clone().text()}`).toBe(201);
    }
  });

  test('소유자는 자기 stats 를 읽고/쓰고/고칠 수 있다', async () => {
    const sel = await req(`user_game_stats?user_id=eq.${uidA}&select=user_id,games_played`, { token: USER_A });
    const rows = await sel.json();
    const upd = await req(`user_game_stats?user_id=eq.${uidA}`, { token: USER_A, method: 'PATCH',
      body: { games_played: 7 }, prefer: 'return=representation' });
    report.matrix.owner_stats = { select: sel.status, rows: rows.length, update: upd.status };
    expect(sel.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(upd.status).toBe(200);
    expect((await upd.json())[0].games_played).toBe(7);
  });

  test('소유자는 자기 history 를 읽고 넣을 수 있다', async () => {
    const sel = await req(`user_game_history?user_id=eq.${uidA}&select=id`, { token: USER_A });
    const rows = await sel.json();
    report.matrix.owner_history = { select: sel.status, rows: rows.length };
    expect(sel.status).toBe(200);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test('다른 사용자의 stats/history 는 보이지 않는다 (0행 — 유출 없음)', async () => {
    const s = await req(`user_game_stats?user_id=eq.${uidB}&select=user_id`, { token: USER_A });
    const h = await req(`user_game_history?user_id=eq.${uidB}&select=id`, { token: USER_A });
    const sAll = await req('user_game_stats?select=user_id', { token: USER_A });
    report.matrix.cross_user = { stats: (await s.json()).length, history: (await h.json()).length,
                                 allVisible: (await sAll.clone().json()).length };
    expect(await (await req(`user_game_stats?user_id=eq.${uidB}&select=user_id`, { token: USER_A })).json()).toHaveLength(0);
    expect(await (await req(`user_game_history?user_id=eq.${uidB}&select=id`, { token: USER_A })).json()).toHaveLength(0);
    // 전체 조회를 해도 자기 행만 보여야 한다.
    const all = await (await req('user_game_stats?select=user_id', { token: USER_A })).json();
    expect(all.every((r) => r.user_id === uidA), '타인 행이 섞여 나오면 안 된다').toBe(true);
  });

  test('다른 사용자의 stats 를 고칠 수 없다 (0행 영향)', async () => {
    const r = await req(`user_game_stats?user_id=eq.${uidB}`, { token: USER_A, method: 'PATCH',
      body: { games_played: 999 }, prefer: 'return=representation' });
    const affected = r.status === 200 ? (await r.json()).length : -1;
    report.matrix.cross_user_update = { status: r.status, affected };
    expect(affected, '타인 행이 수정되면 안 된다').toBe(0);
    const b = await (await req(`user_game_stats?user_id=eq.${uidB}&select=games_played`, { token: USER_B })).json();
    expect(b[0].games_played, '피해자 행이 그대로여야 한다').toBe(1);
  });

  test('다른 사용자 이름으로 행을 심을 수 없다 (WITH CHECK)', async () => {
    const r = await req('user_game_stats', { token: USER_A, method: 'POST',
      body: { user_id: uidB, display_name: 'zz_forged' } });
    report.matrix.cross_user_insert = r.status;
    expect(r.status).not.toBeLessThan(400);
  });

  test('authenticated 도 게임플레이 권한은 게스트와 동일하다', async () => {
    const room = mkRoom();
    expect((await req('rooms', { token: USER_A, method: 'POST', body: room })).status).toBe(201);
    expect((await req(`rooms?id=eq.${room.id}`, { token: USER_A, method: 'DELETE' })).status).not.toBeLessThan(400);
  });
});

// ───────────────────────────────────────────── §11 created_at 불변 / §12 invite token

test.describe('[JWT] §11 created_at 불변 · §12 invite token', () => {
  test('created_at 은 클라이언트 값을 무시하고 서버 시각으로 고정된다', async () => {
    const room = { ...mkRoom(), created_at: '1999-01-01T00:00:00Z' };
    const ins = await req('rooms', { token: ANON, method: 'POST', body: room, prefer: 'return=representation' });
    const created = (await ins.json())[0].created_at;
    report.matrix.created_at_insert = { sent: room.created_at, stored: created };
    expect(new Date(created).getUTCFullYear(), '클라이언트가 보낸 과거 시각이 저장되면 안 된다')
      .toBeGreaterThan(2020);

    const upd = await req(`rooms?id=eq.${room.id}`, { token: ANON, method: 'PATCH',
      body: { created_at: '1999-01-01T00:00:00Z', status: 'ready' }, prefer: 'return=representation' });
    const after = (await upd.json())[0];
    report.matrix.created_at_update = { stored: after.created_at, statusApplied: after.status };
    expect(after.created_at, 'UPDATE 로 created_at 을 바꿀 수 없어야 한다').toBe(created);
    expect(after.status, '같은 UPDATE 의 정당한 필드는 반영돼야 한다').toBe('ready');
  });

  test('created_at 은 테이블 소유자 UPDATE 로도 바뀌지 않는다 (트리거 수준 강제)', async () => {
    const room = mkRoom();
    await req('rooms', { token: ANON, method: 'POST', body: room });
    const before = (await (await req(`rooms?id=eq.${room.id}&select=created_at`, { token: ANON })).json())[0].created_at;
    execFileSync('psql', [`postgres://postgres@127.0.0.1:55601/jp_sec`, '-q', '-c',
      `update public.rooms set created_at = now() - interval '99 hours' where id = '${room.id}';`],
      { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } });
    const after = (await (await req(`rooms?id=eq.${room.id}&select=created_at`, { token: ANON })).json())[0].created_at;
    report.matrix.created_at_owner_update = { before, after, unchanged: before === after };
    expect(after, '소유자 권한으로도 created_at 이 바뀌면 안 된다').toBe(before);
  });

  test('invite_token 이 유지되고 토큰으로 방을 찾을 수 있다', async () => {
    const room = mkRoom();
    const tok = Buffer.from(randomUUID().replace(/-/g, ''), 'hex').toString('base64url').slice(0, 22);
    await req('rooms', { token: ANON, method: 'POST', body: { ...room, invite_token: tok } });
    const found = await (await req(`rooms?invite_token=eq.${tok}&select=id,invite_token`, { token: ANON })).json();
    report.matrix.invite_token = { found: found.length, match: found[0]?.id === room.id };
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(room.id);
  });

  test('invite_token 중복은 부분 유니크 인덱스가 막는다', async () => {
    const tok = Buffer.from(randomUUID().replace(/-/g, ''), 'hex').toString('base64url').slice(0, 22);
    const a = await req('rooms', { token: ANON, method: 'POST', body: { ...mkRoom(), invite_token: tok } });
    const b = await req('rooms', { token: ANON, method: 'POST', body: { ...mkRoom(), invite_token: tok } });
    report.matrix.invite_token_unique = { first: a.status, duplicate: b.status };
    expect(a.status).toBe(201);
    expect(b.status, '중복 토큰이 통과하면 안 된다').not.toBeLessThan(400);
  });

  test('invite_token 은 여러 방이 null 이어도 충돌하지 않는다 (부분 인덱스)', async () => {
    const a = await req('rooms', { token: ANON, method: 'POST', body: mkRoom() });
    const b = await req('rooms', { token: ANON, method: 'POST', body: mkRoom() });
    expect([a.status, b.status]).toEqual([201, 201]);
  });
});

// ───────────────────────────────────────────── §16 보안 계약 경계: 24시간 창
//
// 목표 RLS 는 rooms/participants 의 UPDATE/DELETE 를 "최근 24시간에 만들어진 행"으로 제한한다.
// 파티 게임의 방은 단명하므로 정상 경로에는 영향이 없지만, **경계 밖에서 무슨 일이 벌어지는지**
// 를 명시적으로 확정해 둔다 — 나중에 "왜 갑자기 안 되지"가 되지 않도록.
test.describe('[JWT] §16 목표 RLS 24시간 창 경계', () => {
  // 시간 경과 시뮬레이션. created_at 은 트리거가 **소유자에게도** 고정하므로(§11 참고),
  // 로컬에서 트리거를 잠시 끄는 것 말고는 과거 시각을 만들 방법이 없다.
  // 이것은 "시간이 흘렀다"를 재현하는 환경 조작이지 권한 우회가 아니다 — 로컬 전용.
  const ageRoom = (id, interval) => execFileSync('psql',
    [`postgres://postgres@127.0.0.1:55601/jp_sec`, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
     `alter table public.rooms disable trigger jp_rooms_pin_created_at;
      alter table public.participants disable trigger jp_participants_pin_created_at;
      update public.rooms set created_at = now() - interval '${interval}' where id = '${id}';
      update public.participants set created_at = now() - interval '${interval}' where room_id = '${id}';
      alter table public.rooms enable trigger jp_rooms_pin_created_at;
      alter table public.participants enable trigger jp_participants_pin_created_at;`],
    { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } });

  test('창 안(23시간)의 방은 정상적으로 갱신·삭제된다', async () => {
    const room = mkRoom();
    await req('rooms', { token: ANON, method: 'POST', body: room });
    const pid = `p_win_${Date.now()}`;
    await req('participants', { token: ANON, method: 'POST',
      body: { id: pid, room_id: room.id, name: 'zz_win', is_host: false } });
    ageRoom(room.id, '23 hours');
    const upd = await req(`rooms?id=eq.${room.id}`, { token: ANON, method: 'PATCH',
      body: { status: 'ready' }, prefer: 'return=representation' });
    const del = await req(`participants?id=eq.${pid}`, { token: ANON, method: 'DELETE',
      prefer: 'return=representation' });
    report.matrix.window_inside = { update: (await upd.json()).length, delete: (await del.json()).length };
    expect((await (await req(`rooms?id=eq.${room.id}&select=status`, { token: ANON })).json())[0].status).toBe('ready');
  });

  test('창 밖(25시간)의 방은 갱신·삭제가 0행이 된다 — 조용히 얼어붙는다', async () => {
    const room = mkRoom();
    await req('rooms', { token: ANON, method: 'POST', body: room });
    const pid = `p_out_${Date.now()}`;
    await req('participants', { token: ANON, method: 'POST',
      body: { id: pid, room_id: room.id, name: 'zz_out', is_host: false } });
    ageRoom(room.id, '25 hours');
    const upd = await req(`rooms?id=eq.${room.id}`, { token: ANON, method: 'PATCH',
      body: { status: 'ready' }, prefer: 'return=representation' });
    const del = await req(`participants?id=eq.${pid}`, { token: ANON, method: 'DELETE',
      prefer: 'return=representation' });
    const updRows = upd.status === 200 ? (await upd.json()).length : -1;
    const delRows = del.status === 200 ? (await del.json()).length : -1;
    report.matrix.window_outside = { updateStatus: upd.status, updateRows: updRows,
                                     deleteStatus: del.status, deleteRows: delRows };
    // 이것이 목표 보안의 **의도된 계약**이다: 오래된 방은 더 이상 변경되지 않는다.
    expect(updRows, '24시간 지난 방은 갱신되지 않는다').toBe(0);
    expect(delRows, '24시간 지난 방의 참가자는 삭제되지 않는다').toBe(0);
    // 그리고 앱은 이 0행을 **조용히 넘기지 않는다** — JP-BL-027 계열 카디널리티 검증이 잡는다.
    // (참고: 새 방 생성/합류는 여전히 정상이므로 사용자는 새 도전으로 진행할 수 있다.)
    const fresh = mkRoom();
    expect((await req('rooms', { token: ANON, method: 'POST', body: fresh })).status).toBe(201);
  });
});

// ───────────────────────────────────────────── §17 Realtime 스키마 호환성
test.describe('[JWT] §17 목표 보안 적용 후 Realtime 호환성', () => {
  const q = (sql) => execFileSync('psql',
    [`postgres://postgres@127.0.0.1:55601/jp_sec`, '-At', '-c', sql],
    { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } })
    .toString().trim();

  test('publication 에 rooms/participants 가 insert·update·delete 로 등록돼 있다', () => {
    const tables = q(`select string_agg(schemaname||'.'||tablename, ',' order by tablename)
                      from pg_publication_tables where pubname='supabase_realtime';`);
    const ops = q(`select concat_ws(',', case when pubinsert then 'insert' end,
                     case when pubupdate then 'update' end, case when pubdelete then 'delete' end)
                   from pg_publication where pubname='supabase_realtime';`);
    report.matrix.realtime = { tables, ops };
    expect(tables).toBe('public.participants,public.rooms');
    expect(ops).toBe('insert,update,delete');
  });

  test('REPLICA IDENTITY 가 FULL 이다 — 필터된 DELETE 이벤트 유실 방지', () => {
    // DEFAULT 이면 DELETE 의 old tuple 에 기본키만 실려 `room_id=eq.X` 필터가 평가되지 않는다.
    // 라이브 Tokyo 는 FULL 이다 — 저장소만으로 세운 백엔드도 같아야 한다.
    const ri = q(`select string_agg(relname||':'||relreplident::text, ' ' order by relname)
                  from pg_class where relname in ('rooms','participants')
                  and relnamespace='public'::regnamespace;`);
    report.matrix.replicaIdentity = ri;
    expect(ri, 'Tokyo 실측(FULL)과 달라지면 Realtime 동작이 갈린다').toBe('participants:f rooms:f');
  });
});

// ───────────────────────────────────────────── §9 브라우저 배선 비공허성
//
// 브라우저 게이트가 **실제로** JWT 검증에 걸려 있는지 확인한다.
// 이 테스트가 없으면 "치환이 동작한다"는 주장이 공허해질 수 있다 —
// 예컨대 토큰이 무시되고 있어도 게이트는 초록으로 남을 것이다.
test.describe('[JWT] §9 브라우저 게이트가 진짜로 JWT 에 걸려 있는가 (비공허성)', () => {
  test('잘못 서명된 토큰이면 서버가 401 을 주고 방이 영속되지 않는다', async () => {
    const { chromium } = await import('@playwright/test');
    const { startStaticServer, routeSupabase, resetDb } = await import('./harness.mjs');
    resetDb();
    const srv = await startStaticServer();
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const ctx = await browser.newContext();
      await routeSupabase(ctx, REST, await wrongSignatureToken());
      const page = await ctx.newPage();
      const codes = [];
      page.on('response', (r) => { if (r.url().includes('supabase.co/rest/v1')) codes.push(r.status()); });
      await page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.playAsGuest()).catch(() => {});
      await page.waitForTimeout(400);
      await page.evaluate(() => { const e = document.getElementById('homeNickname'); if (e) e.value = 'zz_badjwt'; });
      await page.evaluate(() => window.createRoom()).catch(() => {});
      await page.waitForTimeout(4000);

      const rooms = await (await req('rooms?select=id', { token: ANON })).json();
      const parts = await (await req('participants?select=id', { token: ANON })).json();
      report.negative.browserWrongSignature = {
        restStatuses: [...new Set(codes)], roomsPersisted: rooms.length, participantsPersisted: parts.length,
      };
      // 서버가 실제로 거부했는가 — 이것이 배선의 비공허성이다.
      expect(codes.length, 'REST 호출이 아예 없었다면 측정이 공허하다').toBeGreaterThan(0);
      expect([...new Set(codes)], '모든 응답이 401 이어야 한다').toEqual([401]);
      // 그리고 아무것도 영속되지 않았다. (앱은 이때 오프라인 모드로 떨어진다 — 의도된 제품 동작.)
      expect(rooms, '거부된 토큰으로 방이 만들어지면 안 된다').toHaveLength(0);
      expect(parts, '거부된 토큰으로 참가자가 만들어지면 안 된다').toHaveLength(0);
      await ctx.close();
    } finally { await browser.close(); srv.server.close(); }
  });
});

test.afterAll(async () => {
  fs.writeFileSync(`${S}/jwt-fidelity-report.json`, JSON.stringify(report, null, 2));
});
