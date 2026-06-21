// src/game-logic.mjs 의 순수 로직을 index.html 의 마커 블록에 인라인 주입한다.
// 단일 소스(src/game-logic.mjs)를 런타임 인라인 코드와 vitest 가 공유하도록 동기화한다.
//
//   <script> 내부에 아래 마커가 있어야 한다:
//   /*__GAME_LOGIC_START__*/ ... (생성됨) ... /*__GAME_LOGIC_END__*/
//
// 사용: node scripts/sync-game-logic.mjs   (또는 build-web.mjs 에서 syncGameLogic() 호출)

import { readFile, writeFile } from 'node:fs/promises';

const START = '/*__GAME_LOGIC_START__*/';
const END = '/*__GAME_LOGIC_END__*/';

export async function syncGameLogic({
  htmlPath = new URL('../index.html', import.meta.url),
  logicPath = new URL('../src/game-logic.mjs', import.meta.url),
} = {}) {
  const [html, logic] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(logicPath, 'utf8'),
  ]);

  const startIdx = html.indexOf(START);
  // lastIndexOf: 주입된 코드가 우연히 END 토큰을 포함하더라도 항상 실제 닫는 마커까지 교체.
  const endIdx = html.lastIndexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`sync-game-logic: marker block not found in ${htmlPath}. Expected ${START} … ${END}`);
  }

  // `export ` 제거 → 일반 스크립트로. (모듈은 export 선언만 사용한다는 규약)
  const inlined = logic
    .replace(/^export\s+/gm, '')
    .trim();

  const before = html.slice(0, startIdx + START.length);
  const after = html.slice(endIdx);
  const block = `\n      // ⚠️ 자동 생성 — 직접 수정 금지. 원본: src/game-logic.mjs (npm run sync:logic 로 갱신)\n${inlined}\n      `;
  const next = `${before}${block}${after}`;

  if (next !== html) {
    await writeFile(htmlPath, next, 'utf8');
    return true;
  }
  return false;
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  const changed = await syncGameLogic();
  console.log(changed ? 'sync-game-logic: index.html updated.' : 'sync-game-logic: already in sync.');
}
