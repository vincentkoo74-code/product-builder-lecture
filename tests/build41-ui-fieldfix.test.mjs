// Build41 UI 필드픽스 — Build40 필드 QA 이미지 10장(RPS-KR-QA)에서 확인된 UI 결함의 회귀 가드.
//
// root-cause 클러스터
//   RC-A  c-head 과성장: 데이터/장식 블록(벌칙 박스·진행 카드·선택 미리보기)이 수축하지 않는 c-head 에
//         들어가 c-body(결과 카드·참가자 목록·타이머 요약)를 0~90px 까지 밀어냈다.
//         (IMG_2011/2013/2014/2043/2044, Screenshot_20260830_091037)
//   RC-B  screenReady 나가기 2개(goHome / leaveRoom).                       (IMG_2043)
//   RC-C  QA fab 하단 고정이 c-foot CTA 를 덮음.                            (IMG_2013/2044/2046)
//   RC-D  누적 기록 팝업 오류 행에서 라벨이 2줄로 쪼개짐.                    (IMG_2015)
//   RC-G  강제 시작 버튼이 2열 셀 안에서 2줄로 접힘.                          (IMG_2043/2046)
//
// 계약(하드): clippedPx=0 · safeAreaOverlap=0 · duplicateExitCount≤1 · touchTarget≥44 · 줄바꿈 버튼 0.
// 계측은 실제 렌더러를 호출하는 tests/harness/ui-fieldfix-build41.mjs 로 한다(뷰포트 7종).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEVICES, VIEWS, buildProbePage } from './harness/ui-fieldfix-build41.mjs';

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const section = (id, nextId) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${nextId}"`));
const splitCard = (sec) => {
  const h = sec.indexOf('<div class="c-head">'), b = sec.indexOf('<div class="c-body">'), f = sec.indexOf('<div class="c-foot">');
  expect(h).toBeGreaterThan(-1); expect(b).toBeGreaterThan(h); expect(f).toBeGreaterThan(b);
  return { head: sec.slice(h, b), body: sec.slice(b, f), foot: sec.slice(f) };
};

