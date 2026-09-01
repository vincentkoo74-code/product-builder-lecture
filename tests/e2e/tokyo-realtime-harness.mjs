// JP-TOKYO-REALTIME-001 — 실제 Tokyo Supabase Realtime 검증 하니스
//
// 원칙:
//  - 프로덕션 소스(index.html)를 수정하지 않는다. 앱은 자신의 상수(Tokyo)로 그대로 접속한다.
//  - REST/Realtime 을 가로채지 않는다 — **실제 Tokyo 전송을 검증하는 것이 목적**이다.
//  - 일회용 행만 만들고, 만든 행만 지운다. 과거 프로덕션 행은 읽지도 쓰지도 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pick = (name) => (html.match(new RegExp(`const ${name} = "([^"]+)"`)) || [])[1];

export const SUPABASE_URL = pick('SUPABASE_URL');
const ANON = pick('SUPABASE_ANON_KEY');
export const TOKYO_REF = (SUPABASE_URL || '').replace(/^https:\/\//, '').split('.')[0];
export const REST = `${SUPABASE_URL}/rest/v1`;

// 리전 안전장치: Tokyo 가 아니면 아무것도 하지 않는다.
export function assertTokyo() {
  if (TOKYO_REF !== 'cmfxhehpreanijwanwrr') {
    throw new Error(`리전 안전 중단: JP 백엔드가 아니다 (ref=${TOKYO_REF})`);
  }
}

const h = { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };
export const restGet = (p) => fetch(`${REST}/${p}`, { headers: h }).then((r) => r.json());
export const restDel = (p) => fetch(`${REST}/${p}`, { method: 'DELETE', headers: { ...h, Prefer: 'return=representation' } })
  .then((r) => r.json()).catch(() => []);

// Phoenix 프레임 디코더.
// ⚠️ supabase-js v2 는 **vsn=2.0.0** 을 쓴다 — 프레임이 객체가 아니라
//    [join_ref, ref, topic, event, payload] **배열**이다. v1(객체) 형식도 함께 받는다.
//    이 구분을 놓치면 모든 Realtime 도달이 "미도달"로 오판된다(실제로 한 번 그랬다).
function decode(payload) {
  let m = null;
  try { m = JSON.parse(String(payload)); } catch (e) { return null; }
  if (Array.isArray(m)) {
    const [, , topic, event, p] = m;
    return { topic: topic || null, event: event || null, payload: p || null };
  }
  return { topic: m.topic || null, event: m.event || null, payload: m.payload || null };
}

// ── 전송 계층 계측 ────────────────────────────────────────────────────────────
// Realtime 도달을 **WebSocket 프레임**으로 직접 관측하고, 폴링/재조회를 REST 요청으로 센다.
// 이렇게 해야 "Realtime 이 왔는가" 와 "폴링이 구해줬는가" 를 구분할 수 있다.
export function instrument(page, label) {
  const rec = { label, ws: [], rest: [], sockets: 0, closed: 0, errors: [], t0: Date.now() };
  page.on('websocket', (ws) => {
    rec.sockets++;
    rec.ws.push({ t: Date.now(), kind: 'open', url: ws.url() });
    ws.on('socketerror', (e) => { rec.errors.push(String(e)); rec.ws.push({ t: Date.now(), kind: 'error', raw: String(e) }); });
    ws.on('close', () => { rec.closed++; rec.ws.push({ t: Date.now(), kind: 'close' }); });
    ws.on('framereceived', ({ payload }) => {
      const m = decode(payload);
      if (!m) return;
      const d = m.payload && m.payload.data ? m.payload.data : null;
      rec.ws.push({
        t: Date.now(), kind: 'recv', event: m.event, topic: m.topic,
        table: d ? d.table : null, type: d ? d.type : null,
        record: d && d.record ? d.record : null,
        status: m.payload && m.payload.status ? m.payload.status : null,
        message: m.payload && m.payload.message ? m.payload.message : null,
      });
    });
    ws.on('framesent', ({ payload }) => {
      const m = decode(payload);
      if (!m) return;
      rec.ws.push({ t: Date.now(), kind: 'sent', event: m.event, topic: m.topic });
    });
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(REST)) rec.rest.push({ t: Date.now(), method: r.method(), path: u.slice(REST.length).split('&')[0] });
  });
  page.on('pageerror', (e) => rec.errors.push('pageerror: ' + e.message));
  return rec;
}

// t 이후 도착한 postgres_changes 프레임 중 조건에 맞는 첫 프레임.
export const firstChange = (rec, { after, table, type = null, match = null }) =>
  rec.ws.find((f) => f.kind === 'recv' && f.event === 'postgres_changes' && f.t >= after
    && f.table === table && (!type || f.type === type)
    && (!match || (f.record && match(f.record)))) || null;

export const changesBetween = (rec, a, b, table) =>
  rec.ws.filter((f) => f.kind === 'recv' && f.event === 'postgres_changes' && f.t >= a && f.t <= b && f.table === table);

export const restBetween = (rec, a, b, needle) =>
  rec.rest.filter((r) => r.t >= a && r.t <= b && r.path.includes(needle));

// 폴링 판정: 수렴 시점까지 매칭 Realtime 프레임이 없었으면 폴링 구제다.
export function classifyDelivery(rec, { writeAt, convergedAt, table, type = null, match = null }) {
  const from = writeAt - 250, to = convergedAt + 250;
  const exact = firstChange(rec, { after: from, table, type, match });
  // 정확 매칭이 없어도, 재조정을 촉발하는 다른 postgres_changes(예: rooms 갱신)가
  // 창 안에 도착했다면 그것도 Realtime 도달이다 — 어느 경로로 왔는지 함께 기록한다.
  const anyFrame = rec.ws.find((f) => f.kind === 'recv' && f.event === 'postgres_changes'
    && f.t >= from && f.t <= to) || null;
  const frame = (exact && exact.t <= to) ? exact : anyFrame;
  const viaRealtime = !!frame;
  return {
    viaRealtime,
    via: exact && exact.t <= to ? `${table}.${type || '*'}` : (frame ? `${frame.table}.${frame.type}` : null),
    exactMatch: !!(exact && exact.t <= to),
    realtimeLatencyMs: frame ? frame.t - writeAt : null,
    convergeLatencyMs: convergedAt - writeAt,
    // 폴링 주기(2600ms)보다 빠르게 수렴했다면 폴링으로는 설명할 수 없다 — 독립 방증.
    fasterThanPollInterval: (convergedAt - writeAt) < 2600,
    pollGets: restBetween(rec, writeAt, convergedAt, table).filter((r) => r.method === 'GET').length,
    verdict: viaRealtime ? 'REALTIME' : 'POLLING_RESCUE',
  };
}

// 채널이 실제로 PostgreSQL 구독까지 마친 시각. 이 시각 **이전**에 커밋된 변경은
// Realtime 이 재생해 주지 않는다 — 그 구간은 폴링이 안전망이다(전송 특성, 결함 아님).
export function subscribedAt(rec) {
  const f = rec.ws.find((x) => x.kind === 'recv' && x.event === 'system'
    && typeof x.message === 'string' && x.message.includes('Subscribed to PostgreSQL'));
  return f ? f.t : null;
}
export async function waitSubscribed(page, rec, timeout = 25000) {
  const t0 = Date.now();
  while (subscribedAt(rec) === null && Date.now() - t0 < timeout) await page.waitForTimeout(200);
  return subscribedAt(rec);
}
