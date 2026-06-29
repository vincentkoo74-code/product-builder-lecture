// RPS v2 통합 엔진 — 이벤트 정의 (Event-Sourced / Server-Authoritative-ready)
//
// 이 엔진은 "isomorphic"이다: 지금은 호스트 클라이언트에서 권위 실행(single source of
// truth)되고, 동일 코드를 그대로 서버(Edge Function/게임서버)로 이전할 수 있다. DOM·클라이언트
// 시계에 의존하지 않으며, 모든 이벤트는 sequenceId(순서) + eventId(중복제거) + ts(server timestamp)를
// 가진다.

export const EVENT_TYPES = Object.freeze({
  GAME_START: 'GAME_START',         // 게임 시작(참가자·목표 술래 수 확정)
  PLAYER_READY: 'PLAYER_READY',      // 플레이어 준비 완료(전원 ready → 시작 트리거 근거)
  COUNTDOWN_START: 'COUNTDOWN_START',// 카운트다운 시작(서버 시각 기준 동시 시작)
  COUNTDOWN_END: 'COUNTDOWN_END',    // 카운트다운 종료 → 선택 단계
  PLAYER_ACTION: 'PLAYER_ACTION',    // 플레이어 선택(가위/바위/보)
  ROUND_RESULT: 'ROUND_RESULT',      // 라운드 판정(엔진이 game-logic으로 계산)
  NEXT_ROUND: 'NEXT_ROUND',          // 다음 라운드(재대결)
  HOST_TRANSFER: 'HOST_TRANSFER',    // 호스트 승계
  PLAYER_JOIN: 'PLAYER_JOIN',        // 참가자 입장
  PLAYER_LEAVE: 'PLAYER_LEAVE',      // 참가자 퇴장
  GAME_OVER: 'GAME_OVER',            // 게임 종료
});

// 클라이언트가 반응(재생)하는 파생 사운드 이벤트 종류. 엔진은 "전역 사실"만 방출하고,
// 어떤 소리를 낼지는 클라이언트가 자기 정체성(perPlayer 결과)에 따라 결정한다(audio = event reaction).
export const SOUND_EVENTS = Object.freeze({
  COUNTDOWN: 'COUNTDOWN',
  ROUND_RESULT: 'ROUND_RESULT',
  PLAYER_JOIN: 'PLAYER_JOIN',
  PLAYER_LEAVE: 'PLAYER_LEAVE',
});

/**
 * 이벤트 팩토리. eventId는 중복제거 키, seq는 전역 순서, ts는 서버 시각(주입).
 * @param {string} type EVENT_TYPES 값
 * @param {object} payload 이벤트 데이터(불변 복사됨)
 * @param {{seq?:number, ts?:number, actorId?:string, id?:string}} meta
 */
export function makeEvent(type, payload = {}, meta = {}) {
  const seq = Number.isInteger(meta.seq) ? meta.seq : null;
  const ts = Number.isFinite(meta.ts) ? meta.ts : 0;
  const actorId = meta.actorId || null;
  // eventId: 명시값 우선, 없으면 (type:seq:actor)로 결정론적 부여 → 같은 논리 이벤트의 중복 무시
  const id = meta.id || `${type}:${seq}:${actorId || ''}`;
  return Object.freeze({ id, seq, ts, type, actorId, payload: Object.freeze({ ...payload }) });
}
