// scripts/qa-export.mjs — Build16 QA 자동화 기반: Analyzer 입력 표준화 + qa-report.json 생성.
// 게임/판정/UI/서버 무변경 — 순수 데이터 변환. window.__qaMetrics.export()가 내보내는
// qa-metrics.json 을 Analyzer 표준 입력으로 정규화하고, 표준 qa-report.json 구조를 만든다.
//
//   raw(device export) ──normalizeExport──▶ normalized ──buildReportJSON──▶ qa-report.json
//                                                    └─ analyzeQAMetrics(qa-analyze.mjs)

import { analyzeQAMetrics } from './qa-analyze.mjs';

// ── 구조 정의(문서화용 스키마 힌트) ─────────────────────────────────────
// qa-metrics.json — 실기기 __qaMetrics.export() 산출물(Analyzer raw 입력).
export const QA_METRICS_SCHEMA = {
  manifest: 'BUILD_MANIFEST.json (build/git_commit/qa_enabled 등) 또는 null',
  session: '{ sessionId, roomId, startedAt, endedAt, deviceType, deviceRole, deviceCount }',
  summary: 'window.__qaMetrics.summary() 산출물',
  recent: '[ QA record ... ]  ← Analyzer 표준 입력',
  snapshots: '[ { reason, ts, summary } ]  게임/방 종료 시 자동 스냅샷',
};

// qa-report.json — Analyzer 산출물(Root Cause / Release Gate 계산 결과).
export const QA_REPORT_SCHEMA = {
  manifest: '{ build, git_commit, qa_enabled }',
  session: '{ roomId, startedAt, endedAt, deviceCount }',
  metrics: '{ avgDriftMs, maxDriftMs, audioDup, audioMissing, orderingMismatch, shadowMismatch }',
  releaseGate: '{ critical, high, ready }',
  issues: '[ "WRPS-026", ... ]',
};

// Gate 항목 → 심각도(critical: 출시 차단 / high: 반드시 수정).
const GATE_SEVERITY = {
  'WRPS-026 shadow match = 100%': 'critical',
  'Ordering mismatch = 0': 'critical',
  'Audio duplication = 0': 'high',
  'Audio missing = 0': 'high',
  'WRPS-036 countdownDrift avg < 100ms': 'high',
  'WRPS-036 countdownDrift max < 200ms': 'high',
  'Stale participant = 0': 'high',
};

// 다양한 raw 형태를 표준 { manifest, session, summary, recent, snapshots } 로 정규화.
// 허용 입력: 디바이스 export 객체 / { recent } / QA record 배열 / copyText() JSON.
export function normalizeExport(raw) {
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = {}; } }
  if (Array.isArray(obj)) obj = { recent: obj };
  obj = obj || {};

  const recent = Array.isArray(obj.recent) ? obj.recent
    : (Array.isArray(obj.records) ? obj.records : []);
  const manifest = obj.manifest || null;

  // session 필드 유추(디바이스 export가 없으면 recent에서 복원).
  const first = recent[0] || {};
  const sess = obj.session || {};
  const deviceCount = Number.isFinite(sess.deviceCount)
    ? sess.deviceCount
    : [...new Set(recent.map((r) => r.playerId || r.deviceType).filter(Boolean))].length || null;
  const session = {
    sessionId: sess.sessionId || first.session || null,
    roomId: sess.roomId != null ? sess.roomId : (first.roomId || null),
    startedAt: sess.startedAt != null ? sess.startedAt : (recent.length ? recent[0].ts : null),
    endedAt: sess.endedAt != null ? sess.endedAt : (recent.length ? recent[recent.length - 1].ts : null),
    deviceType: sess.deviceType || first.deviceType || null,
    deviceRole: sess.deviceRole || first.deviceRole || null,
    deviceCount,
  };

  return {
    manifest,
    session,
    summary: obj.summary || null,
    recent,
    snapshots: Array.isArray(obj.snapshots) ? obj.snapshots : [],
  };
}

// normalized(또는 raw) → 표준 qa-report.json 객체. analysis/issues 미지정 시 자동 계산.
export function buildReportJSON(input, opts = {}) {
  const norm = (input && input.recent && input.session) ? input : normalizeExport(input);
  const analysis = opts.analysis || analyzeQAMetrics({ recent: norm.recent });
  const r = analysis.report;

  const shadowMismatch = (r.shadowTotal || 0) - (r.shadowMatch || 0);
  const metrics = {
    avgDriftMs: r.countdownDriftAvgMs != null ? r.countdownDriftAvgMs : (r.driftAvgMs || 0),
    maxDriftMs: r.countdownDriftMaxMs != null ? r.countdownDriftMaxMs : (r.driftMaxMs || 0),
    audioDup: r.audioDuplicate || 0,
    audioMissing: r.audioMissing || 0,
    orderingMismatch: r.orderingMismatch || 0,
    shadowMismatch,
  };

  let critical = 0, high = 0;
  for (const [k, v] of Object.entries(analysis.gate)) {
    if (v !== 'FAIL') continue;
    if (GATE_SEVERITY[k] === 'critical') critical++;
    else high++;
  }
  const releaseGate = { critical, high, ready: analysis.summary.gateReady === true };

  const m = norm.manifest || {};
  return {
    manifest: { build: m.build != null ? m.build : (opts.build != null ? opts.build : null),
                git_commit: m.git_commit || null,
                qa_enabled: m.qa_enabled != null ? m.qa_enabled : null },
    session: { roomId: norm.session.roomId, startedAt: norm.session.startedAt,
               endedAt: norm.session.endedAt, deviceCount: norm.session.deviceCount },
    metrics,
    releaseGate,
    issues: Array.isArray(opts.issues) ? opts.issues : [],
  };
}

// CLI: node scripts/qa-export.mjs <qa-metrics.json>  → qa-report.json 을 stdout 으로.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const path = process.argv[2];
  const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  const report = buildReportJSON(normalizeExport(raw));
  console.log(JSON.stringify(report, null, 2));
}
