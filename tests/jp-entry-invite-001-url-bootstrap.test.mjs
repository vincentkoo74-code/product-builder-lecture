// JP-ENTRY-INVITE-001 — URL 부트스트랩 → 기존 초대 어댑터
//
// 부트스트랩은 **파싱·정규화만** 한다. 도전 유효성 판단은 어댑터가 갖는다(로직 복제 금지).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const TOKEN_B = slice('    // ── CORE: 초대 토큰', '    // ── CORE: 초대 해석');
const BOOT_B = slice('    // ── JP 부트스트랩: URL → entryContext', '    // ── JP 초대 연속성:');
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

function load({ resolved = { state: 'VALID', roomCode: 'R1' }, href = 'https://x.test/app?invite=' + 'T'.repeat(22), currentUserId = 'ME' } = {}) {
  const calls = { openInvite: [], navigate: [], replaced: [] };
  const g = { crypto: webcrypto };
  const loc = new URL(href);
  const history = { replaceState: (a, b, url) => calls.replaced.push(url) };
  const location = { get href() { return loc.href; }, get search() { return loc.search; },
                     get pathname() { return loc.pathname; }, get hash() { return loc.hash; } };
  const openInviteEntry = async (a) => { calls.openInvite.push(a); return { ...resolved, intent: { action: resolved.state === 'VALID' ? 'join' : resolved.state === 'ALREADY_JOINED' ? 'resume' : 'blocked' } }; };
  const navigateFromInvite = async (r, h) => { calls.navigate.push(r.state); 
    if (r.intent?.action === 'join' && h?.join) await h.join(r.roomCode);
    if (r.intent?.action === 'resume' && h?.resume) await h.resume(r.roomCode);
    return { navigated: r.intent?.action === 'join' ? 'join' : r.intent?.action === 'resume' ? 'resume' : 'blocked' }; };
  const inviteIntentForState = (st) => ({ action: st === 'VALID' ? 'join' : st === 'ALREADY_JOINED' ? 'resume' : 'blocked' });
  // eslint-disable-next-line no-new-func
  const m = new Function('globalThis', 'btoa', 'Uint8Array', 'MARKET_CONFIG', 'state',
    'openInviteEntry', 'navigateFromInvite', 'inviteIntentForState', 'history', 'location', 'URL', 'URLSearchParams',
    `${TOKEN_B}${BOOT_B}; return { parseInviteFromSearch, buildEntryContext, stripInviteFromUrl, bootstrapInviteEntry };`
  )(g, (x) => Buffer.from(x, 'binary').toString('base64'), Uint8Array,
    { market: 'JP', minParticipantsToStart: 2 }, { currentUserId },
    openInviteEntry, navigateFromInvite, inviteIntentForState, history, location, URL, URLSearchParams);
  return { ...m, calls };
}

const T = 'T'.repeat(22);
const M = load();

describe('[ENTRY] §6-1,3,4,11,12 파서', () => {
  it('1) invite 파라미터 없음 → 일반 진입', () => {
    expect(M.parseInviteFromSearch('')).toEqual({ inviteToken: null, reason: 'absent' });
    expect(M.parseInviteFromSearch('?lang=ja&room=ABCD').reason).toBe('absent');
  });
  it('2) 유효 토큰은 그대로 통과한다', () => {
    expect(M.parseInviteFromSearch(`?invite=${T}`)).toEqual({ inviteToken: T, reason: 'ok' });
  });
  it('3) 형식 오류는 DB 조회 없이 거부', () => {
    for (const bad of ['abc', 'A'.repeat(21), 'A'.repeat(23), 'AAAA', '', '%%%']) {
      expect(M.parseInviteFromSearch(`?invite=${bad}`).reason).toBe('malformed');
    }
  });
  it('11) 깨진 쿼리스트링에도 크래시하지 않는다', () => {
    for (const q of ['?%', '?invite=%E0%A4%A', '?a=1&&&b', '?invite']) {
      expect(() => M.parseInviteFromSearch(q)).not.toThrow();
    }
  });
  it('12) invite 가 여러 개면 조용히 추측하지 않고 거부한다', () => {
    const r = M.parseInviteFromSearch(`?invite=${T}&invite=${'Z'.repeat(22)}`);
    expect(r).toEqual({ inviteToken: null, reason: 'ambiguous' });
  });
  it('10) 무관한 파라미터는 파싱에 영향을 주지 않는다', () => {
    expect(M.parseInviteFromSearch(`?lang=ja&invite=${T}&debug=1`).inviteToken).toBe(T);
  });
});

describe('[ENTRY] entryContext 정규화', () => {
  it('market 과 초대 여부를 정규화해 담는다', () => {
    const c = M.buildEntryContext(`?invite=${T}`);
    expect(c).toEqual({ market: 'JP', inviteToken: T, inviteParse: 'ok', hasInvite: true });
  });
  it('초대가 없으면 hasInvite=false', () => {
    expect(M.buildEntryContext('?lang=ja').hasInvite).toBe(false);
  });
});

