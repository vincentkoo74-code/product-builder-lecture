// SPRINT JP-02B — JP 지원 / 운영 준비
//
// 핵심 계약: 승인되지 않은 연락처를 노출하지 않고, 지원·분석 어느 경로로도
//            개인식별정보·토큰이 새지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '');

const SUPPORT = slice('    const JP_SUPPORT_CONFIG = Object.freeze({', '    // ── JP 분석 이벤트 스키마');
const ANALYTICS = slice('    const JP_ANALYTICS_FORBIDDEN_FIELDS', '    // ── 법무 문서 라우팅');

const loadSupport = () =>
  // eslint-disable-next-line no-new-func
  new Function('currentLocale', `${SUPPORT}; return { JP_SUPPORT_CONFIG, isJpSupportConfigured,
    jpSupportDestinationFor, JP_SUPPORT_CATEGORIES, makeDiagnosticRef, JP_ERROR_ROUTING,
    buildSupportContext, JP_DIAG_REF_PREFIX };`)('ja');
const loadAnalytics = () =>
  // eslint-disable-next-line no-new-func
  new Function('currentLocale', `${ANALYTICS}; return { buildAnalyticsPayload, JP_ANALYTICS_EVENTS,
    JP_ANALYTICS_FORBIDDEN_FIELDS, JP_ANALYTICS_DIMENSIONS };`)('ja');

describe('[JP-02B] §17-1,2 지원 연락처 — 미설정은 안전하게 실패한다', () => {
  it('연락처가 전부 null 이다 (승인 전 지어내지 않았다)', () => {
    const m = loadSupport();
    expect(m.JP_SUPPORT_CONFIG.email).toBeNull();
    expect(m.JP_SUPPORT_CONFIG.privacyEmail).toBeNull();
    expect(m.JP_SUPPORT_CONFIG.operatorContact).toBeNull();
  });
  it('미설정이면 isJpSupportConfigured() 가 false 다', () => {
    expect(loadSupport().isJpSupportConfigured()).toBe(false);
  });
  it('미설정이면 어떤 분류로도 목적지가 나오지 않는다', () => {
    const m = loadSupport();
    for (const c of m.JP_SUPPORT_CATEGORIES) {
      expect(m.jpSupportDestinationFor(c.id), c.id).toBeNull();
    }
  });
  it('빌드 어디에도 플레이스홀더 이메일이 노출되지 않는다', () => {
    const code = codeOnly(html);
    const emails = code.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    expect(emails, `노출된 이메일: ${emails.join(', ')}`).toHaveLength(0);
  });
  it('응답 시간·24시간 대응을 약속하지 않는다', () => {
    expect(html).not.toMatch(/24時間|24\/7|営業時間内に必ず|以内に回答|반드시 답변/);
  });
  it('설정되면 목적지가 나오고, 개인정보 문의는 전용 창구를 우선한다', () => {
    // eslint-disable-next-line no-new-func
    const m = new Function('currentLocale', `${SUPPORT.replace(
      "email: null,            //", "email: 'a@example.test', //").replace(
      "privacyEmail: null,     //", "privacyEmail: 'p@example.test', //")};
      return { isJpSupportConfigured, jpSupportDestinationFor };`)('ja');
    expect(m.isJpSupportConfigured()).toBe(true);
    expect(m.jpSupportDestinationFor('privacy')).toBe('p@example.test');
    expect(m.jpSupportDestinationFor('bug')).toBe('a@example.test');
  });
});

describe('[JP-02B] §6 문의 분류', () => {
  it('요구된 7개 분류가 모두 있다', () => {
    const ids = loadSupport().JP_SUPPORT_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(['connection', 'invite', 'accountData', 'privacy', 'legal', 'bug', 'other']);
  });
  it('라벨은 i18n 키로만 관리된다 (하드코딩 문구 없음)', () => {
    for (const c of loadSupport().JP_SUPPORT_CATEGORIES) {
      expect(c.labelKey).toMatch(/^support\.cat\./);
      expect(Object.keys(c)).toEqual(['id', 'labelKey']);
    }
  });
  it('3개 로케일 모두에 지원 키가 있다', () => {
    for (const k of ['support.title', 'support.pending', 'support.refLabel',
                     'support.cat.connection', 'support.cat.privacy',
                     'support.err.deleteFailed', 'support.err.unexpected']) {
      const n = (html.match(new RegExp(`"${k.replace(/\./g, '\\.')}":`, 'g')) || []).length;
      expect(n, k).toBe(3);
    }
  });
});

