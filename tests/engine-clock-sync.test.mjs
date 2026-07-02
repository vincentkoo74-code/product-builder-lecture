import { describe, it, expect } from 'vitest';
import { createClockSync } from '../engine/clock-sync.mjs';

// WRPS-049 STEP2.2c FINAL — 타이밍 정규화(latency/jitter) 결정론 검증.
// 실 wall-clock drift는 실기기 영역. 여기선 "RTT 샘플로 각 디바이스가 server offset을 추정해
// 동일 serverTs를 같은 서버 순간으로 정렬"하는 알고리즘의 정확도/정렬 스프레드를 입증한다.

function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff; }
const S_BASE = 1_000_000;

// 디바이스 모사: 로컬시계 = 서버 + skew. 대칭 RTT + jitter로 5샘플 수집.
function simulateDevice(skew, rttBase, jitterMs, seed) {
  const cs = createClockSync({ windowSize: 5 });
  const rng = lcg(seed);
  for (let i = 0; i < 5; i++) {
    const S0 = S_BASE + i * 1000;
    const rtt = Math.max(0, rttBase + Math.round((rng() - 0.5) * jitterMs));
    const serverMs = S0 + rtt / 2;          // 대칭 가정(서버 응답시각)
    const t0 = S0 + skew;                    // 로컬 송신
    const t1 = S0 + rtt + skew;              // 로컬 수신
    cs.addSample({ serverMs, t0, t1 });
  }
  return cs;
}

describe('STEP2.2c FINAL — ClockSync offset 추정 정확도', () => {
  it('대칭 RTT(지터 작음) → offset ≈ -skew (오차 작음)', () => {
    for (const skew of [0, 80, -120, 250]) {
      const cs = simulateDevice(skew, 100, 10, 99);
      expect(Math.abs(cs.offset() - (-skew))).toBeLessThan(10); // 지터/2 이내
    }
  });

  it('적응형 지터 버퍼: RTT/변동 클수록 커지고 50~120ms로 클램프', () => {
    const low = simulateDevice(0, 20, 5, 1);
    const high = simulateDevice(0, 400, 200, 2);
    expect(low.jitterBufferMs()).toBeGreaterThanOrEqual(50);
    expect(low.jitterBufferMs()).toBeLessThanOrEqual(120);
    expect(high.jitterBufferMs()).toBe(120);             // 큰 RTT/지터 → 상한
    expect(high.jitterBufferMs()).toBeGreaterThanOrEqual(low.jitterBufferMs());
  });
});

describe('STEP2.2c FINAL — 멀티디바이스 서버시각 정렬 (0/100/300/500ms)', () => {
  it('서로 다른 skew+RTT여도 동일 serverTs를 같은 서버 순간으로 정렬(스프레드 < 100ms)', () => {
    // 3 디바이스: (skew, rttBase) — 0/300/500ms 지연 + 클럭 스큐
    const devices = [
      simulateDevice(0, 0, 4, 11),
      simulateDevice(80, 300, 40, 22),
      simulateDevice(-120, 500, 60, 33),
    ];
    const serverTs = S_BASE + 50_000; // 공유 예정 시각(예: countdownStartAt)

    // 각 디바이스가 실행할 로컬 시각 → 그 순간의 실제 서버시각으로 환산(= local - skew)
    const skews = [0, 80, -120];
    const serverInstants = devices.map((cs, i) => {
      const localExec = cs.localTimeFor(serverTs);  // 디바이스가 정렬하는 로컬 시각
      return localExec - skews[i];                  // 그 로컬 시각의 실제 서버시각
    });
    const spread = Math.max(...serverInstants) - Math.min(...serverInstants);
    expect(spread).toBeLessThan(100);               // 모든 기기가 ±<100ms 내 동일 순간에 실행

    // 각 디바이스 serverNow도 실제 서버시각에 근접
    devices.forEach((cs, i) => {
      const localNow = S_BASE + 12_345 + skews[i];
      expect(Math.abs(cs.serverNow(localNow) - (S_BASE + 12_345))).toBeLessThan(60);
    });
  });

  it('100ms 지연 디바이스도 정렬 오차 작음', () => {
    const cs = simulateDevice(40, 100, 15, 7);
    const serverTs = S_BASE + 20_000;
    const localExec = cs.localTimeFor(serverTs);
    const actualServerInstant = localExec - 40;
    expect(Math.abs(actualServerInstant - serverTs)).toBeLessThan(30);
  });
});
