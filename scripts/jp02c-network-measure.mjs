// JP-02C §8/§10 — BEFORE(정적 <link>) vs AFTER(로케일 주입) 네트워크 실측.
// BEFORE 는 현재 index.html 에서 주입 스크립트를 원래의 정적 <link> 3종으로 되돌려 만든다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = process.argv[2];
const REPS = Number(process.argv[3] || 3);
const GOOGLE = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const current = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STATIC_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Gowun+Dodum&family=Noto+Sans+KR:wght@400;500;700;900&family=Inter:wght@400;500;700;900&family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">`;
const s0 = current.indexOf('<!-- JP-02C:');
const e0 = current.indexOf('</script>', s0) + '</script>'.length;
if (s0 < 0) throw new Error('주입 블록을 찾지 못했다');
const baseline = current.slice(0, s0) + STATIC_LINKS + current.slice(e0);
if (!baseline.includes('Black+Han+Sans') || baseline.includes('JP-02C:')) throw new Error('BEFORE 재구성 실패');

function serve(rootDir, indexHtml) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(indexHtml); }
    try {
      const f = readFileSync(path.join(rootDir, p));
      const ext = path.extname(p);
      res.writeHead(200, { 'content-type': ext === '.ttf' ? 'font/ttf' : ext === '.css' ? 'text/css'
        : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(f);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function run(_unused, html, locale, label) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, url } = await serve(ROOT, html);
  const host = new URL(url).host;
  const rows = [];
  for (let i = 0; i < REPS; i++) {
    const ctx = await browser.newContext({ locale, viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    const g = [], lf = [], gReq = [];
    // 동기 카운터. response 리스너가 async 라 놓치는 경우와 대조한다.
    page.on('request', (r) => { const h = new URL(r.url()).host; if (GOOGLE.includes(h)) gReq.push(h); });
    page.on('response', async (r) => {
      const u = new URL(r.url());
      let bytes = Number(r.headers()['content-length'] || 0);
      if (!bytes) { try { bytes = (await r.body()).length; } catch { bytes = 0; } }
      if (GOOGLE.includes(u.host)) g.push({ host: u.host, bytes });
      else if (u.host === host && /\.(ttf|otf|woff2?)$/i.test(u.pathname)) lf.push({ file: u.pathname, bytes });
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const dcl = Date.now() - t0;
    try { await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 }); } catch {}
    await page.waitForTimeout(1200);
    const fam = await page.evaluate(() => ({
      locale: document.body.getAttribute('data-locale'),
      body: getComputedStyle(document.body).fontFamily,
      googleLinks: [...document.querySelectorAll('link')].filter((l) => /fonts\.g/.test(l.href)).length,
      navLang: navigator.language,
      lsLocale: (() => { try { return localStorage.getItem('rpsLocale'); } catch (e) { return 'ERR'; } })(),
      notoKRLoaded: document.fonts.check('16px "Noto Sans KR"'),
    }));
    rows.push({
      dcl,
      googleapisReq: gReq.filter((h) => h === 'fonts.googleapis.com').length,
      gstaticReq: gReq.filter((h) => h === 'fonts.gstatic.com').length,
      googleapis: g.filter((x) => x.host === 'fonts.googleapis.com').length,
      gstatic: g.filter((x) => x.host === 'fonts.gstatic.com').length,
      googleBytes: g.reduce((a, b) => a + b.bytes, 0),
      localFontReqs: lf.length,
      localFontBytes: lf.reduce((a, b) => a + b.bytes, 0),
      appliedLocale: fam.locale, bodyFamily: fam.body, googleLinks: fam.googleLinks,
      navLang: fam.navLang, lsLocale: fam.lsLocale, notoKRLoaded: fam.notoKRLoaded,
    });
    await ctx.close();
  }
  srv.close();
  await browser.close();
  const med = (k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const out = { label, locale, reps: REPS,
    googleapis: rows.map((r) => r.googleapis), gstatic: rows.map((r) => r.gstatic),
    googleapisReq: rows.map((r) => r.googleapisReq), gstaticReq: rows.map((r) => r.gstaticReq),
    googleBytes_median: med('googleBytes'), googleBytes_all: rows.map((r) => r.googleBytes),
    localFontReqs: rows.map((r) => r.localFontReqs), localFontBytes_median: med('localFontBytes'),
    dcl_all: rows.map((r) => r.dcl), dcl_median: med('dcl'),
    appliedLocale: [...new Set(rows.map((r) => r.appliedLocale))],
    googleLinks: rows.map((r) => r.googleLinks), navLang: [...new Set(rows.map((r) => r.navLang))],
    lsLocale: [...new Set(rows.map((r) => r.lsLocale))], notoKRLoaded: rows.map((r) => r.notoKRLoaded),
    bodyFamily: [...new Set(rows.map((r) => r.bodyFamily))],
  };
  console.log(JSON.stringify(out));
  return out;
}

const results = [];
for (const [locale, tag] of [['ja-JP', 'JA'], ['ko-KR', 'KO']]) {
  results.push(await run(null, baseline, locale, `BEFORE/${tag}`));
  results.push(await run(null, current, locale, `AFTER/${tag}`));
}
console.log('===SUMMARY===');
console.log(JSON.stringify(results, null, 1));
