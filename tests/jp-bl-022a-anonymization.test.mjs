// JP-BL-022A — 참가자 이름 익명화 아키텍처: 국지 증거 (설계 슬라이스)
//
// 익명화 자체는 아직 구현하지 않는다(CEO: 설계·테스트·보고 우선). 이 파일은
// 설계 판단의 근거가 되는 **사실**을 코드에 고정한다:
//   · 판정 로직이 name 을 읽지 않는다 → 익명화는 게임 의미를 바꾸지 않는다
//   · null 은 안전한 익명값이 아니다(렌더가 "null" 을 출력한다)
//   · 이름으로 행을 지우는 write 가 실재한다 → 익명값이 살아있는 닉네임과 겹치면 위험하다
//   · 계정 삭제 로컬 정리는 **삭제 확정 이후에만** 일어난다
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  judgePure, computePlayerStatuses, getActiveIds, resolveElimination,
  participantListView, summarizeGameStats, PLAYER_STATUS,
} from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 익명화를 흉내내는 순수 변환 — 표시명만 바꾸고 나머지는 그대로 둔다.
const ANON = '削除済みユーザー';
const anonymize = (rows, value = ANON) => rows.map((r) => ({ ...r, name: value }));

const ROWS = [
  { id: 'h_1', name: '田中', is_host: true,  choice: 'rock',     wins: 2, losses: 1, draws: 0, penalties: 1 },
  { id: 'p_2', name: 'さくら', is_host: false, choice: 'scissors', wins: 1, losses: 2, draws: 0, penalties: 0 },
  { id: 'p_3', name: 'Alex',  is_host: false, choice: 'rock',     wins: 0, losses: 0, draws: 3, penalties: 0 },
];

