import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveElimination, getActiveIds, computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';
import { analyzeQAMetrics } from '../scripts/qa-analyze.mjs';

// Build23 — Critical Fix(부분 재경기 중 host '한번더' 버튼 차단 + QA export previousSession 누락).
// 실기기 재현: 3인 게임에서 tooMany(패자>슬롯)/tooFew(패자<슬롯) 부분 재경기 진행 중에도 host
// 화면의 '한번더' 버튼이 활성화되어, 누르면 부분 재경기 대신 전체 참여자 재경기로 바뀌는 버그.
//
// 근본 원인(코드 추적으로 확인, 추측 아님): 버튼 노출(renderRoundResult의 caseType)과 handler
// 방어(returnToLobbyAfterGame의 room.status 체크)가 서로 다른 소스를 봤다 — room.status='result'는
// gameOver와 tooMany/tooFew 모두에서 동일하게 유지되어(tooMany/tooFew는 DB status를 건드리지
// 않음) 둘을 구분하지 못했다.
//
// codex-critic 1차 검토에서 HIGH 회귀 발견: 처음 구현(confirmedLoserIds.length >= targetLoserCount
// 카운트 비교)은 finishRoundLocal()의 "중도 퇴장 등으로 활성자가 남은 슬롯 이하" deadlock 방지
// 분기(다중 술래 게임에서 실제로 발생 가능)에서 게임이 정당하게 끝났는데도 영구 차단되는 새 회귀를
// 만들었다. 수정: getActivePlayers()(미확정 활성 참가자 풀)가 비었는가로 판단 — finishRoundLocal()의
// 모든 종료 분기가 이번 라운드 활성자 전원을 반드시 safe/loser로 분류하므로, 활성 풀이 비었다는
// 것 자체가 resolveElimination()의 isComplete:true와 동치인 신뢰 가능한 신호다.
//
// 판정 알고리즘(resolveElimination/judgePure)은 무변경 — 요구된 8개 테스트를 정확히 구현한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

// index.html의 실제 소스(hand-copy 아님)를 추출해 mock state에서 실행한다 — 이 파일이 모듈이
// 아니라서 직접 import할 수 없는 부분을 tests/qa-persistence.test.mjs의 loadQA() 패턴과 동일하게
// new Function()으로 감싼다. codex-critic이 "테스트가 로직 사본만 검증해 실제 구현 회귀를 못
// 잡는다"고 지적한 것에 대한 직접적인 보완 — canShowPlayAgainButton/blockPlayAgainIfPartialReplay/
// isTaggerSelectionComplete/getActivePlayers/getTargetLoserCount는 전부 실제 index.html 코드다.
const PENALTY_BLOCK = extractBlock(
  'function toPositiveInt(value, fallback = 0) {',
  'function getCountdownStartAt(raw) {'
);
const GUARD_BLOCK = extractBlock(
  'function getActivePlayers() {',
  'function isJoinLocked('
);

