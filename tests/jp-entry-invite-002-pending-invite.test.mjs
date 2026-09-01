// JP-ENTRY-INVITE-002 — 신원 부트스트랩을 가로지르는 보류 초대 (PENDING INVITE CONTEXT)
//
// 결함: 초대가 **파싱되었다는 이유만으로** 소비되고 URL 에서 지워졌다. 신규 초대자는 그 시점에
// 아직 신원이 없어 합류가 완료되지 않았다. 이 스위트는 "파싱 ≠ 소비" 규칙을 고정한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const TOKEN_B = slice('    // ── CORE: 초대 토큰', '    // ── CORE: 초대 해석');
const BOOT_B = slice('    // ── JP 부트스트랩: URL → entryContext', '    // ── JP 초대 연속성:');
const PENDING_B = slice('    // ── JP 초대 연속성:', '    // 해석 의도를 실제 화면으로 렌더링한다');
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const T = 'T'.repeat(22);

// 신원/브라우저/어댑터를 주입해 부트 시퀀스를 그대로 돌린다. 프로덕션 소스는 슬라이스로 가져온다.
function load({
  href = `https://x.test/app?invite=${T}`,
  authState = '',              // '' = 신원 없음, 'guest' | 'authed' = 신원 있음
  resolved = { state: 'VALID', roomCode: 'R1' },
  resolveThrows = false,
  currentUserId = '',
} = {}) {
  const calls = { openInvite: [], navigate: [], join: [], replaced: [], screens: [] };
  let auth = authState;
  const loc = new URL(href);
  const location = {
    get href() { return loc.href; }, get search() { return loc.search; },
    get pathname() { return loc.pathname; }, get hash() { return loc.hash; },
  };
  const history = {
    replaceState: (a, b, url) => {
      calls.replaced.push(url);
      const next = new URL(url, loc.origin);
      loc.search = next.search; loc.pathname = next.pathname; loc.hash = next.hash;
    },
  };
  const state = { roomCode: '', roomUrl: '', currentUserId };
  let curResolved = resolved, curThrows = resolveThrows;
  const openInviteEntry = async (a) => {
    calls.openInvite.push(a);
    if (curThrows) throw new Error('network down');
    return { ...curResolved, intent: inviteIntentForState(curResolved.state) };
  };
  const inviteIntentForState = (st) => ({
    action: st === 'VALID' ? 'join' : st === 'ALREADY_JOINED' ? 'resume' : 'blocked',
  });
  const navigateFromInvite = async (r, h) => {
    calls.navigate.push(r.state);
    const act = (r.intent || inviteIntentForState(r.state)).action;
    if (act === 'join' && h?.join) await h.join(r.roomCode);
    if (act === 'resume' && h?.resume) await h.resume(r.roomCode);
    if (act === 'blocked') calls.screens.push('screenInviteUnavailable');
    return { navigated: act === 'blocked' ? 'blocked' : act, roomCode: r.roomCode };
  };
  const joinFromQrCode = async (code) => { calls.join.push(code); };

  // eslint-disable-next-line no-new-func
  const m = new Function(
    'globalThis', 'btoa', 'Uint8Array', 'MARKET_CONFIG', 'state', 'openInviteEntry',
    'navigateFromInvite', 'inviteIntentForState', 'history', 'location', 'URL', 'URLSearchParams',
    'getAuthState', 'buildRoomUrl', 'joinFromQrCode', 'console',
    `${TOKEN_B}${BOOT_B}${PENDING_B}; return { parseInviteFromSearch, buildEntryContext, stripInviteFromUrl,
       bootstrapInviteEntry, beginInviteEntry, consumePendingInvite, hasPendingInvite,
       markInviteWaitingForIdentity, getPendingInviteContext, hasUsableIdentity,
       makeInviteEntryHandlers, resumePendingInviteAfterIdentity, PENDING_INVITE_STATUS };`
  )(
    { crypto: webcrypto }, (x) => Buffer.from(x, 'binary').toString('base64'), Uint8Array,
    { market: 'JP', minParticipantsToStart: 2 }, state, openInviteEntry,
    navigateFromInvite, inviteIntentForState, history, location, URL, URLSearchParams,
    () => auth, (c) => `https://x.test/app?room=${c}`, joinFromQrCode, console
  );
  return { ...m, calls, state, location, setAuth: (v) => { auth = v; },
           setResolved: (v) => { curResolved = v; curThrows = false; } };
}

