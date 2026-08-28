import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { DEVICES, buildProbePage } from './harness/host-waiting-room.mjs';

const execFileP = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const html = () => readFileSync(join(ROOT, 'index.html'), 'utf8');
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// P0 — iPhone Host 대기방: c-body 붕괴로 참가자 목록 접근 불가.
//
// 실기기 증상: 방을 만들면 QR 은 보이는데 그 아래 참가자 목록 / 술래 숫자를 쓸 수 없어
//              Host 가 게임을 시작하지 못한다.
//
// 측정으로 확정한 원인:
//   .c-head{flex:0 0 auto}  — QR박스(306px)+벌칙박스+가이드로 541px 까지 자라도 안 줄어든다
//   .c-body{flex:1 1 auto; min-height:0} — 0 까지 수축을 허용한다
//   → 172px 짜리 참가자 목록이 높이 0 컨테이너에 갇힌다. .app 바깥 스크롤도 없다.
//
// ⚠️ 가시성 판정에 rect 단독 사용 금지 — 높이 0 스크롤 컨테이너의 자식도 rect 는 살아 있어
//    "보인다"로 오판한다(1차 진단에서 실제로 그렇게 틀렸다). 모든 overflow 조상과
//    교집합한 effective visible 로만 판정한다.
// ════════════════════════════════════════════════════════════════════════════

let server, rows = [];

