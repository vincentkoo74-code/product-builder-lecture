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
// (이 슬라이스는 Realtime 전송이 아니라 브라우저 통합을 검증한다 — 앱은 2.6초 폴링으로 진행한다).
export async function routeSupabase(context, restBase) {
  await context.route(`${SUPABASE_HOST}/rest/v1/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = restBase + u.pathname.replace(/^\/rest\/v1/, '') + u.search;
    const headers = { ...req.headers() };
    delete headers.host; delete headers.origin; delete headers.referer;
      // 앱은 **프로덕션 anon JWT** 를 보낸다. 로컬 PostgREST 는 그 서명을 검증할 수 없어
      // "No suitable key or wrong key type" 로 거부한다. 인증 헤더를 벗겨 db-anon-role(anon)
      // 로 처리하게 한다 — 이 슬라이스는 인증이 아니라 브라우저 통합을 검증하고,
      // 프로덕션 RLS 가 현재 allow-all 이라 anon 권한이 게스트 플레이와 동등하다.
      for (const k of ['authorization','Authorization','apikey','apiKey']) delete headers[k];
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
  // realtime: 이 슬라이스에서는 연결하지 않는다(폴링 경로로 진행).
  await context.route(`${SUPABASE_HOST}/realtime/v1/**`, (route) => route.abort());
}

export async function resetDb(restBase) {
  for (const t of ['participants', 'rooms']) {
    await fetch(`${restBase}/${t}?id=neq.__none__`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
}
export const dbRooms = (restBase) => fetch(`${restBase}/rooms?select=*`).then((r) => r.json());
export const dbParticipants = (restBase) => fetch(`${restBase}/participants?select=*`).then((r) => r.json());
