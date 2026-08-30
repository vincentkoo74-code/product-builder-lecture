import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// JP-BL-027 — 클라이언트 write 무결성 계약.
//
// 실측 근거(로컬 PostgREST 16.2 + Postgres 17, 2026-08-28):
//   정상 행 PATCH (supabase-js 기본)  → HTTP 204 / 0바이트 / error=null
//   RLS 로 가려진 행 PATCH            → HTTP 204 / 0바이트 / error=null   ← 구별 불가
//   .select() 를 붙이면               → 1행 vs 0행 으로 갈라진다
//
// 따라서 `error === null` 은 write 성공의 증거가 아니다.
// 보호 대상 write 는 영향받은 행을 되돌려받아 카디널리티와 행 id 를 확인해야 한다.

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const fn = (name) => {
  const i = html.indexOf(`async function ${name}(`);
  if (i < 0) throw new Error(`함수를 찾지 못했다: ${name}`);
  return html.slice(i, i + 3200);
};

// 이번 슬라이스에서 인라인 검증을 적용한 write 들.
const PROTECTED = [
  ['markReady', 'markReady'],
  ['markReadyFromLobby', 'markReadyFromLobby'],
  ['updateParticipantChoice', 'updateParticipantChoice'],
  ['updateRoomStatus', 'updateRoomStatus'],
  ['updateRoomStatusScheduled', 'updateRoomStatusScheduled'],
  ['reserveDeferredLeave', 'reserveDeferredLeave'],
];

describe('[JP-BL-027] 보호 대상 write 가 영향 행을 검증한다', () => {
  for (const [name, ctx] of PROTECTED) {
    const body = fn(name);

    it(`${name}: mutation 에 .select() 를 붙여 영향 행을 되돌려받는다`, () => {
      expect(body, `${name} 이 .select() 없이 write 한다 — 무음 0행을 구별할 수 없다`)
        .toMatch(/\.select\('id'\)/);
    });

    it(`${name}: error 만이 아니라 행 수를 검사한다`, () => {
      expect(body, `${name} 이 행 수를 검사하지 않는다`).toMatch(/(?:ready)?[Rr]ows\.length !== 1/);
    });

    it(`${name}: 반환된 행이 의도한 행인지 확인한다 (wrong-row fail-closed)`, () => {
      expect(body, `${name} 이 행 id 를 대조하지 않는다`).toMatch(/(?:ready)?[Rr]ows\[0\]\?\.id !== /);
    });

    it(`${name}: 0행/불일치를 관측 가능한 신호로 남긴다`, () => {
      expect(body).toMatch(new RegExp(`eventType: 'ZERO_ROW_WRITE'[\\s\\S]{0,200}context: '${ctx}'`));
    });

    it(`${name}: 하드 오류를 0행과 다르게 처리한다`, () => {
      expect(body).toMatch(/res(?:\w*)?\s*&&\s*res(?:\w*)?\.error|readyRes && readyRes\.error/);
    });
  }
});