async function measure(sourceOverride) {
  const probePath = join(ROOT, '_hostroom.probe.html');
  await writeFile(probePath, buildProbePage(DEVICES), 'utf8');
  const overridePath = join(ROOT, '_hostroom.override.html');
  if (sourceOverride) await writeFile(overridePath, sourceOverride, 'utf8');
  try {
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
    server = createServer(async (req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (sourceOverride && (p === '/index.html' || p === '/')) p = '/_hostroom.override.html';
      try {
        const buf = await readFile(join(ROOT, p === '/' ? 'index.html' : p.slice(1)));
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        res.end(buf);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { stdout } = await execFileP(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
      '--virtual-time-budget=120000', '--window-size=1200,900', '--dump-dom',
      `http://127.0.0.1:${server.address().port}/_hostroom.probe.html`], { maxBuffer: 64 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout);
    if (!m) throw new Error('probe produced no RESULTS');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return dec(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally {
    await unlink(probePath).catch(() => {});
    await unlink(overridePath).catch(() => {});
    if (server) { server.close(); server = null; }
  }
}

beforeAll(async () => { if (hasChrome) rows = await measure(); }, 300000);
afterAll(() => { if (server) server.close(); });

const suite = hasChrome ? describe : describe.skip;
const tag = r => `${r.dev}(${r.w}×${r.h})`;
const MIN_TAP = 44;

suite('P0 — Host 대기방 접근성', () => {
  it('[가드] 3기기가 오류 없이 측정됐다', () => {
    expect(rows.filter(r => r.err).map(r => `${r.dev}:${r.err}`)).toEqual([]);
    expect(rows.length).toBe(DEVICES.length);
  });

  it('[가드] 측정 대상 요소를 실제로 찾았다 (선택자 어긋나면 전부 공허해진다)', () => {
    const missing = [];
    for (const r of rows) {
      for (const k of ['qr', 'code', 'plist', 'loser', 'start', 'penalty', 'home']) {
        if (!r[k]) missing.push(`${tag(r)} ${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('[가드] 벌칙 설정 후 상태를 쟀다 — Start 버튼이 hidden 이 아니다', () => {
    // 이 P0 는 "벌칙 설정 후 게임을 시작하려는 시점"의 문제다. hidden 상태로 재면 공허해진다.
    const stillHidden = rows.filter(r => r.start.hiddenClass).map(tag);
    expect(stillHidden).toEqual([]);
  });

  it('[RED-1] c-body 가 0 으로 붕괴하면 안 된다', () => {
    const bad = rows.filter(r => r.body <= 0)
      .map(r => `${tag(r)} c-body=${r.body} (head=${r.head}, 필요 ${r.bodyReq})`);
    expect(bad, `붕괴 ${bad.length}/${rows.length}건`).toEqual([]);
  });

  it('[RED-2] 참가자 목록이 스크롤로 실제 도달 가능해야 한다', () => {
    // 대기방은 세로 스크롤이 허용된다(Home 의 무스크롤 계약을 적용하지 않는다).
    // 따라서 "at-rest 에 보이는가"가 아니라 "스크롤하면 실제로 드러나는가"가 기능 계약이다.
    // 붕괴 상태에서는 clientHeight 가 0이라 스크롤해도 0 이 나온다 — 그래서 이 판정이 유효하다.
    const bad = rows.filter(r => r.scrolled.plist.visH < MIN_TAP)
      .map(r => `${tag(r)} 스크롤 후 목록 가시높이=${r.scrolled.plist.visH} (자연 ${r.plist.natH})`);
    expect(bad, `도달 불가 ${bad.length}/${rows.length}건`).toEqual([]);
  });


  it('[RED-3] 술래 숫자 선택이 스크롤로 도달 가능해야 한다', () => {
    const bad = rows.filter(r => r.scrolled.loser.visH < MIN_TAP)
      .map(r => `${tag(r)} 스크롤 후 가시높이=${r.scrolled.loser.visH} (자연 ${r.loser.natH})`);
    expect(bad).toEqual([]);
  });

  it('[RED-4] c-body 안의 내용이 스크롤로 도달 가능해야 한다', () => {
    // 붕괴하면 scrollHeight 는 있는데 clientHeight 가 0이라 스크롤 자체가 불가능하다.
    const bad = rows.filter(r => r.bodyReq > r.body && r.body <= 0)
      .map(r => `${tag(r)} 필요 ${r.bodyReq} / 가용 ${r.body} — 스크롤 불가`);
    expect(bad).toEqual([]);
  });

  it('[GREEN 유지] QR 이 스크롤로 도달 가능하다', () => {
    // 이 커밋의 계약은 "c-body 안의 내용에 도달할 수 있는가"다. QR 을 스크롤 영역으로
    // 옮겼으므로 헤더가 아직 큰 지금은 at-rest 에서 일부가 잘릴 수 있다 —
    // 최초 화면 가시성 계약은 헤더를 줄이는 다음 커밋이 도입한다.
    // scrolled 스냅샷은 c-body 를 바닥까지 내린 상태라 상단의 QR 이 빠진다.
    // QR 은 c-body 최상단에 있으므로 at-rest(scrollTop=0)에서 실질적으로 드러나야 한다.
    const bad = rows.filter(r => r.qr.visH < 100)
      .map(r => `${tag(r)} QR 가시높이=${r.qr.visH}`);
    expect(bad, 'QR 도달 불가').toEqual([]);
  });

  it('[GREEN 유지] 방 코드가 존재하고 도달 가능하다', () => {
    const missing = rows.filter(r => r.code.natH <= 0).map(r => `${tag(r)} 방 코드 없음`);
    expect(missing).toEqual([]);
  });

  it('[GREEN 유지] 벌칙 · 게임시작 · 처음으로 가 c-foot 에서 접근 가능하다', () => {
    const bad = [];
    for (const r of rows) {
      for (const k of ['penalty', 'start', 'home']) {
        if (r[k].visH < MIN_TAP) bad.push(`${tag(r)} ${k}=${r[k].visH}`);
      }
    }
    expect(bad, 'hit target 44px 미만').toEqual([]);
  });

  it('[계약] QR 비율이 정사각으로 유지된다', () => {
    const bad = rows.filter(r => r.qrImg && Math.abs(r.qrImg.w - r.qrImg.h) > 2)
      .map(r => `${tag(r)} ${r.qrImg.w}×${r.qrImg.h}`);
    expect(bad).toEqual([]);
  });




  it('[증적] 뷰포트별 geometry', () => {
    console.log('\n── Host 대기방 (safe-area 주입, 벌칙 설정 후) ──\n' + rows.map(r =>
      `${tag(r).padEnd(22)} head=${String(r.head).padStart(6)} body=${String(r.body).padStart(6)}` +
      ` (필요 ${String(r.bodyReq).padStart(4)}, ovf ${String(r.bodyOverflow).padStart(4)}) foot=${String(r.foot).padStart(5)}` +
      `\n${''.padEnd(22)} QR=${String(r.qrImg?r.qrImg.w:0).padStart(4)}px 제목가시=${String(r.heading.visH).padStart(5)}` +
      `  [at-rest] 목록=${String(r.plist.visH).padStart(5)} 술래=${String(r.loser.visH).padStart(5)}` +
      `  [scrolled] 목록=${String(r.scrolled.plist.visH).padStart(5)} 술래=${String(r.scrolled.loser.visH).padStart(5)}`
    ).join('\n'));
    expect(rows.length).toBe(DEVICES.length);
  });
});

suite('P0 — mutation: 구조를 되돌리면 RED 가 재현된다', () => {
  it('[mutation] QR 을 c-head 로 되돌리면 c-body 가 다시 붕괴한다', async () => {
    const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const QR = `      <div class="qr-box" id="qrInviteBox">
        <div class="fake-qr" id="fakeQr"></div>
        <div class="code-text" id="roomCodeText">----</div>
      </div>
      <div id="roomLockedBox" class="maru-notice hidden" style="text-align:center">
        <strong data-i18n="hostRoom.locked">정원 마감</strong><br>
        <span data-i18n="hostRoom.lockedDesc">방 정원이 가득 차서 더 이상 참여할 수 없습니다.</span>
      </div>
`;
    expect(src.includes(QR), 'QR 블록을 찾지 못했다 — mutation 이 공허해진다').toBe(true);
    // c-body 에서 빼고 c-head 끝(= c-body 시작 직전)으로 되돌린다.
    const removed = src.replace(QR, '');
    // ⚠️ '</div>+<div class="c-body">' 는 문서에 16번 나온다(모든 카드 화면). 그걸 앵커로 쓰면
    //    앞선 화면에 QR 이 삽입되어 mutation 이 조용히 무력화된다(실제로 한 번 그렇게 틀렸다).
    //    screenHostRoom 에만 있는 id 를 앵커로 쓴다.
    const anchor = '<div class="maru-guide" id="hostRoomGuide"></div>';
    expect(removed.split(anchor).length - 1, '앵커가 유일하지 않다').toBe(1);
    const mutated = removed.replace(anchor, anchor + '\n' + QR);
    expect(mutated).not.toBe(src);

    const mrows = await measure(mutated);
    const broken = mrows.filter(r => r.body <= 0 || r.scrolled.plist.visH < MIN_TAP);
    expect(broken.length,
      `QR 을 c-head 로 되돌렸는데 붕괴가 재현되지 않았다 — 이 가드가 공허하다. ` +
      `측정: ${mrows.map(r => `${r.dev} body=${r.body}`).join(', ')}`).toBeGreaterThan(0);
  }, 300000);
});