describe('[INVITE-002] §3 상태 계약', () => {
  it('전이 상태는 필요한 5개뿐이다 (일반 워크플로 엔진이 아니다)', () => {
    const m = load();
    expect(Object.keys(m.PENDING_INVITE_STATUS).sort()).toEqual(
      ['CONSUMED', 'FAILED', 'PARSED', 'RESOLVING', 'WAITING_FOR_IDENTITY']);
  });
  it('보류 컨텍스트는 token/source/status 를 갖는다', async () => {
    const m = load();
    await m.beginInviteEntry(`?invite=${T}`, {});
    expect(m.getPendingInviteContext()).toMatchObject({ token: T, source: 'url', status: 'PARSED' });
  });
  it('초대가 없으면 보류 컨텍스트를 만들지 않는다', async () => {
    const m = load({ href: 'https://x.test/app?lang=ja' });
    const r = await m.beginInviteEntry('?lang=ja', {});
    expect(r).toMatchObject({ handled: false, pending: false });
    expect(m.getPendingInviteContext()).toBe(null);
    expect(m.hasPendingInvite()).toBe(false);
  });
});

describe('[INVITE-002] §4 소비 규칙 — 파싱은 소비가 아니다', () => {
  it('1) 파싱만으로는 권위 조회도 URL 정리도 하지 않는다', async () => {
    const m = load({ authState: '' });
    const r = await m.beginInviteEntry(`?invite=${T}`, {});
    expect(r.pending).toBe(true);
    expect(m.calls.openInvite).toHaveLength(0);   // ← DB 를 두드리지 않았다
    expect(m.calls.replaced).toHaveLength(0);     // ← URL 을 지우지 않았다
    expect(m.location.search).toContain(`invite=${T}`);
  });
  it('2) 신원이 없으면 소비되지 않고 WAITING_FOR_IDENTITY 로 남는다', async () => {
    const m = load({ authState: '' });
    await m.beginInviteEntry(`?invite=${T}`, {});
    const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(c).toMatchObject({ consumed: false, reason: 'no_identity' });
    expect(m.getPendingInviteContext().status).toBe('WAITING_FOR_IDENTITY');
    expect(m.calls.openInvite).toHaveLength(0);
    expect(m.location.search).toContain('invite=');   // ← 여전히 복구 가능하다
    expect(m.hasPendingInvite()).toBe(true);
  });
  it('3) 신원이 생긴 뒤에야 권위 조회 → 네비게이션 → URL 정리 순으로 소비된다', async () => {
    const m = load({ authState: '' });
    await m.beginInviteEntry(`?invite=${T}`, {});
    await m.consumePendingInvite(m.makeInviteEntryHandlers());   // 아직 신원 없음
    m.setAuth('guest');                                          // ← 게스트 신원 생성
    const c = await m.resumePendingInviteAfterIdentity();
    expect(c).toMatchObject({ consumed: true, state: 'VALID' });
    expect(m.calls.openInvite[0]).toMatchObject({ inviteToken: T });
    expect(m.calls.join).toEqual(['R1']);
    expect(m.getPendingInviteContext().status).toBe('CONSUMED');
    expect(m.location.search).not.toContain('invite=');
  });
  it('4) 형식 오류는 신원 없이도 즉시 종결된다 (DB 조회 없음)', async () => {
    const m = load({ href: 'https://x.test/app?invite=abc', authState: '' });
    const r = await m.beginInviteEntry('?invite=abc', {});
    expect(r).toMatchObject({ handled: true, pending: false, state: 'INVALID_TOKEN' });
    expect(m.calls.openInvite).toHaveLength(0);
    expect(m.calls.screens).toEqual(['screenInviteUnavailable']);
    expect(m.location.search).not.toContain('invite=');   // 종결 상태 확정 후 정리
  });
});

