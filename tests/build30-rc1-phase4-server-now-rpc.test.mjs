import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// STOP-SHIP 복구 RC-1 Phase4 — syncServerClock()이 HTTP Date 헤더 대신 db.rpc('server_now')
// 응답 바디로 서버-로컬 오프셋을 계산하도록 교체된 것을 검증한다.
//
// 배경: HTTP Date 헤더 경로는 라이브 검증에서 회생 불가로 확인됐다(CORS
// Access-Control-Expose-Headers에 Date가 없어 브라우저가 읽지 못함 → offsets 항상 0개).
// server_now RPC(supabase/migrations/20260726104300_server_now_rpc.sql)는 응답 바디로 서버
// wall-clock(clock_timestamp() epoch ms, bigint)을 내려준다. 실측 shape: 따옴표 없는 raw
// number(예: 1785078319341) — {server_now:...} 객체가 아니다. 이 파일은 그 정규화 파서와
// 실패 처리(에러/malformed/timeout 폐기, 전체 실패 시 CLOCK_SYNC_FAILED)를 실제 소스
// (new Function 추출)로 검증한다.
//
// 이 블록의 상위(state/CLOCK_SYNC 회귀 방지 regex)는 tests/build19-critical-fixes.test.mjs
// WRPS-036-B19 describe가 이미 지키고 있다(syncServerClock 재시도 구조 / CLOCK_SYNC metric
// 필드) — 여기서는 그 계약을 무변경으로 유지한 채, RPC 연결부만 새로 검증한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

// serverClockOffsetMs/serverClockSynced(모듈 스코프 let) ~ syncServerClock() 정의 전체 —
// 실제 소스(getNextCountdownStartAt 직전까지).
const CLOCK_SYNC_SRC = extractBlock(
  'let serverClockOffsetMs = 0;',
  'function getNextCountdownStartAt(delayMs = 3600)'
);

function withTimeoutPassthrough(promise) {
  // 실제 withTimeout(promise, ms, label)과 동일한 역할(그대로 통과)만 하고, 4000ms 실제
  // 대기는 하지 않는다 — 타임아웃 "발생"은 아래 timeout 테스트에서 db.rpc 자체가 reject하는
  // 방식으로 재현한다(실 타이머 없이도 "await가 reject되면 해당 샘플만 폐기된다"는 동일한
  // 코드 경로를 실행/검증할 수 있다). 4000ms 리터럴이 실제로 그 자리에 배선돼 있는지는
  // 별도 구조 검증(it('실제 호출부는 4000ms...'))으로 확인한다.
  return Promise.resolve(promise);
}

function buildEnv({ dbRpcImpl, state = { roomCode: 'ROOM-PHASE4' }, sleepImpl = async () => {} } = {}) {
  const calls = { qa: [] };
  const QA = { emit: (kind, payload) => calls.qa.push({ kind, payload }) };
  const db = { rpc: dbRpcImpl };
  const factory = new Function(
    'db', 'QA', 'withTimeout', 'sleep', 'state',
    CLOCK_SYNC_SRC +
      '\nreturn { syncServerClock, serverNow, getOffsetMs: () => serverClockOffsetMs, getSynced: () => serverClockSynced };'
  );
  const mod = factory(db, QA, withTimeoutPassthrough, sleepImpl, state);
  return { mod, calls };
}

describe('RC-1 Phase4 — db.rpc("server_now") 연결 구조 확인(4000ms withTimeout 배선)', () => {
  it('실제 호출부는 withTimeout(db.rpc("server_now"), 4000, ...) 형태로 배선돼 있다(HTTP Date 헤더 경로는 완전히 제거됨)', () => {
    expect(html).toContain('await withTimeout(db.rpc("server_now"), 4000, "서버 시각")');
    expect(html).not.toContain('/auth/v1/health');
    expect(html).not.toMatch(/res\?\.headers\?\.get\?\.\("date"\)/);
  });
});

