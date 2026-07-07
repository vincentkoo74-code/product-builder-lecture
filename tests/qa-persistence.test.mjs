import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Build17 — QA 자동저장/파일 export 회귀 방지.
// 실기기 필드테스트 시 앱 종료/새로고침에도 QA JSON을 자동 확보하는 계층을 검증한다.
// index.html 인라인 QA IIFE(실코드)를 그대로 추출해 mock 환경에서 실행한다(게임/판정 무관).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ── 실코드 추출: `const QA = (() => { ... })();` 블록 ──────────────────────
function loadQA() {
  const start = html.indexOf('const QA = (() => {');
  const anchor = html.indexOf('if (QA_INSTRUMENTATION) { try { window.__qaMetrics = QA;', start);
  if (start < 0 || anchor < 0) throw new Error('QA IIFE block not found in index.html');
  const block = html.slice(start, anchor); // `const QA = (() => {...})();`

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
  const clipboard = { last: null, writeText: async (t) => { clipboard.last = t; } };
  const navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', clipboard };
  const location = { href: 'https://example.test/app', search: '' };
  const state = { roomCode: 'ROOM1', currentUserId: 'u1', role: 'host', participants: [{ id: 'u1' }, { id: 'u2' }] };
  const win = { Capacitor: undefined, __rpsShadowMetrics: undefined };
  const factory = new Function(
    'QA_INSTRUMENTATION', 'state', 'window', 'navigator', 'location', 'localStorage', 'Intl', 'console',
    block + '\n; return QA;'
  );
  const quietConsole = { log: () => {}, warn: () => {}, error: () => {} };
  const QA = factory(true, state, win, navigator, location, localStorage, Intl, quietConsole);
  return { QA, store, localStorage, clipboard, win, state };
}

describe('Build17 QA persistence (Layer 1) — 실코드', () => {
  let ctx;
  beforeEach(() => { ctx = loadQA(); });

  it('buildReport는 qa-report.v1 표준 스키마를 생성한다', () => {
    const r = ctx.QA.buildReport('manual');
    expect(r.schemaVersion).toBe('qa-report.v1');
    expect(r.app).toBe('WoorimaruRPS');
    expect(r.build).toBe('17');
    expect(r.buildLabel).toBe('build17');
    expect(r.exportReason).toBe('manual');
    expect(typeof r.createdAt).toBe('string');
    expect(r.session && typeof r.session.sessionId).toBe('string');
    expect(r.qaMetrics).toBeTruthy();
    expect(r.qaMetrics.summary).toBeTruthy();
    // 디바이스 파싱(iOS UA → iPhone / 17.5)
    expect(r.device.platform).toBe('web'); // Capacitor 없음 → web
    expect(r.device.model).toBe('iPhone');
    expect(r.device.osVersion).toBe('17.5');
    expect(typeof r.timezone).toBe('string');
    expect(r.userAgent).toContain('iPhone');
  });

  it('saveNow는 localStorage에 리포트를 지속화한다', () => {
    expect(ctx.QA.saveNow('debounced')).toBe(true);
    const raw = ctx.store.get(ctx.QA.storageKey);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe('qa-report.v1');
    expect(parsed.exportReason).toBe('debounced');
  });

  it('flush는 지정한 reason으로 즉시 저장한다', () => {
    expect(ctx.QA.flush('background')).toBe(true);
    const parsed = JSON.parse(ctx.store.get(ctx.QA.storageKey));
    expect(parsed.exportReason).toBe('background');
  });

  it('restore는 직전 세션(다른 sessionId)을 previousSession으로 복구한다', () => {
    // 강제종료된 직전 세션을 시뮬레이션: 다른 sessionId 리포트를 저장.
    const prevReport = {
      schemaVersion: 'qa-report.v1', build: '17', buildLabel: 'build17',
      exportReason: 'background', createdAt: '2026-07-07T00:00:00.000Z',
      session: { sessionId: 'OLDSESSION', startedAt: 1, endedAt: 2 },
      qaMetrics: { summary: { metrics: 3 } },
    };
    ctx.store.set(ctx.QA.storageKey, JSON.stringify(prevReport));
    const restored = ctx.QA.restore();
    expect(restored).toBeTruthy();
    expect(ctx.QA._m.previousSession).toBeTruthy();
    expect(ctx.QA._m.previousSession.session.sessionId).toBe('OLDSESSION');
    expect(typeof ctx.QA._m.recoveredAt).toBe('string');
    // 복구 후 새 리포트는 previousSession을 포함한다.
    const r = ctx.QA.buildReport('app-start');
    expect(r.previousSession.session.sessionId).toBe('OLDSESSION');
    expect(r.recoveredAt).toBeTruthy();
  });

  it('restore는 같은 sessionId(단순 새로고침 재로드)면 복구하지 않는다', () => {
    const same = ctx.QA.buildReport('debounced');
    ctx.store.set(ctx.QA.storageKey, JSON.stringify(same));
    ctx.QA.restore();
    expect(ctx.QA._m.previousSession).toBeFalsy();
  });

  it('restore는 중첩 previousSession을 1단계로 축약(무한 성장 방지)한다', () => {
    const prevReport = {
      schemaVersion: 'qa-report.v1',
      session: { sessionId: 'GEN2', endedAt: 2 }, exportReason: 'background',
      previousSession: { session: { sessionId: 'GEN1' }, qaMetrics: { huge: 'x'.repeat(1000) } },
      qaMetrics: { summary: {} },
    };
    ctx.store.set(ctx.QA.storageKey, JSON.stringify(prevReport));
    ctx.QA.restore();
    const nested = ctx.QA._m.previousSession.previousSession;
    expect(nested.note).toBe('older-session-omitted');
    expect(nested.qaMetrics).toBeUndefined();
  });
});

