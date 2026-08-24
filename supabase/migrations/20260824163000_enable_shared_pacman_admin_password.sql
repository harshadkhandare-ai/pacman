begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pacman_admin_config (
  config_key text primary key,
  password_hash text not null,
  updated_at timestamptz not null default now(),
  constraint pacman_admin_config_key_check check (config_key = 'shared_password')
);

alter table public.pacman_admin_config enable row level security;
revoke all on table public.pacman_admin_config from anon, authenticated;

insert into public.pacman_admin_config (config_key, password_hash)
values (
  'shared_password',
  '$2a$10$NNLZqFxgkxGmEpwaqFCIj.JDEyJEqqgRy.atfVr1hjyhYOi3SKpru'
)
on conflict (config_key) do update
set password_hash = excluded.password_hash,
    updated_at = now();

create or replace function public.pacman_check_admin_password(
  p_password text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.pacman_admin_config as config
    where config.config_key = 'shared_password'
      and char_length(coalesce(p_password, '')) between 8 and 128
      and extensions.crypt(p_password, config.password_hash) = config.password_hash
  );
$$;

create or replace function public.pacman_admin_overview_shared(
  p_from date,
  p_to date,
  p_password text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := p_to - p_from + 1;
  v_previous_to date;
  v_previous_from date;
  v_current jsonb;
  v_previous jsonb;
begin
  if not public.pacman_check_admin_password(p_password) then
    raise exception 'Invalid Pac-Man admin password' using errcode = '42501';
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

revoke all on function public.pacman_check_admin_password(text) from public, anon, authenticated;
revoke all on function public.pacman_admin_overview_shared(date, date, text) from public, anon, authenticated;
revoke all on function public.pacman_admin_users_shared(date, date, text, text, integer, integer, text, text) from public, anon, authenticated;

grant execute on function public.pacman_admin_overview_shared(date, date, text) to anon, authenticated;
grant execute on function public.pacman_admin_users_shared(date, date, text, text, integer, integer, text, text) to anon, authenticated;

comment on table public.pacman_admin_config is 'Private Pac-Man admin configuration, including the hashed shared dashboard password.';
comment on function public.pacman_admin_overview_shared(date, date, text) is 'Shared-password Pac-Man overview and retention report.';
comment on function public.pacman_admin_users_shared(date, date, text, text, integer, integer, text, text) is 'Shared-password Pac-Man users report.';

commit;