describe('[JP-BL-022A] §13,18 CORE 무결성 — 익명화는 게임 의미를 바꾸지 않는다', () => {
  it('1,2) 판정 결과가 이름과 무관하게 동일하다', () => {
    const before = judgePure(ROWS);
    const after = judgePure(anonymize(ROWS));
    expect(after).toEqual(before);
  });

  it('3) participant.id 는 익명화로 바뀌지 않는다', () => {
    expect(anonymize(ROWS).map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it('2,5) 게임 상태·점수 필드가 보존된다', () => {
    for (const [i, r] of anonymize(ROWS).entries()) {
      const o = ROWS[i];
      expect({ ...r, name: undefined }).toEqual({ ...o, name: undefined });
    }
  });

  it('1,6) 상태 계산·활성 집합·호스트 판정이 동일하다', () => {
    expect(computePlayerStatuses(anonymize(ROWS))).toEqual(computePlayerStatuses(ROWS));
    expect(getActiveIds(anonymize(ROWS))).toEqual(getActiveIds(ROWS));
    expect(participantListView(anonymize(ROWS))).toEqual(participantListView(ROWS));
  });

  it('6) 탈락 해소(resolveElimination)가 동일하다', () => {
    const args = { participants: ROWS, confirmedSafeIds: [], confirmedLoserIds: [] };
    const a = resolveElimination(args);
    const b = resolveElimination({ ...args, participants: anonymize(ROWS) });
    expect(b).toEqual(a);
  });

  it('CORE 모듈은 name 을 표시 통과용으로만 쓴다 (판정 입력 아님)', () => {
    const core = readFileSync(new URL('../src/game-logic.mjs', import.meta.url), 'utf8');
    const uses = core.split('\n').filter((l) => /\.name\b/.test(l) && !l.trim().startsWith('//'));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("name: p.name || ''");   // summarizeGameStats 의 통과 필드
  });

  it('5) 전적 요약은 이름이 비어도 계산이 유지된다', () => {
    const withEmpty = ROWS.map((r) => ({ ...r, name: '' }));
    const a = summarizeGameStats(ROWS).map(({ name, ...rest }) => rest);
    const b = summarizeGameStats(withEmpty).map(({ name, ...rest }) => rest);
    expect(b).toEqual(a);
    expect(summarizeGameStats(withEmpty).every((r) => r.name === '')).toBe(true);
  });
});

describe('[JP-BL-022A] §11 익명값 후보의 기술적 제약', () => {
  it('7) null 은 안전하지 않다 — 렌더가 문자열 "null" 을 출력한다', () => {
    // 프로덕션 escapeHtml 은 String(text) 로 시작한다. null 을 넣으면 화면에 "null" 이 뜬다.
    const esc = html.slice(html.indexOf('function escapeHtml(text) {'), html.indexOf('function escapeHtml(text) {') + 320);
    expect(esc).toContain('String(text)');
    expect(String(null)).toBe('null');   // 이 경로가 왜 위험한지 고정한다
  });

  it('10) 이름으로 행을 지우는 write 가 실재한다 (익명값 충돌 위험의 근거)', () => {
    // 이탈 처리에 room_id + name 으로 거는 DELETE 가 있다.
    expect(html).toContain(".eq('name', leaveName)");
    const block = html.slice(html.indexOf('const leaveName ='), html.indexOf('const leaveName =') + 700);
    expect(block).toContain(".delete()");
    expect(block).toContain(".eq('room_id', state.roomCode)");
  });

  it('10) 익명값은 살아있는 사용자가 가질 수 있는 닉네임과 같으면 안 된다', () => {
    // JP 기본 참가 닉네임이 'ゲスト' 다. 익명값을 'ゲスト' 로 두면 위 DELETE 가
    // 같은 방의 익명화된 행들을 함께 지울 수 있다.
    expect(html).toContain("defaultJoinNickname: 'ゲスト'");
    expect(ANON).not.toBe('ゲスト');
  });
});

describe('[JP-BL-022A] §8 계정 삭제 시 기기 로컬 정리', () => {
  const fnStart = html.indexOf('async function deleteAccountWithConfirm()');
  const fn = html.slice(fnStart, html.indexOf('window.deleteAccountWithConfirm', fnStart));

  it('11) 삭제 확정 후 rpsRecentRoomCodes:authed 를 지운다', () => {
    expect(fn).toContain('localStorage.removeItem("rpsRecentRoomCodes:authed")');
  });

  it('12) 삭제 실패 시에는 지우지 않는다 — 정리는 throw 뒤에만 있다', () => {
    const guard = fn.indexOf('if (error) throw error;');
    const clear = fn.indexOf('localStorage.removeItem("rpsRecentRoomCodes:authed")');
    expect(guard).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(guard);
    // catch 블록에서 지우지 않는다.
    const cat = fn.indexOf('} catch (e) {');
    expect(cat).toBeGreaterThan(clear);
  });

  it('12) 게스트/무스코프 기록은 건드리지 않는다 (삭제된 계정의 것이 아니다)', () => {
    expect(fn).not.toContain('removeItem("rpsRecentRoomCodes")');
    expect(fn).not.toContain('rpsRecentRoomCodes:guest');
  });

  it('QA 리포트 키는 이 슬라이스에서 제거하지 않는다 (CEO 승인 대기)', () => {
    expect(fn).not.toContain('rpsQAReport');
  });
});

describe('[JP-BL-022A] §9,14 경계 유지', () => {
  it('13) LINE SDK 미착수', () => {
    expect(html).not.toMatch(/liff\.init|static\.line-scdn|liff-sdk/i);
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
  });
  it('14) KR 폰트·표현 불변 (JP-02C 계약 유지)', () => {
    expect(html).toContain('--font-body: "Noto Sans KR", -apple-system');
  });
  it('익명화를 아직 구현하지 않았다 (설계 슬라이스)', () => {
    // 프로덕션에 TTL/익명화 write 가 들어가면 이 테스트가 알려준다.
    expect(html).not.toContain('anonymizeParticipantNames');
    expect(html).not.toContain('削除済みユーザー');
  });
});
