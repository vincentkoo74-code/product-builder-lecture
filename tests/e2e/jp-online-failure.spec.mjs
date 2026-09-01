// JP-BL-010 — 온라인 백엔드 실패 UX (브라우저)
//
// 단위 테스트는 배선을 잠근다. 이 스위트는 **실제 브라우저에서** Tokyo REST 를 끊었을 때
// 사용자가 무엇을 보고, 무엇이 만들어지지 않으며, 어디로도 새지 않는지를 관측한다.
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import { REST_URL } from './local-env.mjs';
import { startStaticServer, routeSupabase, resetDb, dbRooms, dbParticipants, SUPABASE_HOST } from './harness.mjs';
import { anonToken } from './jwt-harness.mjs';

const REST = REST_URL();
const SEOUL_REF = JSON.parse(
  fs.readFileSync(new URL('../../config/regions.json', import.meta.url), 'utf8')
).regions.KR.supabase_project_ref;

let srv, browser, TOKEN;
test.beforeAll(async () => {
  TOKEN = await anonToken();
  srv = await startStaticServer();
  browser = await chromium.launch({ channel: 'chrome' });
});
test.afterAll(async () => { await browser?.close(); srv?.server.close(); });
test.beforeEach(() => { resetDb(); });

const visibleScreen = (p) => p.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);

async function client({ blockRest = false, blockRealtime = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await routeSupabase(ctx, REST, TOKEN);
  // routeSupabase 보다 **뒤에** 등록해야 우선 적용된다(Playwright 는 나중 등록이 먼저다).
  if (blockRest) await ctx.route(`${SUPABASE_HOST}/rest/v1/**`, (r) => r.abort());
  if (blockRealtime) await ctx.route(`${SUPABASE_HOST}/realtime/v1/**`, (r) => r.abort());
  const page = await ctx.newPage();
  const foreign = [], errors = [];
  page.on('request', (r) => {
    let h = ''; try { h = new URL(r.url()).host; } catch (e) {}
    if (h.includes(SEOUL_REF) || /ap-northeast-2/i.test(h)) foreign.push(r.url());
    if (/^(kauth|kapi)\.kakao\.com$/i.test(h)) foreign.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  return { ctx, page, foreign, errors };
}
async function guestHome(c) {
  await c.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
  await c.page.waitForTimeout(1500);
  if ((await visibleScreen(c.page)) === 'screenAuth') {
    await c.page.evaluate(() => window.playAsGuest());
    await c.page.waitForTimeout(600);
  }
}

test.describe('[BL-010] §15-2~8,13,14 Tokyo REST 불가', () => {
  test('2,3,4,8) 방 생성 실패 → 명시적 실패 화면, 가짜 방/초대 없음', async () => {
    const C = await client({ blockRest: true });
    await guestHome(C);
    await C.page.evaluate(() => { document.getElementById('homeNickname').value = 'zz_bl010'; });
    await C.page.evaluate(() => window.createRoom()).catch(() => {});
    await C.page.waitForTimeout(8000);

    // 2) 명시적 실패 화면 — 조용히 온라인 도전처럼 보이지 않는다.
    expect(await visibleScreen(C.page), '실패인데 방 화면이 뜨면 조용한 강등이다').toBe('screenConnectionError');
    expect(await C.page.locator('#connectionErrorTitle').textContent()).toBe('通信できませんでした');
    expect(await C.page.locator('#connectionErrorDesc').textContent()).toContain('ネットワーク');

    // 3) 가짜 방이 만들어지지 않았다(로컬 상태로도).
    const shown = await C.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim());
    expect(shown === '----' || !shown, `방 코드가 노출됨: ${shown}`).toBeTruthy();

    // 4) 유효해 보이는 초대 액션이 없다.
    await expect(C.page.locator('#screenHostRoom')).toHaveClass(/hidden/);
    const inviteUrl = await C.page.evaluate(() => (typeof buildInviteUrl === 'function') ? buildInviteUrl() : null);
    expect(inviteUrl, '실패했는데 초대 URL 이 만들어지면 안 된다').toBeFalsy();

    // 8) 로컬 게임으로 조용히 들어가지 않았다.
    await expect(C.page.locator('#screenGame')).toHaveClass(/hidden/);
    await expect(C.page.locator('#screenReady')).toHaveClass(/hidden/);

    // 13,14) 다른 리전/Kakao 로 새지 않았다.
    expect(C.foreign, `외부 목적지: ${C.foreign[0]}`).toHaveLength(0);
    expect(C.errors, `pageerror: ${C.errors[0]}`).toHaveLength(0);
    await C.ctx.close();
  });

  test('9,10,11) 재시도가 방/참가자/초대 토큰을 중복 생성하지 않는다', async () => {
    const C = await client({ blockRest: true });
    await guestHome(C);
    await C.page.evaluate(() => window.createRoom()).catch(() => {});
    await C.page.waitForTimeout(8000);
    expect(await visibleScreen(C.page)).toBe('screenConnectionError');

    // 재시도 버튼을 눌러도 REST 가 여전히 죽어 있으면 같은 실패 화면이다.
    await C.page.click('#connectionRetryBtn');
    await C.page.waitForTimeout(8000);
    expect(await visibleScreen(C.page)).toBe('screenConnectionError');

    // 권위 저장소에 아무것도 없다 — 중복 이전에 애초에 생성 자체가 없다.
    expect(await dbRooms(REST, TOKEN)).toHaveLength(0);
    expect(await dbParticipants(REST, TOKEN)).toHaveLength(0);
    expect(C.foreign).toHaveLength(0);
    await C.ctx.close();
  });

  test('화면을 띄우는 것만으로 방이 만들어지지 않는다 (자동 재생성 없음)', async () => {
    const C = await client({ blockRest: true });
    await guestHome(C);
    await C.page.evaluate(() => window.createRoom()).catch(() => {});
    await C.page.waitForTimeout(8000);
    const before = (await dbRooms(REST, TOKEN)).length;
    await C.page.waitForTimeout(6000);   // 그냥 머물러 있는다
    expect((await dbRooms(REST, TOKEN)).length, '가만히 있는데 방이 늘면 안 된다').toBe(before);
    await C.ctx.close();
  });

  test('홈으로 돌아가면 정상 상태로 복귀한다', async () => {
    const C = await client({ blockRest: true });
    await guestHome(C);
    await C.page.evaluate(() => window.createRoom()).catch(() => {});
    await C.page.waitForTimeout(8000);
    await C.page.click('#connectionHomeBtn');
    await C.page.waitForTimeout(1200);
    expect(await visibleScreen(C.page)).toBe('screenHome');
    await C.ctx.close();
  });
});

test.describe('[BL-010] §15-6,7 초대 조회 / 합류 실패', () => {
  test('7) 합류가 실패하면 합류한 것처럼 보이지 않는다', async () => {
    // 먼저 정상 도전을 만든 뒤(REST 정상), 두 번째 클라이언트만 REST 를 끊는다.
    const A = await client();
    await guestHome(A);
    await A.page.evaluate(() => { document.getElementById('homeNickname').value = 'zz_host'; });
    await A.page.evaluate(() => window.createRoom());
    await A.page.waitForTimeout(3000);
    const roomCode = await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim());
    const inviteUrl = await A.page.evaluate(() => buildInviteUrl());
    expect(inviteUrl).toContain('invite=');

    const B = await client({ blockRest: true });
    const u = new URL(inviteUrl); const sv = new URL(srv.url);
    u.protocol = sv.protocol; u.host = sv.host;
    await B.page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(2000);
    await B.page.evaluate(() => window.playAsGuest()).catch(() => {});
    await B.page.waitForTimeout(8000);

    // 합류한 것처럼 보이면 안 된다 — 대기/게임 화면에 들어가 있으면 실패다.
    const screen = await visibleScreen(B.page);
    expect(['screenParticipantWait', 'screenReady', 'screenGame'],
      `합류 실패인데 방 안 화면(${screen})에 있다`).not.toContain(screen);
    // 권위 상태: 참가자는 여전히 host 1명뿐이다.
    const parts = (await dbParticipants(REST, TOKEN)).filter((p) => p.room_id === roomCode);
    expect(parts, '실패했는데 참가자가 생기면 안 된다').toHaveLength(1);

    // 6) 조회 실패는 복구 가능해야 한다 — 초대가 URL 에 남아 있다.
    expect(B.page.url(), '일시적 조회 실패로 초대를 파기하면 안 된다').toContain('invite=');
    expect(B.foreign).toHaveLength(0);
    await A.ctx.close(); await B.ctx.close();
  });
});

test.describe('[BL-010] §15-12 Realtime 실패는 백엔드 실패가 아니다', () => {
  test('12) Tokyo Realtime 불가 → 폴링으로 온라인 도전이 정상 생성된다', async () => {
    const C = await client({ blockRealtime: true });
    await guestHome(C);
    await C.page.evaluate(() => { document.getElementById('homeNickname').value = 'zz_rt'; });
    await C.page.evaluate(() => window.createRoom());
    await C.page.waitForTimeout(4000);

    // Realtime 이 죽어도 REST 권위가 살아 있으면 온라인 도전은 성립한다.
    expect(await visibleScreen(C.page), 'Realtime 실패를 백엔드 실패로 오판하면 안 된다').toBe('screenHostRoom');
    const rooms = await dbRooms(REST, TOKEN);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].invite_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const inviteUrl = await C.page.evaluate(() => buildInviteUrl());
    expect(inviteUrl).toContain('invite=');
    expect(C.foreign).toHaveLength(0);
    await C.ctx.close();
  });
});

