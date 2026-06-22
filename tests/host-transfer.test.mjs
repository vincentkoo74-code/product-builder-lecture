import { describe, it, expect } from 'vitest';
import { participantListView } from '../src/game-logic.mjs';

// WRPS-044: 호스트 승계+퇴장 후, 클라이언트가 "최신 DB 행"으로 목록을 다시 그리면
// stale(옛 호스트) 제거 + 새 호스트 is_host 반영 + 남은 참가자 유지가 보장되는지(데이터 뷰 스펙).
// 실제 stale 원인은 realtime DELETE 미전파였고, 수정은 room 변경 시 강제 재조회로 최신 행을 받는 것.
// 이 테스트는 "최신 행을 받았을 때 뷰가 올바른가"의 불변식을 고정한다.
describe('WRPS-044 — 호스트 승계 후 참가자 목록 뷰(participantListView)', () => {
  it('승계 전: 호스트 A + 참가자 B,C → hostId=A, 3명', () => {
    const rows = [
      { id: 'A', name: '옛호스트', is_host: true },
      { id: 'B', name: '참가자B', is_host: false },
      { id: 'C', name: '참가자C', is_host: false },
    ];
    expect(participantListView(rows)).toEqual({ ids: ['A', 'B', 'C'], hostId: 'A', count: 3 });
  });

  it('승계+퇴장 후 최신 DB 행([B(host),C])으로 재조회 → 옛 호스트 A 제거, hostId=B, 2명', () => {
    const freshRows = [
      { id: 'B', name: '참가자B', is_host: true },
      { id: 'C', name: '참가자C', is_host: false },
    ];
    const view = participantListView(freshRows);
    expect(view.ids).toEqual(['B', 'C']);   // C 표시 유지
    expect(view.ids).not.toContain('A');    // stale 옛 호스트 제거
    expect(view.hostId).toBe('B');          // 새 호스트 is_host 반영
    expect(view.count).toBe(2);
  });

  it('호스트 없는 행 집합 → hostId=null', () => {
    expect(participantListView([{ id: 'X' }, { id: 'Y', is_host: false }]).hostId).toBeNull();
  });

  it('빈/널 입력 → 안전(0명, hostId=null)', () => {
    expect(participantListView([])).toEqual({ ids: [], hostId: null, count: 0 });
    expect(participantListView(null)).toEqual({ ids: [], hostId: null, count: 0 });
  });

  it('isHost(카멜) 표기도 인식', () => {
    expect(participantListView([{ id: 'B', isHost: true }, { id: 'C' }]).hostId).toBe('B');
  });
});
