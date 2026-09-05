-- KR room membership lifecycle: disconnect is reconnectable; an explicit or
-- authorized system exit is terminal for this (room_id, owner_user_id) pair.
--
-- This ledger deliberately has no foreign key to public.rooms. Rooms use a
-- soft-destroy tombstone and the lockout must survive participant deletion (or
-- a future hard room cleanup) rather than being erased with the membership.

begin;

create table if not exists public.room_membership_exits (
  room_id text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  exited_at timestamptz not null default now(),
  exit_reason text not null,
  primary key (room_id, owner_user_id),
  constraint room_membership_exits_reason_not_blank check (btrim(exit_reason) <> '')
);

create index if not exists room_membership_exits_owner_idx
  on public.room_membership_exits (owner_user_id, exited_at desc);

alter table public.room_membership_exits enable row level security;

-- The ledger is written only through the canonical RPC. It is not a client
-- editable status flag, and direct reads are unnecessary because the RPC below
-- answers only the current caller's re-entry question.
revoke all on table public.room_membership_exits from anon;
revoke all on table public.room_membership_exits from authenticated;
revoke references, trigger, truncate on table public.room_membership_exits from anon;
revoke references, trigger, truncate on table public.room_membership_exits from authenticated;

-- Defend the direct PostgREST INSERT path. The restrictive policy composes
-- with participants_owner_insert from the identity migration; the trigger
-- below adds transaction locking so a concurrent leave/rejoin cannot race the
-- RLS snapshot.
create or replace function public.current_user_has_terminal_room_exit(p_room_id text, p_owner_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or p_owner_user_id is distinct from auth.uid() then
    raise exception 'authenticated identity required';
  end if;
  return exists (
    select 1
    from public.room_membership_exits e
    where e.room_id = p_room_id
      and e.owner_user_id = p_owner_user_id
  );
end;
$$;

drop policy if exists participants_not_terminally_exited_insert on public.participants;
create policy participants_not_terminally_exited_insert
on public.participants as restrictive
for insert to authenticated
with check (
  not public.current_user_has_terminal_room_exit(participants.room_id, auth.uid())
);

create or replace function public.prevent_terminal_room_reentry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'authenticated identity required';
  end if;
  if new.owner_user_id is distinct from auth.uid() then
    raise exception 'participant owner must match authenticated identity';
  end if;

  -- Serialize an exit and a same-owner insert for exactly one room. Hash
  -- collisions only add harmless serialization; they cannot authorize entry.
  perform pg_advisory_xact_lock(hashtextextended(new.room_id || ':' || new.owner_user_id::text, 0));
  if exists (
    select 1
    from public.room_membership_exits e
    where e.room_id = new.room_id
      and e.owner_user_id = new.owner_user_id
  ) then
    raise exception 'terminal room exit prevents re-entry';
  end if;
  return new;
end;
$$;

drop trigger if exists participants_terminal_room_reentry_guard on public.participants;
create trigger participants_terminal_room_reentry_guard
before insert on public.participants
for each row execute function public.prevent_terminal_room_reentry();

create or replace function public.current_user_has_exited_room(p_room_id text)
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
    from public.room_membership_exits e
    where e.room_id = p_room_id
      and e.owner_user_id = caller
  );
end;
$$;

-- The only membership-ending primitive. A caller may exit only its own active
-- membership; a current host or service-role caller may perform the same
-- primitive for a deferred/system exit. Repeated calls are intentionally a
-- no-op after the first durable record has been created.
create or replace function public.exit_room_permanently(
  p_room_id text,
  p_exit_reason text default 'explicit_leave',
  p_owner_user_id uuid default null
)
returns table (room_id text, owner_user_id uuid, exit_reason text, exited_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid;
  target uuid;
  can_exit_other boolean := false;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'authenticated identity required';
  end if;
  if p_room_id is null or btrim(p_room_id) = '' then
    raise exception 'room id is required';
  end if;
  if p_exit_reason not in ('explicit_leave', 'system_ejection', 'post_match_timeout') then
    raise exception 'invalid terminal exit reason';
  end if;

  target := coalesce(p_owner_user_id, caller);
  if target <> caller then
    can_exit_other := auth.role() = 'service_role'
      or public.participant_caller_is_room_host(p_room_id);
    if not can_exit_other then
      raise exception 'only the room host may exit another membership';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id || ':' || target::text, 0));
  insert into public.room_membership_exits (room_id, owner_user_id, exit_reason)
  values (p_room_id, target, p_exit_reason)
  on conflict on constraint room_membership_exits_pkey do nothing;

  -- Deleting by auth ownership, never by client participant id, makes the
  -- exit record survive deletion while preserving room/game history tables.
  delete from public.participants p
  where p.room_id = p_room_id
    and p.owner_user_id = target;

  return query
  select e.room_id, e.owner_user_id, e.exit_reason, e.exited_at
  from public.room_membership_exits e
  where e.room_id = p_room_id
    and e.owner_user_id = target;
end;
$$;

revoke all on function public.prevent_terminal_room_reentry() from public;
revoke all on function public.current_user_has_terminal_room_exit(text, uuid) from public;
revoke all on function public.current_user_has_exited_room(text) from public;
revoke all on function public.exit_room_permanently(text, text, uuid) from public;
grant execute on function public.current_user_has_terminal_room_exit(text, uuid) to authenticated;
grant execute on function public.current_user_has_exited_room(text) to authenticated;
grant execute on function public.exit_room_permanently(text, text, uuid) to authenticated, service_role;

comment on table public.room_membership_exits is
  'Terminal room exits keyed by server Auth ownership. An exit prevents future gameplay membership in the same room but does not erase game/account history.';

commit;

-- Rollback (only after client code no longer calls these RPCs):
-- revoke execute on function public.exit_room_permanently(text, text, uuid) from authenticated, service_role;
-- revoke execute on function public.current_user_has_exited_room(text) from authenticated;
-- drop function if exists public.exit_room_permanently(text, text, uuid);
-- drop function if exists public.current_user_has_exited_room(text);
-- drop function if exists public.current_user_has_terminal_room_exit(text, uuid);
-- drop trigger if exists participants_terminal_room_reentry_guard on public.participants;
-- drop function if exists public.prevent_terminal_room_reentry();
-- drop policy if exists participants_not_terminally_exited_insert on public.participants;
-- drop table if exists public.room_membership_exits;
