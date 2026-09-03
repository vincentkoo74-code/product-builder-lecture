import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function resultFns() {
  const start = html.indexOf('function gameResultVoiceKey');
  const end = html.indexOf('\n    function playTaggerConfirmationVoiceOnce', start);
  return new Function(html.slice(start, end) + '\nreturn { gameResultVoiceKey, gameResultVoicePhraseKo };')();
}

describe('BUILD47 GAME_RESULT voice semantics (KR)', () => {
  it('maps the same GAME ordinal to winner and loser phrases', () => {
    const f = resultFns();
    expect(f.gameResultVoiceKey('win', 1)).toBe('gameResultWin1');
    expect(f.gameResultVoiceKey('lose', 1)).toBe('gameResultLose1');
    expect(f.gameResultVoicePhraseKo('win', 1)).toBe('첫째 판 이겼습니다');
    expect(f.gameResultVoicePhraseKo('lose', 2)).toBe('둘째 판 졌습니다');
    expect(f.gameResultVoicePhraseKo('win', 5)).toBe('다섯째 판 이겼습니다');
    expect(f.gameResultVoicePhraseKo('lose', 10)).toBe('열째 판 졌습니다');
    expect(f.gameResultVoiceKey('win', 11)).toBe('gameResultWinNext');
  });

  it('BEST3 trace: ordinary GAME losses do not confirm until loss 2/2', () => {
    const f = resultFns();
    const trace = [
      { game: 1, loser: 'a', losses: 1, confirmed: false },
      { game: 2, loser: 'b', losses: 1, confirmed: false },
      { game: 3, loser: 'a', losses: 2, confirmed: true },
    ];
    expect(trace.map(x => f.gameResultVoicePhraseKo('lose', x.game))).toEqual([
      '첫째 판 졌습니다', '둘째 판 졌습니다', '셋째 판 졌습니다',
    ]);
    expect(trace.filter(x => x.confirmed).map(x => x.loser)).toEqual(['a']);
    expect(html).toContain('newlyConfirmedTaggerIds');
    expect(html).toContain('playTaggerConfirmationVoiceOnce(id, mNo)');
  });

  it('BEST5 trace: losses 1/3 and 2/3 stay GAME_RESULT-only; 3/3 confirms once', () => {
    const f = resultFns();
    const trace = [1, 2, 3].map((losses, i) => ({
      game: i + 1, losses, confirmed: losses >= 3,
      resultVoice: f.gameResultVoicePhraseKo('lose', i + 1),
    }));
    expect(trace.map(x => x.resultVoice)).toEqual([
      '첫째 판 졌습니다', '둘째 판 졌습니다', '셋째 판 졌습니다',
    ]);
    expect(trace.filter(x => x.confirmed)).toHaveLength(1);
  });

  it('tagger confirmation is transition-driven and idempotent across echo/reconnect', () => {
    expect(html).toContain('const previous = state.observedMatchLockedIds[mNo] || []');
    expect(html).toContain('current.filter(x => !previous.includes(x))');
    expect(html).toContain('if (state.taggerConfirmVoiceKeys[key]) return;');
    expect(html).toContain('if (!isKrVoiceLocale() || playerId !== state.currentUserId) return;');
  });

  it('KR game-over result branches use GAME_RESULT and do not directly use taggerSelected', () => {
    const start = html.indexOf('async function finishRoundLocal');
    const end = html.indexOf('\n    // 오프라인/프로토타입용 원본 finishRound', start);
    const finish = html.slice(start, end);
    expect(finish.match(/playGameResultVoiceOnce\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(finish).toContain('if (typeof currentLocale !== "undefined" && currentLocale === "ko") playGameResultVoiceOnce');
    expect(finish).toContain('else if (typeof announceContinuation === "function") announceContinuation("FINAL"');
  });
});
