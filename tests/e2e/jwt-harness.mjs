// JP-E2E-JWT-FIDELITY — 로컬 전용 JWT 서명/발급
//
// 목적: 브라우저 E2E 가 **실제로 검증되는** JWT 를 쓰게 만든다.
//   종전에는 앱이 보낸 프로덕션 anon JWT 를 로컬 PostgREST 가 검증할 수 없어 인증 헤더를
//   통째로 벗겼다. 그래서 JWT 검증·롤 해석·GRANT/RLS 강제력이 전혀 검증되지 않았다.
//
// 원칙:
//   - **프로덕션 서명 재료를 절대 복사하지 않는다.** 로컬 전용 비밀만 쓴다.
//   - 비밀은 저장소에 두지 않는다 — 환경변수로 받고, 없으면 fail-closed 로 중단한다.
//   - 권한을 우회하지 않는다. 토큰은 롤을 **주장**할 뿐이고, 강제는 PostgREST + DB 가 한다.
import { SignJWT } from 'jose';
import { localEnv } from './local-env.mjs';

const ISSUER = 'jp-e2e-local';

function secretKey() {
  const s = localEnv().jwtSecret;   // .jp-e2e/env.json 또는 환경변수. 없으면 여기서 fail-closed.
  if (!s || s.length < 32) throw new Error('로컬 서명 비밀이 유효하지 않다 — npm run jp:e2e:bootstrap');
  return new TextEncoder().encode(s);
}

// 클레임 형태만 노출한다 — 비밀값은 어디에도 담지 않는다.
export function claimShape(kind, { sub = null } = {}) {
  return kind === 'authenticated'
    ? { role: 'authenticated', sub, aud: 'authenticated', iss: ISSUER, alg: 'HS256' }
    : { role: 'anon', aud: 'anon', iss: ISSUER, alg: 'HS256' };
}

async function sign(payload, { expiresIn = '30m', key = null } = {}) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(expiresIn)
    .sign(key || secretKey());
}

// A. anon 토큰 — JP 게스트 플레이의 프로덕션 동작을 그대로 재현한다.
//    (게스트를 테스트 편의로 authenticated 사용자로 바꾸지 않는다.)
export const anonToken = (opts = {}) => sign({ role: 'anon', aud: 'anon' }, opts);

// B. authenticated 토큰 — 소유자 범위 통계/이력 경로용.
export const authedToken = (sub, opts = {}) =>
  sign({ role: 'authenticated', sub, aud: 'authenticated' }, opts);

// ── 부정 케이스용 토큰 ────────────────────────────────────────────────────────
export const expiredToken = async () =>
  sign({ role: 'anon', aud: 'anon' }, { expiresIn: '-1m' });

export const wrongSignatureToken = async () =>
  sign({ role: 'anon', aud: 'anon' },
       { key: new TextEncoder().encode('this-is-a-different-local-key-not-the-real-one!!') });

export const noRoleClaimToken = async () => sign({ aud: 'anon' });

export const forgedRoleToken = async (role) => sign({ role, aud: role });

export const bearer = (t) => ({ apikey: t, authorization: `Bearer ${t}` });
