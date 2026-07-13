import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Build21 — RPS Voice Asset Multilingual Polish. 순수 asset/보안 검증(게임 로직 무관).

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const VOICE_ROOT = resolve(REPO_ROOT, 'ASSETS/rps/voice');

// scripts/generate-rps-voices-elevenlabs.mjs 와 동일한 8종 × 3언어 목록(단일 소스 회귀 방지 위해
// 파일명만 독립적으로 유지 — 생성 스크립트의 텍스트 스크립트까지 import하면 결합도가 과해짐).
const EXPECTED_FILES = {
  ko: ['ko_ready.mp3', 'ko_countdown_rps.mp3', 'ko_retry.mp3', 'ko_draw_retry.mp3', 'ko_replay_losers_only.mp3', 'ko_replay_winners_only.mp3', 'ko_tagger_selected.mp3', 'ko_game_over.mp3'],
  ja: ['ja_ready.mp3', 'ja_countdown_rps.mp3', 'ja_retry.mp3', 'ja_draw_retry.mp3', 'ja_replay_losers_only.mp3', 'ja_replay_winners_only.mp3', 'ja_tagger_selected.mp3', 'ja_game_over.mp3'],
  en: ['en_ready.mp3', 'en_countdown_rps.mp3', 'en_retry.mp3', 'en_draw_retry.mp3', 'en_replay_losers_only.mp3', 'en_replay_winners_only.mp3', 'en_tagger_selected.mp3', 'en_game_over.mp3'],
};

describe('Build21 — .env.local 보안(git 미추적)', () => {
  it('.env.local은 git에 커밋되지 않는다', () => {
    const tracked = execSync('git ls-files -- .env.local', { cwd: REPO_ROOT }).toString().trim();
    expect(tracked).toBe('');
  });

  it('.gitignore가 .env.local을 명시적으로 포함한다', () => {
    const gitignore = execSync('git show HEAD:.gitignore', { cwd: REPO_ROOT }).toString();
    expect(gitignore).toMatch(/^\.env\.local\s*$/m);
  });
});

describe('Build21 — 다국어 음성 asset 24개 존재/무결성', () => {
  for (const [locale, files] of Object.entries(EXPECTED_FILES)) {
    describe(`locale: ${locale}`, () => {
      for (const filename of files) {
        it(`${filename} 파일이 존재하고 size > 0`, () => {
          const p = resolve(VOICE_ROOT, locale, filename);
          expect(existsSync(p)).toBe(true);
          expect(statSync(p).size).toBeGreaterThan(0);
        });
      }
    });
  }

  it('총 24개(8×3언어) 파일이 모두 존재한다', () => {
    let count = 0;
    for (const [locale, files] of Object.entries(EXPECTED_FILES)) {
      for (const filename of files) {
        if (existsSync(resolve(VOICE_ROOT, locale, filename))) count++;
      }
    }
    expect(count).toBe(24);
  });
});
