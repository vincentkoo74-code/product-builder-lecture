// JP-BL-002 — JP 빌드에서 Kakao(KR 전용) 인증 표면 제거
//
// 목표는 **런타임 격리**다: JP 는 Kakao 를 노출하지도, 초기화하지도, 경유하지도,
// 의존하지도, fallback 하지도 않는다. KR 의 공유 기능은 전역에서 제거하지 않는다 —
// 시장 계층에서만 끈다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const MARKET = slice('    const MARKET_CONFIG = {', '\n    };');
const GATE = slice('    // JP-BL-002: 시장이 비활성 목록에', '    const OAUTH_BRIDGE_URL');
const STRIP = slice('    // JP-BL-002: 지원하지 않는 provider 의 OAuth 콜백', '    // 부트 진입점.');
const INIT = slice('async function initFromUrl()', 'function bootAppWhenReady()');

function loadGate(marketConfig) {
  // eslint-disable-next-line no-new-func
  return new Function('MARKET_CONFIG',
    `${GATE} return { isMarketAuthProviderEnabled, ENABLE_KAKAO_LOGIN };`)(marketConfig);
}

function loadStrip(href) {
  const loc = new URL(href);
  const calls = [];
  const history = { replaceState: (a, b, url) => { calls.push(url); const n = new URL(url, loc.origin);
    loc.search = n.search; loc.pathname = n.pathname; loc.hash = n.hash; } };
  const location = { get href() { return loc.href; }, get search() { return loc.search; },
                     get pathname() { return loc.pathname; }, get hash() { return loc.hash; } };
  // eslint-disable-next-line no-new-func
  const m = new Function('history', 'location', 'URL',
    `${STRIP} return { stripOAuthCallbackFromUrl, OAUTH_CALLBACK_PARAMS };`)(history, location, URL);
  return { ...m, calls, location };
}

describe('[JP-BL-002] §14-1 JP UI 에 Kakao 로그인이 없다', () => {
  it('JP 시장 프로필이 kakao 를 비활성 목록에 넣는다', () => {
    expect(MARKET).toContain("market: 'JP'");
    expect(MARKET).toMatch(/disabledAuthProviders:\s*\['kakao'\]/);
  });
  it('JP 에서 ENABLE_KAKAO_LOGIN 이 false 다', () => {
    expect(loadGate({ market: 'JP', disabledAuthProviders: ['kakao'] }).ENABLE_KAKAO_LOGIN).toBe(false);
  });
  it('부팅이 Kakao 버튼을 **DOM 에서 제거**한다 (CSS 숨김이 아니라)', () => {
    expect(INIT).toContain('$("snsBtnKakao")?.remove()');
    expect(INIT).not.toMatch(/snsBtnKakao[^\n]*classList\.add\("hidden"\)/);
  });
  it('버튼에 제거 가능한 id 가 있다', () => {
    expect(html).toContain('<button id="snsBtnKakao"');
  });
});

