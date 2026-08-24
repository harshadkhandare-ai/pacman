create table if not exists public.pacman_user_activity (
  user_id text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count integer not null default 0 check (visit_count >= 0),
  games_started integer not null default 0 check (games_started >= 0),
  levels_completed integer not null default 0 check (levels_completed >= 0),
  total_time_spent_seconds integer not null default 0 check (total_time_spent_seconds >= 0),
  constraint pacman_user_activity_user_id_length check (char_length(user_id) between 1 and 128)
);

create table if not exists public.pacman_game_sessions (
  session_id uuid primary key,
  user_id text not null references public.pacman_user_activity(user_id) on delete cascade,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at timestamptz,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  levels_completed integer not null default 0 check (levels_completed >= 0),
  current_level integer not null default 1 check (current_level >= 1),
  final_score integer not null default 0 check (final_score >= 0),
  status text not null default 'playing'
    check (status in ('playing', 'game_over', 'exited', 'abandoned', 'restarted'))
);

create index if not exists pacman_game_sessions_user_started_idx
  on public.pacman_game_sessions (user_id, started_at desc);

create table if not exists public.pacman_level_completions (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.pacman_game_sessions(session_id) on delete cascade,
  user_id text not null references public.pacman_user_activity(user_id) on delete cascade,
  level_number integer not null check (level_number >= 1),
  score integer not null default 0 check (score >= 0),
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  completed_at timestamptz not null default now(),
  unique (session_id, level_number)
);

create index if not exists pacman_level_completions_user_completed_idx
  on public.pacman_level_completions (user_id, completed_at desc);

alter table public.pacman_user_activity enable row level security;
alter table public.pacman_game_sessions enable row level security;
alter table public.pacman_level_completions enable row level security;

revoke all on table public.pacman_user_activity from anon, authenticated;
revoke all on table public.pacman_game_sessions from anon, authenticated;
revoke all on table public.pacman_level_completions from anon, authenticated;

create or replace function public.pacman_track_activity(
  p_event_type text,
  p_user_id text,
  p_session_id uuid default null,
  p_level_number integer default null,
  p_score integer default 0,
  p_time_spent_seconds integer default 0,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_user_id text := left(trim(coalesce(p_user_id, '')), 128);
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_time integer := least(604800, greatest(0, coalesce(p_time_spent_seconds, 0)));
  v_previous_time integer;
  v_delta integer := 0;
  v_inserted integer := 0;
begin
  if char_length(v_user_id) = 0 then
    raise exception 'A user ID is required';
  end if;

  if v_event_type not in ('user_arrived', 'game_started', 'heartbeat', 'level_completed', 'game_ended') then
    raise exception 'Unsupported Pac-Man tracking event';
  end if;

  insert into public.pacman_user_activity (user_id, visit_count)
  values (v_user_id, case when v_event_type = 'user_arrived' then 1 else 0 end)
  on conflict (user_id) do update
    set last_seen_at = now(),
        visit_count = public.pacman_user_activity.visit_count + excluded.visit_count;

  if v_event_type = 'user_arrived' then
    return jsonb_build_object('ok', true);
  end if;

  if p_session_id is null then
    raise exception 'A session ID is required for this event';
  end if;

  if v_event_type = 'game_started' then
    insert into public.pacman_game_sessions (session_id, user_id, current_level, final_score)
    values (p_session_id, v_user_id, greatest(1, coalesce(p_level_number, 1)), v_score)
    on conflict (session_id) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      update public.pacman_user_activity
      set games_started = games_started + 1,
          last_seen_at = now()
      where user_id = v_user_id;
    end if;

    return jsonb_build_object('ok', true);
  end if;

  select time_spent_seconds
  into v_previous_time
  from public.pacman_game_sessions
  where session_id = p_session_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Pac-Man session was not found';
  end if;

  v_delta := greatest(0, v_time - v_previous_time);

  update public.pacman_game_sessions
  set last_active_at = now(),
      time_spent_seconds = greatest(time_spent_seconds, v_time),
      current_level = greatest(current_level, coalesce(p_level_number, current_level)),
      final_score = greatest(final_score, v_score)
  where session_id = p_session_id and user_id = v_user_id;

  if v_delta > 0 then
    update public.pacman_user_activity
    set total_time_spent_seconds = total_time_spent_seconds + v_delta,
        last_seen_at = now()
    where user_id = v_user_id;
  end if;

  if v_event_type = 'level_completed' then
    if p_level_number is null or p_level_number < 1 then
      raise exception 'A valid level number is required';
    end if;

    insert into public.pacman_level_completions (
      session_id, user_id, level_number, score, time_spent_seconds
    ) values (
      p_session_id, v_user_id, p_level_number, v_score, v_time
    )
    on conflict (session_id, level_number) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      update public.pacman_user_activity
      set levels_completed = levels_completed + 1,
          last_seen_at = now()
      where user_id = v_user_id;

      update public.pacman_game_sessions
      set levels_completed = levels_completed + 1
      where session_id = p_session_id and user_id = v_user_id;
    end if;
  elsif v_event_type = 'game_ended' then
    update public.pacman_game_sessions
    set ended_at = coalesce(ended_at, now()),
        status = case
          when p_status in ('game_over', 'exited', 'abandoned', 'restarted') then p_status
          else 'abandoned'
        end
    where session_id = p_session_id and user_id = v_user_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pacman_track_activity(text, text, uuid, integer, integer, integer, text) from public;
grant execute on function public.pacman_track_activity(text, text, uuid, integer, integer, integer, text) to anon, authenticated;

comment on table public.pacman_user_activity is 'Aggregated Pac-Man visits, starts, completions, and active time by user ID.';
comment on table public.pacman_game_sessions is 'One row per Pac-Man game run, including duration, score, and end status.';
comment on table public.pacman_level_completions is 'One row per level completed in a Pac-Man game session.';

