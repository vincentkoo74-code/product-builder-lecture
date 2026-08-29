import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { DEVICES, buildProbePage } from './harness/result-replay-screens.mjs';

const execFileP = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const html = () => readFileSync(join(ROOT, 'index.html'), 'utf8');
const section = (id, next) => {
  const src = html();
  return src.slice(src.indexOf(`id="${id}"`), src.indexOf(`id="${next}"`));
};

// ════════════════════════════════════════════════════════════════════════════
// Build39 UI — 최종 결과 / 탈락·재경기 대기 화면 단순화.
//
// 승인된 사양(CEO, Section D/E):
//   최종 결과
//     · "게임 종료! 결과를 확인하세요." 안내 삭제 + 빈 세로 여백도 남기지 않는다
//     · 외부 "라운드 결과" heading 삭제 → 검은 결과 카드 **내부 제목**으로 통합
//     · 게임 승률 보기 + 게임방에서 나가기 를 **같은 가로 행**에, hit target >= 44px
//     · 흰 오방색 패널을 바닥까지 (하단 분홍/크림 split 제거)
//   탈락 / 재경기 대기
//     · 남은 참여자 재게임 진행 중 메시지 유지 / 검은 카드 유지 / 나가기 유지
//     · 중복 설명 제거 / 흰 패널 바닥까지
//
// ⚠️ 공허성 방지: "0" 단언 앞에는 반드시 "원래 0 이 아니었다"를 보장하는 기준선을 둔다.
//    (요소를 못 찾아 0 이 나오는 것과 삭제되어 0 인 것을 구분한다)
// ⚠️ 게임 상태머신 / 결과 판정 / replay 로직은 이 커밋의 대상이 아니다.
// ════════════════════════════════════════════════════════════════════════════

let server, rows = [];

async function measure() {
  const probePath = join(ROOT, '_resultreplay.probe.html');
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
      `http://127.0.0.1:${server.address().port}/_resultreplay.probe.html`], { maxBuffer: 64 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout);
    if (!m) throw new Error('probe produced no RESULTS');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return dec(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally {
    if (server) { await new Promise(r => server.close(r)); server = null; }
    await unlink(probePath).catch(() => {});
  }
}

const pick = (dev, view) => rows.find(r => r.dev === dev && r.view === view);

beforeAll(async () => { if (hasChrome) rows = await measure(); }, 180000);
afterAll(async () => { if (server) await new Promise(r => server.close(r)); });

