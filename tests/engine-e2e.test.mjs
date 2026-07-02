import { describe, it, expect } from 'vitest';
import { createClient } from '../engine/client-binding.mjs';
import { EVENT_TYPES } from '../engine/index.mjs';

// 인메모리 transport 허브 — 멀티디바이스(호스트 권위 + 참가자) 모사.
// broadcast는 동기 전달(모두 ingest), 참가자 intent는 호스트 onIntent로 라우팅.
function createHub() {
  const eventSubs = new Set();
  let intentHandler = null;
  return {
    broadcast(ev) { for (const fn of [...eventSubs]) fn(ev); },
    onEvent(fn) { eventSubs.add(fn); return () => eventSubs.delete(fn); },
    sendIntent(intent) { if (intentHandler) intentHandler(intent); },
    onIntent(fn) { intentHandler = fn; },
  };
}

const NOW = () => 1000;

function setup() {
  const hub = createHub();
  const views = { h: null, a: null };
  const sounds = { h: [], a: [] };
  const host = createClient({
    myId: 'h', isHost: true, transport: hub, now: NOW,
    render: (v) => { views.h = v; }, playSound: (k) => sounds.h.push(k),
  });
  const part = createClient({
    myId: 'a', isHost: false, transport: hub, now: NOW,
    render: (v) => { views.a = v; }, playSound: (k) => sounds.a.push(k),
  });
  return { hub, host, part, views, sounds };
}

describe('e2e — 멀티디바이스 결정론 수렴(single source of truth)', () => {
  it('join→countdown→round play→result: 두 기기 상태 동일 + 내 관점 승/패 정확', () => {
    const { host, part, views, sounds } = setup();

    // 게임 시작(호스트 권위) — 참가자는 intent만 보내지만 여기선 호스트가 시작 이벤트 생성
    host.input(EVENT_TYPES.GAME_START, {
      participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1,
    });
    host.input(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    host.input(EVENT_TYPES.COUNTDOWN_END);

    // 입력: 참가자는 intent로(권위가 이벤트화), 호스트는 직접
    part.input(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'scissors' });
    host.input(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'rock' });
    host.input(EVENT_TYPES.ROUND_RESULT);

    // result consistency: 두 복제본 상태 완전 동일
    expect(host.engine.getState()).toEqual(part.engine.getState());

    // 내 관점 결과
    expect(views.h.myResult).toBe('win');
    expect(views.a.myResult).toBe('lose');
    expect(views.h.phase).toBe('game_over');
    expect(views.a.iAmConfirmedLoser).toBe(true);

    // 오디오: 이벤트 반응(중복 없음). 호스트=win, 참가자=lose, 둘 다 intro 1회
    expect(sounds.h).toContain('intro');
    expect(sounds.h).toContain('win');
    expect(sounds.a).toContain('lose');
    expect(sounds.h.filter((k) => k === 'intro').length).toBe(1);
    expect(sounds.h.filter((k) => k === 'win').length).toBe(1);
  });

  it('host transfer: 두 기기 모두 새 호스트로 수렴', () => {
    const { host, part } = setup();
    host.input(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    host.input(EVENT_TYPES.HOST_TRANSFER, { newHostId: 'a' });
    expect(host.engine.getState().hostId).toBe('a');
    expect(part.engine.getState().hostId).toBe('a');
    expect(host.engine.getState()).toEqual(part.engine.getState());
  });

  it('player leave: 두 기기 참가자 목록 일치 + 남은 기기 leave meow', () => {
    const { host, part, sounds } = setup();
    host.input(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }, { id: 'b' }], targetLoserCount: 1 });
    host.input(EVENT_TYPES.PLAYER_LEAVE, { playerId: 'b' });
    expect(host.engine.getState().participants.map((p) => p.id)).toEqual(['h', 'a']);
    expect(part.engine.getState().participants.map((p) => p.id)).toEqual(['h', 'a']);
    expect(sounds.h).toContain('leaveMeow');
  });

  it('replay consistency: 두 기기 모두 로그 재적용 === 라이브 상태', () => {
    const { host, part } = setup();
    host.input(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    host.input(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    host.input(EVENT_TYPES.COUNTDOWN_END);
    host.input(EVENT_TYPES.PLAYER_ACTION, { playerId: 'h', base: 'paper' });
    part.input(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    host.input(EVENT_TYPES.ROUND_RESULT);
    expect(host.verifyReplay()).toBe(true);
    expect(part.verifyReplay()).toBe(true);
  });

  it('중복 입력(같은 의도 2회) → 이벤트 중복 적용 없음(eventId dedup)', () => {
    const { host, part } = setup();
    host.input(EVENT_TYPES.GAME_START, { participants: [{ id: 'h', isHost: true }, { id: 'a' }], targetLoserCount: 1 });
    const before = host.engine.log.size;
    // 동일 seq/id 이벤트를 강제로 재브로드캐스트(네트워크 재전송 모사)
    const last = host.engine.log.entries().at(-1);
    host.engine.ingest(last);
    part.engine.ingest(last);
    expect(host.engine.log.size).toBe(before); // 증가 없음
    expect(host.engine.getState()).toEqual(part.engine.getState());
  });
});
