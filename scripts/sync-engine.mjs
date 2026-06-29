// scripts/sync-engine.mjs
// WRPS-049 STEP2 — engine/*.mjs 를 index.html 인라인 스크립트에 넣을 수 있는 단일 IIFE 번들로 변환.
//
// 배경: 앱은 인라인 <script>(비모듈)이고 src/game-logic.mjs 는 sync-game-logic.mjs 가 인라인 주입한다.
//   엔진(events/EventBus/EventLog/GameEngine/adapters/index/client-binding)은 서로 import 하고
//   game-logic 의 judgePure/resolveElimination/maxLoserCountFor 를 import 한다.
//   → import/export 를 제거하고 의존성 순서로 이어붙여 하나의 IIFE 로 만들면, 동일 인라인 스코프에
//     이미 들어있는 game-logic 심볼을 그대로 참조할 수 있다(번들은 game-logic 블록 뒤에 위치해야 함).
//
// 이 단계(2.1)는 번들 "생성/검증"만 한다. index.html 주입(2.2)·동작 연결(이후)은 별도 단계.

import { readFile, writeFile } from 'node:fs/promises';

const ENGINE_START = '/*__ENGINE_V2_START__*/';
const ENGINE_END = '/*__ENGINE_V2_END__*/';

// 의존성 순서(앞이 먼저 정의되어야 함). game-logic 심볼은 외부(인라인) 스코프에서 제공된다.
const ENGINE_FILES = [
  'engine/events.mjs',
  'engine/EventBus.mjs',
  'engine/EventLog.mjs',
  'engine/GameEngine.mjs',
  'engine/adapters/supabase.mjs',
  'engine/index.mjs',
  'engine/client-binding.mjs',
];

// IIFE 가 반환(노출)할 공개 심볼.
const PUBLIC_API = [
  'EVENT_TYPES', 'SOUND_EVENTS', 'makeEvent',
  'createEventBus', 'createEventLog', 'initialState', 'applyEvent',
  'createEngine', 'engineStateToView', 'audioEventsToSounds', 'createClient',
];

function stripModuleSyntax(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*import\s.+from\s+['"].+['"];?\s*$/.test(line)) // import 라인 제거
    .filter((line) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line))         // 재export 라인 제거
    .map((line) => line.replace(/^(\s*)export\s+/, '$1'))                    // export 키워드 제거
    .join('\n');
}

/**
 * 엔진 인라인 번들 문자열 생성. 결과는 `const RPSEngineV2 = (function(){ ... })();` 형태.
 * game-logic 심볼(judgePure/resolveElimination/maxLoserCountFor)이 동일 스코프에 선행 정의돼 있어야 한다.
 */
export async function buildEngineBundle({ baseUrl = new URL('../', import.meta.url) } = {}) {
  const parts = [];
  for (const rel of ENGINE_FILES) {
    const src = await readFile(new URL(rel, baseUrl), 'utf8');
    parts.push(`// ── ${rel} ──\n${stripModuleSyntax(src).trim()}`);
  }
  const body = parts.join('\n\n');
  const ret = `  return { ${PUBLIC_API.join(', ')} };`;
  return `const RPSEngineV2 = (function () {\n${body}\n\n${ret}\n})();`;
}

/**
 * 엔진 번들을 대상 HTML 의 ENGINE_V2 마커 블록에 주입한다(기본: dist/index.html).
 * 라이브 root index.html 은 건드리지 않는다 — 빌드 산출물(dist)에만 주입(STEP2.2 안전 정책).
 */
export async function syncEngine({
  htmlPath = new URL('../dist/index.html', import.meta.url),
} = {}) {
  const html = await readFile(htmlPath, 'utf8');
  const startIdx = html.indexOf(ENGINE_START);
  const endIdx = html.lastIndexOf(ENGINE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`sync-engine: marker block not found in ${htmlPath}. Expected ${ENGINE_START} … ${ENGINE_END}`);
  }
  const bundle = await buildEngineBundle();
  const before = html.slice(0, startIdx + ENGINE_START.length);
  const after = html.slice(endIdx);
  const block = `\n      // ⚠️ 자동 생성 — 직접 수정 금지. 원본: engine/*.mjs (scripts/sync-engine.mjs)\n${bundle}\n      `;
  const next = `${before}${block}${after}`;
  if (next !== html) {
    await writeFile(htmlPath, next, 'utf8');
    return true;
  }
  return false;
}

// 직접 실행 시: 번들을 stdout 으로 출력(검증용).
if (import.meta.url === `file://${process.argv[1]}`) {
  const bundle = await buildEngineBundle();
  process.stdout.write(bundle + '\n');
}
