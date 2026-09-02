import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build39 — realtime write / countdown trace 계측 계약.
//
// 목적: 다음 3-device 필드 QA 에서 아래 두 미제를 닫을 수 있는 데이터가 실제로 남는지 고정한다.
//   ① 4.4초 countdownStartAt null 창 — host 발행 시각 vs 각 단말 최초 관측 시각
//   ② 2.6초 결과 스냅샷 정체 — M1(참가자 write 가 인코딩 덮어씀) vs M2(host per-row write 실패)
//
// ⚠️ 이 커밋은 계측 전용이다. 상태 전이/판정/write 경로 동작을 바꾸지 않는다.
// ⚠️ 벽시계 시간을 단언하지 않는다(사양 11) — 이벤트/필드의 존재와 배선만 본다.
// ⚠️ 공허성 방지: "존재한다" 단언은 대상 함수 본문 안에서만 찾는다. 파일 전체 검색은
//    다른 곳의 동명 문자열에 걸려 공허하게 통과한다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function fnBody(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  if (s < 0) throw new Error('start marker not found: ' + startMarker);
  const e = html.indexOf(endMarker, s);
  if (e < 0) throw new Error('end marker not found: ' + endMarker);
  const body = html.slice(s, e);
  if (body.length < 40) throw new Error('extracted body too short: ' + startMarker);
  return body;
}

describe('Build39 계측 — 공통 계약', () => {
  it('전제: QA.emit 은 계측 플래그가 꺼지면 즉시 no-op 이다 (출시 빌드 비용 0)', () => {
    const emit = fnBody('function emit(channel, data) {', 'const avg = a =>');
    expect(emit).toContain('if (!QA_INSTRUMENTATION) return;');
    // no-op 판정이 첫 문장이어야 한다 — 뒤에 있으면 직렬화 비용이 먼저 발생한다.
    const firstStmt = emit.slice(emit.indexOf('{') + 1).trim().split('\n')[0];
    expect(firstStmt).toContain('QA_INSTRUMENTATION');
  });

  it('출시 소스의 QA 플래그는 여전히 false 다', () => {
    expect(html).toContain('const __QA_BUILD__ = false /*__QA_BUILD_FLAG__*/;');
  });

  it('계측만을 위한 추가 DB 조회를 넣지 않았다', () => {
    // 새 계측 헬퍼/이벤트 근처에서 select() 를 새로 부르지 않는다.
    const helper = fnBody('function qaObserveCountdownStartAt(value, source) {', 'function buildPenaltyValue(');
    expect(helper).not.toContain('db.from');
    expect(helper).not.toContain('select(');
  });

  it('countdownStartAt 관측은 중복 제거된다 (로그 폭주 방지)', () => {
    const helper = fnBody('function qaObserveCountdownStartAt(value, source) {', 'function buildPenaltyValue(');
    expect(helper).toContain('__qaCountdownObsKey');
    expect(helper).toMatch(/if \(state\.__qaCountdownObsKey === key\) return;/);
  });
});

describe('Build39 계측 — countdown 추적', () => {
  const begin = fnBody('async function beginNewGameRound(', 'function getUnresolvedActiveParticipants');

  it('host 가 countdownStartAt 생성 시점을 남긴다', () => {
    expect(begin).toContain("eventType: 'COUNTDOWN_STARTAT_GENERATED'");
    for (const f of ['value:', 'localNow:', 'serverNowMs:', 'callSite:']) expect(begin).toContain(f);
  });

  it('penalty write 의 시작/종료와 성공 여부를 남긴다', () => {
    expect(begin).toContain("eventType: 'COUNTDOWN_STARTAT_WRITE_BEGIN'");
    expect(begin).toContain("eventType: 'COUNTDOWN_STARTAT_WRITE_END'");
    expect(begin).toContain('traceId:');
    expect(begin).toContain('durationMs:');
    expect(begin).toContain('errorCode:');
  });

  it('write 결과를 실제로 관측한다 (에러를 버리지 않는다)', () => {
    expect(begin).toContain('__committedRoom = await updateRoomPenaltyCas(');
    expect(begin).toContain('if (__cdErr)');
    expect(begin).toContain('success: !__cdErr');
  });

  it('각 단말이 countdownStartAt 최초 관측을 출처와 함께 남긴다', () => {
    const handle = fnBody('async function handleRoomUpdate(room) {', 'function showLoserWaitScreen()');
    expect(handle).toContain("qaObserveCountdownStartAt(getCountdownStartAt(room.penalty), 'roomUpdate')");
    const wait = fnBody('async function waitForValidCountdownStart(', 'async function republishCountdownStartAsHost');
    expect(wait).toContain("qaObserveCountdownStartAt(scheduledStartAt || 0, 'countdownRetryFetch')");
  });

  it('값이 없을 때는 MISSING 을 busy/pending/seq 와 함께 남긴다', () => {
    const helper = fnBody('function qaObserveCountdownStartAt(value, source) {', 'function buildPenaltyValue(');
    expect(helper).toContain("eventType: 'COUNTDOWN_STARTAT_MISSING'");
    expect(helper).toContain('fetchSeq:');
    expect(helper).toContain('busy:');
    expect(helper).toContain('pending:');
  });
});