test.describe('[BL-010] §15-1 의도적 로컬 모드는 그대로 동작한다', () => {
  test('1) 백엔드 클라이언트가 아예 없으면 로컬 플레이가 유지된다', async () => {
    // 의도적 로컬 = 백엔드 클라이언트 부재(getOnlineMode() === false).
    // 온라인 실패와 **다른 경로**임을 브라우저에서 확인한다.
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    // 백엔드 클라이언트가 아예 없는 상태를 만든다. addInitScript 로 window.supabase 를 지워도
    // 로컬 번들 vendor 스크립트가 다시 채우므로, **번들 자체를 막는다** — 이것이 실제 조건이다.
    await ctx.route('**/vendor/supabase*.js', (r) => r.abort());
    await ctx.route(`${SUPABASE_HOST}/**`, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    if ((await visibleScreen(page)) === 'screenAuth') {
      await page.evaluate(() => window.playAsGuest());
      await page.waitForTimeout(600);
    }
    await page.evaluate(() => { document.getElementById('homeNickname').value = 'zz_local'; });
    await page.evaluate(() => window.createRoom());
    await page.waitForTimeout(2500);
    expect(await visibleScreen(page), '의도적 로컬 플레이는 계속 동작해야 한다').toBe('screenHostRoom');
    expect(await dbRooms(REST, TOKEN), '로컬 모드는 백엔드에 쓰지 않는다').toHaveLength(0);
    expect(errors, `pageerror: ${errors[0]}`).toHaveLength(0);
    await ctx.close();
  });
});
