import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Build21 — CLIPS(SoundManager) 매핑 구조 검증. 실 CLIPS 리터럴을 index.html에서 추출해
// 진짜 JS 객체로 평가한 뒤(정규식 매칭이 아닌 구조적 검증) 경로 존재/스냅샷/legacy 호환을 확인한다.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const VOICE_ROOT = resolve(REPO_ROOT, 'ASSETS/rps/voice');
const html = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8');

function extractClips() {
  const start = html.indexOf('const CLIPS = {');
  if (start === -1) throw new Error('CLIPS block not found in index.html');
  // "};"로 끝나는 지점을 찾되, ko/ja/en 3개 서브객체를 모두 포함해야 하므로 en 블록 종료 지점 이후의
  // 첫 단독 "};"를 종료로 삼는다(들여쓰기 6칸 — 최상위 CLIPS 객체 닫힘).
  const end = html.indexOf('\n      };', start);
  if (end === -1) throw new Error('CLIPS block closing brace not found');
  const literal = html.slice(start, end + '\n      };'.length).replace('const CLIPS = ', '');
  // eslint 없는 순수 데이터 리터럴이므로 Function으로 안전하게 평가(외부 참조 없음).
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal}`)();
}

const CLIPS = extractClips();

const NEW_KEYS = ['ready', 'countdownRps', 'retry', 'drawRetry', 'replayLosersOnly', 'replayWinnersOnly', 'taggerSelected', 'gameOver'];
// Build47 필드QA 정정(항목 2): GAME 순번 안내 11종 — ko/ja/en 공통. 파일 존재 루프가 실제 mp3 존재까지 검증한다.
const GAME_NO_KEYS = [...Array.from({ length: 10 }, (_, i) => `gameStart${i + 1}`), 'gameStartNext'];
const LEGACY_KEYS_COMMON = ['intro', 'go', 'becameLoser', 'continue'];
const LEGACY_KEYS_KO_ONLY = ['countScissors', 'countRock', 'countPaper'];

describe('Build21 — CLIPS 구조 스냅샷(ko/ja/en)', () => {
  it('ko/ja/en 3개 로케일이 모두 존재한다', () => {
    expect(Object.keys(CLIPS).sort()).toEqual(['en', 'ja', 'ko']);
  });

  it('ko는 8개 신규 키 + 4개 공통 legacy + 3개 ko전용 legacy(총 15개)를 갖는다', () => {
    const keys = Object.keys(CLIPS.ko).sort();
    expect(keys).toEqual([...NEW_KEYS, ...GAME_NO_KEYS, ...LEGACY_KEYS_COMMON, ...LEGACY_KEYS_KO_ONLY].sort());
  });

  it('ja/en은 8개 신규 키 + 4개 공통 legacy(총 12개, countScissors류 없음)를 갖는다', () => {
    for (const locale of ['ja', 'en']) {
      const keys = Object.keys(CLIPS[locale]).sort();
      expect(keys).toEqual([...NEW_KEYS, ...GAME_NO_KEYS, ...LEGACY_KEYS_COMMON].sort());
    }
  });

  it('각 로케일의 8개 신규 키는 해당 로케일 접두어 파일명을 가리킨다', () => {
    for (const locale of ['ko', 'ja', 'en']) {
      for (const key of NEW_KEYS) {
        expect(CLIPS[locale][key], `${locale}.${key}`).toMatch(new RegExp(`^${locale}/${locale}_`));
      }
    }
  });
});

describe('Build21 — audio mapping에 존재하지 않는 파일 경로가 없다(dangling path 방지)', () => {
  for (const locale of Object.keys(CLIPS)) {
    for (const [key, relPath] of Object.entries(CLIPS[locale])) {
      it(`${locale}.${key} → ${relPath} 파일이 실제로 존재한다`, () => {
        const abs = resolve(VOICE_ROOT, relPath);
        expect(existsSync(abs), `missing file for ${locale}.${key}: ${relPath}`).toBe(true);
      });
    }
  }
});

describe('Build21 — legacy key compatibility', () => {
  it('ko의 legacy 키(intro/go/becameLoser/continue/countScissors/countRock/countPaper)가 전부 유효한 파일을 가리킨다', () => {
    for (const key of [...LEGACY_KEYS_COMMON, ...LEGACY_KEYS_KO_ONLY]) {
      const relPath = CLIPS.ko[key];
      expect(relPath, `ko.${key}`).toBeTruthy();
      expect(existsSync(resolve(VOICE_ROOT, relPath)), `ko.${key} -> ${relPath}`).toBe(true);
    }
  });

  it('ja/en의 legacy 키(intro/go/becameLoser/continue)가 전부 유효한 파일을 가리킨다', () => {
    for (const locale of ['ja', 'en']) {
      for (const key of LEGACY_KEYS_COMMON) {
        const relPath = CLIPS[locale][key];
        expect(relPath, `${locale}.${key}`).toBeTruthy();
        expect(existsSync(resolve(VOICE_ROOT, relPath)), `${locale}.${key} -> ${relPath}`).toBe(true);
      }
    }
  });

  it('legacy intro/go는 새 countdownRps로, becameLoser는 taggerSelected로, continue는 replayWinnersOnly로 별칭된다', () => {
    for (const locale of ['ko', 'ja', 'en']) {
      expect(CLIPS[locale].intro).toBe(CLIPS[locale].countdownRps);
      expect(CLIPS[locale].go).toBe(CLIPS[locale].countdownRps);
      expect(CLIPS[locale].becameLoser).toBe(CLIPS[locale].taggerSelected);
      expect(CLIPS[locale].continue).toBe(CLIPS[locale].replayWinnersOnly);
    }
  });
});

describe('Build21 — runCountdown() 2박자 통일 구조(정적 계약)', () => {
  it('ko/ja/en 공통 로직으로 ready → countdownRps 순서로 재생한다(로케일 분기 없음)', () => {
    // Build47 항목2: 1박자는 GAME 순번 안내(__gameAnnounce)가 있으면 그것으로 대체, 없으면 기존 ready.
    expect(html).toContain('void playVoiceClip(__gameAnnounce ? __gameAnnounce.key : "ready");');
    expect(html).toContain('void playVoiceClip("countdownRps");');
    expect(html).toContain('const COUNTDOWN_TIMING = {');
    expect(html).toMatch(/ko: \{ readySleepMs: \d+, rpsSleepMs: \d+ \}/);
    expect(html).toMatch(/ja: \{ readySleepMs: \d+, rpsSleepMs: \d+ \}/);
    expect(html).toMatch(/en: \{ readySleepMs: \d+, rpsSleepMs: \d+ \}/);
  });
});

describe('Build21 — finishRoundLocal() 그룹 음성 공지(정적 계약)', () => {
  it('5개 결과 분기가 각각 올바른 신규 audioKey를 호출한다', () => {
    // Build40 P0-1: 분기마다 음성 키를 직접 고르지 않는다. 각 분기는 continuationMode 를
    // announceContinuation(mode, caseType, delayMs) 에 넘기고, 키는 continuationVoiceKey(mode) 가
    // 단일 매핑으로 돌려준다 — 화면 문구와 음성이 같은 mode 에서 나오게 하기 위해서다.
    // 계약(어느 분기가 어느 음성인가)은 그대로이고, 검사 지점만 mode 매핑으로 옮긴다.
    expect(html).toContain('announceContinuation("FINAL", "gameOver", 2200)');
    expect(html).toContain('announceContinuation("ALL", "draw", 300)');
    expect(html).toContain('announceContinuation("LOSERS", "tooMany", 600)');
    expect(html).toContain('announceContinuation("WINNERS", "tooFew", 600)');
    const vk = html.slice(html.indexOf('function continuationVoiceKey('), html.indexOf('function getAuthoritativeContinuation('));
    expect(vk).toContain('if (mode === "FINAL")   return "taggerSelected";');
    expect(vk).toContain('if (mode === "ALL")     return "drawRetry";');
    expect(vk).toContain('if (mode === "LOSERS")  return "replayLosersOnly";');
    expect(vk).toContain('if (mode === "WINNERS") return "replayWinnersOnly";');
  });
  it('개인 SFX(win/lose/draw)는 그대로 유지된다(회귀 방지)', () => {
    expect(html).toContain('playResultSfxOnce(isConfirmedLoser() ? "lose" : "win")');
    expect(html).toContain('playResultSfxOnce(myResult === "win" ? "win" : "lose")');
    expect(html).toContain('playResultSfxOnce("draw", 300)');
  });
});

describe('Build21 — 게임 종료/재대결 음성(정적 계약)', () => {
  it('endGame()과 showStats() 양쪽 모두 게임당 1회 gameOver 음성을 재생한다', () => {
    expect(html).toContain('function playGameOverVoiceOnce()');
    expect((html.match(/playGameOverVoiceOnce\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('resetGameKeepRoom()은 retry 음성을 재생한다', () => {
    // Build23: 함수 맨 앞에 부분 재경기 하드블록(blockPlayAgainIfPartialReplay)이 추가되어 간격이
    // 늘어났다 — 판정/음성 로직 자체는 무변경, quantifier만 갱신.
    expect(html).toMatch(/async function resetGameKeepRoom\(\)[\s\S]{0,600}void playVoiceClip\("retry"\);/);
  });
});

describe('Build21 — QA metric에 audioLocale 필드가 포함된다', () => {
  it('VOICE 이벤트 emit 지점에 audioLocale이 있다(성공/실패/드롭/중복 전부)', () => {
    const matches = html.match(/audioLocale: locale/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(6); // playVoice 3곳 + playVoiceFallback 4곳 중 다수
  });
});

describe('Build21 — 언어 자동감지 fallback(ko-KR→ko, ja-JP→ja, en-*→en, default→ko)', () => {
  it('detectLocale()이 정확한 우선순위로 판정한다', () => {
    expect(html).toMatch(/if \(lang\.startsWith\("ja"\)\) return "ja";\s*\n\s*if \(lang\.startsWith\("ko"\)\) return "ko";\s*\n\s*if \(lang\.startsWith\("en"\)\) return "en";\s*\n\s*return "ko";/);
  });
});