describe('Build39 계측 — fetchParticipants', () => {
  const fp = fnBody('async function fetchParticipants(roomCode, qaReason', 'function updateRoomStatusScheduled');

  it('begin/end 를 seq·reason·소요시간과 함께 남긴다', () => {
    expect(fp).toContain("eventType: 'FETCH_PARTICIPANTS_BEGIN'");
    expect(fp).toContain("eventType: 'FETCH_PARTICIPANTS_END'");
    expect(fp).toContain('seq: mySeq');
    expect(fp).toContain('reason: qaReason');
    expect(fp).toContain('durationMs:');
    expect(fp).toContain('participantCount:');
    expect(fp).toContain('countdownStartAt:');
  });

  it('busy 직렬화로 미뤄진 요청을 남긴다', () => {
    expect(fp).toContain("eventType: 'FETCH_PARTICIPANTS_DEFERRED'");
    expect(fp).toContain('pending: true');
  });

  it('시퀀스 가드가 버린 응답을 남긴다', () => {
    expect(fp).toContain("eventType: 'FETCH_PARTICIPANTS_STALE_DISCARD'");
    expect(fp).toContain('latestSeq:');
  });

  it('시퀀스/busy/roomCode 가드 자체는 그대로다 (동작 무변경)', () => {
    expect(fp).toContain('const mySeq = ++state.fetchParticipantsSeq;');
    expect(fp).toMatch(/if \(!data \|\| mySeq !== state\.fetchParticipantsSeq\)/);
    expect(fp).toMatch(/if \(!state\.roomCode \|\| roomCode !== state\.roomCode\)/);
    expect(fp).toContain('state.fetchParticipantsBusy = true;');
  });

  it('qaReason 은 기본값이 있어 기존 호출부 동작을 바꾸지 않는다', () => {
    expect(html).toContain("async function fetchParticipants(roomCode, qaReason = 'unspecified')");
    expect(html).toContain("function scheduleFetchParticipants(roomCode, delayMs = 80, qaReason = 'schedule')");
  });
});

describe('Build39 계측 — realtime / poll 상관', () => {
  it('participants realtime 이벤트를 남긴다', () => {
    expect(html).toContain("eventType: 'REALTIME_PARTICIPANTS_EVENT'");
    expect(html).toContain("scheduleFetchParticipants(roomCode, 80, 'realtimeParticipants')");
  });
  it('room realtime 과 폴링을 서로 구분되는 reason 으로 남긴다', () => {
    expect(html).toContain("scheduleFetchParticipants(roomCode, 80, 'realtimeRoom')");
    expect(html).toContain("eventType: 'POLL_ROOM_TRIGGER'");
    expect(html).toContain("fetchParticipants(roomCode, 'poll')");
  });
  it('busy 로 미뤘다가 재실행되는 경로도 구분된다', () => {
    expect(html).toContain("scheduleFetchParticipants(roomCode, 80, 'pendingReplay')");
  });
});

describe('Build39 계측 — 참가자 선택 write (M1 판별)', () => {
  const w = fnBody('async function updateParticipantChoice(choice) {', '// --- 기존 UI 제어 로직 수정 ---');

  it('write 전후를 남기고 DB 에러를 관측한다', () => {
    expect(w).toContain("eventType: 'CHOICE_WRITE_BEGIN'");
    expect(w).toContain("eventType: 'CHOICE_WRITE_END'");
    expect(w).toContain('durationMs:');
    expect(w).toMatch(/const \{ error \} = await db\.from\('participants'\)\.update\(\{ choice \}\)/);
    expect(w).toContain('success: !error');
  });

  it('덮어쓰기 직전의 기존 인코딩 보유 여부를 남긴다 (M1 판별의 핵심)', () => {
    expect(w).toContain('prevChoice:');
    expect(w).toContain('prevHadResultEncoding: hasConfirmedRoundResult(__prevChoice)');
  });

  it('로깅만을 위해 DB 를 추가로 읽지 않는다', () => {
    expect(w).not.toContain('.select(');
    // 기존 로컬 스냅샷에서만 이전 값을 읽는다.
    expect(w).toContain('(state.participants || []).find(p => p.id === state.currentUserId)');
  });
});

