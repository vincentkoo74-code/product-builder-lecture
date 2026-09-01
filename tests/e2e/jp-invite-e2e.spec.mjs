// JP-E2E-INVITE-001/002 — 실제 앱 DOM/네비게이션을 통한 두 클라이언트 URL 도전 검증
//
// JP-ENTRY-INVITE-002 수정 이후의 계약:
//   파싱 ≠ 소비. 초대는 신원이 생길 때까지 보류되고 URL 에도 남는다.
//   신원(게스트/SNS)이 생긴 뒤에야 권위 조회 → 입장 → URL 정리다.
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import { startStaticServer, routeSupabase, resetDb, dbRooms, dbParticipants } from './harness.mjs';

const S = '/private/tmp/claude-501/-Users-vk/068eb9e5-39ce-42b9-adf4-8b07a5ef8b3e/scratchpad';
const REST = `http://127.0.0.1:${fs.readFileSync(`${S}/e2e-restport`, 'utf8').trim()}`;

let srv, browser;
test.beforeAll(async () => {
  srv = await startStaticServer();
  // 로컬에 playwright headless shell 이 없어 시스템 Chrome 채널을 쓴다(환경 제약, I1).
  browser = await chromium.launch({ channel: 'chrome' });
});
test.afterAll(async () => { await browser?.close(); srv?.server.close(); });
test.beforeEach(async () => { await resetDb(REST); });

async function newClient({ lang = 'ja' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await routeSupabase(ctx, REST);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  return { ctx, page, errors, lang };
}

// 화면 가시성으로 관측한다 — state 는 모듈 스코프라 window 에 없다(앱 구조 그대로 존중).
const visibleScreen = (page) => page.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);
const waitScreen = (page, id, timeout = 30000) =>
  page.waitForFunction((x) => { const el = document.getElementById(x); return el && !el.classList.contains('hidden'); }, id, { timeout });
// 초대 URL 의 호스트만 로컬 서버로 바꾼다. 정규식 치환은 경로 없는 URL 에서 쿼리까지 먹는다.
const local = (url) => { const u = new URL(url), s = new URL(srv.url); u.protocol = s.protocol; u.host = s.host; return u.toString(); };

