import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const hostRoom = block('<section class="card maru-card hidden" id="screenHostRoom">', '<section class="card maru-card hidden" id="screenJoin">');
const leave = block('async function _doLeaveRoom() {', '// Build37 A2/A3(WRPS-084): 퇴장 "예약" write.');
const goHome = block('function goHome() {', 'async function joinRoom() {');

describe('explicit terminal exit from an active room', () => {
  it('LEAVE-01: active host-room Home uses the canonical leave path, not generic navigation', () => {
    expect(hostRoom).toContain('onclick="window.leaveRoom()" data-i18n="common.home"');
    expect(hostRoom).not.toContain('onclick="window.goHome()" data-i18n="common.home"');
  });

  it('LEAVE-02/03: terminal RPC is awaited before the only local Home transition', () => {
    const rpcAt = leave.indexOf("await db.rpc('exit_room_permanently'");
    const homeAt = leave.lastIndexOf('goHome();');
    expect(rpcAt).toBeGreaterThan(-1);
    expect(homeAt).toBeGreaterThan(rpcAt);
  });

  it('LEAVE-04: RPC failure preserves the active room and reports a recoverable error', () => {
    const failure = leave.slice(leave.indexOf('if (exitError) {'), leave.indexOf('clearRoomScopedCache(exitRoomCode);'));
    expect(failure).toContain('showToast(t("common.syncError"))');
    expect(failure).not.toContain('goHome()');
    expect(failure).toContain('return false;');
  });

  it('LEAVE-05: repeated requests remain one idempotent server-side terminal exit contract', () => {
    expect(leave).toContain("p_exit_reason: 'explicit_leave'");
    expect(leave).toContain('p_owner_user_id: null');
  });

  it('LEAVE-06/07: generic Settings/Home navigation and app lifecycle retain no terminal RPC', () => {
    expect(goHome).not.toContain('exit_room_permanently');
    expect(goHome).not.toContain("db.rpc('");
  });

  it('LEAVE-08/09/10: successful canonical exit retains the existing server lockout path', () => {
    expect(leave).toContain('clearRoomScopedCache(exitRoomCode);');
    expect(leave).toContain('goHome();');
  });
});
