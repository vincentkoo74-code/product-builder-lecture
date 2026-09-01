// JP-BL-005 — JP 런타임 리전 격리 실증 (실제 Tokyo)
//
// 묻는 것: 지원되는/깨진 어떤 JP 경로에서도 JP 사용자·방·참가자·세션·매칭 동작이
//          KR/Seoul 백엔드나 KR 풀에 도달할 수 있는가? 답은 NO 여야 한다.
//
// ⚠️ 이 스위트는 **실제 Tokyo 프로덕션**에 일회용 행을 만든다(가드 필수).
//    Seoul 에는 아무것도 쓰지 않는다 — 격리 증명이 KR 인프라를 건드릴 필요는 없다.
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import { startStaticServer } from './harness.mjs';
import { assertTokyo, TOKYO_REF, restGet, restDel } from './tokyo-realtime-harness.mjs';

const OUT = new URL('../../.jp-e2e', import.meta.url).pathname;
// KR ref 를 여기 하드코딩하지 않는다 — 리전 레지스트리가 단일 기준이다.
const SEOUL_REF = JSON.parse(
  fs.readFileSync(new URL('../../config/regions.json', import.meta.url), 'utf8')
).regions.KR.supabase_project_ref;
const TEST_ID = 'JPISO';

test.skip(process.env.JP_TOKYO_REALTIME !== '1',
  'Tokyo 프로덕션에 쓴다 — JP_TOKYO_REALTIME=1 로 명시 승인해야 실행된다.');

let srv, browser;
const created = { rooms: new Set() };
const report = { ref: TOKYO_REF, hosts: {}, sockets: [], scenarios: {} };

test.beforeAll(async () => {
  assertTokyo();
  srv = await startStaticServer();
  browser = await chromium.launch({ channel: 'chrome' });
});
test.afterAll(async () => {
  for (const rid of created.rooms) { await restDel(`participants?room_id=eq.${rid}`); }
  const admin = process.env.JP_TOKYO_ADMIN_URI;
  const left = [];
  for (const rid of created.rooms) {
    const rows = await restGet(`rooms?id=eq.${rid}&select=id`).catch(() => []);
    if (Array.isArray(rows) && rows.length) left.push(rid);
  }
  if (left.length && admin) {
    const { execFileSync } = await import('node:child_process');
    execFileSync('psql', [admin, '-q', '-c',
      `delete from public.participants where room_id in (${left.map((r) => `'${r}'`).join(',')});
       delete from public.rooms where id in (${left.map((r) => `'${r}'`).join(',')});`],
      { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } });
    report.adminCleanup = left;
  } else if (left.length) { report.manualCleanupRequired = left; }
  report.cleanup = [...created.rooms];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/jp-region-isolation-report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); srv?.server.close();
});

// 모든 요청의 목적지 호스트와 websocket 엔드포인트를 기록한다.
function watch(page, label) {
  const rec = { label, hosts: new Map(), sockets: [], seoul: [], kakao: [] };
  // ⚠️ **목적지(host)** 로 판정한다. URL 전체를 부분문자열로 보면 테스트가 스스로 쿼리에 심은
  //    KR ref 까지 "유출"로 잡아 거짓 양성이 된다 — 실제로 한 번 그랬다.
  const isSeoulHost = (h) => h.includes(SEOUL_REF) || /ap-northeast-2/i.test(h);
  page.on('request', (r) => {
    const u = r.url();
    let host = '(unparsable)';
    try { host = new URL(u).host; } catch (e) {}
    rec.hosts.set(host, (rec.hosts.get(host) || 0) + 1);
    if (isSeoulHost(host)) rec.seoul.push(u);
    if (/^(kauth|kapi)\.kakao\.com$/i.test(host) || /\/functions\/v1\/kakao-auth/i.test(u)) rec.kakao.push(u);
  });
  page.on('websocket', (ws) => {
    rec.sockets.push(ws.url());
    let h = ''; try { h = new URL(ws.url()).host; } catch (e) {}
    if (isSeoulHost(h)) rec.seoul.push(ws.url());
  });
  return rec;
}
const visibleScreen = (p) => p.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);
// 서드파티 정적 자산 호스트 — 백엔드가 아니다. 별도로 분류해 보고한다(CEO §12).
const STATIC_ASSET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const local = (url) => { const u = new URL(url), s = new URL(srv.url); u.protocol = s.protocol; u.host = s.host; return u.toString(); };

