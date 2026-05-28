create table if not exists public.user_game_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  penalties integer not null default 0,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_game_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id text,
  round integer,
  result text not null check (result in ('win', 'lose', 'draw')),
  penalty_text text,
  created_at timestamptz not null default now()
);

alter table public.user_game_stats enable row level security;
alter table public.user_game_history enable row level security;

drop policy if exists "Users can view own game stats" on public.user_game_stats;
drop policy if exists "Users can insert own game stats" on public.user_game_stats;
drop policy if exists "Users can update own game stats" on public.user_game_stats;
drop policy if exists "Users can view own game history" on public.user_game_history;
drop policy if exists "Users can insert own game history" on public.user_game_history;

create policy "Users can view own game stats"
  on public.user_game_stats for select
  using (auth.uid() = user_id);

create policy "Users can insert own game stats"
  on public.user_game_stats for insert
  with check (auth.uid() = user_id);

create policy "Users can update own game stats"
  on public.user_game_stats for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can view own game history"
  on public.user_game_history for select
  using (auth.uid() = user_id);

create policy "Users can insert own game history"
  on public.user_game_history for insert
  with check (auth.uid() = user_id);
