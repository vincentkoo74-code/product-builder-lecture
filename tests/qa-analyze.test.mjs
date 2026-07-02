import { describe, it, expect } from 'vitest';
import { analyzeQAMetrics } from '../scripts/qa-analyze.mjs';

// WES v2 Sprint — QA Metrics Analyzer 검증(샘플 입력 → 자동 산출/게이트).

describe('QA Metrics Analyzer', () => {
  it('빈 입력 → NO-DATA', () => {
    const { report, gate, summary } = analyzeQAMetrics({ recent: [] });
    expect(report.samples).toBe(0);
    expect(gate['WRPS-026 shadow match = 100%']).toBe('NO-DATA');
    expect(summary.gateReady).toBe(false);
  });

  it('정상 메트릭(drift<100, dup0, shadow 100%) → 전부 PASS', () => {
    const recent = [
      { eventType: 'COUNTDOWN_START', countdownDriftMs: 30, session: 's', deviceType: 'iPhone' },
      { eventType: 'COUNTDOWN_START', countdownDriftMs: -50, session: 's', deviceType: 'iPad' },
      { eventType: 'CLOCK_SYNC', offsetMs: 120 },
      { eventType: 'ROUND_RESULT', shadowMatch: true },
      { eventType: 'ROUND_RESULT', shadowMatch: true },
      { eventType: 'VOICE', audioDelayMs: 40 },
      { eventType: 'PARTICIPANT_UPDATE', hostChanged: true },
    ];
    const { report, gate, summary } = analyzeQAMetrics({ recent });
    expect(report.countdownDriftAvgMs).toBe(40);   // (30+50)/2
    expect(report.countdownDriftMaxMs).toBe(50);
    expect(report.shadowMatchPct).toBe(100);
    expect(report.audioDuplicate).toBe(0);
    expect(report.hostChanged).toBe(1);
    expect(report.devices.sort()).toEqual(['iPad', 'iPhone']);
    expect(gate['WRPS-036 countdownDrift avg < 100ms']).toBe('PASS');
    expect(gate['WRPS-026 shadow match = 100%']).toBe('PASS');
    expect(summary.gateReady).toBe(true);
  });

  it('드리프트 초과 + audio dup + shadow mismatch → FAIL 검출', () => {
    const recent = [
      { eventType: 'COUNTDOWN_START', countdownDriftMs: 250 },
      { eventType: 'ROUND_RESULT', shadowMatch: false },
      { eventType: 'ROUND_RESULT', shadowMatch: true },
      { eventType: 'VOICE', audioDuplicated: true },
      { eventType: 'VOICE', audioMissing: true },
    ];
    const { report, gate, summary } = analyzeQAMetrics(recent); // 배열도 허용
    expect(report.countdownDriftAvgMs).toBe(250);
    expect(report.shadowMatchPct).toBe(50);
    expect(report.audioDuplicate).toBe(1);
    expect(gate['WRPS-036 countdownDrift avg < 100ms']).toBe('FAIL');
    expect(gate['WRPS-026 shadow match = 100%']).toBe('FAIL');
    expect(gate['Audio duplication = 0']).toBe('FAIL');
    expect(summary.failed).toBeGreaterThanOrEqual(3);
    expect(summary.gateReady).toBe(false);
  });

  it('{summary, recent} 래퍼와 배열 입력 모두 처리', () => {
    const recent = [{ eventType: 'CLOCK_SYNC', offsetMs: 80 }];
    expect(analyzeQAMetrics({ summary: {}, recent }).report.clockOffsetMs).toBe(80);
    expect(analyzeQAMetrics(recent).report.clockOffsetMs).toBe(80);
  });
});
