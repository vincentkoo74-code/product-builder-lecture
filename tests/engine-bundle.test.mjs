import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildEngineBundle } from '../scripts/sync-engine.mjs';

// game-logic 을 인라인 형태(export 제거)로 변환 — index.html 인라인 스코프 모사.
async function inlineGameLogic() {
  const src = await readFile(new URL('../src/game-logic.mjs', import.meta.url), 'utf8');
  return src.replace(/^export\s+/gm, '');
}

// 번들 + game-logic 을 하나의 함수 스코프에서 평가해 RPSEngineV2 를 얻는다(런타임 인라인 모사).
async function evalInlineEngine() {
  const gl = await inlineGameLogic();
  const bundle = await buildEngineBundle();
  // game-logic 이 먼저(선행 정의) → 엔진 IIFE 가 그 심볼을 클로저로 참조
  const factory = new Function(`${gl}\n${bundle}\nreturn RPSEngineV2;`);
  return factory();
}

describe('WRPS-049 STEP2.1 — 엔진 인라인 번들 정합성', () => {
  it('번들에 모듈 구문(import/export)이 남지 않는다', async () => {
    const bundle = await buildEngineBundle();
    expect(bundle).not.toMatch(/^\s*import\s/m);
    expect(bundle).not.toMatch(/^\s*export\s/m);
    expect(bundle).toContain('const RPSEngineV2 =');
  });

  it('번들이 유효한 JS 로 평가되고 공개 API 를 노출한다', async () => {
    const E = await evalInlineEngine();
    for (const k of ['createEngine', 'EVENT_TYPES', 'createClient', 'engineStateToView', 'applyEvent']) {
      expect(E[k]).toBeDefined();
    }
  });

  it('인라인 번들 엔진이 game-logic 과 결합해 라운드를 정확히 판정한다', async () => {
    const E = await evalInlineEngine();
    const e = E.createEngine({ now: () => 1000 });
    e.dispatch(E.EVENT_TYPES.GAME_START, {
      participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1,
    });
    e.dispatch(E.EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    e.dispatch(E.EVENT_TYPES.COUNTDOWN_END);
    e.dispatch(E.EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    e.dispatch(E.EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'scissors' });
    e.dispatch(E.EVENT_TYPES.ROUND_RESULT);
    const s = e.getState();
    expect(s.lastResult.perPlayer).toEqual({ h: 'win', a: 'lose' });
    expect(s.lastResult.outcome).toBe('gameOver');
    expect(s.phase).toBe('game_over');
  });

  it('인라인 엔진도 결정론 replay 일치', async () => {
    const E = await evalInlineEngine();
    const e = E.createEngine({ now: () => 1000 });
    e.dispatch(E.EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    e.dispatch(E.EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    e.dispatch(E.EVENT_TYPES.COUNTDOWN_END);
    e.dispatch(E.EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'paper' });
    e.dispatch(E.EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    e.dispatch(E.EVENT_TYPES.ROUND_RESULT);
    expect(e.replay()).toEqual(e.getState());
  });
});