// ─── 소스 계약 ─────────────────────────────────────────────────────────────
describe('Build39 UI — 결과/대기 화면 소스 계약', () => {
  it('[RED-A1] 최종 결과에서 guide.gameOver 안내를 렌더하지 않는다', () => {
    const src = html();
    const s = src.indexOf('const guideMsg = caseType === "draw"');
    expect(s, 'guideMsg 계산부를 찾지 못했다').toBeGreaterThan(0);
    const block = src.slice(s, src.indexOf('setGuideText("roundResultGuide"', s) + 60);
    expect(block.includes('t("guide.gameOver")'),
      '술래 확정(gameOver) 상태에서 "게임 종료! 결과를 확인하세요." 안내가 여전히 렌더된다').toBe(false);
  });

  it('[RED-A2] screenRoundResult 에 외부 "라운드 결과" heading 이 없다', () => {
    const s = section('screenRoundResult', 'screenWinnerWait');
    expect(/<h3[^>]*data-i18n="result\.roundResultsH3"/.test(s),
      'c-body 바깥 제목 <h3>라운드 결과</h3> 가 남아 있다').toBe(false);
  });

  it('[RED-A3] 검은 진행 카드 렌더러가 결과 카드 제목을 담는다', () => {
    const src = html();
    const s = src.indexOf('function renderRoundProgressCards()');
    const body = src.slice(s, src.indexOf('function setGuideText', s));
    expect(body.includes('result.roundResultsH3'),
      '"라운드 결과" 가 검은 카드 내부 제목으로 통합되지 않았다').toBe(true);
  });

  it('[RED-A4] 나가기 버튼이 최종 결과 버튼 그룹 안에서 함께 배치된다', () => {
    const src = html();
    const s = src.indexOf('finalBtns.innerHTML = html;');
    expect(s, 'finalBtns.innerHTML 대입부를 찾지 못했다').toBeGreaterThan(0);
    const block = src.slice(src.indexOf('let html = "";', s - 3000), s);
    expect(block.includes('common.leaveRoomShort'),
      '게임방에서 나가기 가 finalResultBtns 그룹에 포함되지 않아 별도 행으로 밀린다').toBe(true);
  });

  it('[RED-B1] winnerWait 의 중복 설명 문단이 제거됐다', () => {
    const s = section('screenWinnerWait', 'screenStats');
    expect(s.includes('winnerWait.message'),
      '"이번 재게임에서는 빠지고…" 설명이 hint 와 중복으로 남아 있다').toBe(false);
    // 핵심 메시지는 유지되어야 한다 — 삭제 과잉 방지 대조군.
    expect(s.includes('winnerWait.hint'),
      '남은 참여자 재게임 진행 중 메시지가 사라졌다(과잉 삭제)').toBe(true);
  });

  it('[RED-B2] 결과/대기 3화면에 card-flush-bottom 이 적용됐다', () => {
    const src = html();
    for (const id of ['screenRoundResult', 'screenWinnerWait', 'screenLoserWait']) {
      const tag = new RegExp(`<section class="[^"]*" id="${id}">`).exec(src)
               || new RegExp(`<section class="[^"]*card-flush-bottom[^"]*" id="${id}">`).exec(src);
      const line = src.slice(src.lastIndexOf('<section', src.indexOf(`id="${id}"`)), src.indexOf(`id="${id}"`) + 40);
      expect(line.includes('card-flush-bottom'), `${id} 에 card-flush-bottom 이 없다`).toBe(true);
    }
  });

  it('전제(공허성 가드): 유지해야 할 요소들이 존재한다', () => {
    const rr = section('screenRoundResult', 'screenWinnerWait');
    expect(rr.includes('data-round-progress'), '결과 화면 검은 카드가 없다').toBe(true);
    expect(rr.includes('finalResultBtns'), 'finalResultBtns 가 없다').toBe(true);
    const lw = html().slice(html().indexOf('id="screenLoserWait"'));
    expect(lw.includes('data-round-progress'), '탈락 대기 화면 검은 카드가 없다').toBe(true);
  });
});

