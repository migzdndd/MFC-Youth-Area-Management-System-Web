-- =========================================================
-- MFC Youth Web - Administrator registration rate limiting
-- Protects the bootstrap Administrator Registration Code
-- from repeated guessing attempts.
--
-- Run after 005_cloud_modules.sql.
-- =========================================================

create table if not exists public.auth_rate_limits (
  rate_key text primary key,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.auth_rate_limits enable row level security;

-- Browser roles must never read or mutate rate-limit state.
revoke all on table public.auth_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.auth_rate_limits to service_role;

create or replace function public.check_auth_rate_limit(p_rate_key text)
returns table (
  attempt_count integer,
  blocked_until timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    r.attempt_count,
    r.blocked_until,
    case
      when r.blocked_until is not null and r.blocked_until > now()
        then greatest(1, ceil(extract(epoch from (r.blocked_until - now())))::integer)
      else 0
    end as retry_after_seconds
  from public.auth_rate_limits r
  where r.rate_key = p_rate_key;
end;
$$;

create or replace function public.record_auth_rate_limit_failure(
  p_rate_key text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table (
  attempt_count integer,
  blocked_until timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.auth_rate_limits%rowtype;
  next_count integer;
  next_window_started timestamptz;
  next_blocked_until timestamptz;
begin
  if p_max_attempts < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'Invalid rate-limit configuration.';
  end if;

  insert into public.auth_rate_limits (
    rate_key,
    attempt_count,
    window_started_at,
    blocked_until,
    updated_at
  )
  values (p_rate_key, 0, now(), null, now())
  on conflict (rate_key) do nothing;

  select *
  into current_row
  from public.auth_rate_limits
  where rate_key = p_rate_key
  for update;

  if current_row.blocked_until is not null and current_row.blocked_until > now() then
    return query
    select
      current_row.attempt_count,
      current_row.blocked_until,
      greatest(1, ceil(extract(epoch from (current_row.blocked_until - now())))::integer);
    return;
  end if;

  if current_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    next_count := 1;
    next_window_started := now();
  else
    next_count := current_row.attempt_count + 1;
    next_window_started := current_row.window_started_at;
  end if;

  if next_count >= p_max_attempts then
    next_blocked_until := now() + make_interval(secs => p_block_seconds);
  else
    next_blocked_until := null;
  end if;

  update public.auth_rate_limits
  set
    attempt_count = next_count,
    window_started_at = next_window_started,
    blocked_until = next_blocked_until,
    updated_at = now()
  where rate_key = p_rate_key;

  return query
  select
    next_count,
    next_blocked_until,
    case
      when next_blocked_until is not null
        then greatest(1, ceil(extract(epoch from (next_blocked_until - now())))::integer)
      else 0
    end;
end;
$$;

create or replace function public.reset_auth_rate_limit(p_rate_key text)
returns table (cleared boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.auth_rate_limits
  where rate_key = p_rate_key;

  return query select true;
end;
$$;

revoke all on function public.check_auth_rate_limit(text) from public, anon, authenticated;
revoke all on function public.record_auth_rate_limit_failure(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.reset_auth_rate_limit(text) from public, anon, authenticated;

grant execute on function public.check_auth_rate_limit(text) to service_role;
grant execute on function public.record_auth_rate_limit_failure(text, integer, integer, integer) to service_role;
grant execute on function public.reset_auth_rate_limit(text) to service_role;

create index if not exists auth_rate_limits_updated_at_idx
  on public.auth_rate_limits(updated_at);
