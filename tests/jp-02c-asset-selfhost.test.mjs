// SPRINT JP-02C — JP 웹 자산 자체 호스팅 / 외부 의존 축소
//
// 계약: JP 로케일은 외부 폰트 요청 없이 렌더링된다. KR/EN 표현은 바뀌지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { extractScriptBlocks, classifyBlock } from '../scripts/check-html-syntax.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const fontsDir = new URL('../ASSETS/fonts/', import.meta.url);

// 주입 스크립트는 **실제 script 본문**에서 가져온다.
// (HTML 주석에서 슬라이스하면 내 주석 문구가 단언을 대신 만족시킬 수 있다 —
//  이 저장소에서 이미 두 번 겪은 자기참조 함정이다.)
const INJECT = (() => {
  const inline = extractScriptBlocks(html).filter((b) => classifyBlock(b) === 'inline');
  const hit = inline.filter((b) => b.code.includes('fonts.googleapis.com'));
  if (hit.length !== 1) throw new Error(`폰트 주입 블록을 특정할 수 없다 (${hit.length}개)`);
  return hit[0].code;
})();

describe('[JP-02C] §6 정적 <head> 에 외부 폰트 링크가 없다', () => {
  it('정적 마크업에 Google Fonts <link> 가 없다', () => {
    // 정적 link 가 남아 있으면 로케일과 무관하게 항상 요청이 나간다.
    // 주입 스크립트 **본문**에는 link 문자열이 들어있다(document.write 로 KR 의
    // 파서 차단 의미를 유지한다) — 그건 정적 마크업이 아니므로 script 를 걷어내고 본다.
    let markup = head;
    for (const b of extractScriptBlocks(html).filter((x) => classifyBlock(x) === 'inline')) {
      markup = markup.split(b.code).join('');
    }
    expect(markup).not.toMatch(/<link[^>]+fonts\.(googleapis|gstatic)\.com/);
    // 비공허성: 걷어낸 뒤에도 head 의 다른 정적 태그는 남아 있어야 한다.
    expect(markup).toMatch(/<meta[^>]+viewport/);
  });
  it('앱과 동일한 로케일 해석 순서를 쓴다 (?lang= → localStorage → navigator)', () => {
    // ?lang= 를 빠뜨리면 ?lang=ja 로 처음 들어온 JP 사용자가 Google 폰트를 받는다.
    // JP-02C E2E 가 실제로 이 결함을 잡았다.
    expect(INJECT).toContain('URLSearchParams');
    expect(INJECT).toContain('"lang"');
    expect(INJECT.indexOf('URLSearchParams')).toBeLessThan(INJECT.indexOf('rpsLocale'));
    expect(INJECT.indexOf('rpsLocale')).toBeLessThan(INJECT.indexOf('navigator.language'));
    // 앱의 detectLocale 과 같은 목록/기본값
    expect(INJECT).toMatch(/\["ko", "en", "ja"\]/);
  });

  it('주입 스크립트가 ja 로케일에서 조기 반환한다', () => {
    expect(INJECT).toContain('if (loc === "ja") return;');
    // 반환이 link 생성보다 앞에 있어야 한다.
    expect(INJECT.indexOf('if (loc === "ja") return;'))
      .toBeLessThan(INJECT.indexOf('fonts.googleapis.com'));
  });
  it('KR 은 파서 차단 의미를 유지한다 (document.write)', () => {
    // appendChild 로 넣으면 스타일시트가 파싱을 막지 않아 KR 로드 타이밍이 바뀐다
    // (실측: KR DOMContentLoaded 약 6000ms → 139ms + 폰트 스왑). JP 스프린트에서
    // KR 동작을 바꾸지 않기로 했으므로 종전 정적 <link> 와 같은 의미를 유지한다.
    expect(INJECT).toContain('document.write(TAGS)');
    expect(INJECT).toContain('document.readyState === "loading"');
    // 로드 완료 이후 진입 시 document.write 로 문서를 날리지 않는다.
    expect(INJECT).toMatch(/else\s*\{[\s\S]*appendChild/);
  });

  it('주입 실패가 앱을 막지 않는다', () => {
    expect(INJECT).toContain('catch (e)');
  });
});

describe('[JP-02C] §5 JP 폰트 스택 — 번들 + 시스템만', () => {
  const jaBlock = html.slice(html.indexOf('--font-display: "Reggae One"'),
                             html.indexOf('--font-display: "Reggae One"') + 600);
  it('JP 스택에 Google 전용 가족이 없다', () => {
    for (const google of ['Noto Sans JP', 'Black Han Sans', 'Gowun Dodum', 'Noto Sans KR']) {
      expect(jaBlock, google).not.toContain(google);
    }
  });
  it('JP 스택이 번들 폰트로 시작한다', () => {
    expect(jaBlock).toMatch(/--font-display: "Reggae One"/);
    expect(jaBlock).toMatch(/--font-body: "M PLUS Rounded 1c"/);
    expect(jaBlock).toMatch(/--font-sub: "M PLUS Rounded 1c"/);
  });
  it('일본어 시스템 폰트가 fallback 에 있다', () => {
    for (const sys of ['Hiragino Sans', 'Yu Gothic', 'Meiryo']) {
      expect(jaBlock, sys).toContain(sys);
    }
  });
});

describe('[JP-02C] §17 KR/EN 표현 보존', () => {
  it('KR 스택이 그대로다', () => {
    expect(html).toContain('--font-display: "Black Han Sans", sans-serif;');
    expect(html).toContain('--font-body: "Noto Sans KR", -apple-system');
    expect(html).toContain('--font-sub: "Gowun Dodum", sans-serif;');
  });
  it('EN 스택이 그대로다', () => {
    expect(html).toContain('--font-display: "Bebas Neue", "Anton", "Black Han Sans", sans-serif;');
    expect(html).toContain('--font-body: "Inter", -apple-system');
  });
  it('KR/EN 이 쓰는 Google 가족이 주입 URL 에 남아 있다', () => {
    for (const fam of ['Black+Han+Sans', 'Gowun+Dodum', 'Noto+Sans+KR', 'Inter']) {
      expect(INJECT, fam).toContain(fam);
    }
  });
});

describe('[JP-02C] §7 번들 폰트 라이선스', () => {
  it('라이선스 고지 파일이 존재한다 (OFL 요구사항)', () => {
    expect(existsSync(new URL('LICENSES.md', fontsDir))).toBe(true);
  });
  it('번들된 모든 폰트가 고지에 기재돼 있다', () => {
    const notice = readFileSync(new URL('LICENSES.md', fontsDir), 'utf8');
    const files = readdirSync(fontsDir).filter((f) => f.endsWith('.ttf'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(notice, f).toContain(f);
  });
  it('고지가 OFL-1.1 과 라이선스 URL 을 명시한다', () => {
    const notice = readFileSync(new URL('LICENSES.md', fontsDir), 'utf8');
    expect(notice).toContain('OFL-1.1');
    expect(notice).toContain('scripts.sil.org/OFL');
  });
  it('@font-face 가 참조하는 파일이 모두 실재한다', () => {
    const srcs = [...html.matchAll(/src:url\("(ASSETS\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      expect(existsSync(new URL(`../${s}`, import.meta.url)), s).toBe(true);
    }
  });
  it('사용하지 않는 폰트 파일을 두지 않는다', () => {
    const files = readdirSync(fontsDir).filter((f) => f.endsWith('.ttf'));
    for (const f of files) {
      expect(html, `${f} 가 @font-face 에서 참조되지 않는다`).toContain(`ASSETS/fonts/${f}`);
    }
  });
});

describe('[JP-02C] §13,15,17 경계 유지', () => {
  it('분석 SDK 를 추가하지 않았다', () => {
    for (const sdk of ['googletagmanager', 'google-analytics', 'gtag(', 'firebase/analytics',
                       'connect.facebook', 'fbq(', 'amplitude', 'mixpanel']) {
      expect(html.toLowerCase(), sdk).not.toContain(sdk.toLowerCase());
    }
  });
  it('OAUTH_BRIDGE_URL 을 변경하지 않았다', () => {
    expect(html).toContain('const OAUTH_BRIDGE_URL = "https://product-builder-lecture-phi.vercel.app/oauth-bridge.html";');
  });
  it('LINE SDK 가 없고 LINE Login 이 false 다', () => {
    expect(html).not.toMatch(/liff\.init|liff-sdk|static\.line-scdn/i);
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
  });
  it('법무/지원 차단 항목을 건드리지 않았다', () => {
    expect(html).toMatch(/email: null/);
    expect(html).toContain("ja: Object.freeze({ path: 'legal/privacy.ja.html'");
    expect(html).not.toMatch(/href="(privacy|terms)\.html"/);
  });
});
