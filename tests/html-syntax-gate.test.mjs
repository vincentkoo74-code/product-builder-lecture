// ════════════════════════════════════════════════════════════════════════════
// F7-1: `test:syntax` 게이트의 반공허성(non-vacuity) 증명.
//
// 배경(선재 결함): package.json의 종전 인라인 커맨드는
//   /<script>([\s\S]*)<\/script>/
// 라는 **greedy 1회 매치**여서 index.html의 두 인라인 블록을 하나로 삼켰고, 중간의
// `</script>`가 JS 본문에 섞여 HEAD에서도 항상 `SyntaxError: Unexpected token '<'`로
// 죽었다. 즉 "구문 게이트가 있다"는 착각만 있었고 실제 커버리지는 0이었다.
//
// 이 파일은 새 게이트(scripts/check-html-syntax.mjs — package.json이 호출하는 **같은
// 모듈**)가 실제로 오류를 잡는지 mutation으로 증명한다. index.html은 절대 건드리지 않고
// 메모리상 문자열 복사본에만 오류를 주입한다.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  REPO_ROOT,
  HTML_SYNTAX_TARGETS,
  extractScriptBlocks,
  classifyBlock,
  checkHtmlSyntax,
  runHtmlSyntaxGate,
  formatReport,
} from '../scripts/check-html-syntax.mjs';

const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const HTML = readFileSync(INDEX_PATH, 'utf8');
const TARGET = HTML_SYNTAX_TARGETS.find((t) => t.file === 'index.html');

// 인라인 블록만 뽑는다(외부 src 블록 제외).
function inlineBlocks(html) {
  return extractScriptBlocks(html).filter((b) => classifyBlock(b) === 'inline');
}

// 문자열 복사본의 n번째 인라인 블록 **끝부분**에 구문 오류를 주입한다.
// (앞부분이 아니라 끝에 넣는 이유: "greedy가 첫 블록만 보고 있다"는 종전 결함과
//  구분해 두 블록이 각각 파싱되는지를 확실히 가르기 위함.)
function injectSyntaxError(html, nth, snippet = '\nfunction (){{{ ;\n') {
  const blocks = inlineBlocks(html);
  const b = blocks[nth];
  if (!b) throw new Error(`inline block #${nth} not found`);
  const insertAt = b.bodyStart + b.code.length;
  return html.slice(0, insertAt) + snippet + html.slice(insertAt);
}

