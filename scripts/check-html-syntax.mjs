#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// F7-1: HTML 인라인 <script> 구문 게이트.
//
// 종전 결함(HEAD에서도 상시 실패): package.json의
//   /<script>([\s\S]*)<\/script>/
// 는 (a) greedy라 첫 <script>부터 **마지막** </script>까지 한 덩어리로 삼키고
// (b) 매치를 1건만 취한다. index.html에는 인라인 블록이 2개 있어서 중간의
// `</script>` + `<script>`가 JS 본문에 섞여 항상 `SyntaxError: Unexpected token '<'`가
// 났다. 결과적으로 이 앱에는 **동작하는 구문 게이트가 없었다.**
//
// 이 모듈의 계약:
//   · <script> 블록을 스캐너로 하나씩 분리해 **각각 독립 파싱**한다(greedy 캡처 없음).
//   · 인라인 classic script는 node:vm의 Script(=파싱만, 실행 없음)로 구문 검사한다.
//   · 블록 개수가 기대치와 다르면 FAIL한다(블록 추가/삭제를 놓치지 않는다).
//   · 검사 대상 축소/스킵 경로 없음. 모르는 형태(type="module" 등)는 fail-closed.
//
// package.json의 `test:syntax`와 tests/html-syntax-gate.test.mjs가 **이 같은 모듈**을
// 호출한다(로직 복제 금지 — 두 곳에 두면 드리프트한다).
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

// 검사 대상 + 기대 블록 수(구조 tripwire). 블록이 추가/삭제되면 여기를 의도적으로
// 갱신해야 하고, 그 전까지는 게이트가 RED다.
//
// 대상 선정 기준: **dist로 배포되는 HTML 전부**(scripts/build-web.mjs의 복사 목록과 일치).
// 배포되는데 검사받지 않는 HTML이 있으면 그 파일의 구문 오류는 런타임에서만 드러난다.
//   · index.html         — 앱 본체. 인라인 2 / 외부 7.
//   · oauth-bridge.html  — OAuth 리다이렉트 착지 페이지. 인라인 1(구문 오류 시 **로그인이 깨진다**).
//   · privacy/terms/account-delete.html — 현재 script 0개. 0으로 못박아 두는 것이 tripwire다:
//     누군가 나중에 인라인 script를 끼워 넣으면 (a) COUNT_MISMATCH로 즉시 RED가 되고
//     (b) 이 목록을 갱신하는 순간부터 그 블록이 매 실행 파싱된다. 검사 비용은 사실상 0이다.
export const HTML_SYNTAX_TARGETS = Object.freeze([
  Object.freeze({ file: 'index.html', expectedInline: 2, expectedExternal: 7 }),
  Object.freeze({ file: 'oauth-bridge.html', expectedInline: 1, expectedExternal: 0 }),
  Object.freeze({ file: 'privacy.html', expectedInline: 0, expectedExternal: 0 }),
  Object.freeze({ file: 'terms.html', expectedInline: 0, expectedExternal: 0 }),
  Object.freeze({ file: 'account-delete.html', expectedInline: 0, expectedExternal: 0 }),
]);

const JS_MIME_TYPES = new Set([
  '', 'text/javascript', 'application/javascript', 'application/ecmascript',
  'text/ecmascript', 'module',
]);

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function parseAttributes(rawAttrs) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(rawAttrs)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
  }
  return attrs;
}

/**
 * <script> 블록을 **개별적으로** 추출한다.
 * greedy 정규식을 쓰지 않고 여는 태그 → 대응하는 `</script` 를 순차 스캔한다.
 * (HTML 사양상 `</script` 는 JS 문자열 안에 있어도 script 요소를 끝내므로 이 스캔이 곧 사양 동작이다.)
 */
export function extractScriptBlocks(html) {
  const blocks = [];
  const openRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const openStart = m.index;
    const bodyStart = m.index + m[0].length;
    const closeIdx = html.toLowerCase().indexOf('</script', bodyStart);
    if (closeIdx === -1) {
      blocks.push({
        index: blocks.length,
        line: lineOf(html, openStart),
        attrs: parseAttributes(m[1] || ''),
        code: html.slice(bodyStart),
        bodyStart,
        unterminated: true,
      });
      break;
    }
    const closeEnd = html.indexOf('>', closeIdx);
    blocks.push({
      index: blocks.length,
      line: lineOf(html, openStart),
      attrs: parseAttributes(m[1] || ''),
      code: html.slice(bodyStart, closeIdx),
      bodyStart,
      unterminated: false,
    });
    openRe.lastIndex = closeEnd === -1 ? closeIdx + 8 : closeEnd + 1;
  }
  return blocks;
}

export function classifyBlock(block) {
  const type = String(block.attrs.type || '').trim().toLowerCase();
  if (block.attrs.src !== undefined) return 'external';
  if (type === 'module') return 'module';
  if (!JS_MIME_TYPES.has(type)) return 'non-js';
  return 'inline';
}

/**
 * 순수 함수: HTML 문자열을 받아 블록별 구문 검사 결과를 돌려준다.
 * ok=false면 호출부는 반드시 non-zero로 끝내야 한다.
 */
