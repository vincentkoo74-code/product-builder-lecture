// JP-BL-002 — 브라우저 수준 Kakao 격리 검증
//
// 단위 테스트는 소스의 배선을 고정한다. 이 스위트는 **실제 브라우저에서** JP 사용자 경로가
// Kakao 를 노출하지도, 요청하지도, 콜백으로 되살리지도 않는다는 것을 관측한다.
import { test, expect, chromium } from '@playwright/test';
import { REST_URL } from './local-env.mjs';
import { startStaticServer, routeSupabase, resetDb, dbRooms, dbParticipants } from './harness.mjs';
import { anonToken } from './jwt-harness.mjs';

const REST = REST_URL();
let srv, browser, TOKEN;

test.beforeAll(async () => {
  TOKEN = await anonToken();
  srv = await startStaticServer();
  browser = await chromium.launch({ channel: 'chrome' });
});
test.afterAll(async () => { await browser?.close(); srv?.server.close(); });
test.beforeEach(() => { resetDb(); });

// Kakao 로 **나가는** 요청만 관측한다 — 인증 서버·API 호스트와 edge function 경로.
// ⚠️ 단순히 'kakao' 를 매칭하면 테스트가 스스로 만든 `?provider=kakao` 문서 요청까지 잡아
//    거짓 양성이 된다. 실제 엔드포인트만 본다.
const KAKAO_RE = /\/\/(kauth|kapi)\.kakao\.com|\/functions\/v1\/kakao-auth/i;

