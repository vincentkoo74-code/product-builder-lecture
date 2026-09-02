// scripts/generate-rps-voices-elevenlabs.mjs — RPS 기본 진행 음성 다국어(ko/ja/en) ElevenLabs 생성기.
// Voice Asset Polish 전용(Build21) — 게임/동기화/판정 로직 무변경. 순수 asset 생성 도구.
//
// 입력: .env.local 의 ELEVENLABS_API_KEY(필수), ELEVENLABS_VOICE_ID(공통 기본값),
//       선택적 언어별 override: ELEVENLABS_VOICE_ID_KO / ELEVENLABS_VOICE_ID_JA / ELEVENLABS_VOICE_ID_EN
//       (언어별 값이 없으면 공통 ELEVENLABS_VOICE_ID를 사용 — eleven_multilingual_v2가 다국어 지원)
//       절대 로그에 키/값을 출력하지 않는다.
// 출력: ASSETS/rps/voice/{ko,ja,en}/ 에 언어당 8개, 총 24개 mp3. 생성 전 기존 폴더 전체를
//       타임스탬프 backup 폴더로 보존.
//
// 사용: node scripts/generate-rps-voices-elevenlabs.mjs
//   (선택) --dry-run   ← API 호출 없이 계획만 출력
//   (선택) --locale=ko ← 특정 언어만 생성(생략 시 ko/ja/en 전체)

