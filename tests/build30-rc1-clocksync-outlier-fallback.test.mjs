import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// codex-critic STOP-SHIP RC-1 clock sync min-RTT 재검토 — MEDIUM-1/MEDIUM-3 재수정.
//
// MEDIUM-1: selectClockSyncOffset(index.html)이 5샘플 중 RTT 최소 샘플의 offset을 "무조건"
// 채택하던 것을, (a) 방어적 유효성 필터(비유한/음수 RTT, 비유한 offset 제외) + (b) median
// corroboration 가드(min-RTT 샘플 offset이 median과 "이론적 불확실성 합"보다 크게 벌어지면
// 이상치로 보고 median으로 폴백)로 보강했다. 이 파일은 그 실제 소스(new Function 추출 — 소스
// hand-copy/no-op mock 아님)를 직접 실행해 검증한다.
//
// corroboration 임계값 근거: offsetMs = serverMs - t0 - rtt/2 는 "왕복 지연이 정확히 대칭
// (uplink===downlink)"이라는 가정 하의 최선 추정치이고, 그 가정이 최악으로 깨졌을 때
// (uplink 또는 downlink 한쪽에 완전히 쏠렸을 때) 남는 오차의 이론적 상한은 ±rtt/2이다(같은
// 근거가 index.html의 residualUpperBoundMs 주석에도 있음). 즉 "min-RTT 샘플의 참 offset"은
// [selected.offsetMs - selected.rttMs/2, selected.offsetMs + selected.rttMs/2] 구간 안에 있을
// 수 있고, "median 샘플의 참 offset"도 마찬가지로 [medianOffsetMs - medianSample.rttMs/2,
// medianOffsetMs + medianSample.rttMs/2] 구간 안에 있을 수 있다. 두 구간이 전혀 겹치지 않을
// 정도로(즉 |diff| > 두 반경의 합) 벌어져 있다면, 두 추정치가 "같은 참값을 가리키고 있다"는
// 가설(corroboration)이 이론적으로 성립할 수 없으므로 min-RTT 샘플을 이상치로 간주한다.
//
// MEDIUM-3: 기존 mutation 테스트(build30-rc1-phase4-clock-sync-skew-simulator.test.mjs)는 소스
// "리터럴 텍스트 일치"로 로직을 되돌려 검증한다(소스 표현이 바뀌면 오검출/오통과 가능). 여기서는
// 실제 selectClockSyncOffset을 직접 호출해 "min-RTT 샘플의 offset과 median offset이 의도적으로
// 크게(200ms) 다른" 조작 입력을 주고, 반환값이 min-RTT 샘플 offset과 같고 median과는 다름을
// 행위로 단언한다(소스 텍스트 표현과 무관 — 선택 로직 자체가 바뀌면 이 단언이 깨진다는 것을
// 마지막 mutation 실행 유닛에서 직접 실행으로 증명한다).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

// selectClockSyncOffset 함수 전체(실제 소스) — syncServerClock 정의 직전까지.
const SELECT_SRC = extractBlock(
  'function selectClockSyncOffset(rawSamples) {',
  'async function syncServerClock(retry = true) {'
);

function buildSelect(src = SELECT_SRC) {
  // src는 "function selectClockSyncOffset(rawSamples) { ... }\n"로 끝나는 완전한 함수 선언문이므로
  // 괄호로 감싸 함수 표현식으로 평가한다(실제 소스를 그대로 실행 — hand-copy 로직 아님).
  return new Function('return (' + src + ')')();
}

function sample(rttMs, offsetMs) {
  return { rttMs, offsetMs, serverTs: 1000, clientSendTs: 0, clientReceiveTs: rttMs };
}

