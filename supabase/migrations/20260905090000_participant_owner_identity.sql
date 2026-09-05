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
  if auth.uid() is null then
    raise exception 'authenticated identity required';
  end if;
  if tg_op = 'UPDATE' and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'participant owner_user_id is immutable';
  end if;
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.room_id is distinct from old.room_id) then
    raise exception 'participant identity fields are immutable';
  end if;
  if tg_op = 'UPDATE' and new.is_host is distinct from old.is_host then
    if not exists (
      select 1
      from public.participants p
      where p.room_id = old.room_id
        and p.owner_user_id = auth.uid()
        and p.is_host is true
    ) then
      raise exception 'only the current room host may change host state';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists participants_owner_user_id_immutable on public.participants;
create trigger participants_owner_user_id_immutable
before update on public.participants
for each row execute function public.prevent_participant_owner_reassignment();

-- Existing host game writers update other participants during authoritative
-- round transitions. This predicate preserves that established authority while
-- preventing ordinary participants from mutating another participant.
create or replace function public.participant_caller_is_room_host(p_room_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'authenticated identity required';
  end if;
  return exists (
    select 1
    from public.participants p
    where p.room_id = p_room_id
      and p.owner_user_id = caller
      and p.is_host is true
  );
end;
$$;

revoke all on function public.prevent_participant_owner_reassignment() from public;
revoke all on function public.participant_caller_is_room_host(text) from public;
grant execute on function public.participant_caller_is_room_host(text) to authenticated;

alter table public.participants enable row level security;
alter table public.rooms enable row level security;

-- Anonymous API-key callers are not participant identities. Remove legacy DML
-- grants explicitly; RLS policies alone cannot override a separate grant path
-- for a role that has no matching authenticated policy.
revoke insert, update, delete on public.participants from anon;
revoke insert, update, delete on public.rooms from anon;
grant select on public.participants, public.rooms to anon;
grant select, insert, update, delete on public.participants, public.rooms to authenticated;
revoke references, trigger, truncate on public.participants, public.rooms from anon;
revoke references, trigger, truncate on public.participants, public.rooms from authenticated;

-- RESTRICTIVE policies compose with existing multiplayer visibility policies;
-- they cannot be bypassed by an older permissive policy.
drop policy if exists allow_all_participants on public.participants;
drop policy if exists allow_all_rooms on public.rooms;

drop policy if exists participants_room_select on public.participants;
create policy participants_room_select
on public.participants as permissive
for select to anon, authenticated
using (true);

drop policy if exists participants_owner_insert on public.participants;
create policy participants_owner_insert
on public.participants as permissive
for insert to authenticated
with check (auth.uid() is not null and owner_user_id = auth.uid());

drop policy if exists participants_owner_update on public.participants;
create policy participants_owner_update
on public.participants as permissive
for update to authenticated
using (
  owner_user_id = auth.uid()
  or public.participant_caller_is_room_host(room_id)
)
with check (owner_user_id = auth.uid() or public.participant_caller_is_room_host(room_id));

drop policy if exists participants_owner_delete on public.participants;
create policy participants_owner_delete
on public.participants as permissive
for delete to authenticated
using (
  owner_user_id = auth.uid()
  or public.participant_caller_is_room_host(room_id)
);

drop policy if exists rooms_select_by_code on public.rooms;
create policy rooms_select_by_code
on public.rooms as permissive
for select to anon, authenticated
using (true);

drop policy if exists rooms_authenticated_insert on public.rooms;
create policy rooms_authenticated_insert
on public.rooms as permissive
for insert to authenticated
with check (auth.uid() is not null);

drop policy if exists rooms_host_update on public.rooms;
create policy rooms_host_update
on public.rooms as permissive
for update to authenticated
using (public.participant_caller_is_room_host(id))
with check (public.participant_caller_is_room_host(id));

drop policy if exists rooms_host_delete on public.rooms;
create policy rooms_host_delete
on public.rooms as permissive
for delete to authenticated
using (public.participant_caller_is_room_host(id));

comment on column public.participants.owner_user_id is
  'Supabase Auth owner; participant.id is not an authorization credential. Legacy NULL rows are unbound.';

-- Rollback:
-- -- Restore these only after confirming the pre-migration grants from the
-- -- deployment schema; they are intentionally not guessed here.
-- revoke insert, update, delete on public.participants from anon;
-- drop policy if exists participants_owner_delete on public.participants;
-- drop policy if exists participants_owner_update on public.participants;
-- drop policy if exists participants_owner_insert on public.participants;
-- drop function if exists public.participant_caller_is_room_host(text);
-- drop trigger if exists participants_owner_user_id_immutable on public.participants;
-- drop function if exists public.prevent_participant_owner_reassignment();
-- drop index if exists public.participants_room_owner_uidx;
-- drop index if exists public.participants_owner_user_id_idx;
-- alter table public.participants drop column if exists owner_user_id;
