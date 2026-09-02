// SPRINT JP-02C — JP 폰트 자체 호스팅 검증 (브라우저 계산값 기반)
//
// CEO 지시로 **주입 span 폭 프로브는 폐기**했다. 그 프로브는 var()/상속이
// 제대로 풀렸는지 보장하지 못해 "폭이 같다"는 모호한 결과를 냈다.
// 대신 여기서는 전부 브라우저가 계산한 값만 쓴다:
//   · getComputedStyle → 실제로 해석된 font-family/weight/style (var() 해석 후)
//   · document.fonts.check(spec, text) → 그 문자열을 렌더할 폰트가 준비됐는가
//   · canvas measureText → 글리프 존재(두부/불가시) 판정. DOM 주입이 없다.
//   · scrollWidth/clientWidth/getBoundingClientRect → 실제 레이아웃 제약
import { test, expect, chromium } from '@playwright/test';
import { REST_URL } from './local-env.mjs';
import { startStaticServer, routeSupabase, resetDb, dbRooms, dbParticipants } from './harness.mjs';
import { anonToken } from './jwt-harness.mjs';

const REST = REST_URL();
const GOOGLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
let TOKEN, srv, browser;

test.beforeAll(async () => {
  TOKEN = await anonToken();
  srv = await startStaticServer();
  browser = await chromium.launch({ channel: 'chrome' });
});
test.afterAll(async () => { await browser?.close(); srv?.server.close(); });

// ── 페이지 안에서 도는 증거 수집기 ────────────────────────────────────────────
// (문자열로 넘겨 evaluate 안에서 정의한다 — 페이지 컨텍스트에 클로저를 못 넘기므로.)
const COLLECTOR = `
  window.__jp02c = {
    spec(el) {
      const cs = getComputedStyle(el);
      return {
        family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle, size: cs.fontSize,
        shorthand: cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily,
      };
    },
    // 두부/불가시 판정 — **글리프 비트맵을 .notdef 와 정확히 비교**한다.
    // advance 폭 비교는 쓰지 않는다: 전각 CJK 의 advance 는 .notdef 상자와 같아서
    // 멀쩡한 글자를 전부 두부로 오판한다(JP-02C 1차 시도에서 실제로 그랬다).
    // 임계값 없음 — 픽셀이 완전히 같을 때만 같은 .notdef 글리프로 본다.
    glyphs(style, weight, family, chars) {
      const S = 64;
      const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      const c = cv.getContext('2d', { willReadFrequently: true });
      const font = style + ' ' + weight + ' 48px ' + family;
      const render = (ch) => {
        c.clearRect(0, 0, S, S);
        c.font = font; c.textBaseline = 'top'; c.fillStyle = '#000';
        c.fillText(ch, 4, 4);
        return c.getImageData(0, 0, S, S).data;
      };
      const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
      const ink = (d) => { for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true; return false; };
      const notdef = render('\\uFFFF');      // 비문자 — 반드시 .notdef 로 그려진다
      const notdefHasInk = ink(notdef);
      const wCtx = cv.getContext('2d'); wCtx.font = font;
      return chars.map((ch) => {
        const d = render(ch);
        return {
          ch, w: wCtx.measureText(ch).width,
          tofu: notdefHasInk && same(d, notdef),   // .notdef 와 픽셀이 동일 = 누락 글리프
          invisible: !ink(d),                      // 아무것도 그려지지 않음
        };
      });
    },
    // 실제 레이아웃 제약. 넘침이 "잘림"인지(overflow 가 가리는지) 구분한다.
    layout(root) {
      const out = { clipped: [], overflow: [], hiddenLabel: [] };
      const els = root.querySelectorAll('button, .choice-button, h1, h2, h3, p, span, div');
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const over = el.scrollWidth > el.clientWidth + 1;
        if (over) {
          const ox = cs.overflowX;
          const rec = { tag: el.tagName, id: el.id || null, cls: el.className || null,
                        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
                        text: (el.textContent || '').trim().slice(0, 40), overflowX: ox };
          // 잘림 = 넘쳤는데 overflow 가 감춘다. 스크롤 가능하면 잘린 게 아니다.
          if (ox === 'hidden' || ox === 'clip') out.clipped.push(rec); else out.overflow.push(rec);
        }
        // 버튼 라벨이 버튼 밖으로 나갔는지
        if (el.tagName === 'BUTTON' && (el.textContent || '').trim()) {
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden')
            out.hiddenLabel.push({ id: el.id || null, text: el.textContent.trim().slice(0, 30) });
        }
      }
      return out;
    },
    viewportOverflow() {
      const d = document.documentElement;
      return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, horizontal: d.scrollWidth > d.clientWidth + 1 };
    },
    // 화면 안에서 일본어를 담은 실제 요소들을 뽑는다(대표 표본).
    jpElements(root, limit) {
      const jp = /[\\u3040-\\u30ff\\u4e00-\\u9faf]/;
      const out = [];
      const walk = root.querySelectorAll('h1,h2,h3,p,button,span,div,label');
      for (const el of walk) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        if (!own || !jp.test(own)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({ tag: el.tagName, id: el.id || null, text: own.slice(0, 40), spec: window.__jp02c.spec(el) });
        if (out.length >= limit) break;
      }
      return out;
    },
  };
`;