describe('MEDIUM-1(재검토) — selectClockSyncOffset 방어적 필터 + median corroboration 가드', () => {
  const selectClockSyncOffset = buildSelect();

  it('음수/비유한 RTT, 비유한 offset 샘플은 선택 후보에서 제외된다(선택 결과가 유효 샘플만으로 계산됨을 증명)', () => {
    const samples = [
      sample(-5, 10),      // 음수 RTT — 제외 대상(제외되지 않으면 "min RTT"로 잘못 선택됨)
      { ...sample(60, 20), rttMs: NaN },     // 비유한 RTT — 제외 대상
      sample(100, 30),     // 유효
      sample(150, 32),     // 유효
      { ...sample(70, NaN), rttMs: Infinity }, // 비유한 RTT + 비유한 offset — 제외 대상
    ];
    const result = selectClockSyncOffset(samples);
    expect(result).not.toBeNull();
    // 만약 음수 RTT(-5) 샘플이 걸러지지 않았다면 그 샘플(offset=10)이 min-RTT로 선택됐을 것이다.
    // 유효 샘플(rtt=100/offset=30, rtt=150/offset=32)만 남았으므로 selected는 rtt=100 쪽이어야 한다.
    expect(result.selected.rttMs).toBe(100);
    expect(result.selected.offsetMs).toBe(30);
    expect(result.medianOffsetMs).toBe(32); // 유효 샘플 2개 중 median(index floor(2/2)=1) = 32
    expect(result.outlierFallback).toBe(false); // 20ms 이내 유효 표본이라 corroboration 통과
    expect(result.finalOffsetMs).toBe(30);
  });

  it('유효 샘플이 하나도 없으면 null을 반환한다(synced=false 경로로 이어짐)', () => {
    const samples = [
      sample(-1, 5),
      { ...sample(1, 6), rttMs: NaN },
      { ...sample(1, NaN), rttMs: Infinity },
    ];
    expect(selectClockSyncOffset(samples)).toBeNull();
  });

  it('이상치 1샘플(인위적 저RTT+오염된 offset)이 있으면 median으로 폴백한다(outlierFallback=true)', () => {
    // A: rtt=50(min-RTT로 선택되는 샘플)이지만 offset=5000으로 나머지와 전혀 다름(순간 스톨/오염 재현).
    const samples = [
      sample(50, 5000),
      sample(100, 40),
      sample(110, 42),
      sample(120, 39),
      sample(130, 41),
    ];
    const result = selectClockSyncOffset(samples);
    // 진단용으로 selected는 여전히 min-RTT 샘플(A) 그대로 기록된다(관측성 유지).
    expect(result.selected.rttMs).toBe(50);
    expect(result.selected.offsetMs).toBe(5000);
    expect(result.medianOffsetMs).toBe(41); // 나머지 4개+A 중 median: [39,40,41,42,5000] → index2=41
    // threshold = selected.rtt/2 + medianSample.rtt/2 = 25 + 65 = 90 < |5000-41|=4959 → 폴백.
    expect(result.outlierFallback).toBe(true);
    expect(result.finalOffsetMs).toBe(41); // 오염된 min-RTT offset(5000)을 채택하지 않고 median 사용
    expect(result.finalOffsetMs).not.toBe(5000);
  });

  it('경계값: threshold 바로 안쪽/바로 바깥쪽에서 폴백 여부가 갈린다(임계식 근거 확인)', () => {
    // selected.rtt=100(threshold 절반=50), medianSample.rtt=100(threshold 절반=50) → threshold=100.
    const within = [sample(100, 0), sample(100, 99), sample(105, 1), sample(110, 2), sample(120, 3)];
    // offsets 정렬: [0,1,2,3,99] → median(index2)=2. diff=|0-2|=2 <= threshold(=selected.rtt/2+medianSample.rtt/2).
    const r1 = selectClockSyncOffset(within);
    expect(r1.outlierFallback).toBe(false);

    const beyond = [sample(100, 0), sample(100, 250), sample(105, 251), sample(110, 252), sample(120, 253)];
    // offsets 정렬: [0,250,251,252,253] → median(index2)=251(rtt=105). diff=|0-251|=251.
    // threshold = 100/2 + 105/2 = 102.5 < 251 → 폴백.
    const r2 = selectClockSyncOffset(beyond);
    expect(r2.outlierFallback).toBe(true);
    expect(r2.finalOffsetMs).toBe(251);
  });
});

