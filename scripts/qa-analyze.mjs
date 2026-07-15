// scripts/qa-analyze.mjs — Device QA Metrics Analyzer (WES v2 Sprint)
// build14 QA 계측 로그(window.__qaMetrics.copyText() 또는 [QA-METRIC] 레코드 배열)를 입력받아
// Sprint "QA 종료 후 자동 계산" 지표를 산출하고 Release Gate를 평가한다.
// 게임/앱 무변경 — 순수 분석 도구. Evidence 기반 의사결정만.
//
// 사용:  node scripts/qa-analyze.mjs <metrics.json>   (또는 stdin 파이프)
//   metrics.json = { summary?, recent: [...] } / [ {QA record}, ... ] /
//   qa-report.v1 실제 export 파일({ qaMetrics: { recent: [...] }, previousSession: {...} })
//
// Build23: 실측 필드QA(Build22)에서 QA💾로 저장한 실제 qa-report-buildNN-*.json 파일을 이
// 분석기에 넣으면 recent가 top-level이 아니라 qaMetrics.recent에 중첩되어 있어(buildReport()
// 스키마) 이 함수가 늘 빈 배열로 읽고 있었다(report.samples=0, 모든 게이트 NO-DATA로 보였을
// 것 — CEO가 "QA export에 실제 게임 로그가 거의 없다"고 관찰한 현상의 실제 원인).
// scripts/analyze-qa-sync.mjs는 이미 qaMetrics.recent를 올바르게 읽고 있었으므로 동일 패턴을
// 재사용한다. 추가로 previousSession(직전 세션, 앱 재시작 시 복구)의 qaMetrics.recent도 함께
// 병합해, background/재시작 직후 export해도 직전 게임의 실제 이벤트가 분석에서 누락되지 않게 한다.
function extractRecent(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (obj.qaMetrics && Array.isArray(obj.qaMetrics.recent)) return obj.qaMetrics.recent;
  if (Array.isArray(obj.recent)) return obj.recent;
  if (Array.isArray(obj.records)) return obj.records;
  return [];
}

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const max = (a) => (a.length ? Math.max(...a) : null);
// p: 0~100 백분위(선형 보간 없이 nearest-rank).
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function analyzeQAMetrics(input) {
  const current = extractRecent(input);
  const previous = (input && !Array.isArray(input) && input.previousSession) ? extractRecent(input.previousSession) : [];
  const recent = previous.length ? [...previous, ...current] : current;
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
  // Build22-D: recent[]가 300개로 잘려도 이 CLI 분석기는 merge된(qa-merge.mjs) 전체 recent[]를
  // 입력받을 수 있으므로, Build22 인수기준 3항목을 여기서도 직접 집계해 in-app summary()와
  // 이중으로 확인 가능하게 한다.
  const countdownServerTsZero = recent.filter((r) => r.eventType === 'INVALID_COUNTDOWN_SERVER_TS').length;
  // resultValue 키 자체가 없는(구버전 fixture 등) 레코드는 "null로 기록됨"이 아니라 "추적 안 함"이므로
  // 제외 — 실제로 키가 있고 값이 null인 경우만(WRPS-026 정상 emit은 항상 resultValue 키를 포함).
  const resultValueNull = recent.filter((r) => r.eventType === 'ROUND_RESULT' && Object.prototype.hasOwnProperty.call(r, 'resultValue') && r.resultValue === null).length;
  const syncLateRenderOver1000 = recent.filter((r) => r.eventType === 'SYNC_LATE_RENDER').length;
  // Build22-B/C 가시성: 중복 렌더가 실제로 스킵되고 있는지, GAVE_UP이 발생하는지도 함께 노출.
  const syncRenderDuplicateSkipped = recent.filter((r) => r.eventType === 'SYNC_RENDER_DUPLICATE_SKIPPED').length;
  const taggerSnapshotGaveUp = recent.filter((r) => r.eventType === 'TAGGER_SNAPSHOT_GAVE_UP').length;
  // Build23: '한번더' 부분 재경기 하드블록 가시성 — 실기기에서 실제로 몇 번 노출/차단됐는지.
  const playAgainBlocked = recent.filter((r) => r.eventType === 'PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY').length;
  const playAgainVisibleDuringPartialReplay = recent.filter((r) =>
    r.eventType === 'PLAY_AGAIN_BUTTON_STATE' && r.visible === true && r.reason !== 'complete').length;

  const report = {
    samples: recent.length,
    previousSessionMerged: previous.length,
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
    countdownServerTsZeroCount: countdownServerTsZero,
    resultValueNullCount: resultValueNull,
    syncLateRenderOver1000Count: syncLateRenderOver1000,
    syncRenderDuplicateSkippedCount: syncRenderDuplicateSkipped,
    taggerSnapshotGaveUpCount: taggerSnapshotGaveUp,
    playAgainBlockedCount: playAgainBlocked,
    playAgainVisibleDuringPartialReplayCount: playAgainVisibleDuringPartialReplay,
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
    // Build22 인수기준(A/B/C 검증용).
    'WRPS-036-B22 countdownStartServerTs 0 = 0': verdict(countdownServerTsZero === 0, hasAny),
    'WRPS-026 resultValue null = 0': verdict(resultValueNull === 0, hasAny),
    'WRPS-SYNC syncLateRenderOver1000 = 0': verdict(syncLateRenderOver1000 === 0, hasAny),
    'WRPS-072 TAGGER_SNAPSHOT_GAVE_UP = 0': verdict(taggerSnapshotGaveUp === 0, hasAny),
    // Build23 인수기준: 부분 재경기 중 '한번더' 노출 없음.
    'WRPS-PLAYAGAIN-B23 visible during partial replay = 0': verdict(playAgainVisibleDuringPartialReplay === 0, hasAny),
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