// 실제 UI 경로: 인증 화면 → 게스트 플레이 → 홈.
const open = async (c, query = '') => {
  await c.page.goto(`${srv.url}/index.html?lang=${c.lang}${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' });
  await c.page.waitForTimeout(1200);
  if ((await visibleScreen(c.page)) === 'screenAuth') {
    await c.page.evaluate(() => window.playAsGuest());
    await waitScreen(c.page, 'screenHome');
  }
};

// 초대 URL 진입. becomeGuest=true 면 인증 화면에서 실제 "게스트로 플레이" 를 누른다.
const openInvite = async (c, url, { becomeGuest = true, settle = 1500 } = {}) => {
  await c.page.goto(local(url), { waitUntil: 'domcontentloaded' });
  await c.page.waitForTimeout(settle);
  const screen = await visibleScreen(c.page);
  if (becomeGuest && screen === 'screenAuth') {
    await c.page.evaluate(() => window.playAsGuest());
    await c.page.waitForTimeout(500);
  }
  return screen;   // 신원 확립 **직전**에 무엇이 보였는지 반환한다
};

// 실제 UI 버튼이 호출하는 것과 동일한 진입점.
async function hostCreatesChallenge(c, nickname = 'ホスト') {
  await c.page.evaluate((n) => { const el = document.getElementById('homeNickname'); if (el) el.value = n; }, nickname);
  await c.page.evaluate(() => window.createRoom());
  await waitScreen(c.page, 'screenHostRoom');
  const code = await c.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim() || null);
  const rooms = await dbRooms(REST);
  const room = code ? rooms.find((r) => r.id === code) : rooms[rooms.length - 1];
  const inviteUrl = await c.page.evaluate(() => (typeof buildInviteUrl === 'function') ? buildInviteUrl() : null);
  return { roomCode: room?.id, inviteToken: room?.invite_token, inviteUrl };
}

const participantsOf = async (roomCode) =>
  (await dbParticipants(REST)).filter((p) => p.room_id === roomCode);

// ───────────────────────────────────────────────────────────── 도전 생성 / 보안 초대

test.describe('[E2E] §4-1~3,24 도전 생성 + 보안 초대 + 대기 화면', () => {
  test('1,2) host 가 도전을 만들면 보안 토큰이 발급·영속된다', async () => {
    const A = await newClient();
    await open(A);
    const info = await hostCreatesChallenge(A);
    expect(info.roomCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(info.inviteToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const mine = (await dbRooms(REST)).filter((r) => r.id === info.roomCode);
    expect(mine).toHaveLength(1);
    expect(mine[0].invite_token).toBe(info.inviteToken);
    expect(info.inviteUrl).toContain(`invite=${info.inviteToken}`);
    expect(A.errors, `pageerror: ${A.errors[0]}`).toHaveLength(0);
    await A.ctx.close();
  });

  test('3) 대기 화면이 보이고 초대 액션이 노출된다', async () => {
    const A = await newClient();
    await open(A);
    await hostCreatesChallenge(A);
    await expect(A.page.locator('#screenHostRoom')).not.toHaveClass(/hidden/);
    await expect(A.page.locator('#hostWaitingBox')).not.toHaveClass(/hidden/);
    await expect(A.page.locator('#inviteCopyBtn')).not.toHaveClass(/hidden/);
    await expect(A.page.locator('#inviteUnavailableNote')).toHaveClass(/hidden/);
    expect(await A.page.locator('#hostWaitingTitle').textContent()).toContain('友だち');
    await A.ctx.close();
  });

  test('17,24) 짧은 방 코드가 초대 자격증명으로 쓰이지 않는다 (fallback 없음)', async () => {
    const A = await newClient();
    await open(A);
    const info = await hostCreatesChallenge(A);
    expect(info.inviteUrl).not.toContain(`room=${info.roomCode}`);
    expect(info.inviteUrl).not.toContain(info.roomCode);
    await A.ctx.close();
  });
});

// ───────────────────────────────────────────── 신원을 가로지르는 보류 초대 (JP-ENTRY-INVITE-002)

test.describe('[E2E] §10-1~7 신원 부트스트랩을 가로지르는 초대', () => {
  test('2,3,4,5,6) 신원 없는 초대자: 인증 화면에서 초대가 보류되고, 게스트 확정 후 합류한다', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);

    const B = await newClient();
    await B.page.goto(local(info.inviteUrl), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(1500);

    // 4,5) 보류 중: 인증 화면 + 초대는 URL 에 그대로 + 아직 합류하지 않았다.
    expect(await visibleScreen(B.page), '신원 없는 초대자는 인증 화면을 봐야 한다').toBe('screenAuth');
    expect(B.page.url(), '소비 전에는 초대를 URL 에서 지우면 안 된다').toContain(`invite=${info.inviteToken}`);
    expect(await participantsOf(info.roomCode)).toHaveLength(1);

    // 3) 게스트 신원 생성 → 보류 초대가 이어진다.
    await B.page.evaluate(() => window.playAsGuest());
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);

    // 6) 성공적으로 합류한 뒤에야 URL 에서 초대가 사라진다.
    await expect.poll(() => B.page.url().includes('invite='), { timeout: 10000 }).toBe(false);
    expect(await visibleScreen(B.page)).not.toBe('screenAuth');
    expect(B.errors, `pageerror: ${B.errors[0]}`).toHaveLength(0);
    await A.ctx.close(); await B.ctx.close();
  });

  test('1) 이미 신원이 있는 초대자는 즉시 해석·합류한다', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);

    const B = await newClient();
    await open(B);                       // ← 먼저 게스트 신원을 만든다(같은 컨텍스트 = 같은 localStorage)
    const before = await openInvite(B, info.inviteUrl, { becomeGuest: false });
    expect(before, '신원이 있으면 인증 화면을 거치지 않는다').not.toBe('screenAuth');
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);
    expect(B.page.url()).not.toContain('invite=');
    await A.ctx.close(); await B.ctx.close();
  });

  test('7) 무관한 쿼리 파라미터는 보존하고 invite 만 제거한다', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);
    const B = await newClient();
    const u = new URL(local(info.inviteUrl));
    u.searchParams.set('lang', 'ja'); u.searchParams.set('debug', '1');
    await openInvite(B, u.toString());
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);
    expect(B.page.url()).toContain('lang=ja');
    expect(B.page.url()).toContain('debug=1');
    expect(B.page.url()).not.toContain('invite=');
    await A.ctx.close(); await B.ctx.close();
  });
});

// ───────────────────────────────────────────────────────────── 새로고침 복구 / 멱등성

test.describe('[E2E] §10-8~11 새로고침 복구 · 멱등성', () => {
  test('8) 신원이 생기기 전 새로고침 → 초대는 URL 에서 복구된다', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);

    const B = await newClient();
    await B.page.goto(local(info.inviteUrl), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(1500);
    expect(await visibleScreen(B.page)).toBe('screenAuth');

    await B.page.reload({ waitUntil: 'domcontentloaded' });   // ← 메모리는 날아가고 URL 만 남는다
    await B.page.waitForTimeout(1500);
    expect(B.page.url(), '새로고침 후에도 초대가 살아 있어야 한다').toContain(`invite=${info.inviteToken}`);
    expect(await visibleScreen(B.page)).toBe('screenAuth');
    expect(await participantsOf(info.roomCode)).toHaveLength(1);

    await B.page.evaluate(() => window.playAsGuest());
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);
    await A.ctx.close(); await B.ctx.close();
  });

  test('9) 합류 성공 후 새로고침 → 입장을 반복하지 않는다', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);
    const B = await newClient();
    await openInvite(B, info.inviteUrl);
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);
    const before = (await participantsOf(info.roomCode)).map((p) => p.id).sort();

    await B.page.reload({ waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(4000);
    const after = (await participantsOf(info.roomCode)).map((p) => p.id).sort();
    expect(after, '새로고침이 참가자를 늘리면 안 된다').toEqual(before);
    expect((await dbRooms(REST)).filter((r) => r.id === info.roomCode)).toHaveLength(1);
    await A.ctx.close(); await B.ctx.close();
  });

  test('10,11) 같은 초대를 다시 열면 ALREADY_JOINED 로 재개한다 (중복 참가자 없음)', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);
    const B = await newClient();
    await openInvite(B, info.inviteUrl);
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);
    const before = (await participantsOf(info.roomCode)).map((p) => p.id).sort();

    await openInvite(B, info.inviteUrl, { becomeGuest: false, settle: 4000 });   // 같은 컨텍스트 = 신원 유지
    const after = (await participantsOf(info.roomCode)).map((p) => p.id).sort();
    expect(after, '재오픈이 참가자를 늘리면 안 된다').toEqual(before);
    await A.ctx.close(); await B.ctx.close();
  });

  test('12) 해석이 실패하면 초대는 사라지지 않고 복구 가능하다', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);

    const B = await newClient();
    // rooms 조회를 끊어 권위 해석을 실패시킨다(신원 생성 실패와 같은 부류 — 소비 전 중단).
    let broken = true;
    await B.ctx.route('**/rest/v1/rooms**', async (route) => {
      if (broken) return route.abort();
      return route.fallback();
    });
    await B.page.goto(local(info.inviteUrl), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(1200);
    await B.page.evaluate(() => window.playAsGuest());
    await B.page.waitForTimeout(2500);
    expect(await participantsOf(info.roomCode), '실패 시 합류하지 않는다').toHaveLength(1);

    broken = false;
    await B.page.reload({ waitUntil: 'domcontentloaded' });   // ← URL 에 초대가 남아 있어 복구된다
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);
    await A.ctx.close(); await B.ctx.close();
  });
});

// ───────────────────────────────────────────────────────────── 오류 경로

test.describe('[E2E] §10-13~16 오류 경로', () => {
  // 형식 오류는 신원 없이도 즉시 거부된다. 권위 조회가 필요한 상태는 신원 확립 후 판정된다.
  const blocked = async (query, { becomeGuest = true } = {}) => {
    const C = await newClient();
    await C.page.goto(`${srv.url}/index.html?lang=ja&${query}`, { waitUntil: 'domcontentloaded' });
    await C.page.waitForTimeout(1200);
    if (becomeGuest && (await visibleScreen(C.page)) === 'screenAuth') {
      await C.page.evaluate(() => window.playAsGuest());
    }
    await C.page.waitForFunction(() =>
      !document.getElementById('screenInviteUnavailable')?.classList.contains('hidden'), { timeout: 25000 });
    const title = await C.page.locator('#inviteUnavailableTitle').textContent();
    const url = C.page.url();
    await C.ctx.close();
    return { title, url };
  };

  test('13) 형식이 깨진 초대 URL → 신원 없이도 즉시 전용 화면 (DB 조회 없이)', async () => {
    const r = await blocked('invite=abc', { becomeGuest: false });
    expect(r.title).toBeTruthy();
    expect(r.url).not.toContain('invite=');
  });

  test('14) 알 수 없는 토큰 → 전용 화면', async () => {
    const r = await blocked(`invite=${'Z'.repeat(22)}`);
    expect(r.title).toBeTruthy();
    expect(r.url).not.toContain('invite=');
  });

  test('15) host 가 떠난 도전 → 相手はもう待っていません', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);
    await fetch(`${REST}/participants?room_id=eq.${info.roomCode}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await A.ctx.close();
    const r = await blocked(`invite=${info.inviteToken}`);
    expect(r.title).toContain('相手はもう待っていません');
  });

  test('16) 정원이 찬 방 → 전용 화면', async () => {
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A);
    const filler = Array.from({ length: 19 }, (_, i) => ({
      id: `zz_fill_${i}`, room_id: info.roomCode, name: `f${i}`, is_host: false }));
    await fetch(`${REST}/participants`, { method: 'POST',
      headers: { 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(filler) });
    await A.ctx.close();
    const r = await blocked(`invite=${info.inviteToken}`);
    expect(r.title).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────── 실제 1라운드까지

test.describe('[E2E] §10-18~20 준비 → 카운트다운 → 첫 라운드', () => {
  test('18,19,20) 초대로 합류한 두 명이 준비하고 실제 1라운드를 진행한다', async () => {
    test.setTimeout(180000);
    const A = await newClient(); await open(A);
    const info = await hostCreatesChallenge(A, 'ホスト');

    const B = await newClient();
    await openInvite(B, info.inviteUrl);
    await expect.poll(async () => (await participantsOf(info.roomCode)).length, { timeout: 30000 }).toBe(2);

    // 호스트가 벌칙을 정하면 방이 ready 로 간다 (기존 UI 경로 그대로).
    await A.page.evaluate(() => window.showPenaltyScreen());
    await waitScreen(A.page, 'screenPenalty');
    await A.page.fill('#penaltyInput', 'コーヒーおごり');
    await A.page.evaluate(() => window.savePenalty());
    await expect.poll(async () =>
      (await dbRooms(REST)).find((r) => r.id === info.roomCode)?.status, { timeout: 30000 }).toBe('ready');

    // 18) 초대로 들어온 참가자가 준비 완료를 누른다.
    await waitScreen(B.page, 'screenReady', 40000);
    await B.page.click('#myReadyBtn');
    await expect.poll(async () =>
      (await participantsOf(info.roomCode)).filter((p) => !p.is_host).every((p) => p.is_ready),
      { timeout: 30000 }).toBe(true);

    // 19) 호스트가 시작 → 카운트다운 → 게임 화면
    await waitScreen(A.page, 'screenHostRoom', 40000).catch(() => {});
    await A.page.evaluate(() => window.startGame());
    await expect.poll(async () =>
      (await dbRooms(REST)).find((r) => r.id === info.roomCode)?.status, { timeout: 30000 }).toBe('playing');
    await waitScreen(B.page, 'screenGame', 40000);

    // 20) 실제 1라운드: 초대로 들어온 참가자가 진짜로 손을 낸다.
    await B.page.click('.choice-button >> nth=1');
    await expect.poll(async () =>
      (await participantsOf(info.roomCode)).filter((p) => !p.is_host && p.choice).length,
      { timeout: 20000 }).toBe(1);

    expect(A.errors, `A pageerror: ${A.errors[0]}`).toHaveLength(0);
    expect(B.errors, `B pageerror: ${B.errors[0]}`).toHaveLength(0);
    await A.ctx.close(); await B.ctx.close();
  });
});
