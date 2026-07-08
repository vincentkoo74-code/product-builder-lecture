import { describe, it, expect } from 'vitest';
import { analyzeSyncGaps } from '../scripts/analyze-qa-sync.mjs';

// Build19 — 다기기 SYNC_RENDER gap 분석기 검증.

function syncRec(overrides) {
  return { eventType: 'SYNC_RENDER', phase: 'result', roomId: 'ROOM1', gameNo: 1, round: 1, clientRenderedTs: 1000, ...overrides };
}

describe('QA Sync Analyzer', () => {
  it('입력 없음 → 전부 NO-DATA', () => {
    const out = analyzeSyncGaps([{ file: 'a.json', raw: { recent: [] } }, { file: 'b.json', raw: { recent: [] } }]);
    expect(out.overall).toBe('NO-DATA');
    expect(out.perPhase.result.verdict).toBe('NO-DATA');
  });

  it('같은 round/phase, gap <= 1000ms → PASS', () => {
    const a = { recent: [syncRec({ clientRenderedTs: 1000 })] };
    const b = { recent: [syncRec({ clientRenderedTs: 1400 })] }; // 400ms gap
    const out = analyzeSyncGaps([{ file: 'a.json', raw: a }, { file: 'b.json', raw: b }]);
    expect(out.perPhase.result.maxGapMs).toBe(400);
    expect(out.perPhase.result.verdict).toBe('PASS');
    expect(out.overall).toBe('PASS');
  });

  it('gap > 1000ms → FAIL', () => {
    const a = { recent: [syncRec({ clientRenderedTs: 1000 })] };
    const b = { recent: [syncRec({ clientRenderedTs: 2500 })] }; // 1500ms gap
    const out = analyzeSyncGaps([{ file: 'a.json', raw: a }, { file: 'b.json', raw: b }]);
    expect(out.perPhase.result.maxGapMs).toBe(1500);
    expect(out.perPhase.result.verdict).toBe('FAIL');
    expect(out.overall).toBe('FAIL');
  });

  it('roomId/gameNo/round/phase가 다르면 별도 그룹으로 취급(섞이지 않음)', () => {
    const a = { recent: [syncRec({ roomId: 'ROOM1', clientRenderedTs: 1000 })] };
    const b = { recent: [syncRec({ roomId: 'ROOM2', clientRenderedTs: 9000 })] }; // 다른 방 — 비교 대상 아님
    const out = analyzeSyncGaps([{ file: 'a.json', raw: a }, { file: 'b.json', raw: b }]);
    expect(out.totalComparableGroups).toBe(0); // 각 그룹 1건뿐 — 기기간 비교 불가
    expect(out.perPhase.result.verdict).toBe('NO-DATA');
  });

  it('phase별로 독립 집계된다(countdown/result/nextRound/gameOver)', () => {
    const a = { recent: [
      syncRec({ phase: 'countdown', round: 1, clientRenderedTs: 1000 }),
      syncRec({ phase: 'nextRound', round: 1, clientRenderedTs: 5000 }),
    ] };
    const b = { recent: [
      syncRec({ phase: 'countdown', round: 1, clientRenderedTs: 1200 }), // 200ms
      syncRec({ phase: 'nextRound', round: 1, clientRenderedTs: 6500 }), // 1500ms
    ] };
    const out = analyzeSyncGaps([{ file: 'a.json', raw: a }, { file: 'b.json', raw: b }]);
    expect(out.perPhase.countdown.verdict).toBe('PASS');
    expect(out.perPhase.nextRound.verdict).toBe('FAIL');
    expect(out.overall).toBe('FAIL');
  });

  it('qa-report.v1(qaMetrics.recent 래퍼) 형식도 처리한다', () => {
    const a = { schemaVersion: 'qa-report.v1', qaMetrics: { recent: [syncRec({ clientRenderedTs: 1000 })] } };
    const b = { schemaVersion: 'qa-report.v1', qaMetrics: { recent: [syncRec({ clientRenderedTs: 1300 })] } };
    const out = analyzeSyncGaps([{ file: 'a.json', raw: a }, { file: 'b.json', raw: b }]);
    expect(out.perPhase.result.maxGapMs).toBe(300);
    expect(out.perPhase.result.verdict).toBe('PASS');
  });

  it('worstGroups는 gap 내림차순 정렬로 원인추적을 돕는다', () => {
    const a = { recent: [
      syncRec({ round: 1, clientRenderedTs: 1000 }),
      syncRec({ round: 2, clientRenderedTs: 1000 }),
    ] };
    const b = { recent: [
      syncRec({ round: 1, clientRenderedTs: 1200 }),  // 200ms
      syncRec({ round: 2, clientRenderedTs: 3000 }),  // 2000ms — 더 큰 gap
    ] };
    const out = analyzeSyncGaps([{ file: 'a.json', raw: a }, { file: 'b.json', raw: b }]);
    expect(out.worstGroups[0].round).toBe(2);
    expect(out.worstGroups[0].gapMs).toBe(2000);
  });
});
