import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { DEVICES, buildProbePage } from './harness/lobby-role-layout.mjs';

const execFileP = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const html = () => readFileSync(join(ROOT, 'index.html'), 'utf8');

// ════════════════════════════════════════════════════════════════════════════
// Build39 UI — 대기실(screenLobby) 역할별 컴팩트 레이아웃.
//
// 승인된 사양(CEO, Section B/C/O):
//   · ID/방코드 중복 row 제거 → 방 코드는 검은 진행 카드 안으로
//   · HOST   : 술래 숫자 selector 노출 + 사용 가능
//   · PARTICIPANT : 술래 숫자 row 를 **레이아웃 흐름에서 제거**
//                   (visibility:hidden 금지 / 투명 placeholder 금지 / 빈 공간 예약 금지)
//                   → 검은 카드와 참가자 목록이 host 보다 측정 가능하게 위로 올라와야 한다
//   · 흰 오방색 패널이 화면 바닥까지 연속 — 아래에 분홍/크림 띠가 드러나면 안 된다
//
// ⚠️ 공허성 방지: 측정값이 0 이면 "요소를 못 찾았다"와 "제거됐다"가 구분되지 않는다.
//    호스트 쪽 기준선이 실제로 0 보다 큰지를 먼저 단언한 뒤에만 참가자 쪽 0 을 단언한다.
// ════════════════════════════════════════════════════════════════════════════

let server, rows = [];

