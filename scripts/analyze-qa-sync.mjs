// scripts/analyze-qa-sync.mjs — Build19 다기기 동기화 분석기.
// 2개 이상의 device QA export(qa-report.v1 또는 { recent }/배열)를 입력받아, 같은
// room/game/round/phase의 SYNC_RENDER 이벤트를 기기 간 대조해 표시 시각 차(gap)를 계산한다.
// 게임/판정/서버 무변경 — 순수 분석 도구.
//
// 사용: node scripts/analyze-qa-sync.mjs qa-report-device-a.json qa-report-device-b.json [...]

const GAP_THRESHOLD_MS = 1000;

// qa-report.v1({qaMetrics:{recent}}) / 디바이스 export({recent}) / 배열 모두 수용.
function extractRecent(raw) {
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = {}; } }
  if (Array.isArray(obj)) return obj;
  obj = obj || {};
  if (obj.qaMetrics && Array.isArray(obj.qaMetrics.recent)) return obj.qaMetrics.recent;
  if (Array.isArray(obj.recent)) return obj.recent;
  if (Array.isArray(obj.records)) return obj.records;
  return [];
}

const PHASES = ['countdown', 'result', 'nextRound', 'gameOver'];

export function analyzeSyncGaps(inputs) {
  // inputs: [{ file, raw }] — raw는 파싱된 JSON(객체/배열).
  const allRecords = [];
  for (const { file, raw } of inputs) {
    const recent = extractRecent(raw);
    const syncRecs = recent.filter((r) => r.eventType === 'SYNC_RENDER' && Number.isFinite(r.clientRenderedTs));
    for (const r of syncRecs) allRecords.push({ ...r, __file: file });
  }

  // (roomId, gameNo, round, phase) 단위로 그룹핑 — 서로 다른 기기의 같은 전환을 대조.
  const groups = new Map();
  for (const r of allRecords) {
    const key = [r.roomId ?? 'null', r.gameNo ?? 'null', r.round ?? 'null', r.phase ?? 'null'].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const perPhaseGaps = Object.fromEntries(PHASES.map((p) => [p, []]));
  const groupDetails = [];
  for (const [key, recs] of groups.entries()) {
    if (recs.length < 2) continue; // 단일 기기만 기록 — 기기간 비교 불가(정보 없음, gate 대상 아님).
    const ts = recs.map((r) => r.clientRenderedTs);
    const gapMs = Math.max(...ts) - Math.min(...ts);
    const phase = recs[0].phase;
    if (perPhaseGaps[phase]) perPhaseGaps[phase].push(gapMs);
    groupDetails.push({
      key, phase, gapMs, deviceCount: recs.length,
      files: [...new Set(recs.map((r) => r.__file))],
      roomId: recs[0].roomId, gameNo: recs[0].gameNo, round: recs[0].round,
    });
  }
  groupDetails.sort((a, b) => b.gapMs - a.gapMs);

  const maxOf = (arr) => (arr.length ? Math.max(...arr) : null);
  const avgOf = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

  const perPhase = {};
  for (const phase of PHASES) {
    const gaps = perPhaseGaps[phase];
    const maxGapMs = maxOf(gaps);
    perPhase[phase] = {
      comparableRounds: gaps.length,
      maxGapMs,
      avgGapMs: avgOf(gaps),
      verdict: gaps.length === 0 ? 'NO-DATA' : (maxGapMs <= GAP_THRESHOLD_MS ? 'PASS' : 'FAIL'),
    };
  }

  const failed = Object.values(perPhase).filter((p) => p.verdict === 'FAIL').length;
  const noData = Object.values(perPhase).filter((p) => p.verdict === 'NO-DATA').length;
  const overall = failed === 0 ? (noData === PHASES.length ? 'NO-DATA' : 'PASS') : 'FAIL';

  return {
    thresholdMs: GAP_THRESHOLD_MS,
    perPhase,
    overall,
    worstGroups: groupDetails.slice(0, 10), // 상위 10개(가장 큰 gap) — 원인 추적용
    totalComparableGroups: groupDetails.length,
    totalSyncRenderRecords: allRecords.length,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const files = process.argv.slice(2);
  if (files.length < 2) {
    console.error('사용: node scripts/analyze-qa-sync.mjs <device-a.json> <device-b.json> [...]');
    process.exit(1);
  }
  const inputs = files.map((file) => ({ file, raw: JSON.parse(readFileSync(file, 'utf8')) }));
  const out = analyzeSyncGaps(inputs);
  console.log('=== QA Sync Analyzer (Build19) ===');
  console.log(`threshold: <= ${out.thresholdMs}ms | files: ${files.length} | SYNC_RENDER records: ${out.totalSyncRenderRecords} | comparable groups: ${out.totalComparableGroups}`);
  for (const [phase, p] of Object.entries(out.perPhase)) {
    console.log(`  [${p.verdict}] ${phase.toUpperCase()}_RENDER maxGapMs: ${p.maxGapMs ?? 'N/A'} (avg ${p.avgGapMs ?? 'N/A'}, rounds compared: ${p.comparableRounds})`);
  }
  console.log(`=== Overall: ${out.overall} ===`);
  if (out.worstGroups.length) {
    console.log('--- Worst gaps (top 10) ---');
    for (const g of out.worstGroups) {
      console.log(`  room=${g.roomId} game=${g.gameNo} round=${g.round} phase=${g.phase} gapMs=${g.gapMs} devices=${g.deviceCount}`);
    }
  }
  process.exit(out.overall === 'FAIL' ? 1 : 0);
}
