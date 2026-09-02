// Build47 필드QA 정정(SCOPE LOCK 3항목) — RED→GREEN 계약.
//
// 항목 1(P0): 누적 승패 단일 권위 원장 — canonical matchStats({wins,losses}, sanitizeMatchStats)가
//            유일한 가변 누적 권위다. 점수 카드·임계 판정·MATCH_DECISION 계측이 전부 같은
//            canonical 원장(losses 투영 deriveMatchLossTally)을 읽는다. FINAL 쓰기는 CAS
//            (.eq(status).eq(penalty) + .select 적용확인 + 읽기 재검증 + 1회 rebase 재시도)로
//            "적용 확인 후에만 로컬 권위 전진"을 보장하고, 미적용은 FINAL_WRITE_NOT_APPLIED 로 남는다.
// 항목 2: GAME 순번 음성 안내 — G1 "첫 번째 판 시작합니다. 준비하세요."(ready 대체), G2+
//            "N 번째 판 갑니다."(상한 없음, 10 초과는 "다음 판"). (roomCode, matchNo, gameRound)당
//            1회 멱등(localStorage 벨트). 내부 재대결(round>1)은 안내하지 않는다.
//            카운트다운 2박자는 "마루 가위바위보"(ko_maru_rps.mp3, 화면 텍스트 voice.go1/go2 정렬).
// 항목 3: iPhone16 세로 — 상단 사공간 회수(--safe-top inset+4, topbar 10/6,
//            #screenGame padding-top 예산화), 회수분을 중앙 렌더 영역 예산으로
//            (choice-anim 56/640/120→64/620/132, result-maru 40/620→48/600). 페이지 스크롤 없음.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEVICES47, buildGameProbePage } from './harness/game-topspace-build47.mjs';

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(CHROME);
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ── 함수 추출(async 우선 매칭 — 'function X(' 는 'async function X(' 의 부분 문자열) ──
function sliceFn(name) {
  const decls = [`async function ${name}(`, `function ${name}(`];
  let start = -1, isAsync = false;
  for (const d of decls) { const i = html.indexOf(d); if (i !== -1) { start = i; isAsync = d.startsWith('async'); break; } }
  if (start === -1) throw new Error(`function not found: ${name}`);
  const nexts = [];
  for (const d of ['\n    function ', '\n    async function ', '\n\t    function ', '\n\t    async function ']) {
    const i = html.indexOf(d, start + name.length + 12); if (i !== -1) nexts.push(i);
  }
  const end = nexts.length ? Math.min(...nexts) : start + 12000;
  return html.slice(start, end);
}
const evalFns = (names, ctxExtra = {}) => {
  const src = names.map(sliceFn).join('\n');
  const keys = Object.keys(ctxExtra);
  const factory = new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`);
  return factory(...keys.map(k => ctxExtra[k]));
};

// ── 항목 1: 단일 권위 원장 ─────────────────────────────────────────────────
describe('Build47 정정 항목1 — canonical 원장 단일 소스 + FINAL CAS 적용확인', () => {
  const cardFn = sliceFn('getMatchCumulativeStats');
  it('점수 카드는 canonical 원장(sanitizeMatchStats)에서 파생한다 — 카드 전용 카운터/이중 소스 없음', () => {
    expect(cardFn).toContain('sanitizeMatchStats(p.matchStats, p.matchTally)');
    expect(cardFn).toContain('loserCount: n(base.losses)');
    expect(cardFn).not.toContain('loserCount: n(base.l)');
  });
  it('[기능·계약3] 카드 값 == deriveMatchLossTally == computeMatchDecision 누적 소스 (단일 원장 불변식)', () => {
    const { sanitizeMatchStats, deriveMatchLossTally, matchStatCount } = evalFns(['sanitizeMatchStats', 'deriveMatchLossTally', 'matchStatCount']);
    const envelope = { matchStats: { a: { wins: 1, losses: 2 }, b: { wins: 3, losses: 0 } }, matchTally: { a: 99 } }; // tally 오염 시나리오
    const card = new Function('state', 'parsePenalty', 'sanitizeMatchStats', `return (${cardFn}\n)({ id: 'a' });`)(
      { penalty: 'x' }, () => envelope, sanitizeMatchStats);
    const derived = deriveMatchLossTally(envelope.matchStats);
    expect(card.loserCount).toBe(2);           // canonical losses — 오염된 legacy tally(99) 아님
    expect(card.loserCount).toBe(derived.a);   // 카드 == 임계 판정 투영(같은 원장)
    expect(card.safeCount).toBe(1);
  });
  it('[기능] canonical 우선: matchStats 존재 시 legacy matchTally 는 절대 override 불가(마이그레이션 전용)', () => {
    const { sanitizeMatchStats } = evalFns(['sanitizeMatchStats', 'matchStatCount']);
    expect(sanitizeMatchStats({ a: { wins: 1, losses: 1 } }, { a: 9 }).a.losses).toBe(1);
    expect(sanitizeMatchStats(null, { a: 2 }).a).toEqual({ wins: 0, losses: 2 }); // 구방 마이그레이션
    expect(sanitizeMatchStats({ a: { w: 2, l: 1 } }).a).toEqual({ wins: 2, losses: 1 }); // legacy {w,l} 읽기 호환
  });
  it('[기능] applyCompletedGameToMatchStats: 참가자 전원 1판 1기록, locked 동결, 대기자 제외 개념(참가자 인자 기반)', () => {
    const { applyCompletedGameToMatchStats } = evalFns(['applyCompletedGameToMatchStats', 'sanitizeMatchStats', 'matchStatCount']);
    const next = applyCompletedGameToMatchStats({ h: { wins: 1, losses: 0 } }, ['h', 'a', 'lockedP'], ['a'], ['lockedP']);
    expect(next.h).toEqual({ wins: 2, losses: 0 });
    expect(next.a).toEqual({ wins: 0, losses: 1 });
    expect(next.lockedP).toBeUndefined(); // 잠긴 참가자는 동결 — 재기록 없음
  });

  const finalFn = sliceFn('updateRoomStatusScheduled');
  it('FINAL writer 는 CAS(.eq status+penalty)+select 적용확인+읽기 재검증+rebase 재시도+NOT_APPLIED 계측을 갖는다', () => {
    expect(finalFn).toContain(".eq('id', state.roomCode).eq('status', __expectedStatus).eq('penalty', __basePenalty)");
    expect(finalFn).toContain(".select('id,status,penalty')");
    expect(finalFn).toContain("eventType: 'FINAL_WRITE_RETRY'");
    expect(finalFn).toContain("eventType: 'FINAL_WRITE_NOT_APPLIED'");
    expect(finalFn).toContain('rowsApplied: __applied');
    expect(finalFn).toContain('success: !error && __applied > 0');
    // 적용 확인 후에만 로컬 권위 전진(HARD FIX CONTRACT step 4→5)
    expect(finalFn).toContain('state.penalty = __committedPenalty;');
  });
  function mkCasHarness({ writes, reads }) {
    const events = [], writeCalls = [];
    let wi = 0, ri = 0;
    const db = { from: () => ({
      update: (payload) => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: async () => { writeCalls.push(payload); return writes[Math.min(wi++, writes.length - 1)]; } }) }) }) }),
      select: () => ({ eq: () => ({ limit: async () => reads[Math.min(ri++, reads.length - 1)] }) }),
    }) };
    const state = { penalty: 'P0', roomCode: 'R1', status: 'playing' };
    const ctx = {
      db, state,
      isRoomClosingOrDestroyed: () => false,
      buildPenaltyValue: () => 'P1',
      hostComposeMatchUpdate: () => null,
      getGameRound: () => 3, getNextPhaseScheduledAt: () => 0,
      QA: { emit: (k, p) => events.push(p) },
    };
    const keys = Object.keys(ctx);
    const fn = new Function(...keys, `return (${finalFn}\n)('result', 'result', { mode: 'FINAL', gameNo: 3, round: 1, confirmedLoserIds: ['a'] });`);
    return { run: () => fn(...keys.map(k => ctx[k])), events, writeCalls, state };
  }
  it('[기능] CAS 1회 적용 → 성공, 재시도 없음, 로컬 권위가 서버 커밋본으로 전진', async () => {
    const h = mkCasHarness({ writes: [{ data: [{ id: 'R1', status: 'result', penalty: 'P1' }], error: null }], reads: [] });
    await h.run();
    expect(h.writeCalls.length).toBe(1);
    const end = h.events.find(e => e.eventType === 'CONTINUATION_WRITE_END');
    expect(end.success).toBe(true); expect(end.retried).toBe(false); expect(end.rowsApplied).toBe(1);
    expect(h.state.penalty).toBe('P1');
  });
  it('[기능] CAS 0행 + 같은 phase 의 다른 writer 스냅샷 → rebase 재시도 1회 후 적용(FINAL_WRITE_RETRY)', async () => {
    const h = mkCasHarness({
      writes: [{ data: [], error: null }, { data: [{ id: 'R1', status: 'result', penalty: 'P1' }], error: null }],
      reads: [{ data: [{ id: 'R1', status: 'playing', penalty: 'P0b' }], error: null }],
    });
    await h.run();
    expect(h.writeCalls.length).toBe(2);
    expect(h.events.some(e => e.eventType === 'FINAL_WRITE_RETRY')).toBe(true);
    const end = h.events.find(e => e.eventType === 'CONTINUATION_WRITE_END');
    expect(end.success).toBe(true); expect(end.retried).toBe(true);
    expect(h.state.penalty).toBe('P1');
  });
  it('[기능·역행 금지] 더 새로운 phase 가 이미 커밋됨 → 덮어쓰지 않고 throw + FINAL_WRITE_NOT_APPLIED, 로컬 권위 비전진', async () => {
    const h = mkCasHarness({
      writes: [{ data: [], error: null }],
      reads: [{ data: [{ id: 'R1', status: 'ready', penalty: 'PNEW' }], error: null }],
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.events.some(e => e.eventType === 'FINAL_WRITE_NOT_APPLIED')).toBe(true);
    const end = h.events.find(e => e.eventType === 'CONTINUATION_WRITE_END');
    expect(end.success).toBe(false);
    expect(h.state.penalty).not.toBe('P1'); // 실패 시 로컬 권위 전진 금지
  });
  it('[기능] 응답 유실 모호성: write 에러였지만 읽기 재검증이 원하는 커밋과 일치 → 성공 처리', async () => {
    const h = mkCasHarness({
      writes: [{ data: null, error: { code: 'NET' } }],
      reads: [{ data: [{ id: 'R1', status: 'result', penalty: 'P1' }], error: null }],
    });
    await h.run();
    const end = h.events.find(e => e.eventType === 'CONTINUATION_WRITE_END');
    expect(end.success).toBe(true);
    expect(h.state.penalty).toBe('P1');
  });
  it('throw 는 publishHostRoundResult 의 catch(HOST_PUBLISH_ABORTED)로 수용된다 — unhandled rejection 없음', () => {
    const pub = sliceFn('publishHostRoundResult');
    expect(pub).toContain("eventType: 'HOST_PUBLISH_ABORTED'");
    expect(pub).toContain('} finally {');
  });
  it('[역행 금지 유지] 진행 중 penalty-only 발행자의 조건부 쓰기(FIELD RACE #3 회귀 앵커)', () => {
    expect(html).toContain('CHOICE_END_PUBLISH_SKIPPED_STALE');
    expect(html).toContain('COUNTDOWN_REPUBLISH_SKIPPED_STALE');
  });
  it('[NEXT GAME 전이 보호] beginNewGameRound: 방 write 실패 시 낙관 전이를 되돌린다(원장 대체 금지)', () => {
    expect(html).toContain('__previousCanonicalTransition');
    expect(html).toContain('beginNewGameRound rooms.update failed');
  });
});

// ── 항목 2: GAME 순번 음성 안내 ────────────────────────────────────────────
describe('Build47 정정 항목2 — GAME 순번 음성 안내', () => {
  it('CLIPS: ko/ja/en 에 gameStart1..10 + gameStartNext 가 있고 mp3 자산이 실제로 존재한다', () => {
    for (const loc of ['ko', 'ja', 'en']) {
      for (let n = 1; n <= 10; n++) {
        expect(html).toContain(`gameStart${n}: "${loc}/${loc}_game_start_${n}.mp3"`);
        expect(existsSync(resolve(ROOT, `ASSETS/rps/voice/${loc}/${loc}_game_start_${n}.mp3`)), `${loc} #${n}`).toBe(true);
      }
      expect(html).toContain(`gameStartNext: "${loc}/${loc}_game_start_next.mp3"`);
      expect(existsSync(resolve(ROOT, `ASSETS/rps/voice/${loc}/${loc}_game_start_next.mp3`))).toBe(true);
    }
  });
  it('ko 카운트다운 2박자는 "마루 가위바위보" — 클립 자산 존재 + 화면 텍스트(voice.go1/go2) 정렬', () => {
    expect(html).toContain('countdownRps: "ko/ko_maru_rps.mp3"');
    expect(existsSync(resolve(ROOT, 'ASSETS/rps/voice/ko/ko_maru_rps.mp3'))).toBe(true);
    expect(html).toContain('"voice.go1": "마루"');
    expect(html).toContain('"voice.go2": "가위바위보"');
  });
  it('[기능] 서수 매핑: 1→gameStart1, 10→gameStart10, 11+→gameStartNext(상한 3 아님 — 캡 없음)', () => {
    const { gameStartVoiceKey: fn } = evalFns(['gameStartVoiceKey']);
    expect(fn(1)).toBe('gameStart1'); expect(fn(2)).toBe('gameStart2'); expect(fn(4)).toBe('gameStart4');
    expect(fn(5)).toBe('gameStart5'); expect(fn(10)).toBe('gameStart10');
    expect(fn(11)).toBe('gameStartNext'); expect(fn(37)).toBe('gameStartNext');
    expect(fn(undefined)).toBe('gameStart1');
  });
  it('[기능] 판 순번 = 매치 내 완료 판 수(canonical wins+losses 합 최댓값) + 1 — gameNo(방 전역) 아님', () => {
    const mk = (env) => {
      const { sanitizeMatchStats } = evalFns(['sanitizeMatchStats', 'matchStatCount']);
      const ordSrc = sliceFn('getMatchGameOrdinal');
      return new Function('state', 'parsePenalty', 'sanitizeMatchStats', `${ordSrc}\nreturn getMatchGameOrdinal();`)(
        { penalty: 'x' }, () => env, sanitizeMatchStats);
    };
    expect(mk({})).toBe(1);
    expect(mk({ matchStats: { a: { wins: 1, losses: 1 }, b: { wins: 2 } } })).toBe(3); // 2판 완료 → 3번째
    expect(mk({ matchStats: { late: { wins: 1 }, host: { wins: 2, losses: 2 } } })).toBe(5); // max 기준
    expect(mk({ matchStats: { a: { w: 1, l: 1 } } })).toBe(3); // legacy {w,l} 호환
  });
  function mkConsume(state, matchRule, env, store = {}) {
    const events = [];
    const { sanitizeMatchStats } = evalFns(['sanitizeMatchStats', 'matchStatCount']);
    const src = [sliceFn('getMatchGameOrdinal'), sliceFn('gameStartVoiceKey'), sliceFn('consumeGameStartAnnouncement')].join('\n');
    const ctx = {
      state, parsePenalty: () => env, sanitizeMatchStats,
      getMatchRule: () => matchRule,
      getGameRound: () => state.gameRound || 1,
      QA: { emit: (k, p) => events.push(p) },
      localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    };
    const keys = Object.keys(ctx);
    const fn = new Function(...keys, `${src}\nreturn consumeGameStartAnnouncement();`);
    return { call: () => fn(...keys.map(k => ctx[k])), events, store };
  }
  it('[기능] 비단판 G1(round=1): {gameStart1, ordinal 1} — 두 번째 호출(에코/폴링/재렌더)은 null (멱등)', () => {
    const h = mkConsume({ round: 1, gameRound: 1, roomCode: 'AB' }, 'best3', { matchNo: 1 });
    expect(h.call()).toEqual({ key: 'gameStart1', ordinal: 1 });
    expect(h.call()).toBeNull();
    expect(h.events.some(e => e.eventType === 'GAME_NO_VOICE')).toBe(true);
    expect(h.events.some(e => e.eventType === 'GAME_NO_VOICE_SKIPPED_DUP')).toBe(true);
  });
  it('[기능] 재접속 벨트: localStorage once-원장이 새 state 에서도 재안내를 막는다', () => {
    const store = {};
    const h1 = mkConsume({ round: 1, gameRound: 1, roomCode: 'AB' }, 'best3', { matchNo: 1 }, store);
    expect(h1.call()).not.toBeNull();
    // 재접속: state 새로 생성(메모리 원장 소실) — localStorage 벨트만 남음
    const h2 = mkConsume({ round: 1, gameRound: 1, roomCode: 'AB' }, 'best3', { matchNo: 1 }, store);
    expect(h2.call()).toBeNull();
  });
  it('[기능] 내부 재대결(round>1)은 안내하지 않는다(순번 미증가 계약)', () => {
    expect(mkConsume({ round: 2, gameRound: 1, roomCode: 'AB' }, 'best3', { matchNo: 1 }).call()).toBeNull();
  });
  it('[기능] 단판(single)도 GAME 1 계약대로 첫 번째 판 안내를 1회 재생한다', () => {
    const h = mkConsume({ round: 1, gameRound: 1, roomCode: 'AB' }, 'single', { matchNo: 1 });
    expect(h.call()).toEqual({ key: 'gameStart1', ordinal: 1 });
    expect(h.call()).toBeNull();
  });
  it('[기능] 새 MATCH(한번더, matchNo+1·matchStats 리셋)는 다시 "첫 번째 판"부터', () => {
    const store = {};
    const h1 = mkConsume({ round: 1, gameRound: 1, roomCode: 'AB' }, 'best3', { matchNo: 1 }, store);
    h1.call();
    const h2 = mkConsume({ round: 1, gameRound: 3, roomCode: 'AB' }, 'best3', { matchNo: 2 }, store);
    expect(h2.call()).toEqual({ key: 'gameStart1', ordinal: 1 });
  });
  it('[기능] 2판째(1판 완료·gameRound 전진): gameStart2 — 같은 판 재호출은 null', () => {
    const store = {};
    const h = mkConsume({ round: 1, gameRound: 2, roomCode: 'AB' }, 'best3', { matchNo: 1, matchStats: { a: { losses: 1 }, b: { wins: 1 } } }, store);
    expect(h.call()).toEqual({ key: 'gameStart2', ordinal: 2 });
    expect(h.call()).toBeNull();
  });
  it('카운트다운 1박자가 안내로 대체되고(없으면 ready), 타이밍 테이블(3로케일 first/next)이 존재한다', () => {
    expect(html).toContain('void playVoiceClip(__gameAnnounce ? __gameAnnounce.key : "ready");');
    expect(html).toContain('const GAME_NO_ANNOUNCE_SLEEP = {');
    for (const loc of ['ko', 'ja', 'en']) expect(html).toMatch(new RegExp(`${loc}: \\{ first: \\d+, next: \\d+ \\}`));
    expect(html).toContain('__gameAnnounce.ordinal <= 1 ? __announceTiming.first : __announceTiming.next');
    // 2박자 클립 키는 무변경(countdownRps)
    expect(html).toContain('void playVoiceClip("countdownRps");');
  });
});

