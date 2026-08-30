import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build35 — UI 레이아웃 계약 회귀 테스트.
//
// Build35는 표현 계층만 바꾼다: 화면 카드를 c-head(고정) / c-body(스크롤) / c-foot(고정) 세
// 영역으로 나누고, topbar 컨트롤을 신설 Settings 화면으로 옮기고, 게임 중에는 Settings 대신
// Game Menu Sheet를 연다. 게임 로직(방/라운드/판정/호스트 이양/카운트다운)은 무변경이다.
//
// 이 파일이 지키는 것:
//  1) 레이아웃 계약 — 모든 화면 section이 c-head + c-body를 갖는다.
//  2) 이동한 컨트롤이 "삭제"되지 않았다 — 기존 JS가 참조하는 id가 그대로 살아 있다.
//  3) KR V1 인증 정책 — LINE/Google은 비활성 플래그로 잠겨 있고 Kakao/Apple/Guest는 유지된다.
//  4) Dynamic Action Slot — 슬롯이 존재하고 두 컨테이너를 함께 감싼다.
//  5) 신규 i18n 키가 ko/en/ja 3개 로케일에 모두 있다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const SCREEN_IDS = [
  'screenAuth', 'screenHome', 'screenSettings', 'screenQrScanner', 'screenHostRoom',
  'screenJoin', 'screenParticipantWait', 'screenPenalty', 'screenLobby', 'screenReady',
  'screenGame', 'screenHostPlaying', 'screenRoundResult', 'screenWinnerWait',
  'screenLoserWait', 'screenStats',
];

function sectionOf(id) {
  const open = html.indexOf(`id="${id}">`);
  expect(open, `section ${id} not found`).toBeGreaterThan(-1);
  const end = html.indexOf('\n    </section>', open);
  expect(end, `section ${id} unterminated`).toBeGreaterThan(open);
  return html.slice(open, end);
}

describe('Build35 — 레이아웃 계약', () => {
  it('모든 화면이 c-head와 c-body를 정확히 하나씩 갖는다', () => {
    for (const id of SCREEN_IDS) {
      const sec = sectionOf(id);
      expect(sec.match(/<div class="c-head">/g)?.length, `${id} c-head`).toBe(1);
      expect(sec.match(/<div class="c-body">/g)?.length, `${id} c-body`).toBe(1);
      expect((sec.match(/<div class="c-foot">/g) || []).length, `${id} c-foot`).toBeLessThanOrEqual(1);
    }
  });

  it('c-head가 c-body보다, c-body가 c-foot보다 먼저 온다', () => {
    for (const id of SCREEN_IDS) {
      const sec = sectionOf(id);
      const h = sec.indexOf('<div class="c-head">');
      const b = sec.indexOf('<div class="c-body">');
      const f = sec.indexOf('<div class="c-foot">');
      expect(h, `${id}`).toBeLessThan(b);
      if (f > -1) expect(b, `${id}`).toBeLessThan(f);
    }
  });

  it('Primary CTA가 있는 화면은 c-foot을 갖는다', () => {
    for (const id of ['screenHome', 'screenJoin', 'screenHostRoom', 'screenReady',
                      'screenGame', 'screenRoundResult', 'screenStats', 'screenSettings']) {
      expect(sectionOf(id), `${id} c-foot 없음`).toContain('<div class="c-foot">');
    }
  });

  it('hideAllScreens 목록과 실제 section 목록이 일치한다', () => {
    const listBlock = html.slice(html.indexOf('function hideAllScreens()'),
                                 html.indexOf('function showScreen(id)'));
    for (const id of SCREEN_IDS) expect(listBlock, `${id} 미등록`).toContain(`"${id}"`);
  });

  it('.app은 더 이상 스크롤 컨테이너가 아니다 (c-body가 스크롤한다)', () => {
    expect(html).toContain('overflow-y:hidden !important');
    expect(html).toMatch(/\.c-body\{[^}]*overflow-y:auto/);
  });
});

