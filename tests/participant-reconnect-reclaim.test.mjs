import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');

function sliceFn(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  const next = html.indexOf('\n    function ', start + name.length + 10);
  if (next < 0) throw new Error(`next function marker not found: ${name}`);
  return html.slice(start, next);
}

const { isReclaimableOwnedRoom, selectOwnedRoomRecovery } = new Function(
  `${sliceFn('isReclaimableOwnedRoom')}\n${sliceFn('selectOwnedRoomRecovery')}\nreturn { isReclaimableOwnedRoom, selectOwnedRoomRecovery };`
)();

const candidate = (code, { host = true, status = 'waiting', id = `${code}-participant` } = {}) => ({
  participant: { id, room_id: code, is_host: host },
  room: { id: code, status, penalty: '' },
});

describe('KR participant reconnect reclaim — server ownership contract', () => {
  it('REC-01: same session plus one waiting room restores that room without a create path', () => {
    const result = selectOwnedRoomRecovery([candidate('JKHC')], 'JKHC');
    expect(result.kind).toBe('reclaim');
    expect(result.candidate.room.id).toBe('JKHC');
    expect(result.source).toBe('persistedRoomCode');
  });

  it('REC-02: restores the participant ID from the server-owned row, not local storage', () => {
    const server = candidate('JKHC', { id: 'server-owned-id' });
    expect(selectOwnedRoomRecovery([server], '').candidate.participant.id).toBe('server-owned-id');
  });

  it('REC-03: missing local room code with exactly one owned active room reclaims it', () => {
    const result = selectOwnedRoomRecovery([candidate('JKHC')], '');
    expect(result).toMatchObject({ kind: 'reclaim', source: 'serverOwnership' });
  });

  it('REC-04: a stale/deleted or destroyed persisted room is never reclaimed or recreated', () => {
    expect(selectOwnedRoomRecovery([candidate('OLD', { status: 'destroyed' })], 'OLD')).toMatchObject({ kind: 'none' });
    expect(isReclaimableOwnedRoom(null)).toBe(false);
    expect(isReclaimableOwnedRoom({ id: 'OLD', status: 'destroyed' })).toBe(false);
  });

  it('REC-05: multiple active server-owned rooms are ambiguous and select neither room', () => {
    const result = selectOwnedRoomRecovery([candidate('JKHC'), candidate('HGRU')], '');
    expect(result).toEqual({ kind: 'ambiguous', candidateCount: 2 });
  });

  it('REC-06: another user membership is absent from the owner-scoped candidate set', () => {
    const ownerCandidates = [candidate('JKHC')];
    const otherUserCandidates = [];
    expect(selectOwnedRoomRecovery(otherUserCandidates, 'JKHC')).toMatchObject({ kind: 'none' });
    expect(selectOwnedRoomRecovery(ownerCandidates, 'JKHC').candidate.participant.id).toBe('JKHC-participant');
  });

  it('REC-07: host role is restored from the server row', () => {
    expect(selectOwnedRoomRecovery([candidate('JKHC', { host: true })], '').candidate.participant.is_host).toBe(true);
  });

  it('REC-08: non-host role is restored from the server row', () => {
    expect(selectOwnedRoomRecovery([candidate('JKHC', { host: false })], '').candidate.participant.is_host).toBe(false);
  });

  it('REC-09: startup recovery contains no implicit createRoom call', () => {
    const recovery = sliceFn('restoreOwnedRoomOnStartup');
    expect(recovery).not.toContain('createRoom(');
    expect(html).toContain('startupRoomRecovery = await restoreOwnedRoomOnStartup();');
  });

  it('REC-10: Kakao and Anonymous sessions share the auth.uid owner-recovery contract', () => {
    const recovery = sliceFn('restoreOwnedRoomOnStartup');
    expect(recovery).toContain('db.auth.getSession()');
    expect(recovery).toContain('.eq("owner_user_id", ownerUserId)');
    expect(html).toContain('await requireActiveSession(verifyData?.session, "카카오 로그인")');
    expect(html).toContain('db.auth.signInAnonymously()');
  });

  it('REC-ROUTE-01/02: recovered host and participant both receive a final canonical route', () => {
    const recovery = sliceFn('applyOwnedRoomRecovery');
    expect(recovery).toContain('state.role = participant.is_host ? "host" : "participant"');
    expect(recovery).toContain('await handleRoomUpdate(room)');
  });

  it('REC-ROUTE-03/12: the safe Home boot screen is explicitly overridden only after owned recovery', () => {
    const recovery = sliceFn('applyOwnedRoomRecovery');
    expect(recovery).toContain('state.status = "__startup_owned_room_recovery__"');
    expect(html).toContain('normalizeColdLaunchScreen();');
    expect(html).toContain('if (startupRoomRecovery.kind === "reclaim") {\n          return;');
  });

  it('REC-ROUTE-04/05/08/10/11: recovery retains server authority and does not create membership', () => {
    const recovery = sliceFn('restoreOwnedRoomOnStartup');
    expect(recovery).toContain('currentUserHasTerminalRoomExit');
    expect(recovery).not.toContain('.insert(');
    expect(recovery).not.toContain('createRoom(');
  });
});
