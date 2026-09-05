import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = (start, end) => {
  const a = html.indexOf(start); const b = html.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`missing source block: ${start}`);
  return html.slice(a, b);
};
const homeTag = html.match(/<section class="([^"]*)" id="screenHome">/)?.[1] || '';
const boot = block('function normalizeColdLaunchScreen() {', 'function bootAppWhenReady() {');
const bootWiring = block('function bootAppWhenReady() {', '// onclick 속성에서 접근 가능하도록');

describe('cold-launch Home normalization', () => {
  it('HOME-01: raw markup never exposes Home beside the initial Auth card', () => {
    expect(homeTag.split(/\s+/)).toContain('hidden');
  });
  it('HOME-02: canonical Home controls remain in the single Home tree', () => {
    for (const id of ['homeNicknameChip', 'settingsEntryBtn']) expect(html).toContain(`id="${id}"`);
    for (const label of ['home.createBtn', 'home.scanBtn', 'home.quickJoin', 'home.quickStats', 'home.quickMyStats']) expect(html).toContain(label);
  });
  it('HOME-03/06: cold launch and Settings Back share showScreen routing', () => {
    expect(boot).toContain('showScreen(initialScreen)');
    expect(html).toContain('function goHome()');
    expect(block('function goHome() {', 'async function joinRoom() {')).toContain('showScreen("screenHome")');
  });
  it('HOME-04: guide is scheduled after the canonical startup router, not raw DOM exposure', () => {
    expect(bootWiring.indexOf('normalizeColdLaunchScreen()')).toBeLessThan(bootWiring.indexOf('initFromUrl()'));
    expect(html).toContain('setTimeout(showFirstGameGuideAfterLogin, 350)');
  });
  it('HOME-05/11: cached guest or Kakao-auth state selects one initial screen before async recovery', () => {
    expect(boot).toContain('getAuthState() ? "screenHome" : "screenAuth"');
  });
  it('HOME-07: Settings remains a separate hidden screen and cannot duplicate Home', () => {
    expect(html).toContain('id="screenSettings"');
    expect(html).toContain('id="screenSettings"');
    expect(block('function hideAllScreens() {', 'function showScreen(id) {')).toContain('"screenSettings"');
  });
  it('HOME-08/09: cold entry clears modal, menu, and countdown input layers', () => {
    for (const id of ['confirmPopup', 'gameMenuSheet', 'countdownOverlay']) expect(boot).toContain(`$("${id}")?.classList.add("hidden")`);
  });
  it('HOME-10: showScreen hides every screen before exposing the selected screen', () => {
    const source = block('function showScreen(id) {', 'function updateRoomBadge() {');
    expect(source).toContain('hideAllScreens()');
    expect(source).toContain('screen.classList.remove("hidden")');
  });
  it('HOME-12: cold startup has no implicit room creation', () => {
    expect(boot).not.toContain('createRoom(');
    const startup = block('async function initFromUrl() {', 'function bootAppWhenReady() {')
      .replace(/\/\/[^\n]*/g, '');
    expect(startup).not.toMatch(/\bcreateRoom\s*\(/);
  });
});
