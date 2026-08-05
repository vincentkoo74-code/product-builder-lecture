import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// WRPS-056 (DR-14) — 참가자 집합 변경=새 session. 기록 분리 + 1인 방 destroy 회귀 방지.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function fnBody(name, len = 4000) {
  const i = html.indexOf(`function ${name}(`);
  return i < 0 ? '' : html.slice(i, i + len);
}

describe('WRPS-056 room lifecycle', () => {
  it('buildRoomStatsSummary가 참가자 서명(session)으로 집계를 한정한다 (gameRound 아님)', () => {
    const body = fnBody('buildRoomStatsSummary');
    expect(body).toContain('sessionSig');
    expect(body).toContain('getParticipantSignature');
    expect(body).toMatch(/entry\.participantSig/);
    // gameRound로 필터하지 않는다(재대결마다 증가 → 회귀). codex-critic D 회귀 방지.
    expect(body).not.toMatch(/entry\.gameRound[^\n]*===/);
  });

  it('archiveCurrentRoundStats가 priorParticipants(직전 구성) 기준으로 sig를 태깅한다', () => {
    const body = fnBody('archiveCurrentRoundStats');
    // codex-critic C: 참가자 변경 경로에서 state.participants가 이미 새 집합으로 덮인 뒤 호출되므로
    // 반드시 source(priorParticipants) 기준으로 서명해야 한다.
    expect(body).toContain('priorParticipants');
    expect(body).toMatch(/participantSig:\s*getParticipantSignature\(source\)/);
  });

  it('membership/host 변경 4개 경로 모두 priorParticipants(직전 구성)를 전달한다', () => {
    // codex-critic: state.participants 선교체 → sig 오귀속 버그 클래스 전수 차단.
    expect(html).toMatch(/reason: "participant_or_host_changed", priorParticipants: oldParticipants/); // host-reset
    expect(html).toMatch(/reason: "participant_dropped", priorParticipants: beforeDrop/);              // dropped cleanup
    expect(html).toMatch(/priorParticipants: beforeTransfer/);                                          // transferHostAndLeave
    expect(html).toMatch(/reason: "loser_became_next_host", priorParticipants: beforePromote/);         // becomeNextHost
  });

  it('1인 방 destroy 전이 가드가 존재한다 (oldParticipants>1 → data===1)', () => {
    // fetchParticipants 내 전이 가드
    expect(html).toMatch(/oldParticipants\.length > 1 && data\.length === 1/);
    expect(html).toContain('destroyRoomAndGoHome("last_participant")');
  });

  // WRPS-083 2B(계약 갱신): hard DELETE → soft tombstone.
  // 종전 rooms.delete()는 남은 단말의 rooms.select().single()을 null로 만들어 handleRoomUpdate의
  // `if (room)` 가드에서 아무 것도 하지 않게 했다 — 즉 "방이 사라졌다"가 전파되지 않았다.
  // tombstone은 row를 남겨 기존 2경로(realtime + 2.6s 폴링)로 자연 전파된다.
  it('destroyRoomAndGoHome이 soft tombstone으로 종료하고 홈 복귀한다(hard DELETE 금지)', () => {
    const body = fnBody('destroyRoomAndGoHome');
    expect(body).toContain("db.from('rooms').update({ status: 'destroyed' })");
    expect(body).not.toContain("db.from('rooms').delete()");
    // 순서 계약: rooms tombstone이 participants 정리보다 먼저다(역순 금지).
    expect(body.indexOf("from('rooms')")).toBeLessThan(body.indexOf("from('participants')"));
    expect(body).toContain('teardownRoomRuntime()');
    expect(body).toContain('clearRoomScopedCache(');
    expect(body).toContain('goHome()');
    expect(body).toContain('ROOM_DESTROYED');
  });

  it('WRPS-083 2B: 소스 전체에서 rooms hard DELETE가 사라졌다', () => {
    expect(html).not.toContain("db.from('rooms').delete()");
  });

  it('roomClosedAlone toast가 3개 로케일에 존재한다', () => {
    const n = (html.match(/"toast\.roomClosedAlone":/g) || []).length; // 정의(키:)만 카운트
    expect(n).toBe(3);
  });

  it('WRPS-061: 결과화면 고착 복구 백스톱이 존재한다 (status advanced인데 result 화면)', () => {
    expect(html).toContain("const onResult = resultScreen && !resultScreen.classList.contains(\"hidden\")");
    expect(html).toMatch(/onResult && \(state\.status === "lobby" \|\| state\.status === "waiting"\)/);
  });

  it('메인 인라인 <script> 블록이 여전히 유효하다', () => {
    const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    let ok = 0;
    for (const b of blocks) {
      try { new Function(b.replace(/^<script>/, '').replace(/<\/script>$/, '')); ok++; } catch { /* count */ }
    }
    expect(ok).toBe(blocks.length);
  });
});
