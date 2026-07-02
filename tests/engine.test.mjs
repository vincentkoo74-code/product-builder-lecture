import { describe, it, expect } from 'vitest';
import {
  createEngine, makeEvent, applyEvent, initialState, EVENT_TYPES, SOUND_EVENTS,
} from '../engine/index.mjs';

// 고정 시계(서버 timestamp 주입) → 결정론
const clock = () => 1000;

function startTwoPlayerGame(engine, target = 1) {
  engine.dispatch(EVENT_TYPES.GAME_START, {
    participants: [{ id: 'h', isHost: true }, { id: 'a', isHost: false }],
    targetLoserCount: target,
  });
  engine.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
  engine.dispatch(EVENT_TYPES.COUNTDOWN_END);
}

describe('GameEngine — 판정 규칙 통합(game-logic 재사용)', () => {
  it('2인 rock vs scissors → win/lose, gameOver(목표 1)', () => {
    const e = createEngine({ now: clock });
    startTwoPlayerGame(e, 1);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'scissors' });
    e.dispatch(EVENT_TYPES.ROUND_RESULT);
    const s = e.getState();
    expect(s.lastResult.perPlayer).toEqual({ h: 'win', a: 'lose' });
    expect(s.lastResult.outcome).toBe('gameOver');
    expect(s.confirmedLoserIds).toEqual(['a']);
    expect(s.phase).toBe('game_over');
  });

  it('전원 동일 선택 → allDraw(재대결, 미완료)', () => {
    const e = createEngine({ now: clock });
    startTwoPlayerGame(e, 1);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    e.dispatch(EVENT_TYPES.ROUND_RESULT);
    const s = e.getState();
    expect(s.lastResult.outcome).toBe('allDraw');
    expect(s.phase).toBe('result');
    expect(s.confirmedLoserIds).toEqual([]);
  });

  it('GAME_START는 maxLoserCountFor로 목표 술래 수를 clamp(3인 target 5 → 2)', () => {
    const e = createEngine({ now: clock });
    e.dispatch(EVENT_TYPES.GAME_START, {
      participants: [{ id: 'h', isHost: true }, { id: 'a' }, { id: 'b' }],
      targetLoserCount: 5,
    });
    expect(e.getState().targetLoserCount).toBe(2);
  });
});

describe('EventBus — 중복제거 + 순서 보장', () => {
  it('동일 eventId 두 번 → 1회만 적용', () => {
    const e = createEngine({ now: clock });
    const ev = makeEvent(EVENT_TYPES.PLAYER_JOIN, { player: { id: 'x' } }, { seq: 0, ts: 1000, id: 'dup-1' });
    e.ingest(ev);
    e.ingest(ev); // 중복
    expect(e.getState().participants.filter((p) => p.id === 'x').length).toBe(1);
    expect(e.log.size).toBe(1);
  });

  it('out-of-order seq(2 먼저, 1 나중) → 1,2 순서로 적용', () => {
    const e = createEngine({ now: clock });
    const e1 = makeEvent(EVENT_TYPES.PLAYER_JOIN, { player: { id: 'p1' } }, { seq: 0, ts: 1000, id: 'j0' });
    const e2 = makeEvent(EVENT_TYPES.PLAYER_JOIN, { player: { id: 'p2' } }, { seq: 1, ts: 1000, id: 'j1' });
    e.ingest(e2); // 미래 seq → 버퍼
    expect(e.getState().participants.length).toBe(0);
    e.ingest(e1); // 빈 자리 채움 → e1, e2 순서대로 flush
    expect(e.getState().participants.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('이미 지난 seq → stale 폐기', () => {
    const e = createEngine({ now: clock });
    e.ingest(makeEvent(EVENT_TYPES.PLAYER_JOIN, { player: { id: 'p1' } }, { seq: 0, ts: 1000, id: 'a0' }));
    const stale = makeEvent(EVENT_TYPES.PLAYER_JOIN, { player: { id: 'old' } }, { seq: 0, ts: 1000, id: 'a0b' });
    const r = e.ingest(stale);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('stale');
    expect(e.getState().participants.some((p) => p.id === 'old')).toBe(false);
  });
});

describe('결정론 + replay', () => {
  it('같은 이벤트열 → 두 엔진 상태 동일', () => {
    const build = () => {
      const e = createEngine({ now: clock });
      startTwoPlayerGame(e, 1);
      e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'paper' });
      e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
      e.dispatch(EVENT_TYPES.ROUND_RESULT);
      return e.getState();
    };
    expect(build()).toEqual(build());
  });

  it('replay(로그 재적용) === 라이브 상태', () => {
    const e = createEngine({ now: clock });
    startTwoPlayerGame(e, 1);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'scissors' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'paper' });
    e.dispatch(EVENT_TYPES.ROUND_RESULT);
    expect(e.replay()).toEqual(e.getState());
  });
});

describe('호스트 승계 (server화)', () => {
  it('HOST_TRANSFER → hostId·is_host 갱신', () => {
    const e = createEngine({ now: clock });
    e.dispatch(EVENT_TYPES.GAME_START, {
      participants: [{ id: 'h', isHost: true }, { id: 'a' }],
      targetLoserCount: 1,
    });
    e.dispatch(EVENT_TYPES.HOST_TRANSFER, { newHostId: 'a' });
    const s = e.getState();
    expect(s.hostId).toBe('a');
    expect(s.participants.find((p) => p.id === 'a').isHost).toBe(true);
    expect(s.participants.find((p) => p.id === 'h').isHost).toBe(false);
  });
});

describe('Audio = event reaction (dedup 필수)', () => {
  it('동일 라운드 ROUND_RESULT 2회(재진입) → 사운드 1개(round 키 dedup)', () => {
    const e = createEngine({ now: clock });
    startTwoPlayerGame(e, 1);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'scissors' });
    // result → game_over 전이로 동일 라운드 ROUND_RESULT가 두 번 적용되는 상황 모사
    e.dispatch(EVENT_TYPES.ROUND_RESULT); // 1차 (gameRound:round = 1:1)
    e.dispatch(EVENT_TYPES.ROUND_RESULT); // 2차 (같은 1:1 키)
    const sounds = e.getState().audioEvents.filter((a) => a.type === SOUND_EVENTS.ROUND_RESULT);
    expect(sounds.length).toBe(1);
  });

  it('COUNTDOWN_START → intro 사운드 이벤트 1개', () => {
    const e = createEngine({ now: clock });
    e.dispatch(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    const intro = e.getState().audioEvents.filter((a) => a.type === SOUND_EVENTS.COUNTDOWN);
    expect(intro.length).toBe(1);
    expect(e.getState().countdownStartAt).toBe(1500); // server timestamp
  });
});

describe('순수 reducer applyEvent', () => {
  it('초기상태에 GAME_OVER 적용 시 phase 전이, 입력 불변(immutable)', () => {
    const s0 = initialState();
    const s1 = applyEvent(s0, makeEvent(EVENT_TYPES.GAME_OVER, {}, { seq: 0, ts: 0 }));
    expect(s1.phase).toBe('game_over');
    expect(s0.phase).toBe('lobby'); // 원본 불변
  });
});
