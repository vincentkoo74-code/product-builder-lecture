import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// WRPS-053 (DR-15) — 대기/탈락 player는 UI-passive. lobby ready 버튼 게이팅 회귀 방지.
// 모놀리스(index.html) 함수라 코드 불변식으로 게이트 존재를 고정한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 특정 함수 본문 추출 헬퍼(다음 최상위 함수 선언 전까지).
function fnBody(name) {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) return '';
  return html.slice(i, i + 4000);
}

describe('WRPS-053 lobby UI authority', () => {
  it('renderLobby가 ready 버튼을 isCurrentRoundParticipant로 게이팅한다', () => {
    const body = fnBody('renderLobby');
    expect(body).toContain('isCurrentRoundParticipant()');
    // 게이트가 버튼 hidden 토글과 함께 존재
    expect(body).toMatch(/isCurrentRoundParticipant\(\)\s*\)\s*btn\.classList\.remove\("hidden"\)/);
  });

  it('markReadyFromLobby가 비활성 player를 대기화면으로 유도한다', () => {
    const body = fnBody('markReadyFromLobby');
    expect(body).toContain('isCurrentRoundParticipant()');
    expect(body).toContain('showLoserWaitScreen()');
    expect(body).toContain('screenWinnerWait');
  });

  it('메인 인라인 <script> 블록이 여전히 유효하다', () => {
    const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    let ok = 0;
    for (const b of blocks) {
      const code = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
      try { new Function(code); ok++; } catch { /* count only */ }
    }
    expect(ok).toBe(blocks.length);
  });
});
