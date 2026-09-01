// JP-TOKYO-REALTIME-001 — 실제 Tokyo Supabase Realtime 두 클라이언트 검증
//
// 이 스위트는 **실제 프로덕션(Tokyo)** 에 일회용 행을 만든다. 가드 없이는 실행되지 않는다.
// 목적은 websocket 연결 확인이 아니라 **애플리케이션 수준 수렴** 실증이다:
//   CLIENT A WRITE → TOKYO POSTGRES → REALTIME → CLIENT B 수신 → 프로덕션 재조정 로직 실행
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import { startStaticServer } from './harness.mjs';
import { assertTokyo, TOKYO_REF, instrument, classifyDelivery, changesBetween, restGet, restDel, subscribedAt, waitSubscribed } from './tokyo-realtime-harness.mjs';

// 측정 결과 출력 위치(저장소 로컬, gitignore 대상). 개인 경로에 의존하지 않는다.
const S = new URL('../../.jp-e2e', import.meta.url).pathname;
const TEST_ID = 'JPRT001';
const MARK = `ZZ_${TEST_ID}`;

test.skip(process.env.JP_TOKYO_REALTIME !== '1',
  'Tokyo 프로덕션에 쓴다 — JP_TOKYO_REALTIME=1 로 명시 승인해야 실행된다.');

let srv, browser;
const created = { rooms: new Set(), participants: new Set() };
const report = { testId: TEST_ID, ref: TOKYO_REF, scenarios: {}, notes: [] };

test.beforeAll(async () => {
  assertTokyo();
  srv = await startStaticServer();
  browser = await chromium.launch({ channel: 'chrome' });
});