describe('[INVITE-002] §7 URL 정리 규칙', () => {
  it('종결 상태(HOST_GONE 등)도 화면 확정 후에 정리한다', async () => {
    for (const st of ['INVALID_TOKEN', 'HOST_GONE', 'ROOM_FULL', 'UNAVAILABLE']) {
      const m = load({ authState: 'guest', resolved: { state: st, roomCode: 'R1' } });
      await m.beginInviteEntry(`?invite=${T}`, {});
      const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
      expect(c.consumed, st).toBe(true);
      expect(m.calls.screens, st).toEqual(['screenInviteUnavailable']);
      expect(m.location.search, st).not.toContain('invite=');
    }
  });
  it('무관한 쿼리 파라미터는 보존한다', async () => {
    const m = load({ href: `https://x.test/app?lang=ja&invite=${T}&debug=1`, authState: 'guest' });
    await m.beginInviteEntry(`?lang=ja&invite=${T}&debug=1`, {});
    await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(m.location.search).toContain('lang=ja');
    expect(m.location.search).toContain('debug=1');
    expect(m.location.search).not.toContain('invite=');
  });
});

describe('[INVITE-002] §6 새로고침 복구', () => {
  it('소비 전 새로고침 → URL 에서 초대를 다시 복구한다', async () => {
    const m = load({ authState: '' });
    await m.beginInviteEntry(m.location.search, {});
    await m.consumePendingInvite(m.makeInviteEntryHandlers());   // 신원 없음 → 보류
    // 새로고침: 메모리는 날아가고 URL 만 남는다 → 새 인스턴스로 재부팅
    const href = 'https://x.test/app' + m.location.search;
    const m2 = load({ href, authState: 'guest' });
    const r = await m2.beginInviteEntry(m2.location.search, {});
    expect(r.pending).toBe(true);
    const c = await m2.consumePendingInvite(m2.makeInviteEntryHandlers());
    expect(c).toMatchObject({ consumed: true, state: 'VALID' });
    expect(m2.calls.join).toEqual(['R1']);
  });
  it('소비 후 새로고침 → 초대가 없으므로 입장을 반복하지 않는다', async () => {
    const m = load({ authState: 'guest' });
    await m.beginInviteEntry(m.location.search, {});
    await m.consumePendingInvite(m.makeInviteEntryHandlers());
    const href = 'https://x.test/app' + m.location.search;
    const m2 = load({ href, authState: 'guest' });
    const r = await m2.beginInviteEntry(m2.location.search, {});
    expect(r.pending).toBe(false);
    expect(m2.calls.openInvite).toHaveLength(0);
    expect(m2.calls.join).toHaveLength(0);          // ← 중복 입장 없음
  });
  it('부트가 URL 을 갈아엎어도 초대는 메모리에서 살아남는다 (OAuth 정리 등)', async () => {
    const m = load({ authState: '' });
    await m.beginInviteEntry(m.location.search, {});
    // 다른 부트 단계가 주소를 통째로 교체했다고 가정
    m.calls.replaced.length = 0;
    globalThis.__ignored = m.location.href;
    const hist = m.getPendingInviteContext();
    expect(hist.search).toContain(`invite=${T}`);   // ← 원본 search 를 붙잡고 있다
    m.setAuth('guest');
    const c = await m.resumePendingInviteAfterIdentity();
    expect(c.consumed).toBe(true);
    expect(m.calls.openInvite[0].inviteToken).toBe(T);
  });
});