async function measure() {
  const probePath = join(ROOT, '_lobbyrole.probe.html');
  await writeFile(probePath, buildProbePage(DEVICES), 'utf8');
  try {
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
    server = createServer(async (req, res) => {
      const p = decodeURIComponent((req.url || '/').split('?')[0]);
      try {
        const buf = await readFile(join(ROOT, p === '/' ? 'index.html' : p.slice(1)));
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        res.end(buf);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { stdout } = await execFileP(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=120000', '--window-size=1200,900', '--dump-dom',
      `http://127.0.0.1:${server.address().port}/_lobbyrole.probe.html`], { maxBuffer: 64 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout);
    if (!m) throw new Error('probe produced no RESULTS');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return dec(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally {
    if (server) { await new Promise(r => server.close(r)); server = null; }
    await unlink(probePath).catch(() => {});
  }
}

const pair = (dev) => ({
  host: rows.find(r => r.dev === dev && r.role === 'host'),
  part: rows.find(r => r.dev === dev && r.role === 'participant'),
});

beforeAll(async () => { if (hasChrome) rows = await measure(); }, 180000);
afterAll(async () => { if (server) await new Promise(r => server.close(r)); });

// ─── 소스 계약 (Chrome 없이도 성립) ────────────────────────────────────────
describe('Build39 UI — 대기실 소스 계약', () => {
  it('[RED-1] ID/방코드 중복 row 가 screenLobby 에서 제거되어야 한다', () => {
    const src = html();
    const lobby = src.slice(src.indexOf('id="screenLobby"'), src.indexOf('id="screenReady"'));
    expect(lobby.includes('lobbyRoomCodeLine'),
      'screenLobby 에 방 코드 줄(lobbyRoomCodeLine)이 남아 있다').toBe(false);
    expect(lobby.includes('lobbyIdentityName'),
      'screenLobby 에 닉네임/역할 줄(lobbyIdentityName)이 남아 있다').toBe(false);
  });

  it('[RED-2] 방 코드가 검은 진행 카드 렌더러에서 나와야 한다 (대기실 변형)', () => {
    const src = html();
    const s = src.indexOf('function renderRoundProgressCards()');
    const body = src.slice(s, src.indexOf('function setGuideText', s));
    expect(s, 'renderRoundProgressCards 를 찾지 못했다').toBeGreaterThan(0);
    expect(body.includes('screenLobby'),
      '렌더러가 screenLobby 변형을 구분하지 않는다 — 방 코드가 검은 카드에 들어가지 않는다').toBe(true);
  });

  it('[RED-3] renderLobby 가 술래 숫자 row 를 host 역할로 게이팅해야 한다', () => {
    const src = html();
    const s = src.indexOf('function renderLobby()');
    const body = src.slice(s, src.indexOf('async function markReadyFromLobby', s));
    expect(s, 'renderLobby 를 찾지 못했다').toBeGreaterThan(0);
    const m = /loserBox[\s\S]{0,200}?classList/.exec(body);
    expect(m, 'renderLobby 안에서 loserBox 제어 코드를 찾지 못했다').toBeTruthy();
    // 무조건 remove("hidden") 이면 참가자에게도 보인다 = 결함.
    expect(/loserBox\.classList\.remove\("hidden"\)\s*;/.test(body) &&
           !/isLoserCountEditable\(\)|role === "host"|role !== "host"/.test(m[0] + body.slice(body.indexOf('loserBox'), body.indexOf('loserBox') + 300)),
      'loserBox 가 역할과 무관하게 항상 노출된다').toBe(false);
  });

  it('[RED-3b] 술래 숫자 편집 가능 여부가 isLoserCountEditable() 로 결정된다', () => {
    const src = html();
    const s = src.indexOf('function updateLoserCountDropdown()');
    expect(s, 'updateLoserCountDropdown 를 찾지 못했다').toBeGreaterThan(0);
    const body = src.slice(s, s + 2400);
    expect(body.includes('isLoserCountEditable()'),
      'select 활성화가 isLoserCountEditable() 을 근거로 하지 않는다').toBe(true);
  });

  it('전제(공허성 가드): 대상 요소들이 실제로 존재한다', () => {
    const src = html();
    expect(src.includes('id="lobbyLoserCountBox"')).toBe(true);
    expect(src.includes('id="lobbyParticipantList"')).toBe(true);
    expect(src.includes('data-round-progress')).toBe(true);
  });
});

// ─── geometry 계측 ─────────────────────────────────────────────────────────
describe.skipIf(!hasChrome)('Build39 UI — 역할별 geometry', () => {
  it('전제: 두 역할 × 기기 조합이 모두 계측됐다', () => {
    expect(rows.length).toBe(DEVICES.length * 2);
    rows.forEach(r => expect(r.err, `${r.dev}/${r.role} 계측 실패: ${r.err}`).toBeUndefined());
  });

  for (const d of DEVICES) {
    it(`[HOST] ${d.name} — 술래 숫자 selector 가 보이고 사용 가능하다`, () => {
      const { host } = pair(d.name);
      expect(host.loserFlow.total, 'host 에서 술래 row 가 높이를 차지하지 않는다').toBeGreaterThan(30);
      expect(host.loserVis.visH, 'host 에서 술래 row 가 화면에 보이지 않는다').toBeGreaterThan(20);
      expect(host.selectUsable.present).toBe(true);
      expect(host.selectUsable.display, 'select 가 렌더되지 않는다').not.toBe('none');
      expect(host.selectUsable.h, 'select 가 터치 가능한 높이가 아니다').toBeGreaterThanOrEqual(30);
    });

    it(`[RED-4][PARTICIPANT] ${d.name} — 술래 row 가 레이아웃 흐름에서 완전히 제거된다`, () => {
      const { host, part } = pair(d.name);
      // 공허성 가드: host 기준선이 0 이면 이 단언은 의미가 없다.
      expect(host.loserFlow.total, '공허성 가드: host 기준선이 0 이다').toBeGreaterThan(30);
      expect(part.loserFlow.offsetH, 'participant 에서 술래 row 가 높이를 예약하고 있다').toBe(0);
      expect(part.loserFlow.marginTop + part.loserFlow.marginBottom,
        'participant 에서 술래 row 의 margin 이 남아 있다(빈 공간 예약)').toBe(0);
      expect(part.loserFlow.total, 'participant 술래 row 총 점유가 0 이 아니다').toBe(0);
      expect(part.loserVis.visH, 'participant 에서 술래 row 가 화면에 보인다').toBe(0);
    });

    it(`[RED-5][PARTICIPANT] ${d.name} — 검은 카드가 host 보다 위로 올라온다`, () => {
      const { host, part } = pair(d.name);
      expect(host.blackCard.natH, '공허성 가드: 검은 카드 높이가 0 이다').toBeGreaterThan(0);
      expect(part.blackCard.top,
        `participant 검은 카드가 host 보다 위에 있지 않다 (host=${host.blackCard.top} part=${part.blackCard.top})`)
        .toBeLessThan(host.blackCard.top);
    });

    it(`[RED-6][PARTICIPANT] ${d.name} — 참가자 목록이 host 보다 위로 올라온다`, () => {
      const { host, part } = pair(d.name);
      expect(host.plist.natH, '공허성 가드: 참가자 목록 높이가 0 이다').toBeGreaterThan(0);
      expect(part.plist.top,
        `participant 목록이 host 보다 위에 있지 않다 (host=${host.plist.top} part=${part.plist.top})`)
        .toBeLessThan(host.plist.top);
    });

    it(`[RED-7] ${d.name} — 방 코드가 검은 카드 안에 표시된다`, () => {
      const { host, part } = pair(d.name);
      for (const r of [host, part]) {
        expect(r.blackCardText.length, `${r.role}: 검은 카드가 비어 있다`).toBeGreaterThan(0);
        expect(/[A-Z0-9]{4}/.test(r.blackCardText) || r.blackCardText.includes('----'),
          `${r.role}: 검은 카드에 방 코드가 없다 — "${r.blackCardText}"`).toBe(true);
      }
    });

    it(`[RED-8] ${d.name} — 흰 오방색 패널이 화면 바닥까지 닿는다`, () => {
      const { host, part } = pair(d.name);
      for (const r of [host, part]) {
        expect(r.surface.gapToViewport,
          `${r.role}: 카드 아래에 ${r.surface.gapToViewport}px 의 분홍 배경이 드러난다`)
          .toBeLessThanOrEqual(1);
        expect(r.saekdong.bottom,
          `${r.role}: 색동 스트라이프가 바닥까지 이어지지 않는다`)
          .toBeGreaterThanOrEqual(r.surface.cardBottom - 1);
      }
    });

    it(`${d.name} — 두 역할 모두 세로 오버플로가 없다`, () => {
      const { host, part } = pair(d.name);
      for (const r of [host, part]) {
        expect(r.bodyOverflow, `${r.role}: c-body 가 ${r.bodyOverflow}px 넘친다`).toBeLessThanOrEqual(0);
      }
    });
  }
});