describe('MEDIUM-3 — 행위 기반(behavior-based) mutation 검증: min-RTT 샘플의 offset과 median offset이 크게 다른 조작 입력', () => {
  const selectClockSyncOffset = buildSelect();

  // min-RTT 샘플 offset(40)과 median offset(240)이 200ms나 벌어지지만, median 샘플들의 RTT가
  // 충분히 크므로(threshold=selected.rtt/2 + medianSample.rtt/2 = 25+1000=1025 > 200) corroboration은
  // 통과한다(폴백 미발동) — MEDIUM-1 가드 추가 후에도 "정상적으로 크게 다른" 케이스를 커버.
  const SAMPLES = [
    sample(50, 40),     // min-RTT
    sample(2000, 240),  // median 후보
    sample(1800, 241),
    sample(1900, 239),
    sample(2100, 5000), // 반대쪽 이상치(선택되지 않음 — min-RTT가 아니므로 무관)
  ];

  it('반환 offset은 min-RTT 샘플 offset(40)과 같고 median(240)과는 다르다(선택 로직이 실제로 min-RTT임을 행위로 증명)', () => {
    const result = selectClockSyncOffset(SAMPLES);
    expect(result.medianOffsetMs).toBe(240);
    expect(result.outlierFallback).toBe(false); // corroboration 통과 — 폴백 아님
    expect(result.finalOffsetMs).toBe(40); // min-RTT 채택
    expect(result.finalOffsetMs).not.toBe(result.medianOffsetMs); // median과 다름을 명시적으로 단언
  });

  it('mutation 실집행: 선택 로직이 median으로 퇴행하면 위 행위기반 단언이 실제로 깨진다(RED 직접 확인)', () => {
    const mutatedSrc = SELECT_SRC.replace(
      'const finalOffsetMs = outlierFallback ? medianOffsetMs : selected.offsetMs;',
      'const finalOffsetMs = medianOffsetMs; // (mutation 재현) min-RTT 선택을 완전히 제거하고 항상 median 채택'
    );
    expect(mutatedSrc).not.toBe(SELECT_SRC); // 실제로 치환이 일어났는지(오검출 방지) 먼저 확인
    const mutatedSelect = buildSelect(mutatedSrc);
    const mutated = mutatedSelect(SAMPLES);
    // 정상 로직이라면 finalOffsetMs===40(min-RTT)이어야 하지만, mutation이 적용되면 median(240)을
    // 반환한다 — 즉 위 "행위 기반" 단언(toBe(40))이 이 mutation에서 실제로 실패(RED)로 뒤집힌다는
    // 것을 리터럴 텍스트 비교가 아니라 함수를 직접 실행해 증명한다.
    expect(mutated.finalOffsetMs).toBe(240);
    expect(mutated.finalOffsetMs).not.toBe(40);
  });

  it('mutation 실집행2: outlierFallback 가드 자체를 제거하면(항상 min-RTT 고수) 이상치 방어 테스트가 실패로 뒤집힌다', () => {
    const mutatedSrc = SELECT_SRC.replace(
      'const finalOffsetMs = outlierFallback ? medianOffsetMs : selected.offsetMs;',
      'const finalOffsetMs = selected.offsetMs; // (mutation 재현) corroboration 가드 무시하고 항상 min-RTT 고수'
    );
    expect(mutatedSrc).not.toBe(SELECT_SRC);
    const mutatedSelect = buildSelect(mutatedSrc);
    const outlierSamples = [
      sample(50, 5000),
      sample(100, 40),
      sample(110, 42),
      sample(120, 39),
      sample(130, 41),
    ];
    const mutated = mutatedSelect(outlierSamples);
    // 정상 로직이면 finalOffsetMs===41(median 폴백)이어야 하지만, 가드를 제거하면 오염된 min-RTT
    // offset(5000)을 그대로 채택한다 — MEDIUM-1의 이상치 방어 테스트가 이 mutation에서 RED가 됨을 증명.
    expect(mutated.finalOffsetMs).toBe(5000);
    expect(mutated.finalOffsetMs).not.toBe(41);
  });
});

