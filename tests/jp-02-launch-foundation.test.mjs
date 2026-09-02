// SPRINT JP-02 — JP 출시 기반 / LINE 이전 하드닝
//
// 잠그는 것: 운영자/IP 소유 분리, KR 출시 상태 게이트, 법무 문서 로케일 라우팅.
// 핵심 계약: **JP 사용자가 한국어 법무 문서를 받는 경로가 0개여야 한다.**
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const registry = JSON.parse(readFileSync(new URL('../config/legal-documents.json', import.meta.url), 'utf8'));
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const OWNER = slice('    const WOORIMARU_IP_OWNER = Object.freeze({', '\n    });');
const OPERATOR = slice('    const JP_OPERATOR_CONFIG = Object.freeze({', '\n    });');
const LAUNCH = slice('    // ── KR 출시 상태 게이트', '    // ── 소유권 / 운영자 분리');
const LEGAL = slice('    // ── 법무 문서 라우팅', '    // ── KR 출시 상태 게이트');

function load(block, ret) {
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return ${ret};`)();
}

describe('[JP-02] C — 운영자 / IP 소유 분리', () => {
  it('두 설정이 별개로 존재한다', () => {
    expect(html).toContain('const WOORIMARU_IP_OWNER = Object.freeze({');
    expect(html).toContain('const JP_OPERATOR_CONFIG = Object.freeze({');
  });
  it('IP 소유는 운영자를 참조하지 않는다 (구조적 독립)', () => {
    expect(OWNER).not.toContain('JP_OPERATOR_CONFIG');
    expect(OWNER).not.toContain('operator');
  });
  it('운영자 설정은 IP 소유를 참조하지 않는다', () => {
    expect(OPERATOR).not.toContain('WOORIMARU_IP_OWNER');
  });
  it('운영자 개인 신원이 하드코딩돼 있지 않다 — 미확정은 null 로 명시된다', () => {
    const cfg = load(slice('    const JP_OPERATOR_CONFIG', '\n    });') + '\n    });', 'JP_OPERATOR_CONFIG');
    expect(cfg.operatorId).toBeNull();
    expect(cfg.displayName).toBeNull();
    expect(cfg.line.channelId).toBeNull();
    expect(cfg.legal.businessName).toBeNull();
    expect(cfg.legal.representative).toBeNull();
  });
  it('운영자 확정 여부를 판정하는 단일 함수가 있다', () => {
    expect(html).toContain('function isJpOperatorConfigured()');
  });
  it('IP 소유는 값이 채워져 있고 운영자와 무관하다', () => {
    const o = load(slice('    const WOORIMARU_IP_OWNER', '\n    });') + '\n    });', 'WOORIMARU_IP_OWNER');
    expect(o.entity).toBe('Woorimaru');
    expect(Array.isArray(o.ipScope)).toBe(true);
  });
});

describe('[JP-02] D — KR 출시 상태 게이트', () => {
  const mod = () => load(LAUNCH, '({ LAUNCH_STATUS, KR_RPS_LAUNCH_STATUS, KR_MARUSNAP_LAUNCH_STATUS, mayClaimLaunchedInKorea })');

  it('두 상태 변수가 존재한다', () => {
    expect(html).toContain('const KR_RPS_LAUNCH_STATUS');
    expect(html).toContain('const KR_MARUSNAP_LAUNCH_STATUS');
  });
  it('현재 값은 PUBLIC_LAUNCHED 가 아니다 — 사실 확인 전이다', () => {
    const m = mod();
    expect(m.KR_RPS_LAUNCH_STATUS).not.toBe(m.LAUNCH_STATUS.PUBLIC_LAUNCHED);
    expect(m.KR_MARUSNAP_LAUNCH_STATUS).not.toBe(m.LAUNCH_STATUS.PUBLIC_LAUNCHED);
  });
  it('PUBLIC_LAUNCHED 일 때만 "한국에서 제공 중" 주장이 허용된다', () => {
    const m = mod();
    expect(m.mayClaimLaunchedInKorea(m.LAUNCH_STATUS.PUBLIC_LAUNCHED)).toBe(true);
    for (const s of [m.LAUNCH_STATUS.IN_DEVELOPMENT, m.LAUNCH_STATUS.SUBMITTED, undefined, null, 'launched']) {
      expect(m.mayClaimLaunchedInKorea(s), String(s)).toBe(false);
    }
  });
  it('사용자 대면 문구 어디에도 「韓国で提供中」이 없다', () => {
    // 주석에는 규칙 설명으로 이 문구가 등장한다 — 판정 대상은 **코드/마크업**이다.
    const codeOnly = html.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
      .replace(/<!--[\s\S]*?-->/g, '');
    expect(codeOnly).not.toContain('韓国で提供中');
    expect(codeOnly).not.toMatch(/韓国で(提供|配信|公開)/);
  });
});

describe('[JP-02] B — 법무 문서 로케일 라우팅 / 한국어 유출 차단', () => {
  const mod = () => load(LEGAL, '({ LEGAL_DOCUMENTS, legalDocumentFor, legalDocumentHref })');

  it('ja 슬롯이 존재하고 한국어 문서를 가리키지 않는다', () => {
    const m = mod();
    const p = m.legalDocumentFor('privacy', 'ja');
    const t = m.legalDocumentFor('terms', 'ja');
    expect(p.language).toBe('ja');
    expect(t.language).toBe('ja');
    expect(p.path).not.toBe('privacy.html');
    expect(t.path).not.toBe('terms.html');
  });
  it('**JP 사용자가 한국어 문서를 받는 경로가 0개다** (핵심 계약)', () => {
    const m = mod();
    for (const kind of ['privacy', 'terms']) {
      const href = m.legalDocumentHref(kind, 'ja');
      expect(href, `${kind}/ja`).not.toMatch(/^(privacy|terms)\.html$/);
      expect(href).toContain('.ja.');
    }
  });
  it('문서가 없는 로케일은 다른 언어로 대체하지 않고 null 을 준다', () => {
    const m = mod();
    expect(m.legalDocumentHref('privacy', 'en')).toBeNull();
    expect(m.legalDocumentHref('terms', 'en')).toBeNull();
    expect(m.legalDocumentFor('privacy', 'zz')).toBeNull();
    expect(m.legalDocumentFor('nonexistent', 'ja')).toBeNull();
  });
  it('ja 문서는 PENDING_HIKARI 이며 승인된 법적 문언으로 취급되지 않는다', () => {
    const m = mod();
    expect(m.LEGAL_DOCUMENTS.privacy.ja.status).toBe('PENDING_HIKARI');
    expect(m.LEGAL_DOCUMENTS.terms.ja.status).toBe('PENDING_HIKARI');
  });
  it('ja 슬롯 파일이 실제로 존재한다', () => {
    for (const f of ['legal/privacy.ja.html', 'legal/terms.ja.html']) {
      expect(existsSync(new URL(`../${f}`, import.meta.url)), f).toBe(true);
    }
  });
  it('ja 슬롯 파일은 lang="ja" 이고 한국어 법무 문언을 담지 않는다', () => {
    for (const f of ['legal/privacy.ja.html', 'legal/terms.ja.html']) {
      const doc = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      expect(doc, f).toContain('lang="ja"');
      // 한글 법무 용어가 들어가면 번역/전용이 일어난 것이다.
      expect(doc, f).not.toMatch(/개인정보|이용약관|처리방침|수집|제3자/);
    }
  });
  it('레지스트리(config)와 런타임 선언이 일치한다', () => {
    const m = mod();
    for (const kind of ['privacy', 'terms']) {
      for (const loc of ['ko', 'ja']) {
        const reg = registry.documents[kind][loc];
        const run = m.LEGAL_DOCUMENTS[kind][loc];
        expect(run.path, `${kind}.${loc}.path`).toBe(reg.path);
        expect(run.status, `${kind}.${loc}.status`).toBe(reg.status);
        expect(run.language, `${kind}.${loc}.language`).toBe(reg.language);
      }
    }
    expect(registry.fallback_policy).toMatch(/^NONE/);
  });
  it('로케일 전환 시 라우팅이 적용되고, 문서 없으면 링크를 숨긴다', () => {
    expect(html).toContain('function applyLegalDocumentRouting(locale)');
    expect(html).toContain('applyLegalDocumentRouting(loc)');
    const fn = slice('    function applyLegalDocumentRouting(locale) {', '\n    }');
    expect(fn).toContain("classList.add('hidden')");
    expect(fn).toContain('removeAttribute');
  });
  it('마크업에 로케일 종속 법무 문서 href 가 하드코딩돼 있지 않다 (JS 실패 시에도 한국어 유출 0)', () => {
    // 하드코딩이 남아 있으면 라우팅이 돌기 전이나 JS 가 죽었을 때 JP 사용자가 한국어 문서로 간다.
    expect(html).not.toMatch(/href="(privacy|terms)\.html"/);
  });
  it('링크 4곳이 모두 라우팅 대상 id 를 갖는다', () => {
    for (const id of ['legalPrivacyLinkAuth', 'legalTermsLinkAuth',
                      'legalPrivacyLinkSettings', 'legalTermsLinkSettings']) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });
});

describe('[JP-02] F — 계정 삭제 경로 계약', () => {
  const fn = slice('    async function deleteAccountWithConfirm() {', '\n    }');
  const edge = readFileSync(new URL('../supabase/functions/delete-account/index.ts', import.meta.url), 'utf8');

  it('사용자 확인 없이는 시작되지 않는다', () => {
    expect(fn).toContain('showConfirmPopup(');
    expect(fn.indexOf('showConfirmPopup(')).toBeLessThan(fn.indexOf('invoke("delete-account"'));
    expect(fn).toContain('if (!ok) return;');
  });
  it('클라이언트가 세션 없이는 호출하지 않는다', () => {
    const guard = fn.indexOf('if (!accessToken)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('invoke("delete-account"'));
  });
  it('사용자 access token 을 실어 보낸다 (anon 키가 아니다)', () => {
    expect(fn).toContain('Authorization: `Bearer ${accessToken}`');
  });
  it('서버가 토큰으로 사용자 신원을 독립 검증한다', () => {
    expect(edge).toContain('admin.auth.getUser(token)');
    expect(edge.indexOf('admin.auth.getUser(token)')).toBeLessThan(edge.indexOf('deleteUser('));
  });
  it('서버는 검증된 사용자 자신만 삭제한다 (요청 본문의 id 를 신뢰하지 않는다)', () => {
    expect(edge).toContain('deleteUser(userData.user.id)');
    expect(edge).not.toMatch(/deleteUser\(\s*(body|req|payload)/);
  });
  it('실패 시 로컬 상태를 지우지 않는다 — 성공 경로에서만 정리한다', () => {
    const cleanup = fn.indexOf('localStorage.removeItem("rpsAuthState")');
    const thrown = fn.indexOf('if (error) throw error;');
    expect(thrown).toBeGreaterThan(-1);
    expect(thrown, '오류를 던지기 전에 로컬을 지우면 불일치가 남는다').toBeLessThan(cleanup);
  });
  it('실패는 사용자에게 표면화된다 (조용히 삼키지 않는다)', () => {
    expect(fn).toContain('catch (e)');
    expect(fn).toContain('showToast(t("toast.error"');
  });
  it('성공 시 세션과 로컬 캐시를 정리한다', () => {
    for (const k of ['db.auth.signOut()', 'rpsAuthState', 'rpsNickname', 'rpsAccountStatsCache']) {
      expect(fn, k).toContain(k);
    }
  });
  it('삭제 버튼은 인증된 사용자에게만 노출된다', () => {
    expect(html).toContain('$("settingsDeleteAccountBtn")?.classList.toggle("hidden", auth !== "authed")');
  });
});

describe('[JP-02] 경계 — 금지 사항 미착수', () => {
  it('LIFF SDK / LINE Login 을 도입하지 않았다', () => {
    expect(html).not.toMatch(/liff\.init|liff-sdk|static\.line-scdn/i);
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
  });
  it('운영자 채널 설정을 넣지 않았다', () => {
    const cfg = load(slice('    const JP_OPERATOR_CONFIG', '\n    });') + '\n    });', 'JP_OPERATOR_CONFIG');
    expect(cfg.line.miniAppId).toBeNull();
    expect(cfg.line.officialAccountId).toBeNull();
  });
});
