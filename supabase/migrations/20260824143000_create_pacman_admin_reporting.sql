begin;

create table if not exists public.pacman_daily_activity (
  activity_date date not null,
  user_id text not null
    references public.pacman_user_activity(user_id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visits integer not null default 0 check (visits >= 0),
  games_started integer not null default 0 check (games_started >= 0),
  levels_completed integer not null default 0 check (levels_completed >= 0),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  primary key (activity_date, user_id)
);

create index if not exists pacman_daily_activity_user_date_idx
  on public.pacman_daily_activity (user_id, activity_date desc);

alter table public.pacman_daily_activity enable row level security;
revoke all on table public.pacman_daily_activity from anon, authenticated;

-- Backfill the best available daily history from the aggregate tracking tables.
insert into public.pacman_daily_activity (
  activity_date, user_id, first_seen_at, last_seen_at, visits
)
select
  (users.first_seen_at at time zone 'Asia/Kolkata')::date,
  users.user_id,
  users.first_seen_at,
  users.last_seen_at,
  users.visit_count
from public.pacman_user_activity as users
on conflict (activity_date, user_id) do update
set
  first_seen_at = least(pacman_daily_activity.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(pacman_daily_activity.last_seen_at, excluded.last_seen_at),
  visits = greatest(pacman_daily_activity.visits, excluded.visits);

insert into public.pacman_daily_activity (
  activity_date, user_id, first_seen_at, last_seen_at,
  games_started, active_seconds
)
select
  (sessions.started_at at time zone 'Asia/Kolkata')::date,
  sessions.user_id,
  min(sessions.started_at),
  max(sessions.last_active_at),
  count(*)::integer,
  coalesce(sum(sessions.time_spent_seconds), 0)::integer
from public.pacman_game_sessions as sessions
group by 1, 2
on conflict (activity_date, user_id) do update
set
  first_seen_at = least(pacman_daily_activity.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(pacman_daily_activity.last_seen_at, excluded.last_seen_at),
  games_started = greatest(pacman_daily_activity.games_started, excluded.games_started),
  active_seconds = greatest(pacman_daily_activity.active_seconds, excluded.active_seconds);

insert into public.pacman_daily_activity (
  activity_date, user_id, first_seen_at, last_seen_at, levels_completed
)
select
  (levels.completed_at at time zone 'Asia/Kolkata')::date,
  levels.user_id,
  min(levels.completed_at),
  max(levels.completed_at),
  count(*)::integer
from public.pacman_level_completions as levels
group by 1, 2
on conflict (activity_date, user_id) do update
set
  first_seen_at = least(pacman_daily_activity.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(pacman_daily_activity.last_seen_at, excluded.last_seen_at),
  levels_completed = greatest(pacman_daily_activity.levels_completed, excluded.levels_completed);

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
  v_activity_date date := (now() at time zone 'Asia/Kolkata')::date;
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

  insert into public.pacman_daily_activity (
    activity_date, user_id, visits
  ) values (
    v_activity_date,
    v_user_id,
    case when v_event_type = 'user_arrived' then 1 else 0 end
  )
  on conflict (activity_date, user_id) do update
  set
    last_seen_at = now(),
    visits = pacman_daily_activity.visits + excluded.visits;

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

      update public.pacman_daily_activity
      set games_started = games_started + 1,
          last_seen_at = now()
      where activity_date = v_activity_date and user_id = v_user_id;
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

    update public.pacman_daily_activity
    set active_seconds = active_seconds + v_delta,
        last_seen_at = now()
    where activity_date = v_activity_date and user_id = v_user_id;
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

      update public.pacman_daily_activity
      set levels_completed = levels_completed + 1,
          last_seen_at = now()
      where activity_date = v_activity_date and user_id = v_user_id;

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

create table if not exists public.pacman_admin_users (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint pacman_admin_users_email_check check (
    email = lower(trim(email)) and char_length(email) between 3 and 254
  )
);

alter table public.pacman_admin_users enable row level security;
revoke all on table public.pacman_admin_users from anon, authenticated;

insert into public.pacman_admin_users (email)
values ('swapnil.pande@classplus.co')
on conflict (email) do update set active = true;

create or replace function public.pacman_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pacman_admin_users as admins
    where admins.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and admins.active
  );
$$;

create or replace function public.pacman_metric_change(
  p_current numeric,
  p_previous numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_previous, 0) = 0 and coalesce(p_current, 0) = 0 then 0
    when coalesce(p_previous, 0) = 0 then 100
    else round((p_current - p_previous) / abs(p_previous) * 100, 1)
  end;
$$;

create or replace function public.pacman_metrics_for_range(
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with activity as (
    select
      count(distinct user_id)::bigint as total_users,
      coalesce(sum(games_started), 0)::bigint as games_started,
      coalesce(sum(levels_completed), 0)::bigint as levels_completed,
      coalesce(sum(active_seconds), 0)::bigint as active_seconds
    from public.pacman_daily_activity
    where activity_date between p_from and p_to
  ),
  new_users as (
    select count(*)::bigint as value
    from public.pacman_user_activity
    where (first_seen_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  )
  select jsonb_build_object(
    'totalUsers', activity.total_users,
    'newUsers', new_users.value,
    'totalGamesStarted', activity.games_started,
    'totalLevelsCleared', activity.levels_completed,
    'totalTimeSeconds', activity.active_seconds,
    'avgGamesPlayed', coalesce(round(activity.games_started::numeric / nullif(activity.total_users, 0), 2), 0),
    'avgLevelsCleared', coalesce(round(activity.levels_completed::numeric / nullif(activity.total_users, 0), 2), 0),
    'avgTimeSeconds', coalesce(round(activity.active_seconds::numeric / nullif(activity.total_users, 0), 2), 0)
  )
  from activity, new_users;
$$;

create or replace function public.pacman_retention_for_range(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_rows jsonb;
begin
  with cohort_users as (
    select
      users.user_id,
      (users.first_seen_at at time zone 'Asia/Kolkata')::date as cohort_date
    from public.pacman_user_activity as users
    where (users.first_seen_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  cohort_activity as (
    select
      cohorts.cohort_date,
      cohorts.user_id,
      activity.activity_date - cohorts.cohort_date as active_day
    from cohort_users as cohorts
    left join public.pacman_daily_activity as activity
      on activity.user_id = cohorts.user_id
      and activity.activity_date >= cohorts.cohort_date
  ),
  counts as (
    select
      cohort_date,
      count(distinct user_id)::bigint as cohort_users,
      count(distinct user_id) filter (where active_day = 0)::bigint as d0_users,
      count(distinct user_id) filter (where active_day = 1)::bigint as d1_users,
      count(distinct user_id) filter (where active_day = 2)::bigint as d2_users,
      count(distinct user_id) filter (where active_day = 3)::bigint as d3_users,
      count(distinct user_id) filter (where active_day = 4)::bigint as d4_users,
      count(distinct user_id) filter (where active_day = 5)::bigint as d5_users,
      count(distinct user_id) filter (where active_day = 6)::bigint as d6_users,
      count(distinct user_id) filter (where active_day = 7)::bigint as d7_users,
      count(distinct user_id) filter (where active_day >= 8)::bigint as d8_users
    from cohort_activity
    group by cohort_date
  ),
  rows as (
    select
      cohort_date,
      cohort_users,
      jsonb_build_object('users', d0_users, 'rate', round(d0_users::numeric / nullif(cohort_users, 0) * 100, 1)) as d0,
      case when v_today >= cohort_date + 1 then jsonb_build_object('users', d1_users, 'rate', round(d1_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d1,
      case when v_today >= cohort_date + 2 then jsonb_build_object('users', d2_users, 'rate', round(d2_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d2,
      case when v_today >= cohort_date + 3 then jsonb_build_object('users', d3_users, 'rate', round(d3_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d3,
      case when v_today >= cohort_date + 4 then jsonb_build_object('users', d4_users, 'rate', round(d4_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d4,
      case when v_today >= cohort_date + 5 then jsonb_build_object('users', d5_users, 'rate', round(d5_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d5,
      case when v_today >= cohort_date + 6 then jsonb_build_object('users', d6_users, 'rate', round(d6_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d6,
      case when v_today >= cohort_date + 7 then jsonb_build_object('users', d7_users, 'rate', round(d7_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d7,
      case when v_today >= cohort_date + 8 then jsonb_build_object('users', d8_users, 'rate', round(d8_users::numeric / nullif(cohort_users, 0) * 100, 1)) end as d8_plus
    from counts
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'cohortDate', cohort_date,
      'newUsers', cohort_users,
      'd0', d0, 'd1', d1, 'd2', d2, 'd3', d3, 'd4', d4,
      'd5', d5, 'd6', d6, 'd7', d7, 'd8Plus', d8_plus
    ) order by cohort_date desc
  ), '[]'::jsonb)
  into v_rows
  from rows;

  return jsonb_build_object('generatedThrough', v_today, 'rows', v_rows);
end;
$$;

create or replace function public.pacman_admin_overview(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := p_to - p_from + 1;
  v_previous_to date;
  v_previous_from date;
  v_current jsonb;
  v_previous jsonb;
begin
  if not public.pacman_is_admin() then
    raise exception 'Pac-Man admin access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or v_days not between 1 and 90 then
    raise exception 'Date range must be between 1 and 90 days';
  end if;

  v_previous_to := p_from - 1;
  v_previous_from := v_previous_to - v_days + 1;
  v_current := public.pacman_metrics_for_range(p_from, p_to);
  v_previous := public.pacman_metrics_for_range(v_previous_from, v_previous_to);

  return jsonb_build_object(
    'timezone', 'Asia/Kolkata',
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'comparisonRange', jsonb_build_object('from', v_previous_from, 'to', v_previous_to),
    'current', v_current,
    'previous', v_previous,
    'changes', jsonb_build_object(
      'totalUsers', public.pacman_metric_change((v_current ->> 'totalUsers')::numeric, (v_previous ->> 'totalUsers')::numeric),
      'newUsers', public.pacman_metric_change((v_current ->> 'newUsers')::numeric, (v_previous ->> 'newUsers')::numeric),
      'totalGamesStarted', public.pacman_metric_change((v_current ->> 'totalGamesStarted')::numeric, (v_previous ->> 'totalGamesStarted')::numeric),
      'totalLevelsCleared', public.pacman_metric_change((v_current ->> 'totalLevelsCleared')::numeric, (v_previous ->> 'totalLevelsCleared')::numeric),
      'totalTimeSeconds', public.pacman_metric_change((v_current ->> 'totalTimeSeconds')::numeric, (v_previous ->> 'totalTimeSeconds')::numeric),
      'avgGamesPlayed', public.pacman_metric_change((v_current ->> 'avgGamesPlayed')::numeric, (v_previous ->> 'avgGamesPlayed')::numeric),
      'avgLevelsCleared', public.pacman_metric_change((v_current ->> 'avgLevelsCleared')::numeric, (v_previous ->> 'avgLevelsCleared')::numeric),
      'avgTimeSeconds', public.pacman_metric_change((v_current ->> 'avgTimeSeconds')::numeric, (v_previous ->> 'avgTimeSeconds')::numeric)
    ),
    'retention', public.pacman_retention_for_range(p_from, p_to)
  );
end;
$$;

create or replace function public.pacman_admin_users(
  p_from date,
  p_to date,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_sort text default 'lastSeenAt',
  p_direction text default 'desc'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := p_to - p_from + 1;
  v_search text := nullif(trim(p_search), '');
  v_sort text := coalesce(p_sort, 'lastSeenAt');
  v_direction text := lower(coalesce(p_direction, 'desc'));
begin
  if not public.pacman_is_admin() then
    raise exception 'Pac-Man admin access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or v_days not between 1 and 90
    or p_limit not between 1 and 500 or p_offset not between 0 and 100000
    or char_length(coalesce(v_search, '')) > 128
    or v_sort not in ('userId', 'gamesPlayed', 'levelsCleared', 'timeSpentSeconds', 'activeDay', 'firstSeenAt', 'lastSeenAt')
    or v_direction not in ('asc', 'desc') then
    raise exception 'Invalid Pac-Man users report request';
  end if;

  return (
    with selected_activity as (
      select
        activity.user_id,
        sum(activity.games_started)::bigint as games_played,
        sum(activity.levels_completed)::bigint as levels_cleared,
        sum(activity.active_seconds)::bigint as time_spent_seconds,
        max(activity.activity_date) as last_active_date
      from public.pacman_daily_activity as activity
      where activity.activity_date between p_from and p_to
      group by activity.user_id
    ),
    active_days as (
      select
        activity.user_id,
        coalesce(jsonb_agg(
          distinct ('D' || (activity.activity_date - (users.first_seen_at at time zone 'Asia/Kolkata')::date)::text)
        ), '[]'::jsonb) as days
      from public.pacman_daily_activity as activity
      join public.pacman_user_activity as users using (user_id)
      where activity.activity_date between p_from and p_to
      group by activity.user_id
    ),
    report as (
      select
        users.user_id,
        selected.games_played,
        selected.levels_cleared,
        selected.time_spent_seconds,
        greatest(0, selected.last_active_date - (users.first_seen_at at time zone 'Asia/Kolkata')::date) as active_day,
        coalesce(active_days.days, '[]'::jsonb) as active_days,
        users.first_seen_at,
        users.last_seen_at
      from selected_activity as selected
      join public.pacman_user_activity as users using (user_id)
      left join active_days using (user_id)
      where v_search is null or users.user_id ilike '%' || v_search || '%'
    ),
    paged as (
      select * from report
      order by
        case when v_sort = 'userId' and v_direction = 'asc' then user_id end asc,
        case when v_sort = 'userId' and v_direction = 'desc' then user_id end desc,
        case when v_sort = 'gamesPlayed' and v_direction = 'asc' then games_played end asc,
        case when v_sort = 'gamesPlayed' and v_direction = 'desc' then games_played end desc,
        case when v_sort = 'levelsCleared' and v_direction = 'asc' then levels_cleared end asc,
        case when v_sort = 'levelsCleared' and v_direction = 'desc' then levels_cleared end desc,
        case when v_sort = 'timeSpentSeconds' and v_direction = 'asc' then time_spent_seconds end asc,
        case when v_sort = 'timeSpentSeconds' and v_direction = 'desc' then time_spent_seconds end desc,
        case when v_sort = 'activeDay' and v_direction = 'asc' then active_day end asc,
        case when v_sort = 'activeDay' and v_direction = 'desc' then active_day end desc,
        case when v_sort = 'firstSeenAt' and v_direction = 'asc' then first_seen_at end asc,
        case when v_sort = 'firstSeenAt' and v_direction = 'desc' then first_seen_at end desc,
        case when v_sort = 'lastSeenAt' and v_direction = 'asc' then last_seen_at end asc,
        case when v_sort = 'lastSeenAt' and v_direction = 'desc' then last_seen_at end desc,
        last_seen_at desc,
        user_id
      limit p_limit offset p_offset
    )
    select jsonb_build_object(
      'timezone', 'Asia/Kolkata',
      'range', jsonb_build_object('from', p_from, 'to', p_to),
      'total', (select count(*) from report),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', user_id,
        'gamesPlayed', games_played,
        'levelsCleared', levels_cleared,
        'timeSpentSeconds', time_spent_seconds,
        'activeDay', active_day,
        'activeDays', active_days,
        'firstSeenAt', first_seen_at,
        'lastSeenAt', last_seen_at
      )) from paged), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.pacman_is_admin() from public, anon, authenticated;
revoke all on function public.pacman_metric_change(numeric, numeric) from public, anon, authenticated;
revoke all on function public.pacman_metrics_for_range(date, date) from public, anon, authenticated;
revoke all on function public.pacman_retention_for_range(date, date) from public, anon, authenticated;
revoke all on function public.pacman_admin_overview(date, date) from public, anon, authenticated;
revoke all on function public.pacman_admin_users(date, date, text, integer, integer, text, text) from public, anon, authenticated;

grant execute on function public.pacman_admin_overview(date, date) to authenticated;
grant execute on function public.pacman_admin_users(date, date, text, integer, integer, text, text) to authenticated;

comment on table public.pacman_daily_activity is 'Pac-Man activity counters grouped by player and India Standard Time calendar date.';
comment on table public.pacman_admin_users is 'Explicit allowlist for authenticated Pac-Man analytics administrators.';
comment on function public.pacman_admin_overview(date, date) is 'Private Pac-Man overview metrics and D0-D8+ retention report.';
comment on function public.pacman_admin_users(date, date, text, integer, integer, text, text) is 'Private paginated Pac-Man player analytics report.';

commit;