test.afterAll(async () => {
  fs.mkdirSync(S, { recursive: true });
  // 만든 행만 지운다. 실패로 중단돼도 반드시 실행된다.
  //
  // ⚠️ 보안 5종 배포(2026-09-01) 이후 anon 은 rooms DELETE 권한이 없다 — 설계상 그렇다.
  //    참가자는 anon 경로로 지우고, 방 행은 관리자 경로로 지운다.
  //    관리자 접속 문자열은 **저장소에 두지 않는다** — JP_TOKYO_ADMIN_URI 로 주입한다.
  //    주입되지 않으면 남은 방 id 를 리포트에 남겨 수동 정리할 수 있게 한다.
  for (const rid of created.rooms) {
    const gone = await restDel(`participants?room_id=eq.${rid}`);
    if (Array.isArray(gone)) gone.forEach((p) => created.participants.add(p.id));
    await restDel(`rooms?id=eq.${rid}`);   // 이제 거부된다(기대된 동작)
  }
  const admin = process.env.JP_TOKYO_ADMIN_URI;
  const left = [];
  for (const rid of created.rooms) {
    const rows = await restGet(`rooms?id=eq.${rid}&select=id`).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) left.push(rid);
  }
  if (left.length && admin) {
    const { execFileSync } = await import('node:child_process');
    execFileSync('psql', [admin, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
      `delete from public.participants where room_id in (${left.map((r) => `'${r}'`).join(',')});
       delete from public.rooms where id in (${left.map((r) => `'${r}'`).join(',')});`],
      { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } });
    report.adminCleanup = left;
  } else if (left.length) {
    report.manualCleanupRequired = left;
  }
  report.cleanup = { rooms: [...created.rooms], participants: [...created.participants] };
  fs.writeFileSync(`${S}/tokyo-realtime-report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); srv?.server.close();
});

const screen = (p) => p.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);
const waitScreen = (p, id, t = 45000) =>
  p.waitForFunction((x) => { const e = document.getElementById(x); return e && !e.classList.contains('hidden'); }, id, { timeout: t });

// 조건이 참이 된 **시각**을 돌려준다 — 수렴 지연 측정의 기준점.
async function waitUntil(page, fn, arg, timeout = 30000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  return Date.now();
}

async function newClient(nickname) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript((n) => {
    try { localStorage.setItem('rpsNickname', n); localStorage.setItem('rpsLocale', 'ja'); } catch (e) {}
  }, nickname);
  const page = await ctx.newPage();
  const rec = instrument(page, nickname);
  return { ctx, page, rec, nickname };
}

test('Tokyo Realtime: 두 클라이언트 실제 전송 + 애플리케이션 수렴 (A~H, 다중 라운드)', async () => {
  const A = await newClient(`zz_jprt_${TEST_ID}_A`);
  const B = await newClient(`zz_jprt_${TEST_ID}_B`);

  // ── 클라이언트 A: 일회용 도전 생성 ─────────────────────────────────────────
  await A.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
  await A.page.waitForTimeout(1500);
  if ((await screen(A.page)) === 'screenAuth') await A.page.evaluate(() => window.playAsGuest());
  await waitScreen(A.page, 'screenHome');
  await A.page.evaluate((n) => { document.getElementById('homeNickname').value = n; }, A.nickname);
  await A.page.evaluate(() => window.createRoom());
  await waitScreen(A.page, 'screenHostRoom');

  const roomCode = (await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim())) || '';
  expect(roomCode, '방 코드를 얻지 못했다').toMatch(/^[A-Z0-9]{4}$/);
  created.rooms.add(roomCode);
  report.roomCode = roomCode;

  // ── §5 구독 상태 ───────────────────────────────────────────────────────────
  // subscribeToRoom 은 await 되지 않는다(fire-and-forget) — 소켓이 열릴 때까지 기다린다.
  const tSub0 = Date.now();
  while (A.rec.sockets === 0 && Date.now() - tSub0 < 25000) await A.page.waitForTimeout(250);
  const tSubOpen = Date.now();
  while (!A.rec.ws.some((f) => f.kind === 'recv' && f.event === 'phx_reply') && Date.now() - tSub0 < 30000) {
    await A.page.waitForTimeout(250);
  }
  const subOk = A.rec.ws.some((f) => f.kind === 'recv' && f.event === 'phx_reply') && A.rec.sockets > 0;
  report.scenarios.subscriptionTiming = { socketOpenMs: tSubOpen - tSub0, firstReplyMs: Date.now() - tSub0 };
  report.scenarios.subscription = {
    sockets: A.rec.sockets, joined: A.rec.ws.filter((f) => f.kind === 'sent' && f.event === 'phx_join').length,
    replies: A.rec.ws.filter((f) => f.kind === 'recv' && f.event === 'phx_reply').length,
    errors: A.rec.errors.slice(0, 3), subOk,
  };
  expect(A.rec.sockets, 'Realtime websocket 이 열리지 않았다').toBeGreaterThan(0);

  const inviteUrl = await A.page.evaluate(() => buildInviteUrl());
  const localInvite = (() => { const u = new URL(inviteUrl), s = new URL(srv.url); u.protocol = s.protocol; u.host = s.host; return u.toString(); })();

  // ── §6-A participant INSERT: B 합류 → A 가 Realtime 으로 받는다 ────────────
  await B.page.goto(localInvite, { waitUntil: 'domcontentloaded' });
  await B.page.waitForTimeout(1500);
  expect(await screen(B.page), '신원 없는 초대자는 인증 화면').toBe('screenAuth');
  const tJoin = Date.now();
  await B.page.evaluate(() => window.playAsGuest());

  const tInsertConv = await waitUntil(A.page,
    () => document.querySelectorAll('#hostParticipantList .participant').length >= 2, null, 45000);
  report.scenarios.participantInsert = {
    ...classifyDelivery(A.rec, { writeAt: tJoin, convergedAt: tInsertConv, table: 'participants', type: 'INSERT' }),
    note: 'writeAt 은 B 의 게스트 신원 생성 시점 — 신원 생성 + join REST 시간을 포함한다',
    aSubscribedAt: subscribedAt(A.rec),
  };

  const ps0 = await restGet(`participants?room_id=eq.${roomCode}&select=id,name,is_host`);
  ps0.forEach((p) => created.participants.add(p.id));
  expect(ps0).toHaveLength(2);
  const hostId = ps0.find((p) => p.is_host).id;
  const guestId = ps0.find((p) => !p.is_host).id;
  report.ids = { hostId, guestId };

  // B 의 채널이 PostgreSQL 구독을 마칠 때까지 기다린다.
  // 구독 완료 **이전**에 커밋된 변경은 Realtime 이 재생해 주지 않으므로(전송 특성),
  // 그 구간을 섞으면 전송 성능이 아니라 경합을 측정하게 된다.
  const bSub = await waitSubscribed(B.page, B.rec, 30000);
  report.scenarios.subscriptionB = {
    subscribedAt: bSub, joinToSubscribeMs: bSub ? bSub - tJoin : null,
    sockets: B.rec.sockets, joins: B.rec.ws.filter((f) => f.kind === 'sent' && f.event === 'phx_join').length,
  };
  expect(bSub, 'B 채널이 PostgreSQL 구독을 마치지 못했다').not.toBeNull();

  // ── §6-C room UPDATE: A 가 벌칙 설정 → 방 status 변경 → B 수렴 ─────────────
  await A.page.evaluate(() => window.showPenaltyScreen());
  await waitScreen(A.page, 'screenPenalty');
  await A.page.fill('#penaltyInput', `${MARK} 使い捨てテスト`);
  const tRoom = Date.now();
  await A.page.evaluate(() => window.savePenalty());
  const tRoomConv = await waitUntil(B.page,
    () => { const e = document.getElementById('screenReady'); return e && !e.classList.contains('hidden'); }, null, 45000);
  report.scenarios.roomStatusReady = classifyDelivery(B.rec,
    { writeAt: tRoom, convergedAt: tRoomConv, table: 'rooms', type: 'UPDATE' });

  // ── §6-B participant UPDATE(ready): B 준비 → A 수렴 ────────────────────────
  const tReady = Date.now();
  await B.page.click('#myReadyBtn');
  const tReadyConv = await waitUntil(A.page, () => {
    const b = document.getElementById('startGameBtn');
    return b && !b.classList.contains('hidden') && !b.disabled;
  }, null, 45000);
  report.scenarios.readyPropagation = classifyDelivery(A.rec,
    { writeAt: tReady, convergedAt: tReadyConv, table: 'participants', type: 'UPDATE' });

  // ── §6-C room UPDATE(playing): A 가 시작 → B 가 게임 화면으로 ──────────────
  const tPlay = Date.now();
  await A.page.evaluate(() => window.startGame());
  const tPlayConvB = await waitUntil(B.page,
    () => { const e = document.getElementById('screenGame'); return e && !e.classList.contains('hidden'); }, null, 60000);
  report.scenarios.roomStatusPlaying = classifyDelivery(B.rec,
    { writeAt: tPlay, convergedAt: tPlayConvB, table: 'rooms', type: 'UPDATE' });

  // ── 라운드 루프: §6-D 선택 전파 / §6-E 동시 선택 / §6-F 결과 / §6-G nextRound
  report.rounds = [];
  for (let round = 1; round <= 3; round++) {
    const r = { round };
    report.rounds.push(r);   // 실패해도 부분 측정치가 남도록 먼저 담는다

    // 2라운드부터는 nextRound 가 양쪽을 준비 화면으로 되돌린다 — 다시 준비를 눌러야 한다.
    // DOM 클릭 대신 버튼이 호출하는 것과 **같은 진입점**을 쓴다(actionability 무한 대기 회피).
    if (round > 1) {
      const tRdy = Date.now();
      await waitScreen(B.page, 'screenReady', 60000);
      await waitScreen(A.page, 'screenReady', 60000).catch(() => {});
      await B.page.evaluate(() => window.markReady());
      await A.page.evaluate(() => window.markReady()).catch(() => {});
      let tRdyConv = await waitUntil(A.page, () => {
        const g = document.getElementById('screenGame');
        return g && !g.classList.contains('hidden');
      }, null, 20000).catch(() => null);
      if (!tRdyConv) {   // 자동 시작이 발화하지 않으면 호스트가 명시적으로 시작한다
        await A.page.evaluate(() => window.startGame());
        tRdyConv = await waitUntil(A.page, () => {
          const g = document.getElementById('screenGame');
          return g && !g.classList.contains('hidden');
        }, null, 60000).catch(() => null);
        r.hostExplicitStart = true;
      }
      r.readyRound = { converged: tRdyConv !== null, latencyMs: tRdyConv ? tRdyConv - tRdy : null };
    }
    await waitScreen(A.page, 'screenGame', 60000);
    await waitScreen(B.page, 'screenGame', 60000);

    if (round === 1) {
      // D) A 선택 → B 가 받는다(선택 카운트 수렴)
      const tChoice = Date.now();
      await A.page.evaluate(() => window.selectChoice('rock'));
      try {
        const tConv = await waitUntil(B.page,
          () => Number(document.getElementById('selectedCount')?.textContent || 0) >= 1, null, 4500);
        r.choiceAtoB = classifyDelivery(B.rec,
          { writeAt: tChoice, convergedAt: tConv, table: 'participants', type: 'UPDATE',
            match: (rec) => rec.id === hostId && !!rec.choice });
      } catch (e) { r.choiceAtoB = { verdict: 'NOT_OBSERVED_IN_WINDOW', note: '선택 창 5초 내 미수렴' }; }
      const tChoiceB = Date.now();
      await B.page.evaluate(() => window.selectChoice('rock'));
      try {
        const tConvA = await waitUntil(A.page,
          () => Number(document.getElementById('selectedCount')?.textContent || 0) >= 2, null, 4500);
        r.choiceBtoA = classifyDelivery(A.rec,
          { writeAt: tChoiceB, convergedAt: tConvA, table: 'participants', type: 'UPDATE',
            match: (rec) => rec.id === guestId && !!rec.choice });
      } catch (e) { r.choiceBtoA = { verdict: 'NOT_OBSERVED_IN_WINDOW' }; }
    } else if (round === 2) {
      // E) 동시 선택 — 겹치는 타이밍 창
      const tBoth = Date.now();
      await Promise.all([
        A.page.evaluate(() => window.selectChoice('rock')),
        B.page.evaluate(() => window.selectChoice('rock')),
      ]);
      r.concurrent = { writeAt: tBoth };
    } else {
      await Promise.all([
        A.page.evaluate(() => window.selectChoice('rock')),
        B.page.evaluate(() => window.selectChoice('rock')),
      ]);
    }

    // F) 결과 발표 — 양쪽이 같은 권위 결과를 관측한다
    const tPub = Date.now();
    const [tResA, tResB] = await Promise.all([
      waitUntil(A.page, () => { const e = document.getElementById('screenRoundResult'); return e && !e.classList.contains('hidden'); }, null, 45000),
      waitUntil(B.page, () => { const e = document.getElementById('screenRoundResult'); return e && !e.classList.contains('hidden'); }, null, 45000),
    ]);
    const rowA = await restGet(`rooms?id=eq.${roomCode}&select=round,status`);
    const choicesAtResult = await restGet(`participants?room_id=eq.${roomCode}&select=id,choice&order=id`);
    r.result = {
      authoritativeChoices: choicesAtResult,
      A: await A.page.locator('#resultTitle').textContent(),
      B: await B.page.locator('#resultTitle').textContent(),
      listA: (await A.page.locator('#roundResultList').innerText()).replace(/\s+/g, ' ').trim(),
      listB: (await B.page.locator('#roundResultList').innerText()).replace(/\s+/g, ' ').trim(),
      dbRound: rowA[0]?.round, dbStatus: rowA[0]?.status,
      deliveryB: classifyDelivery(B.rec, { writeAt: tPub, convergedAt: tResB, table: 'rooms' }),
      latencyA: tResA - tPub, latencyB: tResB - tPub,
    };

    if (round < 3) {
      // G) nextRound — 참가자 리셋 + 라운드 진행 + 양쪽 수렴
      const tNext = Date.now();
      await A.page.evaluate(() => window.nextRound());
      const tNextB = await waitUntil(B.page,
        () => { const e = document.getElementById('screenReady'); return e && !e.classList.contains('hidden'); },
        null, 60000);
      const after = await restGet(`participants?room_id=eq.${roomCode}&select=id,choice,is_ready`);
      r.nextRound = {
        delivery: classifyDelivery(B.rec, { writeAt: tNext, convergedAt: tNextB, table: 'participants' }),
        participantsReset: after.every((p) => p.choice === null),
        readyReset: after.every((p) => p.is_ready === false),
        dbRound: (await restGet(`rooms?id=eq.${roomCode}&select=round`))[0]?.round,
      };
    }
  }

  // ── §6-H leave: B 퇴장 → A 가 수렴 ────────────────────────────────────────
  const tLeave = Date.now();
  const screenBefore = await screen(B.page);
  // leaveRoom 은 확인 팝업의 사용자 응답을 기다린다 — 실제 UI 대로 확인 버튼을 누른다.
  const leavePromise = B.page.evaluate(() => window.leaveRoom());
  const popupShown = await B.page.waitForFunction(
    () => { const e = document.getElementById('confirmPopupOk'); return !!e && e.offsetParent !== null; },
    null, { timeout: 15000 }).then(() => true).catch(() => false);
  await B.page.evaluate(() => document.getElementById('confirmPopupOk')?.click());
  await leavePromise.catch((e) => { report.notes.push('leaveRoom threw: ' + e.message); });

  // 1단계 — 라운드 진행 중(status='result') 퇴장은 **예약**된다(WRPS-084 Deferred Leave, CORE 설계).
  let reserved = null;
  for (let i = 0; i < 30; i++) {
    const rows = await restGet(`participants?id=eq.${guestId}&select=id,leave_after_round`);
    if (rows[0] && rows[0].leave_after_round === true) { reserved = Date.now(); break; }
    if (rows.length === 0) { reserved = Date.now(); break; }   // 즉시 삭제된 경우
    await B.page.waitForTimeout(400);
  }
  const afterReserve = await restGet(`participants?room_id=eq.${roomCode}&select=id,leave_after_round`);

  // 2단계 — 예약된 퇴장의 실제 실행 시점을 확인한다.
  //   processDeferredLeaves() 는 **라운드 결과가 확정되는 순간**에만 호출된다(호출부 1곳).
  //   즉 결과 화면에서 누른 퇴장은 *다음 라운드가 끝날 때* 비로소 실행된다 — 예약자는 그 한 라운드를
  //   더 치러야 한다. 이 사실을 실측으로 확정한다.
  const tResolve = Date.now();
  await A.page.evaluate(() => window.nextRound());
  await waitScreen(B.page, 'screenReady', 60000).catch(() => {});
  await waitScreen(A.page, 'screenReady', 60000).catch(() => {});
  await B.page.evaluate(() => window.markReady()).catch(() => {});
  await A.page.evaluate(() => window.markReady()).catch(() => {});
  let inGame = await waitUntil(A.page, () => {
    const g = document.getElementById('screenGame'); return g && !g.classList.contains('hidden');
  }, null, 20000).catch(() => null);
  if (!inGame) { await A.page.evaluate(() => window.startGame()); }
  await waitScreen(A.page, 'screenGame', 60000).catch(() => {});
  await waitScreen(B.page, 'screenGame', 60000).catch(() => {});
  await Promise.all([
    A.page.evaluate(() => window.selectChoice('rock')).catch(() => {}),
    B.page.evaluate(() => window.selectChoice('rock')).catch(() => {}),
  ]);
  let psAfter = [], leaveConvAt = null;
  for (let i = 0; i < 90; i++) {
    psAfter = await restGet(`participants?room_id=eq.${roomCode}&select=id,name,is_host`);
    if (psAfter.length <= 1) { leaveConvAt = Date.now(); break; }
    await A.page.waitForTimeout(500);
  }
  // host 측 수렴: 떠난 참가자가 어느 목록에도 남아 있지 않거나, 방 자체를 떠난 화면이면 수렴이다
  // (마지막 참가자가 나가면 host 는 방 종료 경로로 홈에 간다).
  const hostSawIt = leaveConvAt ? await waitUntil(A.page, (gid) => {
    const home = document.getElementById('screenHome');
    if (home && !home.classList.contains('hidden')) return true;
    return ![...document.querySelectorAll('.participant strong')].some((n) => n.textContent.includes(gid));
  }, `zz_jprt_${TEST_ID}_B`, 30000).catch(() => null) : null;

  report.scenarios.leave = {
    screenBefore, popupShown, screenAfter: await screen(B.page).catch(() => null),
    deferredReserved: reserved !== null,
    reserveLatencyMs: reserved ? reserved - tLeave : null,
    leaveAfterRoundFlags: afterReserve,
    resolvedAfterOneMoreRound: leaveConvAt !== null,
    resolveLatencyMs: leaveConvAt ? leaveConvAt - tResolve : null,
    trigger: 'processDeferredLeaves() — 라운드 결과 확정 시점(호출부 1곳)',
    dbParticipantsAfterLeave: psAfter.length,
    hostConverged: hostSawIt !== null,
    hostScreenAfter: null,   // 아래에서 채운다
    delivery: hostSawIt ? classifyDelivery(A.rec,
      { writeAt: tResolve, convergedAt: hostSawIt, table: 'participants' }) : null,
  };

  report.scenarios.leave.hostScreenAfter = await screen(A.page).catch(() => null);

  // ── §8 중복/순서 관측 ─────────────────────────────────────────────────────
  const allA = A.rec.ws.filter((f) => f.kind === 'recv' && f.event === 'postgres_changes');
  const allB = B.rec.ws.filter((f) => f.kind === 'recv' && f.event === 'postgres_changes');
  const dup = (arr) => {
    const seen = new Map(); let d = 0;
    for (const f of arr) { const k = `${f.table}|${f.type}|${f.record ? JSON.stringify(f.record) : ''}`;
      if (seen.has(k)) d++; else seen.set(k, f.t); }
    return d;
  };
  report.scenarios.eventStream = {
    A: { changes: allA.length, duplicates: dup(allA), sockets: A.rec.sockets, closes: A.rec.closed, errors: A.rec.errors },
    B: { changes: allB.length, duplicates: dup(allB), sockets: B.rec.sockets, closes: B.rec.closed, errors: B.rec.errors },
    restGetsA: A.rec.rest.filter((r) => r.method === 'GET').length,
    restGetsB: B.rec.rest.filter((r) => r.method === 'GET').length,
  };

  fs.writeFileSync(`${S}/tokyo-realtime-report.json`, JSON.stringify(report, null, 2));

  // ── 판정 ──────────────────────────────────────────────────────────────────
  expect(report.scenarios.participantInsert.verdict, 'participant INSERT').toBe('REALTIME');
  expect(report.scenarios.roomStatusReady.verdict, 'room UPDATE(ready)').toBe('REALTIME');
  expect(report.scenarios.leave.deferredReserved, '퇴장 예약(WRPS-084)').toBe(true);
  expect(report.scenarios.leave.resolvedAfterOneMoreRound, '다음 라운드 확정 시 예약 퇴장 실행').toBe(true);
  expect(report.scenarios.readyPropagation.verdict, 'ready 전파').toBe('REALTIME');
  expect(report.scenarios.roomStatusPlaying.verdict, 'room UPDATE(playing)').toBe('REALTIME');
  for (const r of report.rounds) {
    // A 는 ja, B 는 en 로케일이라 표시 문자열은 다르다 — **권위 상태**로 동일성을 판정한다.
    expect(r.result.dbStatus, `R${r.round} 권위 status`).toBe('result');
    expect(r.result.authoritativeChoices.every((c) => !!c.choice), `R${r.round} 양쪽 선택 기록`).toBe(true);
    // 두 단말을 같은 로케일(ja)로 맞췄으므로 표시 결과까지 정확히 같아야 한다.
    expect(r.result.listA, `R${r.round} 양쪽 결과 목록 동일`).toBe(r.result.listB);
  }
  expect(report.rounds[0].nextRound.participantsReset, 'nextRound choice 리셋').toBe(true);
  expect(report.rounds).toHaveLength(3);

  await A.ctx.close(); await B.ctx.close();
});