export function checkHtmlSyntax(html, { file = '<memory>', expectedInline = null, expectedExternal = null } = {}) {
  const blocks = extractScriptBlocks(html);
  const errors = [];
  const checked = [];
  let inlineCount = 0;
  let externalCount = 0;

  for (const block of blocks) {
    const kind = classifyBlock(block);
    if (block.unterminated) {
      errors.push({
        type: 'UNTERMINATED_SCRIPT_BLOCK', file, blockIndex: block.index, line: block.line,
        message: `<script> 블록 #${block.index} (line ${block.line})에 닫는 </script>가 없다.`,
      });
      continue;
    }
    if (kind === 'external') {
      externalCount++;
      if (block.code.trim() !== '') {
        errors.push({
          type: 'EXTERNAL_SCRIPT_WITH_BODY', file, blockIndex: block.index, line: block.line,
          message: `src가 있는 <script> #${block.index} (line ${block.line})에 본문이 있다 — 브라우저는 본문을 무시하므로 죽은 코드다.`,
        });
      }
      continue;
    }
    if (kind !== 'inline') {
      // fail-closed: 파싱 방법을 모르는 블록을 조용히 건너뛰지 않는다.
      errors.push({
        type: 'UNSUPPORTED_SCRIPT_TYPE', file, blockIndex: block.index, line: block.line,
        kind, scriptType: block.attrs.type || null,
        message: `<script type="${block.attrs.type || ''}"> #${block.index} (line ${block.line})는 이 게이트가 파싱 방법을 모른다 — 검사 없이 통과시키지 않는다.`,
      });
      continue;
    }
    inlineCount++;
    try {
      // 파싱만 수행한다(실행/평가 없음). new Function과 달리 최상위 script goal 그대로 검사한다.
      // eslint-disable-next-line no-new
      new Script(block.code, { filename: `${file}#script[${block.index}]@line${block.line}` });
      checked.push({ blockIndex: block.index, line: block.line, bytes: block.code.length, ok: true });
    } catch (err) {
      checked.push({ blockIndex: block.index, line: block.line, bytes: block.code.length, ok: false });
      errors.push({
        type: 'SYNTAX_ERROR', file, blockIndex: block.index, line: block.line,
        message: `<script> 블록 #${block.index} (${file} line ${block.line} 시작) 구문 오류: ${err && err.message}`,
        stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : null,
      });
    }
  }

  if (expectedInline !== null && inlineCount !== expectedInline) {
    errors.push({
      type: 'INLINE_SCRIPT_COUNT_MISMATCH', file, expected: expectedInline, got: inlineCount,
      message: `${file}의 인라인 <script> 블록 수가 ${expectedInline} → ${inlineCount}로 바뀌었다. 블록이 추가/삭제되면 게이트 커버리지가 조용히 달라지므로 HTML_SYNTAX_TARGETS를 의도적으로 갱신해야 한다.`,
    });
  }
  if (expectedExternal !== null && externalCount !== expectedExternal) {
    errors.push({
      type: 'EXTERNAL_SCRIPT_COUNT_MISMATCH', file, expected: expectedExternal, got: externalCount,
      message: `${file}의 외부 <script src> 수가 ${expectedExternal} → ${externalCount}로 바뀌었다. HTML_SYNTAX_TARGETS를 의도적으로 갱신하라.`,
    });
  }

  return {
    ok: errors.length === 0,
    file,
    totalBlocks: blocks.length,
    inlineCount,
    externalCount,
    checked,
    errors,
  };
}

export function checkHtmlFile(target, { root = REPO_ROOT } = {}) {
  const abs = path.resolve(root, target.file);
  const html = readFileSync(abs, 'utf8');
  return checkHtmlSyntax(html, {
    file: target.file,
    expectedInline: target.expectedInline ?? null,
    expectedExternal: target.expectedExternal ?? null,
  });
}

export function runHtmlSyntaxGate({ root = REPO_ROOT, targets = HTML_SYNTAX_TARGETS } = {}) {
  const results = targets.map((t) => checkHtmlFile(t, { root }));
  return { ok: results.every((r) => r.ok), results };
}

export function formatReport({ ok, results }) {
  const lines = [];
  for (const r of results) {
    lines.push(`[html-syntax] ${r.file}: script 태그 ${r.totalBlocks}개 (인라인 ${r.inlineCount} / 외부 ${r.externalCount})`);
    for (const c of r.checked) {
      lines.push(`  · inline #${c.blockIndex} (line ${c.line}, ${c.bytes} bytes) → ${c.ok ? 'OK' : 'SYNTAX ERROR'}`);
    }
    for (const e of r.errors) lines.push(`  ✗ [${e.type}] ${e.message}`);
  }
  lines.push(ok ? '[html-syntax] PASS — 모든 인라인 script 블록이 개별 파싱을 통과했다.' : '[html-syntax] FAIL');
  return lines.join('\n');
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isDirectRun) {
  const report = runHtmlSyntaxGate();
  // eslint-disable-next-line no-console
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}