// ─── geometry ──────────────────────────────────────────────────────────────
describe.skipIf(!hasChrome)('Build39 UI — 결과/대기 화면 geometry', () => {
  it('전제: 모든 화면 × 기기 조합이 계측됐다', () => {
    expect(rows.length).toBe(DEVICES.length * 3);
    rows.forEach(r => expect(r.err, `${r.dev}/${r.view} 계측 실패: ${r.err}`).toBeUndefined());
  });

  for (const d of DEVICES) {
    it(`[RED-A5] ${d.name} — 안내 배너가 세로 공간을 남기지 않는다`, () => {
      const r = pick(d.name, 'finalResult');
      expect(r.guide.exists, '공허성 가드: roundResultGuide 요소 자체가 없다').toBe(true);
      expect(r.guide.total,
        `안내 배너가 ${r.guide.total}px 를 차지한다 (text="${r.guideText}")`).toBe(0);
    });

    it(`[RED-A6] ${d.name} — 외부 "라운드 결과" heading 이 공간을 차지하지 않는다`, () => {
      const r = pick(d.name, 'finalResult');
      expect(r.outerHeading.total, '외부 heading 이 아직 세로 공간을 차지한다').toBe(0);
    });

    it(`[RED-P1-B40] ${d.name} — 최종 결과 검은 카드에 "술래 숫자 잠김" 안내가 없다`, () => {
      // Build39 필드 스크린샷(IMG_2010): 게임이 끝난 결과 화면 하단에
      // "술래 숫자는 이번 게임이 끝날 때까지 잠겨 있습니다." 가 fade mask 에 걸려 반투명하게 잘렸다.
      // 끝난 게임에서 이 안내는 의미가 없다. 결과 화면 변형(resultHtml)에서만 제거한다.
      const r = pick(d.name, 'finalResult');
      expect(r.blackCard.natH, '공허성 가드: 검은 카드 높이가 0 이다').toBeGreaterThan(0);
      expect(/잠겨 있습니다|변경할 수 있습니다|locked|editable/.test(r.blackCardText),
        `결과 카드에 lock 안내가 남아 있다 — "${r.blackCardText.slice(-60)}"`).toBe(false);
    });

    it(`[대조군-P1] ${d.name} — 대기 화면(winnerWait) 검은 카드에는 lock 안내가 유지된다`, () => {
      // 진행 중 화면에서는 이 안내가 의미가 있으므로 제거되면 안 된다(과잉 삭제 방지).
      const r = pick(d.name, 'winnerWait');
      expect(r.blackCard.natH, '공허성 가드').toBeGreaterThan(0);
      expect(/잠겨 있습니다|변경할 수 있습니다/.test(r.blackCardText),
        '대기 화면에서 lock 안내가 사라졌다 — 결과 화면에만 한정해야 한다').toBe(true);
    });

    it(`[RED-A7] ${d.name} — 검은 카드가 "라운드 결과" 제목을 품는다`, () => {
      const r = pick(d.name, 'finalResult');
      expect(r.blackCard.natH, '공허성 가드: 검은 카드 높이가 0 이다').toBeGreaterThan(0);
      expect(/라운드 결과|Round results|ラウンド結果/.test(r.blackCardText),
        `검은 카드에 제목이 없다 — "${r.blackCardText.slice(0, 60)}"`).toBe(true);
    });

    it(`[RED-A8] ${d.name} — 승률 보기 + 나가기가 같은 행이고 44px 이상이다`, () => {
      const r = pick(d.name, 'finalResult');
      expect(r.buttons.length, '공허성 가드: 하단 버튼이 하나도 계측되지 않았다').toBeGreaterThan(0);
      const stats = r.buttons.find(b => /승률|Stats|勝率/.test(b.text));
      const leave = r.buttons.find(b => /나가기|Leave|退出/.test(b.text));
      expect(stats, `승률 보기 버튼을 찾지 못했다 — ${JSON.stringify(r.buttons)}`).toBeTruthy();
      expect(leave, `나가기 버튼을 찾지 못했다 — ${JSON.stringify(r.buttons)}`).toBeTruthy();
      expect(Math.abs(stats.top - leave.top),
        `두 버튼이 다른 행에 있다 (승률 top=${stats.top}, 나가기 top=${leave.top})`).toBeLessThanOrEqual(2);
      expect(stats.h, '승률 보기 hit target 이 44px 미만').toBeGreaterThanOrEqual(44);
      expect(leave.h, '나가기 hit target 이 44px 미만').toBeGreaterThanOrEqual(44);
    });

    for (const view of ['finalResult', 'winnerWait', 'loserWait']) {
      it(`[RED-A9/B3] ${d.name}/${view} — 흰 오방색 패널이 바닥까지 닿는다`, () => {
        const r = pick(d.name, view);
        expect(r.surface.gapToViewport,
          `카드 아래에 ${r.surface.gapToViewport}px 의 분홍 배경이 드러난다`).toBeLessThanOrEqual(1);
        expect(r.saekdong.bottom,
          '색동 스트라이프가 바닥까지 이어지지 않는다').toBeGreaterThanOrEqual(r.surface.cardBottom - 1);
      });
    }

    it(`[RED-B4] ${d.name} — winnerWait 에 중복 설명 문단이 없다`, () => {
      const r = pick(d.name, 'winnerWait');
      expect(r.heroText.length, '공허성 가드: hero 가 비어 있다').toBeGreaterThan(0);
      expect(r.paras.length,
        `설명 문단이 ${r.paras.length}개 남아 있다 — ${JSON.stringify(r.paras.map(p => p.text))}`)
        .toBeLessThanOrEqual(1);
      expect(/재게임|remaining|再ゲーム/.test(r.heroText),
        '남은 참여자 재게임 진행 중 메시지가 사라졌다').toBe(true);
    });

    it(`${d.name} — 세 화면 모두 화면 밖으로 밀리지 않는다`, () => {
      // .c-body 는 설계상 스크롤 컨테이너(참가자 목록)이므로 그 오버플로는 정상이다.
      // 계약은 카드 전체가 뷰포트를 넘지 않고 하단 버튼이 화면 안에 있는가다.
      for (const view of ['finalResult', 'winnerWait', 'loserWait']) {
        const r = pick(d.name, view);
        expect(r.appOverflow, `${view}: .app 이 ${r.appOverflow}px 넘친다`).toBeLessThanOrEqual(0);
        expect(r.footVisible.withinViewport,
          `${view}: 하단 버튼 영역이 화면 밖(bottom=${r.footVisible.bottom})에 있다`).toBe(true);
      }
    });
  }
});
