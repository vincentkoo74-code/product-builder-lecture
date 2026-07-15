import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build19 — Critical Fix (음성 TTS override / 동기화 scheduled-render / 판정 레이스 방지) 회귀 방지.
// 판정 알고리즘 자체(tooMany/tooFew/exact/allDraw)는 src/game-logic.mjs의 resolveElimination()이
// 이미 37개 테스트(tests/elimination.test.mjs)로 검증되어 있고, index.html의 finishRoundLocal()
// 인라인 분기는 그 조건과 동일함을 코드 대조로 확인함(Build19는 "표적 수정"만 진행— 데이터
// 신선도/재분류 방지가 실제 결함이었음). 여기서는 Build19가 새로 추가한 코드만 검증한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('WRPS-072-B19 — 라운드 재분류 방지(idempotency) + host 데이터 신선도', () => {
  it('finishRoundLocal은 동일 eventId를 재계산하지 않고 캐시된 결과로 재렌더링한다', () => {
    expect(html).toMatch(/const roundEventId = getGameRound\(\) \+ ':' \+ \(state\.round \|\| 1\);/);
    expect(html).toMatch(/if \(state\.lastRoundResolution && state\.lastRoundResolution\.eventId === roundEventId\)/);
  });

  it('5개 종료 지점 모두 lastRoundResolution을 기록한다(gameOver-조기/allDraw/gameOver·tooMany·tooFew fall-through)', () => {
    const matches = html.match(/state\.lastRoundResolution = \{ eventId: roundEventId,/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3); // 조기gameOver, allDraw, fall-through(3분기 공유 1곳)
  });

  it('lastRoundResolution은 resultVoiceKey/resultMetricKey와 동일한 3개 지점(새 게임회차/세션/방)에서 초기화된다', () => {
    expect((html.match(/state\.lastRoundResolution = null/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('fetchFreshParticipantsForResult는 미해결 활성참가자가 있으면 재시도하고 QA에 남긴다', () => {
    expect(html).toContain('async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300)');
    expect(html).toContain("eventType: 'TAGGER_SNAPSHOT_STALE'");
    expect(html).toContain("eventType: 'TAGGER_SNAPSHOT_GAVE_UP'");
  });

  it('status=result/game_over 리스너는 fetchFreshParticipantsForResult를 거친 뒤에만 finishRoundLocal을 호출한다', () => {
    // Build22-B: waitForPhaseRender의 duplicate-skip 판정이 사이에 추가되어, finishRoundLocal()은
    // resultIsFirstRender(첫 렌더)일 때만 호출된다(중복 렌더 시 재전환 방지) — 순서 보장 자체는 유지.
    // Build24-A: waitForPhaseRender가 이제 fetchFreshParticipantsForResult보다 먼저 호출되지만
    // (렌더-타이밍 측정과 스냅샷 재시도 대기를 분리), fetchFreshParticipantsForResult →
    // finishRoundLocal의 상대 순서 자체(fetch가 반드시 먼저)는 그대로 유지된다.
    expect(html).toMatch(/await fetchFreshParticipantsForResult\(state\.roomCode\);[\s\S]{0,900}finishRoundLocal\(\);/);
  });
});

describe('WRPS-052-B19 — TTS 코드는 완전히 제거된 상태로 유지된다(Build21에서 재확인)', () => {
  it('TTS 관련 코드/변수가 존재하지 않는다(whisper 전사로 풀구호 녹음 부재 확정 후 되돌림, Build21에서 실제 MC 녹음으로 대체)', () => {
    expect(html).not.toMatch(/const TTS_OVERRIDE = \{/);
    expect(html).not.toContain('voiceTtsActive');
    expect(html).not.toContain('currentTtsUtterance');
    expect(html).not.toContain('function playVoiceTts');
    expect(html).not.toContain('function ttsAvailable');
  });

  it('우선순위 가드는 두 채널(WebAudio+fallback)만 검사한다(TTS 채널 제거됨)', () => {
    expect((html.match(/\(voiceNode \|\| voiceFallbackEl\) && pri < voicePriority/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('WRPS-036-B19 — clock sync 재시도 + 카운트다운 예정시각 결손 처리', () => {
  it('syncServerClock은 0 샘플이면 1회 재시도한다(무한루프 아님 — retry=false 재귀)', () => {
    expect(html).toMatch(/async function syncServerClock\(retry = true\)/);
    expect(html).toMatch(/if \(!offsets\.length && retry\) \{[\s\S]{0,200}await syncServerClock\(false\);/);
  });

  it('CLOCK_SYNC metric에 rttMs/spreadMs/synced가 추가된다', () => {
    expect(html).toMatch(/eventType: 'CLOCK_SYNC', offsetMs: serverClockOffsetMs,\s*\n?\s*samples: offsets\.length, spreadMs, rttMs, synced: serverClockSynced/);
  });

  it('countdownStartServerTs가 0/null이면 INVALID_COUNTDOWN_SERVER_TS를 남기고 재조회를 시도한다', () => {
    // Build22-A: 1회성 재조회는 바운드 재시도(최대 5회, waitForValidCountdownStart)로 강화되었고,
    // 그래도 invalid면 하드블록(countdown 시작/voice 재생 안 함)으로 이어진다(build22 테스트 참조).
    expect(html).toContain("eventType: 'INVALID_COUNTDOWN_SERVER_TS'");
    expect(html).toMatch(/async function waitForValidCountdownStart\(maxAttempts = 5, delayMs = 500\) \{[\s\S]{0,400}rooms'\)\.select\('penalty'\)/);
  });
});

describe('WRPS-SYNC-B19 — RESULT/NEXT_ROUND/GAME_OVER/COUNTDOWN scheduled-render', () => {
  it('penalty 인코딩이 phaseScheduledAt/phaseKind를 지원한다(DB 스키마 변경 없이 기존 blob 재사용)', () => {
    expect(html).toContain('phaseScheduledAt: toPositiveInt(raw.phaseScheduledAt, 0)');
    expect(html).toContain('phaseScheduledAt: toPositiveInt(p.phaseScheduledAt, 0)');
    expect(html).toMatch(/function buildPenaltyValue\(\{[\s\S]{0,200}phaseScheduledAt = 0, phaseKind = ""/);
  });

  it('updateRoomStatusScheduled는 status와 예정시각을 원자적으로 함께 기록한다', () => {
    expect(html).toMatch(/async function updateRoomStatusScheduled\(status, phaseKind\)[\s\S]{0,300}await db\.from\('rooms'\)\.update\(\{ status, penalty \}\)/);
  });

  it('publishHostRoundResult의 두 커밋 지점 모두 updateRoomStatusScheduled를 사용한다', () => {
    expect((html.match(/await updateRoomStatusScheduled\("result", "result"\)/g) || []).length).toBe(2);
  });

  it('nextRound()는 ready 전환에도 예정시각을 함께 기록한다', () => {
    expect(html).toContain('phaseKind: "ready" });');
    expect(html).toContain("status: 'ready', penalty: readyPenalty");
  });

  it('waitForPhaseRender는 SYNC_RENDER와 1000ms 초과 시 SYNC_LATE_RENDER를 방출한다', () => {
    expect(html).toContain("eventType: 'SYNC_RENDER'");
    expect(html).toMatch(/if \(lateRenderMs > 1000\) \{[\s\S]{0,80}SYNC_LATE_RENDER/);
  });

  it('result/game_over 리스너와 ready 리스너 모두 phaseKind를 확인 후에만 예정시각을 신뢰한다(다른 phase의 stale 값 오사용 방지)', () => {
    expect(html).toMatch(/resultPenaltyParsed\.phaseKind === "result"\) \? resultPenaltyParsed\.phaseScheduledAt : 0/);
    expect(html).toMatch(/readyPenaltyParsed\.phaseKind === "ready"\) \? readyPenaltyParsed\.phaseScheduledAt : 0/);
  });

  it('countdown 단계도 동일 스키마의 SYNC_RENDER를 방출해 4개 phase가 분석기에서 동일하게 비교된다', () => {
    expect(html).toContain("eventType: 'SYNC_RENDER', phase: 'countdown',");
    expect(html).toContain("eventType: 'SYNC_LATE_RENDER', phase: 'countdown'");
  });
});

// 게임 판정/서버/UI 구조 무변경 계약(Build19 금지사항 회귀 방지)
describe('Build19 비침습 계약(금지사항)', () => {
  it('판정 순수함수는 그대로 유지된다(resolveElimination/judgePure 시그니처 불변)', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
  });
  it('Build17/18 QA persistence 구조는 유지된다', () => {
    expect(html).toContain("const QA_STORAGE_KEY = 'rpsQAReport.v1'");
    expect(html).toContain('function exportFile(');
  });
});
