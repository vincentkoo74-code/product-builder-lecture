// engine/sync.mjs — 동기화 계층 (전송 ↔ 엔진 사이)
// WRPS-049 STEP2.2c FINAL: 서버 시각 권위 + 순서(sequenceId) 정규화 + drift 계측/조정.
//
// 원칙: 게임 로직/이벤트 구조/UI 무변경. 엔진 ingest(seq 순서 보장 + eventId 중복 + stale 거부)를
//       감싸 "서버 시각 권위"와 "drift 계측/정책"만 더한다.
//
// 결정론 보장(이미 엔진이 제공): 모든 복제본은 같은 eventId를 1회, 같은 sequenceId 순서로 적용 →
//   "주어진 이벤트 집합"에 대해 항상 동일 상태로 수렴(논리적 drift 0). SyncLayer는 이를 계측하고,
//   클라이언트 로컬 시계를 순서 판단에 절대 쓰지 않음(순서 = seq, 시각 = 서버 ts)을 강제한다.
//
// ⚠️ 드롭 정책: ts drift가 윈도우를 넘어도 "게임 상태 이벤트"는 드롭하지 않는다(늦은 PLAYER_ACTION을
//    버리면 게임 결과가 바뀜 = 게임 로직 변경). drift는 계측·플래그만 하고, 순서 위반(stale seq)은
//    엔진이 결정론적으로 거부한다. 이것이 "NO game logic change" 원칙에 맞는 안전한 동기화다.

export function createSyncLayer(engine, { now = () => 0, driftWindowMs = 150 } = {}) {
  const metrics = {
    ingested: 0,
    applied: 0,        // 즉시 순서대로 적용
    buffered: 0,       // 미래 seq → 재정렬 버퍼(빈자리 채워지면 flush)
    duplicate: 0,      // eventId 중복 무시
    stale: 0,          // 이미 지난 seq → 순서 위반 거부(= ordering mismatch 방지)
    driftFlagged: 0,   // |ts - serverNow| > window (계측만, 드롭 안 함)
    maxDriftMs: 0,
    sumDriftMs: 0,
    driftSamples: 0,
  };

  function avgDrift() { return metrics.driftSamples ? metrics.sumDriftMs / metrics.driftSamples : 0; }

  function ingest(ev) {
    metrics.ingested++;
    // 서버 시각 권위: 이벤트의 서버 ts와 로컬 serverNow의 차이로 drift 계측.
    // (순서 판단엔 ts를 쓰지 않는다 — 순서는 오직 sequenceId.)
    if (ev && Number.isFinite(ev.ts) && ev.ts > 0) {
      const drift = Math.abs(now() - ev.ts);
      metrics.sumDriftMs += drift;
      metrics.driftSamples++;
      if (drift > metrics.maxDriftMs) metrics.maxDriftMs = drift;
      if (drift > driftWindowMs) metrics.driftFlagged++;
    }
    const r = engine.ingest(ev);
    if (!r.accepted) {
      if (r.reason === 'duplicate') metrics.duplicate++;
      else if (r.reason === 'stale') metrics.stale++;
    } else if (r.buffered) {
      metrics.buffered++;
    } else {
      metrics.applied++;
    }
    return r;
  }

  return { ingest, metrics, avgDrift };
}
