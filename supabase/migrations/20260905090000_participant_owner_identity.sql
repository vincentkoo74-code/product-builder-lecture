-- KR participant identity foundation.
-- Participant ids remain client-generated game identifiers. Authorization is
-- derived from the active Supabase Auth identity only.

alter table public.participants
  add column if not exists owner_user_id uuid
  references auth.users(id) on delete set null;

alter table public.participants
  alter column owner_user_id set default auth.uid();

create index if not exists participants_owner_user_id_idx
  on public.participants (owner_user_id);

create unique index if not exists participants_room_owner_uidx
  on public.participants (room_id, owner_user_id)
  where owner_user_id is not null;

create or replace function public.prevent_participant_owner_reassignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'participant owner_user_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists participants_owner_user_id_immutable on public.participants;
create trigger participants_owner_user_id_immutable
before update of owner_user_id on public.participants
for each row execute function public.prevent_participant_owner_reassignment();

-- Existing host game writers update other participants during authoritative
-- round transitions. This predicate preserves that established authority while
-- preventing ordinary participants from mutating another participant.
create or replace function public.participant_caller_is_room_host(p_room_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.participants p
      where p.room_id = p_room_id
        and p.owner_user_id = auth.uid()
        and p.is_host is true
    );
$$;

revoke all on function public.prevent_participant_owner_reassignment() from public;
revoke all on function public.participant_caller_is_room_host(text) from public;
grant execute on function public.participant_caller_is_room_host(text) to authenticated;

alter table public.participants enable row level security;

-- RESTRICTIVE policies compose with existing multiplayer visibility policies;
-- they cannot be bypassed by an older permissive policy.
drop policy if exists participants_owner_insert on public.participants;
create policy participants_owner_insert
on public.participants as restrictive
for insert to authenticated
with check (auth.uid() is not null and owner_user_id = auth.uid());

drop policy if exists participants_owner_update on public.participants;
create policy participants_owner_update
on public.participants as restrictive
for update to authenticated
using (
  owner_user_id = auth.uid()
  or public.participant_caller_is_room_host(room_id)
)
with check (owner_user_id = auth.uid() or public.participant_caller_is_room_host(room_id));

drop policy if exists participants_owner_delete on public.participants;
create policy participants_owner_delete
on public.participants as restrictive
for delete to authenticated
using (
  owner_user_id = auth.uid()
  or public.participant_caller_is_room_host(room_id)
);

comment on column public.participants.owner_user_id is
  'Supabase Auth owner; participant.id is not an authorization credential. Legacy NULL rows are unbound.';

-- Rollback:
-- drop policy if exists participants_owner_delete on public.participants;
-- drop policy if exists participants_owner_update on public.participants;
-- drop policy if exists participants_owner_insert on public.participants;
-- drop function if exists public.participant_caller_is_room_host(text);
-- drop trigger if exists participants_owner_user_id_immutable on public.participants;
-- drop function if exists public.prevent_participant_owner_reassignment();
-- drop index if exists public.participants_room_owner_uidx;
-- drop index if exists public.participants_owner_user_id_idx;
-- alter table public.participants drop column if exists owner_user_id;
