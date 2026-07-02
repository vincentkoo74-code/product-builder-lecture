// scripts/qa-report.mjs — QA ANALYZER REPORT 생성기 (WES v2.1)
// analyze + rootcause + history + release-gate 를 결합해 Sprint 표준 QA Report(Markdown)를 출력한다.
// 순수 분석/생성 — 앱/게임 무변경.
//
// 사용: node scripts/qa-report.mjs metrics.json [--build 14] [--device "iPhone/iPad"] [--scenario "WRPS-026 3인 재대결"]

import { analyzeQAMetrics } from './qa-analyze.mjs';
import { rootCauseCandidates, fiveWhysDraft } from './rootcause-analyze.mjs';
import { analyzeHistory } from './history-analyze.mjs';
import { computeGate, parseOpenBugs } from './release-gate.mjs';
import { normalizeExport, buildReportJSON } from './qa-export.mjs';

export async function buildQAReport(metrics, opts = {}) {
  // Build16: 표준 입력으로 정규화(디바이스 export/{recent}/배열 모두 수용) + BUILD_MANIFEST 연결.
  const norm = normalizeExport(metrics);
  const manifest = norm.manifest || {};
  const buildLabel = opts.build || (manifest.build != null ? `build${manifest.build}` : 'build15');
  const analysis = analyzeQAMetrics({ recent: norm.recent });
  const cands = rootCauseCandidates(analysis);
  const top = cands[0] || null;
  const five = fiveWhysDraft(analysis);
  const history = top ? await analyzeHistory([top.wrps, opts.scenario || ''].filter(Boolean)).catch(() => null) : null;

  let openCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  try {
    const { readFile } = await import('node:fs/promises');
    openCounts = parseOpenBugs(await readFile(new URL('../QA_STATUS.md', import.meta.url), 'utf8'));
  } catch (e) {}
  const gate = computeGate(openCounts, analysis.gate);

  const r = analysis.report;
  const L = [];
  L.push('# QA ANALYZER REPORT');
  L.push(`- Build: ${buildLabel}`);
  L.push(`- Device: ${opts.device || (r.devices || []).join('/') || 'N/A'}`);
  L.push(`- Scenario: ${opts.scenario || 'N/A'}`);
  // Build16: BUILD_MANIFEST.json 연결(Evidence 출처 식별).
  if (manifest.build != null || manifest.git_commit) {
    L.push(`- Manifest: build ${manifest.build ?? '?'} · commit ${(manifest.git_commit || 'unknown').slice(0, 12)} · qa_enabled ${manifest.qa_enabled ?? '?'}`);
  }
  if (norm.session && norm.session.roomId) {
    L.push(`- Session: room ${norm.session.roomId} · devices ${norm.session.deviceCount ?? '?'}`);
  }
  L.push('');
  L.push('## Metrics Summary');
  L.push(`- Samples: ${r.samples} (sessions ${r.sessions})`);
  L.push(`- Countdown Drift: avg ${r.countdownDriftAvgMs}ms · max ${r.countdownDriftMaxMs} · p95 ${r.countdownDriftP95Ms} · p99 ${r.countdownDriftP99Ms}`);
  L.push(`- ClockSync Offset: ${r.clockOffsetMs}ms (max|abs| ${r.clockOffsetMaxMs})`);
  L.push(`- Shadow: ${r.shadowMatchPct}% (${r.shadowMatch}/${r.shadowTotal})`);
  L.push(`- Ordering mismatch: ${r.orderingMismatch}`);
  L.push(`- Audio: delay avg ${r.audioDelayAvgMs}ms · max ${r.audioDelayMaxMs} · p95 ${r.audioDelayP95Ms} · dup ${r.audioDuplicate} · missing ${r.audioMissing}`);
  L.push(`- Lobby: hostChanged ${r.hostChanged} · stale ${r.staleParticipant}`);
  L.push('');
  L.push('## Gate (Metrics)');
  for (const [k, v] of Object.entries(analysis.gate)) L.push(`- [${v}] ${k}`);
  L.push('');
  L.push('## Root Cause Candidate');
  if (cands.length) cands.forEach((c, i) => L.push(`- #${i + 1} [${c.confidence}%] ${c.wrps} — ${c.name}\n  - evidence: ${c.evidence}`));
  else L.push('- (gate FAIL 없음 — 후보 없음. 데이터 정상 또는 NO-DATA)');
  L.push('');
  L.push('## 5 Whys Draft (top, Evidence로 확정 필요)');
  (five.whys || []).forEach((w, i) => L.push(`- WHY${i + 1}: ${w}`));
  L.push('');
  L.push('## History Match / Regression');
  if (history) { L.push(`- classification: ${history.classification}`); L.push(`- regressionCandidate: ${history.isRegressionCandidate} (matches ${history.matchCount})`); }
  else L.push('- (후보 없음 → 검색 생략)');
  L.push('');
  L.push('## Architecture 영향');
  L.push('- 분석 도구 — Server-Authoritative/Replay/Ordering/EventBus/ClockSync/Shadow 무관(변경 0)');
  L.push('');
  L.push('## Release Gate');
  L.push(`- Critical ${gate.critical} · High ${gate.high} · Medium ${gate.medium} · Low ${gate.low} · Score ${gate.productionScore}/100`);
  L.push(`- Verdict: **${gate.verdict}**${gate.blockers.length ? ' — ' + gate.blockers.join(' · ') : ''}`);
  L.push('');
  L.push('## 추천');
  L.push(`- 추천 확인: ${top ? top.wrps + ' 관련 코드 정독 + 재현 시나리오 반복' : '데이터 더 수집'}`);
  L.push(`- 추천 Fix 여부: ${top && top.confidence >= 85 ? '높은 confidence — 코드 정독으로 Root Cause 확정 후 Fix 검토' : 'Evidence 추가 수집 후 재판단(확정 전 Fix 금지)'}`);
  L.push('- 다음 Sprint: Root Cause 확정 시 WES Fix→Regression→Gate 루프');

  // Build16: 표준 qa-report.json(Analyzer 산출물) 동봉 — manifest 연결.
  const reportJSON = buildReportJSON(norm, {
    analysis,
    build: manifest.build,
    issues: (cands || []).map((c) => c.wrps).filter(Boolean),
  });

  return { markdown: L.join('\n'), analysis, candidates: cands, gate, history, reportJSON };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
  const metrics = JSON.parse(file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'));
  const out = await buildQAReport(metrics, { build: opt('build'), device: opt('device'), scenario: opt('scenario') });
  // --json → 표준 qa-report.json, 기본 → Markdown 리포트.
  console.log(args.includes('--json') ? JSON.stringify(out.reportJSON, null, 2) : out.markdown);
}
