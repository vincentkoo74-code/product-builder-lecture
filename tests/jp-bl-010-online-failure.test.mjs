// JP-BL-010 — 온라인 백엔드 실패를 조용한 로컬 강등으로 덮지 않는다
//
// JP-BL-005 에서 관측했다: Tokyo REST 가 죽으면 JP 가 조용히 로컬 모드로 떨어져
// **작동하는 온라인 도전처럼 보였다**. 리전 유출은 없었지만 제품 계약 위반이다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const MARKET = slice('    const MARKET_CONFIG = {', '\n    };');
const GATE = slice('    // JP-BL-010: 온라인 백엔드가 죽었을 때', '    function clearRealtime()');
const CREATE = slice('    async function createRoom()', '    function createParticipant(');
const SHOW = slice('    // JP-BL-010: 온라인 백엔드 도달 실패를 사용자에게 명시한다.', '    // 해석 의도를 실제 화면으로');
// 주석에는 "Supabase/PostgREST 오류를 노출하지 않는다" 같은 설명이 들어간다 —
// 노출 여부는 **코드**로만 판정한다.
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const SHOW_CODE = codeOnly(SHOW);

const loadGate = (cfg) =>
  // eslint-disable-next-line no-new-func
  new Function('MARKET_CONFIG', `${GATE} return isOfflineFallbackAllowed;`)(cfg);

