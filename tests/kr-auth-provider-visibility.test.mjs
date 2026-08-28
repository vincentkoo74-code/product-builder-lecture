import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// ════════════════════════════════════════════════════════════════════════════
// KR 로그인 provider 노출 — 플랫폼별 임시 계약.
//
//   iOS     Kakao / Apple / Guest    (Google·LINE 숨김)
//   Android Kakao / Guest            (Apple·Google·LINE 숨김)
//   web     기존 정책 유지
//
// ⚠️ 같은 index.html 이 두 플랫폼에 그대로 실린다. 따라서 "Android 산출물에서 Apple 이
//    숨겨져 있다"를 **정적 파일 검사로 확인할 수 없다** — 판정은 런타임에
//    Capacitor.getPlatform() 으로 일어난다. 그래서 이 파일은 REAL 소스를 추출해
//    getPlatform 을 스텁하고 **실제로 실행해서** DOM 결과를 본다.
//
// ⚠️ Google 은 이 계약이 건드리지 않는다. ENABLE_GOOGLE_LOGIN=false + Seoul provider
//    비활성의 이중 차단으로 이미 전 플랫폼에서 숨겨져 있고, 지금 노출하면 눌러도
//    완료되지 않는 dead button 이 된다(별건 KR-ANDROID-AUTH-GOOGLE).
// ════════════════════════════════════════════════════════════════════════════

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function extractBlock(a, b) {
  const s = html.indexOf(a); if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s); if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}
/** REAL 소스를 주어진 플랫폼으로 실행하고, 각 버튼의 hidden 여부를 돌려준다. */
function runFor(platform) {
  const src = extractBlock('function getNativePlatform() {', 'function getOAuthRedirectUri(provider) {');
  const ids = ['snsBtnKakao', 'snsBtnApple', 'snsBtnGoogle', 'snsBtnLine', 'guestBtn'];
  const els = {};
  ids.forEach(id => {
    els[id] = { id, _c: new Set(), classList: {
      add: c => els[id]._c.add(c), remove: c => els[id]._c.delete(c),
      contains: c => els[id]._c.has(c) } };
  });
  const document = { getElementById: id => els[id] || null };
  const win = platform === 'web'
    ? {}                                  // Capacitor 없음 = 웹
    : { Capacitor: { getPlatform: () => platform } };

  const factory = new Function('window', 'document',
    src + '\nreturn { getNativePlatform, applyPlatformAuthProviders };');
  const mod = factory(win, document);

  // 기존 provider 게이트(ENABLE_LINE_LOGIN / ENABLE_GOOGLE_LOGIN = false)를 그대로 재현
  els.snsBtnLine.classList.add('hidden');
  els.snsBtnGoogle.classList.add('hidden');
  mod.applyPlatformAuthProviders();

  return {
    platform: mod.getNativePlatform(),
    hidden: Object.fromEntries(ids.map(id => [id, els[id].classList.contains('hidden')])),
  };
}

describe('공허성 가드', () => {
  it('Apple 버튼에 안정적인 id 가 있다', () => {
    expect(html).toContain('id="snsBtnApple"');
    expect(html).toContain('id="snsBtnGoogle"');
    expect(html).toContain('id="snsBtnLine"');
  });

  it('플랫폼 판정이 UA 가 아니라 Capacitor.getPlatform 을 쓴다', () => {
    const fn = extractBlock('function getNativePlatform() {', 'function applyPlatformAuthProviders');
    expect(fn).toContain('window.Capacitor?.getPlatform');
    expect(fn, 'UA 문자열 추측 금지').not.toMatch(/navigator\.userAgent|userAgent/);
  });

  it('스텁이 실제로 플랫폼을 바꾼다 (테스트가 공허하지 않다)', () => {
    expect(runFor('android').platform).toBe('android');
    expect(runFor('ios').platform).toBe('ios');
    expect(runFor('web').platform).toBe('web');
  });
});

describe('Android KR — Kakao / Guest 만', () => {
  const r = () => runFor('android');
  it('[RED→GREEN] Apple 이 숨겨진다', () => { expect(r().hidden.snsBtnApple).toBe(true); });
  it('Google 이 숨겨진 채로 유지된다', () => { expect(r().hidden.snsBtnGoogle).toBe(true); });
  it('LINE 이 숨겨진 채로 유지된다', () => { expect(r().hidden.snsBtnLine).toBe(true); });
  it('Kakao 는 노출된다', () => { expect(r().hidden.snsBtnKakao).toBe(false); });
  it('Guest 는 노출된다', () => { expect(r().hidden.guestBtn).toBe(false); });
});

describe('iOS KR — Kakao / Apple / Guest', () => {
  const r = () => runFor('ios');
  it('Apple 이 노출된다', () => { expect(r().hidden.snsBtnApple).toBe(false); });
  it('Google 이 숨겨진다', () => { expect(r().hidden.snsBtnGoogle).toBe(true); });
  it('LINE 이 숨겨진다', () => { expect(r().hidden.snsBtnLine).toBe(true); });
  it('Kakao · Guest 노출', () => {
    expect(r().hidden.snsBtnKakao).toBe(false);
    expect(r().hidden.guestBtn).toBe(false);
  });
});

describe('web — 기존 정책 회귀 없음', () => {
  it('Apple 정책을 임의로 바꾸지 않는다 (숨기지 않는다)', () => {
    expect(runFor('web').hidden.snsBtnApple).toBe(false);
  });
  it('Google / LINE 은 기존 플래그대로 숨겨진 채다', () => {
    const h = runFor('web').hidden;
    expect(h.snsBtnGoogle).toBe(true);
    expect(h.snsBtnLine).toBe(true);
  });
});

describe('이번 수정이 건드리면 안 되는 것', () => {
  it('ENABLE_GOOGLE_LOGIN 은 false 그대로다', () => {
    expect(html).toContain('const ENABLE_GOOGLE_LOGIN = false;');
  });
  it('ENABLE_LINE_LOGIN 은 false 그대로다', () => {
    expect(html).toContain('const ENABLE_LINE_LOGIN = false;');
  });
  it('가시성 함수가 Google 버튼을 만지지 않는다', () => {
    const fn = extractBlock('function applyPlatformAuthProviders() {', 'function getOAuthRedirectUri');
    expect(fn.includes('snsBtnGoogle'), 'Google 이중 차단을 흔들면 안 된다').toBe(false);
  });
});
