// KR V1.0 Auth 회귀 테스트 — 실기기 P0(false-positive auth state).
//
// 배경: Kakao/Apple 로그인 콜백이 verifyOtp / exchangeCodeForSession 의 error만 검사하고
// data.session은 보지 않았다. 두 API 모두 error:null 이면서 session:null 을 돌려줄 수 있어,
// 실제 Supabase Auth 세션이 없는데도 setAuthState("authed") + "로그인 완료" 토스트가 나가는
// 상태가 만들어졌다(전적 저장 불가·계정삭제 불가·UI-Auth 상태 모순). 수정: 반환된 세션과
// getSession() 재조회가 모두 존재하고 같은 user.id 를 가리킬 때만 성공으로 인정하는
// requireActiveSession() 헬퍼를 두 콜백 경로 모두에 통과시킨다.
//
// index.html 무수정 원칙(tests/room-destroy-stage2b.test.mjs 선례): 이 파일은 index.html을
// readFileSync + 정규식/마커로만 읽고, 추출한 REAL 소스를 new Function으로 그대로 실행한다.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ── REAL 소스 추출 ────────────────────────────────────────────────────────────
// requireActiveSession 본문을 정규식으로 추출한다. 함수 본문 내부의 if 블록들은 모두
// 6-space 이상 들여쓰기로 닫히고, 함수 자체만 4-space 들여쓰기로 닫히므로
// "\n    }\n" (정확히 4칸) 매치가 함수의 실제 종료 지점이다.
const requireActiveSessionMatch = html.match(
  /async function requireActiveSession\(returnedSession, label\) \{[\s\S]*?\n    \}\n/
);
if (!requireActiveSessionMatch) {
  throw new Error('[krv1-auth] requireActiveSession source not found in index.html');
}
const REQUIRE_ACTIVE_SESSION_SRC = requireActiveSessionMatch[0];

function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[krv1-auth] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[krv1-auth] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}

const HANDLE_KAKAO_SRC = extractBlock(
  'async function handleKakaoCallback(sourceParams = new URLSearchParams(location.search)) {',
  'async function handleLineCallback(sourceParams = new URLSearchParams(location.search)) {',
  'handleKakaoCallback'
);
const HANDLE_NATIVE_OAUTH_SRC = extractBlock(
  'async function handleSupabaseNativeOAuthUrl(url, provider) {',
  'async function handleNativeOAuthUrl(url) {',
  'handleSupabaseNativeOAuthUrl'
);

