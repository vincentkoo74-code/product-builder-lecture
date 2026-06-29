// GameEngine — 권위 상태 reducer (Single Source of Truth)
//
// 게임 규칙(judge/elimination)은 기존 src/game-logic.mjs를 그대로 재사용한다(규칙 변경 금지).
// 이 reducer는 순수 함수다: (state, event) → nextState. DOM·랜덤·클라이언트 시계 없음.
//   → 지금은 호스트가 실행(host-authoritative), 나중에 서버로 그대로 이전 가능.
//
// 상태(state)는 서버가 결정하는 단일 진실원이며 클라이언트는 이를 구독해 render/audio만 한다:
//   gameState(phase) · roundState · participantsState · resultState · audioEventState

import { judgePure, resolveElimination, maxLoserCountFor } from '../src/game-logic.mjs';
import { EVENT_TYPES, SOUND_EVENTS } from './events.mjs';

export function initialState() {
  return {
    phase: 'lobby',            // lobby | ready | countdown | playing | result | game_over
    gameRound: 0,
    round: 0,
    countdownStartAt: 0,        // server timestamp (클라이언트 시계 사용 금지)
    participants: [],           // [{ id, isHost }]
    hostId: null,
    confirmedLoserIds: [],
    confirmedSafeIds: [],
    targetLoserCount: 1,
    roundChoices: {},           // id → base ('rock'|'paper'|'scissors')
    lastResult: null,           // { outcome, perPlayer:{id:'win'|'lose'|'draw'}, isComplete }
    audioEvents: [],            // [{ type, dedup, ts, data }] — 클라이언트가 반응(중복키 1회)
    audioKeys: [],              // 방출된 audio dedup 키(직렬화 가능)
    lastSeq: -1,
  };
}

function pushAudio(s, type, dedup, ts, data = null) {
  if (s.audioKeys.includes(dedup)) return;  // 중복 사운드 이벤트 무시(dedup 필수)
  s.audioKeys = [...s.audioKeys, dedup];
  s.audioEvents = [...s.audioEvents, { type, dedup, ts, data }];
}

/**
 * 권위 reducer. 동일 이벤트열 → 항상 동일 상태(결정론).
 * bus/log가 이미 중복·순서를 보장하지만, replay 안전을 위해 seq 가드도 둔다.
 */
export function applyEvent(state, ev) {
  if (!ev || ev.type == null) return state;
  if (ev.seq != null && ev.seq <= state.lastSeq) return state; // 이미 적용(중복/과거)

  const s = {
    ...state,
    participants: state.participants.map((p) => ({ ...p })),
    confirmedLoserIds: [...state.confirmedLoserIds],
    confirmedSafeIds: [...state.confirmedSafeIds],
    roundChoices: { ...state.roundChoices },
    audioEvents: [...state.audioEvents],
    audioKeys: [...state.audioKeys],
  };
  if (ev.seq != null) s.lastSeq = ev.seq;
  const ts = ev.ts || 0;
  const p = ev.payload || {};

  switch (ev.type) {
    case EVENT_TYPES.GAME_START: {
      s.participants = (p.participants || []).map((x) => ({ id: x.id, isHost: !!x.isHost }));
      s.hostId = p.hostId || (s.participants.find((x) => x.isHost)?.id ?? null);
      s.gameRound = (state.gameRound || 0) + 1;
      s.round = 1;
      s.confirmedLoserIds = [];
      s.confirmedSafeIds = [];
      s.roundChoices = {};
      s.targetLoserCount = Math.min(
        Math.max(1, Number(p.targetLoserCount) || 1),
        maxLoserCountFor(s.participants.length),
      );
      s.phase = 'ready';
      s.lastResult = null;
      break;
    }
    case EVENT_TYPES.COUNTDOWN_START: {
      s.phase = 'countdown';
      s.countdownStartAt = Number(p.countdownStartAt) || ts;
      s.roundChoices = {};
      pushAudio(s, SOUND_EVENTS.COUNTDOWN, `${s.gameRound}:${s.round}:intro`, ts);
      break;
    }
    case EVENT_TYPES.COUNTDOWN_END: {
      s.phase = 'playing';
      break;
    }
    case EVENT_TYPES.PLAYER_ACTION: {
      if (p.playerId && p.base) s.roundChoices[p.playerId] = p.base;
      break;
    }
    case EVENT_TYPES.ROUND_RESULT: {
      const confirmed = new Set([...s.confirmedLoserIds, ...s.confirmedSafeIds]);
      const active = s.participants
        .filter((pt) => !confirmed.has(pt.id) && s.roundChoices[pt.id])
        .map((pt) => ({ id: pt.id, base: s.roundChoices[pt.id] }));
      const results = judgePure(active);                       // ← 규칙 변경 없음
      const roundResults = active.map((a) => ({ id: a.id, result: results[a.id] }));
      const elim = resolveElimination({                        // ← 규칙 변경 없음
        roundResults,
        prevLoserIds: s.confirmedLoserIds,
        prevSafeIds: s.confirmedSafeIds,
        targetLoserCount: s.targetLoserCount,
      });
      s.confirmedLoserIds = elim.newConfirmedLoserIds;
      s.confirmedSafeIds = elim.newConfirmedSafeIds;
      s.lastResult = { outcome: elim.outcome, perPlayer: results, isComplete: elim.isComplete };
      s.phase = elim.isComplete ? 'game_over' : 'result';
      // 전역 사실만 방출 — 승/패/무 사운드는 클라이언트가 perPlayer[myId]로 결정
      pushAudio(s, SOUND_EVENTS.ROUND_RESULT, `${s.gameRound}:${s.round}:result`, ts, { outcome: elim.outcome });
      break;
    }
    case EVENT_TYPES.NEXT_ROUND: {
      s.round = (state.round || 1) + 1;
      s.roundChoices = {};
      s.phase = 'ready';
      s.lastResult = null;
      break;
    }
    case EVENT_TYPES.HOST_TRANSFER: {
      if (p.newHostId) {
        s.hostId = p.newHostId;
        s.participants = s.participants.map((pt) => ({ ...pt, isHost: pt.id === p.newHostId }));
      }
      break;
    }
    case EVENT_TYPES.PLAYER_JOIN: {
      const pl = p.player;
      if (pl && pl.id && !s.participants.some((pt) => pt.id === pl.id)) {
        s.participants = [...s.participants, { id: pl.id, isHost: !!pl.isHost }];
        pushAudio(s, SOUND_EVENTS.PLAYER_JOIN, `join:${ev.id}`, ts, { playerId: pl.id });
      }
      break;
    }
    case EVENT_TYPES.PLAYER_LEAVE: {
      if (p.playerId && s.participants.some((pt) => pt.id === p.playerId)) {
        s.participants = s.participants.filter((pt) => pt.id !== p.playerId);
        pushAudio(s, SOUND_EVENTS.PLAYER_LEAVE, `leave:${ev.id}`, ts, { playerId: p.playerId });
      }
      break;
    }
    case EVENT_TYPES.GAME_OVER: {
      s.phase = 'game_over';
      break;
    }
    default:
      break;
  }
  return s;
}
