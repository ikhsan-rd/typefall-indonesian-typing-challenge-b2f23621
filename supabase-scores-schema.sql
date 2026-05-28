-- ============================================================
-- SanGames Scoreboard Schema
-- Jalankan di Supabase Dashboard -> SQL Editor (project: sanGames)
-- ============================================================

drop table if exists public.scores cascade;

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'typefall',
  player_name text not null check (char_length(trim(player_name)) between 1 and 24),
  score int not null check (score >= 0 and score <= 1000000),
  level int not null default 1 check (level >= 1 and level <= 999),
  accuracy int not null default 0 check (accuracy >= 0 and accuracy <= 100),
  wpm int not null default 0 check (wpm >= 0 and wpm <= 1000),
  duration_sec int not null default 0 check (duration_sec >= 0 and duration_sec <= 86400),
  created_at timestamptz not null default now()
);

create index scores_game_score_idx on public.scores (game, score desc, created_at desc);

-- Realtime opsional
alter publication supabase_realtime add table public.scores;

-- Grants (Data API)
grant select, insert on public.scores to anon, authenticated;
grant all on public.scores to service_role;

-- RLS: public read & insert (validasi via CHECK constraints)
alter table public.scores enable row level security;

drop policy if exists "scores_select_all" on public.scores;
create policy "scores_select_all" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "scores_insert_all" on public.scores;
create policy "scores_insert_all" on public.scores
  for insert to anon, authenticated with check (true);