// ── 헬퍼: REAL requireActiveSession을 mock db/withAuthTimeout으로 구동 ───────
function loadRequireActiveSession({ getSessionResult }) {
  const db = {
    auth: {
      getSession: async () => getSessionResult,
    },
  };
  const withAuthTimeout = (promise) => promise; // 타임아웃 로직은 이 테스트의 관심사가 아니다.
  const factory = new Function(
    'db', 'withAuthTimeout',
    `"use strict";\n${REQUIRE_ACTIVE_SESSION_SRC}\nreturn requireActiveSession;`
  );
  return factory(db, withAuthTimeout);
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('requireActiveSession — 실체 확인 전 성공 처리를 막는다(behavioral, REAL)', () => {
  it('returnedSession이 null이고 error도 없으면 거부한다 — 원래의 false-positive 케이스', async () => {
    const requireActiveSession = loadRequireActiveSession({
      getSessionResult: { data: { session: { user: { id: 'A' } } }, error: null },
    });
    await expect(requireActiveSession(null, '카카오 로그인')).rejects.toThrow();
  });

  it('returnedSession은 있지만 getSession()이 session: null을 돌려주면 거부한다', async () => {
    const requireActiveSession = loadRequireActiveSession({
      getSessionResult: { data: { session: null }, error: null },
    });
    await expect(
      requireActiveSession({ user: { id: 'A' } }, '카카오 로그인')
    ).rejects.toThrow();
  });

  it('returnedSession user.id="A" vs getSession() user.id="B" — 불일치는 거부한다', async () => {
    const requireActiveSession = loadRequireActiveSession({
      getSessionResult: { data: { session: { user: { id: 'B' } } }, error: null },
    });
    await expect(
      requireActiveSession({ user: { id: 'A' } }, '카카오 로그인')
    ).rejects.toThrow();
  });

  it('returnedSession user.id="A" === getSession() user.id="A" — 성공 시 세션을 반환한다', async () => {
    const matchingSession = { user: { id: 'A' }, access_token: 'tok' };
    const requireActiveSession = loadRequireActiveSession({
      getSessionResult: { data: { session: matchingSession }, error: null },
    });
    await expect(
      requireActiveSession({ user: { id: 'A' } }, '카카오 로그인')
    ).resolves.toBe(matchingSession);
  });

  it('getSession()이 error를 돌려주면 거부한다', async () => {
    const requireActiveSession = loadRequireActiveSession({
      getSessionResult: { data: { session: null }, error: new Error('boom') },
    });
    await expect(
      requireActiveSession({ user: { id: 'A' } }, '카카오 로그인')
    ).rejects.toThrow('boom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('requireActiveSession 호출 배선 — source-shape 계약(재발 방지 가드)', () => {
  it('handleKakaoCallback이 verifyOtp 이후 requireActiveSession(을 호출한다', () => {
    const verifyIdx = HANDLE_KAKAO_SRC.indexOf('db.auth.verifyOtp(');
    const requireIdx = HANDLE_KAKAO_SRC.indexOf('await requireActiveSession(');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(requireIdx).toBeGreaterThan(verifyIdx);
  });

  it('handleSupabaseNativeOAuthUrl이 exchangeCodeForSession/setSession 두 분기 모두에서 requireActiveSession(을 호출한다', () => {
    const exchangeIdx = HANDLE_NATIVE_OAUTH_SRC.indexOf('db.auth.exchangeCodeForSession(');
    const setSessionIdx = HANDLE_NATIVE_OAUTH_SRC.indexOf('db.auth.setSession(');
    expect(exchangeIdx).toBeGreaterThan(-1);
    expect(setSessionIdx).toBeGreaterThan(exchangeIdx);

    // exchangeCodeForSession 분기: exchangeIdx와 setSessionIdx 사이에 requireActiveSession 호출이 있어야 한다.
    const requireInExchangeBranch = HANDLE_NATIVE_OAUTH_SRC.indexOf('await requireActiveSession(', exchangeIdx);
    expect(requireInExchangeBranch).toBeGreaterThan(exchangeIdx);
    expect(requireInExchangeBranch).toBeLessThan(setSessionIdx);

    // setSession 분기: setSessionIdx 이후에도 requireActiveSession 호출이 있어야 한다.
    const requireInSetSessionBranch = HANDLE_NATIVE_OAUTH_SRC.indexOf('await requireActiveSession(', setSessionIdx);
    expect(requireInSetSessionBranch).toBeGreaterThan(setSessionIdx);
  });

  it('handleKakaoCallback — setAuthState("authed")의 모든 발생은 requireActiveSession( 호출보다 뒤에 온다', () => {
    assertAllAuthedCallsGuarded(HANDLE_KAKAO_SRC, 'handleKakaoCallback');
  });

  it('handleSupabaseNativeOAuthUrl — setAuthState("authed")의 모든 발생은 requireActiveSession( 호출보다 뒤에 온다', () => {
    assertAllAuthedCallsGuarded(HANDLE_NATIVE_OAUTH_SRC, 'handleSupabaseNativeOAuthUrl');
  });

  function assertAllAuthedCallsGuarded(src, label) {
    const marker = 'setAuthState("authed")';
    let idx = src.indexOf(marker);
    let found = 0;
    while (idx !== -1) {
      found += 1;
      const guardIdx = src.lastIndexOf('await requireActiveSession(', idx);
      expect(guardIdx, `[${label}] setAuthState("authed") at ${idx} has no preceding requireActiveSession( call`).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(idx);
      idx = src.indexOf(marker, idx + marker.length);
    }
    expect(found, `[${label}] expected at least one setAuthState("authed") occurrence`).toBeGreaterThan(0);
  }
});