describe('Build35 — 이동한 컨트롤 보존', () => {
  it('topbar에는 설정 진입점 하나만 남는다', () => {
    const topbar = html.slice(html.indexOf('<div class="topbar">'), html.indexOf('<div id="toastEl"'));
    expect(topbar).toContain('id="settingsEntryBtn"');
    for (const id of ['langSelect', 'muteToggleBtn', 'guestLoginTopBtn', 'signOutTopBtn']) {
      expect(topbar, `${id}는 topbar에 남아 있으면 안 된다`).not.toContain(`id="${id}"`);
    }
  });

  it('이동한 컨트롤 id는 Settings 화면에 그대로 존재한다 (삭제 금지)', () => {
    const set = sectionOf('screenSettings');
    for (const id of ['langSelect', 'muteToggleBtn', 'guestLoginTopBtn', 'signOutTopBtn', 'homeNickname']) {
      expect(set, `${id} 누락`).toContain(`id="${id}"`);
    }
  });

  it('id는 문서 전체에서 유일하다', () => {
    for (const id of ['langSelect', 'muteToggleBtn', 'homeNickname', 'guestLoginTopBtn',
                      'signOutTopBtn', 'finalResultBtns', 'roundResultActions']) {
      expect(html.match(new RegExp(`id="${id}"`, 'g')).length, `${id} 중복`).toBe(1);
    }
  });

  it('createRoom/joinRoom이 읽는 homeNickname 참조가 유지된다', () => {
    expect(html).toContain('$("homeNickname").value.trim() || "호스트"');
  });
});

describe('Build35 — Game Menu Sheet (결정 1)', () => {
  it('시트와 세 기능이 존재한다', () => {
    const sheet = html.slice(html.indexOf('id="gameMenuSheet"'), html.indexOf('공용 confirm 팝업'));
    expect(sheet).toContain('window.closeGameMenu()');           // Resume
    expect(sheet).toContain('id="gameMenuMuteBtn"');             // Sound
    expect(sheet).toContain('window.leaveRoomFromGameMenu()');   // Leave
    expect(sheet).toContain('data-i18n="gameMenu.blockedNotice"'); // 차단 사유 안내
  });

  it('게임 중에는 Settings 대신 Game Menu가 열린다', () => {
    const fn = html.slice(html.indexOf('function openSettingsEntry()'),
                          html.indexOf('window.openSettingsEntry = openSettingsEntry;'));
    expect(fn).toContain('isGameSessionActive()');
    expect(fn).toContain('openGameMenu()');
    expect(fn).toContain('showSettings()');
  });

  it('isGameSessionActive는 읽기 전용이며 playing/result/game_over/카운트다운을 덮는다', () => {
    const fn = html.slice(html.indexOf('function isGameSessionActive()'),
                          html.indexOf('window.isGameSessionActive'));
    expect(fn).toContain('isCountdownActive');
    expect(fn).toContain('"playing"');
    expect(fn).toContain('"result"');
    expect(fn).toContain('"game_over"');
    // 상태를 쓰지 않는다
    expect(fn).not.toMatch(/state\.\w+\s*=[^=]/);
  });

  it('나가기는 기존 leaveRoom 흐름을 호출한다 (신규 퇴장 로직 없음)', () => {
    const fn = html.slice(html.indexOf('function leaveRoomFromGameMenu()'),
                          html.indexOf('window.leaveRoomFromGameMenu ='));
    expect(fn).toContain('window.leaveRoom()');
    expect(fn).not.toContain('leave_after_round');
  });
});