function loadPlayAgainGuard({ participants, confirmedSafeIds = [], confirmedLoserIds = [], role = 'host', targetLoserCount = 1, lastRoundResolution = null, round = 1, gameRound = 1 }) {
  const state = {
    role, participants, confirmedSafeIds, confirmedLoserIds,
    penalty: { text: '', loserCount: targetLoserCount }, // parsePenalty 객체분기 통해 loserCount 주입
    targetLoserCount, lastRoundResolution, round, gameRound,
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const factory = new Function(
    'state', 'QA', 'computePlayerStatuses', 'PLAYER_STATUS',
    PENALTY_BLOCK + '\n' + GUARD_BLOCK +
    '\n; return { getActivePlayers, isTaggerSelectionComplete, canShowPlayAgainButton, blockPlayAgainIfPartialReplay, getTargetLoserCount, getGameRound };'
  );
  const guard = factory(state, QA, computePlayerStatuses, PLAYER_STATUS);
  return { guard, state, emitted };
}

// 3인 참가자 고정 픽스처(요구사항 #1/#2가 명시한 targetTaggerCount/losers/participants=3 시나리오).
const THREE_PLAYERS = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

describe('Build23-#1 — targetTaggerCount=1, losers=2, participants=3 → losers-only partial replay', () => {
  it('tooMany 판정(resolveElimination, 실제 판정 함수), nextActiveIds는 패자 2명만(승자 1명 제외)', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'lose' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 1 });
    expect(res.outcome).toBe('tooMany');
    expect([...res.nextActiveIds].sort()).toEqual(['p1', 'p2']);
    expect(res.newConfirmedSafeIds).toEqual(['p3']);
    expect(res.newConfirmedLoserIds).toEqual([]);
    expect(res.isComplete).toBe(false);
  });

  it('host play again hidden/disabled — resolveElimination 결과를 실제 index.html canShowPlayAgainButton()에 넣으면 false', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'lose' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 1 });
    const { guard } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 1,
    });
    expect(guard.canShowPlayAgainButton()).toBe(false);
  });

  it('pressing handler(실제 blockPlayAgainIfPartialReplay) does not restore all 3 participants — blocked, metric emitted', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'lose' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 1 });
    const { guard, emitted } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 1,
    });
    expect(guard.blockPlayAgainIfPartialReplay()).toBe(true); // 차단됨 = beginNewGameRound 호출 안 됨
    expect(guard.getActivePlayers().length).toBe(2); // 패자 2명만 여전히 활성(3명으로 복원 안 됨)
    expect(emitted[0].eventType).toBe('PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY');
  });
});

describe('Build23-#2 — targetTaggerCount=2, losers=1, participants=3 → winners-only partial replay', () => {
  it('tooFew 판정, 확정 술래 1명 제외, nextActiveIds는 승자 2명만', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'win' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 2 });
    expect(res.outcome).toBe('tooFew');
    expect([...res.nextActiveIds].sort()).toEqual(['p2', 'p3']);
    expect(res.newConfirmedLoserIds).toEqual(['p1']);
    expect(res.isComplete).toBe(false);
  });

  it('host play again hidden/disabled — 실제 canShowPlayAgainButton()이 false', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'win' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 2 });
    const { guard } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 2,
    });
    expect(guard.canShowPlayAgainButton()).toBe(false);
  });

  it('pressing handler does not restore all 3 participants — blocked, activeCandidates는 여전히 2명(승자만)', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'win' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 2 });
    const { guard, emitted } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 2,
    });
    expect(guard.blockPlayAgainIfPartialReplay()).toBe(true);
    expect(guard.getActivePlayers().length).toBe(2);
    expect(emitted[0].eventType).toBe('PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY');
  });
});

describe('Build23-#3 — partial replay 상태에서 resetGameKeepRoom 직접 호출 → blocked + metric emitted', () => {
  it('resetGameKeepRoom()은 beginNewGameRound() 호출 전 blockPlayAgainIfPartialReplay()로 하드블록한다(소스 계약)', () => {
    expect(html).toMatch(/async function resetGameKeepRoom\(\) \{[\s\S]{0,200}if \(blockPlayAgainIfPartialReplay\(\)\) return;[\s\S]{0,200}await beginNewGameRound\(/);
  });

  it('returnToLobbyAfterGame()도 beginNewGameRound() 호출 전 동일하게 하드블록한다(소스 계약)', () => {
    // Build30 Phase1: role 체크 앞에 hideTaggerPopup() 호출(팝업 즉시 제거)이 추가되어 거리가
    // 늘었다 — 순서(hideTaggerPopup → role 체크 → 하드블록)는 그대로이므로 허용 범위만 넓힌다.
    expect(html).toMatch(/async function returnToLobbyAfterGame\(\) \{[\s\S]{0,300}if \(state\.role !== "host"\) return;[\s\S]{0,300}if \(blockPlayAgainIfPartialReplay\(\)\) return;/);
  });

  it('실제 blockPlayAgainIfPartialReplay()는 차단 시 PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY 메트릭을 정확한 진단 필드와 함께 방출한다', () => {
    const { guard, emitted } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: ['p3'], confirmedLoserIds: [], role: 'host', targetLoserCount: 1,
    });
    expect(guard.blockPlayAgainIfPartialReplay()).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      eventType: 'PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY', reason: 'partialReplayNotComplete',
      activeCandidateCount: 2, participantCount: 3, targetTaggerCount: 1,
    });
  });

  it('실제 isTaggerSelectionComplete() 도달 시(활성 풀이 비면) 더는 차단하지 않는다', () => {
    const { guard, emitted } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: ['p2', 'p3'], confirmedLoserIds: ['p1'], role: 'host', targetLoserCount: 1,
    });
    expect(guard.getActivePlayers().length).toBe(0); // 전원 분류 완료
    expect(guard.blockPlayAgainIfPartialReplay()).toBe(false);
    expect(emitted).toHaveLength(0);
  });
});

