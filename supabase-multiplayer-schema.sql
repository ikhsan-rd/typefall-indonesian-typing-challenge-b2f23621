-- ============================================================
-- TypeFall Multiplayer Schema
-- Run this in Supabase Dashboard -> SQL Editor (project: sanGames)
-- Make sure "Anonymous sign-ins" is ENABLED in
-- Authentication -> Providers -> Email/Anonymous.
-- ============================================================

-- Cleanup (safe to re-run)
drop table if exists public.room_state cascade;
drop table if exists public.room_players cascade;
drop table if exists public.rooms cascade;
drop function if exists public.is_room_member(uuid, uuid) cascade;
drop function if exists public.create_room(int, int, int, text) cascade;
drop function if exists public.join_room(text, text) cascade;
drop function if exists public.set_ready(uuid, bool) cascade;
drop function if exists public.start_match(uuid) cascade;
drop function if exists public.award_score(uuid, int) cascade;
drop function if exists public.penalize(uuid) cascade;
drop function if exists public.end_round(uuid) cascade;
drop function if exists public.next_round(uuid) cascade;

-- ============= TABLES =============
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'waiting'
    check (status in ('waiting','playing','round_end','match_end')),
  host_user_id uuid not null,
  target_diff int not null default 20,
  round_time int not null default 90,
  max_rounds int not null default 3,
  round_winner int,
  match_winner int,
  created_at timestamptz default now()
);
create index on public.rooms (code);

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  slot int not null check (slot in (1,2)),
  is_ready bool not null default false,
  joined_at timestamptz default now(),
  unique (room_id, slot),
  unique (room_id, user_id)
);

create table public.room_state (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  round int not null default 1,
  round_started_at timestamptz,
  score_p1 int not null default 0,
  score_p2 int not null default 0,
  diff_score int not null default 0,
  combined_score int not null default 0,
  level int not null default 1,
  last_gain_p1 int not null default 0,
  last_gain_p2 int not null default 0,
  wins_p1 int not null default 0,
  wins_p2 int not null default 0,
  updated_at timestamptz default now()
);

-- ============= REALTIME =============
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.room_state;

-- ============= HELPER =============
create or replace function public.is_room_member(_room uuid, _user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_players
    where room_id = _room and user_id = _user
  );
$$;

-- ============= RLS =============
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_state enable row level security;

-- Rooms: anyone authenticated may select (needed for join-by-code lookup).
create policy "rooms_select_all_auth" on public.rooms
  for select to authenticated using (true);
-- Inserts/updates happen only through SECURITY DEFINER RPCs.

-- Players: visible only to room members; self can see their own row pre-join.
create policy "players_select_member" on public.room_players
  for select to authenticated
  using (user_id = auth.uid() or public.is_room_member(room_id, auth.uid()));

-- State: only room members can read.
create policy "state_select_member" on public.room_state
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

-- ============= RPCs =============
-- All writes happen here so logic is atomic and race-safe.

create or replace function public.create_room(
  _target_diff int default 20,
  _round_time int default 90,
  _max_rounds int default 3,
  _name text default 'Host'
) returns table (room_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _code text;
  _id uuid;
  _try int := 0;
begin
  if _uid is null then raise exception 'auth required'; end if;
  loop
    _code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.rooms where code = _code);
    _try := _try + 1;
    if _try > 8 then raise exception 'code generation failed'; end if;
  end loop;

  insert into public.rooms (code, host_user_id, target_diff, round_time, max_rounds)
  values (_code, _uid, greatest(5, least(_target_diff, 100)),
          greatest(20, least(_round_time, 300)),
          greatest(1, least(_max_rounds, 7)))
  returning id into _id;

  insert into public.room_players (room_id, user_id, name, slot)
  values (_id, _uid, coalesce(nullif(trim(_name),''),'Host'), 1);

  insert into public.room_state (room_id) values (_id);

  return query select _id, _code;
end $$;

create or replace function public.join_room(_code text, _name text default 'Guest')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _room public.rooms;
  _count int;