describe('[JP-02B] §8 오류 → 지원 라우팅', () => {
  const m = () => loadSupport();
  it('요구된 오류 상태가 모두 등록돼 있다', () => {
    const keys = Object.keys(m().JP_ERROR_ROUTING);
    for (const k of ['connectionFailure', 'inviteUnavailable', 'inviteInvalid',
                     'hostGone', 'roomFull', 'accountDeleteFailed', 'unexpected']) {
      expect(keys, k).toContain(k);
    }
  });
  it('**어떤 상태도 원시 백엔드 오류를 노출하지 않는다**', () => {
    for (const [k, v] of Object.entries(m().JP_ERROR_ROUTING)) {
      expect(v.technicalDetailExposed, k).toBe(false);
    }
  });
  it('모든 상태가 i18n 키로만 문구를 지정한다', () => {
    for (const [k, v] of Object.entries(m().JP_ERROR_ROUTING)) {
      expect(v.titleKey, k).toMatch(/^[a-z]+\./);
      expect(v.descKey, k).toMatch(/^[a-z]+\./);
    }
  });
  it('각 상태가 유효한 지원 분류로 연결된다', () => {
    const ids = m().JP_SUPPORT_CATEGORIES.map((c) => c.id);
    for (const [k, v] of Object.entries(m().JP_ERROR_ROUTING)) {
      expect(ids, k).toContain(v.supportCategory);
    }
  });
  it('실제 오류 렌더러가 원시 오류 문자열을 쓰지 않는다', () => {
    const conn = codeOnly(slice('    function showConnectionError(context', '\n    }'));
    const inv = codeOnly(slice('    function renderInviteUnavailable(intent)', '\n    }'));
    for (const [name, blk] of [['showConnectionError', conn], ['renderInviteUnavailable', inv]]) {
      expect(blk, name).not.toMatch(/e\.message|error\.message|PostgREST|supabase/i);
    }
  });
});

describe('[JP-02B] §9 진단 참조 ID — 개인정보 없음', () => {
  it('형식이 JP-ERR-<짧은 id> 다', () => {
    const m = loadSupport();
    for (let i = 0; i < 50; i++) {
      const ref = m.makeDiagnosticRef();
      expect(ref).toMatch(/^JP-ERR-[A-Z0-9]{1,8}$/);
    }
  });
  it('난수에서만 만들어진다 — 사용자/방/토큰 원천을 참조하지 않는다', () => {
    const src = codeOnly(slice('    function makeDiagnosticRef() {', '\n    }'));
    for (const bad of ['state.currentUserId', 'roomCode', 'inviteToken', 'nickname',
                       'email', 'access_token', 'Date.now']) {
      expect(src, bad).not.toContain(bad);
    }
    expect(src).toContain('crypto.getRandomValues');
  });
  it('연속 생성이 서로 다르다 (상관관계용으로 쓸 수 있다)', () => {
    const m = loadSupport();
    const set = new Set(Array.from({ length: 200 }, () => m.makeDiagnosticRef()));
    expect(set.size).toBeGreaterThan(190);
  });
});

