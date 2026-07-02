// engine/adapters/supabase.mjs
// 현행 Supabase 데이터(rooms/participants row, 인코딩된 choice) ↔ v2 엔진 입력/뷰 매핑.
// 전부 순수 함수(부수효과 0) — 라이브 index.html을 건드리지 않고 점진 통합(Strangler Fig)을 가능케 한다.
//
// 핵심 원칙:
//  - 게임 규칙은 엔진/ game-logic에 있음. 어댑터는 "형태 변환"만 한다.
//  - choice 디코딩은 클라이언트의 기존 getChoiceBase를 주입받아 재사용(파싱 로직 중복/분기 금지).
//  - audio는 엔진이 방출한 전역 사운드 이벤트를 "내 정체성(myId)" 기준 구체 사운드로 매핑(event reaction).

import { SOUND_EVENTS } from '../events.mjs';

/** participants row[] → 엔진 participants [{id, isHost}] */
export function participantRowsToParticipants(rows) {
  return (rows || [])
    .filter((r) => r && r.id)
    .map((r) => ({ id: r.id, isHost: !!(r.is_host || r.isHost) }));
}

/**
 * 이번 라운드 PLAYER_ACTION 입력 [{playerId, base}] 도출.
 * @param {Array} rows participants row[]
 * @param {(choice:any)=>(string|null)} getBase 클라이언트 getChoiceBase 주입(rock/paper/scissors|null)
 */
export function participantRowsToActions(rows, getBase) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    const base = getBase ? getBase(r.choice) : null;
    if (base === 'rock' || base === 'paper' || base === 'scissors') {
      out.push({ playerId: r.id, base });
    }
  }
  return out;
}

/**
 * room row(+파싱된 penalty) → 게임 설정.
 * @param {object} roomRow
 * @param {object} penalty parsePenalty(room.penalty) 결과(주입)
 */
export function roomToGameConfig(roomRow = {}, penalty = {}) {
  return {
    status: roomRow.status || null,
    round: Number(roomRow.round) || 1,
    gameRound: Number(penalty.gameRound) || 1,
    targetLoserCount: Number(penalty.loserCount) || 1,
    countdownStartAt: Number(penalty.countdownStartAt) || 0, // server timestamp
  };
}

/**
 * 엔진 state → 렌더 뷰모델(내 관점). 클라이언트는 이것만 보고 화면을 그린다(결정 로직 없음).
 * @param {object} state 엔진 상태
 * @param {string} myId 내 참가자 id
 */
export function engineStateToView(state, myId) {
  const s = state || {};
  const perPlayer = (s.lastResult && s.lastResult.perPlayer) || {};
  const confirmedLoser = (s.confirmedLoserIds || []).includes(myId);
  const confirmedSafe = (s.confirmedSafeIds || []).includes(myId);
  return {
    phase: s.phase,
    gameRound: s.gameRound,
    round: s.round,
    countdownStartAt: s.countdownStartAt, // 클라이언트는 serverNow()와 비교만(로컬 시계 권위 금지)
    participants: (s.participants || []).map((p) => ({
      id: p.id,
      isHost: !!p.isHost,
      isMe: p.id === myId,
    })),
    hostId: s.hostId,
    myResult: perPlayer[myId] || null,       // 'win'|'lose'|'draw'|null
    iAmConfirmedLoser: confirmedLoser,
    iAmConfirmedSafe: confirmedSafe,
    outcome: (s.lastResult && s.lastResult.outcome) || null,
    isComplete: !!(s.lastResult && s.lastResult.isComplete),
  };
}

/**
 * 엔진 audioEvents → 내가 재생할 구체 사운드 키 목록(event reaction, dedup은 엔진이 이미 보장).
 * 반환 키는 SoundManager 트리거명과 1:1: 'intro' | 'win' | 'lose' | 'draw' | 'joinMeow' | 'leaveMeow'
 * @param {Array} audioEvents
 * @param {string} myId
 * @param {object} state 결과 사운드의 승/패/무 매핑에 perPlayer 필요
 * @param {string|null} sinceDedup 마지막으로 처리한 dedup 키(그 이후만 반환) — 선택
 */
export function audioEventsToSounds(audioEvents, myId, state, alreadyPlayed = new Set()) {
  const sounds = [];
  const perPlayer = (state && state.lastResult && state.lastResult.perPlayer) || {};
  for (const ev of audioEvents || []) {
    if (alreadyPlayed.has(ev.dedup)) continue; // 클라이언트 측 재생 멱등
    let key = null;
    switch (ev.type) {
      case SOUND_EVENTS.COUNTDOWN:
        key = 'intro';
        break;
      case SOUND_EVENTS.ROUND_RESULT: {
        const r = perPlayer[myId];
        key = r === 'win' ? 'win' : r === 'lose' ? 'lose' : r === 'draw' ? 'draw'
          : ((ev.data && ev.data.outcome) === 'allDraw' ? 'draw' : null);
        break;
      }
      case SOUND_EVENTS.PLAYER_JOIN:
        key = (ev.data && ev.data.playerId) === myId ? null : 'joinMeow'; // 내 입장음은 생략
        break;
      case SOUND_EVENTS.PLAYER_LEAVE:
        key = 'leaveMeow';
        break;
      default:
        key = null;
    }
    if (key) sounds.push({ key, dedup: ev.dedup });
  }
  return sounds;
}
