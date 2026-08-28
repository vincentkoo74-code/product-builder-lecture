import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// JP-BL-027 — **행위 수준** 계약 (CEO §12 매트릭스 A/B/C/D).
//
// 정적 정규식은 "코드가 이 형태를 갖췄다"만 보장한다. 이 파일은 실제 함수를 추출해 실행하고,
// 무음 0행일 때 로컬 상태가 커밋되지 않는지를 **동작으로** 확인한다.
//
// 대역은 실제 PostgREST 계약을 모델링한다:
//   await update(...).eq(...)          → { error }                 (HTTP 204)
//   await update(...).eq(...).select() → { data: [영향 행], error }  (0행이어도 error=null)

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  if (i < 0) throw new Error(`시작 마커를 찾지 못했다: ${startMarker}`);
  const j = html.indexOf(endMarker, i + startMarker.length);
  if (j < 0) throw new Error(`끝 마커를 찾지 못했다: ${endMarker}`);
  return html.slice(i, j);
}

// mode: 'success' | 'zero' | 'error'
function makeDb(mode, { rowsFor } = {}) {
  const calls = [];
  const result = (col, val) => {
    if (mode === 'error') return { data: null, error: { message: 'boom', code: 'PGRST999' } };
    if (mode === 'zero') return { data: [], error: null };
    const rows = rowsFor ? rowsFor(col, val)
      : (col === 'id' ? (Array.isArray(val) ? val.map((v) => ({ id: v })) : [{ id: val }])
                      : [{ id: '__scoped__' }]);
    return { data: rows, error: null };
  };
  const chain = (table, op, patch) => {
    const f = {};
    const b = {
      eq: (c, v) => { f[c] = v; return b; },
      in: (c, v) => { f[c] = v; return b; },
      select: () => {
        calls.push({ table, op, patch, filters: { ...f }, withSelect: true });
        const lastCol = Object.keys(f)[Object.keys(f).length - 1];
        return Promise.resolve(result(lastCol, f[lastCol]));
      },
      then: (res, rej) => {
        calls.push({ table, op, patch, filters: { ...f }, withSelect: false });
        return Promise.resolve(mode === 'error'
          ? { data: null, error: { message: 'boom' } } : { data: null, error: null }).then(res, rej);
      },
    };
    return b;
  };
  const db = { from: (table) => ({
    update: (patch) => chain(table, 'update', patch),
    delete: () => chain(table, 'delete'),
  }) };
  return { db, calls };
}

// ── markReady ────────────────────────────────────────────────────────────────
const MARK_READY_SRC = extractBlock('async function markReady() {', 'async function directStartGame() {');

function loadMarkReady(mode) {
  const { db, calls } = makeDb(mode, {
    // eq('id', 'me') 를 쓰므로 성공 시 내 행 1건이 돌아온다.
    rowsFor: (c, v) => (c === 'id' && v === 'me' ? [{ id: 'me' }] : []),
  });
  const state = { currentUserId: 'me', roomCode: 'R1', participants: [{ id: 'me', is_ready: false }] };
  const toasts = []; const emitted = []; const fetched = [];
  const btn = { disabled: false, textContent: '' };
  const factory = new Function(
    'state','db','QA','t','getOnlineMode','SoundManager','$','setBtnText','showToast',
    'renderReadyList','triggerReplayIfLastReady','fetchParticipants',
    'isCurrentRoundParticipant','isSafeParticipant','isConfirmedLoser','showLoserWaitScreen','showScreen',
    MARK_READY_SRC + '\n; return markReady;'
  );
  const markReady = factory(
    state, db, { emit: (ch, d) => emitted.push(d) }, (k) => k, () => true,
    { unlock: () => {} }, () => btn, (b, txt) => { b.textContent = txt; },
    (m) => toasts.push(m), () => {}, async () => {}, async (rc) => { fetched.push(rc); },
    () => true, () => false, () => false, () => {}, () => {}
  );
  return { markReady, state, toasts, emitted, fetched, btn, calls };
}