describe('Build35 — Dynamic Action Slot (결정 3)', () => {
  it('두 컨테이너가 하나의 고정 슬롯 안에 있다', () => {
    const sec = sectionOf('screenRoundResult');
    const slot = sec.indexOf('id="verdictActionSlot"');
    const actions = sec.indexOf('id="roundResultActions"');
    const finals = sec.indexOf('id="finalResultBtns"');
    expect(slot).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(slot);
    expect(finals).toBeGreaterThan(actions);
  });

  it('슬롯이 최대 상태만큼 높이를 예약한다 (layout jump 방지)', () => {
    expect(html).toMatch(/#verdictActionSlot\{[^}]*min-height:\s*\d+px/);
  });

  it('finalResultBtns의 innerHTML 생성 로직은 무변경이다', () => {
    expect(html).toContain('window.returnToLobbyAfterGame()');
    expect(html).toContain('result.hostSettingsBtn');
    expect(html).toContain('id="becomeNextHostBtn"');
    expect(html).toContain('finalBtns.innerHTML = html;');
  });
});

describe('Build35 — KR V1 인증 정책 유지', () => {
  it('LINE / Google은 비활성 플래그로 잠겨 있다', () => {
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
    expect(html).toContain('const ENABLE_GOOGLE_LOGIN = false;');
    expect(html).toContain('if (!ENABLE_LINE_LOGIN) $("snsBtnLine")?.classList.add("hidden");');
    expect(html).toContain('if (!ENABLE_GOOGLE_LOGIN) $("snsBtnGoogle")?.classList.add("hidden");');
  });

  it('Kakao / Apple / Guest 진입 구조가 유지된다', () => {
    const auth = sectionOf('screenAuth');
    expect(auth).toContain("window.loginWithSns('kakao')");
    expect(auth).toContain("window.loginWithSns('apple')");
    expect(auth).toContain('window.playAsGuest()');
  });

  it('Login의 법적 고지는 고정 푸터, SNS 버튼은 스크롤 영역에 있다', () => {
    const auth = sectionOf('screenAuth');
    const body = auth.indexOf('<div class="c-body">');
    const foot = auth.indexOf('<div class="c-foot">');
    expect(auth.indexOf("window.loginWithSns('kakao')")).toBeGreaterThan(body);
    expect(auth.indexOf("window.loginWithSns('kakao')")).toBeLessThan(foot);
    expect(auth.indexOf('auth-legal-links')).toBeGreaterThan(foot);
  });

  it('Settings에서도 법적 고지에 도달할 수 있다 (C-1)', () => {
    const set = sectionOf('screenSettings');
    expect(set).toContain('href="privacy.html"');
    expect(set).toContain('href="terms.html"');
  });
});

describe('Build35 — i18n 3개 로케일', () => {
  const NEW_KEYS = [
    'settings.title', 'settings.groupGeneral', 'settings.groupAccount', 'settings.groupLegal',
    'settings.groupAbout', 'settings.language', 'settings.sound', 'settings.nickname',
    'settings.nicknameHint', 'settings.myRecord', 'settings.accountGuest', 'settings.version',
    'settings.entryLabel', 'gameMenu.title', 'gameMenu.resume', 'gameMenu.blockedNotice',
  ];
  const dictStart = html.indexOf('const i18n = {');
  const dictEnd = html.indexOf('let currentLocale = "ko";');
  const dict = html.slice(dictStart, dictEnd);
  const blocks = {
    ko: dict.slice(dict.indexOf('ko: {'), dict.indexOf('en: {')),
    en: dict.slice(dict.indexOf('en: {'), dict.indexOf('ja: {')),
    ja: dict.slice(dict.indexOf('ja: {')),
  };

  for (const loc of ['ko', 'en', 'ja']) {
    it(`${loc}에 신규 키가 모두 있다`, () => {
      for (const k of NEW_KEYS) expect(blocks[loc], `${loc}:${k}`).toContain(`"${k}":`);
    });
  }

  it('DOM이 참조하는 data-i18n 키는 모두 사전에 존재한다', () => {
    const used = new Set([...html.matchAll(/data-i18n(?:-html|-placeholder|-aria-label|-title|-alt)?="([^"]+)"/g)]
      .map(m => m[1]));
    const missing = [...used].filter(k => !blocks.ko.includes(`"${k}":`));
    expect(missing, `ko 사전 누락: ${missing.join(', ')}`).toEqual([]);
  });

  it('applyTranslations가 aria-label/title/alt도 번역한다', () => {
    const fn = html.slice(html.indexOf('function applyTranslations(root)'),
                          html.indexOf('function setLocale(loc)'));
    expect(fn).toContain('data-i18n-aria-label');
    expect(fn).toContain('data-i18n-title');
    expect(fn).toContain('data-i18n-alt');
  });
});

describe('Build35 — 히트 타깃 44px', () => {
  it('작은 컨트롤들이 44px 하한 규칙을 갖는다', () => {
    expect(html).toMatch(/\.screen-close-btn,\s*\n\s*\.popup-close-btn\{width:44px !important;height:44px !important\}/);
    expect(html).toContain('.loser-count-select{min-height:44px}');
    expect(html).toMatch(/\.btn-quiet\{[^}]*min-height:44px/);
    expect(html).toMatch(/\.lang-seg button\{[^}]*min-height:44px/);
  });

  it('인라인 스타일 나가기 버튼이 .btn-quiet로 통일됐다', () => {
    expect(html).not.toContain('style="color:#999;background:none;border:1px solid #ddd;padding:8px 16px');
    // Build41 UI(필드픽스 RC-B): screenReady 의 btn-quiet 나가기는 grid 안의 leaveRoom 버튼으로 통합됐다
    // (goHome "나가기" + btn-quiet "게임방에서 나가기" 중복 제거). 남은 btn-quiet 는 winnerWait / loserWait 2개.
    expect(html.match(/class="btn-quiet" onclick="window\.leaveRoom\(\)"/g).length).toBe(2);
  });
});