describe('[JP-BL-010] §4 온라인 vs 로컬 계약', () => {
  it('JP 시장은 백엔드 실패 시 로컬 폴백을 허용하지 않는다', () => {
    expect(MARKET).toMatch(/allowOfflineFallbackOnBackendFailure:\s*false/);
    expect(loadGate({ market: 'JP', allowOfflineFallbackOnBackendFailure: false })()).toBe(false);
  });
  it('키를 선언하지 않는 시장(KR)은 종전 폴백을 유지한다 — KR 무변경', () => {
    for (const cfg of [{ market: 'KR' }, {}, undefined, null]) {
      expect(loadGate(cfg)(), JSON.stringify(cfg)).toBe(true);
    }
  });
  it('의도적 로컬 플레이와 온라인 실패의 구분이 결정적이다', () => {
    // getOnlineMode() = 백엔드 클라이언트 존재 여부. 이것이 false 면 의도적 로컬이고,
    // true 인데 요청이 실패한 것은 온라인 실패다 — 두 경로가 코드에서 갈라져 있어야 한다.
    expect(html).toContain('function getOnlineMode() {\n      return Boolean(db);');
    expect(CREATE).toMatch(/if \(getOnlineMode\(\)\) \{/);
    expect(CREATE).toMatch(/\} else \{[\s\S]*createParticipant\("host"/);   // 의도적 로컬 분기는 유지
  });
});

describe('[JP-BL-010] §5 방 생성 실패 → 명시적 실패', () => {
  it('폴백이 금지된 시장에서는 가짜 참가자를 만들지 않고 반환한다', () => {
    const guard = CREATE.indexOf('if (!offlineFallbackAllowed)');
    expect(guard, '폴백 가드가 catch 안에 있어야 한다').toBeGreaterThan(-1);
    // 추출 하니스에서 기존 동작으로 떨어지도록 typeof 가드를 쓴다(이 파일의 관례).
    expect(CREATE).toContain("typeof isOfflineFallbackAllowed === 'function'");
    const blk = CREATE.slice(guard, CREATE.indexOf('오프라인 모드로 전환'));
    expect(blk).toContain('showConnectionError(');
    expect(blk).toContain('return;');
    expect(blk, '가짜 참가자를 만들면 안 된다').not.toContain('createParticipant(');
    expect(blk, '가짜 로컬 상태를 저장하면 안 된다').not.toContain('saveState()');
  });
  it('실패 시 방/역할/초대 상태를 모두 비운다 (가짜 방 없음)', () => {
    const guard = CREATE.indexOf('if (!offlineFallbackAllowed)');
    const blk = CREATE.slice(guard, CREATE.indexOf('오프라인 모드로 전환'));
    for (const clear of ['state.roomCode = ""', 'state.participants = []',
                         'state.inviteToken = null', 'state.inviteAvailable = false']) {
      expect(blk, `실패 후 정리 누락: ${clear}`).toContain(clear);
    }
  });
  it('실패 경로는 showHostRoom 에 도달하지 않는다', () => {
    const guard = CREATE.indexOf('if (!offlineFallbackAllowed)');
    const blk = CREATE.slice(guard, CREATE.indexOf('오프라인 모드로 전환'));
    expect(blk).not.toContain('showHostRoom(');
    // 그리고 return 이 catch 를 빠져나가므로 함수 말미의 showHostRoom() 도 실행되지 않는다.
    expect(blk.indexOf('return;')).toBeGreaterThan(blk.indexOf('showConnectionError('));
  });
});

describe('[JP-BL-010] §6 사용자 대면 UX', () => {
  it('전용 화면이 존재하고 초대 불가 화면과 분리돼 있다', () => {
    expect(html).toContain('id="screenConnectionError"');
    expect(html).toContain('id="connectionErrorTitle"');
    expect(html).toContain('id="connectionRetryBtn"');
    expect(html).toContain('id="connectionHomeBtn"');
    expect(html).not.toMatch(/screenInviteUnavailable[^\n]*connectionError/);
  });
  it('hideAllScreens 목록에 등록돼 화면 전환 시 남지 않는다', () => {
    expect(slice('function hideAllScreens', ']')).toContain('"screenConnectionError"');
  });
  it('원시 백엔드 오류를 사용자에게 노출하지 않는다', () => {
    expect(SHOW_CODE).not.toMatch(/e\.message|error\.message|PostgREST|supabase/i);
    expect(SHOW).toContain('t("conn.title")');
    expect(SHOW).toContain('t("conn.desc")');
  });
  it('일본어 문구가 자연스럽게 정의돼 있다', () => {
    expect(html).toContain('"conn.title": "通信できませんでした"');
    expect(html).toContain('"conn.desc": "ネットワークを確認して、もう一度お試しください。"');
    expect(html).toContain('"conn.action.retry": "もう一度"');
  });
  it('ko/en 문구도 함께 정의돼 있다 (누락 시 키가 그대로 노출된다)', () => {
    expect((html.match(/"conn\.title":/g) || []).length).toBe(3);
    expect((html.match(/"conn\.desc":/g) || []).length).toBe(3);
    expect((html.match(/"conn\.action\.retry":/g) || []).length).toBe(3);
  });
  it('재시도/홈 동작이 배선돼 있고, 자동으로 방을 다시 만들지 않는다', () => {
    expect(SHOW).toContain('retry.onclick');
    expect(SHOW).toContain('home.onclick');
    // 렌더 시점에 createRoom 을 부르면 화면을 띄우는 것만으로 방이 생긴다.
    const beforeHandlers = SHOW.slice(0, SHOW.indexOf('retry.onclick'));
    expect(beforeHandlers, '렌더 도중 방을 만들면 안 된다').not.toContain('createRoom()');
  });
});

describe('[JP-BL-010] §9 Realtime 실패 ≠ 백엔드 실패', () => {
  it('Realtime 폴백(폴링)은 그대로 유지된다', () => {
    expect(html).toContain('state.pollInterval = setInterval');
    expect(html).toMatch(/\}, 2600\);/);
  });
  it('폴백 금지 정책이 Realtime 구독 경로를 건드리지 않는다', () => {
    const sub = slice('async function subscribeToRoom(roomCode)', 'async function handleRoomUpdate');
    expect(sub).not.toContain('isOfflineFallbackAllowed');
    expect(sub).not.toContain('showConnectionError');
  });
  it('heartbeat/presence 인프라를 추가하지 않았다', () => {
    expect(html).not.toMatch(/last_seen_at|is_online|heartbeatInterval/);
  });
});

describe('[JP-BL-010] §7 초대 안전', () => {
  it('토큰 발급 실패 시 초대를 유효한 것처럼 제시하지 않는다 (기존 계약 유지)', () => {
    expect(CREATE).toContain('state.inviteAvailable = false');
    expect(CREATE).toContain('INVITE_TOKEN_UNAVAILABLE');
  });
  it('방 코드 fallback 이 없다', () => {
    const inviteBlk = slice('// JP-SYNC-INVITE-004: 보안 초대 토큰 발급·검증', 'subscribeToRoom(code);');
    expect(inviteBlk).not.toMatch(/state\.inviteToken = code|inviteToken = state\.roomCode/);
  });
});