describe('Build23-#4 — taggerSelectionComplete=false → playAgain unavailable', () => {
  it('host라도 활성 풀에 미확정 참가자가 남아있으면(taggerSelectionComplete=false) 실제 canShowPlayAgainButton()은 false', () => {
    const { guard: guardTooMany } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: ['p3'], confirmedLoserIds: [], role: 'host', targetLoserCount: 1,
    });
    expect(guardTooMany.isTaggerSelectionComplete()).toBe(false);
    expect(guardTooMany.canShowPlayAgainButton()).toBe(false);

    const { guard: guardTooFew } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: [], confirmedLoserIds: ['p1'], role: 'host', targetLoserCount: 2,
    });
    expect(guardTooFew.isTaggerSelectionComplete()).toBe(false);
    expect(guardTooFew.canShowPlayAgainButton()).toBe(false);
  });

  it('non-host는 taggerSelectionComplete 여부와 무관하게 항상 false(한번더는 host 전용)', () => {
    const { guard } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: ['p2', 'p3'], confirmedLoserIds: ['p1'], role: 'participant', targetLoserCount: 1,
    });
    expect(guard.isTaggerSelectionComplete()).toBe(true); // 완료 상태이긴 하지만
    expect(guard.canShowPlayAgainButton()).toBe(false); // host가 아니므로 여전히 false
  });
});

describe('Build23-#5 — confirmedTaggerCount === targetTaggerCount(활성 풀 비어있음) → playAgain available', () => {
  it('host이고 전원 확정(활성 풀 0)이면 실제 canShowPlayAgainButton()은 true', () => {
    const { guard } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: ['p2', 'p3'], confirmedLoserIds: ['p1'], role: 'host', targetLoserCount: 1,
    });
    expect(guard.canShowPlayAgainButton()).toBe(true);
  });

  it('codex-critic HIGH 회귀 재현 케이스: 다중술래(target=3) 게임에서 활성자가 슬롯 이하로 줄어 deadlock 조기종료돼도(count<target) 실제 canShowPlayAgainButton()은 true(카운트 비교였다면 false로 영구차단)', () => {
    // resolveElimination의 deadlock 방지 분기(activePlayers.length<=remainingSlots)를 실제 판정
    // 함수로 재현: target=3, p1은 이미 확정 술래·p2는 이미 확정 안전(직전 라운드까지), 이번 라운드엔
    // p3 혼자만 활성 → remainingSlots(target3-prevLoser1=2) >= activePlayers(1) → deadlock 조기종료.
    const res = resolveElimination({
      roundResults: [{ id: 'p3', result: 'win' }], // 활성자 1인만 이번 라운드 대상, 승패는 무관(조기종료는 result 무시)
      prevLoserIds: ['p1'], prevSafeIds: ['p2'], targetLoserCount: 3,
    });
    expect(res.outcome).toBe('gameOver');
    expect(res.isComplete).toBe(true);
    expect(res.newConfirmedLoserIds.length).toBeLessThan(3); // 카운트는 target(3)에 못 미침 — 이게 회귀의 함정이었다
    const { guard } = loadPlayAgainGuard({
      participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 3,
    });
    expect(guard.getActivePlayers().length).toBe(0); // 활성 풀은 비었다(=진짜 종료, p1/p2/p3 전원 분류됨)
    expect(guard.canShowPlayAgainButton()).toBe(true); // 회귀 있었다면 여기서 false로 실패했을 것
    expect(guard.blockPlayAgainIfPartialReplay()).toBe(false); // 재초대/한번더 모두 정상 진행 가능
  });

  it('renderRoundResult()는 gameOver caseType에서만 canShowPlayAgainButton()으로 버튼 html을 게이트한다(소스 계약)', () => {
    expect(html).toMatch(/if \(canShowPlayAgainButton\(\)\) \{[\s\S]{0,200}window\.returnToLobbyAfterGame\(\)/);
  });
});

