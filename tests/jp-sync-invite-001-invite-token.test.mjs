// JP-SYNC-INVITE-001 §6 — 초대 토큰 (CORE, 플랫폼 중립)
//
// 기존 방 코드는 4자·약 20.7비트·Math.random 이라 URL 초대 자격증명으로 쓸 수 없다.
// 이 파일은 REAL 추출 소스로 토큰 프리미티브의 계약을 고정한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const BLOCK = (() => {
  const a = html.indexOf('    // ── CORE: 초대 토큰');
  const b = html.indexOf('    // ── CORE: 방 시작 정책', a);
  return html.slice(a, b);
})();
const codeOnly = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

function load(opts = {}) {
  // ⚠️ `crypto: undefined` 를 기본 매개변수로 받으면 기본값이 발동해 실제 CSPRNG 가 주입된다.
  //    "CSPRNG 부재" 를 검증하려면 키 존재 여부로 판단해야 한다.
  const g = { crypto: ('crypto' in opts) ? opts.crypto : webcrypto };
  const btoaImpl = opts.btoaImpl || ((b) => Buffer.from(b, 'binary').toString('base64'));
  // eslint-disable-next-line no-new-func
  return new Function('globalThis', 'btoa', 'Uint8Array',
    `${BLOCK}; return { generateInviteToken, isValidInviteTokenFormat, INVITE_TOKEN_BYTES };`
  )(g, btoaImpl, Uint8Array);
}

describe('[JP-SYNC-INVITE-001] 플랫폼 중립', () => {
  it('실행 코드가 LINE/LIFF/플랫폼 SDK 를 참조하지 않는다', () => {
    expect(codeOnly).not.toMatch(/liff/i);
    expect(codeOnly).not.toMatch(/\bLINE\b/);
    expect(codeOnly).not.toMatch(/kakao/i);
  });
});

describe('[JP-SYNC-INVITE-001] 엔트로피와 CSPRNG', () => {
  const m = load();

  it('토큰 바이트 수가 128비트 이상이다', () => {
    expect(m.INVITE_TOKEN_BYTES).toBeGreaterThanOrEqual(16);
  });

  it('CSPRNG(getRandomValues)를 쓴다 — Math.random 을 쓰지 않는다', () => {
    expect(codeOnly).toMatch(/getRandomValues/);
    expect(codeOnly).not.toMatch(/Math\.random/);
  });

  it('CSPRNG 가 없으면 약한 토큰으로 대체하지 않고 throw 한다', () => {
    const weak = load({ crypto: undefined });
    expect(() => weak.generateInviteToken()).toThrow(/CSPRNG unavailable/);
    const noFn = load({ crypto: {} });
    expect(() => noFn.generateInviteToken()).toThrow(/CSPRNG unavailable/);
  });

  it('생성된 토큰은 base64url 22자다 (URL 안전, 패딩 없음)', () => {
    for (let i = 0; i < 50; i++) {
      const t = m.generateInviteToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(t).not.toContain('=');
      expect(t).not.toContain('+');
      expect(t).not.toContain('/');
    }
  });

  it('반복 생성이 충돌하지 않는다 (유일성)', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(m.generateInviteToken());
    expect(seen.size).toBe(2000);
  });

  it('기존 방 코드(4자)보다 엔트로피가 압도적으로 크다', () => {
    // 방 코드: 36^4 ≈ 2^20.7 / 토큰: 2^128
    expect(m.INVITE_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
  });
});

describe('[JP-SYNC-INVITE-001] 형식 검증 (조회 전 차단)', () => {
  const m = load();

  it('생성된 토큰은 항상 형식 검증을 통과한다', () => {
    for (let i = 0; i < 50; i++) expect(m.isValidInviteTokenFormat(m.generateInviteToken())).toBe(true);
  });

  it('무효 입력은 전부 거부한다', () => {
    const bad = [
      '', 'abc', null, undefined, 42, {}, [],
      'A'.repeat(21), 'A'.repeat(23),
      'AAAAAAAAAAAAAAAAAAAA+/', 'AAAAAAAAAAAAAAAAAAAA==',
      'AAAA AAAAAAAAAAAAAAAAA', "'; drop table rooms; --",
      'ABCD', // 기존 방 코드 형식 — 초대 토큰으로 쓰일 수 없다
    ];
    for (const t of bad) expect(m.isValidInviteTokenFormat(t), JSON.stringify(t)).toBe(false);
  });

  it('방 코드는 초대 토큰으로 통과하지 않는다 (자격증명 혼용 차단)', () => {
    for (const code of ['A1B2', 'ZZZZ', '0000']) {
      expect(m.isValidInviteTokenFormat(code)).toBe(false);
    }
  });
});

describe('[JP-SYNC-INVITE-001] 스키마 — 최소 복잡도 설계', () => {
  const mig = readFileSync(new URL('../supabase/migrations/20260830010000_jp_v1_room_invite_token.sql', import.meta.url), 'utf8');

  it('전용 테이블이 아니라 rooms 컬럼 하나로 저장한다', () => {
    expect(mig).toMatch(/alter table public\.rooms[\s\S]*add column if not exists invite_token text/);
    expect(mig).not.toMatch(/create table/i);
  });

  it('토큰 유일성을 DB 가 보장한다 (중복 발급 = 방 오인)', () => {
    expect(mig).toMatch(/create unique index if not exists rooms_invite_token_key/);
  });

  it('멱등 재적용이 안전하다', () => {
    expect(mig).toMatch(/add column if not exists/);
    expect(mig).toMatch(/create unique index if not exists/);
  });

  it('NULL 을 회수(revoke) 의미로 쓴다 — 부분 인덱스로 다중 NULL 허용', () => {
    expect(mig).toMatch(/where invite_token is not null/);
  });
});