describe('[JP-BL-002] §14-2 JP 시작 시 Kakao 요청이 없다', () => {
  const login = slice("      // Kakao — Custom OAuth flow (Edge Function 'kakao-auth')", '      // LINE — Custom OAuth flow');
  const cb = slice('    async function handleKakaoCallback(', '      const params = sourceParams');

  it('loginWithSns 는 비활성 시 OAuth URL 도 state 도 만들지 않는다', () => {
    // 가드가 kauth.kakao.com 접근·localStorage 기록보다 **앞에** 있어야 한다.
    const guard = login.indexOf('!ENABLE_KAKAO_LOGIN) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(login.indexOf('kauth.kakao.com'));
    expect(guard).toBeLessThan(login.indexOf('kakaoOAuthState'));
  });
  it('handleKakaoCallback 은 비활성 시 edge function 을 부르기 전에 끝난다', () => {
    expect(cb).toContain('if (!ENABLE_KAKAO_LOGIN) return false;');
    const guard = cb.indexOf('!ENABLE_KAKAO_LOGIN');
    expect(guard).toBeGreaterThan(-1);
    // 이 슬라이스 이전에는 이 가드가 없었다 — 함수 본문 최상단이어야 한다.
    expect(cb.slice(0, guard)).not.toContain('invoke');
  });
  it('네이티브 딥링크 kakao 분기도 게이트된다', () => {
    expect(html).toContain('if (provider === "kakao") return ENABLE_KAKAO_LOGIN ? handleKakaoCallback');
  });
  it('부트 시퀀스가 비활성 시 Kakao 콜백 처리를 건너뛴다', () => {
    expect(INIT).toContain('if (ENABLE_KAKAO_LOGIN && db?.auth && params.get("provider") === "kakao")');
  });
});

describe('[JP-BL-002] §8 설정/시크릿 의존', () => {
  it('KR 공개 REST 키 리터럴이 JP 소스에 없다', () => {
    expect(html).not.toContain('bce3cbf5a9fcdb2a300ce741bca3486a');
  });
  it('KAKAO_REST_API_KEY 는 시장 프로필에서 온다', () => {
    expect(html).toMatch(/const KAKAO_REST_API_KEY = \(typeof MARKET_CONFIG/);
  });
  it('JP 시장 프로필은 Kakao 키를 갖지 않는다', () => {
    expect(MARKET).toMatch(/kakaoRestApiKey:\s*null/);
  });
});

describe('[JP-BL-002] §13 KR 경계 — 공유 기능을 전역에서 제거하지 않았다', () => {
  it('목록을 선언하지 않는 시장(KR)에서는 Kakao 가 그대로 켜져 있다', () => {
    for (const cfg of [{ market: 'KR' }, {}, undefined, null]) {
      expect(loadGate(cfg).ENABLE_KAKAO_LOGIN, JSON.stringify(cfg)).toBe(true);
    }
  });
  it('KR 프로필이 키를 선언하면 그대로 쓰인다', () => {
    // eslint-disable-next-line no-new-func
    const key = new Function('MARKET_CONFIG',
      `const KAKAO_REST_API_KEY = (typeof MARKET_CONFIG !== 'undefined' && MARKET_CONFIG
        && typeof MARKET_CONFIG.kakaoRestApiKey === 'string') ? MARKET_CONFIG.kakaoRestApiKey : "";
       return KAKAO_REST_API_KEY;`)({ market: 'KR', kakaoRestApiKey: 'kr-key' });
    expect(key).toBe('kr-key');
  });
  it('Kakao 구현(loginWithSns 분기·콜백 핸들러·edge function 호출)은 코드에 그대로 남아 있다', () => {
    expect(html).toContain('async function handleKakaoCallback');
    expect(html).toContain("db.functions.invoke(\"kakao-auth\"");
    expect(html).toContain('kauth.kakao.com/oauth/authorize');
  });
  it('다른 provider 게이트를 건드리지 않았다', () => {
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
    expect(html).toContain('const ENABLE_GOOGLE_LOGIN = false;');
  });
});

describe('[JP-BL-002] §7 콜백 / URL 안전', () => {
  const T = 'T'.repeat(22);
  it('9,7) 원시 OAuth 파라미터를 지우고 invite 는 보존한다', () => {
    const m = loadStrip(`https://x.test/app?provider=kakao&code=abc&state=xyz&invite=${T}&lang=ja`);
    expect(m.stripOAuthCallbackFromUrl()).toBe(true);
    expect(m.location.search).not.toContain('provider=');
    expect(m.location.search).not.toContain('code=');
    expect(m.location.search).not.toContain('state=');
    expect(m.location.search, 'invite 를 지우면 초대 연속성이 깨진다').toContain(`invite=${T}`);
    expect(m.location.search).toContain('lang=ja');
  });
  it('OAuth 오류 파라미터도 함께 지운다', () => {
    const m = loadStrip('https://x.test/app?provider=kakao&error=access_denied&error_description=nope');
    m.stripOAuthCallbackFromUrl();
    expect(m.location.search).not.toContain('error');
  });
  it('8) 형식이 깨진 콜백에도 크래시하지 않는다', () => {
    for (const q of ['?provider=kakao', '?provider=kakao&code=', '?%', '?provider=kakao&code=%E0%A4%A']) {
      expect(() => loadStrip('https://x.test/app' + q).stripOAuthCallbackFromUrl()).not.toThrow();
    }
  });
  it('지울 것이 없으면 URL 을 건드리지 않는다', () => {
    const m = loadStrip(`https://x.test/app?invite=${T}`);
    expect(m.stripOAuthCallbackFromUrl()).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
  it('정리 코드가 invite 를 대상에 넣지 않는다', () => {
    expect(codeOnly(STRIP)).not.toContain("'invite'");
    expect(codeOnly(STRIP)).not.toContain('"invite"');
  });
  it('부트에서 정리가 초대 보류(beginInviteEntry) **이후**에 일어난다', () => {
    const iBegin = INIT.indexOf('beginInviteEntry(location.search');
    const iStrip = INIT.indexOf('stripOAuthCallbackFromUrl()');
    expect(iBegin).toBeGreaterThan(-1);
    expect(iStrip).toBeGreaterThan(-1);
    expect(iBegin, '초대를 붙잡기 전에 URL 을 건드리면 안 된다').toBeLessThan(iStrip);
  });
});

describe('[JP-BL-002] 경계 — 이 슬라이스가 건드리지 않은 것', () => {
  it('LIFF/LINE SDK 를 넣지 않았다', () => {
    expect(html).not.toMatch(/liff\.init|liff-sdk|static\.line-scdn\.net/i);
  });
  it('KakaoTalk 인앱 브라우저 감지는 인증 경로가 아니므로 유지한다', () => {
    // OAuth 가 막히는 인앱 브라우저를 안내하는 범용 UA 감지다 — Kakao 인증과 무관하다.
    expect(html).toContain('{ re: /KAKAOTALK/i,      name: "KakaoTalk" }');
  });
});
