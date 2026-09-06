import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const home = block('<section class="card maru-card hidden" id="screenHome">', '<section class="card maru-card hidden" id="screenParticipatedRoomsHistory">');
const history = block('async function showParticipatedRoomsHistory() {', 'async function refreshJoinRoomPreview(');
const join = block('function showJoinScreen(options = {}) {', 'async function showParticipatedRoomsHistory() {');

describe('participated rooms are history-only', () => {
  it('HIST-01: Home opens the history-only screen, not recent rejoin', () => {
    expect(home).toContain('window.showParticipatedRoomsHistory()');
    expect(home).not.toContain('window.showJoinScreen({ recent: true })');
    expect(history).toContain('showScreen("screenParticipatedRoomsHistory")');
  });
  it('HIST-02/03: authenticated game history supplies room records when available', () => {
    expect(history).toContain('.from("user_game_history")');
    expect(history).toContain('room_id,round,result,penalty_text,created_at');
  });
  it('HIST-04/05: rows are non-joinable and cannot create membership', () => {
    expect(history).not.toContain('joinRoom(');
    expect(history).not.toContain(".insert(");
    expect(history).not.toContain('showJoinScreen(');
    expect(history).toContain('cursor:default');
  });
  it('HIST-06/07: startup reconnect and intentional code join remain separate', () => {
    expect(join).toContain('showScreen("screenJoin")');
    expect(html).toContain('restoreOwnedRoomOnStartup');
  });
  it('HIST-08/09: history is not a membership source', () => {
    expect(history).not.toContain('participants');
    expect(history).not.toContain('exit_room_permanently');
  });
});
