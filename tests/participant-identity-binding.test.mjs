import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260905090000_participant_owner_identity.sql', root), 'utf8');

describe('KR participant Auth ownership foundation', () => {
  it('acquires a real Supabase session before online room membership', () => {
    expect(html).toContain('async function ensureRoomParticipantIdentity()');
    expect(html).toContain('db.auth.signInAnonymously()');
    expect(html).toContain('current?.data?.session?.user?.id');
    expect(html).toContain('await ensureRoomParticipantIdentity()');
  });

  it('Kakao already uses an authenticated Supabase session', () => {
    expect(html).toContain('await requireActiveSession(verifyData?.session, "카카오 로그인")');
  });

  it('derives ownership from auth.uid and prevents owner reassignment', () => {
    expect(migration).toContain('owner_user_id uuid');
    expect(migration).toContain('references auth.users(id) on delete set null');
    expect(migration).toContain('alter column owner_user_id set default auth.uid()');
    expect(migration).toContain('owner_user_id is immutable');
    expect(migration).toContain('participants_room_owner_uidx');
  });

  it('uses restrictive authenticated policies and fixed SECURITY DEFINER search paths', () => {
    expect(migration).toContain('on public.participants as restrictive');
    expect(migration).toContain('set search_path = pg_catalog, public');
    expect(migration).toContain('grant execute on function public.participant_caller_is_room_host(text) to authenticated');
    expect(migration).not.toContain('grant execute on function public.participant_caller_is_room_host(text) to anon');
  });

  it('does not authorize using client participant ids', () => {
    expect(migration).not.toMatch(/owner_user_id\s*=\s*new\.id/);
    expect(migration).toContain('auth.uid()');
  });
});
