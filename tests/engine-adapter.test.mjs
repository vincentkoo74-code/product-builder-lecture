import { describe, it, expect } from 'vitest';
import {
  participantRowsToParticipants, participantRowsToActions, roomToGameConfig,
  engineStateToView, audioEventsToSounds,
} from '../engine/adapters/supabase.mjs';
import { createEngine, EVENT_TYPES, SOUND_EVENTS } from '../engine/index.mjs';

// 클라이언트 getChoiceBase를 모사(주입) — 마커/빈값은 null
const getBase = (c) => {
  if (!c || c === '__safe__' || c === '__loser__' || c === '__waiting__') return null;
  const m = String(c).split(':')[0];
  return ['rock', 'paper', 'scissors'].includes(m) ? m : null;
};

describe('supabase adapter — 형태 변환(순수)', () => {
  it('participants row → 엔진 participants', () => {
    const rows = [{ id: 'h', is_host: true }, { id: 'a', is_host: false }];
    expect(participantRowsToParticipants(rows)).toEqual([
      { id: 'h', isHost: true }, { id: 'a', isHost: false },
    ]);
  });

  it('participants row → PLAYER_ACTION 입력(마커/빈값 제외)', () => {
    const rows = [
      { id: 'h', choice: 'rock:win' }, { id: 'a', choice: 'scissors' },
      { id: 'b', choice: '__safe__' }, { id: 'c', choice: null },
    ];
    expect(participantRowsToActions(rows, getBase)).toEqual([
      { playerId: 'h', base: 'rock' }, { playerId: 'a', base: 'scissors' },
    ]);
  });

  it('room + penalty → 게임 설정(server timestamp 포함)', () => {
    const cfg = roomToGameConfig({ status: 'playing', round: 2 }, { gameRound: 3, loserCount: 2, countdownStartAt: 1700000000000 });
    expect(cfg).toEqual({ status: 'playing', round: 2, gameRound: 3, targetLoserCount: 2, countdownStartAt: 1700000000000 });
  });

  it('engineStateToView — 내 관점 결과 매핑', () => {
    const e = createEngine({ now: () => 1000 });
    e.dispatch(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_END);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'scissors' });
    e.dispatch(EVENT_TYPES.ROUND_RESULT);
    const viewH = engineStateToView(e.getState(), 'h');
    const viewA = engineStateToView(e.getState(), 'a');
    expect(viewH.myResult).toBe('win');
    expect(viewA.myResult).toBe('lose');
    expect(viewA.iAmConfirmedLoser).toBe(true);
    expect(viewH.phase).toBe('game_over');
    expect(viewH.participants.find((p) => p.id === 'h').isMe).toBe(true);
  });
});

describe('supabase adapter — audio = event reaction(내 정체성 매핑)', () => {
  it('ROUND_RESULT 전역 이벤트 → 승자=win, 패자=lose', () => {
    const e = createEngine({ now: () => 1000 });
    e.dispatch(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_END);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'scissors' });
    e.dispatch(EVENT_TYPES.ROUND_RESULT);
    const st = e.getState();
    expect(audioEventsToSounds(st.audioEvents, 'h', st).map((s) => s.key)).toContain('win');
    expect(audioEventsToSounds(st.audioEvents, 'a', st).map((s) => s.key)).toContain('lose');
    // COUNTDOWN → intro 포함
    expect(audioEventsToSounds(st.audioEvents, 'h', st).map((s) => s.key)).toContain('intro');
  });

  it('alreadyPlayed(dedup) 통과한 사운드는 제외(클라이언트 재생 멱등)', () => {
    const e = createEngine({ now: () => 1000 });
    e.dispatch(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    const st = e.getState();
    const first = audioEventsToSounds(st.audioEvents, 'h', st);
    const played = new Set(first.map((s) => s.dedup));
    const second = audioEventsToSounds(st.audioEvents, 'h', st, played);
    expect(second.length).toBe(0);
  });
});
