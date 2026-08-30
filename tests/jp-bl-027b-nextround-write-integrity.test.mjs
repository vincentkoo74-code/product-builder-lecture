// JP-BL-027-B — nextRound 의 4개 write 가 무음 0행을 성공으로 취급하지 않는가. (CORE)
//
// 프로덕션 nextRound(index.html)는 다음 카디널리티 계약을 갖는다:
//   participants.reset      .eq('room_id', …)   → 1행 이상 (방 인원, 가변 N)
//   participants.markSafe   .in('id', safeIds)  → 정확히 safeIds.length
//   participants.markLoser  .in('id', loserIds) → 정확히 loserIds.length
//   rooms.advance           .eq('id', roomCode) → 정확히 1
//
// 이 파일은 **추출한 REAL nextRound 텍스트**를 그대로 실행해 계약을 검증한다.
// 기대 동작을 발명하지 않는다. 단언을 완화하지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EXTRACTED_SOURCE_BLOCKS } from './rc3-harness-support.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('[JP-BL-027-B] 소스 계약 — 추출 블록이 index.html 원문과 동일하다', () => {
  it('nextRound 블록이 실제 파일에 바이트 동일하게 존재한다', () => {
    const block = EXTRACTED_SOURCE_BLOCKS.nextRound;
    expect(typeof block).toBe('string');
    expect(block.length).toBeGreaterThan(0);
    expect(html.includes(block)).toBe(true);
  });
});

describe('[JP-BL-027-B] 4개 write 전부가 영향 행을 되돌려받는다', () => {
  const block = EXTRACTED_SOURCE_BLOCKS.nextRound;

  it('participants.reset 이 .select() 로 영향 행을 확인한다', () => {
    expect(block).toMatch(/update\(\{\s*choice:\s*null,\s*is_ready:\s*false\s*\}\)\s*\.eq\('room_id',[^)]*\)\s*\.select\('id'\)/);
  });
  it('participants.markSafe 가 .select() 로 영향 행을 확인한다', () => {
    expect(block).toMatch(/'__safe__'[\s\S]{0,120}\.in\('id',\s*safeIds\)\s*\.select\('id'\)/);
  });
  it('participants.markLoser 가 .select() 로 영향 행을 확인한다', () => {
    expect(block).toMatch(/'__loser__'[\s\S]{0,120}\.in\('id',\s*loserIds\)\s*\.select\('id'\)/);
  });
  it('rooms.advance 가 .select() 로 영향 행을 확인한다', () => {
    expect(block).toMatch(/from\('rooms'\)[\s\S]{0,200}\.eq\('id',\s*state\.roomCode\)\s*\.select\('id'\)/);
  });

  it('네 write 중 어느 것도 영향 행 검사 없이 남아 있지 않다', () => {
    // update(...) 뒤에 .select( 가 없는 db write 가 nextRound 안에 존재하면 실패한다.
    const writes = [...block.matchAll(/db\.from\('(rooms|participants)'\)\s*\.update\([\s\S]*?;/g)]
      .map((m) => m[0]);
    expect(writes.length).toBe(4);
    for (const w of writes) {
      expect(w, `영향 행 미확인 write: ${w.slice(0, 90)}`).toContain(".select('id')");
    }
  });
});

describe('[JP-BL-027-B] 카디널리티 계약이 write 별로 다르게 강제된다', () => {
  const block = EXTRACTED_SOURCE_BLOCKS.nextRound;

  it('reset 은 "1행 이상"을 요구한다 (방 인원은 가변이므로 정확한 수를 알 수 없다)', () => {
    expect(block).toMatch(/resetRows\.length\s*<\s*1/);
  });
  it('markSafe 는 정확히 safeIds.length 를 요구한다', () => {
    expect(block).toMatch(/safeRows\.length\s*!==\s*safeIds\.length/);
  });
  it('markLoser 는 정확히 loserIds.length 를 요구한다', () => {
    expect(block).toMatch(/loserRows\.length\s*!==\s*loserIds\.length/);
  });
  it('rooms.advance 는 정확히 1행 + id 일치를 요구한다', () => {
    expect(block).toMatch(/advanceRows\.length\s*!==\s*1\s*\|\|\s*advanceRows\[0\]\?\.id\s*!==\s*state\.roomCode/);
  });
});

describe('[JP-BL-027-B] 위반 시 ZERO_ROW_WRITE 를 남기고 throw 로 승격한다', () => {
  const block = EXTRACTED_SOURCE_BLOCKS.nextRound;

  it("ZERO_ROW_WRITE metric 을 nextRound.* context 로 emit 한다", () => {
    expect(block).toMatch(/eventType:\s*'ZERO_ROW_WRITE'/);
    expect(block).toMatch(/context:\s*'nextRound\.'\s*\+\s*context/);
  });
  it('expectedRows / affectedRows 를 함께 남긴다 (사후 진단 가능)', () => {
    expect(block).toMatch(/expectedRows:/);
    expect(block).toMatch(/affectedRows:/);
  });
  it('emit 후 throw 로 승격한다 — catch 의 안전망/재시도가 dead code 가 되지 않는다', () => {
    expect(block).toMatch(/failNextRoundWrite\s*=\s*\([\s\S]*?throw new Error\(/);
  });
  it('metric emit 실패가 throw 를 막지 않는다 (try/catch 로 감쌌다)', () => {
    expect(block).toMatch(/try\s*\{\s*QA\.emit\('metric',\s*\{\s*eventType:\s*'ZERO_ROW_WRITE'[\s\S]*?catch\s*\(mErr\)/);
  });
});

describe('[JP-BL-027-B] 기존 계약 회귀 방지', () => {
  const block = EXTRACTED_SOURCE_BLOCKS.nextRound;

  it('error 검사는 그대로 유지된다 (0행 검사가 error 검사를 대체하지 않는다)', () => {
    for (const ctx of ['participants.reset', 'participants.markSafe', 'participants.markLoser', 'rooms.advance']) {
      expect(block, ctx).toContain(`nextRound ${ctx} failed: `);
    }
  });
  it('성공 시 재시도 카운터 정리는 모든 write 뒤에 남아 있다', () => {
    expect(block).toMatch(/delete state\.rematchAdvanceRetryAttempts\[getRematchAdvanceRetryKey\(\)\]/);
  });
  it('실패 경로는 advancingRound 를 해제한다', () => {
    expect(block).toMatch(/catch\s*\(e\)\s*\{[\s\S]{0,200}state\.advancingRound\s*=\s*false/);
  });
});