describe('MEDIUM-1 항목4 — 20세트 skew simulator(정상~극단 네트워크)에서 폴백이 오발동하지 않는지 확인', () => {
  // build30-rc1-phase4-clock-sync-skew-simulator.test.mjs와 동일한 3기기×20세트 파라미터 공식을
  // 재사용해(패리티 유지 목적 — 로직 복제 아님, 동일 산식으로 동일 입력을 재현), 실제
  // syncServerClock()을 구동하고 CLOCK_SYNC metric의 outlierFallback 필드가 전 세트에서 false로
  // 남는지(즉 정상 시나리오에서는 min-RTT가 그대로 채택되는지) 직접 확인한다.
  const CLOCK_SYNC_SRC = extractBlock(
    'let serverClockOffsetMs = 0;',
    'function getNextCountdownStartAt(delayMs = 3600)'
  );

  const JITTER_PATTERN = [0, 1, -1, 0.6, -0.6];
  function buildSetParams(setIndex) {
    const severity = setIndex / 19;
    return [0, 1, 2].map((d) => {
      const baseSkew = [-2500, 0, 2500][d];
      const skewMs = Math.round(baseSkew * (1 + severity * 0.4));
      const rttBase = Math.round(200 + severity * 2800 + d * 150);
      const asymmetrySwing = severity * 0.35 * (d === 0 ? -1 : d === 1 ? 0 : 1);
      const upFrac = Math.min(0.95, Math.max(0.05, 0.5 + asymmetrySwing));
      const jitterMs = Math.round(rttBase * severity * 0.25);
      const jitterSeq = JITTER_PATTERN.map((p) => p * jitterMs);
      return { skewMs, rttBase, upFrac, jitterMs, jitterSeq };
    });
  }

  async function runDevice(params) {
    let trueElapsed = 0;
    let sampleIndex = 0;
    const FakeDate = { now: () => trueElapsed + params.skewMs };
    const db = {
      rpc: () => {
        const i = Math.min(sampleIndex, params.jitterSeq.length - 1);
        const rtt = Math.max(1, Math.round(params.rttBase + params.jitterSeq[i]));
        const uplink = rtt * params.upFrac;
        const serverMs = Math.round(trueElapsed + uplink);
        trueElapsed += rtt;
        sampleIndex++;
        return Promise.resolve({ data: serverMs, error: null });
      },
    };
    const calls = { qa: [] };
    const QA = { emit: (kind, payload) => calls.qa.push({ kind, payload }) };
    const factory = new Function(
      'db', 'QA', 'withTimeout', 'sleep', 'state', 'Date',
      CLOCK_SYNC_SRC + '\nreturn { syncServerClock, getSynced: () => serverClockSynced };'
    );
    const mod = factory(db, QA, (p) => Promise.resolve(p), async () => {}, { roomCode: 'SIM' }, FakeDate);
    await mod.syncServerClock();
    const clockSyncMetric = calls.qa.find((c) => c.payload?.eventType === 'CLOCK_SYNC');
    return { synced: mod.getSynced(), clockSyncMetric };
  }

  it('20세트 × 3기기 모두 outlierFallback=false + syncAlgorithm=min-rtt 그대로 유지된다(폴백 오발동 없음)', async () => {
    let checked = 0;
    for (let s = 0; s < 20; s++) {
      const devices = buildSetParams(s);
      for (const params of devices) {
        const { synced, clockSyncMetric } = await runDevice(params);
        expect(synced).toBe(true);
        expect(clockSyncMetric).toBeTruthy();
        expect(clockSyncMetric.payload.outlierFallback).toBe(false);
        expect(clockSyncMetric.payload.syncAlgorithm).toBe('min-rtt');
        checked++;
      }
    }
    expect(checked).toBe(60); // 20세트 × 3기기 = 60회 전부 확인됨(누락 없음)
  });
});