describe('[JP-02B] §10 데이터 최소화 — 지원 컨텍스트', () => {
  it('허용 필드만 담는다', () => {
    const m = loadSupport();
    const ctx = m.buildSupportContext('inviteUnavailable', 'JP-ERR-ABC123');
    expect(Object.keys(ctx).sort()).toEqual(
      ['appVersion', 'diagnosticRef', 'errorCategory', 'locale', 'market'].sort());
  });
  it('**초대 토큰·방코드·닉네임·사용자 id·URL 이 들어가지 않는다**', () => {
    const m = loadSupport();
    const ctx = m.buildSupportContext('connectionFailure', 'JP-ERR-XYZ');
    const flat = JSON.stringify(ctx);
    for (const bad of ['invite', 'token', 'roomCode', 'nickname', 'userId', 'http']) {
      expect(flat.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    }
  });
  it('빌더 소스가 금지 원천을 참조하지 않는다', () => {
    const src = codeOnly(slice('    function buildSupportContext(errorState, diagRef) {', '\n    }'));
    for (const bad of ['inviteToken', 'state.roomCode', 'state.nickname',
                       'state.currentUserId', 'location.href', 'access_token']) {
      expect(src, bad).not.toContain(bad);
    }
  });
});

describe('[JP-02B] §12,13 분석 스키마 — 설계 전용 / 금지 식별자 없음', () => {
  it('third-party analytics SDK 를 도입하지 않았다', () => {
    for (const sdk of ['googletagmanager', 'google-analytics', 'gtag(', 'firebase/analytics',
                       'connect.facebook', 'fbq(', 'analytics.line', 'amplitude', 'mixpanel']) {
      expect(html.toLowerCase(), sdk).not.toContain(sdk.toLowerCase());
    }
  });
  it('요구된 퍼널 이벤트가 모두 정의돼 있다', () => {
    const evts = loadAnalytics().JP_ANALYTICS_EVENTS;
    for (const e of ['app_open', 'guest_start', 'challenge_created', 'invite_action_opened',
                     'invite_join_started', 'invite_join_completed', 'ready_completed',
                     'round_started', 'round_completed', 'rematch_started',
                     'connection_error', 'invite_error', 'account_delete_started',
                     'account_delete_failed', 'account_delete_completed']) {
      expect(evts, e).toContain(e);
    }
  });
  it('**금지 식별자는 페이로드에서 걸러진다**', () => {
    const m = loadAnalytics();
    const p = m.buildAnalyticsPayload('invite_join_completed', {
      invite_token: 'SECRET-TOKEN', nickname: 'たろう', email: 'a@b.c',
      user_id: 'uuid-1234', room_code: 'ABCD', penalty_text: '자유입력',
      entry_type: 'invite', round_number: 1,
    });
    const flat = JSON.stringify(p);
    for (const bad of ['SECRET-TOKEN', 'たろう', 'a@b.c', 'uuid-1234', 'ABCD', '자유입력']) {
      expect(flat, bad).not.toContain(bad);
    }
    expect(p.entry_type).toBe('invite');
    expect(p.round_number).toBe(1);
  });
  it('허용 차원 밖의 필드는 통과하지 못한다', () => {
    const p = loadAnalytics().buildAnalyticsPayload('round_started', { arbitrary_field: 'x' });
    expect(p.arbitrary_field).toBeUndefined();
  });
  it('자유입력(긴 문자열)은 차단된다', () => {
    const p = loadAnalytics().buildAnalyticsPayload('connection_error',
      { error_category: 'x'.repeat(64) });
    expect(p.error_category).toBeUndefined();
  });
  it('미등록 이벤트는 null 을 준다', () => {
    expect(loadAnalytics().buildAnalyticsPayload('arbitrary_event', {})).toBeNull();
  });
});

describe('[JP-02B] §11 계정 삭제 지원 — 단계 구분 / JP-BL-022 무변경', () => {
  const fn = slice('    async function deleteAccountWithConfirm() {', '\n    }');
  it('개시 / 실패 / 완료가 구분된다', () => {
    expect(fn).toContain('if (!ok) return;');                 // 개시 전 취소
    expect(fn).toContain('showToast(t("toast.error"');         // 실패
    expect(fn).toContain('showToast(t("account.deleteDone"));');// 완료
  });
  it('실패 시 로컬 상태를 보존한다', () => {
    expect(fn.indexOf('if (error) throw error;'))
      .toBeLessThan(fn.indexOf('localStorage.removeItem("rpsAuthState")'));
  });
  it('JP-BL-022 를 구현하지 않았다 — participants 를 건드리지 않는다', () => {
    expect(fn).not.toContain("from('participants')");
    expect(fn).not.toMatch(/anonymi[sz]e|익명화/);
  });
  it('"모든 기록 완전 삭제"를 주장하지 않는다', () => {
    const code = codeOnly(html);
    expect(code).not.toMatch(/すべての(記録|データ)を完全に削除|完全に削除されます/);
  });
});

describe('[JP-02B] §17-10~12 경계 유지', () => {
  it('LINE SDK 가 없다', () => {
    expect(html).not.toMatch(/liff\.init|liff-sdk|static\.line-scdn|line\.me\/.*sdk/i);
  });
  it('ENABLE_LINE_LOGIN 이 false 다', () => {
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
  });
  it('운영자 개인 신원이 커밋되지 않았다', () => {
    const op = slice('    const JP_OPERATOR_CONFIG = Object.freeze({', '\n    });');
    expect(op).toMatch(/operatorId: null/);
    expect(op).toMatch(/businessName: null/);
    expect(op).toMatch(/representative: null/);
  });
  it('JP 법무 라우팅이 유지된다 (한국어 유출 0)', () => {
    expect(html).not.toMatch(/href="(privacy|terms)\.html"/);
    expect(html).toContain("ja: Object.freeze({ path: 'legal/privacy.ja.html'");
  });
});