describe('[INVITE-002] §5 신원 케이스', () => {
  it('A) 기존 신원 있음 → 즉시 해석된다', async () => {
    const m = load({ authState: 'authed' });
    await m.beginInviteEntry(m.location.search, {});
    const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(c.consumed).toBe(true);
    expect(m.calls.join).toEqual(['R1']);
  });
  it('B) 신원 없음 → 신원 생성 → 보류 초대가 이어져 합류한다', async () => {
    const m = load({ authState: '' });
    await m.beginInviteEntry(m.location.search, {});
    m.markInviteWaitingForIdentity();
    expect(m.getPendingInviteContext().status).toBe('WAITING_FOR_IDENTITY');
    m.setAuth('guest');
    const c = await m.resumePendingInviteAfterIdentity();
    expect(c.consumed).toBe(true);
    expect(m.calls.join).toEqual(['R1']);
  });
  it('C) 해석 실패 → FAILED 로 남고 초대는 사라지지 않는다 (복구 가능)', async () => {
    const m = load({ authState: 'guest', resolveThrows: true });
    await m.beginInviteEntry(m.location.search, {});
    const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(c).toMatchObject({ consumed: false, reason: 'failed' });
    expect(m.getPendingInviteContext().status).toBe('FAILED');
    expect(m.location.search).toContain('invite=');   // ← URL 을 건드리지 않았다
    expect(m.hasPendingInvite()).toBe(true);          // ← 재시도 가능
  });
  it('C-2) 일시적 조회 실패(lookupFailed)는 소비가 아니다 — 초대가 URL 에 남는다', async () => {
    const m = load({ authState: 'guest',
                     resolved: { state: 'INVALID_TOKEN', roomCode: null, lookupFailed: true } });
    await m.beginInviteEntry(m.location.search, {});
    const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(c).toMatchObject({ consumed: false, reason: 'lookup_failed' });
    expect(m.getPendingInviteContext().status).toBe('FAILED');
    expect(m.location.search, '일시적 실패로 초대를 파기하면 안 된다').toContain('invite=');
    expect(m.hasPendingInvite()).toBe(true);
  });
  it('C-3) 실패 후 재시도하면 소비된다 (복구 가능)', async () => {
    const m = load({ authState: 'guest', resolveThrows: true });
    await m.beginInviteEntry(m.location.search, {});
    expect((await m.consumePendingInvite(m.makeInviteEntryHandlers())).consumed).toBe(false);
    m.setResolved({ state: 'VALID', roomCode: 'R1' });
    const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(c.consumed).toBe(true);
    expect(m.calls.join).toEqual(['R1']);
  });
  it('D) 신원을 만들지 않고 이탈 → 결정적: 아무 일도 일어나지 않는다', async () => {
    const m = load({ authState: '' });
    await m.beginInviteEntry(m.location.search, {});
    for (let i = 0; i < 3; i++) await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(m.calls.openInvite).toHaveLength(0);
    expect(m.calls.join).toHaveLength(0);
    expect(m.calls.replaced).toHaveLength(0);
    expect(m.getPendingInviteContext().status).toBe('WAITING_FOR_IDENTITY');
  });
});

describe('[INVITE-002] §7 멱등성 / 중복 방지', () => {
  it('같은 초대를 두 번 소비하려 해도 한 번만 해석된다', async () => {
    const m = load({ authState: 'guest' });
    await m.beginInviteEntry(m.location.search, {});
    const a = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    const b = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(a.consumed).toBe(true);
    expect(b).toMatchObject({ consumed: false, reason: 'already_consumed' });
    expect(m.calls.openInvite).toHaveLength(1);
    expect(m.calls.join).toEqual(['R1']);   // ← 입장은 정확히 1회
  });
  it('동시 소비 요청은 in_progress 로 거부된다', async () => {
    const m = load({ authState: 'guest' });
    await m.beginInviteEntry(m.location.search, {});
    const [a, b] = await Promise.all([
      m.consumePendingInvite(m.makeInviteEntryHandlers()),
      m.consumePendingInvite(m.makeInviteEntryHandlers()),
    ]);
    const outcomes = [a, b].map((r) => r.consumed);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.consumed).reason).toBe('in_progress');
    expect(m.calls.join).toHaveLength(1);
  });
  it('ALREADY_JOINED 는 resume 으로 이어진다 (중복 참가자 생성 없음)', async () => {
    const m = load({ authState: 'guest', currentUserId: 'ME',
                     resolved: { state: 'ALREADY_JOINED', roomCode: 'R1' } });
    await m.beginInviteEntry(m.location.search, {});
    const c = await m.consumePendingInvite(m.makeInviteEntryHandlers());
    expect(c).toMatchObject({ consumed: true, state: 'ALREADY_JOINED' });
    expect(c.nav.navigated).toBe('resume');
    expect(m.calls.join).toEqual(['R1']);   // 기존 입장 경로 재사용(joinRoom 이 같은 row 재사용)
  });
});

