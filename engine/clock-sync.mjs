// engine/clock-sync.mjs — 타이밍 정규화 계층 (latency/jitter compensation)
// WRPS-049 STEP2.2c FINAL: 게임로직/이벤트구조/엔진 무수정. "언제 실행할지"를 서버시각 기준으로 정렬한다.
//
// 핵심: 각 디바이스가 RTT 샘플로 자기 시계의 server offset을 추정(롤링 중앙값) → 동일 serverTs를
//   각자 로컬 시각으로 환산해 "같은 서버 순간"에 실행. 모든 디바이스가 같은 serverTs를 목표로 하면
//   추정 오차 범위 내에서 시각 정렬된다(가시적 desync 최소화).
//
// 적응형 지터 버퍼(50~120ms): RTT 변동이 클수록 버퍼를 키워 burst/late 이벤트를 흡수.

export function createClockSync({ windowSize = 5 } = {}) {
  const rttSamples = [];
  const offsetSamples = [];

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // 한 RTT 샘플 추가. { serverMs: 응답에 담긴 서버 시각, t0: 로컬 송신, t1: 로컬 수신 }
  // 최근 windowSize개만 유지(rolling average smoothing, last N).
  function addSample({ serverMs, t0, t1 }) {
    if (![serverMs, t0, t1].every(Number.isFinite)) return;
    const rtt = t1 - t0;
    // 응답 수신 시점(t1)의 서버시각 ≈ serverMs + rtt/2 → offset = (그 서버시각) - t1
    const offset = serverMs + rtt / 2 - t1;
    rttSamples.push(rtt); if (rttSamples.length > windowSize) rttSamples.shift();
    offsetSamples.push(offset); if (offsetSamples.length > windowSize) offsetSamples.shift();
  }

  function offset() { return median(offsetSamples); }     // 롤링 중앙값(이상치/지터 방어)
  function rtt() { return median(rttSamples); }
  function serverNow(localNow) { return localNow + offset(); }
  // 이 serverTs를 "지금 칠" 로컬 시각(= 디바이스가 실행을 정렬할 시점)
  function localTimeFor(serverTs) { return serverTs - offset(); }

  // 적응형 지터 버퍼: RTT 중앙값/2 + 변동/2, 50~120ms 클램프.
  function jitterBufferMs() {
    if (rttSamples.length < 2) return 50;
    const jitter = Math.max(...rttSamples) - Math.min(...rttSamples);
    return Math.min(120, Math.max(50, Math.round(rtt() / 2 + jitter / 2)));
  }

  return {
    addSample, offset, rtt, serverNow, localTimeFor, jitterBufferMs,
    get samples() { return offsetSamples.length; },
  };
}
