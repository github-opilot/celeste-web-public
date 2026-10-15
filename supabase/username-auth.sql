-- Pseudo + password authentication for Celeste Web.
-- Passwords and recovery email addresses remain exclusively in Supabase Auth.
-- This migration does not alter the celeste-saves bucket or its RLS policies.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  username_normalized text generated always as (lower(username)) stored,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[A-Za-z0-9_]{3,20}$'
  )
);

create unique index if not exists profiles_username_normalized_unique
  on public.profiles (username_normalized)
  where username_normalized is not null;

-- Existing GitHub users receive a profile row without changing their Auth id.
insert into public.profiles (id, username)
select id, null
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (username) on table public.profiles to authenticated;

drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create or replace function public.create_celeste_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_username text := nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'username'), '');
begin
  if supplied_username is not null and supplied_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Invalid Celeste username' using errcode = '23514';
  end if;

  -- The unique index arbitrates concurrent signups claiming the same pseudo,
  -- regardless of letter case. A conflict rolls back the Auth user creation.
  insert into public.profiles (id, username)
  values (new.id, supplied_username);
  return new;
end;
$$;

revoke all on function public.create_celeste_profile_for_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_celeste_profile on auth.users;
create trigger on_auth_user_created_celeste_profile
after insert on auth.users
for each row execute function public.create_celeste_profile_for_auth_user();

-- Rate-limit records contain only keyed HMAC values, never usernames, emails,
-- IP addresses, passwords, or Auth tokens. The schema is not exposed to clients.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.username_login_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists username_login_limits_updated_at_idx
  on private.username_login_limits (updated_at);

create or replace function private.consume_username_login_limit(
  p_key_hash text,
  p_max_attempts integer,
  p_window interval
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  stored private.username_login_limits%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key_hash, 0));

  select * into stored
  from private.username_login_limits
  where key_hash = p_key_hash
  for update;

  if not found then
    insert into private.username_login_limits (key_hash, window_started_at, attempts, updated_at)
    values (p_key_hash, v_now, 1, v_now);
    return query select true, 0;
    return;
  end if;

  if stored.blocked_until is not null and stored.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from stored.blocked_until - v_now))::integer);
    return;
  end if;

  if stored.window_started_at <= v_now - p_window then
    update private.username_login_limits
    set window_started_at = v_now, attempts = 1, blocked_until = null, updated_at = v_now
    where key_hash = p_key_hash;
    return query select true, 0;
    return;
  end if;

  if stored.attempts >= p_max_attempts then
    update private.username_login_limits
    set blocked_until = v_now + p_window, updated_at = v_now
    where key_hash = p_key_hash;
    return query select false, greatest(1, ceil(extract(epoch from p_window))::integer);
    return;
  end if;

  update private.username_login_limits
  set attempts = stored.attempts + 1, updated_at = v_now
  where key_hash = p_key_hash;
  return query select true, 0;
end;
$$;

revoke all on function private.consume_username_login_limit(text, integer, interval) from public, anon, authenticated;

create or replace function public.consume_username_login_limits(
  p_identifier_hash text,
  p_ip_hash text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  identifier_limit record;
  ip_limit record;
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid rate limit key' using errcode = '22023';
  end if;

  -- Eight attempts per pseudo/address and sixty attempts per address per 15 minutes.
  select * into identifier_limit
  from private.consume_username_login_limit('username:' || p_identifier_hash, 8, interval '15 minutes');
  select * into ip_limit
  from private.consume_username_login_limit('ip:' || p_ip_hash, 60, interval '15 minutes');

  return query select
    identifier_limit.allowed and ip_limit.allowed,
    greatest(identifier_limit.retry_after_seconds, ip_limit.retry_after_seconds);

  -- Opportunistically discard stale HMAC keys; the index keeps this uncommon
  -- cleanup from scanning the table on every login request.
  if pg_catalog.random() < 0.01 then
    delete from private.username_login_limits
    where updated_at < pg_catalog.clock_timestamp() - interval '2 days';
  end if;
end;
$$;

revoke all on function public.consume_username_login_limits(text, text) from public, anon, authenticated;
grant execute on function public.consume_username_login_limits(text, text) to service_role;
