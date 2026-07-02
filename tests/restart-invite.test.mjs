import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// WRPS-054 — Restart invite 전달 신뢰성: reinviting 창이 닫히면 dedup 해제 → 재초대 재사이클 인식.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function fnBody(name, len = 1600) {
  const i = html.indexOf(`function ${name}(`);
  return i < 0 ? '' : html.slice(i, i + len);
}

describe('WRPS-054 restart invite dedup lifecycle', () => {
  const body = fnBody('checkGlobalReplayInvites');

  it('reinviting가 아니면 seenInviteRooms에서 seenKey를 해제한다', () => {
    expect(body).toContain('delete state.seenInviteRooms[seenKey]');
    // 해제는 non-reinviting 분기에서 일어난다
    expect(body).toMatch(/room\.status !== "reinviting"[\s\S]*delete state\.seenInviteRooms\[seenKey\]/);
  });

  it('reinviting일 때만 이미 본 것을 억제한다(그 외엔 새 초대로 표시)', () => {
    expect(body).toContain('if (state.seenInviteRooms[seenKey]) return;');
    expect(body).toContain('showInvitePopupForRoom(room.id)');
  });
});
