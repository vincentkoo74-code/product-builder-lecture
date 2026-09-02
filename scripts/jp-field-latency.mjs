#!/usr/bin/env node
// JP-RC3-FIELD-LATENCY-001 — 실측 지연 데이터셋 수집기
//
// 목적: rc3 지연 레짐을 **근거 기반**으로 재설계하기 위한 실측 표본을 모은다.
// 이 슬라이스는 임계값·레짐·프로덕션 로직을 바꾸지 않는다. 재기만 한다.
//
// 원칙:
//  - REAL 과 SYNTHETIC 을 절대 한 분포에 섞지 않는다(레코드마다 kind 를 붙인다).
//  - REALTIME_FRAME_ARRIVAL(전송)과 APPLICATION_CONVERGENCE(앱 수렴)를 나눠 기록한다.
//  - 폴링이 구해준 경우 순수 Realtime 성공으로 세지 않는다.
//  - Tokyo 에 일회용 행만 만들고 전부 회수한다.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../tests/e2e/harness.mjs';
import { assertTokyo, TOKYO_REF, restGet, restDel, instrument, classifyDelivery, subscribedAt, waitSubscribed }
  from '../tests/e2e/tokyo-realtime-harness.mjs';

if (process.env.JP_TOKYO_REALTIME !== '1') {
  console.error('  Tokyo 프로덕션에 일회용 행을 만든다 — JP_TOKYO_REALTIME=1 로 명시 승인하라.');
  process.exit(2);
}
assertTokyo();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.jp-e2e');
const OUT = path.join(OUT_DIR, 'field-latency.jsonl');
const ITERS = Number(process.env.FIELD_ITERS || 12);
const NETWORK_ID = process.env.FIELD_NETWORK_ID || 'unlabeled';
const KIND = process.env.FIELD_KIND || 'REAL';               // REAL | SYNTHETIC
const THROTTLE = process.env.FIELD_THROTTLE_MS ? Number(process.env.FIELD_THROTTLE_MS) : 0;
const TEST_ID = 'JPFL';

fs.mkdirSync(OUT_DIR, { recursive: true });
const rec = (o) => fs.appendFileSync(OUT, JSON.stringify({ kind: KIND, networkId: NETWORK_ID,
  throttleMs: THROTTLE, ts: new Date().toISOString(), ...o }) + '\n');

const srv = await startStaticServer();
const browser = await chromium.launch({ channel: 'chrome' });
const createdRooms = new Set();
const visibleScreen = (p) => p.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);
const waitScreen = (p, id, t = 60000) =>
  p.waitForFunction((x) => { const e = document.getElementById(x); return e && !e.classList.contains('hidden'); }, id, { timeout: t });
async function waitUntil(page, fn, arg, timeout = 60000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 50 });
  return Date.now();
}
async function client(nick) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript((n) => { try { localStorage.setItem('rpsNickname', n); localStorage.setItem('rpsLocale', 'ja'); } catch (e) {} }, nick);
  const page = await ctx.newPage();
  // SYNTHETIC: CDP 로 추가 지연을 건다. REAL 실행에서는 절대 켜지 않는다.
  if (THROTTLE > 0) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: THROTTLE, downloadThroughput: -1, uploadThroughput: -1,
    });
  }
  return { ctx, page, rec: instrument(page, nick) };
}
const local = (u) => { const a = new URL(u), b = new URL(srv.url); a.protocol = b.protocol; a.host = b.host; return a.toString(); };

// 관측 1건 기록: 전송 도달(frame)과 앱 수렴(convergence)을 분리한다.
function observe(iter, metric, recv, writeAt, convergedAt, opts) {
  const d = classifyDelivery(recv, { writeAt, convergedAt, ...opts });
  rec({
    iter, metric,
    realtimeFrameArrivalMs: d.realtimeLatencyMs,
    applicationConvergenceMs: d.convergeLatencyMs,
    delivery: d.verdict, via: d.via, exactMatch: d.exactMatch,
    pollGets: d.pollGets, fasterThanPollInterval: d.fasterThanPollInterval,
  });
  return d;
}