describe('[JP-BL-027 행위] markReady', () => {
  it('A. 성공: 영향 행 1건이면 로컬 ready 를 커밋한다', async () => {
    const env = loadMarkReady('success');
    await env.markReady();
    expect(env.state.participants[0].is_ready, '성공인데 로컬 커밋이 안 됐다').toBe(true);
    expect(env.state.myReadyLocallySetAt).toBeTypeOf('number');
    expect(env.emitted.some((e) => e?.eventType === 'ZERO_ROW_WRITE')).toBe(false);
  });

  it('B. 무음 0행: 로컬 ready 를 커밋하지 않는다', async () => {
    const env = loadMarkReady('zero');
    await env.markReady();
    expect(env.state.participants[0].is_ready, '0행인데 로컬이 ready 로 바뀌었다 — UI/DB 괴리').toBe(false);
    expect(env.state.myReadyLocallySetAt, '0행인데 ready 시각이 기록됐다').toBeUndefined();
  });

  it('B. 무음 0행: ZERO_ROW_WRITE 메트릭 + 권위 재조회 + 동기화 안내', async () => {
    const env = loadMarkReady('zero');
    await env.markReady();
    const m = env.emitted.find((e) => e?.eventType === 'ZERO_ROW_WRITE');
    expect(m, 'ZERO_ROW_WRITE 메트릭이 없다').toBeTruthy();
    expect(m.context).toBe('markReady');
    expect(env.fetched, '권위 상태를 다시 읽지 않았다').toContain('R1');
    expect(env.toasts).toContain('common.syncError');
  });

  it('B. 무음 0행: 버튼을 다시 누를 수 있게 복구한다', async () => {
    const env = loadMarkReady('zero');
    await env.markReady();
    expect(env.btn.disabled).toBe(false);
  });

  it('C. 하드 오류: 로컬 커밋 없이 오류 경로로 간다', async () => {
    const env = loadMarkReady('error');
    await env.markReady();
    expect(env.state.participants[0].is_ready).toBe(false);
    expect(env.toasts.some((x) => x === 'toast.error')).toBe(true);
    expect(env.emitted.some((e) => e?.eventType === 'ZERO_ROW_WRITE'),
      '하드 오류를 0행으로 잘못 분류했다').toBe(false);
  });

  it('D. 잘못된 행: 다른 참가자 행이 돌아오면 실패로 본다 (fail-closed)', async () => {
    const { db, calls } = makeDb('success', { rowsFor: () => [{ id: 'someone-else' }] });
    const state = { currentUserId: 'me', roomCode: 'R1', participants: [{ id: 'me', is_ready: false }] };
    const toasts = []; const emitted = []; const btn = { disabled: false };
    const factory = new Function(
      'state','db','QA','t','getOnlineMode','SoundManager','$','setBtnText','showToast',
      'renderReadyList','triggerReplayIfLastReady','fetchParticipants',
      'isCurrentRoundParticipant','isSafeParticipant','isConfirmedLoser','showLoserWaitScreen','showScreen',
      MARK_READY_SRC + '\n; return markReady;'
    );
    const markReady = factory(state, db, { emit: (ch, d) => emitted.push(d) }, (k) => k, () => true,
      { unlock: () => {} }, () => btn, () => {}, (m) => toasts.push(m), () => {}, async () => {},
      async () => {}, () => true, () => false, () => false, () => {}, () => {});
    await markReady();
    expect(state.participants[0].is_ready, '엉뚱한 행이 돌아왔는데 성공으로 처리했다').toBe(false);
    expect(emitted.some((e) => e?.eventType === 'ZERO_ROW_WRITE')).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('write 가 .select() 를 사용해 영향 행을 요청한다', async () => {
    const env = loadMarkReady('success');
    await env.markReady();
    expect(env.calls.some((c) => c.withSelect), '.select() 없이 write 했다').toBe(true);
  });
});

// ── updateParticipantChoice ──────────────────────────────────────────────────
const CHOICE_SRC = extractBlock('async function updateParticipantChoice(choice) {', '// --- 기존 UI 제어 로직 수정 ---');

function loadChoice(mode, rowsFor) {
  const { db, calls } = makeDb(mode, { rowsFor });
  const state = { currentUserId: 'me', roomCode: 'R1' };
  const emitted = [];
  const factory = new Function('state','db','QA', CHOICE_SRC + '\n; return updateParticipantChoice;');
  return { fn: factory(state, db, { emit: (ch, d) => emitted.push(d) }), emitted, calls };
}

describe('[JP-BL-027 행위] updateParticipantChoice', () => {
  it('A. 성공 → true', async () => {
    const env = loadChoice('success', (c, v) => (v === 'me' ? [{ id: 'me' }] : []));
    await expect(env.fn('rock')).resolves.toBe(true);
  });

  it('B. 무음 0행 → false + ZERO_ROW_WRITE', async () => {
    const env = loadChoice('zero');
    await expect(env.fn('rock')).resolves.toBe(false);
    expect(env.emitted.find((e) => e?.eventType === 'ZERO_ROW_WRITE')?.context)
      .toBe('updateParticipantChoice');
  });

  it('C. 하드 오류 → false (0행으로 오분류하지 않는다)', async () => {
    const env = loadChoice('error');
    await expect(env.fn('rock')).resolves.toBe(false);
    expect(env.emitted.some((e) => e?.eventType === 'ZERO_ROW_WRITE')).toBe(false);
  });

  it('D. 잘못된 행 → false', async () => {
    const env = loadChoice('success', () => [{ id: 'other' }]);
    await expect(env.fn('rock')).resolves.toBe(false);
  });
});

// ── updateRoomStatus ─────────────────────────────────────────────────────────
const ROOM_STATUS_SRC = extractBlock('async function updateRoomStatus(status) {', '// Build19: RESULT/READY 전환 시');

function loadRoomStatus(mode, rowsFor) {
  const { db } = makeDb(mode, { rowsFor });
  const state = { roomCode: 'R1' };
  const emitted = [];
  const factory = new Function('state','db','QA','isRoomClosingOrDestroyed',
    ROOM_STATUS_SRC + '\n; return updateRoomStatus;');
  return { fn: factory(state, db, { emit: (ch, d) => emitted.push(d) }, () => false), emitted };
}

describe('[JP-BL-027 행위] updateRoomStatus', () => {
  it('A. 성공 → true', async () => {
    const env = loadRoomStatus('success', (c, v) => (v === 'R1' ? [{ id: 'R1' }] : []));
    await expect(env.fn('ready')).resolves.toBe(true);
  });

  it('B. 무음 0행 → false + ZERO_ROW_WRITE(context/status 포함)', async () => {
    const env = loadRoomStatus('zero');
    await expect(env.fn('ready')).resolves.toBe(false);
    const m = env.emitted.find((e) => e?.eventType === 'ZERO_ROW_WRITE');
    expect(m?.context).toBe('updateRoomStatus');
    expect(m?.status).toBe('ready');
  });

  it('C. 하드 오류 → false', async () => {
    const env = loadRoomStatus('error');
    await expect(env.fn('ready')).resolves.toBe(false);
    expect(env.emitted.some((e) => e?.eventType === 'ZERO_ROW_WRITE')).toBe(false);
  });

  it('D. 잘못된 방 행 → false', async () => {
    const env = loadRoomStatus('success', () => [{ id: 'OTHER' }]);
    await expect(env.fn('ready')).resolves.toBe(false);
  });
});
