import { describe, it, expect } from 'vitest';
import { normalizeExport, buildReportJSON, QA_METRICS_SCHEMA, QA_REPORT_SCHEMA } from '../scripts/qa-export.mjs';

// Build16 — Analyzer 입력 표준화 + qa-report.json 생성 검증.

const deviceExport = {
  manifest: { product: 'WooriMaru RPS', build: 16, git_commit: 'deadbeef1234', qa_enabled: true },
  session: { sessionId: 's1', roomId: 'ROOM7', startedAt: 1000, endedAt: 5000, deviceType: 'iPhone', deviceRole: 'host', deviceCount: 3 },
  summary: { metrics: 4 },
  recent: [
    { eventType: 'QA_SESSION_START', session: 's1', ts: 1000, roomId: 'ROOM7', deviceType: 'iPhone', playerId: 'p1' },
    { eventType: 'COUNTDOWN_START', countdownDriftMs: 40, session: 's1', ts: 2000, deviceType: 'iPad', playerId: 'p2' },
    { eventType: 'ROUND_RESULT', shadowMatch: true, session: 's1', ts: 3000, playerId: 'p3' },
    { eventType: 'ROUND_RESULT', shadowMatch: false, session: 's1', ts: 4000 },
  ],
  snapshots: [{ reason: 'endGame', ts: 5000, summary: {} }],
};

describe('qa-export: normalizeExport', () => {
  it('디바이스 export를 표준 형태로 정규화', () => {
    const n = normalizeExport(deviceExport);
    expect(n.manifest.build).toBe(16);
    expect(n.session.roomId).toBe('ROOM7');
    expect(n.session.deviceCount).toBe(3);
    expect(n.recent).toHaveLength(4);
    expect(n.snapshots).toHaveLength(1);
  });

  it('bare 배열 입력도 수용하고 session을 recent에서 복원', () => {
    const n = normalizeExport(deviceExport.recent);
    expect(n.manifest).toBe(null);
    expect(n.session.roomId).toBe('ROOM7');       // 첫 레코드에서 복원
    expect(n.session.startedAt).toBe(1000);
    expect(n.session.endedAt).toBe(4000);
    expect(n.session.deviceCount).toBe(3);          // 고유 playerId 3
  });

  it('JSON 문자열 입력 파싱', () => {
    const n = normalizeExport(JSON.stringify({ recent: [] }));
    expect(n.recent).toEqual([]);
  });

  it('잘못된 입력은 빈 표준 형태로 폴백', () => {
    const n = normalizeExport(null);
    expect(n.recent).toEqual([]);
    expect(n.session.deviceCount).toBe(null);
  });
});

describe('qa-export: buildReportJSON', () => {
  it('표준 qa-report.json 구조 + manifest 연결', () => {
    const rep = buildReportJSON(deviceExport, { issues: ['WRPS-026'] });
    expect(rep.manifest).toEqual({ build: 16, git_commit: 'deadbeef1234', qa_enabled: true });
    expect(rep.session).toEqual({ roomId: 'ROOM7', startedAt: 1000, endedAt: 5000, deviceCount: 3 });
    for (const k of ['avgDriftMs', 'maxDriftMs', 'audioDup', 'audioMissing', 'orderingMismatch', 'shadowMismatch']) {
      expect(rep.metrics).toHaveProperty(k);
    }
    expect(rep.metrics.shadowMismatch).toBe(1);     // 2 result, 1 match → mismatch 1
    expect(rep.metrics.avgDriftMs).toBe(40);
    expect(rep.issues).toEqual(['WRPS-026']);
  });

  it('shadow FAIL은 releaseGate.critical, ready=false', () => {
    const rep = buildReportJSON(deviceExport);
    expect(rep.releaseGate.critical).toBeGreaterThanOrEqual(1);
    expect(rep.releaseGate.ready).toBe(false);
  });

  it('정상 데이터 → releaseGate.ready=true', () => {
    const clean = { manifest: { build: 16 }, recent: [
      { eventType: 'COUNTDOWN_START', countdownDriftMs: 20 },
      { eventType: 'ROUND_RESULT', shadowMatch: true },
    ] };
    const rep = buildReportJSON(clean);
    expect(rep.releaseGate.critical).toBe(0);
    expect(rep.releaseGate.ready).toBe(true);
  });

  it('스키마 힌트 export 존재', () => {
    expect(QA_METRICS_SCHEMA).toHaveProperty('recent');
    expect(QA_REPORT_SCHEMA).toHaveProperty('releaseGate');
  });
});
