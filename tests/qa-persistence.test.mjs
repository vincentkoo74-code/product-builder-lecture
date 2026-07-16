import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Build17 — QA 자동저장/파일 export 회귀 방지.
// 실기기 필드테스트 시 앱 종료/새로고침에도 QA JSON을 자동 확보하는 계층을 검증한다.
// index.html 인라인 QA IIFE(실코드)를 그대로 추출해 mock 환경에서 실행한다(게임/판정 무관).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const QA_BLOCK = (() => {
  const start = html.indexOf('const QA = (() => {');
  const anchor = html.indexOf('if (QA_INSTRUMENTATION) { try { window.__qaMetrics = QA;', start);
  if (start < 0 || anchor < 0) throw new Error('QA IIFE block not found in index.html');
  return html.slice(start, anchor); // `const QA = (() => {...})();`
})();

function mapStorage(store, writes) {
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (writes) writes.push(['set', k, String(v)]); store.set(k, String(v)); },
    removeItem: (k) => { if (writes) writes.push(['remove', k]); store.delete(k); },
    clear: () => store.clear(),
  };
}

// shared.local / shared.session Map을 넘기면 인스턴스 간 공유(= 새로고침/강제종료 시나리오 재현).
// 새로고침: local+session 모두 공유. 강제종료: local 공유 + session 새 Map(프로세스 종료로 소멸).
// enabled=false → 출시(QA OFF) 빌드 시뮬레이션.
function loadQA(shared) {
  shared = shared || {};
  const enabled = shared.enabled !== false;
  const store = shared.local || new Map();
  const ssStore = shared.session || new Map();
  const localWrites = [];
  const sessionWrites = [];
  const localStorage = mapStorage(store, localWrites);
  const sessionStorage = mapStorage(ssStore, sessionWrites);
  const clipboard = { last: null, writeText: async (t) => { clipboard.last = t; } };
  const navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', clipboard };
  const location = { href: 'https://example.test/app', search: '' };
  const state = { roomCode: 'ROOM1', currentUserId: 'u1', role: 'host', participants: [{ id: 'u1' }, { id: 'u2' }] };
  const win = { Capacitor: undefined, __rpsShadowMetrics: undefined };
  const quietConsole = { log: () => {}, warn: () => {}, error: () => {} };
  const factory = new Function(
    'QA_INSTRUMENTATION', 'state', 'window', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Intl', 'console',
    QA_BLOCK + '\n; return QA;'
  );
  const QA = factory(enabled, state, win, navigator, location, localStorage, sessionStorage, Intl, quietConsole);
  return { QA, store, ssStore, localStorage, sessionStorage, localWrites, sessionWrites, clipboard, win, state };
}

