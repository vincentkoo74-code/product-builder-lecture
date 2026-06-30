// scripts/release-gate.mjs — Release Gate Calculator (WES v2.1)
// QA_STATUS.md "현재 열린 버그 수" 표(P0/P1/P2/P3)를 파싱해 Critical/High/Medium/Low + Production Score
// + Release Ready 여부를 계산한다. 선택적으로 qa-analyze 게이트 결과를 결합한다. 순수 분석.
//
// 사용: node scripts/release-gate.mjs            (QA_STATUS 파싱)
//       node scripts/release-gate.mjs metrics.json  (메트릭 게이트 결합)

import { readFile } from 'node:fs/promises';

// QA_STATUS.md 표에서 | **P0** | **0** | 형태를 파싱.
export function parseOpenBugs(qaStatusText) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const key of Object.keys(counts)) {
    const re = new RegExp('\\*\\*' + key + '\\*\\*\\s*\\|\\s*\\*\\*(\\d+)\\*\\*', 'i');
    const m = qaStatusText.match(re);
    if (m) counts[key] = parseInt(m[1], 10);
  }
  return counts;
}

export function computeGate(counts, metricGate = null) {
  const critical = counts.P0 || 0, high = counts.P1 || 0, medium = counts.P2 || 0, low = counts.P3 || 0;
  // Production Score: 100에서 심각도 가중 감점(클램프 0~100).
  const score = Math.max(0, 100 - (critical * 40 + high * 15 + medium * 5 + low * 1));
  const metricFail = metricGate ? Object.values(metricGate).filter((v) => v === 'FAIL').length : 0;
  const metricNoData = metricGate ? Object.values(metricGate).filter((v) => v === 'NO-DATA').length : 0;
  const releaseReady = critical === 0 && high === 0 && metricFail === 0;
  return {
    critical, high, medium, low, productionScore: score,
    metricFail, metricNoData,
    releaseReady,
    verdict: releaseReady ? 'RELEASE READY' : 'NOT READY',
    blockers: [
      ...(critical ? [`Critical(P0) ${critical}`] : []),
      ...(high ? [`High(P1) ${high}`] : []),
      ...(metricFail ? [`Metric gate FAIL ${metricFail}`] : []),
      ...(metricNoData ? [`Metric gate NO-DATA ${metricNoData} (실기기 미수집)`] : []),
    ],
  };
}

export async function releaseGate({ metricsPath = null, baseUrl = new URL('../', import.meta.url) } = {}) {
  const qa = await readFile(new URL('QA_STATUS.md', baseUrl), 'utf8');
  const counts = parseOpenBugs(qa);
  let metricGate = null;
  if (metricsPath) {
    const { readFileSync } = await import('node:fs');
    const { analyzeQAMetrics } = await import('./qa-analyze.mjs');
    metricGate = analyzeQAMetrics(JSON.parse(readFileSync(metricsPath, 'utf8'))).gate;
  }
  return { counts, gate: computeGate(counts, metricGate), metricGate };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await releaseGate({ metricsPath: process.argv[2] || null });
  console.log('=== Release Gate ===');
  console.log('open bugs:', JSON.stringify(out.counts));
  console.log('Critical', out.gate.critical, '| High', out.gate.high, '| Medium', out.gate.medium, '| Low', out.gate.low);
  console.log('Production Score:', out.gate.productionScore, '/100');
  console.log('Verdict:', out.gate.verdict);
  if (out.gate.blockers.length) console.log('Blockers:', out.gate.blockers.join(' · '));
}