describe('Build23-#6 — tooMany 이후 activeCandidates는 losers only 유지', () => {
  it('tooMany 결과의 nextActiveIds로 다음 라운드를 진행해도 활성 집합이 승자로 되돌아가지 않는다(실제 getActivePlayers 포함)', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'lose' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 1 });
    const activeIds = getActiveIds(THREE_PLAYERS, res.newConfirmedSafeIds, res.newConfirmedLoserIds);
    expect([...activeIds].sort()).toEqual(['p1', 'p2']);
    expect(activeIds).not.toContain('p3');
    const { guard } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 1,
    });
    expect(guard.getActivePlayers().map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });
});

describe('Build23-#7 — tooFew 이후 activeCandidates는 winners only 유지', () => {
  it('tooFew 결과의 nextActiveIds로 다음 라운드를 진행해도 활성 집합에 확정 술래가 되돌아오지 않는다(실제 getActivePlayers 포함)', () => {
    const roundResults = [
      { id: 'p1', result: 'lose' }, { id: 'p2', result: 'win' }, { id: 'p3', result: 'win' },
    ];
    const res = resolveElimination({ roundResults, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 2 });
    const activeIds = getActiveIds(THREE_PLAYERS, res.newConfirmedSafeIds, res.newConfirmedLoserIds);
    expect([...activeIds].sort()).toEqual(['p2', 'p3']);
    expect(activeIds).not.toContain('p1');
    const { guard } = loadPlayAgainGuard({
      participants: THREE_PLAYERS, confirmedSafeIds: res.newConfirmedSafeIds, confirmedLoserIds: res.newConfirmedLoserIds,
      role: 'host', targetLoserCount: 2,
    });
    expect(guard.getActivePlayers().map((p) => p.id).sort()).toEqual(['p2', 'p3']);
  });
});

describe('Build23-#8 — UI 버튼 조건과 handler 조건이 같은 state source를 사용함', () => {
  it('canShowPlayAgainButton()과 blockPlayAgainIfPartialReplay() 모두 isTaggerSelectionComplete()를 단일 진실 소스로 참조한다(소스 계약)', () => {
    // Build46 연속 매치: 한번더 = 매치 "완료 후 새 매치" 전용 — host+술래확정 단일 진실 소스는 유지되고
    // isMatchComplete 게이트가 추가됐다(미완료 판은 자동 진행이라 버튼 금지).
    expect(html).toMatch(/if \(!\(state\.role === "host" && isTaggerSelectionComplete\(\)\)\) return false;/);
  });

  // WRPS-083 2A(계약 갱신): ACTIVE=0을 C-1(정상 완료)과 C-2(판정 참가자 없음)로 구분하는 분기가
  // 추가됐다. Build23의 원 계약(room.status 미참조 + 활성 풀 기반 단일 진실 소스)은 그대로다 —
  // 술래 수 비교는 "WAITING이 남아 있을 때"로 한정된 예외이며, WAITING=0인 기존 조합에서는 이
  // 분기가 항상 거짓이라 Build23 시점과 반환값이 동일하다(tests/waiting-state-stage2a.test.mjs가
  // 그 동치성과 C-2 예외를 실제 실행으로 검증한다).
  it('isTaggerSelectionComplete()는 활성 풀(getActivePlayers) 기반으로 정의되고, C-2(WAITING 잔존 + 술래 미달)만 예외다(room.status 미참조)', () => {
    expect(html).toMatch(/function isTaggerSelectionComplete\(\) \{\s*\n\s*if \(\(state\.participants \|\| \[\]\)\.length === 0\) return false;\s*\n\s*if \(getActivePlayers\(\)\.length !== 0\) return false;\s*\n\s*if \(getWaitingPlayers\(\)\.length > 0 &&\s*\n\s*\(state\.confirmedLoserIds \|\| \[\]\)\.length < getTargetLoserCount\(\)\) return false;\s*\n\s*return true;\s*\n\s*\}/);
    const body = html.slice(html.indexOf('function isTaggerSelectionComplete() {'));
    expect(body.slice(0, body.indexOf('\n    }'))).not.toContain('state.status');
  });

  it('codex-critic 재검토(2차) LOW 지적 수정: 참가자가 비어있으면(state.participants=[]) 완료로 오판하지 않는다', () => {
    const { guard } = loadPlayAgainGuard({
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [], role: 'host', targetLoserCount: 1,
    });
    expect(guard.getActivePlayers().length).toBe(0); // 활성 풀은 비어있지만
    expect(guard.isTaggerSelectionComplete()).toBe(false); // 참가자 자체가 없으므로 "완료"가 아니다
    expect(guard.canShowPlayAgainButton()).toBe(false);
    expect(guard.blockPlayAgainIfPartialReplay()).toBe(true);
  });

  it('실제 함수 레벨에서도 두 조건이 동일 입력에 대해 항상 같은 완료여부를 반환한다(발산 없음)', () => {
    const cases = [
      { safe: [], loser: [], target: 1 }, // 진행중
      { safe: ['p3'], loser: [], target: 1 }, // tooMany 중간
      { safe: [], loser: ['p1'], target: 2 }, // tooFew 중간
      { safe: ['p2', 'p3'], loser: ['p1'], target: 1 }, // 완료
    ];
    for (const c of cases) {
      const { guard } = loadPlayAgainGuard({
        participants: THREE_PLAYERS, confirmedSafeIds: c.safe, confirmedLoserIds: c.loser, role: 'host', targetLoserCount: c.target,
      });
      expect(guard.canShowPlayAgainButton()).toBe(guard.isTaggerSelectionComplete());
      expect(guard.blockPlayAgainIfPartialReplay()).toBe(!guard.isTaggerSelectionComplete());
    }
  });
});