describe('Build17 QA persistence (Layer 1) — 실코드', () => {
  let ctx;
  beforeEach(() => { ctx = loadQA(); });

  it('buildReport는 qa-report.v1 표준 스키마를 생성한다', () => {
    const r = ctx.QA.buildReport('manual');
    expect(r.schemaVersion).toBe('qa-report.v1');
    expect(r.app).toBe('WoorimaruRPS');
    expect(r.build).toBe('25');
    expect(r.buildLabel).toBe('build25');
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

  it('session id/startedAt는 sessionStorage에 시딩된다', () => {
    expect(ctx.ssStore.get('rpsQASession')).toBe(ctx.QA._m.session);
    expect(Number(ctx.ssStore.get('rpsQAStartedAt'))).toBe(ctx.QA._m.startedAt);
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
});

describe('Build17 비침습성 (QA OFF = 완전 no-op) — 실코드', () => {
  it('QA OFF(출시 빌드)에서는 session/local storage에 아무 것도 쓰지 않는다', () => {
    const ctx = loadQA({ enabled: false });
    // IIFE 생성(session/startedAt 시딩 포함) 이후 어떤 저장도 없어야 한다.
    expect(ctx.sessionWrites).toEqual([]);
    expect(ctx.localWrites).toEqual([]);
    // 세션 id는 여전히 순수 계산으로 생성된다.
    expect(typeof ctx.QA._m.session).toBe('string');
    expect(typeof ctx.QA._m.startedAt).toBe('number');
    // 지속화 API도 no-op(false 반환, 미기록).
    expect(ctx.QA.saveNow('debounced')).toBe(false);
    expect(ctx.QA.flush('background')).toBe(false);
    ctx.QA.scheduleSave();
    expect(ctx.localWrites).toEqual([]);
    expect(ctx.sessionWrites).toEqual([]);
  });

  it('QA ON에서는 session 시딩으로 sessionStorage에 정확히 2개 키만 쓴다', () => {
    const ctx = loadQA();
    const keys = ctx.sessionWrites.map((w) => w[1]).sort();
    expect(keys).toEqual(['rpsQASession', 'rpsQAStartedAt']);
  });
});

describe('Build17 세션 복구 판별 (HIGH-1 회귀 방지) — 실코드', () => {
  it('강제종료 후 재시작(session 소멸)은 cross-session 복구로 처리한다', () => {
    const shared = { local: new Map(), session: new Map() };
    const a = loadQA(shared);
    a.QA.emit('metric', { eventType: 'X' });
    a.QA.saveNow('background');
    const idA = a.QA._m.session;
    // 프로세스 종료: localStorage는 유지되지만 sessionStorage는 소멸 → 새 Map.
    const b = loadQA({ local: shared.local, session: new Map() });
    expect(b.QA._m.session).not.toBe(idA); // 새 세션 id
    b.QA.restore();
    expect(b.QA._m.recoveredAt).toBeTruthy();            // 진짜 복구 라벨
    expect(b.QA._m.previousSession).toBeTruthy();
    expect(b.QA._m.previousSession.session.sessionId).toBe(idA);
    // 복구된 previousSession이 새 리포트에 포함(데이터 손실 없음).
    const r = b.QA.buildReport('app-start');
    expect(r.previousSession.session.sessionId).toBe(idA);
    expect(r.recoveredAt).toBeTruthy();
  });

  it('단순 새로고침(session 유지)은 복구 라벨을 달지 않되 데이터는 이월한다', () => {
    const shared = { local: new Map(), session: new Map() };
    const a = loadQA(shared);
    a.QA.emit('metric', { eventType: 'X' });
    a.QA.saveNow('background');
    const idA = a.QA._m.session;
    // in-place 새로고침: localStorage + sessionStorage 모두 유지.
    const b = loadQA(shared);
    expect(b.QA._m.session).toBe(idA); // sessionStorage로 id 연속
    b.QA.restore();
    expect(b.QA._m.recoveredAt).toBeFalsy();   // 새로고침은 "복구" 아님
    expect(b.QA._m.previousSession).toBeTruthy(); // 그러나 직전 데이터는 손실 없이 이월
    expect(b.QA._m.previousSession.session.sessionId).toBe(idA);
  });

  it('새로고침 시 QA_SESSION_RECOVERED 메트릭은 남기지 않는다(정상 재실행 구분)', () => {
    // 초기화 블록이 recoveredAt 유무로 게이팅함을 정적으로 보장.
    expect(html).toMatch(/QA\.restore\(\)[\s\S]{0,200}QA\._m\.recoveredAt[\s\S]{0,200}QA_SESSION_RECOVERED/);
  });

  it('restore는 중첩 previousSession을 1단계로 축약(무한 성장 방지)한다', () => {
    const ctx = loadQA();
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

  it('이월된 previousSession의 recent/snapshots는 캡된다(MEDIUM-1 재직렬화 비용)', () => {
    const ctx = loadQA();
    const prevReport = {
      schemaVersion: 'qa-report.v1', session: { sessionId: 'BIG', endedAt: 2 }, exportReason: 'background',
      qaMetrics: {
        summary: {},
        recent: Array.from({ length: 300 }, (_, i) => ({ i })),
        snapshots: Array.from({ length: 50 }, (_, i) => ({ i })),
      },
    };
    ctx.store.set(ctx.QA.storageKey, JSON.stringify(prevReport));
    ctx.QA.restore();
    expect(ctx.QA._m.previousSession.qaMetrics.recent.length).toBe(100);
    expect(ctx.QA._m.previousSession.qaMetrics.snapshots.length).toBe(20);
  });
});

describe('Build17 QA file export (Layer 2) — 실코드', () => {
  it('Capacitor 없으면 클립보드 fallback으로 export한다', async () => {
    const ctx = loadQA();
    const out = await ctx.QA.exportFile('manual');
    expect(out.saved).toBe(false);
    expect(out.clipboard).toBe(true);
    expect(ctx.clipboard.last).toContain('"schemaVersion": "qa-report.v1"');
    // 파일명: 금지문자(: 등) 없음, build25 스탬프.
    expect(out.filename).toMatch(/^qa-report-build25-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
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
    expect(calls.write.path).toMatch(/^qa-report-build25-.*\.json$/);
    expect(out.uri).toContain('file:///Documents/');
    expect(calls.share.url).toBe(out.uri);
    // Build23: Share 다이얼로그 title도 하드코딩('build21') 대신 QA_BUILD_LABEL을 쓰도록 고쳤다 —
    // 파일명과 동일한 클래스의 불일치 재발 방지 회귀 테스트.
    expect(calls.share.title).toBe('QA Report build25');
  });
});

// ── IIFE 밖 배선(정적 계약) 회귀 방지 ─────────────────────────────────────
describe('Build17 wiring contract (static)', () => {
  it('session id는 sessionStorage로 시딩된다(HIGH-1)', () => {
    expect(html).toContain("sessionStorage.getItem(k)");
    expect(html).toContain("'rpsQASession'");
  });
  it('emit은 디바운스 저장을 예약한다', () => {
    expect(html).toMatch(/scheduleSave\(\);\s*\}\s*catch \(e\) \{\}\s*\/\/ Build17/);
  });
  it('scheduleSave는 최대 staleness(5s)를 보장한다(MEDIUM-2)', () => {
    expect(html).toMatch(/Date\.now\(\) - lastSaveAt > 5000/);
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
  it('QA 저장 버튼(QA💾)이 exportFile을 호출하고 연타를 막는다', () => {
    expect(html).toContain('qaSaveBtn');
    expect(html).toContain("QA.exportFile('manual')");
    expect(html).toMatch(/if \(exporting\) return;/);
  });
  it('QA 로그 prefix 5종이 존재한다', () => {
    ['[QA-SAVE]', '[QA-FLUSH]', '[QA-RESTORE]', '[QA-REPORT]', '[QA-METRIC]'].forEach((p) => {
      expect(html).toContain(p);
    });
  });
});
