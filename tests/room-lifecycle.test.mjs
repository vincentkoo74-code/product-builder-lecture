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

  it('archiveCurrentRoundStats가 participantSig(세션 식별자)를 저장한다', () => {
    const body = fnBody('archiveCurrentRoundStats');
    expect(body).toMatch(/participantSig:\s*getParticipantSignature\(\)/);
  });

  it('1인 방 destroy 전이 가드가 존재한다 (oldParticipants>1 → data===1)', () => {
    // fetchParticipants 내 전이 가드
    expect(html).toMatch(/oldParticipants\.length > 1 && data\.length === 1/);
    expect(html).toContain('destroyRoomAndGoHome("last_participant")');
  });

  it('destroyRoomAndGoHome이 방/참가자 삭제 후 홈 복귀한다', () => {
    const body = fnBody('destroyRoomAndGoHome');
    expect(body).toContain("db.from('rooms').delete()");
    expect(body).toContain('goHome()');
    expect(body).toContain('ROOM_DESTROYED');
  });

  it('roomClosedAlone toast가 3개 로케일에 존재한다', () => {
    const n = (html.match(/"toast\.roomClosedAlone":/g) || []).length; // 정의(키:)만 카운트
    expect(n).toBe(3);
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