describe('RC-1 Phase4 — normalize parser(실측 raw number 우선, string/{server_now} 방어)', () => {
  it('실측 shape(따옴표 없는 raw number)를 그대로 사용한다', async () => {
    const { mod } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: 1785078319341, error: null }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(true);
  });

  it('방어적 케이스: 문자열 숫자("1785078319341")도 정규화해 사용한다', async () => {
    const { mod } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: '1785078319341', error: null }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(true);
  });

  it('방어적 케이스: { server_now: ... } 객체 shape도 정규화해 사용한다', async () => {
    const { mod } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: { server_now: 1785078319341 }, error: null }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(true);
  });

  it('malformed(비숫자 문자열)은 폐기하고, 5샘플+재시도 전부 malformed면 미동기화로 남는다', async () => {
    const { mod, calls } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: 'not-a-number', error: null }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(false);
    expect(mod.getOffsetMs()).toBe(0); // offsetMs=0을 성공값처럼 쓰지 않는다(Date.now 폴백만)
    expect(calls.qa.some((c) => c.payload?.eventType === 'CLOCK_SYNC_FAILED')).toBe(true);
  });

  it('malformed(음수/0)도 폐기한다(serverMs<=0 방어)', async () => {
    const { mod } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: -5, error: null }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(false);
  });

  it('malformed(null 데이터)도 폐기한다', async () => {
    const { mod } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: null, error: null }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(false);
  });
});