describe('[ENTRY] §4 부트스트랩이 어댑터에 위임한다 (로직 복제 없음)', () => {
  it('1) 초대 없으면 아무것도 처리하지 않는다', async () => {
    const m = load({ href: 'https://x.test/app?lang=ja' });
    const r = await m.bootstrapInviteEntry('?lang=ja');
    expect(r.handled).toBe(false);
    expect(m.calls.openInvite).toHaveLength(0);
    expect(m.calls.navigate).toHaveLength(0);
  });
  it('2) 유효 토큰 → 어댑터 조회 → join', async () => {
    const m = load();
    const r = await m.bootstrapInviteEntry(`?invite=${T}`);
    expect(m.calls.openInvite[0]).toMatchObject({ inviteToken: T, selfId: 'ME' });
    expect(r.state).toBe('VALID');
    expect(r.nav.navigated).toBe('join');
  });
  it('3) 형식 오류는 DB 조회 없이 INVALID_TOKEN 화면', async () => {
    const m = load({ href: 'https://x.test/app?invite=abc' });
    const r = await m.bootstrapInviteEntry('?invite=abc');
    expect(m.calls.openInvite).toHaveLength(0);   // ← DB 를 두드리지 않았다
    expect(r.state).toBe('INVALID_TOKEN');
  });
  it('12) 중복 invite 도 조회 없이 거부', async () => {
    const m = load();
    const r = await m.bootstrapInviteEntry(`?invite=${T}&invite=${T}`);
    expect(m.calls.openInvite).toHaveLength(0);
    expect(r.state).toBe('INVALID_TOKEN');
  });

  const states = [
    ['4) 알 수 없는 토큰', 'INVALID_TOKEN', 'blocked'],
    ['5) HOST_GONE', 'HOST_GONE', 'blocked'],
    ['6) ROOM_FULL', 'ROOM_FULL', 'blocked'],
    ['7) ALREADY_JOINED', 'ALREADY_JOINED', 'resume'],
    ['8) UNAVAILABLE', 'UNAVAILABLE', 'blocked'],
  ];
  for (const [label, state, nav] of states) {
    it(`${label} → ${nav}`, async () => {
      const m = load({ resolved: { state, roomCode: 'R1' } });
      const r = await m.bootstrapInviteEntry(`?invite=${T}`);
      expect(r.state).toBe(state);
      expect(r.nav.navigated).toBe(nav);
    });
  }
});

describe('[ENTRY] §5 토큰 취급 / URL 정리', () => {
  it('소비 후 URL 에서 invite 를 제거한다', async () => {
    const m = load();
    await m.bootstrapInviteEntry(`?invite=${T}`);
    expect(m.calls.replaced).toHaveLength(1);
    expect(m.calls.replaced[0]).not.toContain('invite=');
  });
  it('다른 쿼리 파라미터는 보존한다', () => {
    const m = load({ href: `https://x.test/app?lang=ja&invite=${T}&debug=1` });
    m.stripInviteFromUrl();
    const u = m.calls.replaced[0];
    expect(u).toContain('lang=ja');
    expect(u).toContain('debug=1');
    expect(u).not.toContain('invite=');
  });
  it('invite 가 없으면 URL 을 건드리지 않는다', () => {
    const m = load({ href: 'https://x.test/app?lang=ja' });
    expect(m.stripInviteFromUrl()).toBe(false);
    expect(m.calls.replaced).toHaveLength(0);
  });
  it('9) 반복 새로고침은 결정적이다 — 두 번째부터는 초대가 없어 일반 진입', async () => {
    const m = load();
    const first = await m.bootstrapInviteEntry(`?invite=${T}`);
    expect(first.handled).toBe(true);
    const second = await m.bootstrapInviteEntry('');   // URL 정리 후의 상태
    expect(second.handled).toBe(false);
  });
  it('토큰을 로그/분석 페이로드에 넣지 않는다', () => {
    const c = codeOnly(BOOT_B);
    expect(c).not.toMatch(/console\.(log|info|warn|error)\([^)]*inviteToken/);
    expect(c).not.toMatch(/QA\.emit\([^)]*inviteToken/);
  });
});

describe('[ENTRY] §7 경계 — LINE 로직 없음 / 상태 로직 미복제', () => {
  it('부트스트랩에 LINE/LIFF 참조가 없다', () => {
    const c = codeOnly(BOOT_B);
    expect(c).not.toMatch(/liff|shareTargetPicker/i);
    expect(c).not.toMatch(/\bLINE\b/);
  });
  it('부트스트랩이 초대 상태 판정을 복제하지 않는다', () => {
    const c = codeOnly(BOOT_B);
    for (const st of ['HOST_GONE', 'ROOM_FULL', 'ALREADY_JOINED', 'UNAVAILABLE']) {
      expect(c, st).not.toContain(st);
    }
    // 어댑터에 위임한다.
    expect(c).toMatch(/openInviteEntry\(/);
    expect(c).toMatch(/navigateFromInvite\(/);
  });
  it('방 코드 fallback 이 없다', () => {
    const c = codeOnly(BOOT_B);
    expect(c).not.toMatch(/params\.get\('room'\)|getAll\('room'\)/);
  });
  it('부트 시퀀스가 기존 입장 경로를 재사용한다 (초대 전용 입장 로직 없음)', () => {
    // JP-ENTRY-INVITE-002 이후: 입장 핸들러는 makeInviteEntryHandlers 로 옮겨졌고
    // 여전히 기존 joinFromQrCode 경로를 그대로 쓴다.
    const handlers = slice('function makeInviteEntryHandlers()', 'async function resumePendingInviteAfterIdentity');
    expect(handlers).toContain('joinFromQrCode');
    expect(handlers).not.toMatch(/from\('participants'\)|from\('rooms'\)/);  // 초대 전용 입장 로직 없음
    const boot = slice('// JP-ENTRY-INVITE-001/002: `?invite=<token>` 진입', 'updateAuthTopbar();');
    expect(boot).toContain('beginInviteEntry(location.search');
  });
});