async function client(nick) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript((n) => { try { localStorage.setItem('rpsNickname', n); localStorage.setItem('rpsLocale', 'ja'); } catch (e) {} }, nick);
  const page = await ctx.newPage();
  return { ctx, page, rec: watch(page, nick) };
}
// 백엔드 목적지 판정: supabase 호스트는 **전부** Tokyo ref 여야 한다.
function assertTokyoOnly(rec, where) {
  const supa = [...rec.hosts.keys()].filter((h) => /supabase\.(co|com)$/.test(h));
  expect(rec.seoul, `${where}: Seoul/KR 목적지 ${rec.seoul[0]}`).toHaveLength(0);
  expect(rec.kakao, `${where}: Kakao 목적지 ${rec.kakao[0]}`).toHaveLength(0);
  for (const h of supa) expect(h, `${where}: 비-Tokyo supabase 호스트`).toBe(`${TOKYO_REF}.supabase.co`);
  return supa;
}

test('§19-1~10,16 전체 두 클라이언트 경로의 목적지가 Tokyo 뿐이다', async () => {
  test.setTimeout(300000);
  const A = await client(`zz_${TEST_ID}_A`);
  const B = await client(`zz_${TEST_ID}_B`);

  // 1) 시작 → 게스트
  await A.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
  await A.page.waitForTimeout(1500);
  report.scenarios.startup = { supabaseHosts: assertTokyoOnly(A.rec, 'startup') };
  await A.page.evaluate(() => window.playAsGuest());
  await A.page.waitForTimeout(800);
  report.scenarios.guestIdentity = { supabaseHosts: assertTokyoOnly(A.rec, 'guest') };

  // 3) 방 생성 → Tokyo 에 실재하는가
  await A.page.evaluate(() => window.createRoom());
  await A.page.waitForTimeout(3000);
  const roomCode = await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim());
  expect(roomCode).toMatch(/^[A-Z0-9]{4}$/);
  created.rooms.add(roomCode);
  const tokyoRoom = await restGet(`rooms?id=eq.${roomCode}&select=id,invite_token`);
  report.scenarios.roomCreation = { roomCode, tokyoRows: tokyoRoom.length,
    hasToken: !!tokyoRoom[0]?.invite_token, supabaseHosts: assertTokyoOnly(A.rec, 'createRoom') };
  expect(tokyoRoom, '방이 Tokyo 권위 저장소에 있어야 한다').toHaveLength(1);
  expect(tokyoRoom[0].invite_token, '초대 토큰도 Tokyo 에 영속').toMatch(/^[A-Za-z0-9_-]{22}$/);

  // 8) Realtime 소켓이 Tokyo 인가
  const t0 = Date.now();
  while (A.rec.sockets.length === 0 && Date.now() - t0 < 25000) await A.page.waitForTimeout(250);
  report.scenarios.realtime = { sockets: A.rec.sockets.map((s) => s.split('?')[0]) };
  expect(A.rec.sockets.length, 'Realtime 소켓이 열려야 한다').toBeGreaterThan(0);
  for (const s of A.rec.sockets) {
    expect(new URL(s).host, 'Realtime 목적지').toBe(`${TOKYO_REF}.supabase.co`);
  }

  // 5,6) 초대 해석 + 참가자 합류
  const inviteUrl = await A.page.evaluate(() => buildInviteUrl());
  await B.page.goto(local(inviteUrl), { waitUntil: 'domcontentloaded' });
  await B.page.waitForTimeout(1500);
  expect(await visibleScreen(B.page)).toBe('screenAuth');
  await B.page.evaluate(() => window.playAsGuest());
  await expect.poll(async () =>
    (await restGet(`participants?room_id=eq.${roomCode}&select=id`)).length, { timeout: 45000 }).toBe(2);
  // B 의 Realtime 소켓이 실제로 열릴 때까지 기다린다 — 빈 배열에 대한 공허한 통과를 막는다.
  const tB = Date.now();
  while (B.rec.sockets.length === 0 && Date.now() - tB < 25000) await B.page.waitForTimeout(250);
  expect(B.rec.sockets.length, '초대로 합류한 클라이언트도 Realtime 에 붙어야 한다').toBeGreaterThan(0);
  report.scenarios.inviteJoin = {
    tokyoParticipants: 2, supabaseHosts: assertTokyoOnly(B.rec, 'invite+join'),
    sockets: B.rec.sockets.map((x) => new URL(x).host),
  };
  for (const x of B.rec.sockets) expect(new URL(x).host).toBe(`${TOKYO_REF}.supabase.co`);

  // 7,10) 방 상태 갱신 + nextRound 까지
  await A.page.evaluate(() => window.showPenaltyScreen());
  await A.page.waitForTimeout(600);
  await A.page.fill('#penaltyInput', `ZZ_${TEST_ID} テスト`);
  await A.page.evaluate(() => window.savePenalty());
  await expect.poll(async () =>
    (await restGet(`rooms?id=eq.${roomCode}&select=status`))[0]?.status, { timeout: 45000 }).toBe('ready');
  await B.page.evaluate(() => window.markReady()).catch(() => {});
  await A.page.waitForTimeout(2500);
  await A.page.evaluate(() => window.startGame());
  await expect.poll(async () =>
    (await restGet(`rooms?id=eq.${roomCode}&select=status`))[0]?.status, { timeout: 45000 }).toBe('playing');
  await A.page.waitForTimeout(6000);
  await Promise.all([
    A.page.evaluate(() => window.selectChoice('rock')).catch(() => {}),
    B.page.evaluate(() => window.selectChoice('rock')).catch(() => {}),
  ]);
  await expect.poll(async () =>
    (await restGet(`rooms?id=eq.${roomCode}&select=status`))[0]?.status, { timeout: 60000 }).toBe('result');
  await A.page.evaluate(() => window.nextRound());
  await expect.poll(async () =>
    (await restGet(`rooms?id=eq.${roomCode}&select=round`))[0]?.round, { timeout: 60000 }).toBe(2);

  // 16) 전 구간 최종 목적지 감사
  const all = new Map();
  for (const r of [A.rec, B.rec]) for (const [h, n] of r.hosts) all.set(h, (all.get(h) || 0) + n);
  report.hosts = Object.fromEntries(all);
  report.sockets = [...A.rec.sockets, ...B.rec.sockets].map((s) => new URL(s).host);
  assertTokyoOnly(A.rec, 'final-A');
  assertTokyoOnly(B.rec, 'final-B');
  // 목적지를 세 갈래로 분류한다: 앱 자신 / JP 백엔드 / 서드파티 정적 자산.
  // 판정 대상은 **백엔드**다 — 정적 자산은 국가 격리 문제가 아니므로 따로 나열한다(CEO §12).
  const localHost = new URL(srv.url).host;
  const backend = [...all.keys()].filter((h) => h !== localHost && !STATIC_ASSET_HOSTS.includes(h));
  report.scenarios.destinations = {
    appOrigin: localHost,
    backend,
    thirdPartyStatic: [...all.keys()].filter((h) => STATIC_ASSET_HOSTS.includes(h)),
  };
  expect(backend, `JP 백엔드 목적지는 Tokyo 하나뿐이어야 한다: ${backend.join(', ')}`)
    .toEqual([`${TOKYO_REF}.supabase.co`]);

  await A.ctx.close(); await B.ctx.close();
});

