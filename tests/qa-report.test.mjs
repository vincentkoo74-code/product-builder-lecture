import { describe, it, expect } from 'vitest';
import { buildQAReport } from '../scripts/qa-report.mjs';

// Build16 — QA Report가 BUILD_MANIFEST를 연결하고 표준 reportJSON을 동봉하는지 검증.

const deviceExport = {
  manifest: { product: 'WooriMaru RPS', build: 16, git_commit: 'abcdef123456', qa_enabled: true },
  session: { roomId: 'ROOM9', startedAt: 1000, endedAt: 9000, deviceCount: 3 },
  recent: [
    { eventType: 'COUNTDOWN_START', countdownDriftMs: 30, session: 's', deviceType: 'iPhone' },
    { eventType: 'ROUND_RESULT', shadowMatch: true, session: 's' },
    { eventType: 'ROUND_RESULT', shadowMatch: true, session: 's' },
  ],
};

describe('qa-report Build16', () => {
  it('Markdown에 Manifest/Session 라인이 연결된다', async () => {
    const out = await buildQAReport(deviceExport);
    expect(out.markdown).toContain('Build: build16');
    expect(out.markdown).toContain('Manifest: build 16');
    expect(out.markdown).toContain('abcdef123456');
    expect(out.markdown).toContain('room ROOM9');
  });

  it('reportJSON(표준 qa-report.json)이 동봉된다', async () => {
    const out = await buildQAReport(deviceExport);
    expect(out.reportJSON).toBeTruthy();
    expect(out.reportJSON.manifest.build).toBe(16);
    expect(out.reportJSON.session.roomId).toBe('ROOM9');
    expect(out.reportJSON.metrics.shadowMismatch).toBe(0);
    expect(out.reportJSON.releaseGate.ready).toBe(true);
  });

  it('bare metrics 입력(하위 호환)도 처리한다', async () => {
    const out = await buildQAReport({ recent: deviceExport.recent });
    expect(out.markdown).toContain('# QA ANALYZER REPORT');
    expect(out.reportJSON.manifest.build).toBe(null);
  });
});