describe('Build17 QA file export (Layer 2) — 실코드', () => {
  it('Capacitor 없으면 클립보드 fallback으로 export한다', async () => {
    const ctx = loadQA();
    const out = await ctx.QA.exportFile('manual');
    expect(out.saved).toBe(false);
    expect(out.clipboard).toBe(true);
    expect(ctx.clipboard.last).toContain('"schemaVersion": "qa-report.v1"');
    // 파일명: 금지문자(: 등) 없음, build17 스탬프.
    expect(out.filename).toMatch(/^qa-report-build17-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
    expect(out.filename).not.toContain(':');
  });

  it('Capacitor Filesystem이 있으면 Documents에 저장하고 Share한다', async () => {
    const ctx = loadQA();
    const calls = { write: null, share: null };
    ctx.win.Capacitor = {
      getPlatform: () => 'ios',
      Plugins: {
        Filesystem: { writeFile: async (o) => { calls.write = o; return { uri: 'file:///Documents/' + o.path }; } },
        Share: { share: async (o) => { calls.share = o; } },
      },
    };
    const out = await ctx.QA.exportFile('manual');
    expect(out.saved).toBe(true);
    expect(out.shared).toBe(true);
    expect(out.clipboard).toBe(false);
    expect(calls.write.directory).toBe('DOCUMENTS');
    expect(calls.write.encoding).toBe('utf8');
    expect(calls.write.path).toMatch(/^qa-report-build17-.*\.json$/);
    expect(out.uri).toContain('file:///Documents/');
    expect(calls.share.url).toBe(out.uri);
  });
});

// ── IIFE 밖 배선(정적 계약) 회귀 방지 ─────────────────────────────────────
describe('Build17 wiring contract (static)', () => {
  it('emit은 디바운스 저장을 예약한다', () => {
    expect(html).toMatch(/scheduleSave\(\);\s*\}\s*catch \(e\) \{\}\s*\/\/ Build17/);
  });
  it('snapshot(게임/방 종료)은 즉시 flush한다', () => {
    expect(html).toContain("flush('final-result')");
  });
  it('background 진입 시 flush 트리거가 설치된다', () => {
    expect(html).toMatch(/visibilitychange[\s\S]{0,200}flush\('background'\)/);
    expect(html).toMatch(/pagehide[\s\S]{0,120}flush\('background'\)/);
    expect(html).toMatch(/appStateChange[\s\S]{0,200}flush\('background'\)/);
  });
  it('앱 시작 시 restore + app-start 저장을 수행한다', () => {
    expect(html).toContain('QA.restore()');
    expect(html).toContain("QA.saveNow('app-start')");
  });
  it('QA 저장 버튼(QA💾)이 exportFile을 호출한다', () => {
    expect(html).toContain('qaSaveBtn');
    expect(html).toContain("QA.exportFile('manual')");
  });
  it('QA 로그 prefix 5종이 존재한다', () => {
    ['[QA-SAVE]', '[QA-FLUSH]', '[QA-RESTORE]', '[QA-REPORT]', '[QA-METRIC]'].forEach((p) => {
      expect(html).toContain(p);
    });
  });
});
