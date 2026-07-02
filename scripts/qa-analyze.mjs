// scripts/qa-analyze.mjs — Device QA Metrics Analyzer (WES v2 Sprint)
// build14 QA 계측 로그(window.__qaMetrics.copyText() 또는 [QA-METRIC] 레코드 배열)를 입력받아
// Sprint "QA 종료 후 자동 계산" 지표를 산출하고 Release Gate를 평가한다.
// 게임/앱 무변경 — 순수 분석 도구. Evidence 기반 의사결정만.
//
// 사용:  node scripts/qa-analyze.mjs <metrics.json>   (또는 stdin 파이프)
//   metrics.json = { summary?, recent: [...] }  또는  [ {QA record}, ... ]

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const max = (a) => (a.length ? Math.max(...a) : null);
// p: 0~100 백분위(선형 보간 없이 nearest-rank).
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function analyzeQAMetrics(input) {
  const recent = Array.isArray(input) ? input : (input && Array.isArray(input.recent) ? input.recent : []);
  const pick = (pred, map) => recent.filter(pred).map(map).filter(Number.isFinite);

  const countdownDrift = pick((r) => Number.isFinite(r.countdownDriftMs), (r) => Math.abs(r.countdownDriftMs));
  const genericDrift = pick((r) => Number.isFinite(r.driftMs), (r) => Math.abs(r.driftMs));
  const offsets = recent.filter((r) => r.eventType === 'CLOCK_SYNC' && Number.isFinite(r.offsetMs)).map((r) => r.offsetMs);
  const audioDelay = pick((r) => Number.isFinite(r.audioDelayMs), (r) => r.audioDelayMs);
  const audioDup = recent.filter((r) => r.audioDuplicated).length;
  const audioMissing = recent.filter((r) => r.audioMissing).length;
  const resultRecs = recent.filter((r) => r.eventType === 'ROUND_RESULT' && typeof r.shadowMatch === 'boolean');
  const shadowTotal = resultRecs.length;
  const shadowMatchN = resultRecs.filter((r) => r.shadowMatch).length;
  const orderingMismatch = recent.filter((r) => r.orderingMismatch).length;
  const hostChanged = recent.filter((r) => r.hostChanged).length;
  const stale = recent.filter((r) => r.staleParticipantDetected).length;

  const report = {
    samples: recent.length,
    sessions: [...new Set(recent.map((r) => r.session).filter(Boolean))].length,
    devices: [...new Set(recent.map((r) => r.deviceType).filter(Boolean))],
    countdownDriftAvgMs: avg(countdownDrift),
    countdownDriftMaxMs: max(countdownDrift),
    countdownDriftP95Ms: pct(countdownDrift, 95),
    countdownDriftP99Ms: pct(countdownDrift, 99),
    driftAvgMs: avg(genericDrift),
    driftMaxMs: max(genericDrift),
    clockOffsetMs: offsets.length ? offsets[offsets.length - 1] : null,
    clockOffsetMaxMs: max(offsets.map(Math.abs)),
    audioDelayAvgMs: avg(audioDelay),
    audioDelayMaxMs: max(audioDelay),
    audioDelayP95Ms: pct(audioDelay, 95),
    audioDuplicate: audioDup,
    audioMissing,
    orderingMismatch,
    shadowTotal,
    shadowMatch: shadowMatchN,
    shadowMatchPct: shadowTotal ? Math.round((shadowMatchN / shadowTotal) * 1000) / 10 : null,
    hostChanged,
    staleParticipant: stale,
  };

  const verdict = (cond, hasData) => (!hasData ? 'NO-DATA' : (cond ? 'PASS' : 'FAIL'));
  const hasAny = recent.length > 0;
  const gate = {
    'WRPS-036 countdownDrift avg < 100ms': verdict(report.countdownDriftAvgMs < 100, report.countdownDriftAvgMs != null),
    'WRPS-036 countdownDrift max < 200ms': verdict(report.countdownDriftMaxMs < 200, report.countdownDriftMaxMs != null),
    'WRPS-026 shadow match = 100%': verdict(shadowTotal > 0 && shadowMatchN === shadowTotal, shadowTotal > 0),
    'Ordering mismatch = 0': verdict(orderingMismatch === 0, hasAny),
    'Audio duplication = 0': verdict(audioDup === 0, hasAny),
    'Audio missing = 0': verdict(audioMissing === 0, hasAny),
    'Stale participant = 0': verdict(stale === 0, hasAny),
  };
  const passed = Object.values(gate).filter((v) => v === 'PASS').length;
  const failed = Object.values(gate).filter((v) => v === 'FAIL').length;
  const noData = Object.values(gate).filter((v) => v === 'NO-DATA').length;

  return { report, gate, summary: { passed, failed, noData, gateReady: failed === 0 && noData === 0 } };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const path = process.argv[2];
  const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  const out = analyzeQAMetrics(JSON.parse(raw));
  console.log('=== QA Metrics Report ===');
  console.log(JSON.stringify(out.report, null, 2));
  console.log('=== Release Gate ===');
  for (const [k, v] of Object.entries(out.gate)) console.log(`  [${v}] ${k}`);
  console.log(`=== ${out.summary.passed} PASS / ${out.summary.failed} FAIL / ${out.summary.noData} NO-DATA — gateReady=${out.summary.gateReady} ===`);
}
