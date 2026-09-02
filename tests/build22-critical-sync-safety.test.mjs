import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build22 — Critical Fix(필드QA 실측 재분석 기반: countdown 하드블록/중복렌더 억제/스냅샷
// give-up 안전성/QA 리포트 보존성) 회귀 방지. 판정 알고리즘(judgeRound/judgePure/
// resolveElimination)은 무변경 — scheduling/render/snapshot 안전성만 보강함(scope 제약 준수).
// 요구된 7개 테스트를 정확히 아래 7개 describe/it으로 구현한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('Build22-A — invalid countdown server ts does not start countdown', () => {
  it('scheduledStartAt이 바운드 재시도 후에도 invalid면 host가 아닌 클라이언트는 COUNTDOWN_START를 방출하지 않고 즉시 반환한다', () => {
    // waitForValidCountdownStart(바운드 재시도) 존재
    expect(html).toContain('async function waitForValidCountdownStart(maxAttempts = 5, delayMs = 500)');
    // runCountdown 본문: 온라인 모드에서만 하드블록 적용, host 아니면 에러화면 후 false 반환(early return)
    expect(html).toMatch(/if \(!scheduledStartAt && getOnlineMode\(\)\) \{[\s\S]{0,120}scheduledStartAt = await waitForValidCountdownStart\(\);/);
    expect(html).toMatch(/const isHost = state\.role === "host";[\s\S]{0,100}if \(isHost\) \{[\s\S]{0,300}\} else \{[\s\S]{0,700}showCountdownSyncError\(overlay, numEl, labelEl,[\s\S]{0,200}return false;/);
    // COUNTDOWN_START metric 방출 지점은 이 하드블록 분기보다 반드시 뒤에 위치한다(early return 이후에만 도달)
    const blockIdx = html.indexOf('showCountdownSyncError(overlay, numEl, labelEl, async () => { await runCountdownThenShowGame(); });');
    const startMetricIdx = html.indexOf("eventType: 'COUNTDOWN_START'");
    expect(blockIdx).toBeGreaterThan(-1);
    expect(startMetricIdx).toBeGreaterThan(blockIdx);
  });

  it('host는 invalid 시 새 예정시각을 republish해 자가복구하며 COUNTDOWN_START는 항상 유효한 시각으로만 방출된다', () => {
    expect(html).toContain('async function republishCountdownStartAsHost()');
    expect(html).toContain('const __nextCountdownStartAt = getNextCountdownStartAt();');
    expect(html).toContain('state.countdownStartAt = __nextCountdownStartAt;');
    expect(html).toMatch(/scheduledStartAt = await republishCountdownStartAsHost\(\);/);
  });

  it('오프라인(단일기기 pass-play)에서는 하드블록이 적용되지 않는다(서버 동기화 대상 아님)', () => {
    expect(html).toMatch(/if \(!scheduledStartAt && getOnlineMode\(\)\)/);
  });
});

describe('Build22-A — invalid countdown does not play voice', () => {
  it('runCountdown은 하드블록 분기에서 return false로 조기 종료해 이후의 voice 재생 코드(playVoiceClip)에 도달하지 않는다', () => {
    // showCountdownSyncError 호출 직후 함수가 즉시 반환됨 — 이 지점 이후에 있는 ready/countdownRps voice
    // 재생 코드(playVoiceClip)는 이 실행 경로에서 절대 실행되지 않는다(JS 함수 조기 return 보장).
    expect(html).toMatch(/showCountdownSyncError\(overlay, numEl, labelEl, async \(\) => \{ await runCountdownThenShowGame\(\); \}\);\s*\n\s*return false;\s*\n\s*\}/);
    // voice 재생 지점(ready/countdownRps)은 이 early-return보다 코드상 뒤에 위치한다.
    const earlyReturnIdx = html.indexOf('return false;\n        }\n      }\n      // 예정 시각은 서버 시간 도메인');
    // Build47 항목2: 1박자 재생 라인이 GAME 순번 안내 조건식으로 확장됐다 — 계약(위치)은 동일.
    const readyVoiceIdx = html.indexOf('void playVoiceClip(__gameAnnounce ? __gameAnnounce.key : "ready")');
    expect(readyVoiceIdx).toBeGreaterThan(-1);
    if (earlyReturnIdx > -1) expect(readyVoiceIdx).toBeGreaterThan(earlyReturnIdx);
  });

  it('runCountdownThenShowGame은 runCountdown()이 false를 반환하면 게임 화면 전환 없이 종료한다(하드블록 상태에서 로컬 진행 방지)', () => {
    // Build30-R2 Phase2(WRPS-078): runCountdown()이 세대 토큰(myGen)을 인자로 받는다 — 시그니처만
    // 바뀌었을 뿐 이 테스트가 검증하는 계약(countdownOk===false면 화면 전환 없이 종료)은 그대로.
    expect(html).toMatch(/const countdownOk = await runCountdown\(myGen\);[\s\S]{0,600}if \(countdownOk === false\) \{[\s\S]{0,120}state\.gameStarting = false;[\s\S]{0,120}return;[\s\S]{0,20}\}/);
  });

  it('재시도 버튼 콜백은 bare runCountdown()이 아니라 runCountdownThenShowGame()을 재호출해, 재시도 성공 시 화면 전환(screenGame)까지 보장한다(codex-critic 검증에서 발견된 회귀 수정)', () => {
    // bare runCountdown()만 재호출하면 재시도가 성공해도 showScreen("screenGame")을 절대 호출하지
    // 않는 유일한 지점(runCountdownThenShowGame)을 우회해 참가자가 화면 전환 없이 멈춘다.
    expect(html).toContain('showCountdownSyncError(overlay, numEl, labelEl, async () => { await runCountdownThenShowGame(); });');
    expect(html).not.toContain('showCountdownSyncError(overlay, numEl, labelEl, async () => { await runCountdown(); });');
  });

  it('재시도 버튼은 클릭 시 disabled도 함께 걸어 빠른 연속클릭으로 onclick이 두 번 큐잉되는 것을 막는다(codex-critic 2차 검토 지적)', () => {
    expect(html).toMatch(/btn\.onclick = async \(\) => \{[\s\S]{0,400}btn\.disabled = true;[\s\S]{0,80}btn\.style\.display = "none";[\s\S]{0,40}await onRetry\(\);/);
  });
});

describe('Build22-B — duplicate result render is skipped', () => {
  it('waitForPhaseRender는 phase/gameNo/round/serverScheduledTs 키로 이미 렌더된 조합을 감지하면 duplicate-skip 메트릭만 남기고 false를 반환한다', () => {
    expect(html).toMatch(/const renderKey = phase \+ ':' \+ gameNo \+ ':' \+ round \+ ':' \+ \(scheduledAt \|\| 0\);/);
    expect(html).toMatch(/if \(state\.renderedPhaseKeys\[renderKey\]\) \{[\s\S]{0,300}eventType: 'SYNC_RENDER_DUPLICATE_SKIPPED'[\s\S]{0,300}return false;/);
    expect(html).toContain('state.renderedPhaseKeys[renderKey] = true;');
  });

  it('result/game_over 리스너는 waitForPhaseRender가 첫 렌더일 때만 finishRoundLocal()을 호출한다', () => {
    // Build24-A: waitForPhaseRender 호출 직후 finishRoundLocal()을 바로 부르는 대신, resultIsFirstRender
    // 블록 안에서 스냅샷 재조회(SNAPSHOT_RETRY_DURATION 기록)를 거친 뒤 finishRoundLocal()을 호출하도록
    // 바뀌었다 — "첫 렌더일 때만 호출"이라는 게이팅 자체는 그대로 유지(중첩 위치만 이동).
    // Build29(WRPS-076) [P1, R1]: resultIsFirstRender 블록 안에 화면 선-전환 코드가 추가돼 블록
    // 길이가 늘었다 — 길이 상한만 여유 있게 확장(게이팅 구조 자체는 무변경).
    // Build30(WRPS-078) [Phase1]: fetchFreshParticipantsForResult 호출에 5초 hard timeout
    // (Promise.race)이 추가돼 블록 길이가 더 늘었다 — 길이 상한만 재확장(게이팅 구조 무변경).
    // Build30-R2(WRPS-078) [Phase B]: 즉시렌더(renderTentativeRoundResult)/팬텀 가드(컨텍스트
    // 재확인)/오판 가드(부분 stale 추가 대기)가 더해져 블록이 더 길어졌다 — 길이 상한만 재확장
    // (게이팅 구조 자체는 무변경).
    expect(html).toMatch(/const resultIsFirstRender = await waitForPhaseRender\("result", resultScheduledAt, resultClientReceivedTs\);\s*\n\s*if \(resultIsFirstRender\) \{[\s\S]{0,7000}finishRoundLocal\(\);\s*\n\s*\}/);
  });
});

describe('Build22-B — same phase late update does not re-render screen', () => {
  it('ready(nextRound) 리스너는 waitForPhaseRender가 첫 렌더일 때만 화면 전환 분기(loserWait/winnerWait/participantWait/hostRoom/readyScreen)를 실행한다', () => {
    // Build29(WRPS-076) [P1, R5]: participants 새로고침을 waitForPhaseRender와 Promise.all로
    // 병렬화하면서 `const readyIsFirstRender = await waitForPhaseRender(...)` 단독 선언이
    // `const [readyFetchResult, readyIsFirstRender] = await Promise.all([...])` 구조로 바뀌었다 —
    // "첫 렌더일 때만 화면 전환"이라는 게이팅 자체(if (readyIsFirstRender) { ... showReadyScreen(); })는
    // 그대로 유지된다.
    // WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): Promise.all 이후 커밋 지점에 세대 가드
    // (state.hruGen/room.__hruGen, index.html ~5906 부근 주석 참고)가 추가돼 이 사이 구간이 크게
    // 길어졌다 — 길이 상한만 여유 있게 확장(게이팅 구조 자체는 무변경, if (readyIsFirstRender)는
    // 여전히 그 세대 가드가 통과했을 때만 도달하는 안쪽 블록에 그대로 있다).
    expect(html).toMatch(/const \[readyFetchResult, readyIsFirstRender\] = await Promise\.all\(\[[\s\S]{0,400}\]\);[\s\S]{0,2400}if \(readyIsFirstRender\) \{[\s\S]{0,700}showReadyScreen\(\);/);
  });

  it('새 게임(gameNo 변경) 진입 엣지에서만 renderedPhaseKeys가 초기화되고, 같은 게임의 round=1 2차 전이(result→game_over)에서는 지워지지 않는다', () => {
    // codex-critic 검증(1차)에서 발견된 회귀: room.round===1 블록은 round=1인 동안 매 handleRoomUpdate마다
    // 반복 실행되므로, 무조건 리셋하면 result→game_over 2차 전이 때 Fix B가 방금 기록한 duplicate-skip
    // 키까지 지워 dedup이 무력화된다(라운드1에 끝나는 가장 흔한 게임에서 재발).
    // codex-critic 재검토(2차) 지적: round 기준 가드(state.round !== 1)는 정확하지만 "라운드1에서
    // 끝나는 게임이 세션 내내 연속"되면 절대 안 지워져 메모리만 누적된다 — gameNo(getGameRound(),
    // 게임마다 반드시 변경)로 가드하면 round 값과 무관하게 "새 게임 진입"을 정확히 1회만 감지한다.
    // Build27(H1, codex-critic 재지적): 최초 수정(room.status !== 'game_over')은 game_over만 막았지만
    // status:'result'의 동일 duplicate-echo 취약점(라운드1 tooMany/tooFew 재대결 예약 창에서 판정
    // 결과가 조용히 소실될 수 있음)이 남아있어, 조건을 status 값 대신 gameNo 기반 1회성
    // idempotency로 일반화했다. Build27(M1, codex-critic 2차 검증): gameRound 단독 비교는 한 세션
    // 안에서 서로 다른 방이 우연히 같은 gameRound로 첫 게임을 끝내면 오판될 수 있어, 가드 키를
    // `${roomCode}:${gameRound}`로 room-scope했다 — tests/build27-replay-force-start.test.mjs 참조.
    // gameNo 기반 renderedPhaseKeys 가드 자체는 무변경 — 이제 리셋 블록 전체가 방·게임 조합당
    // 정확히 1회만 실행되므로 "2차 전이에서 키가 안 지워진다"는 보장은 오히려 더 강해졌다.
    expect(html).toMatch(/if \(room\.round === 1 && state\.confirmedIdsResetGameNo !== confirmedIdsResetKey\) \{[\s\S]{0,2400}if \(state\.renderedPhaseKeysGameNo !== state\.gameRound\) \{\s*\n\s*state\.renderedPhaseKeys = \{\};\s*\n\s*state\.renderedPhaseKeysGameNo = state\.gameRound;\s*\n\s*\}\s*\n\s*\}/);
  });

  it('시뮬레이션: 같은 게임(gameNo 불변) 안에서 handleRoomUpdate가 두 번(result→game_over, round=1 유지) 호출돼도 직전에 기록한 duplicate-skip 키가 살아남고, 다음 게임(gameNo 변경)에서는 정확히 초기화된다', () => {
    // index.html은 모듈이 아니라 index.html의 실제 가드 조건(gameNo 기반)을 그대로 재현해
    // codex-critic이 지적한 정확한 2-콜 시퀀스를 시뮬레이션한다 — 정적 패턴매칭만으로는 이 순차
    // 호출 시나리오(같은 게임에서 handleRoomUpdate가 두 번 옴)를 못 잡아 회귀가 발생했었다.
    const state = { round: 5, gameRound: 41, renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 41 }; // 직전 게임(gameNo=41)은 round=5에서 종료
    function simulateRoundOneResetBlock(roomRound, gameNo) {
      state.gameRound = gameNo;
      if (roomRound === 1) {
        if (state.renderedPhaseKeysGameNo !== state.gameRound) {
          state.renderedPhaseKeys = {};
          state.renderedPhaseKeysGameNo = state.gameRound;
        }
      }
      state.round = roomRound;
    }
    // 1) 새 게임(gameNo 42) 시작(진짜 엣지) — 리셋되어야 정상
    simulateRoundOneResetBlock(1, 42);
    expect(state.renderedPhaseKeys).toEqual({});
    // 2) 새 게임의 result phase 첫 렌더가 기록됨(waitForPhaseRender가 하는 일을 시뮬레이션)
    state.renderedPhaseKeys['result:42:1:2000'] = true;
    // 3) 같은 게임(gameNo=42) 안에서 result→game_over 2차 전이 도착 — handleRoomUpdate가 다시
    //    호출되지만 room.round/gameNo 모두 그대로(game_over는 round/gameNo를 바꾸지 않음)
    simulateRoundOneResetBlock(1, 42);
    // 회귀 시: 이 줄에서 renderedPhaseKeys가 {}로 지워져 있어 아래 assert가 실패했을 것.
    expect(state.renderedPhaseKeys['result:42:1:2000']).toBe(true);
    // 4) 이 게임도 라운드1에서 종료되고 곧바로 다음 게임(gameNo 43)도 라운드1부터 시작 — round는
    //    세션 내내 1을 벗어나지 않지만(round 기준 가드였다면 영원히 리셋 안 됐을 케이스), gameNo가
    //    바뀌었으므로 정확히 리셋되어야 한다(메모리 누적 방지).
    simulateRoundOneResetBlock(1, 43);
    expect(state.renderedPhaseKeys).toEqual({});
  });
});

describe('Build22-C — TAGGER_SNAPSHOT_GAVE_UP fallback safety', () => {
  it('일반 재시도 소진 후에도 미해결이면 GAVE_UP 선언 전 1회 더 긴 대기+재조회를 시도한다(무한대기 아님, 딱 1회)', () => {
    expect(html).toContain("eventType: 'TAGGER_SNAPSHOT_FINAL_WAIT'");
    // Build30-R2 Phase B(WRPS-078): 이 사이에 팬텀 가드(컨텍스트 재확인) 분기가 추가됐다 — 재시도
    // 자체(간격/1회 제한)는 무변경이므로 "미해결이면 결국 await sleep(delayMs*2)로 이어진다"는
    // 상대 순서만 확인한다(정확한 인접 여부는 요구하지 않음).
    // 간격 상한은 계약이 아니다(계측 필드가 늘면 자연히 커진다) — 두 문장의 **순서**만 고정한다.
    expect(html).toMatch(/let stillUnresolved = unresolvedOf\(data\);\s*\n[\s\S]{0,1600}await sleep\(delayMs \* 2\);/);
  });

  it('GAVE_UP 이후 finishRoundLocal은 어느 데이터 소스(stored/localJudge)로 판정했는지 TAGGER_FALLBACK_SOURCE로 명시한다', () => {
    expect(html).toMatch(/eventType: 'TAGGER_FALLBACK_SOURCE', source: hasStoredResults \? 'stored' : 'localJudge'/);
  });

  it('localJudge 폴백(judgeRound)은 tooMany/gameOver를 포함해 활성 참가자 전원을 raw choice 기준으로 판정하며 미확정 참가자를 조용히 누락하지 않는다', () => {
    // judgeRound의 active 필터는 "선택을 아직 안 한(choice 없음)" 경우만 제외하고, GAVE_UP의
    // unresolvedOf가 정의하는 "선택은 했지만(getChoiceBase 참) 서버 확정 태그만 없는" 참가자는
    // getChoiceBase(p.choice)가 true이므로 active에 포함되어 judgePure로 정상 판정된다(드롭 없음).
    expect(html).toMatch(/function judgeRound\(participants\) \{[\s\S]{0,600}Object\.assign\(result, judgePure\(active\)\);/);
    expect(html).toMatch(/!isNonPlayingChoice\(p\.choice\) && getChoiceBase\(p\.choice\)\s*\n\s*\)\.map\(p => \(\{ id: p\.id, base: getChoiceBase\(p\.choice\) \}\)\);/);
  });
});

describe('Build22-D — shadowMismatch event retained in QA report', () => {
  it('summary()는 shadowMismatchEvents(최근 최대 20건)와 lastShadowMismatchEvent를 recent[] 300캡과 무관하게 별도로 노출한다', () => {
    expect(html).toContain('shadowMismatchEvents: (sm.mismatches || []).slice(-20),');
    expect(html).toContain("lastShadowMismatchEvent: (sm.mismatches && sm.mismatches.length) ? sm.mismatches[sm.mismatches.length - 1] : null,");
  });

  it('mismatches 원본 배열 자체도 무한누적되지 않도록 100건으로 캡한다(메모리 안전)', () => {
    expect(html).toMatch(/if \(!match\) \{ M\.mismatches\.push\(rec\); if \(M\.mismatches\.length > 100\) M\.mismatches\.shift\(\); \}/);
  });
});

describe('Build22-D — sync late render over 1000 summary counter', () => {
  it('summary()는 countdownServerTsZeroCount/resultValueNullCount/syncLateRenderOver1000Count를 recent[] 트리밍과 무관한 누적 카운터로 노출한다', () => {
    expect(html).toContain('countdownServerTsZeroCount: m.counts.countdownServerTsZero,');
    expect(html).toContain('resultValueNullCount: m.counts.resultValueNull,');
    expect(html).toContain('syncLateRenderOver1000Count: m.counts.syncLateRenderOver1000,');
    // emit()에서 세 카운터가 recent[] cap과 무관하게 매 이벤트마다 누적된다.
    expect(html).toMatch(/if \(rec\.eventType === 'INVALID_COUNTDOWN_SERVER_TS'\) m\.counts\.countdownServerTsZero\+\+;/);
    expect(html).toMatch(/if \(rec\.eventType === 'ROUND_RESULT' && rec\.resultValue == null\) m\.counts\.resultValueNull\+\+;/);
    expect(html).toMatch(/if \(rec\.eventType === 'SYNC_LATE_RENDER'\) m\.counts\.syncLateRenderOver1000\+\+;/);
  });

  it('scripts/qa-analyze.mjs(오프라인 CLI 분석기)도 동일 3항목을 recent[]에서 직접 집계하고 Build22 인수기준 게이트로 노출한다', async () => {
    const { analyzeQAMetrics } = await import('../scripts/qa-analyze.mjs');
    const recent = [
      { eventType: 'INVALID_COUNTDOWN_SERVER_TS' },
      { eventType: 'ROUND_RESULT', resultValue: null },
      { eventType: 'ROUND_RESULT', resultValue: 'win' },
      { eventType: 'SYNC_LATE_RENDER', lateRenderMs: 1827 },
      { eventType: 'TAGGER_SNAPSHOT_GAVE_UP' },
    ];
    const { report, gate } = analyzeQAMetrics({ recent });
    expect(report.countdownServerTsZeroCount).toBe(1);
    expect(report.resultValueNullCount).toBe(1);
    expect(report.syncLateRenderOver1000Count).toBe(1);
    expect(report.taggerSnapshotGaveUpCount).toBe(1);
    expect(gate['WRPS-036-B22 countdownStartServerTs 0 = 0']).toBe('FAIL');
    expect(gate['WRPS-SYNC syncLateRenderOver1000 = 0']).toBe('FAIL');
  });
});
