// JP-E2E-INVITE-001 — 두 브라우저 컨텍스트 E2E 하니스
//
// 원칙:
//  - **프로덕션 소스(index.html)를 수정하지 않는다.** SUPABASE_URL 은 하드코딩 상수이므로
//    Playwright 라우트 가로채기로 로컬 PostgREST 에 붙인다.
//  - 프로덕션 동작을 다시 시뮬레이션하지 않는다 — 실제 앱 DOM/네비게이션을 그대로 쓴다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ADMIN_URI, PG_ENV } from './local-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SUPABASE_HOST = 'https://cmfxhehpreanijwanwrr.supabase.co';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

export function startStaticServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () =>
    resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })));
}

// Supabase 호출을 로컬 PostgREST 로 돌린다. auth/realtime 은 스텁으로 막는다
// (이 게이트는 Realtime 전송이 아니라 브라우저 통합을 검증한다 — 앱은 2.6초 폴링으로 진행한다.
//  실제 Tokyo Realtime 전송은 tokyo-realtime.spec.mjs 가 따로 검증한다).
//
// **JP-E2E-JWT-FIDELITY 이후**: 인증 헤더를 벗기지 않는다.
// 앱이 보내는 프로덕션 anon JWT 는 로컬 키로 검증할 수 없으므로(그리고 프로덕션 서명 재료를
// 로컬에 복사하는 것은 금지다), 경계에서 **로컬 서명 토큰으로 치환**한다.
// 롤 의미(anon)는 그대로 보존되고, 서명 검증·롤 해석·GRANT/RLS 강제는 전부 실제로 일어난다.
export async function routeSupabase(context, restBase, localToken) {
  if (!localToken) throw new Error('routeSupabase: 로컬 서명 토큰이 필요하다 — 인증을 우회하지 않는다.');
  await context.route(`${SUPABASE_HOST}/rest/v1/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = restBase + u.pathname.replace(/^\/rest\/v1/, '') + u.search;
    const headers = { ...req.headers() };
    delete headers.host; delete headers.origin; delete headers.referer;
    // 벗기지 않고 **치환**한다. 프로덕션 토큰은 로컬로 넘어가지 않는다.
    for (const k of ['authorization', 'Authorization', 'apikey', 'apiKey']) delete headers[k];
    headers.authorization = `Bearer ${localToken}`;
    headers.apikey = localToken;
    try {
      const r = await fetch(target, { method: req.method(), headers, body: req.postData() || undefined });
      const body = await r.text();
      await route.fulfill({
        status: r.status,
        headers: {
          'content-type': r.headers.get('content-type') || 'application/json',
          'content-range': r.headers.get('content-range') || '',
          'access-control-allow-origin': '*',
        },
        body,
      });
    } catch (e) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: String(e) }) });
    }
  });
  // auth: 게스트 플레이만 검증하므로 세션 없음으로 응답한다.
  await context.route(`${SUPABASE_HOST}/auth/v1/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // realtime: 이 게이트에서는 연결하지 않는다(폴링 경로로 진행).
  await context.route(`${SUPABASE_HOST}/realtime/v1/**`, (route) => route.abort());
}

// 테스트 DB 초기화는 **환경 구성**이다 — 앱 권한 경로가 아니라 관리자 경로로 한다.
// (목표 GRANT 에서 rooms DELETE 는 클라이언트 롤에 없다. 그걸 우회하려고 권한을 열지 않는다.)
export function resetDb() {
  execFileSync('psql', [ADMIN_URI(), '-q', '-v', 'ON_ERROR_STOP=1', '-c',
    'truncate table public.participants, public.rooms cascade;'], { env: PG_ENV() });
}

export const dbRooms = (restBase, token) =>
  fetch(`${restBase}/rooms?select=*`, { headers: authHeaders(token) }).then((r) => r.json());
export const dbParticipants = (restBase, token) =>
  fetch(`${restBase}/participants?select=*`, { headers: authHeaders(token) }).then((r) => r.json());
export const authHeaders = (token) =>
  token ? { apikey: token, authorization: `Bearer ${token}` } : {};
