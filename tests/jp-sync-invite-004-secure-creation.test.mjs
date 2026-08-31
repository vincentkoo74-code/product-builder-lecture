// JP-SYNC-INVITE-004 — 방 생성 → 보안 토큰 → 검증된 영속 → 대기 상태
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const TOKEN_B = slice('    // ── CORE: 초대 토큰', '    // ── CORE: 초대 해석');
const ADAPTER_B = slice('    // ── JP 어댑터: 초대 진입', '    // 토큰 발급 재시도.');
const ISSUE_B = slice('    // 토큰 발급 재시도.', '    // 해석 의도를 실제 화면으로 렌더링한다');
const WAIT_B = slice('    // JP-SYNC-INVITE-004: 호스트 방 생명주기', '    function showHostRoom() {');
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

function makeDb({ rooms = [], failOn = null, failTimes = 0 } = {}) {
  const R = rooms.map((r) => ({ ...r }));
  let fails = 0;
  const build = (table, op, patch) => {
    const f = []; let selected = false;
    const b = {
      eq(c, v) { f.push([c, v]); return b; },
      select() { selected = true; return b; },
      single() { return exec(true); },
      order() { return exec(); },
      then(res, rej) { return exec().then(res, rej); },
    };
    async function exec(single = false) {
      if (failOn === table && fails < failTimes) { fails += 1; return { data: null, error: { code: '42703', message: 'column does not exist' } }; }
      const hit = R.filter((r) => f.every(([c, v]) => r[c] === v));
      if (op === 'select') return single ? (hit.length === 1 ? { data: { ...hit[0] }, error: null } : { data: null, error: { message: 'no rows' } })
                                         : { data: hit.map((r) => ({ ...r })), error: null };
      hit.forEach((r) => Object.assign(r, patch));
      return { data: selected ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    return b;
  };
  return { rooms: R, from: (t) => ({ select: () => build(t, 'select'), update: (p) => build(t, 'update', p) }) };
}

function loadIssue() {
  const g = { crypto: webcrypto };
  // eslint-disable-next-line no-new-func
  return new Function('globalThis', 'btoa', 'Uint8Array', 'db', 'state', 'getDefaultShareBaseUrl',
    `${TOKEN_B}${ADAPTER_B}${ISSUE_B}; return { generateInviteToken, isValidInviteTokenFormat,
      issueChallengeInviteToken, issueChallengeInviteTokenWithRetry, getSecureInviteRef, buildInviteUrl };`
  )(g, (x) => Buffer.from(x, 'binary').toString('base64'), Uint8Array, null,
    { inviteToken: null, roomCode: 'R1', shareBaseUrl: 'https://x.test/app' }, () => 'https://x.test/app');
}

function loadWaiting({ participants, role = 'host', status = 'waiting', inviteToken = null }) {
  const els = {}; const toasts = [];
  const $ = (id) => (els[id] ||= {
    textContent: '', _hidden: false, onclick: null,
    classList: { add(c) { if (c === 'hidden') els[id]._hidden = true; },
                 remove(c) { if (c === 'hidden') els[id]._hidden = false; },
                 contains: (c) => c === 'hidden' && els[id]._hidden },
  });
  const state = { participants, role, status, inviteToken, roomCode: 'R1', shareBaseUrl: 'https://x.test/app' };
  const g = { crypto: webcrypto };
  // eslint-disable-next-line no-new-func
  const m = new Function('globalThis', 'btoa', 'Uint8Array', '$', 't', 'state', 'showToast', 'navigator', 'getDefaultShareBaseUrl',
    `${TOKEN_B}${ISSUE_B}${WAIT_B}; return { renderHostWaitingState, copyInviteLink, getSecureInviteRef, buildInviteUrl };`
  )(g, (x) => Buffer.from(x, 'binary').toString('base64'), Uint8Array, $, (k) => `T(${k})`, state,
    (m2) => toasts.push(m2), { clipboard: { writeText: async () => {} } }, () => 'https://x.test/app');
  return { ...m, $, els, toasts, state };
}

const M = loadIssue();
const H = { id: 'H', is_host: true };
const G = { id: 'G', is_host: false };

describe('[004] §9-1~4 토큰 생성·영속·검증', () => {
  it('토큰이 생성·영속되고 방 id 가 검증된다', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: null }] });
    const r = await M.issueChallengeInviteTokenWithRetry('R1', 3, db);
    expect(r.ok).toBe(true);
    expect(M.isValidInviteTokenFormat(r.token)).toBe(true);
    expect(db.rooms[0].invite_token).toBe(r.token);
    expect(r.attempts).toBe(1);
  });
  it('토큰은 CSPRNG >=128비트 base64url 22자다', () => {
    expect(codeOnly(TOKEN_B)).toMatch(/getRandomValues/);
    expect(codeOnly(TOKEN_B)).not.toMatch(/Math\.random/);
    expect(M.generateInviteToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('[004] §9-5~7 실패는 성공으로 취급되지 않는다', () => {
  it('잘못된 방 id → 0행 → 거부', async () => {
    const db = makeDb({ rooms: [{ id: 'OTHER' }] });
    const r = await M.issueChallengeInviteTokenWithRetry('R1', 2, db);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('zero_row');
  });
  it('DB 오류(스키마 미배포 등) → 거부', async () => {
    const db = makeDb({ rooms: [{ id: 'R1' }], failOn: 'rooms', failTimes: 99 });
    const r = await M.issueChallengeInviteTokenWithRetry('R1', 3, db);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('schema_unavailable');
    expect(r.attempts).toBe(3);
  });
  it('일시적 오류는 같은 방에 재시도해 성공한다 (§9-9 중복 방 없음)', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', invite_token: null }], failOn: 'rooms', failTimes: 2 });
    const r = await M.issueChallengeInviteTokenWithRetry('R1', 3, db);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    // 방은 하나뿐이다 — 재시도가 방을 만들지 않는다.
    expect(db.rooms).toHaveLength(1);
    expect(db.rooms[0].id).toBe('R1');
  });
  it('재시도 로직이 방을 생성하거나 삭제하지 않는다', () => {
    const c = codeOnly(ISSUE_B);
    expect(c).not.toMatch(/\.insert\(/);
    expect(c).not.toMatch(/\.delete\(/);
  });
});

describe('[004] §9-8 약한 방 코드로 downgrade 하지 않는다', () => {
  it('토큰이 없으면 초대 참조가 null 이다', () => {
    const w = loadWaiting({ participants: [H], inviteToken: null });
    expect(w.getSecureInviteRef()).toBeNull();
    expect(w.buildInviteUrl()).toBeNull();
  });
  it('형식이 깨진 토큰도 거부한다', () => {
    const w = loadWaiting({ participants: [H], inviteToken: 'ABCD' });
    expect(w.getSecureInviteRef()).toBeNull();
  });
  it('초대 URL 에 방 코드가 자격증명으로 들어가지 않는다', () => {
    const tok = M.generateInviteToken();
    const w = loadWaiting({ participants: [H], inviteToken: tok });
    const url = w.buildInviteUrl();
    expect(url).toContain(`invite=${tok}`);
    expect(url).not.toMatch(/room=|code=R1/);
  });
});

describe('[004] §9-10,11 대기 상태 렌더', () => {
  it('host 혼자면 대기 박스가 보인다', () => {
    const w = loadWaiting({ participants: [H], inviteToken: M.generateInviteToken() });
    w.renderHostWaitingState();
    expect(w.$('hostWaitingBox').classList.contains('hidden')).toBe(false);
    expect(w.$('hostWaitingTitle').textContent).toBe('T(invite.waiting.title)');
  });
  it('친구가 합류하면 대기 박스가 사라진다 (전이 관측 가능)', () => {
    const w = loadWaiting({ participants: [H, G], inviteToken: M.generateInviteToken() });
    w.renderHostWaitingState();
    expect(w.$('hostWaitingBox').classList.contains('hidden')).toBe(true);
  });
  it('토큰이 검증된 뒤에만 초대 액션이 노출된다', () => {
    const ok = loadWaiting({ participants: [H], inviteToken: M.generateInviteToken() });
    ok.renderHostWaitingState();
    expect(ok.$('inviteCopyBtn').classList.contains('hidden')).toBe(false);
    expect(ok.$('inviteUnavailableNote').classList.contains('hidden')).toBe(true);

    const no = loadWaiting({ participants: [H], inviteToken: null });
    no.renderHostWaitingState();
    expect(no.$('inviteCopyBtn').classList.contains('hidden')).toBe(true);
    expect(no.$('inviteUnavailableNote').classList.contains('hidden')).toBe(false);
  });
  it('진행 중 상태에서는 대기 박스를 띄우지 않는다', () => {
    const w = loadWaiting({ participants: [H], status: 'playing', inviteToken: M.generateInviteToken() });
    w.renderHostWaitingState();
    expect(w.$('hostWaitingBox').classList.contains('hidden')).toBe(true);
  });
  it('비호스트에게는 띄우지 않는다', () => {
    const w = loadWaiting({ participants: [H], role: 'participant', inviteToken: M.generateInviteToken() });
    w.renderHostWaitingState();
    expect(w.$('hostWaitingBox').classList.contains('hidden')).toBe(true);
  });
  it('토큰 없이 복사를 시도하면 실패를 알린다', async () => {
    const w = loadWaiting({ participants: [H], inviteToken: null });
    expect(await w.copyInviteLink()).toBe(false);
    expect(w.toasts).toContain('T(invite.action.unavailable)');
  });
});

describe('[004] 배선/경계', () => {
  it('createRoom 이 host 참가자 insert 이후에 토큰을 발급한다', () => {
    const cr = slice('async function createRoom()', 'function createParticipant(');
    expect(cr.indexOf('saveLastJoinedRoomCode(code, nickname, hostId')).toBeLessThan(cr.indexOf('issueChallengeInviteTokenWithRetry'));
    expect(cr).toMatch(/state\.inviteAvailable\s*=\s*false/);
    expect(cr).toMatch(/INVITE_TOKEN_UNAVAILABLE/);
  });
  it('토큰 실패 시 방을 삭제하지 않는다 (파괴적 회수 금지)', () => {
    const cr = slice('async function createRoom()', 'function createParticipant(');
    const after = cr.slice(cr.indexOf('issueChallengeInviteTokenWithRetry'));
    expect(after).not.toMatch(/from\('rooms'\)\.delete/);
  });
  it('대기/초대 계층에 LINE SDK 참조가 없다', () => {
    const c = codeOnly(WAIT_B);
    expect(c).not.toMatch(/liff|shareTargetPicker/i);
    expect(c).not.toMatch(/\bLINE\b/);
  });
  it('일본어 대기 문구가 지정 개념과 일치하고 온라인을 단정하지 않는다', () => {
    expect(html).toContain('"invite.waiting.title": "友だちの参加を待っています"');
    expect(html).not.toMatch(/友だちがオンライン|相手がオンライン/);
  });
  it('초대 액션 i18n 키가 3개 로케일에 정의돼 있다', () => {
    for (const k of ['invite.action.copy', 'invite.action.copied', 'invite.action.unavailable']) {
      const def = new RegExp(`"${k.replace(/\./g, '\\.')}"\\s*:\\s*"`, 'g');
      expect((html.match(def) || []).length, k).toBe(3);
    }
  });
});