// ─── 소스 계약 ──────────────────────────────────────────────────────────────
describe('Build41 UI — RC-A 결과 화면: 벌칙 박스는 c-body 의 결과 카드 꼬리다', () => {
  const { head, body } = splitCard(section('screenRoundResult', 'screenWinnerWait'));
  it('c-head 에는 hero 만 있고 벌칙 박스가 없다', () => {
    expect(head).toContain('class="result-hero"');
    expect(head).not.toContain('id="resultPenaltyBox"');
  });
  // Build42 UI 방향(결정 1)이 Build41 의 "카드 → 한 줄 꼬리"를 대체: 확정 술래의 벌칙은 1차 정보 → 카드 **앞** 2줄 카드.
  it('c-body 순서: 벌칙 카드 → 결과 카드 → 참가자 행 (Build42, id/hidden 토글 계약 유지)', () => {
    const card = body.indexOf('data-round-progress'), pen = body.indexOf('id="resultPenaltyBox"'), list = body.indexOf('id="roundResultList"');
    expect(pen).toBeGreaterThan(-1); expect(card).toBeGreaterThan(pen); expect(list).toBeGreaterThan(card);
    expect(body).toContain('class="penalty-box hidden" id="resultPenaltyBox"');
    expect(body).toContain('id="resultPenaltyText"');
  });
  it('벌칙 카드 패딩/값 크기는 높이 예산 clamp (Build42)', () => {
    expect(html).toMatch(/#screenRoundResult \.c-body \.penalty-box\{\s*\n?\s*padding:clamp\(/);
    expect(html).toMatch(/#screenRoundResult \.c-body \.penalty-box strong\{font-size:clamp\(/);
  });
  it('hero 이미지는 예산 기반 연속 clamp 하나로 정해진다 (기기별 고정값 없음)', () => {
    expect(html).toMatch(/--result-maru:\s*clamp\(\d+px,\s*calc\(100dvh - var\(--safe-top, ?20px\) - var\(--safe-bottom, ?24px\) - \d+px\),\s*\d+px\)/); // Build42: 상한 220
    expect(html).toMatch(/\.result-maru\{\s*width:var\(--result-maru\);height:var\(--result-maru\)/);
    expect(html).not.toMatch(/\.result-maru\{width:104px;height:104px/);
    expect(html).toContain('.result-hero .lead{margin-bottom:0}');
  });
  it('결과 렌더러의 벌칙 토글/최종 버튼 생성 로직은 무변경이다', () => {
    expect(html).toContain('penaltyBox.classList.remove("hidden");');
    expect(html).toContain('penaltyBox.classList.add("hidden");');
    expect(html).toContain('finalBtns.innerHTML = html;');
    expect(html).toContain('const isResultCard = card.closest && card.closest("#screenRoundResult");');
  });
});

describe('Build41 UI — RC-A 준비 화면: 목록이 먼저, 진행 카드는 c-body 뒤쪽', () => {
  const { head, body, foot } = splitCard(section('screenReady', 'screenGame'));
  it('c-head 에 진행 카드가 없다', () => { expect(head).not.toContain('data-round-progress'); });
  it('c-body 순서: h3 → 참가자 목록 → 진행 카드', () => {
    const h3 = body.indexOf('data-i18n="ready.participantsStatus"'), list = body.indexOf('id="readyParticipantList"'), card = body.indexOf('data-round-progress');
    expect(h3).toBeGreaterThan(-1); expect(list).toBeGreaterThan(h3); expect(card).toBeGreaterThan(list);
  });
  it('[RC-B] 나가기는 grid 안의 leaveRoom 하나뿐이다 (goHome 나가기·btn-quiet 중복 제거)', () => {
    expect(foot).not.toContain('window.goHome()');
    expect(foot).not.toContain('class="btn-quiet"');
    expect(foot.match(/나가기<\/button>/g).length).toBe(1);
    expect(foot).toContain('class="btn-outline btn-full" onclick="window.leaveRoom()" data-i18n="common.leaveRoomShort"');
  });
  it('[RC-G] 강제 시작 버튼 3개 모두 전폭(span-full) 이다', () => {
    for (const id of ['forceStartReplayBtnReady', 'forceStartReplayBtnWinnerWait', 'forceStartReplayBtnLoserWait']) {
      expect(html, id).toContain(`<button id="${id}" class="btn-success btn-full span-full hidden force-start-replay-btn"`);
    }
  });
});

describe('Build41 UI — RC-A 플레이 화면: 타이머 요약이 c-body 첫 번째', () => {
  const { head, body } = splitCard(section('screenGame', 'screenRoundResult'));
  it('c-head 에 진행 카드/선택 미리보기가 없다', () => {
    expect(head).not.toContain('data-round-progress'); expect(head).not.toContain('id="choiceAnim"');
    expect(head).toContain('id="gameGuide"');
  });
  it('c-body 순서: 요약 행 → 진행 카드 → 선택 미리보기 (Build42 정식 순서)', () => {
    const sum = body.indexOf('class="summary-row"'), anim = body.indexOf('id="choiceAnim"'), card = body.indexOf('data-round-progress');
    expect(sum).toBeGreaterThan(-1); expect(card).toBeGreaterThan(sum); expect(anim).toBeGreaterThan(card);
  });
});

describe('Build41 UI — RC-C QA fab 도크 / RC-D 오류 행', () => {
  it('QA 버튼은 하단 고정이 아니라 topbar 아래 도크에 있다', () => {
    expect(html).not.toContain("position:fixed;right:8px;bottom:8px");
    expect(html).not.toContain("position:fixed;right:8px;bottom:44px");
    expect(html).toContain("dock.id = 'qaFabDock';");
    expect(html).toContain("top:var(--device-ui-fade-end)");
    expect(html).toContain("dock.appendChild(btn);");
    expect(html).toContain("dock.appendChild(saveBtn);");
  });
  it('누적 기록 오류 행은 세로 스택이다', () => {
    expect(html).toContain('<div class="participant stats-error"><strong>${t("account.loadFailed")}</strong>');
    expect(html).toMatch(/\.participant\.stats-error\{flex-direction:column/);
  });
});

// ─── geometry (headless Chrome) ─────────────────────────────────────────────
let server = null, rows = [];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
async function measure(probeName, page) {
  const probePath = join(ROOT, probeName);
  await writeFile(probePath, page, 'utf8');
  try {
    server = createServer(async (req, res) => {
      const p = decodeURIComponent((req.url || '/').split('?')[0]);
      try { const buf = await readFile(join(ROOT, p === '/' ? 'index.html' : p.slice(1)));
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(buf); }
      catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { stdout } = await execFileP(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=150000',
      '--window-size=1200,900', '--dump-dom', `http://127.0.0.1:${server.address().port}/${probeName}`], { maxBuffer: 64 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout);
    if (!m) throw new Error('probe produced no RESULTS');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return dec(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally {
    if (server) { await new Promise(r => server.close(r)); server = null; }
    await unlink(probePath).catch(() => {});
  }
}
beforeAll(async () => { if (hasChrome) rows = await measure("_b41.probe.html", buildProbePage(DEVICES)); }, 600000); // 49 iframe 렌더 — 다른 Chrome 계측 suite 와 병렬일 때 4~6배 느려진다(build37-a5 와 같은 예산)
afterAll(async () => { if (server) await new Promise(r => server.close(r)); });
const of = view => rows.filter(r => r.view === view);

describe.skipIf(!hasChrome)('Build41 UI — geometry 계약 (7 viewport)', () => {
  it('전제: 모든 화면 × 기기 조합이 오류 없이 계측됐다', () => {
    expect(rows.length).toBe(DEVICES.length * VIEWS.length);
    rows.forEach(r => expect(r.error, `${r.dev}/${r.view}: ${r.error}`).toBeUndefined());
    rows.filter(r => r.log).forEach(r => r.log.forEach(l => expect(l, `${r.dev}/${r.view} 렌더러 호출 실패: ${l}`).toMatch(/:ok$/)));
  });
  it('공통: safeAreaOverlap=0 · duplicateExitCount≤1 · touchTarget≥44 · 2줄 버튼 0 · c-head ≤ 50%', () => {
    for (const r of rows.filter(r => r.view !== 'statsPopup')) {
      const tag = `${r.dev}/${r.view}`;
      expect(r.safeAreaOverlap, `${tag} safeAreaOverlap`).toBe(0);
      expect(r.duplicateExitCount, `${tag} duplicateExitCount`).toBeLessThanOrEqual(1);
      expect(r.touchTargetHeight, `${tag} touchTargetHeight`).toBeGreaterThanOrEqual(44);
      expect(r.wrappedButtons, `${tag} 2줄로 접힌 버튼`).toEqual([]);
      expect(r.headShare, `${tag} c-head 점유율`).toBeLessThanOrEqual(50);
      expect(r.bottomDeadSpace, `${tag} 마지막 버튼이 뷰포트 밖`).toBeGreaterThanOrEqual(0);
    }
  });
  it('결과(술래): 결과 카드 clippedPx=0, 벌칙 꼬리 표시+clippedPx=0', () => {
    for (const r of of('resultLoser')) {
      expect(r.clippedPx, `${r.dev} 결과 카드`).toBe(0);
      expect(r.penaltyShown, `${r.dev} 벌칙 표시`).toBe(true);
      expect(r.penalty.clipped, `${r.dev} 벌칙 꼬리`).toBe(0);
    }
  });
  // ── Build41 결함 A/B (증거 재조정 §7.7): 참가자 최종 결과의 2행 예약 슬랙 · Android 2줄 제목 잘림 ──
  it('[결함 A] 참가자 최종 결과: verdictActionSlot 미사용 예약 = 0, 예상 밖 하단 슬랙 = 0', () => {
    for (const r of [...of('resultLoserParticipant'), ...of('resultWinnerParticipant')]) {
      const tag = `${r.dev}/${r.view}`;
      expect(r.footer.slotSlack, `${tag} 슬롯 예약 슬랙`).toBe(0);
      expect(r.footer.unexpectedFooterHeight, `${tag} 예상 밖 하단 여백`).toBe(0);
      expect(r.bottom.footPaddingBottom, `${tag} 의도된 하단 패딩(안전영역 fallback)`).toBeGreaterThanOrEqual(18);
      expect(r.actionsBottom, `${tag} 버튼이 뷰포트 안`).toBeLessThanOrEqual(r.vh - r.bottom.footPaddingBottom);
    }
  });
  it('[결함 B] 참가자 결과(2줄 제목 "술래 확정! (1/1명)" 포함): 결과 카드·벌칙 꼬리 clippedPx=0 (전 기기)', () => {
    for (const r of of('resultLoserParticipant')) {
      expect(r.clippedPx, `${r.dev} 결과 카드`).toBe(0);
      expect(r.penaltyShown, `${r.dev} 벌칙 표시`).toBe(true);
      expect(r.penalty.clipped, `${r.dev} 벌칙 꼬리`).toBe(0);
    }
    for (const r of of('resultWinnerParticipant')) expect(r.clippedPx, `${r.dev} 결과 카드`).toBe(0);
  });
  it('[호스트 대조군] 호스트 최종 결과: 2행(한번더 + 승률/나가기) 예약이 그대로 렌더된다', () => {
    for (const r of [...of('resultLoser'), ...of('resultWinner')]) {
      const tag = `${r.dev}/${r.view}`;
      expect(r.footer.slotMinHeight, `${tag} 호스트 슬롯 예약 유지`).toBeGreaterThanOrEqual(96);
      expect(r.footer.finalBtnsH, `${tag} 2행 버튼 높이`).toBeGreaterThan(96);
      expect(r.footer.slotSlack, `${tag} 호스트 슬랙`).toBe(0);
      expect(r.clippedPx, `${tag} 결과 카드`).toBe(0);
    }
  });
  it('[결함 A 소스 계약] 렌더러 gameOver 분기가 참가자에게 slot-final 을 켜고, 리셋에서 끈다', () => {
    expect(html).toContain('$("verdictActionSlot")?.classList.toggle("slot-final", state.role !== "host");');
    expect(html).toContain('$("verdictActionSlot")?.classList.remove("slot-final");');
    expect(html).toMatch(/#verdictActionSlot\.slot-final\{min-height:0\}/);
    // 호스트 예약(base min-height)은 남아 있어야 한다
    expect(html).toMatch(/#verdictActionSlot\{[^}]*min-height:\s*\d+px/);
  });

  it('결과(승리): 결과 카드 clippedPx=0, 벌칙 숨김', () => {
    for (const r of of('resultWinner')) { expect(r.clippedPx, r.dev).toBe(0); expect(r.penaltyShown, r.dev).toBe(false); }
  });
  it('준비(호스트/참가자): 참가자 목록 전체 + h3 가 첫 화면에 보인다, 나가기 정확히 1개', () => {
    for (const r of [...of('readyHost'), ...of('readyParticipant')]) {
      expect(r.participantListFullHeight, `${r.dev}/${r.view} 목록 렌더`).toBeGreaterThan(0);
      expect(r.participantListVisibleHeight, `${r.dev}/${r.view} 목록 가시`).toBe(r.participantListFullHeight);
      expect(r.h3.clipped, `${r.dev}/${r.view} h3`).toBe(0);
      expect(r.duplicateExitCount, `${r.dev}/${r.view} 나가기`).toBe(1);
    }
  });
  it('플레이: 타이머 요약 clippedPx=0, 선택 버튼 3개 온전히 보임', () => {
    for (const r of of('gameChosen')) { expect(r.summary.clipped, r.dev).toBe(0); expect(r.choiceButtonsVisible, r.dev).toBe(true); }
  });
  it('승자 대기: 진행 카드 clippedPx=0', () => {
    for (const r of of('winnerWait')) expect(r.clippedPx, r.dev).toBe(0);
  });
  it('누적 기록 오류 행: 라벨이 1줄', () => {
    for (const r of of('statsPopup')) expect(r.strongLines, r.dev).toBe(1);
  });

  it('[mutation] 벌칙 박스를 c-head 로 되돌리고 hero 를 고정 170px 로 하면(Build40 상태) 결과 카드가 다시 잘린다 (가드 공허성 검사)', async () => {
    const src = html;
    const tail = /      <!-- Build42 UI 방향\(결정 1\)[\s\S]*?<div class="penalty-box hidden" id="resultPenaltyBox">[\s\S]*?<\/div>\n/.exec(src);
    expect(tail, '벌칙 꼬리 블록을 찾지 못했다').not.toBeNull();
    const headEnd = src.indexOf('      </div>\n      <div class="c-body">', src.indexOf('id="screenRoundResult"'));
    // Build42 이후 hero 예산 clamp 가 벌칙 카드까지 흡수하므로 head 복귀만으로는 잘림이 재현되지 않는다 —
    // Build40 상태(고정 170px hero + head 안의 벌칙)로 되돌려 가드가 실제로 잘림을 잡는지 확인한다.
    const mutated = (src.slice(0, headEnd) + tail[0] + src.slice(headEnd)).replace(tail[0], '')
      .replace(/--result-maru:\s*clamp\([^;]*\);/, '--result-maru: 170px;');
    const mutPath = join(ROOT, '_b41mut.index.html');
    await writeFile(mutPath, mutated, 'utf8');
    try {
      const mrows = await measure('_b41mut.probe.html', buildProbePage(DEVICES.filter(d => /iPhone12|AndMedium/.test(d.name)), '/_b41mut.index.html'));
      const losers = mrows.filter(r => r.view === 'resultLoser');
      expect(losers.length).toBe(2);
      expect(losers.some(r => r.clippedPx > 0), '벌칙 박스를 c-head 로 되돌렸는데 결과 카드가 잘리지 않았다 — 계측이 공허하다').toBe(true);
    } finally { await unlink(mutPath).catch(() => {}); }
  }, 600000);
});