describe('RC-1 Phase4 — 실패 처리(에러/timeout 폐기, 전체 실패 시 CLOCK_SYNC_FAILED)', () => {
  it('error!==null이면 해당 샘플을 폐기한다(데이터가 있어도 무시)', async () => {
    const { mod } = buildEnv({
      dbRpcImpl: () => Promise.resolve({ data: 1785078319341, error: { message: 'boom' } }),
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(false);
  });

  it('timeout(await가 reject됨)도 개별 샘플만 폐기하고 나머지 루프는 계속 진행된다', async () => {
    let call = 0;
    const { mod } = buildEnv({
      dbRpcImpl: () => {
        call++;
        // 5회 중 처음 2회만 "타임아웃"(reject)을 재현 — withTimeout이 실제로 4000ms 뒤
        // reject하는 것과 동일한 코드 경로(try/catch에 의해 폐기)를 강제한다.
        if (call <= 2) return Promise.reject(new Error('서버 시각 응답 시간이 초과되었습니다'));
        return Promise.resolve({ data: 1785078319341 + call, error: null });
      },
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(true); // 나머지 3개 샘플로 동기화 성공
  });

  it('5샘플 + 1회 재시도(총 10회 시도) 전부 실패하면 serverClockSynced=false 유지 + CLOCK_SYNC_FAILED(roomId/attempts) emit', async () => {
    const { mod, calls } = buildEnv({
      dbRpcImpl: () => Promise.reject(new Error('down')),
      state: { roomCode: 'ROOM-ALL-FAIL' },
    });
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(false);
    expect(mod.getOffsetMs()).toBe(0);
    const failed = calls.qa.find((c) => c.payload?.eventType === 'CLOCK_SYNC_FAILED');
    expect(failed).toBeTruthy();
    expect(failed.payload.roomId).toBe('ROOM-ALL-FAIL');
    expect(failed.payload.attempts).toBe(10);
    // CLOCK_SYNC_RETRY(재시도 1회)도 여전히 남는다(기존 WRPS-047 계약 무변경).
    expect(calls.qa.some((c) => c.payload?.eventType === 'CLOCK_SYNC_RETRY')).toBe(true);
  });

  it('이전에 이미 동기화 성공(serverClockSynced=true) 이력이 있으면, 이후 전부 실패해도 CLOCK_SYNC_FAILED를 다시 남기지 않는다(오프셋도 과거 값 유지)', async () => {
    // 실제 앱에서 syncServerClock()은 앱 초기화 시 1회, 방 재접속 시 다시 호출될 수 있다(호출부
    // 2곳: 5442, 12037 부근). 두 번째 호출이 전부 실패해도 첫 호출의 성공을 "실패"로 덮어써
    // 잘못된 CLOCK_SYNC_FAILED를 새로 만들면 안 된다.
    const state = { roomCode: 'ROOM-RESYNC' };
    const calls = { qa: [] };
    const QA = { emit: (kind, payload) => calls.qa.push({ kind, payload }) };
    let phase = 'ok';
    const db = {
      rpc: () => (phase === 'ok'
        ? Promise.resolve({ data: 1785078319341, error: null })
        : Promise.reject(new Error('down'))),
    };
    const factory = new Function(
      'db', 'QA', 'withTimeout', 'sleep', 'state',
      CLOCK_SYNC_SRC +
        '\nreturn { syncServerClock, getOffsetMs: () => serverClockOffsetMs, getSynced: () => serverClockSynced };'
    );
    const mod = factory(db, QA, withTimeoutPassthrough, async () => {}, state);
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(true);
    const offsetAfterFirstSync = mod.getOffsetMs();

    phase = 'down';
    calls.qa.length = 0;
    await mod.syncServerClock();
    expect(mod.getSynced()).toBe(true); // 과거 성공 이력 유지(덮어쓰지 않음)
    expect(mod.getOffsetMs()).toBe(offsetAfterFirstSync); // offsetMs도 과거 값 그대로
    expect(calls.qa.some((c) => c.payload?.eventType === 'CLOCK_SYNC_FAILED')).toBe(false);
  });
});

describe('RC-1 Phase4 — 기존 계약 무변경 확인(오프셋 계산 골격/serverNow 시그니처/+500ms 편향 제거)', () => {
  it('serverNow()는 여전히 Date.now() + serverClockOffsetMs이다(하위호환 시그니처 불변)', () => {
    expect(html).toContain('function serverNow() { return Date.now() + serverClockOffsetMs; }');
  });

  it('+500ms 초단위 편향 보정 코드는 제거되었다(RPC는 ms 단위라 불필요)', () => {
    expect(html).not.toMatch(/serverMs \+ 500 \+ rtt \/ 2 - t1/);
  });

  it('오프셋 계산은 표준 RTT/2 보정 골격(serverMs - t0 - rtt / 2)을 그대로 쓴다', () => {
    // RC-1(clock sync 완화): 선택 로직이 median→min-RTT로 교체되며 offsets 배열 대신 samples
    // 배열에 { rttMs, offsetMs, ... }로 저장하도록 리팩터됐다(계산식 자체는 무변경).
    expect(html).toContain('const offsetMs = Math.round(serverMs - t0 - rtt / 2);');
  });

  it('mutation 확인: rtt/2 보정을 제거하면(옛 결함성 계산으로 되돌리면) 비대칭 RTT 상황에서 오프셋이 달라진다(회귀 검출력 증명)', async () => {
    const brokenSrc = CLOCK_SYNC_SRC.replace(
      'const offsetMs = Math.round(serverMs - t0 - rtt / 2);',
      'const offsetMs = Math.round(serverMs - t0);'
    );
    expect(brokenSrc).not.toBe(CLOCK_SYNC_SRC);
    // RTT=1000ms 고정 응답 5회 — rtt/2 보정이 있으면 offset은 -500 근방, 없으면 0 근방이어야 한다.
    let t = 0;
    const dbRpcImpl = () => {
      const serverMs = 1_000_000 + t; // 서버는 요청 도달 시점(uplink=rtt/2=500ms 후)의 시각
      t += 1000;
      return Promise.resolve({ data: serverMs, error: null });
    };
    async function run(src) {
      const calls = { qa: [] };
      const QA = { emit: (kind, payload) => calls.qa.push({ kind, payload }) };
      let clock = 0;
      const FakeDate = { now: () => clock };
      const db = {
        rpc: () => {
          const before = clock;
          clock += 1000; // RTT=1000ms 경과(대칭 — uplink=downlink=500ms)
          const serverMs = before + 500;
          return Promise.resolve({ data: serverMs, error: null });
        },
      };
      const factory = new Function(
        'db', 'QA', 'withTimeout', 'sleep', 'state', 'Date',
        src + '\nreturn { syncServerClock, getOffsetMs: () => serverClockOffsetMs };'
      );
      const mod = factory(db, QA, withTimeoutPassthrough, async () => {}, { roomCode: 'R' }, FakeDate);
      await mod.syncServerClock();
      return mod.getOffsetMs();
    }
    const correctOffset = await run(CLOCK_SYNC_SRC);
    const brokenOffset = await run(brokenSrc);
    expect(correctOffset).toBe(0); // t0=0, serverMs=500(request 도달), rtt=1000 → 500-0-500=0(정확 보정)
    expect(brokenOffset).toBe(500); // rtt/2 보정을 빼먹으면 uplink 지연만큼 그대로 오차가 남는다
    expect(correctOffset).not.toBe(brokenOffset);
  });
});
