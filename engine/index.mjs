// RPS v2 통합 엔진 — 공개 API
//
// 사용(호스트/클라이언트, 현재 host-authoritative):
//   import { createEngine, EVENT_TYPES } from './engine/index.mjs';
//   const engine = createEngine({ now: () => serverNow() });   // 서버 시각 주입
//   engine.subscribe((state, ev) => { renderFrom(state); reactAudio(state.audioEvents); });
//   engine.dispatch(EVENT_TYPES.GAME_START, { participants, targetLoserCount });
//
// 서버 권위 전환 시: 서버가 createEngine을 실행하고 dispatch만 서버에서 수행,
// 클라이언트는 engine.ingest(서버이벤트)로 동일 상태를 재구성(코드 무변경).

import { EVENT_TYPES, SOUND_EVENTS, makeEvent } from './events.mjs';
import { createEventBus } from './EventBus.mjs';
import { createEventLog } from './EventLog.mjs';
import { initialState, applyEvent } from './GameEngine.mjs';

export { EVENT_TYPES, SOUND_EVENTS, makeEvent, createEventBus, createEventLog, initialState, applyEvent };

/**
 * @param {{ now?: () => number }} opts now: 서버 시각 제공자(기본 0 — 결정론 테스트용).
 *   클라이언트에서는 () => serverNow()를 주입한다(클라이언트 로컬 시계 사용 금지).
 */
export function createEngine({ now = () => 0 } = {}) {
  const bus = createEventBus();
  const log = createEventLog();
  let state = initialState();
  let seq = 0;
  const subs = new Set();

  // 단일 적용 경로: bus가 순서·중복을 보장 → reducer는 각 이벤트를 1회·순서대로 받는다.
  bus.on('*', (ev) => {
    state = applyEvent(state, ev);
    subs.forEach((fn) => fn(state, ev));
  });

  // 권위 측(현재 호스트, 미래 서버)이 새 이벤트를 생성·기록·방출한다.
  function dispatch(type, payload = {}, meta = {}) {
    const ev = makeEvent(type, payload, {
      seq: seq++,
      ts: Number.isFinite(meta.ts) ? meta.ts : now(),
      actorId: meta.actorId,
      id: meta.id,
    });
    log.append(ev);
    return bus.emit(ev);
  }

  // 외부(서버/peer)에서 도착한 이벤트를 수용 — 중복/순서는 bus가 처리.
  function ingest(ev) {
    if (ev && ev.seq != null && ev.seq >= seq) seq = ev.seq + 1;
    log.append(ev);
    return bus.emit(ev);
  }

  return {
    dispatch,
    ingest,
    bus,
    log,
    getState: () => state,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    // 로그로부터 상태를 처음부터 재구성(결정론 검증/서버 복구용)
    replay: () => log.replay(applyEvent, initialState()),
  };
}