// ───────────────────────────────────────────── §11 실패 / fallback 시나리오
//
// 전부 **쓰기 없이** 돈다 — Tokyo 를 막아 세우고 무엇이 일어나는지만 본다.
// 핵심 주장: Tokyo 가 안 되면 JP 는 **닫힌 채 실패**해야 한다. Seoul 로 가면 안 된다.
test.describe('§11 실패/fallback — Seoul 로 새지 않는다', () => {
  const bootWith = async (opts = {}) => {
    const { blockRest = false, blockRealtime = false, query = '' } = opts;
    const c = await client(`zz_${TEST_ID}_neg`);
    if (blockRest) await c.ctx.route(`https://${TOKYO_REF}.supabase.co/rest/v1/**`, (r) => r.abort());
    if (blockRealtime) await c.ctx.route(`https://${TOKYO_REF}.supabase.co/realtime/v1/**`, (r) => r.abort());
    await c.page.goto(`${srv.url}/index.html?lang=ja${query}`, { waitUntil: 'domcontentloaded' });
    await c.page.waitForTimeout(2000);
    await c.page.evaluate(() => window.playAsGuest()).catch(() => {});
    await c.page.waitForTimeout(1500);
    return c;
  };
  const noSeoul = (c, where) => {
    expect(c.rec.seoul, `${where}: Seoul 목적지 ${c.rec.seoul[0]}`).toHaveLength(0);
    expect(c.rec.kakao, `${where}: Kakao 목적지`).toHaveLength(0);
    const supa = [...c.rec.hosts.keys()].filter((h) => /supabase\.(co|com)$/.test(h));
    for (const h of supa) expect(h, `${where}: 비-Tokyo supabase 호스트`).toBe(`${TOKYO_REF}.supabase.co`);
    return supa;
  };

  test('A) Tokyo REST 불가 → Seoul fallback 없음', async () => {
    const c = await bootWith({ blockRest: true });
    await c.page.evaluate(() => window.createRoom()).catch(() => {});
    await c.page.waitForTimeout(4000);
    report.scenarios.restDown = { supabaseHosts: noSeoul(c, 'REST down'),
      screen: await visibleScreen(c.page) };
    await c.ctx.close();
  });

  test('B) Tokyo Realtime 불가 → 폴링은 Tokyo 로만, Seoul fallback 없음', async () => {
    const c = await bootWith({ blockRealtime: true });
    await c.page.waitForTimeout(6000);   // 폴링 주기(2.6초)를 두 번 이상 지나게 둔다
    const supa = noSeoul(c, 'Realtime down');
    const restCalls = [...c.rec.hosts.entries()].find(([h]) => h === `${TOKYO_REF}.supabase.co`);
    report.scenarios.realtimeDown = { supabaseHosts: supa, tokyoRequests: restCalls ? restCalls[1] : 0,
      sockets: c.rec.sockets.map((x) => new URL(x).host) };
    for (const x of c.rec.sockets) expect(new URL(x).host).toBe(`${TOKYO_REF}.supabase.co`);
    await c.ctx.close();
  });

  test('C,D) 알 수 없는 초대 토큰 → 교차 리전 탐색 없음', async () => {
    const c = await bootWith({ query: `&invite=${'Z'.repeat(22)}` });
    await c.page.waitForTimeout(4000);
    report.scenarios.unknownInvite = { supabaseHosts: noSeoul(c, 'unknown invite'),
      screen: await visibleScreen(c.page) };
    await c.ctx.close();
  });

  test('E,F,G) KR project ref / region 을 URL·로컬 상태로 주입해도 무시된다', async () => {
    const c = await client(`zz_${TEST_ID}_inject`);
    // 저장된 세션·설정에 KR 값을 심어 둔다. 런타임이 이를 읽으면 격리가 깨진다.
    await c.ctx.addInitScript((seoul) => {
      try {
        localStorage.setItem('rpsRegion', 'KR');
        localStorage.setItem('supabaseUrl', `https://${seoul}.supabase.co`);
        localStorage.setItem(`sb-${seoul}-auth-token`, JSON.stringify({ access_token: 'x', user: { id: 'kr' } }));
      } catch (e) {}
    }, SEOUL_REF);
    await c.page.goto(
      `${srv.url}/index.html?lang=ja&region=KR&ref=${SEOUL_REF}&supabase_url=https://${SEOUL_REF}.supabase.co`,
      { waitUntil: 'domcontentloaded' });
    await c.page.waitForTimeout(2000);
    await c.page.evaluate(() => window.playAsGuest()).catch(() => {});
    await c.page.waitForTimeout(2500);
    report.scenarios.krInjection = { supabaseHosts: noSeoul(c, 'KR injection'),
      screen: await visibleScreen(c.page) };
    await c.ctx.close();
  });

  test('H) 예전 Kakao 콜백 → KR 인증/백엔드 fallback 없음', async () => {
    const c = await bootWith({ query: '&provider=kakao&code=stale&state=old' });
    await c.page.waitForTimeout(2500);
    report.scenarios.kakaoCallback = { supabaseHosts: noSeoul(c, 'kakao callback'),
      screen: await visibleScreen(c.page), url: c.page.url() };
    expect(c.page.url()).not.toContain('code=');
    await c.ctx.close();
  });
});
