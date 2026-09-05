-- TEST FIXTURE — DO NOT DEPLOY.
-- Reconstructs only the deployed Seoul rooms/participants metadata evidenced
-- by the authoritative R2 inspection CSV. It intentionally contains no data,
-- unsupported triggers, extra constraints, or application functions.

create table public.rooms (
  id text primary key,
  status text default 'waiting',
  penalty text,
  round integer default 1,
  created_at timestamptz default now()
);

create table public.participants (
  id text primary key,
  room_id text references public.rooms(id) on delete cascade,
  name text not null,
  is_host boolean default false,
  choice text,
  wins integer default 0,
  losses integer default 0,
  draws integer default 0,
  penalties integer default 0,
  created_at timestamptz default now(),
  is_ready boolean default false,
  leave_after_round boolean not null default false
);

alter table public.rooms enable row level security;
alter table public.participants enable row level security;

create policy allow_all_rooms
on public.rooms as permissive
for all to public
using (true)
with check (true);

create policy allow_all_participants
on public.participants as permissive
for all to public
using (true)
with check (true);

grant select, insert, update, delete on public.rooms to anon, authenticated;
grant select, insert, update, delete on public.participants to anon, authenticated;
grant select, insert, update, delete on public.rooms to service_role;
grant select, insert, update, delete on public.participants to service_role;
