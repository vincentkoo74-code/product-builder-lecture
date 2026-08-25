import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { DEVICES, LOCALES, CORE, buildProbePage } from './harness/home-device-matrix.mjs';

const execFileP = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);

// ════════════════════════════════════════════════════════════════════════════
// A5 — Home 핵심 기능 first-viewport 노출: device matrix RED
//
// 제품 계약(Build37): 주요 iPhone 전 기종 × ko/en/ja 에서 Home 핵심 기능 7종을
// 보기 위해 세로 스크롤이 필요해서는 안 된다. 기기마다 기능이 사라지면 안 된다.
//
//   1 Maru hero            2 닉네임/사용자         3 이전 참가 방 재입장
//   4 이전 게임 결과        5 내 기록/내 전적       6 방 만들기/호스트 시작
//   7 QR 입장
//
// 측정은 가설을 단언하지 않는다. 실제 geometry(hero px / avail / required /
// overflow / 요소별 clip·fade)만 본다. hero 절벽 가설은 별도 관찰 테스트에서
// 분포로만 확인한다.
//
// safe-area는 주입한다(harness 주석 참고). 미주입 측정은 낙관적으로 왜곡된다.
// ════════════════════════════════════════════════════════════════════════════

let server, rows = [];

async function measure() {
  const probePath = join(ROOT, '_a5probe.test.html');
  await writeFile(probePath, buildProbePage(DEVICES, LOCALES, CORE), 'utf8');
  try {
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg' };
    server = createServer(async (req, res) => {
      const p = decodeURIComponent((req.url || '/').split('?')[0]);
      try {
        const buf = await readFile(join(ROOT, p === '/' ? 'index.html' : p.slice(1)));
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        res.end(buf);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const { stdout } = await execFileP(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=300000',
      '--window-size=1400,1100', '--dump-dom',
      `http://127.0.0.1:${port}/_a5probe.test.html`,
    ], { maxBuffer: 128 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout);
    if (!m) throw new Error('probe produced no RESULTS');
    const decode = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return decode(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally {
    await unlink(probePath).catch(() => {});
  }
}

beforeAll(async () => { if (hasChrome) rows = await measure(); }, 600000);
afterAll(() => { if (server) server.close(); });

const suite = hasChrome ? describe : describe.skip;
const injected = () => rows.filter(r => r.safe && !r.err && !r.sweep);
const bare = () => rows.filter(r => !r.safe && !r.err && !r.sweep);
const sweep = () => rows.filter(r => r.sweep && !r.err);
const tag = r => `${r.dev}(${r.w}×${r.h})/${r.loc}`;

suite('A5 — Home device matrix (실기기 safe-area 주입)', () => {
  // ── 공허성 가드 ───────────────────────────────────────────────────────────
  it('[가드] 6기기 × 3로케일 × safe(on/off) = 36행이 오류 없이 측정됐다', () => {
    expect(rows.filter(r => r.err).map(r => `${r.dev || r.h}/${r.loc}/${r.safe}:${r.err}`)).toEqual([]);
    expect(injected().length + bare().length).toBe(DEVICES.length * LOCALES.length * 2);
    expect(sweep().length, 'hero 연속성 스윕 행 수').toBe(41);   // 560..960 step 10
  });

  it('[가드] 핵심 7종 선택자가 모두 실제 DOM에 매칭됐다', () => {
    const missing = rows.flatMap(r => (r.clipped || []).filter(c => c.endsWith('MISSING')).map(c => `${tag(r)} ${c}`));
    expect(missing, '선택자가 어긋나면 나머지 결과가 통째로 무의미하다').toEqual([]);
  });

  it('[가드] ko/en/ja가 실제로 서로 다른 문자열로 렌더됐다 (로케일 미적용 공허 방지)', () => {
    const byLoc = Object.fromEntries(LOCALES.map(l => [l, new Set(injected().filter(r => r.loc === l).map(r => r.probeText))]));
    for (const l of LOCALES) expect([...byLoc[l]].filter(Boolean).length, `${l} 텍스트 없음`).toBeGreaterThan(0);
    const reps = LOCALES.map(l => [...byLoc[l]][0]);
    expect(new Set(reps).size, `locale별 대표 문자열 ${JSON.stringify(reps)}`).toBe(LOCALES.length);
  });

  it('[가드] safe-area 주입이 실제로 레이아웃을 바꿨다', () => {
    const pairs = injected().map(r => {
      const b = bare().find(x => x.dev === r.dev && x.loc === r.loc);
      return { t: tag(r), padB: [r.padB, b && b.padB], fade: [r.fadePx, b && b.fadePx] };
    });
    const changed = pairs.filter(p => p.padB[0] !== p.padB[1] || p.fade[0] !== p.fade[1]);
    expect(changed.length, `주입 전후가 동일한 조합만 있으면 주입이 무효다: ${JSON.stringify(pairs.slice(0, 3))}`).toBeGreaterThan(0);
  });

  // ── RED: 핵심 계약 ────────────────────────────────────────────────────────
  it('[RED] 핵심 기능을 보기 위해 c-body 세로 스크롤이 필요하면 안 된다', () => {
    const bad = injected().filter(r => r.overflow > 0).map(r =>
      `${tag(r)} overflow=${r.overflow}px (hero=${r.hero}, avail=${r.avail}, required=${r.required})`);
    expect(bad, `스크롤 필요 ${bad.length}/${injected().length}건`).toEqual([]);
  });

  it('[RED] 핵심 7종 중 어떤 것도 first viewport 밖으로 잘리면 안 된다', () => {
    const bad = injected().filter(r => r.clipped.length).map(r => `${tag(r)} → ${r.clipped.join(', ')}`);
    expect(bad, `잘린 조합 ${bad.length}/${injected().length}건`).toEqual([]);
  });

  it('[RED] 핵심 7종이 하단 mask fade로 흐려지면 안 된다 (alpha ≥ 0.80)', () => {
    // .app 하단 fade(= max(62px, safeBottom+34px))와 c-body fade(14px)가 곱해진
    // 요소 하단 edge alpha. 이진 판정이 아니라 실제 감쇠량으로 본다.
    const bad = injected().filter(r => r.faded.length).map(r => `${tag(r)} → ${r.faded.join(', ')}`);
    expect(bad, `눈에 띄게 흐려진 조합 ${bad.length}/${injected().length}건`).toEqual([]);
  });

  it('[RED] quick action 3종이 모든 기기에서 온전히 노출된다 (CTA만 남으면 FAIL)', () => {
    const QUICK = ['recentRoom', 'lastResult', 'myStats'];
    const bad = injected().flatMap(r => QUICK
      .filter(k => r.items[k]?.missing || r.items[k]?.clipped > 0 || r.items[k]?.alpha < 0.80)
      .map(k => `${tag(r)} ${k}`));
    expect(bad, `quick action 손실 ${bad.length}건`).toEqual([]);
  });

  it('[RED] hero 높이가 viewport에 따라 연속적이어야 한다 (계단식 절벽 금지)', () => {
    // 기기 표본이 아니라 10px 간격 높이 스윕으로 잰다. 표본 사이가 비어 있으면
    // 연속 함수도 계단으로 보이고, 반대로 계단도 표본 위치에 따라 숨는다.
    const pts = sweep().sort((a, b) => a.h - b.h);
    let worst = { jump: 0 };
    for (let i = 1; i < pts.length; i++) {
      const jump = Math.abs(pts[i].hero - pts[i - 1].hero);
      if (jump > worst.jump) worst = { jump, from: pts[i - 1], to: pts[i] };
    }
    expect(worst.jump,
      `viewport 10px 변화에 hero가 ${worst.jump}px 점프 ` +
      `(h=${worst.from?.h}:${worst.from?.hero} → h=${worst.to?.h}:${worst.to?.hero})`)
      .toBeLessThanOrEqual(16);
  });

  it('[증적] hero 스윕 곡선', () => {
    const pts = sweep().sort((a, b) => a.h - b.h);
    console.log('\n── hero(viewport height) 곡선 · 393px 폭 · safe 47/34 ──\n' +
      pts.map(p => `h=${p.h}  hero=${p.hero}`).join('\n'));
    expect(pts.length).toBeGreaterThan(0);
  });

  // ── 디자인 정체성 계약 ────────────────────────────────────────────────────
  it('[계약] tap target 44px 이상', () => {
    const bad = injected().flatMap(r => r.smallTap.map(s => `${tag(r)} ${s}`));
    expect(bad, 'hit target 위반').toEqual([]);
  });

  it('[계약] 텍스트/아이콘 과도한 축소 금지 (label ≥ 11px, icon ≥ 14px)', () => {
    const bad = injected().filter(r => r.labelFont < 11 || r.iconFont < 14)
      .map(r => `${tag(r)} label=${r.labelFont} icon=${r.iconFont}`);
    expect(bad, '축소 위반').toEqual([]);
  });

  it('[계약] hero 비율 왜곡 금지 (정사각 1:1 유지)', () => {
    const bad = injected().filter(r => r.hero > 0 && Math.abs(r.heroRatio - 1) > 0.02)
      .map(r => `${tag(r)} ${r.heroW}×${r.hero} ratio=${r.heroRatio}`);
    expect(bad, 'hero 왜곡').toEqual([]);
  });

  it('[계약] ko/en/ja가 동일 기기에서 동일한 기능 집합을 노출한다', () => {
    const bad = [];
    for (const d of DEVICES) {
      const set = LOCALES.map(l => {
        const r = injected().find(x => x.dev === d.name && x.loc === l);
        return r ? CORE.filter(c => !r.items[c.key]?.missing && !(r.items[c.key]?.clipped > 0)).map(c => c.key).join('|') : 'NA';
      });
      if (new Set(set).size > 1) bad.push(`${d.name}: ${LOCALES.map((l, i) => `${l}=[${set[i]}]`).join(' ')}`);
    }
    expect(bad, 'locale 간 노출 기능 불일치').toEqual([]);
  });

  // ── 증적 ─────────────────────────────────────────────────────────────────
  it('[증적] safe-area 주입이 실제로 레이아웃을 바꾼다 (계측이 무력화되지 않았다)', () => {
    // Phase A에서는 "주입이 더 많은 위반을 드러낸다"로 이 성질을 확인했다. 수정 후에는
    // 양쪽 다 위반 0이라 그 비교가 성립하지 않는다. 대신 주입이 살아 있다는 것을
    // 직접 잰다: safe-area가 있는 기기는 주입 시 세로 예산이 줄어 hero가 더 작아야 한다.
    // 이 단언이 깨지면 주입이 no-op이 된 것이고, 그 순간 나머지 측정이 전부 공허해진다.
    const withInset = DEVICES.filter(d => d.top + d.bottom > 36).map(d => d.name);
    expect(withInset.length, 'safe-area 있는 기기가 없다').toBeGreaterThan(0);
    // 어느 값이 움직이는지는 기기가 clamp의 어느 구간에 있느냐로 갈린다:
    //   선형 구간(844/852/896) — hero가 safe-area를 그대로 흡수한다. 그래서 c-body
    //     예산(avail)은 기기가 달라도 177.8px로 일정하다. 이건 설계 결과이지 계측 실패가 아니다.
    //   clamp 상한(956) — hero가 320px에 고정되므로 흡수하지 못하고 avail이 줄어든다.
    // 따라서 "둘 중 하나는 반드시 움직인다"가 주입 생존을 재는 정확한 조건이다.
    // 어느 쪽도 안 움직이면 주입이 no-op이 된 것이고, 그 순간 나머지 측정이 전부 공허해진다.
    const bad = [], moved = { hero: [], avail: [] };
    for (const name of withInset) {
      const i = injected().find(r => r.dev === name && r.loc === 'ko');
      const b = bare().find(r => r.dev === name && r.loc === 'ko');
      if (i.hero > b.hero) bad.push(`${name} hero가 주입 시 오히려 커졌다 ${b.hero}→${i.hero}`);
      if (i.avail > b.avail) bad.push(`${name} avail이 주입 시 오히려 늘었다 ${b.avail}→${i.avail}`);
      if (i.hero === b.hero && i.avail === b.avail) {
        bad.push(`${name} hero·avail 모두 불변 (hero ${i.hero}, avail ${i.avail}) — 주입 무효`);
      }
      if (i.hero < b.hero) moved.hero.push(name);
      if (i.avail < b.avail) moved.avail.push(name);
    }
    expect(bad, '주입이 레이아웃 계산에 반영되지 않는다').toEqual([]);
    // 두 흡수 구간이 실제로 각각 관측됐는지도 확인한다(한쪽만 보면 절반이 공허해진다).
    expect(moved.hero, 'hero가 safe-area를 흡수하는 기기가 없다').not.toEqual([]);
    expect(moved.avail, 'clamp 상한에서 avail이 줄어드는 기기가 없다').not.toEqual([]);

    const sev = list => list.reduce((n, r) =>
      n + Math.max(0, r.overflow) + r.clipped.reduce((m, c) => m + (parseFloat(c.split(':')[1]) || 0), 0), 0);
    console.log(`\n── safe-area 주입 대조 ──\n위반 총량 주입 ${sev(injected())}px / 미주입 ${sev(bare())}px\n` +
      injected().map(r => {
        const b = bare().find(x => x.dev === r.dev && x.loc === r.loc);
        return `${tag(r).padEnd(24)} hero ${String(b.hero).padStart(4)} → ${String(r.hero).padStart(4)}   ` +
               `avail ${String(b.avail).padStart(6)} → ${String(r.avail).padStart(6)}   ovf ${b.overflow} → ${r.overflow}`;
      }).join('\n'));
  });

  it('[증적] 기기×로케일 geometry 표를 출력한다', () => {
    const line = r => [
      tag(r).padEnd(24), `safe=${r.safeTop}/${r.safeBottom}`.padEnd(12),
      `hero=${String(r.hero).padStart(5)}`, `avail=${String(r.avail).padStart(6)}`,
      `req=${String(r.required).padStart(5)}`, `ovf=${String(r.overflow).padStart(4)}`,
      `appOvf=${String(r.appOverflow).padStart(4)}`,
      `clip=[${r.clipped.join(',')}]`, `fade=[${r.faded.join(',')}]`, `dim=[${r.dim.join(',')}]`,
    ].join(' ');
    console.log('\n── A5 geometry (safe-area 주입) ──\n' + injected().map(line).join('\n'));
    console.log('\n── A5 geometry (미주입 / iframe env=0) ──\n' + bare().map(line).join('\n'));
    expect(injected().length).toBe(DEVICES.length * LOCALES.length);
  });
});
