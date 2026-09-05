import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260905090000_participant_owner_identity.sql', root), 'utf8');
const deployWorkflow = readFileSync(new URL('.github/workflows/supabase-deploy.yml', root), 'utf8');
const smokeWorkflow = readFileSync(new URL('.github/workflows/production-smoke.yml', root), 'utf8');
const csv = readFileSync(new URL('_maru-rps-evidence/Participant-Identity/R2/seoul-participant-identity-consolidated-result.csv', root), 'utf8');

describe('KR R2 deployed-security corrections', () => {
  it('validates the authoritative Seoul CSV shape before analysis', () => {
    const sections = [...csv.matchAll(/^([^,\r\n]+),/gm)].slice(1).map((match) => match[1]);
    expect(sections).toHaveLength(331);
    const counts = sections.reduce((out, section) => {
      out[section] = (out[section] || 0) + 1;
      return out;
    }, {});
    expect(counts['column grants']).toBe(238);
    expect(counts['table grants']).toBe(44);
    expect(counts['rooms/participants exact column types']).toBe(17);
    expect(counts['default privileges']).toBe(13);
    expect(counts['relevant functions/RPCs']).toBe(9);
    expect(counts.constraints).toBe(3);
    expect(counts.indexes).toBe(2);
    expect(counts['RLS policies']).toBe(2);
    expect(counts['table row security state']).toBe(2);
    expect(counts['session/project context']).toBe(1);
    expect(counts.triggers || 0).toBe(0);
  });

  it('removes the deployed unrestricted participant and room policies', () => {
    expect(migration).toContain('drop policy if exists allow_all_participants on public.participants');
    expect(migration).toContain('drop policy if exists allow_all_rooms on public.rooms');
    expect(migration).not.toMatch(/create policy allow_all_(participants|rooms)/);
  });

  it('removes anonymous security-sensitive table DML', () => {
    expect(migration).toContain('revoke insert, update, delete on public.participants from anon');
    expect(migration).toContain('revoke insert, update, delete on public.rooms from anon');
    expect(migration).toContain('grant select on public.participants, public.rooms to anon');
    expect(migration).toContain('revoke references, trigger, truncate on public.participants, public.rooms from anon');
    expect(migration).toContain('revoke references, trigger, truncate on public.participants, public.rooms from authenticated');
  });

  it('requires authenticated owner or authenticated host authority', () => {
    expect(migration).toContain('owner_user_id = auth.uid()');
    expect(migration).toContain('owner_user_id = auth.uid()\n  or public.participant_caller_is_room_host(room_id)');
    expect(migration).toContain('using (public.participant_caller_is_room_host(id))');
    expect(migration).toContain("raise exception 'authenticated identity required'");
    expect(migration).toContain("raise exception 'only the current room host may change host state'");
    expect(migration).toContain("raise exception 'participant identity fields are immutable'");
  });

  it('makes the proposed RLS composition explicit and removes the PUBLIC bypass', () => {
    expect(migration).toContain('drop policy if exists allow_all_participants on public.participants');
    expect(migration).toContain('drop policy if exists allow_all_rooms on public.rooms');
    expect(migration).toContain('for select to anon, authenticated');
    expect(migration).toContain('for update to authenticated');
    expect(migration).toContain('for delete to authenticated');
    expect(migration).not.toMatch(/on public\.(participants|rooms) as permissive\s*\nfor all to public/);
  });

  it('keeps identity helpers fixed-path, non-public, and schema-qualified', () => {
    expect(migration.match(/set search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(migration).toContain('before update on public.participants');
    expect(migration).toContain('revoke all on function public.prevent_participant_owner_reassignment() from public');
    expect(migration).toContain('revoke all on function public.participant_caller_is_room_host(text) from public');
    expect(migration).toContain('from public.participants p');
  });

  it('pins active KR deployment and smoke workflows to Seoul', () => {
    expect(deployWorkflow).toContain('SUPABASE_PROJECT_REF: sannrfmhevebqgfdqcps');
    expect(deployWorkflow).not.toContain('cmfxhehpreanijwanwrr');
    expect(smokeWorkflow).toContain('https://sannrfmhevebqgfdqcps.supabase.co/functions/v1/');
    expect(smokeWorkflow).not.toContain('cmfxhehpreanijwanwrr');
  });
});