let ok = 0, failed = 0;
for (let iter = 1; iter <= ITERS; iter++) {
  let A, B, roomCode = null;
  try {
    A = await client(`zz_${TEST_ID}_A`);
    B = await client(`zz_${TEST_ID}_B`);

    // ── 구독 확립 (A) ─────────────────────────────────────────────────────
    const tBoot = Date.now();
    await A.page.goto(`${srv.url}/index.html?lang=ja`, { waitUntil: 'domcontentloaded' });
    await A.page.waitForTimeout(1200);
    if ((await visibleScreen(A.page)) === 'screenAuth') await A.page.evaluate(() => window.playAsGuest());
    await waitScreen(A.page, 'screenHome');
    const tCreate = Date.now();
    await A.page.evaluate(() => window.createRoom());
    await waitScreen(A.page, 'screenHostRoom');
    roomCode = await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim());
    if (!roomCode) throw new Error('no room code');
    createdRooms.add(roomCode);
    const aSub = await waitSubscribed(A.page, A.rec, 40000);
    rec({ iter, metric: 'subscription_establishment', device: 'A',
          applicationConvergenceMs: aSub ? aSub - tCreate : null,
          socketOpenToSubscribeMs: aSub && A.rec.ws.length ? aSub - A.rec.ws[0].t : null });

    // ── participant INSERT ────────────────────────────────────────────────
    const inviteUrl = await A.page.evaluate(() => buildInviteUrl());
    await B.page.goto(local(inviteUrl), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(1200);
    const tJoin = Date.now();
    await B.page.evaluate(() => window.playAsGuest());
    const tInsert = await waitUntil(A.page,
      () => document.querySelectorAll('#hostParticipantList .participant').length >= 2, null, 60000);
    observe(iter, 'participant_insert', A.rec, tJoin, tInsert, { table: 'participants', type: 'INSERT' });
    const bSub = await waitSubscribed(B.page, B.rec, 40000);
    rec({ iter, metric: 'subscription_establishment', device: 'B',
          applicationConvergenceMs: bSub ? bSub - tJoin : null });

    // ── room status → ready ───────────────────────────────────────────────
    await A.page.evaluate(() => window.showPenaltyScreen());
    await waitScreen(A.page, 'screenPenalty');
    await A.page.fill('#penaltyInput', `ZZ_${TEST_ID}`);
    const tReadyStatus = Date.now();
    await A.page.evaluate(() => window.savePenalty());
    const tReadyConv = await waitUntil(B.page,
      () => { const e = document.getElementById('screenReady'); return e && !e.classList.contains('hidden'); }, null, 60000);
    observe(iter, 'room_status_ready', B.rec, tReadyStatus, tReadyConv, { table: 'rooms', type: 'UPDATE' });

    // ── ready UPDATE ──────────────────────────────────────────────────────
    const tReady = Date.now();
    await B.page.evaluate(() => window.markReady());
    const tReadyGot = await waitUntil(A.page, () => {
      const b = document.getElementById('startGameBtn');
      return b && !b.classList.contains('hidden') && !b.disabled;
    }, null, 60000);
    observe(iter, 'ready_update', A.rec, tReady, tReadyGot, { table: 'participants', type: 'UPDATE' });

    // ── room status → playing ─────────────────────────────────────────────
    const tPlay = Date.now();
    await A.page.evaluate(() => window.startGame());
    const tPlayConv = await waitUntil(B.page,
      () => { const e = document.getElementById('screenGame'); return e && !e.classList.contains('hidden'); }, null, 90000);
    observe(iter, 'room_status_playing', B.rec, tPlay, tPlayConv, { table: 'rooms', type: 'UPDATE' });

    // ── choice A→B, B→A ───────────────────────────────────────────────────
    await waitScreen(A.page, 'screenGame', 60000);
    const ps = await restGet(`participants?room_id=eq.${roomCode}&select=id,is_host`);
    const hostId = ps.find((p) => p.is_host)?.id, guestId = ps.find((p) => !p.is_host)?.id;
    const tCa = Date.now();
    await A.page.evaluate(() => window.selectChoice('rock'));
    try {
      const c1 = await waitUntil(B.page, () => Number(document.getElementById('selectedCount')?.textContent || 0) >= 1, null, 4500);
      observe(iter, 'choice_a_to_b', B.rec, tCa, c1, { table: 'participants', type: 'UPDATE', match: (r) => r.id === hostId && !!r.choice });
    } catch (e) { rec({ iter, metric: 'choice_a_to_b', notObservedInWindow: true }); }
    const tCb = Date.now();
    await B.page.evaluate(() => window.selectChoice('rock'));
    try {
      const c2 = await waitUntil(A.page, () => Number(document.getElementById('selectedCount')?.textContent || 0) >= 2, null, 4500);
      observe(iter, 'choice_b_to_a', A.rec, tCb, c2, { table: 'participants', type: 'UPDATE', match: (r) => r.id === guestId && !!r.choice });
    } catch (e) { rec({ iter, metric: 'choice_b_to_a', notObservedInWindow: true }); }

    // ── result publication ────────────────────────────────────────────────
    const tPub = Date.now();
    const tRes = await waitUntil(B.page,
      () => { const e = document.getElementById('screenRoundResult'); return e && !e.classList.contains('hidden'); }, null, 90000);
    observe(iter, 'result_publication', B.rec, tPub, tRes, { table: 'rooms' });

    // ── nextRound ─────────────────────────────────────────────────────────
    const tNext = Date.now();
    await A.page.evaluate(() => window.nextRound());
    const tNextConv = await waitUntil(B.page,
      () => { const e = document.getElementById('screenReady'); return e && !e.classList.contains('hidden'); }, null, 90000);
    observe(iter, 'next_round', B.rec, tNext, tNextConv, { table: 'participants' });

    // ── 이벤트 스트림 통계(중복/순서/소켓) ────────────────────────────────
    for (const [dev, r] of [['A', A.rec], ['B', B.rec]]) {
      const ch = r.ws.filter((f) => f.kind === 'recv' && f.event === 'postgres_changes');
      const seen = new Map(); let dup = 0, ooo = 0; let lastT = 0;
      for (const f of ch) {
        const k = `${f.table}|${f.type}|${f.record ? JSON.stringify(f.record) : ''}`;
        if (seen.has(k)) dup++; else seen.set(k, f.t);
        if (f.t < lastT) ooo++; lastT = Math.max(lastT, f.t);
      }
      rec({ iter, metric: 'event_stream', device: dev, changes: ch.length, duplicates: dup,
            outOfOrder: ooo, sockets: r.sockets, closes: r.closed, errors: r.errors.length,
            restGets: r.rest.filter((x) => x.method === 'GET').length });
    }
    ok++;
    console.log(`  iter ${iter}/${ITERS} ok (room ${roomCode})`);
  } catch (e) {
    failed++;
    rec({ iter, metric: 'iteration_failure', error: String(e && e.message || e).slice(0, 200), roomCode });
    console.log(`  iter ${iter}/${ITERS} FAILED: ${String(e && e.message || e).slice(0, 100)}`);
  } finally {
    try { await A?.ctx.close(); } catch (e) {}
    try { await B?.ctx.close(); } catch (e) {}
  }
}

// ── 일회용 행 회수 ──────────────────────────────────────────────────────────
const leftovers = [];
for (const r of createdRooms) {
  await restDel(`participants?room_id=eq.${r}`);
  await restDel(`rooms?id=eq.${r}`);
  const rows = await restGet(`rooms?id=eq.${r}&select=id`).catch(() => []);
  if (Array.isArray(rows) && rows.length) leftovers.push(r);
}
const admin = process.env.JP_TOKYO_ADMIN_URI;
if (leftovers.length && admin) {
  const { execFileSync } = await import('node:child_process');
  execFileSync('psql', [admin, '-q', '-c',
    `delete from public.participants where room_id in (${leftovers.map((r) => `'${r}'`).join(',')});
     delete from public.rooms where id in (${leftovers.map((r) => `'${r}'`).join(',')});`],
    { env: { ...process.env, PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}` } });
}
rec({ metric: 'run_summary', iterations: ITERS, ok, failed, rooms: [...createdRooms],
      adminCleanup: leftovers });
console.log(`\n  완료: ok=${ok} failed=${failed}  방 ${createdRooms.size}개 회수  → ${OUT}`);
await browser.close(); srv.server.close(); process.exit(0);