import { readFileSync, existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const VOICE_ROOT = resolve(REPO_ROOT, 'ASSETS/rps/voice'); // 실제 저장소 경로(“public/” 접두사 없음)
// 백업은 ASSETS/rps/ 바깥에 둔다 — scripts/build-web.mjs가 ASSETS/rps 전체를 재귀 복사해 dist/에
// 번들링하므로, ASSETS/rps/voice/ 안에 백업을 두면 옛 mp3가 실제 앱 배포물에 그대로 포함되는 문제가 있음.
const BACKUP_ROOT = resolve(REPO_ROOT, 'ASSETS/voice-backups');

// ── .env.local 최소 파서(신규 의존성 추가 금지 — dotenv 미사용) ─────────────
function loadEnvLocal(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal(resolve(REPO_ROOT, '.env.local'));

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID_BY_LOCALE = {
  ko: process.env.ELEVENLABS_VOICE_ID_KO || process.env.ELEVENLABS_VOICE_ID,
  ja: process.env.ELEVENLABS_VOICE_ID_JA || process.env.ELEVENLABS_VOICE_ID,
  en: process.env.ELEVENLABS_VOICE_ID_EN || process.env.ELEVENLABS_VOICE_ID,
};

// ── RPS 기본 진행 음성 8종 × 3개 언어 (Build21 Voice Polish 지시) ───────────
const SCRIPTS = {
  ko: [
    { filename: 'ko_ready.mp3', text: '준비하세요!' },
    { filename: 'ko_countdown_rps.mp3', text: '안 내면 술래! 가위바위보!' },
    { filename: 'ko_maru_rps.mp3', text: '마루 가위바위보' },
    { filename: 'ko_retry.mp3', text: '다시 한 번!' },
    { filename: 'ko_draw_retry.mp3', text: '비겼습니다! 다시 합니다!' },
    { filename: 'ko_replay_losers_only.mp3', text: '패자끼리 다시 합니다!' },
    { filename: 'ko_replay_winners_only.mp3', text: '승자끼리 다시 합니다!' },
    { filename: 'ko_tagger_selected.mp3', text: '술래가 정해졌습니다!' },
    { filename: 'ko_game_over.mp3', text: '게임 끝!' },
    // Build47 cumulative-score/voice recovery: short GAME prefix only. The unchanged core RPS
    // phrase is the existing ko_countdown_rps.mp3 immediately following these clips.
    { filename: 'ko_game_start_1.mp3', text: '시작합니다' },
    { filename: 'ko_game_start_2.mp3', text: '둘째판' },
    { filename: 'ko_game_start_3.mp3', text: '셋째판' },
    { filename: 'ko_game_start_4.mp3', text: '넷째판' },
    { filename: 'ko_game_start_5.mp3', text: '다섯째판' },
    { filename: 'ko_game_start_6.mp3', text: '여섯째판' },
    { filename: 'ko_game_start_7.mp3', text: '일곱째판' },
    { filename: 'ko_game_start_8.mp3', text: '여덟째판' },
    { filename: 'ko_game_start_9.mp3', text: '아홉째판' },
    { filename: 'ko_game_start_10.mp3', text: '열째판' },
    { filename: 'ko_game_start_next.mp3', text: '다음판' },
  ],
  ja: [
    { filename: 'ja_ready.mp3', text: '準備してね！' },
    { filename: 'ja_countdown_rps.mp3', text: '最初はグー！じゃんけんぽん！' },
    { filename: 'ja_retry.mp3', text: 'もう一回！' },
    { filename: 'ja_draw_retry.mp3', text: 'あいこです！もう一回！' },
    { filename: 'ja_replay_losers_only.mp3', text: '負けた人だけでもう一回！' },
    { filename: 'ja_replay_winners_only.mp3', text: '勝った人だけでもう一回！' },
    { filename: 'ja_tagger_selected.mp3', text: '鬼が決まりました！' },
    { filename: 'ja_game_over.mp3', text: 'ゲーム終了！' },
    // Build47 필드QA 정정(항목 2): GAME 순번 안내 11종 — 현재 자산은 macOS say 임시본, 키 확보 시 이 스크립트로 재생성
    { filename: 'ja_game_start_1.mp3', text: '第一ゲーム、始まります。準備してね！' },
    { filename: 'ja_game_start_2.mp3', text: '第二ゲーム、行きます！' },
    { filename: 'ja_game_start_3.mp3', text: '第三ゲーム、行きます！' },
    { filename: 'ja_game_start_4.mp3', text: '第四ゲーム、行きます！' },
    { filename: 'ja_game_start_5.mp3', text: '第五ゲーム、行きます！' },
    { filename: 'ja_game_start_6.mp3', text: '第六ゲーム、行きます！' },
    { filename: 'ja_game_start_7.mp3', text: '第七ゲーム、行きます！' },
    { filename: 'ja_game_start_8.mp3', text: '第八ゲーム、行きます！' },
    { filename: 'ja_game_start_9.mp3', text: '第九ゲーム、行きます！' },
    { filename: 'ja_game_start_10.mp3', text: '第十ゲーム、行きます！' },
    { filename: 'ja_game_start_next.mp3', text: '次のゲーム、行きます！' },
  ],
  en: [
    { filename: 'en_ready.mp3', text: 'Get ready!' },
    { filename: 'en_countdown_rps.mp3', text: 'Rock, paper, scissors, shoot!' },
    { filename: 'en_retry.mp3', text: 'One more time!' },
    { filename: 'en_draw_retry.mp3', text: "It's a draw! Try again!" },
    { filename: 'en_replay_losers_only.mp3', text: 'Losers only, play again!' },
    { filename: 'en_replay_winners_only.mp3', text: 'Winners only, play again!' },
    { filename: 'en_tagger_selected.mp3', text: 'The tagger is chosen!' },
    { filename: 'en_game_over.mp3', text: 'Game over!' },
    // Build47 필드QA 정정(항목 2): GAME 순번 안내 11종 — 현재 자산은 macOS say 임시본, 키 확보 시 이 스크립트로 재생성
    { filename: 'en_game_start_1.mp3', text: 'Game one! Get ready!' },
    { filename: 'en_game_start_2.mp3', text: 'Game two, here we go!' },
    { filename: 'en_game_start_3.mp3', text: 'Game three, here we go!' },
    { filename: 'en_game_start_4.mp3', text: 'Game four, here we go!' },
    { filename: 'en_game_start_5.mp3', text: 'Game five, here we go!' },
    { filename: 'en_game_start_6.mp3', text: 'Game six, here we go!' },
    { filename: 'en_game_start_7.mp3', text: 'Game seven, here we go!' },
    { filename: 'en_game_start_8.mp3', text: 'Game eight, here we go!' },
    { filename: 'en_game_start_9.mp3', text: 'Game nine, here we go!' },
    { filename: 'en_game_start_10.mp3', text: 'Game ten, here we go!' },
    { filename: 'en_game_start_next.mp3', text: 'Next game, here we go!' },
  ],
};

const OUTPUT_FORMAT = 'mp3_44100_128';
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true };

const DRY_RUN = process.argv.includes('--dry-run');
const LOCALE_ARG = (process.argv.find((a) => a.startsWith('--locale=')) || '').split('=')[1];
const LOCALES = LOCALE_ARG ? [LOCALE_ARG] : Object.keys(SCRIPTS);

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function callElevenLabs(text, voiceId) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log('=== RPS Voice Polish (ElevenLabs, multilingual) ===');
  console.log(`locales: ${LOCALES.join(', ')}`);
  console.log(`voice root: ${VOICE_ROOT}`);
  const totalFiles = LOCALES.reduce((n, loc) => n + (SCRIPTS[loc]?.length || 0), 0);
  console.log(`files to generate: ${totalFiles}`);
  if (DRY_RUN) console.log('(dry-run — no API calls, no file writes)');

  if (!DRY_RUN) {
    if (!API_KEY) { console.error('ERROR: ELEVENLABS_API_KEY not set (.env.local)'); process.exit(1); }
    for (const loc of LOCALES) {
      if (!VOICE_ID_BY_LOCALE[loc]) { console.error(`ERROR: no voice id resolved for locale '${loc}' (.env.local: ELEVENLABS_VOICE_ID_${loc.toUpperCase()} or ELEVENLABS_VOICE_ID)`); process.exit(1); }
    }
  }

  // 생성 전 기존 폴더 전체를 백업(언어별, 신규 실행마다 별도 타임스탬프 — 덮어쓰기 없음).
  // ASSETS/rps/voice/ 바깥(ASSETS/voice-backups/)에 저장 — dist 번들링 대상에서 제외됨(build-web.mjs 참조).
  if (!DRY_RUN) {
    for (const loc of LOCALES) {
      const dir = resolve(VOICE_ROOT, loc);
      if (existsSync(dir)) {
        const backupDir = resolve(BACKUP_ROOT, `${loc}_${timestamp()}`);
        mkdirSync(backupDir, { recursive: true });
        cpSync(dir, backupDir, { recursive: true });
        console.log(`backup(${loc}): ${backupDir}`);
      } else {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  const results = [];
  for (const loc of LOCALES) {
    const voiceId = VOICE_ID_BY_LOCALE[loc];
    for (const item of SCRIPTS[loc]) {
      const outPath = resolve(VOICE_ROOT, loc, item.filename);
      if (DRY_RUN) {
        console.log(`[dry-run] would generate: ${loc}/${item.filename} <- "${item.text}"`);
        continue;
      }
      try {
        const audio = await callElevenLabs(item.text, voiceId);
        if (!audio || audio.length === 0) throw new Error('empty response body (0 bytes)');
        writeFileSync(outPath, audio);
        results.push({ locale: loc, filename: item.filename, bytes: audio.length, ok: true });
        console.log(`OK   ${loc}/${item.filename}  (${audio.length} bytes)`);
      } catch (e) {
        results.push({ locale: loc, filename: item.filename, ok: false, error: e.message });
        console.error(`FAIL ${loc}/${item.filename}  ${e.message}`);
      }
    }
  }

  if (!DRY_RUN) {
    const failed = results.filter((r) => !r.ok);
    console.log('\n=== Summary ===');
    for (const r of results) {
      console.log(r.ok ? `  ✅ ${r.locale}/${r.filename} (${r.bytes} bytes)` : `  ❌ ${r.locale}/${r.filename} — ${r.error}`);
    }
    if (failed.length) {
      console.error(`\n${failed.length}/${results.length} file(s) failed. Aborting before app mapping — fix and re-run.`);
      process.exit(1);
    }
    console.log(`\nAll ${results.length} files generated successfully.`);
  }
}

await main();