// CEO §3 대표 문자: 히라가나/가타카나/한자/ASCII/구두점/장음부호/괄호
const JP_CHARS = ['あ', 'り', 'ガ', 'ソ', '友', '達', '戦', 'A', 'z', '7', '。', '、', 'ー', '「', '」', '・', '？'];
// 비공허성 대조군: 할당되지 않은 코드포인트. 탐지기가 이걸 두부로 **잡아야** 한다.
// 못 잡으면 "두부 0건"은 아무 의미가 없다.
const CONTROL_MISSING = '\uFFFE';

const visibleScreen = (page) => page.evaluate(() =>
  [...document.querySelectorAll('section[id^=screen]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id)[0] || null);
const waitScreen = (page, id, timeout = 40000) =>
  page.waitForFunction((x) => { const el = document.getElementById(x); return el && !el.classList.contains('hidden'); }, id, { timeout });
const local = (url) => { const u = new URL(url), s = new URL(srv.url); u.protocol = s.protocol; u.host = s.host; return u.toString(); };

// 콜드 컨텍스트. blockFonts=true 면 두 폰트 호스트를 실제로 차단한다.
async function newClient({ lang = 'ja', blockFonts = false } = {}) {
  // 실제 일본 사용자를 재현한다: navigator.language = ja-JP.
  // (초대 URL 은 lang 을 싣지 않는다 — 초대받은 사람의 로케일은 브라우저 언어로 정해진다.
  //  이걸 en-US 로 두면 "JP 사용자"가 아닌 것을 JP 로 판정하는 셈이라 측정이 무의미해진다.)
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 900 },
    locale: lang === 'ja' ? 'ja-JP' : lang === 'ko' ? 'ko-KR' : 'en-US',
  });
  const net = { google: [], localFonts: [], blocked: [] };
  if (blockFonts) {
    for (const h of GOOGLE_HOSTS) {
      await ctx.route(`**://${h}/**`, (route) => { net.blocked.push(route.request().url()); route.abort('failed'); });
    }
  }
  await routeSupabase(ctx, REST, TOKEN);
  const page = await ctx.newPage();
  page.on('request', (r) => {
    const h = new URL(r.url()).host;
    if (GOOGLE_HOSTS.includes(h)) net.google.push(r.url());
  });
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (u.host === new URL(srv.url).host && /\.(ttf|otf|woff2?)$/i.test(u.pathname)) {
      let bytes = Number(r.headers()['content-length'] || 0);
      if (!bytes) { try { bytes = (await r.body()).length; } catch { bytes = 0; } }
      net.localFonts.push({ file: u.pathname, bytes, status: r.status() });
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await ctx.addInitScript(COLLECTOR);
  return { ctx, page, errors, net, lang };
}

const open = async (c, query = '') => {
  await c.page.goto(`${srv.url}/index.html?lang=${c.lang}${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' });
  await c.page.waitForTimeout(1200);
};
const guestToHome = async (c) => {
  if ((await visibleScreen(c.page)) === 'screenAuth') {
    await c.page.evaluate(() => window.playAsGuest());
    await waitScreen(c.page, 'screenHome');
  }
};

// 한 화면의 증거를 통째로 수집한다.
async function evidence(page, screenId) {
  return page.evaluate(([id, chars]) => {
    const root = document.getElementById(id);
    if (!root || root.classList.contains('hidden')) return { screen: id, visible: false };
    const els = window.__jp02c.jpElements(root, 6);
    const probe = els[0]?.spec?.shorthand || getComputedStyle(document.body).font
      || (getComputedStyle(document.body).fontStyle + ' ' + getComputedStyle(document.body).fontWeight + ' '
          + getComputedStyle(document.body).fontSize + ' ' + getComputedStyle(document.body).fontFamily);
    const texts = els.map((e) => e.text).join('');
    return {
      screen: id, visible: true, elements: els,
      glyphs: window.__jp02c.glyphs(
        els[0]?.spec?.style || getComputedStyle(document.body).fontStyle,
        els[0]?.spec?.weight || getComputedStyle(document.body).fontWeight,
        els[0]?.spec?.family || getComputedStyle(document.body).fontFamily, chars),
      fontsReady: document.fonts.status,
      checkScreenText: texts ? document.fonts.check(probe, texts) : null,
      loadedFaces: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + '/' + f.weight),
      layout: window.__jp02c.layout(root),
      viewport: window.__jp02c.viewportOverflow(),
    };
  }, [screenId, JP_CHARS.concat([CONTROL_MISSING])]);
}

function assertScreen(ev, label) {
  expect(ev.visible, `${label}: 화면이 보이지 않는다`).toBe(true);
  // §2 계산된 폰트 체인이 의도한 로컬/시스템 체인인가
  for (const el of ev.elements) {
    expect(el.spec.family, `${label} ${el.tag}#${el.id}: Google 전용 가족이 남아있다`)
      .not.toMatch(/Noto Sans JP|Black Han Sans|Gowun Dodum|Noto Sans KR/);
    expect(el.spec.family, `${label} ${el.tag}#${el.id}: 로컬/시스템 체인이 아니다 (${el.spec.family})`)
      .toMatch(/Reggae One|M PLUS Rounded 1c|Hiragino|Yu Gothic|Meiryo|-apple-system|sans-serif/);
  }
  // §3 글리프 — 두부/불가시 없음
  // 먼저 탐지기가 살아있는지 대조군으로 확인한다(비공허성).
  const control = ev.glyphs.find((g) => g.ch === CONTROL_MISSING);
  expect(control, `${label}: 대조군 글리프가 수집되지 않았다`).toBeTruthy();
  expect(control.tofu, `${label}: 탐지기가 미할당 코드포인트조차 두부로 잡지 못한다 — 두부 0건은 무의미하다`).toBe(true);
  const real = ev.glyphs.filter((g) => g.ch !== CONTROL_MISSING);
  const tofu = real.filter((g) => g.tofu);
  const invisible = real.filter((g) => g.invisible);
  expect(tofu.map((g) => g.ch), `${label}: 두부(누락 글리프)`).toEqual([]);
  expect(invisible.map((g) => g.ch), `${label}: 불가시 글리프`).toEqual([]);
  // §4 레이아웃 — 잘림/뷰포트 가로 스크롤 없음 (줄바꿈 증가는 실패로 보지 않는다)
  expect(ev.layout.clipped, `${label}: 텍스트 잘림 ${JSON.stringify(ev.layout.clipped).slice(0, 300)}`).toEqual([]);
  expect(ev.layout.hiddenLabel, `${label}: 버튼 라벨 가려짐`).toEqual([]);
  expect(ev.viewport.horizontal, `${label}: 뷰포트 가로 스크롤 발생`).toBe(false);
}

// ═══════════════════════════════════════════ §2,3,4 정적 화면 (폰트 차단 상태)

test.describe('[JP-02C] §2,3,4 화면별 폰트 해석·글리프·레이아웃 (콜드 + 폰트 호스트 차단)', () => {
  test('auth / home / invite unavailable / connection error', async () => {
    const c = await newClient({ blockFonts: true });
    const seen = {};
    await open(c);
    await waitScreen(c.page, 'screenAuth');
    seen.auth = await evidence(c.page, 'screenAuth');
    assertScreen(seen.auth, 'auth');

    await guestToHome(c);
    seen.home = await evidence(c.page, 'screenHome');
    assertScreen(seen.home, 'home');

    // 지원/문의 표면 = 연결 오류·초대 불가 화면의 진단 참조 줄(독립 지원 화면은 미구현, JP-BL-023)
    await c.page.evaluate(() => window.showConnectionError('createRoom'));
    await waitScreen(c.page, 'screenConnectionError');
    seen.conn = await evidence(c.page, 'screenConnectionError');
    assertScreen(seen.conn, 'connection error');
    expect(await c.page.textContent('#connectionErrorRef')).toMatch(/JP-ERR-/);

    // invite unavailable — 실제 앱 경로로 띄운다: 형식은 맞지만 매칭되는 방이 없는 토큰.
    const bogus = 'zzzzzzzzzzzzzzzzzzzzzz';   // 22자 형식 통과, 방 없음 → INVALID_TOKEN
    await c.page.goto(`${srv.url}/index.html?lang=ja&invite=${bogus}`, { waitUntil: 'domcontentloaded' });
    await c.page.waitForTimeout(1200);
    if ((await visibleScreen(c.page)) === 'screenAuth') {
      await c.page.evaluate(() => window.playAsGuest());
    }
    await waitScreen(c.page, 'screenInviteUnavailable', 30000);
    seen.inviteUnavailable = await evidence(c.page, 'screenInviteUnavailable');
    assertScreen(seen.inviteUnavailable, 'invite unavailable');
    expect(await c.page.textContent('#inviteUnavailableRef')).toMatch(/JP-ERR-/);

    expect(c.net.google, `차단 상태인데 Google 폰트 요청이 나갔다: ${c.net.google[0]}`).toHaveLength(0);
    expect(c.errors, `pageerror: ${c.errors[0]}`).toHaveLength(0);
    console.log('[JP-02C §2,3,4 정적화면]', JSON.stringify(seen, null, 1));
    await c.ctx.close();
  });
});

// ═══════════════════════════════ §5,6 차단 상태 전체 플로우 + 로컬 폰트 실측

test.describe('[JP-02C] §5 폰트 호스트 차단 + 콜드 컨텍스트 전체 플로우', () => {
  test.beforeEach(() => { resetDb(); });

  test('도전 생성 → 초대 → 1라운드 → nextRound 가 폰트 차단 상태에서 동작한다', async () => {
    const A = await newClient({ blockFonts: true });
    const B = await newClient({ blockFonts: true });
    const seen = {};
    await open(A); await guestToHome(A);

    // 도전 생성
    await A.page.evaluate(() => { const el = document.getElementById('homeNickname'); if (el) el.value = 'ホスト'; });
    await A.page.evaluate(() => window.createRoom());
    await waitScreen(A.page, 'screenHostRoom');
    const roomCode = await A.page.evaluate(() => document.getElementById('roomCodeText')?.textContent?.trim() || null);
    const inviteUrl = await A.page.evaluate(() => (typeof buildInviteUrl === 'function') ? buildInviteUrl() : null);
    expect(roomCode, '도전 생성 실패').toMatch(/^[A-Z0-9]{4}$/);
    seen.hostWaiting = await evidence(A.page, 'screenHostRoom');
    assertScreen(seen.hostWaiting, 'host waiting');

    // 초대 합류
    await B.page.goto(local(inviteUrl), { waitUntil: 'domcontentloaded' });
    await B.page.waitForTimeout(1200);
    await B.page.evaluate(() => window.playAsGuest());
    await expect.poll(async () =>
      (await dbParticipants(REST, TOKEN)).filter((p) => p.room_id === roomCode).length, { timeout: 30000 }).toBe(2);
    const bScreen = await visibleScreen(B.page);
    if (bScreen === 'screenParticipantWait') {
      seen.participantWaiting = await evidence(B.page, 'screenParticipantWait');
      assertScreen(seen.participantWaiting, 'participant waiting');
    }

    // 벌칙 → ready
    await A.page.evaluate(() => window.showPenaltyScreen());
    await waitScreen(A.page, 'screenPenalty');
    await A.page.fill('#penaltyInput', 'コーヒーおごり');
    await A.page.evaluate(() => window.savePenalty());
    await expect.poll(async () =>
      (await dbRooms(REST, TOKEN)).find((r) => r.id === roomCode)?.status, { timeout: 30000 }).toBe('ready');

    await waitScreen(B.page, 'screenReady', 40000);
    seen.ready = await evidence(B.page, 'screenReady');
    assertScreen(seen.ready, 'ready');
    await B.page.click('#myReadyBtn');
    await expect.poll(async () =>
      (await dbParticipants(REST, TOKEN)).filter((p) => p.room_id === roomCode && !p.is_host).every((p) => p.is_ready),
      { timeout: 30000 }).toBe(true);

    // 시작 → 게임
    await waitScreen(A.page, 'screenHostRoom', 40000).catch(() => {});
    await A.page.evaluate(() => window.startGame());
    await expect.poll(async () =>
      (await dbRooms(REST, TOKEN)).find((r) => r.id === roomCode)?.status, { timeout: 30000 }).toBe('playing');
    await waitScreen(B.page, 'screenGame', 40000);
    seen.game = await evidence(B.page, 'screenGame');
    assertScreen(seen.game, 'game');

    // 1라운드
    await B.page.click('.choice-button >> nth=1');
    await A.page.evaluate(() => window.selectChoice('rock')).catch(() => {});
    await waitScreen(A.page, 'screenRoundResult', 45000);
    seen.result = await evidence(A.page, 'screenRoundResult');
    assertScreen(seen.result, 'result');

    // nextRound
    await A.page.evaluate(() => window.nextRound());
    await expect.poll(async () =>
      (await dbRooms(REST, TOKEN)).find((r) => r.id === roomCode)?.round, { timeout: 45000 }).toBe(2);

    // §5 판정
    expect(A.net.google, 'A: Google 폰트 요청').toHaveLength(0);
    expect(B.net.google, 'B: Google 폰트 요청').toHaveLength(0);
    expect(A.errors, `A pageerror: ${A.errors[0]}`).toHaveLength(0);
    expect(B.errors, `B pageerror: ${B.errors[0]}`).toHaveLength(0);

    // §6 로컬 폰트 실측
    const files = [...new Set(A.net.localFonts.map((f) => f.file))];
    const bytes = A.net.localFonts.reduce((s, f) => s + f.bytes, 0);
    console.log('[JP-02C §6] LOCAL_FONT_REQUEST_COUNT=' + A.net.localFonts.length);
    console.log('[JP-02C §6] LOCAL_FONT_FILES_USED=' + JSON.stringify(files));
    console.log('[JP-02C §6] LOCAL_FONT_BYTES=' + bytes);
    console.log('[JP-02C §5 화면증거]', JSON.stringify(seen, null, 1));
    expect(A.net.localFonts.every((f) => f.status === 200), '로컬 폰트 응답 실패').toBe(true);

    await A.ctx.close(); await B.ctx.close();
  });
});

// ═══════════════════════════════════════════════════════ §9 KR 불변 증명

test.describe('[JP-02C] §9 KR 동작 불변', () => {
  test('KR 은 여전히 Google Fonts 를 쓰고 계산된 체인도 그대로다', async () => {
    const c = await newClient({ lang: 'ko' });
    await open(c);
    await waitScreen(c.page, 'screenAuth');
    await c.page.waitForTimeout(2000);
    const kr = await c.page.evaluate(() => {
      const b = getComputedStyle(document.body);
      const probe = document.querySelector('h1, h2, .btn, button');
      return {
        locale: document.body.getAttribute('data-locale'),
        bodyFamily: b.fontFamily,
        probeFamily: probe ? getComputedStyle(probe).fontFamily : null,
        notoKR: document.fonts.check('16px "Noto Sans KR"'),
      };
    });
    expect(kr.locale, 'KR 로케일이 아니다').toBe('ko');
    expect(kr.bodyFamily, 'KR 본문 폰트가 바뀌었다').toContain('Noto Sans KR');
    expect(c.net.google.length, 'KR 에서 Google Fonts 요청이 사라졌다 — KR 동작이 바뀐 것이다').toBeGreaterThan(0);
    console.log('[JP-02C §9 KR]', JSON.stringify({ ...kr, googleRequests: c.net.google.length }, null, 1));
    await c.ctx.close();
  });

  test('JA 는 Google Fonts 를 전혀 요청하지 않는다 (차단 없이도)', async () => {
    const c = await newClient({ lang: 'ja' });
    await open(c);
    await waitScreen(c.page, 'screenAuth');
    await c.page.waitForTimeout(2000);
    expect(c.net.google, `JA 가 Google 폰트를 요청했다: ${c.net.google[0]}`).toHaveLength(0);
    const ja = await c.page.evaluate(() => ({
      locale: document.body.getAttribute('data-locale'),
      bodyFamily: getComputedStyle(document.body).fontFamily,
    }));
    expect(ja.locale).toBe('ja');
    expect(ja.bodyFamily).toContain('M PLUS Rounded 1c');
    expect(ja.bodyFamily).not.toContain('Noto Sans JP');
    console.log('[JP-02C §8 JA]', JSON.stringify(ja));
    await c.ctx.close();
  });
});


// ═══════════════════════════════════════ §2,3 법무 pending 페이지 (별도 HTML)

test.describe('[JP-02C] §2,3 법무 pending 페이지', () => {
  for (const doc of ['privacy', 'terms']) {
    test(`legal/${doc}.ja.html 이 외부 폰트 없이 일본어를 렌더한다`, async () => {
      const c = await newClient({ blockFonts: true });
      await c.page.goto(`${srv.url}/legal/${doc}.ja.html`, { waitUntil: 'domcontentloaded' });
      await c.page.waitForTimeout(800);
      const ev = await c.page.evaluate((chars) => {
        const cs = getComputedStyle(document.body);
        const els = window.__jp02c.jpElements(document.body, 4);
        return {
          family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle,
          elements: els,
          glyphs: window.__jp02c.glyphs(cs.fontStyle, cs.fontWeight, cs.fontFamily, chars),
          layout: window.__jp02c.layout(document.body),
          viewport: window.__jp02c.viewportOverflow(),
        };
      }, JP_CHARS.concat([CONTROL_MISSING]));

      expect(ev.family, 'Google 전용 가족이 남아있다').not.toMatch(/Noto Sans JP|Noto Sans KR|Black Han Sans/);
      const control = ev.glyphs.find((g) => g.ch === CONTROL_MISSING);
      expect(control.tofu, '탐지기 비활성 — 두부 0건이 무의미하다').toBe(true);
      const real = ev.glyphs.filter((g) => g.ch !== CONTROL_MISSING);
      expect(real.filter((g) => g.tofu).map((g) => g.ch), '두부').toEqual([]);
      expect(real.filter((g) => g.invisible).map((g) => g.ch), '불가시').toEqual([]);
      expect(ev.layout.clipped, '텍스트 잘림').toEqual([]);
      expect(ev.viewport.horizontal, '뷰포트 가로 스크롤').toBe(false);
      expect(c.net.google, `법무 페이지가 Google 폰트를 요청했다: ${c.net.google[0]}`).toHaveLength(0);
      expect(c.errors, `pageerror: ${c.errors[0]}`).toHaveLength(0);
      console.log(`[JP-02C §2,3 legal/${doc}]`, JSON.stringify({ family: ev.family, weight: ev.weight, style: ev.style,
        sample: ev.elements.map((e) => e.text).slice(0, 3), clipped: ev.layout.clipped.length }, null, 1));
      await c.ctx.close();
    });
  }
});
