// JP-SYNC-INVITE-003B — 초대 의도를 실제 화면 시스템에 배선했는가.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const NAV = slice('    // 해석 의도를 실제 화면으로 렌더링한다', '    // ── CORE: 방 시작 정책');
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

function load() {
  const shown = [];
  const els = {};
  const $ = (id) => (els[id] ||= { textContent: '', classList: { add() {}, remove() {}, contains: () => false } });
  const showScreen = (id) => shown.push(id);
  const t = (k) => `T(${k})`;
  const inviteIntentForState = (st) => ({ action: st === 'VALID' ? 'join' : st === 'ALREADY_JOINED' ? 'resume' : 'blocked' });
  // eslint-disable-next-line no-new-func
  const m = new Function('$', 'showScreen', 't', 'inviteIntentForState',
    `${NAV}; return { renderInviteUnavailable, navigateFromInvite };`)($, showScreen, t, inviteIntentForState);
  return { ...m, shown, els, $ };
}

describe('[003B] 전용 화면이 실제 DOM 과 화면 시스템에 존재한다', () => {
  it('screenInviteUnavailable 마크업이 있다', () => {
    expect(html).toMatch(/id="screenInviteUnavailable"/);
  });
  it('hideAllScreens 목록에 등록돼 다른 화면 전환 시 함께 숨는다', () => {
    const block = slice('function hideAllScreens()', 'function showScreen(');
    expect(block).toContain('"screenInviteUnavailable"');
  });
  it('복구 행동 버튼 2개가 마크업에 있다 (토스트 하나로 끝내지 않는다)', () => {
    expect(html).toMatch(/id="inviteNewChallengeBtn"[\s\S]{0,120}data-i18n="invite\.action\.newChallenge"/);
    expect(html).toMatch(/id="inviteHomeBtn"[\s\S]{0,120}data-i18n="invite\.action\.home"/);
  });
  it('제목/설명은 런타임에 채우는 빈 엘리먼트다 (하드코딩된 언어 없음)', () => {
    expect(html).toMatch(/id="inviteUnavailableTitle"><\/div>/);
    expect(html).toMatch(/id="inviteUnavailableDesc"><\/p>/);
  });
});

describe('[003B] 네비게이션 배선', () => {
  it('VALID → join 핸들러 호출', async () => {
    const m = load();
    let joined = null;
    const r = await m.navigateFromInvite({ state: 'VALID', roomCode: 'R1', intent: { action: 'join' } },
      { join: (rc) => { joined = rc; } });
    expect(r).toEqual({ navigated: 'join', roomCode: 'R1' });
    expect(joined).toBe('R1');
    expect(m.shown).toHaveLength(0);
  });

  it('ALREADY_JOINED → resume (새로 만들지 않고 기존 방 재개)', async () => {
    const m = load();
    let resumed = null;
    const r = await m.navigateFromInvite({ state: 'ALREADY_JOINED', roomCode: 'R1', intent: { action: 'resume' } },
      { resume: (rc) => { resumed = rc; } });
    expect(r.navigated).toBe('resume');
    expect(resumed).toBe('R1');
  });

  const blocked = [
    ['HOST_GONE', 'invite.hostGone.title', 'invite.hostGone.desc'],
    ['INVALID_TOKEN', 'invite.invalid.title', 'invite.invalid.desc'],
    ['ROOM_FULL', 'invite.roomFull.title', 'invite.unavailable.desc'],
    ['UNAVAILABLE', 'invite.unavailable.title', 'invite.unavailable.desc'],
  ];
  for (const [state, titleKey, descKey] of blocked) {
    it(`${state} → 전용 화면 렌더 + 올바른 i18n 키`, async () => {
      const m = load();
      const r = await m.navigateFromInvite({ state, roomCode: 'R1', intent: { action: 'blocked', titleKey, descKey } });
      expect(r.navigated).toBe('blocked');
      expect(m.shown).toEqual(['screenInviteUnavailable']);
      expect(m.$('inviteUnavailableTitle').textContent).toBe(`T(${titleKey})`);
      expect(m.$('inviteUnavailableDesc').textContent).toBe(`T(${descKey})`);
    });
  }

  it('의도가 없어도 안전하게 UNAVAILABLE 로 떨어진다', async () => {
    const m = load();
    const r = await m.navigateFromInvite({ state: 'WEIRD' });
    expect(r.navigated).toBe('blocked');
    expect(m.$('inviteUnavailableTitle').textContent).toBe('T(invite.unavailable.title)');
  });

  it('원시 DB 문구를 표시하지 않는다 — i18n 키만 쓴다', () => {
    const c = codeOnly(NAV);
    expect(c).not.toMatch(/error|message|PGRST|column does not exist/i);
    expect(c).toMatch(/\bt\(/);
  });

  it('LINE SDK 를 참조하지 않는다', () => {
    const c = codeOnly(NAV);
    expect(c).not.toMatch(/liff|shareTargetPicker/i);
    expect(c).not.toMatch(/\bLINE\b/);
  });
});

describe('[003B] §8 약한 토큰으로 downgrade 하지 않는다', () => {
  it('초대 자격증명 경로에 방 코드 fallback 이 없다', () => {
    const adapter = slice('    // ── JP 어댑터: 초대 진입', '    // 해석 의도를 실제 화면으로 렌더링한다');
    const c = codeOnly(adapter);
    // roomCode 를 토큰 대신 조회 키로 쓰는 경로가 없어야 한다.
    expect(c).not.toMatch(/eq\('invite_token',\s*roomCode/);
    expect(c).not.toMatch(/inviteToken\s*\|\|\s*roomCode/);
    // 발급 실패는 명시적 사유로 돌려준다 — 조용한 성공/대체가 없다.
    expect(c).toMatch(/reason:\s*'schema_unavailable'/);
    expect(c).toMatch(/reason:\s*'zero_row'/);
  });
});
