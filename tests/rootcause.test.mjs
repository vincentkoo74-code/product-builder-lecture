import { describe, it, expect } from 'vitest';
import { analyzeQAMetrics } from '../scripts/qa-analyze.mjs';
import { rootCauseCandidates, fiveWhysDraft } from '../scripts/rootcause-analyze.mjs';
import { analyzeHistory } from '../scripts/history-analyze.mjs';
import { parseOpenBugs, computeGate } from '../scripts/release-gate.mjs';
import { buildQAReport } from '../scripts/qa-report.mjs';

describe('qa-analyze percentiles', () => {
  it('p95/p99 계산', () => {
    const recent = Array.from({ length: 100 }, (_, i) => ({ eventType: 'COUNTDOWN_START', countdownDriftMs: i + 1 }));
    const { report } = analyzeQAMetrics({ recent });
    expect(report.countdownDriftP95Ms).toBe(95);
    expect(report.countdownDriftP99Ms).toBe(99);
    expect(report.countdownDriftMaxMs).toBe(100);
  });
});

describe('rootcause-analyze', () => {
  it('drift FAIL + shadow mismatch + audio dup → 후보 confidence 순 정렬', () => {
    const analysis = analyzeQAMetrics([
      { eventType: 'COUNTDOWN_START', countdownDriftMs: 300 },
      { eventType: 'ROUND_RESULT', shadowMatch: false },
      { eventType: 'VOICE', audioDuplicated: true },
    ]);
    const cands = rootCauseCandidates(analysis);
    expect(cands.length).toBeGreaterThanOrEqual(3);
    // 정렬: confidence 내림차순
    for (let i = 1; i < cands.length; i++) expect(cands[i - 1].confidence).toBeGreaterThanOrEqual(cands[i].confidence);
    const five = fiveWhysDraft(analysis);
    expect(five.whys.length).toBe(5);
    expect(five.candidate).toBeTruthy();
  });

  it('정상 데이터 → 후보 없음', () => {
    const analysis = analyzeQAMetrics([{ eventType: 'COUNTDOWN_START', countdownDriftMs: 20 }, { eventType: 'ROUND_RESULT', shadowMatch: true }]);
    expect(rootCauseCandidates(analysis).length).toBe(0);
    expect(fiveWhysDraft(analysis).whys.length).toBe(0);
  });
});

describe('history-analyze', () => {
  it('WRPS-026 검색 → 원장/액티브 매칭 + 분류', async () => {
    const out = await analyzeHistory(['WRPS-026']);
    expect(out.matchCount).toBeGreaterThan(0);
    expect(out.classification).toBeTruthy();
  });
  it('WRPS-047 → regression 후보 감지', async () => {
    const out = await analyzeHistory(['WRPS-047']);
    expect(out.isRegressionCandidate).toBe(true); // REGRESSION_TRACKER/회귀 표기 존재
  });
});

describe('release-gate', () => {
  it('QA_STATUS 표 파싱', () => {
    const txt = '| **P0** | **0** | — |\n| **P1** | **2** | a |\n| **P2** | **2** | b |\n| **P3** | **2** | c |';
    expect(parseOpenBugs(txt)).toEqual({ P0: 0, P1: 2, P2: 2, P3: 2 });
  });
  it('High>0 → NOT READY, score 감점', () => {
    const g = computeGate({ P0: 0, P1: 2, P2: 2, P3: 2 });
    expect(g.releaseReady).toBe(false);
    expect(g.high).toBe(2);
    expect(g.productionScore).toBe(100 - (0 * 40 + 2 * 15 + 2 * 5 + 2 * 1)); // 58
  });
  it('Critical=High=0 + metric PASS → READY', () => {
    const g = computeGate({ P0: 0, P1: 0, P2: 1, P3: 0 }, { a: 'PASS', b: 'PASS' });
    expect(g.releaseReady).toBe(true);
    expect(g.verdict).toBe('RELEASE READY');
  });
});

describe('qa-report generator', () => {
  it('메트릭 → Markdown QA ANALYZER REPORT 생성', async () => {
    const metrics = { recent: [
      { eventType: 'COUNTDOWN_START', countdownDriftMs: 250, deviceType: 'iPhone' },
      { eventType: 'ROUND_RESULT', shadowMatch: false },
    ] };
    const out = await buildQAReport(metrics, { build: '14', device: 'iPhone/iPad', scenario: 'WRPS-026 3인 재대결' });
    expect(out.markdown).toContain('QA ANALYZER REPORT');
    expect(out.markdown).toContain('Root Cause Candidate');
    expect(out.markdown).toContain('Release Gate');
    expect(out.candidates.length).toBeGreaterThan(0);
  });
});
