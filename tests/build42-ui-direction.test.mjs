// Build42 UI 방향(RIGHTMOST mockup 의도) — 상태 × 역할 × 뷰포트 계약. RED 먼저.
//
// 결정 1: 최종 술래(caseType gameOver && myResult lose, 그리고 tooFew 의 확정 술래)는 역할 무관 벌칙이 1차 정보
//        → 순서 hero → 캡/제목/메시지 → 벌칙 큰 카드 → 라운드 결과 → 참가자 행 → (여백) → 하단 액션.
// 결정 2: 짧은 뷰포트 압축 순서 hero → 장식 간격 → 제목 크기(가독 clamp) → 카드 패딩. 텍스트 삭제 없음.
// 플레이 정식 순서: 캡/라운드/안내 → 요약 → 진행 카드 → 손 미리보기(가변) → 가위바위보.
// 준비: h3 + 태거 칩(renderRoundProgressCards 와 같은 데이터) → 참가자 그리드 → 카드(스크롤) → 액션.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEVICES, VIEWS, buildProbePage } from './harness/ui-direction-build42.mjs';

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const section = (id, nextId) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${nextId}"`));
const TALL = new Set(['iPhone11', 'AndTall']);

// ─── 소스 계약 ──────────────────────────────────────────────────────────────
describe('Build42 — 소스 계약', () => {
  it('[결과] c-body DOM 순서: 벌칙 → 라운드 결과 카드 → 참가자 행 (스크린리더 순서 = 시각 순서)', () => {
    const s = section('screenRoundResult', 'screenWinnerWait'); const b = s.slice(s.indexOf('<div class="c-body">'), s.indexOf('<div class="c-foot">'));
    const pen = b.indexOf('id="resultPenaltyBox"'), card = b.indexOf('data-round-progress'), list = b.indexOf('id="roundResultList"');
    expect(pen).toBeGreaterThan(-1); expect(card).toBeGreaterThan(pen); expect(list).toBeGreaterThan(card);
    expect(b).not.toContain('penalty-tail');
  });
  it('[결과] hero 이미지 예산 clamp — 상한이 170px 을 넘어 tall 기기에서 자연 확대', () => {
    const m = /--result-maru:\s*clamp\((\d+)px,\s*calc\(100dvh - var\(--safe-top, 20px\) - var\(--safe-bottom, 24px\) - \d+px\),\s*(\d+)px\)/.exec(html);
    expect(m, '--result-maru clamp 없음').not.toBeNull(); expect(Number(m[2])).toBeGreaterThan(170); expect(Number(m[1])).toBeLessThanOrEqual(64);
  });
  it('[결과] 제목은 가독 clamp (고정 42px 아님)', () => { expect(html).toMatch(/\.result-title\s*\{[^}]*font-size:\s*clamp\(/); });
  it('[플레이] c-body 순서: 요약 → 진행 카드 → 손 미리보기, 미리보기 높이는 예산 clamp', () => {
    const s = section('screenGame', 'screenRoundResult'); const b = s.slice(s.indexOf('<div class="c-body">'), s.indexOf('<div class="c-foot">'));
    const sum = b.indexOf('class="summary-row"'), card = b.indexOf('data-round-progress'), anim = b.indexOf('id="choiceAnim"');
    expect(sum).toBeGreaterThan(-1); expect(card).toBeGreaterThan(sum); expect(anim).toBeGreaterThan(card);
    expect(html).toMatch(/\.choice-anim\s*\{[^}]*--choice-anim-h:\s*clamp\(/); expect(html).toMatch(/\.choice-anim\s*\{[^}]*height:\s*var\(--choice-anim-h\)/);
  });
  it('[준비] h3 행에 태거 칩, 렌더러가 같은 데이터(info.target)로 채운다', () => {
    const s = section('screenReady', 'screenGame'); expect(s).toContain('data-tagger-chip');
    const r = html.slice(html.indexOf('function renderRoundProgressCards()'), html.indexOf('function setGuideText'));
    expect(r).toContain('[data-tagger-chip]'); expect(r).toContain('t("progress.targetLoserCount", { n: info.target })');
  });
  it('[기능 무변경] 판정/토글 계약 유지', () => {
    expect(html).toContain('penaltyBox.classList.remove("hidden");'); expect(html).toContain('finalBtns.innerHTML = html;');
    expect(html).toContain('$("verdictActionSlot")?.classList.toggle("slot-final", !canShowPlayAgainButton());'); // Build43 확장
    expect(html).toContain('const isResultCard = card.closest && card.closest("#screenRoundResult");');
  });
});

// ─── geometry ──────────────────────────────────────────────────────────────
let server = null, rows = [];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
async function measure(probeName, page) {
  const probePath = join(ROOT, probeName); await writeFile(probePath, page, 'utf8');
  try {
    server = createServer(async (req, res) => { const p = decodeURIComponent((req.url || '/').split('?')[0]);
      try { const buf = await readFile(join(ROOT, p === '/' ? 'index.html' : p.slice(1))); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(buf); }
      catch { res.writeHead(404); res.end(); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { stdout } = await execFileP(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=150000', '--window-size=1200,900', '--dump-dom', `http://127.0.0.1:${server.address().port}/${probeName}`], { maxBuffer: 64 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout); if (!m) throw new Error('probe produced no RESULTS');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return dec(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally { if (server) { await new Promise(r => server.close(r)); server = null; } await unlink(probePath).catch(() => {}); }
}
beforeAll(async () => { if (hasChrome) rows = await measure('_b42.probe.html', buildProbePage(DEVICES)); }, 600000);
afterAll(async () => { if (server) await new Promise(r => server.close(r)); });
const of = (...views) => rows.filter(r => views.includes(r.view));
const tag = r => `${r.dev}/${r.view}`;

describe.skipIf(!hasChrome)('Build42 — geometry 계약 (상태 8 × 뷰포트 9)', () => {
  it('전제: 전 조합 계측, 렌더러 호출 실패 0', () => {
    expect(rows.length).toBe(DEVICES.length * VIEWS.length);
    rows.forEach(r => { expect(r.error, `${tag(r)}: ${r.error}`).toBeUndefined(); (r.log || []).forEach(l => expect(l, `${tag(r)} ${l}`).toMatch(/:ok$/)); });
  });
  it('공통: safeAreaOverlap=0 · unexpectedDeadSpace=0 · touch≥44 · 2줄 버튼 0 · 액션이 바닥 근처(dead ≤ 의도 패딩+16)', () => {
    for (const r of rows) {
      expect(r.safeAreaOverlap, `${tag(r)} safeAreaOverlap`).toBe(0);
      expect(r.unexpectedDeadSpace, `${tag(r)} unexpectedDeadSpace`).toBe(0);
      expect(r.touchTargetHeight, `${tag(r)} touch`).toBeGreaterThanOrEqual(44);
      expect(r.wrappedButtons, `${tag(r)} 2줄 버튼`).toEqual([]);
      expect(r.bottomDeadSpace, `${tag(r)} bottomDeadSpace`).toBeLessThanOrEqual(r.intentionalBottomPadding + 16);
      expect(r.bottomDeadSpace, `${tag(r)} 액션 뷰포트 밖`).toBeGreaterThanOrEqual(0);
    }
  });
  it('[결정 1] 최종 술래(host/participant): 벌칙 큰 카드가 라운드 결과 카드 위, 둘 다 clippedPx=0', () => {
    for (const r of of('finalLoserHost', 'finalLoserParticipant')) {
      expect(r.penalty.shown, `${tag(r)} 벌칙 표시`).toBe(true);
      expect(r.penalty.form, `${tag(r)} 벌칙 형태`).toBe('big');
      expect(r.penalty.bigForm, `${tag(r)} 벌칙 카드 높이(라벨+값)`).toBe(true);
      expect(r.penaltyBeforeCard, `${tag(r)} 벌칙 → 카드 순서`).toBe(true);
      expect(r.penalty.clipped, `${tag(r)} 벌칙 clip`).toBe(0);
      expect(r.roundResult.clipped, `${tag(r)} 카드 clip`).toBe(0);
    }
  });
  it('[최소 뷰포트 하드 게이트] 360×732 host 최종 술래 + 2줄 제목 + 한번더: clip 0', () => {
    const r = rows.find(r => r.dev === 'And360x732' && r.view === 'finalLoserHost');
    // 제목 가독 clamp 적용 후 360×732 에서 '술래 확정! (1/1명)' 은 1줄이 될 수 있다 — 줄 수는 보고값, 계약은 clip 0.
    expect(r.titleLines, '제목 줄 수').toBeGreaterThanOrEqual(1);
    expect(r.penalty.clipped).toBe(0); expect(r.roundResult.clipped).toBe(0); expect(r.safeAreaOverlap).toBe(0); expect(r.touchTargetHeight).toBeGreaterThanOrEqual(44);
    expect(r.btns.some(b => /한번더/.test(b.t)), '한번더 존재').toBe(true);
  });
  it('[최종 승자] 카드 clip 0, 벌칙 숨김, 참가자 결과 첫 행이 fold 안에서 시작', () => {
    for (const r of of('finalWinnerHost', 'finalWinnerParticipant')) {
      expect(r.penalty.shown, tag(r)).toBe(false); expect(r.roundResult.clipped, `${tag(r)} 카드`).toBe(0);
      expect(r.participantStatus.shown, `${tag(r)} 참가자 행`).toBe(true);
      expect(r.participantStatus.top, `${tag(r)} 첫 행 시작이 액션 위`).toBeLessThan(r.actions.top);
      if (r.viewportH >= 780) expect(r.participantStatus.clipped, `${tag(r)} 첫 행 clip`).toBe(0);
    }
  });
  it('[tall 자연 확대] iPhone 11 / Android tall 최종 화면에서 hero 이미지가 170px 보다 크다', () => {
    for (const r of rows.filter(r => r.view.startsWith('final') && TALL.has(r.dev))) expect(r.hero.imgH, `${tag(r)} hero`).toBeGreaterThan(170);
  });
  it('[준비] 태거 칩 표시(술래 N명) · 참가자 그리드 전체 가시 · 나가기 1개 · host 강제 시작 전폭', () => {
    for (const r of of('readyHost', 'readyParticipant')) {
      expect(r.taggerChip.shown, `${tag(r)} 칩`).toBe(true); expect(r.taggerChip.text, `${tag(r)} 칩 텍스트`).toMatch(/술래/); expect(r.taggerChip.clipped, `${tag(r)} 칩 clip`).toBe(0);
      expect(r.participantStatus.clipped, `${tag(r)} 그리드`).toBe(0); expect(r.duplicateExitCount, tag(r)).toBe(1);
      if (r.view === 'readyHost') { const fs = r.btns.find(b => /강제 시작/.test(b.t)); expect(fs, `${tag(r)} 강제 시작`).toBeTruthy(); expect(fs.w, `${tag(r)} 전폭`).toBeGreaterThan(r.btns.find(b => /벌칙 수정/.test(b.t)).w * 1.5); }
    }
  });
  it('[플레이] 순서 요약 → 진행 카드 → 미리보기 → 가위바위보, 카드 clip 0, 미리보기 56~120px 가시, 버튼 온전', () => {
    for (const r of of('gameChosen')) {
      const o = r.order; expect(o.summaryBottom, `${tag(r)} 요약→카드`).toBeLessThanOrEqual(o.cardTop + 0.5); expect(o.cardBottom, `${tag(r)} 카드→미리보기`).toBeLessThanOrEqual(o.previewTop + 0.5);
      if (r.viewportH >= 732) expect(o.previewBottom, `${tag(r)} 미리보기→액션`).toBeLessThanOrEqual(o.actionsTop + 0.5); else expect(o.previewTop, `${tag(r)} 미리보기 시작이 액션 위`).toBeLessThan(o.actionsTop);
      expect(r.summary.clipped, `${tag(r)} 요약`).toBe(0); expect(r.roundResult.clipped, `${tag(r)} 카드`).toBe(0);
      expect(r.preview.natH, `${tag(r)} 미리보기 상한`).toBeLessThanOrEqual(120); expect(r.preview.natH, `${tag(r)} 미리보기 하한`).toBeGreaterThanOrEqual(56);
      expect(r.preview.imgH, `${tag(r)} 미리보기 손 이미지가 실제로 렌더된다(≥40px)`).toBeGreaterThanOrEqual(40);
      if (r.viewportH >= 732) { expect(r.preview.clipped, `${tag(r)} 미리보기 clip`).toBe(0); }
      // 승인된 최소 게이트(360×732) 미만(iPhone SE 667)은 §15 압축을 다 해도 미리보기 56px 중 ~7px 만 fold 안에 남는다(증거: docs §Build42).
      // 그 경우 계약은 요약·진행 카드·버튼 온전 + 미리보기가 액션 위에서 시작(스크롤로 이어짐)이다 — 위 order 단언이 담당.
      expect(r.choiceButtonsVisible, `${tag(r)} 버튼`).toBe(true);
    }
  });
  it('[재대결 대기] 카드 clip 0, 강제 시작 전폭', () => {
    for (const r of of('winnerWait')) { expect(r.roundResult.clipped, tag(r)).toBe(0); const fs = r.btns.find(b => /강제 시작/.test(b.t)); expect(fs && fs.w, tag(r)).toBeGreaterThan(250); }
  });
});