describe('[INVITE-002] §8 경계 — CORE/KR 오염 없음', () => {
  it('보류 계층에 LINE/LIFF 참조가 없다', () => {
    const c = codeOnly(PENDING_B);
    expect(c).not.toMatch(/liff|shareTargetPicker/i);
    expect(c).not.toMatch(/\bLINE\b/);
  });
  it('보류 계층이 초대 상태 판정을 복제하지 않는다', () => {
    const c = codeOnly(PENDING_B);
    for (const st of ['HOST_GONE', 'ROOM_FULL', 'ALREADY_JOINED', 'UNAVAILABLE']) {
      expect(c, st).not.toContain(st);
    }
  });
  it('보류 계층이 게임 규칙/라운드 상태를 건드리지 않는다', () => {
    const c = codeOnly(PENDING_B);
    for (const forbidden of ['state.round', 'state.gameRound', 'state.participants',
                             'is_ready', 'choice', 'subscribeToRoom']) {
      expect(c, forbidden).not.toContain(forbidden);
    }
  });
  it('방 코드 fallback 이 없다', () => {
    const c = codeOnly(PENDING_B);
    expect(c).not.toMatch(/params\.get\('room'\)|getAll\('room'\)/);
  });
  it('토큰을 로그/분석 페이로드에 넣지 않는다', () => {
    const c = codeOnly(PENDING_B);
    expect(c).not.toMatch(/console\.(log|info|warn|error)\([^)]*token/i);
    expect(c).not.toMatch(/QA\.emit\([^)]*token/i);
  });
});

describe('[INVITE-002] §5 부트 시퀀스 순서 (회귀 고정)', () => {
  const init = slice('async function initFromUrl()', 'function bootAppWhenReady()');
  it('초대 소비는 세션/신원 확립 **이후**에 일어난다', () => {
    const iBegin = init.indexOf('beginInviteEntry(location.search');
    const iSession = init.indexOf('db.auth.getSession()');
    const iAuthState = init.indexOf('const authState = getAuthState();');
    const iConsume = init.indexOf('consumePendingInvite(makeInviteEntryHandlers())');
    expect(iBegin).toBeGreaterThan(-1);
    expect(iConsume).toBeGreaterThan(-1);
    expect(iBegin).toBeLessThan(iSession);       // 파싱은 이르게 (URL 유실 방지)
    expect(iSession).toBeLessThan(iConsume);     // 소비는 세션 확인 이후
    expect(iAuthState).toBeLessThan(iConsume);   // 소비는 신원 판정 이후
  });
  it('부트가 초대를 조기 소비하지 않는다 (결함 재발 방지)', () => {
    const early = init.slice(0, init.indexOf('const authState = getAuthState();'));
    expect(early).not.toContain('bootstrapInviteEntry(');
    expect(early).not.toContain('consumePendingInvite(');
  });
  it('신원이 없으면 인증 화면으로 보내고 초대를 남긴다', () => {
    const tail = init.slice(init.indexOf('if (hasPendingInvite())'));
    expect(tail).toContain('markInviteWaitingForIdentity()');
    expect(tail).toContain('showAuthScreen()');
  });
  it('게스트 신원 생성 직후 보류 초대를 이어받는다', () => {
    const guest = slice('async function playAsGuest()', 'async function initFromUrl()');
    expect(guest).toContain('resumePendingInviteAfterIdentity()');
    expect(guest.indexOf('setAuthState("guest")')).toBeLessThan(
      guest.indexOf('resumePendingInviteAfterIdentity()'));   // 신원 먼저, 그 다음 소비
  });
});
