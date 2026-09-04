import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const migration = readFileSync(
  new URL('supabase/migrations/20260905090000_participant_owner_identity.sql', root),
  'utf8'
);

describe('KR participant identity security contracts', () => {
  it('fails closed when online participant creation fails', () => {
    const create = html.slice(
      html.indexOf('async function createRoom()'),
      html.indexOf('function createParticipant(', html.indexOf('async function createRoom()'))
    );
    expect(create).toContain('participantInsertError');
    expect(create).toContain('Online membership must never fall back to an unowned local row');
    expect(create).not.toContain('오프라인 모드로 전환');
  });

  it('requires Auth before every online room-entry route', () => {
    for (const marker of ['async function createRoom()', 'async function joinRoom()', 'async function requestReplayFromJoinedRoom(']) {
      const start = html.indexOf(marker);
      expect(start, marker).toBeGreaterThan(-1);
      const next = html.indexOf('\n    async function ', start + marker.length);
      const body = html.slice(start, next < 0 ? html.length : next);
      expect(body).toContain('ensureRoomParticipantIdentity()');
    }
  });

  it('never uses participant id or nickname as online reclaim authority', () => {
    const start = html.indexOf('async function requestReplayFromJoinedRoom(');
    const end = html.indexOf('\n    async function ', start + 20);
    const body = html.slice(start, end < 0 ? html.length : end);
    expect(body).toContain('p.owner_user_id === currentUser.user.id');
    expect(body).not.toMatch(/find\(p => p\.id === id\)/);
    expect(body).not.toMatch(/find\(p => p\.name === name\)/);
  });

  it('closes the anonymous API-key DML path and protects owner identity', () => {
    expect(migration).toContain('revoke insert, update, delete on public.participants from anon');
    expect(migration).toContain('as restrictive');
    expect(migration).toContain('to authenticated');
    expect(migration).toContain('owner_user_id = auth.uid()');
    expect(migration).toContain('owner_user_id is immutable');
    expect(migration).toContain('where owner_user_id is not null');
  });

  it('does not add lifecycle behavior to the foundation migration', () => {
    expect(migration).not.toMatch(/stay_for_next_match|next-host|auto.?eject|lifecycle|game.?continue/i);
  });
});