async function newClient() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await routeSupabase(ctx, REST, TOKEN);
  const page = await ctx.newPage();
  const kakaoRequests = [], errors = [];
  page.on('request', (r) => { if (KAKAO_RE.test(r.url())) kakaoRequests.push(r.url()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  return { ctx, page, kakaoRequests, errors };
}
const visibleScreen = (p) => p.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);
const local = (url) => { const u = new URL(url), s = new URL(srv.url); u.protocol = s.protocol; u.host = s.host; return u.toString(); };

test.describe('[BL-002] §14-1,2,13 JP 인증 표면', () => {
  test('1) 인증 화면에 Kakao 버튼이 존재하지 않는다 (숨김이 아니라 부재)', async () => {
    const C = await newClient();
    await C.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await C.page.waitForTimeout(1500);
    expect(await visibleScreen(C.page)).toBe('screenAuth');
    expect(await C.page.locator('#snsBtnKakao').count(), 'DOM 에 남아 있으면 제거가 아니라 숨김이다').toBe(0);
    expect(await C.page.locator('.sns-btn-kakao').count()).toBe(0);
    const authText = await C.page.locator('#screenAuth').innerText();
    expect(authText).not.toMatch(/카카오|カカオ|Kakao/i);
    await C.ctx.close();
  });

  test('2) JP 시작 경로 전체에서 Kakao 네트워크 요청이 0건이다', async () => {
    const C = await newClient();
    await C.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await C.page.waitForTimeout(1500);
    await C.page.evaluate(() => window.playAsGuest());
    await C.page.waitForTimeout(1000);
    await C.page.evaluate(() => { document.getElementById('homeNickname').value = 'zz_bl002'; });
    await C.page.evaluate(() => window.createRoom());
    await C.page.waitForTimeout(2500);
    expect(C.kakaoRequests, `Kakao 요청: ${C.kakaoRequests[0]}`).toHaveLength(0);
    expect(C.errors, `pageerror: ${C.errors[0]}`).toHaveLength(0);
    await C.ctx.close();
  });

  test('loginWithSns("kakao") 를 직접 불러도 아무 요청도 나가지 않는다', async () => {
    const C = await newClient();
    await C.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await C.page.waitForTimeout(1500);
    await C.page.evaluate(() => window.loginWithSns('kakao')).catch(() => {});
    await C.page.waitForTimeout(1500);
    expect(C.kakaoRequests).toHaveLength(0);
    // state 도 저장되지 않아야 한다 — 흔적을 남기지 않는다.
    expect(await C.page.evaluate(() => localStorage.getItem('kakaoOAuthState'))).toBeNull();
    await C.ctx.close();
  });
});

test.describe('[BL-002] §7,§14-7~9 예전 Kakao 콜백 / 딥링크', () => {
  test('7) 예전 Kakao 콜백으로 들어와도 Kakao 인증을 시도하지 않는다', async () => {
    const C = await newClient();
    await C.page.goto(`${srv.url}/index.html?lang=ja&provider=kakao&code=oldcode123&state=oldstate`,
      { waitUntil: 'domcontentloaded' });
    await C.page.waitForTimeout(2500);
    expect(C.kakaoRequests, 'Kakao 로 나간 요청이 있으면 격리 실패').toHaveLength(0);
    // 결정적으로 평소 진입(인증 화면)으로 간다.
    expect(await visibleScreen(C.page)).toBe('screenAuth');
    // 원시 OAuth 파라미터가 주소창에 남지 않는다.
    const url = C.page.url();
    expect(url).not.toContain('code=');
    expect(url).not.toContain('state=');
    expect(url).not.toContain('provider=kakao');
    expect(url).toContain('lang=ja');
    expect(C.errors, `pageerror: ${C.errors[0]}`).toHaveLength(0);
    await C.ctx.close();
  });

  test('8) 형식이 깨진 Kakao 콜백에도 크래시하지 않는다', async () => {
    // 네 번 부팅한다. 앱 부팅마다 세션 확인 타임아웃이 걸려 케이스당 20초 안팎이 든다 —
    // 제품 문제가 아니라 이 스위트의 특성이므로 이 테스트에만 넉넉한 예산을 준다.
    test.setTimeout(180000);
    // 컨텍스트 하나로 네 가지 형태를 순회한다 — 케이스마다 브라우저 컨텍스트를 새로 만들면
    // 검증에 보태는 것 없이 실행 시간만 늘어난다.
    const C = await newClient();
    for (const q of ['provider=kakao', 'provider=kakao&code=', 'provider=kakao&error=access_denied',
                     'provider=kakao&code=%E0%A4%A']) {
      await C.page.goto(`${srv.url}/index.html?lang=ja&${q}`, { waitUntil: 'domcontentloaded' });
      await C.page.waitForTimeout(1500);
      expect(await visibleScreen(C.page), q).toBe('screenAuth');
      expect(C.errors, `${q} → pageerror: ${C.errors[0]}`).toHaveLength(0);
      expect(C.kakaoRequests, q).toHaveLength(0);
      expect(C.page.url(), `${q} → 원시 OAuth 파라미터 잔존`).not.toContain('provider=kakao');
    }
    await C.ctx.close();
  });

  test('9) Kakao 쿼리 파라미터가 섞여 있어도 초대가 정상 동작한다', async () => {
    const A = await newClient();
    await A.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await A.page.waitForTimeout(1500);
    await A.page.evaluate(() => window.playAsGuest());
    await A.page.waitForTimeout(800);
    await A.page.evaluate(() => { document.getElementById('homeNickname').value = 'zz_host'; });
    await A.page.evaluate(() => window.createRoom());
    await A.page.waitForTimeout(2500);
    const roomCode = await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim());
    const inviteUrl = await A.page.evaluate(() => buildInviteUrl());
    expect(inviteUrl).toBeTruthy();

    // 예전 Kakao 콜백 파라미터를 초대 URL 에 억지로 섞는다.
    const u = new URL(local(inviteUrl));
    u.searchParams.set('provider', 'kakao');
    u.searchParams.set('code', 'stale');
    u.searchParams.set('lang', 'ja');
    const B = await newClient();
    await B.page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(1500);
    // 초대는 살아 있고, 신원이 없으니 인증 화면이며, Kakao 는 시도되지 않았다.
    expect(await visibleScreen(B.page)).toBe('screenAuth');
    expect(B.kakaoRequests).toHaveLength(0);
    expect(B.page.url(), '초대가 OAuth 정리에 휩쓸리면 안 된다').toContain('invite=');
    expect(B.page.url()).not.toContain('code=');

    await B.page.evaluate(() => window.playAsGuest());
    await expect.poll(async () =>
      (await dbParticipants(REST, TOKEN)).filter((p) => p.room_id === roomCode).length,
      { timeout: 30000 }).toBe(2);
    expect(B.page.url()).not.toContain('invite=');
    expect(B.page.url()).toContain('lang=ja');
    expect(B.kakaoRequests).toHaveLength(0);
    expect(B.errors, `pageerror: ${B.errors[0]}`).toHaveLength(0);
    await A.ctx.close(); await B.ctx.close();
  });

  test('10) 방 코드 fallback 이 없다 — 초대 URL 에 방 코드가 없다', async () => {
    const A = await newClient();
    await A.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await A.page.waitForTimeout(1500);
    await A.page.evaluate(() => window.playAsGuest());
    await A.page.waitForTimeout(800);
    await A.page.evaluate(() => window.createRoom());
    await A.page.waitForTimeout(2500);
    const roomCode = await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim());
    const inviteUrl = await A.page.evaluate(() => buildInviteUrl());
    expect(inviteUrl).not.toContain(roomCode);
    expect(inviteUrl).not.toContain('room=');
    await A.ctx.close();
  });
});