describe('F7-1: HTML 인라인 script 구문 게이트', () => {
  it('[HS-0] 종전 greedy 정규식은 HEAD의 index.html에서 실제로 깨진다(수정 대상의 존재 증명)', () => {
    const m = HTML.match(/<script>([\s\S]*)<\/script>/);
    expect(m).not.toBeNull();
    // greedy라서 중간의 `</script>`와 두 번째 `<script>`를 본문에 삼킨다.
    expect(m[1]).toContain('</script>');
    expect(m[1]).toContain('<script>');
    expect(() => new Function(m[1])).toThrow(/Unexpected token '<'/);
  });

  it('[HS-1] 현재 index.html의 인라인 블록이 각각 독립 파싱되어 PASS한다', () => {
    const res = checkHtmlSyntax(HTML, {
      file: 'index.html',
      expectedInline: TARGET.expectedInline,
      expectedExternal: TARGET.expectedExternal,
    });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    // 검사 대상 축소 금지: 인라인 블록 전부가 실제로 파싱됐어야 한다.
    expect(res.checked.length).toBe(TARGET.expectedInline);
    expect(res.checked.every((c) => c.ok)).toBe(true);
    // 블록이 한 덩어리로 합쳐지지 않았는지(=greedy 회귀 방지) 크기로 확인한다.
    // JP-02C: <head> 주입 스크립트가 추가돼 블록 순서에 의존하지 않도록 바꿨다.
    // (본문 블록이 첫 번째라는 가정을 없애되, "합쳐지지 않았다"는 검증은 유지·강화한다.)
    const bytes = res.checked.map((c) => c.bytes);
    expect(bytes.length).toBe(TARGET.expectedInline);
    expect(Math.max(...bytes)).toBeGreaterThan(1000);   // 큰 본문 블록이 실재한다
    expect(Math.min(...bytes)).toBeGreaterThan(0);      // 빈 블록으로 계산되지 않았다
    expect(bytes.reduce((a, b) => a + b, 0)).toBeLessThan(HTML.length);
  });

  it('[HS-1b] 어느 인라인 블록의 코드에도 `</script`가 남아있지 않다(greedy 삼킴 회귀 탐지)', () => {
    for (const b of inlineBlocks(HTML)) {
      expect(b.code.toLowerCase()).not.toContain('</script');
      expect(b.code.toLowerCase()).not.toContain('<script>');
    }
  });

  it('[HS-2] mutation: 첫 번째 인라인 script에 구문 오류를 주입하면 FAIL', () => {
    const mutated = injectSyntaxError(HTML, 0);
    expect(mutated).not.toBe(HTML);
    const res = checkHtmlSyntax(mutated, {
      file: 'index.html(mutant#0)',
      expectedInline: TARGET.expectedInline,
      expectedExternal: TARGET.expectedExternal,
    });
    expect(res.ok).toBe(false);
    const syntaxErrors = res.errors.filter((e) => e.type === 'SYNTAX_ERROR');
    expect(syntaxErrors.length).toBe(1);
    // 첫 번째 인라인 블록에서 잡혀야 한다(절대 index 는 고정하지 않는다).
    expect(syntaxErrors[0].blockIndex).toBe(inlineBlocks(HTML)[0].index);
    // 개수는 그대로여야 한다 — 즉 이 FAIL은 순수하게 구문 때문이다.
    expect(res.errors.some((e) => e.type.endsWith('COUNT_MISMATCH'))).toBe(false);
  });

  it('[HS-3] mutation: 두 번째 인라인 script에 구문 오류를 주입하면 FAIL', () => {
    const mutated = injectSyntaxError(HTML, 1);
    expect(mutated).not.toBe(HTML);
    const res = checkHtmlSyntax(mutated, {
      file: 'index.html(mutant#1)',
      expectedInline: TARGET.expectedInline,
      expectedExternal: TARGET.expectedExternal,
    });
    expect(res.ok).toBe(false);
    const syntaxErrors = res.errors.filter((e) => e.type === 'SYNTAX_ERROR');
    expect(syntaxErrors.length).toBe(1);
    expect(syntaxErrors[0].blockIndex).toBe(inlineBlocks(HTML)[1].index);
    expect(res.errors.some((e) => e.type.endsWith('COUNT_MISMATCH'))).toBe(false);
    // ⚠️ 이 케이스가 종전 게이트의 사각지대였다: greedy 1회 매치는 두 번째 블록을
    //    독립적으로 파싱하지 않았다.
  });

  it('[HS-4] mutation: 두 블록에 동시에 오류를 주입하면 두 건 모두 보고된다(첫 오류에서 멈추지 않음)', () => {
    let mutated = injectSyntaxError(HTML, 1);
    mutated = injectSyntaxError(mutated, 0);
    const res = checkHtmlSyntax(mutated, { file: 'index.html(mutant#0+#1)', expectedInline: TARGET.expectedInline });
    expect(res.errors.filter((e) => e.type === 'SYNTAX_ERROR').length).toBe(2);
  });

  it('[HS-5] script 블록 개수가 기대치와 다르면 FAIL(추가/삭제 탐지)', () => {
    // (a) 인라인 블록 추가 → 구문은 멀쩡해도 개수 불일치로 FAIL.
    const added = HTML.replace('</body>', '  <script>\n    var __added__ = 1;\n  </script>\n</body>');
    expect(added).not.toBe(HTML);
    const resAdd = checkHtmlSyntax(added, {
      file: 'index.html(+1 inline)', expectedInline: TARGET.expectedInline, expectedExternal: TARGET.expectedExternal,
    });
    expect(resAdd.ok).toBe(false);
    expect(resAdd.errors.map((e) => e.type)).toContain('INLINE_SCRIPT_COUNT_MISMATCH');
    expect(resAdd.errors.find((e) => e.type === 'INLINE_SCRIPT_COUNT_MISMATCH'))
      .toMatchObject({ expected: TARGET.expectedInline, got: TARGET.expectedInline + 1 });
    // 추가된 블록도 실제로 파싱은 됐다(=개수 검사가 파싱을 대체하지 않는다).
    expect(resAdd.checked.length).toBe(TARGET.expectedInline + 1);

    // (b) 외부 script 삭제 → 외부 개수 불일치로 FAIL.
    const removed = HTML.replace('<script src="ASSETS/vendor/jsQR.js"></script>', '');
    expect(removed).not.toBe(HTML);
    const resDel = checkHtmlSyntax(removed, {
      file: 'index.html(-1 external)', expectedInline: TARGET.expectedInline, expectedExternal: TARGET.expectedExternal,
    });
    expect(resDel.ok).toBe(false);
    expect(resDel.errors.map((e) => e.type)).toContain('EXTERNAL_SCRIPT_COUNT_MISMATCH');
  });

  it('[HS-6] fail-closed: 파싱 방법을 모르는 script type은 조용히 통과하지 않는다', () => {
    const withModule = HTML.replace('</body>', '  <script type="module">import x from "y";</script>\n</body>');
    const res = checkHtmlSyntax(withModule, { file: 'index.html(+module)', expectedInline: TARGET.expectedInline });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.type)).toContain('UNSUPPORTED_SCRIPT_TYPE');
  });

  it('[HS-7] 닫는 </script>가 없으면 FAIL', () => {
    // 마지막 인라인 블록의 닫는 태그를 지운다.
    const last = HTML.lastIndexOf('</script>');
    const broken = HTML.slice(0, last) + HTML.slice(last + '</script>'.length);
    const res = checkHtmlSyntax(broken, { file: 'index.html(unterminated)' });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.type)).toContain('UNTERMINATED_SCRIPT_BLOCK');
  });

  it('[HS-8] 추출기는 greedy가 아니다(합성 최소 케이스)', () => {
    const html = '<html><script>var a=1;</script><p>x</p><script>var b=2;</script></html>';
    const blocks = extractScriptBlocks(html);
    expect(blocks.length).toBe(2);
    expect(blocks[0].code).toBe('var a=1;');
    expect(blocks[1].code).toBe('var b=2;');
    // 대조군: 종전 greedy 정규식은 같은 입력에서 한 덩어리로 삼킨다.
    expect(html.match(/<script>([\s\S]*)<\/script>/)[1]).toContain('</script>');
  });

  it('[HS-9] package.json의 test:syntax가 이 모듈을 호출한다(로직 복제 방지)', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const cmd = pkg.scripts['test:syntax'];
    expect(cmd).toBeTruthy();
    expect(cmd).toContain('scripts/check-html-syntax.mjs');
    // 종전 greedy 인라인 구현이 되살아나지 않았는지 확인한다.
    expect(cmd).not.toContain('[\\s\\S]*');
    expect(cmd).not.toContain('new Function');
  });

  it('[HS-10] 실제 CLI 진입점이 exit 0으로 끝난다', () => {
    const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/check-html-syntax.mjs')], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
    expect(out).toContain('[html-syntax] PASS');
    expect(out).toContain(`인라인 ${TARGET.expectedInline}`);
    // 리포트가 블록별로 출력된다(요약만 찍고 넘어가지 않는다).
    expect(out).toContain('inline #');
  });

  it('[HS-11] runHtmlSyntaxGate/formatReport가 저장소 실물에서 ok=true', () => {
    const report = runHtmlSyntaxGate();
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toContain('PASS');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F7-1b(critic MEDIUM-1): 게이트 대상 확장 — index.html만 검사하면 dist로 함께 배포되는
// 다른 HTML의 인라인 script는 무검사로 나간다. 특히 oauth-bridge.html은 OAuth 리다이렉트
// 착지 페이지라 구문 오류가 나면 **로그인 경로 전체가 죽는다**.
// 아래 테스트는 (a) 대상 목록이 dist 배포 목록과 어긋나지 않는지, (b) 새로 추가한 대상들에
// 실제로 오류 탐지력이 있는지(mutation)를 증명한다.
// ════════════════════════════════════════════════════════════════════════════
const OAUTH_PATH = path.join(REPO_ROOT, 'oauth-bridge.html');
const OAUTH_HTML = readFileSync(OAUTH_PATH, 'utf8');
const ZERO_SCRIPT_FILES = ['privacy.html', 'terms.html', 'account-delete.html'];

const targetOf = (file) => HTML_SYNTAX_TARGETS.find((t) => t.file === file);
const checkTarget = (html, file, suffix = '') => {
  const t = targetOf(file);
  return checkHtmlSyntax(html, {
    file: `${file}${suffix}`, expectedInline: t.expectedInline, expectedExternal: t.expectedExternal,
  });
};

describe('F7-1b: 구문 게이트 대상 = dist로 배포되는 HTML 전부', () => {
  it('[HS-12] HTML_SYNTAX_TARGETS가 build-web.mjs의 dist 복사 목록(HTML)을 전부 덮는다', () => {
    // 드리프트 tripwire: 새 HTML을 dist에 넣으면서 게이트 대상에 안 넣으면 여기서 RED.
    const buildSrc = readFileSync(path.join(REPO_ROOT, 'scripts/build-web.mjs'), 'utf8');
    const m = buildSrc.match(/for\s*\(\s*const\s+file\s+of\s*\[([^\]]*)\]\s*\)/);
    expect(m, 'build-web.mjs의 dist 복사 파일 목록을 찾지 못했다').not.toBeNull();
    const shipped = [...m[1].matchAll(/["']([^"']+\.html)["']/g)].map((x) => x[1]);
    expect(shipped.length).toBeGreaterThan(0);
    expect(HTML_SYNTAX_TARGETS.map((t) => t.file).sort()).toEqual([...shipped].sort());
  });

  it('[HS-13] oauth-bridge.html의 인라인 script가 실제로 파싱되어 PASS한다', () => {
    const res = checkTarget(OAUTH_HTML, 'oauth-bridge.html');
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    // 기대치는 실측이다: 인라인 1 / 외부 0. 축소 금지 — 인라인 블록이 실제로 검사됐어야 한다.
    expect(targetOf('oauth-bridge.html')).toMatchObject({ expectedInline: 1, expectedExternal: 0 });
    expect(res.inlineCount).toBe(1);
    expect(res.externalCount).toBe(0);
    expect(res.checked.length).toBe(1);
    expect(res.checked[0].ok).toBe(true);
    expect(res.checked[0].bytes).toBeGreaterThan(0);
  });

  it('[HS-14] mutation: oauth-bridge.html 인라인 script에 구문 오류를 주입하면 FAIL(로그인 경로 보호)', () => {
    const mutated = injectSyntaxError(OAUTH_HTML, 0);
    expect(mutated).not.toBe(OAUTH_HTML);
    const res = checkTarget(mutated, 'oauth-bridge.html', '(mutant#0)');
    expect(res.ok).toBe(false);
    const syntaxErrors = res.errors.filter((e) => e.type === 'SYNTAX_ERROR');
    expect(syntaxErrors.length).toBe(1);
    expect(syntaxErrors[0].blockIndex).toBe(inlineBlocks(OAUTH_HTML)[0].index);
    expect(syntaxErrors[0].file).toBe('oauth-bridge.html(mutant#0)');
    // 순수하게 구문 때문에 FAIL이다(개수는 그대로).
    expect(res.errors.some((e) => e.type.endsWith('COUNT_MISMATCH'))).toBe(false);
  });

  it('[HS-15] mutation: 게이트 대상에서 oauth-bridge.html을 빼면 그 구문 오류가 통과해버린다(반공허성)', () => {
    const mutated = injectSyntaxError(OAUTH_HTML, 0);
    // 종전 목록(index.html만)에는 oauth-bridge.html이 없었다 → 같은 오류가 잡히지 않는다.
    const legacyTargets = HTML_SYNTAX_TARGETS.filter((t) => t.file === 'index.html');
    expect(legacyTargets.some((t) => t.file === 'oauth-bridge.html')).toBe(false);
    // 확장된 목록에는 있고, 그 대상 검사가 실제로 오류를 잡는다.
    expect(HTML_SYNTAX_TARGETS.some((t) => t.file === 'oauth-bridge.html')).toBe(true);
    expect(checkTarget(mutated, 'oauth-bridge.html').ok).toBe(false);
  });

  it('[HS-16] script 0개 페이지들은 실측대로 0이고, 인라인 script가 끼어들면 FAIL한다', () => {
    for (const file of ZERO_SCRIPT_FILES) {
      const html = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      // (a) 현재 상태: script 태그 0개.
      expect(targetOf(file)).toMatchObject({ expectedInline: 0, expectedExternal: 0 });
      const base = checkTarget(html, file);
      expect(base.ok).toBe(true);
      expect(base.totalBlocks).toBe(0);

      // (b) 누군가 인라인 script를 끼워 넣으면 개수 tripwire가 잡는다.
      const added = html.replace('</body>', '  <script>\n    var __added__ = 1;\n  </script>\n</body>');
      expect(added).not.toBe(html);
      const resAdd = checkTarget(added, file, '(+1 inline)');
      expect(resAdd.ok).toBe(false);
      expect(resAdd.errors.map((e) => e.type)).toContain('INLINE_SCRIPT_COUNT_MISMATCH');

      // (c) 그리고 그 블록의 구문 오류도 실제로 잡힌다(개수 검사가 파싱을 대체하지 않는다).
      const broken = html.replace('</body>', '  <script>\n    function (){{{ ;\n  </script>\n</body>');
      const resBroken = checkTarget(broken, file, '(+broken inline)');
      expect(resBroken.ok).toBe(false);
      expect(resBroken.errors.map((e) => e.type)).toContain('SYNTAX_ERROR');
    }
  });

  it('[HS-17] CLI/러너가 5개 대상 전부를 실제로 검사한다(대상 축소 방지)', () => {
    const report = runHtmlSyntaxGate();
    expect(report.results.map((r) => r.file)).toEqual(HTML_SYNTAX_TARGETS.map((t) => t.file));
    expect(report.ok).toBe(true);
    const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/check-html-syntax.mjs')], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
    for (const t of HTML_SYNTAX_TARGETS) expect(out).toContain(`[html-syntax] ${t.file}:`);
    expect(out).toContain('oauth-bridge.html: script 태그 1개 (인라인 1 / 외부 0)');
    expect(out).toContain('[html-syntax] PASS');
  });
});