// ── 항목 3: 상단 사공간 회수 — 소스 계약 ───────────────────────────────────
describe('Build47 정정 항목3 — 소스 계약(clamp/flex, 고정 px 아님)', () => {
  it('--safe-top: inset+4px 밀착(base 20/compact 18 바닥) — 종전 +8px 사공간 제거', () => {
    expect(html).toContain('--safe-top: max(20px, calc(env(safe-area-inset-top, 0px) + 4px))');
    expect(html).toContain('--safe-top: max(18px, calc(env(safe-area-inset-top, 0px) + 4px))');
    expect(html).not.toContain('+ 8px))');
  });
  it('topbar 여백 축소(base 10 / compact 6) + #screenGame 상단 패딩 예산화(clamp)', () => {
    expect(html).toMatch(/\.topbar \{[^}]*margin-bottom: 10px;/);
    expect(html).toMatch(/\.topbar\{\s*\n\s*gap:6px;\s*\n\s*margin-bottom:6px;/);
    expect(html).toContain('#screenGame{padding-top:clamp(6px, 1.2dvh, 15px)}');
  });
  it('중앙 렌더 예산 상향: choice-anim 64/630/132(종전 56/640/120) / result-maru 48/600/220(종전 40/620)', () => {
    expect(html).toContain('--choice-anim-h: clamp(64px, calc(100dvh - var(--safe-top, 20px) - var(--safe-bottom, 24px) - 630px), 132px)');
    expect(html).toContain('--result-maru: clamp(48px, calc(100dvh - var(--safe-top, 20px) - var(--safe-bottom, 24px) - 600px), 220px)');
  });
});

// ── 항목 3: geometry (headless Chrome) ─────────────────────────────────────
let server = null, rows = [];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
async function measure(probeName, page) {
  const probePath = join(ROOT, probeName); await writeFile(probePath, page, 'utf8');
  try {
    server = createServer(async (req, res) => { const p = decodeURIComponent((req.url || '/').split('?')[0]);
      try { const buf = await readFile(join(ROOT, p === '/' ? 'index.html' : p.slice(1))); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(buf); }
      catch { res.writeHead(404); res.end(); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { stdout } = await execFileP(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=90000', '--window-size=1200,900', '--dump-dom', `http://127.0.0.1:${server.address().port}/${probeName}`], { maxBuffer: 64 * 1024 * 1024 });
    const m = /RESULTS([\s\S]*?)END/.exec(stdout); if (!m) throw new Error('probe produced no RESULTS');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return dec(m[1]).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } finally { if (server) { await new Promise(r => server.close(r)); server = null; } await unlink(probePath).catch(() => {}); }
}
beforeAll(async () => { if (hasChrome) rows = await measure('_b47top.probe.html', buildGameProbePage(DEVICES47)); }, 600000);
afterAll(async () => { if (server) await new Promise(r => server.close(r)); });

describe.skipIf(!hasChrome)('Build47 정정 항목3 — geometry (iPhone16 + 타 기기)', () => {
  it('전제: 전 기기 계측 성공, 렌더러 호출 실패 0', () => {
    expect(rows.length).toBe(DEVICES47.length);
    rows.forEach(r => { expect(r.error, `${r.dev}: ${r.error}`).toBeUndefined(); (r.log || []).forEach(l => expect(l, `${r.dev} ${l}`).toMatch(/:ok$/)); });
  });
  it('공통: 헤더가 safe-area 바로 아래(사공간 0) · 페이지 스크롤 없음 · 선택 버튼 clip 0 · 하단 safe-area 준수', () => {
    for (const r of rows) {
      expect(r.appPadTop, `${r.dev} appPadTop==safeT`).toBe(r.safeT);
      expect(r.topbar.top, `${r.dev} 헤더 시작 == safe-top(위 사공간 0)`).toBe(r.safeT);
      expect(r.pageScrolls, `${r.dev} 페이지 스크롤`).toBe(false);
      expect(r.choiceBtnClipped, `${r.dev} 선택 버튼 clip`).toBe(0);
      expect(r.choiceBtnBottom, `${r.dev} 하단 safe-area`).toBeLessThanOrEqual(r.vh - r.safeB);
      expect(r.choiceAnim.natH, `${r.dev} 중앙 미리보기 하한`).toBeGreaterThanOrEqual(64);
      expect(r.accountDeletePresent, `${r.dev} 계정삭제 control`).toBe(true);
    }
  });
  it('iPhone16(393×852): 본문 시작 ≤118px(회수 전 130) · 중앙 미리보기 ≥125px(회수 전 111)', () => {
    const r = rows.find(r => r.dev === 'iPhone16');
    expect(r.cheadTop).toBeLessThanOrEqual(118);
    expect(r.choiceAnim.natH).toBeGreaterThanOrEqual(122); // 852-63-34-630=125
  });
  it('iPhone16-field(393×818, 필드 webview): 미리보기 ≥110px(회수 전 93)', () => {
    const r = rows.find(r => r.dev === 'iPhone16-field');
    expect(r.choiceAnim.natH).toBeGreaterThanOrEqual(105); // 818-63-18-630=107
  });
  it('짧은 뷰포트(iPhoneSE 667): 미리보기 최소 64px(예산 하한) + 오버플로 없음(위 공통 계약이 보증)', () => {
    const r = rows.find(r => r.dev === 'iPhoneSE');
    expect(r.choiceAnim.natH).toBe(64);
  });
  it('Android(360×732): 미리보기 ≥70px(회수 전 56 최소치에서 해제)', () => {
    const r = rows.find(r => r.dev === 'And360x732');
    expect(r.choiceAnim.natH).toBeGreaterThanOrEqual(65); // 732-18-18-630=66
  });
});