begin
  if _uid is null then raise exception 'auth required'; end if;
  select * into _room from public.rooms where code = upper(_code);
  if _room is null then raise exception 'room not found'; end if;
  if _room.status not in ('waiting') then raise exception 'room not joinable'; end if;

  -- already in?
  if exists (select 1 from public.room_players where room_id = _room.id and user_id = _uid) then
    return _room.id;
  end if;

  select count(*) into _count from public.room_players where room_id = _room.id;
  if _count >= 2 then raise exception 'room full'; end if;

  insert into public.room_players (room_id, user_id, name, slot)
  values (_room.id, _uid, coalesce(nullif(trim(_name),''),'Guest'), 2);
  return _room.id;
end $$;

create or replace function public.set_ready(_room uuid, _ready bool)
returns void language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'auth required'; end if;
  update public.room_players set is_ready = _ready
   where room_id = _room and user_id = _uid;
end $$;

create or replace function public.start_match(_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _room_rec public.rooms;
  _ready_count int;
  _total int;
begin
  select * into _room_rec from public.rooms where id = _room;
  if _room_rec is null then raise exception 'room not found'; end if;
  if _room_rec.host_user_id <> _uid then raise exception 'only host'; end if;

  select count(*) into _total from public.room_players where room_id = _room;
  if _total < 2 then raise exception 'need 2 players'; end if;
  select count(*) into _ready_count from public.room_players
    where room_id = _room and is_ready = true;
  if _ready_count < 2 then raise exception 'players not ready'; end if;

  update public.rooms set status = 'playing',
                          round_winner = null, match_winner = null
   where id = _room;
  update public.room_state set
    round = 1,
    round_started_at = now(),
    score_p1 = 0, score_p2 = 0, diff_score = 0, combined_score = 0,
    level = 1, last_gain_p1 = 0, last_gain_p2 = 0,
    wins_p1 = 0, wins_p2 = 0, updated_at = now()
  where room_id = _room;
end $$;

-- Award points to calling player. Returns new state.
create or replace function public.award_score(_room uuid, _points int)
returns public.room_state
language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _slot int;
  _room_rec public.rooms;
  _st public.room_state;
begin
  if _uid is null then raise exception 'auth required'; end if;
  select slot into _slot from public.room_players where room_id = _room and user_id = _uid;
  if _slot is null then raise exception 'not a player'; end if;
  select * into _room_rec from public.rooms where id = _room;
  if _room_rec.status <> 'playing' then
    select * into _st from public.room_state where room_id = _room;
    return _st;
  end if;

  _points := greatest(0, least(_points, 16));

  if _slot = 1 then
    update public.room_state set
      score_p1 = score_p1 + _points,
      last_gain_p1 = _points,
      combined_score = combined_score + _points,
      diff_score = (score_p1 + _points) - score_p2,
      level = greatest(level, 1 + ((combined_score + _points) / 30)),
      updated_at = now()
    where room_id = _room
    returning * into _st;
  else
    update public.room_state set
      score_p2 = score_p2 + _points,
      last_gain_p2 = _points,
      combined_score = combined_score + _points,
      diff_score = score_p1 - (score_p2 + _points),
      level = greatest(level, 1 + ((combined_score + _points) / 30)),
      updated_at = now()
    where room_id = _room
    returning * into _st;
  end if;

  -- check round win by target_diff
  if _st.diff_score >= _room_rec.target_diff then
    perform public.end_round(_room);
    select * into _st from public.room_state where room_id = _room;
  elsif _st.diff_score <= -_room_rec.target_diff then
    perform public.end_round(_room);
    select * into _st from public.room_state where room_id = _room;
  end if;

  return _st;
end $$;

-- Penalty: caller missed an object. penalty = min(opponent.last_gain, 4) or 2 default
create or replace function public.penalize(_room uuid)
returns public.room_state
language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _slot int;
  _pen int;
  _st public.room_state;
  _room_rec public.rooms;
begin
  if _uid is null then raise exception 'auth required'; end if;
  select slot into _slot from public.room_players where room_id = _room and user_id = _uid;
  if _slot is null then raise exception 'not a player'; end if;
  select * into _room_rec from public.rooms where id = _room;
  if _room_rec.status <> 'playing' then
    select * into _st from public.room_state where room_id = _room;
    return _st;
  end if;

  select * into _st from public.room_state where room_id = _room;

  if _slot = 1 then
    _pen := greatest(2, least(coalesce(_st.last_gain_p2, 2), 4));
    update public.room_state set
      score_p1 = greatest(0, score_p1 - _pen),
      diff_score = greatest(0, score_p1 - _pen) - score_p2,
      updated_at = now()
    where room_id = _room
    returning * into _st;
  else
    _pen := greatest(2, least(coalesce(_st.last_gain_p1, 2), 4));
    update public.room_state set
      score_p2 = greatest(0, score_p2 - _pen),
      diff_score = score_p1 - greatest(0, score_p2 - _pen),
      updated_at = now()
    where room_id = _room
    returning * into _st;
  end if;

  if _st.diff_score >= _room_rec.target_diff or _st.diff_score <= -_room_rec.target_diff then
    perform public.end_round(_room);
    select * into _st from public.room_state where room_id = _room;
  end if;
  return _st;
end $$;

-- End current round (idempotent within a round)
create or replace function public.end_round(_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _room_rec public.rooms;
  _st public.room_state;
  _winner int;
begin
  select * into _room_rec from public.rooms where id = _room;
  if _room_rec is null or _room_rec.status <> 'playing' then return; end if;
  select * into _st from public.room_state where room_id = _room;

  if _st.diff_score > 0 then _winner := 1;
  elsif _st.diff_score < 0 then _winner := 2;
  else _winner := 0;
  end if;

  update public.room_state set
    wins_p1 = wins_p1 + case when _winner = 1 then 1 else 0 end,
    wins_p2 = wins_p2 + case when _winner = 2 then 1 else 0 end,
    updated_at = now()
  where room_id = _room
  returning * into _st;

  -- match end?
  if _st.wins_p1 * 2 > _room_rec.max_rounds then
    update public.rooms set status = 'match_end', match_winner = 1, round_winner = _winner where id = _room;
  elsif _st.wins_p2 * 2 > _room_rec.max_rounds then
    update public.rooms set status = 'match_end', match_winner = 2, round_winner = _winner where id = _room;
  elsif _st.round >= _room_rec.max_rounds then
    -- all rounds played, decide match by wins
    update public.rooms set status = 'match_end',
      match_winner = case when _st.wins_p1 > _st.wins_p2 then 1
                          when _st.wins_p2 > _st.wins_p1 then 2 else 0 end,
      round_winner = _winner
    where id = _room;
  else
    update public.rooms set status = 'round_end', round_winner = _winner where id = _room;
  end if;
end $$;

-- Host advances to next round
create or replace function public.next_round(_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _room_rec public.rooms;
begin
  select * into _room_rec from public.rooms where id = _room;
  if _room_rec is null then raise exception 'room not found'; end if;
  if _room_rec.host_user_id <> _uid then raise exception 'only host'; end if;
  if _room_rec.status <> 'round_end' then return; end if;

  update public.room_state set
    round = round + 1,
    diff_score = 0,
    score_p1 = 0,
    score_p2 = 0,
    last_gain_p1 = 0,
    last_gain_p2 = 0,
    round_started_at = now(),
    updated_at = now()
  where room_id = _room;
  update public.rooms set status = 'playing', round_winner = null where id = _room;
end $$;

grant execute on function public.create_room(int,int,int,text) to authenticated;
grant execute on function public.join_room(text,text) to authenticated;
grant execute on function public.set_ready(uuid,bool) to authenticated;
grant execute on function public.start_match(uuid) to authenticated;
grant execute on function public.award_score(uuid,int) to authenticated;
grant execute on function public.penalize(uuid) to authenticated;
grant execute on function public.end_round(uuid) to authenticated;
grant execute on function public.next_round(uuid) to authenticated;