describe('Build39 계측 — host 결과 발행 per-row (M2 판별)', () => {
  const pub = fnBody('async function publishHostRoundResult(', 'function scheduleFetchParticipants');

  it('publish 시작/종료와 성공·실패 집계를 남긴다', () => {
    expect(pub).toContain("eventType: 'HOST_RESULT_PUBLISH_BEGIN'");
    expect(pub).toContain("eventType: 'HOST_RESULT_PUBLISH_END'");
    expect(pub).toContain('succeeded:');
    expect(pub).toContain('failed:');
    expect(pub).toContain('activeIds:');
  });

  it('행 단위 write 성공/실패를 남긴다 (에러를 조용히 버리지 않는다)', () => {
    expect(pub).toContain("eventType: 'HOST_RESULT_ROW_WRITE_BEGIN'");
    expect(pub).toContain("eventType: 'HOST_RESULT_ROW_WRITE_END'");
    expect(pub).toMatch(/const \{ error: rowErr \} = await db\.from\('participants'\)\.update\(next\)/);
    expect(pub).toContain('success: !rowErr');
    expect(pub).toContain('errorCode:');
  });

  it('행 write 전후 choice 값을 남긴다', () => {
    expect(pub).toContain('prevChoice: p.choice');
    expect(pub).toContain('nextChoice: next.choice');
  });

  it('write 경로 자체는 재설계하지 않았다 (동작 무변경)', () => {
    // 여전히 Promise.all 로 독립 write 를 병렬 수행하고, 실패해도 진행한다.
    expect(pub).toContain('await Promise.all(active.map(async p =>');
    // Build40 P0-1 이 continuation 인자를 더했다 — status 전이 호출 자체는 그대로다.
    expect(pub).toMatch(/await updateRoomStatusScheduled\("result", "result"[,)]/);
    // 실패 시 throw/return 으로 흐름을 바꾸지 않는다 — 계측만 한다.
    expect(pub).not.toContain('throw new Error(\'HOST_RESULT');
  });
});

describe('Build39 계측 — 결과 스냅샷 상관 데이터', () => {
  const f = fnBody('async function fetchFreshParticipantsForResult(', 'function syncConfirmedIdsFromParticipants');

  it('미해결 행의 실제 choice 문자열과 인코딩 보유 여부를 남긴다', () => {
    expect(f).toContain('qaUnresolvedDetail');
    expect(f).toContain('hasBase:');
    expect(f).toContain('hasResult: hasConfirmedRoundResult(p.choice)');
    expect(f).toContain('isSelf: p.id === state.currentUserId');
  });

  it('세 스냅샷 이벤트 모두 상세/경과/시퀀스를 포함한다', () => {
    for (const ev of ['TAGGER_SNAPSHOT_STALE', 'TAGGER_SNAPSHOT_FINAL_WAIT', 'TAGGER_SNAPSHOT_GAVE_UP']) {
      const i = f.indexOf(`eventType: '${ev}'`);
      expect(i, `${ev} 가 이 함수 안에 없다`).toBeGreaterThan(0);
      const slice = f.slice(i, i + 420);
      expect(slice, `${ev}: unresolvedDetail 없음`).toContain('unresolvedDetail:');
      expect(slice, `${ev}: elapsedMs 없음`).toContain('elapsedMs:');
      expect(slice, `${ev}: fetchSeq 없음`).toContain('fetchSeq:');
    }
  });

  it('재시도 횟수/간격은 그대로다 (동작 무변경)', () => {
    expect(html).toContain('async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300');
    expect(f).toContain('await sleep(delayMs * 2);');
  });
});

describe('Build39 계측 — 라운드 컨텍스트', () => {
  it('공통 컨텍스트를 한 곳에서 만든다 (직렬화 중복 방지)', () => {
    const ctx = fnBody('function qaRoundCtx() {', 'function qaObserveCountdownStartAt');
    for (const f of ['roomCode:', 'gameNo:', 'round:', 'roomStatus:', 'role:']) expect(ctx).toContain(f);
  });

  it('상관 id 생성기가 존재한다', () => {
    expect(html).toContain('function qaNextTraceId(kind)');
  });
});