describe('Build23-#8-보조 — QA export previousSession 누락 수정 (요구사항 #8)', () => {
  it('qa-analyze.mjs는 실제 qa-report.v1 파일 스키마(qaMetrics.recent 중첩)를 top-level recent와 동일하게 읽는다', () => {
    const fakeExport = {
      qaMetrics: { recent: [
        { eventType: 'ROUND_RESULT', legacyOutcome: 'tooMany', resultValue: 'win' },
        { eventType: 'PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY', reason: 'partialReplayNotComplete' },
      ] },
    };
    const { report } = analyzeQAMetrics(fakeExport);
    expect(report.samples).toBe(2);
    expect(report.playAgainBlockedCount).toBe(1);
  });

  it('previousSession(앱 재시작 시 복구된 직전 세션)의 qaMetrics.recent도 분석에 병합한다', () => {
    const fakeExport = {
      qaMetrics: { recent: [
        { eventType: 'QA_SESSION_START' }, { eventType: 'QA_SESSION_RECOVERED' },
      ] }, // 새로고침 직후 export — 현재 세션은 거의 빈 상태
      previousSession: {
        qaMetrics: { recent: [
          { eventType: 'ROUND_RESULT', legacyOutcome: 'tooMany', resultValue: 'win' },
          { eventType: 'PLAY_AGAIN_BUTTON_STATE', visible: true, reason: 'partialReplayLosersOnly' },
        ] },
      },
    };
    const { report } = analyzeQAMetrics(fakeExport);
    // 현재 세션(2건) + 이전 세션(2건) = 4건 모두 분석에 포함되어야 한다(이전엔 previousSession을
    // 아예 읽지 않아 현재 세션의 2건만 잡혔음).
    expect(report.samples).toBe(4);
    expect(report.previousSessionMerged).toBe(2);
    expect(report.playAgainVisibleDuringPartialReplayCount).toBe(1);
  });

  it('배열/플랫 {recent:[...]} 입력(기존 fixture·copyText 포맷)은 계속 동일하게 동작한다(하위호환)', () => {
    expect(analyzeQAMetrics([{ eventType: 'CLOCK_SYNC', offsetMs: 80 }]).report.samples).toBe(1);
    expect(analyzeQAMetrics({ recent: [{ eventType: 'CLOCK_SYNC', offsetMs: 80 }] }).report.samples).toBe(1);
  });
});