describe('[JP-BL-027] 로컬 상태를 백엔드 확인 전에 커밋하지 않는다', () => {
  it('markReady: 0행이면 ZERO_ROW_WRITE 로 throw 해 로컬 ready 커밋을 건너뛴다', () => {
    const body = fn('markReady');
    const throwIdx = body.indexOf("staleErr.code = 'ZERO_ROW_WRITE'");
    const commitIdx = body.indexOf('state.myReadyLocallySetAt = Date.now()');
    expect(throwIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(throwIdx, '검증이 로컬 커밋보다 먼저 와야 한다').toBeLessThan(commitIdx);
  });

  it('markReady: 0행일 때 권위 상태를 재조회하고 동기화 안내를 띄운다', () => {
    const body = fn('markReady');
    expect(body).toMatch(/e\.code === 'ZERO_ROW_WRITE'/);
    expect(body).toMatch(/fetchParticipants\(state\.roomCode\)/);
    expect(body).toMatch(/showToast\(t\("common\.syncError"\)\)/);
  });

  it('markReadyFromLobby: 온라인 분기에서 0행이면 커밋 전에 return 한다', () => {
    // 주의: 오프라인 분기(`if (!getOnlineMode())`)는 백엔드 write 자체가 없으므로
    // 로컬 커밋이 정상이다. 온라인 write 경로만 검사한다.
    const start = html.indexOf("db.from('participants').update({ is_ready: true }).eq('id', me.id).select('id')");
    expect(start, '온라인 ready write(.select 포함)를 찾지 못했다').toBeGreaterThan(-1);
    const body = html.slice(start, start + 1400);
    const guardIdx = body.indexOf('return; // 로컬 ready 상태를 커밋하지 않는다.');
    const commitIdx = body.indexOf('me.is_ready = true');
    expect(guardIdx, '0행 가드가 없다').toBeGreaterThan(-1);
    expect(commitIdx, '온라인 커밋 지점을 찾지 못했다').toBeGreaterThan(-1);
    expect(guardIdx, '가드가 로컬 커밋보다 먼저여야 한다').toBeLessThan(commitIdx);
  });

  it('reserveDeferredLeave: 0행이면 성공 토스트 전에 throw 한다', () => {
    const body = fn('reserveDeferredLeave');
    const throwIdx = body.indexOf("staleErr.code = 'ZERO_ROW_WRITE'");
    const toastIdx = body.indexOf('toast.leaveAfterRound');
    expect(throwIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeGreaterThan(-1);
    expect(throwIdx, '예약 성공 안내보다 검증이 먼저여야 한다').toBeLessThan(toastIdx);
  });
});

describe('[JP-BL-027] 의도적으로 건드리지 않은 경로 (회귀 방지)', () => {
  it('조건부 CAS write 는 0행이 정상 가드이므로 검증을 붙이지 않는다', () => {
    // recordRoundResolution/myResult 의 .eq('status','result') 는 2-writer 레이스 방어용
    // 조건부 UPDATE 다. 0행 = "이미 다른 단말이 확정함" 이라는 정상 결과이므로
    // 실패로 승격하면 안 된다.
    const cas = html.match(/\.update\(\{ status: 'game_over' \}\)\.eq\('id', state\.roomCode\)\.eq\('status', 'result'\)/g) || [];
    expect(cas.length, 'CAS 가드 write 가 사라졌다').toBeGreaterThanOrEqual(2);
    for (const c of cas) expect(c).not.toMatch(/\.select\(/);
  });

  it('nextRound 는 Build29 계약(오류 throw 승격 + 재시도 안전망)을 그대로 유지한다', () => {
    // JP-BL-027-B 이후 구문이 바뀌었다(구조분해 → res 객체 + 행수 검증). 고정해야 하는 것은
    // **변수명이 아니라 계약**이다: 네 write 각각의 error 가 검사되어 throw 로 승격되는가.
    // 행수 계약은 tests/jp-bl-027b-nextround-write-integrity.test.mjs 가 별도로 강제한다.
    for (const ctx of ['participants.reset', 'participants.markSafe', 'participants.markLoser', 'rooms.advance']) {
      expect(html, ctx).toContain(`throw new Error('nextRound ${ctx} failed: `);
    }
    // 재시도 안전망(성공 시 카운터 정리)이 모든 write 뒤에 남아 있다.
    expect(html).toMatch(/delete state\.rematchAdvanceRetryAttempts\[getRematchAdvanceRetryKey\(\)\]/);
  });

  it('promoteParticipantToHost 는 기존 검증 재조회를 유지한다 (중복 적용 안 함)', () => {
    const body = fn('promoteParticipantToHost');
    expect(body).toMatch(/select\('id,is_host'\)/);
    expect(body).toMatch(/HOST_PROMOTE_WRITE_FAILED/);
  });

  it('becomeNextHost 는 verifyExactlyOneHost 사후 검증을 유지한다', () => {
    expect(html).toMatch(/verifyExactlyOneHost\(state\.roomCode, state\.currentUserId\)/);
  });
});

describe('[JP-BL-027] 실패 분류가 코드 수준에서 구분된다', () => {
  it('ZERO_ROW_WRITE 코드가 하드 오류와 구분된다', () => {
    expect(html).toMatch(/staleErr\.code = 'ZERO_ROW_WRITE'/);
    expect(html).toMatch(/e\.code === 'ZERO_ROW_WRITE'/);
  });

  it('사용자에게 DB 내부를 노출하지 않는다 (i18n 키만 사용)', () => {
    const body = fn('markReady');
    const zeroBranch = body.slice(body.indexOf("e.code === 'ZERO_ROW_WRITE'"), body.indexOf("e.code === 'ZERO_ROW_WRITE'") + 700);
    expect(zeroBranch).toMatch(/t\("common\.syncError"\)/);
    expect(zeroBranch, 'RLS/PostgREST 내부 용어를 사용자에게 노출하면 안 된다').not.toMatch(/RLS|PostgREST|42501/);
  });

  it('메트릭 emit 실패가 게임 흐름을 깨뜨리지 않는다', () => {
    const emits = html.match(/QA\.emit\(\{?\s*'metric'[\s\S]{0,260}?catch \(mErr\) \{\}/g) || [];
    expect(emits.length, 'ZERO_ROW_WRITE emit 이 try/catch 로 감싸여야 한다').toBeGreaterThanOrEqual(6);
  });
});
