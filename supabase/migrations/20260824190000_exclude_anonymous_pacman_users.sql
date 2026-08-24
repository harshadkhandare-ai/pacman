begin;

create or replace function public.pacman_is_counted_user(
  p_user_id text
)
returns boolean
language sql
immutable
as $$
  select
    nullif(trim(coalesce(p_user_id, '')), '') is not null
    and lower(trim(p_user_id)) not in ('userid', 'user_id', 'undefined', 'null')
    and lower(trim(p_user_id)) not like 'anon:%';
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
      and public.pacman_is_counted_user(user_id)
  ),
  new_users as (
    select count(*)::bigint as value
    from public.pacman_user_activity
    where (first_seen_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      and public.pacman_is_counted_user(user_id)
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
      and public.pacman_is_counted_user(users.user_id)
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

create or replace function public.pacman_admin_users_shared(
  p_from date,
  p_to date,
  p_password text,
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
set search_path = public, extensions
as $$
declare
  v_days integer := p_to - p_from + 1;
  v_search text := nullif(trim(p_search), '');
  v_sort text := coalesce(p_sort, 'lastSeenAt');
  v_direction text := lower(coalesce(p_direction, 'desc'));
begin
  if not public.pacman_check_admin_password(p_password) then
    raise exception 'Invalid Pac-Man admin password' using errcode = '42501';
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
        and public.pacman_is_counted_user(activity.user_id)
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
        and public.pacman_is_counted_user(activity.user_id)
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

revoke all on function public.pacman_is_counted_user(text) from public, anon, authenticated;

comment on function public.pacman_is_counted_user(text) is 'True only for supplied Pac-Man player IDs that should be included in admin analytics.';

commit;
