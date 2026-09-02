#!/usr/bin/env node
// JP-RC3-FIELD-LATENCY-001 — 수집 데이터 분포 산출 (분석 전용)
// REAL 과 SYNTHETIC 을 절대 합치지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.FIELD_FILE || path.join(ROOT, '.jp-e2e', 'field-latency.jsonl');
const rows = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
function stats(vals) {
  const v = vals.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return {
    N: v.length, MIN: v[0], P50: q(v, 0.5), P75: q(v, 0.75), P90: q(v, 0.9),
    P95: q(v, 0.95), P99: q(v, 0.99), MAX: v[v.length - 1],
    MEAN: Math.round(mean), STDDEV: Math.round(sd),
    GT2600: v.filter((x) => x > 2600).length, GT4000: v.filter((x) => x > 4000).length,
    GT6000: v.filter((x) => x > 6000).length, GT9000: v.filter((x) => x > 9000).length,
  };
}
const METRICS = ['subscription_establishment', 'participant_insert', 'room_status_ready', 'ready_update',
  'room_status_playing', 'choice_a_to_b', 'choice_b_to_a', 'result_publication', 'next_round'];

for (const kind of ['REAL', 'SYNTHETIC']) {
  const sub = rows.filter((r) => r.kind === kind);
  if (!sub.length) continue;
  const nets = [...new Set(sub.map((r) => `${r.networkId}${r.throttleMs ? `+${r.throttleMs}ms` : ''}`))];
  for (const net of nets) {
    const rs = sub.filter((r) => `${r.networkId}${r.throttleMs ? `+${r.throttleMs}ms` : ''}` === net);
    console.log(`\n═══ ${kind} / ${net} ═══`);
    let totalObs = 0;
    for (const m of METRICS) {
      const mr = rs.filter((r) => r.metric === m);
      const frame = stats(mr.map((r) => r.realtimeFrameArrivalMs));
      const conv = stats(mr.map((r) => r.applicationConvergenceMs));
      if (!frame && !conv) continue;
      totalObs += (conv ? conv.N : 0);
      const f = (s) => s ? `N=${String(s.N).padStart(3)} min=${String(s.MIN).padStart(5)} p50=${String(s.P50).padStart(5)} p75=${String(s.P75).padStart(5)} p90=${String(s.P90).padStart(5)} p95=${String(s.P95).padStart(5)} p99=${String(s.P99).padStart(5)} max=${String(s.MAX).padStart(6)} mean=${String(s.MEAN).padStart(5)} sd=${String(s.STDDEV).padStart(5)} >2.6s=${s.GT2600} >4s=${s.GT4000} >6s=${s.GT6000} >9s=${s.GT9000}` : '(없음)';
      console.log(`  ${m}`);
      console.log(`    frame  ${f(frame)}`);
      console.log(`    conv   ${f(conv)}`);
    }
    // 전송 판정 / 폴링 구제
    const deliv = rs.filter((r) => r.delivery);
    const rt = deliv.filter((r) => r.delivery === 'REALTIME').length;
    const pr = deliv.filter((r) => r.delivery === 'POLLING_RESCUE').length;
    const nobs = rs.filter((r) => r.notObservedInWindow).length;
    console.log(`  ── 전송: REALTIME=${rt}  POLLING_RESCUE=${pr}  창내미관측=${nobs}  총관측=${totalObs}`);
    const es = rs.filter((r) => r.metric === 'event_stream');
    if (es.length) {
      const sum = (k) => es.reduce((s, r) => s + (r[k] || 0), 0);
      console.log(`  ── 이벤트: changes=${sum('changes')} duplicates=${sum('duplicates')} outOfOrder=${sum('outOfOrder')} closes=${sum('closes')} errors=${sum('errors')} restGets=${sum('restGets')}`);
    }
    const fails = rs.filter((r) => r.metric === 'iteration_failure');
    if (fails.length) console.log(`  ── 실패 iteration: ${fails.length} — ${fails.map((f) => f.error?.slice(0, 60)).join(' | ')}`);
  }
}
// 레짐 적합도 — REAL 만 대상
const real = rows.filter((r) => r.kind === 'REAL' && typeof r.realtimeFrameArrivalMs === 'number' && r.realtimeFrameArrivalMs >= 0);
const fv = real.map((r) => r.realtimeFrameArrivalMs).sort((a, b) => a - b);
if (fv.length) {
  console.log(`\n═══ 레짐 적합도 (REAL frame arrival, N=${fv.length}) ═══`);
  const REG = {
    optimistic: { body: [50, 350], mid: [350, 900], tail: [900, 2000] },
    moderate: { body: [120, 800], mid: [800, 2200], tail: [2200, 4500] },
    pessimistic: { body: [200, 1400], mid: [1500, 4000], tail: [4000, 9000] },
  };
  for (const [name, r] of Object.entries(REG)) {
    const hi = r.tail[1];
    const inside = fv.filter((x) => x <= hi).length;
    const outside = fv.filter((x) => x > hi).length;
    const inTail = fv.filter((x) => x >= r.tail[0] && x <= r.tail[1]).length;
    console.log(`  ${name.padEnd(12)} 상한=${String(hi).padStart(4)}ms  REAL_COVERAGE=${(inside / fv.length * 100).toFixed(1)}%  OUTSIDE=${outside}건  꼬리구간 실측=${inTail}건 (${(inTail / fv.length * 100).toFixed(1)}%)`);
  }
  console.log(`  실측 요약: min=${fv[0]} p50=${q(fv, 0.5)} p90=${q(fv, 0.9)} p95=${q(fv, 0.95)} p99=${q(fv, 0.99)} max=${fv[fv.length - 1]}`);
}
