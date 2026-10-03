-- Free360 managed-Supabase setup-code hardening (final migration).
--
-- Apply AFTER supabase/schema.sql and supabase/multi-circle.sql, in this order:
--   1. supabase/schema.sql
--   2. supabase/multi-circle.sql
--   3. this file (supabase/setup-code-security.sql)
-- Then issue a code (SQL Editor, project administrator only):
--   select public.free360_new_setup_code();
-- and deploy the create-circle Edge Function (see README.md).
--
-- What this migration does:
-- - Issues cryptographically uniform 16-decimal-digit setup codes. Codes are text
--   (never numbers) so leading zeros survive, and are returned grouped as
--   XXXX-XXXX-XXXX-XXXX for readability. The server strips spaces/hyphens before
--   verifying, so members may type the code with or without separators.
-- - Stores ONLY sha256 hashes of the normalized 16 digits, with a 30-minute
--   expiry. Plaintext codes are never stored. Randomness comes from
--   pg_catalog.gen_random_uuid (cryptographic) via rejection sampling, so every
--   one of the 10^16 values is equally likely. Only pg_catalog core functions
--   are used: no extension is required.
-- - Invalidates legacy outstanding codes ONCE: rows created before expiry
--   tracking (expires_at IS NULL, i.e. the old 64-hex codes) are expired by the
--   UPDATE below. Reapplying this script never touches codes issued afterwards
--   because every new row carries a non-null expires_at. Circles, members, and
--   all other data are preserved.
-- - Disables the legacy direct free360_create_circle RPC for anon/authenticated
--   callers. Circle creation goes through the service-only
--   free360_redeem_setup_code RPC, called by the create-circle Edge Function
--   with the Auth user id verified from the request bearer token.
-- - Adds persistent, atomic, instance-independent rate limits (per-user and
--   project-wide fixed windows) that commit even on rejected attempts.
--
-- The script is idempotent: every statement is safe to re-run. Re-running
-- schema.sql or multi-circle.sql afterwards does NOT undo this hardening because
-- those scripts carry the same hardened definitions and grants (the shared
-- block below is intentionally identical in all three files).

-- free360_setup holds ONLY code hashes plus bookkeeping. Existing projects keep
-- their rows; fresh installs create the table in schema.sql with this shape.
alter table public.free360_setup add column if not exists created_at timestamptz;
alter table public.free360_setup add column if not exists expires_at timestamptz;
alter table public.free360_setup add column if not exists consumed_at timestamptz;
alter table public.free360_setup add column if not exists consumed_by uuid;
-- Invalidate legacy outstanding codes ONCE: only rows that predate expiry
-- tracking (expires_at IS NULL) are expired here. Codes issued after this
-- migration always carry expires_at, so reapplying never affects them.
update public.free360_setup set created_at = coalesce(created_at, now()) where created_at is null;
update public.free360_setup set expires_at = now() - interval '1 second' where expires_at is null;
alter table public.free360_setup alter column created_at set default now();
alter table public.free360_setup alter column created_at set not null;
alter table public.free360_setup alter column expires_at set default now() + interval '30 minutes';
alter table public.free360_setup alter column expires_at set not null;
create unique index if not exists free360_setup_hash_idx on public.free360_setup(secret_hash);

-- Persistent fixed-window rate-limit counters. One row per active bucket keeps the
-- table bounded; stale buckets are deleted opportunistically on every check.
create table if not exists public.free360_setup_rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1 check (count >= 0)
);
alter table public.free360_setup enable row level security;
alter table public.free360_setup_rate_limits enable row level security;
revoke all on public.free360_setup, public.free360_setup_rate_limits from public, anon, authenticated;

-- Fixed-window service-only rate limiter. Returns true when the attempt is within
-- budget. It RETURNS a verdict instead of raising so callers record rejected
-- attempts too: counters commit on every call (raise-after-count would roll the
-- increment back). The UPSERT is atomic, so concurrent attempts cannot lose
-- counts. Internal helper: no execute grant (only the table owner and SECURITY
-- DEFINER callers can reach it).
create or replace function public.free360_setup_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if p_bucket is null or p_limit is null or p_limit < 1 then return false; end if;
  -- Opportunistic cleanup keeps the table bounded to buckets active in the window.
  delete from public.free360_setup_rate_limits where window_start < v_now - p_window;
  insert into public.free360_setup_rate_limits(bucket, window_start, count)
    values (p_bucket, v_now, 1)
    on conflict (bucket) do update set
      window_start = case when public.free360_setup_rate_limits.window_start < v_now - p_window then v_now else public.free360_setup_rate_limits.window_start end,
      count = case when public.free360_setup_rate_limits.window_start < v_now - p_window then 1 else public.free360_setup_rate_limits.count + 1 end
    returning public.free360_setup_rate_limits.count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Administrator-only (SQL Editor). Issues one single-use 16-digit setup code
-- expiring in 30 minutes and returns it grouped for readability. Only the hash
-- is stored. No execute grant: the project administrator runs it as table owner.
create or replace function public.free360_new_setup_code()
returns text language plpgsql set search_path = '' as $$
declare
  v_hex text;
  v_val bigint := 0;
  v_i integer;
  -- 115 * 10^16: largest multiple of 10^16 below 2^60. The first 15 hex chars of
  -- a cryptographic UUID give 60 uniform bits; values below this limit are kept
  -- (99.7% acceptance) and integer-divided by 115 for a uniform [0, 10^16).
  v_limit constant bigint := 1150000000000000000;
  v_code text;
begin
  loop
    v_hex := pg_catalog.substr(pg_catalog.translate(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 15);
    v_val := 0;
    for v_i in 1..15 loop
      v_val := v_val * 16 + pg_catalog.strpos('0123456789abcdef', pg_catalog.substr(v_hex, v_i, 1)) - 1;
    end loop;
    exit when v_val >= 0 and v_val < v_limit;
  end loop;
  v_code := pg_catalog.lpad(((v_val / 115)::text), 16, '0');
  -- Bounded growth: retire codes long past relevance.
  delete from public.free360_setup where expires_at < now() - interval '7 days';
  insert into public.free360_setup(secret_hash, created_at, expires_at)
    values (pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')), now(), now() + interval '30 minutes');
  return pg_catalog.substr(v_code, 1, 4) || '-' || pg_catalog.substr(v_code, 5, 4) || '-' || pg_catalog.substr(v_code, 9, 4) || '-' || pg_catalog.substr(v_code, 13, 4);
end;
$$;

-- Service-only atomic redemption for the create-circle Edge Function
-- (service_role). p_user MUST be the Auth user id verified from the request
-- bearer token; never accept a client-supplied user identity. Returns a status
-- string instead of raising for expected failures so rate-limit counters commit
-- on invalid attempts:
--   'ok' | 'invalid' | 'expired' | 'used' | 'rate_limited_user'
--   | 'rate_limited_global' | 'already_member' | 'invalid_request'
-- Consuming the code and inserting the circle/member happen in one transaction:
-- if the circle insert fails unexpectedly, the consume rolls back and the code
-- stays valid. Repeat attempts against recently consumed/expired rows keep
-- reporting 'used'/'expired' (rows are retired only after 7 days).
create or replace function public.free360_redeem_setup_code(p_user uuid, p_circle_id uuid, p_setup_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_raw text := coalesce(p_setup_code, '');
  v_code text := pg_catalog.regexp_replace(v_raw, '[ \-]', '', 'g');
  v_hash bytea := pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8'));
  v_setup record;
begin
  -- Persistent atomic limits (commit even when this call returns a rejection).
  -- 10 attempts per user and 200 project-wide per 10 minutes: generous for
  -- legitimate use (one success per device) while making online guessing of the
  -- 10^16 space infeasible, including via fresh anonymous accounts (the global
  -- backstop caps aggregate guesses). Client IP headers are NOT used: XFF and
  -- friends are client-controlled and no Edge Function header is documented as
  -- unspoofable (see README.md).
  if not public.free360_setup_rate_limit('global', 200, interval '10 minutes') then
    return 'rate_limited_global';
  end if;
  if p_user is not null and not public.free360_setup_rate_limit('user:' || p_user::text, 10, interval '10 minutes') then
    return 'rate_limited_user';
  end if;
  if p_user is null or p_circle_id is null then return 'invalid_request'; end if;
  if pg_catalog.length(v_raw) > 64 or v_code !~ '^[0-9]{16}$' then return 'invalid'; end if;
  -- Bounded growth: retire codes long past relevance before the lookup.
  delete from public.free360_setup where expires_at < v_now - interval '7 days';
  select secret_hash, expires_at, consumed_at into v_setup
    from public.free360_setup where secret_hash = v_hash for update;
  if not found then return 'invalid'; end if;
  if v_setup.consumed_at is not null then return 'used'; end if;
  if v_setup.expires_at <= v_now then return 'expired'; end if;
  if exists (select 1 from public.free360_members where user_id = p_user) then
    return 'already_member';
  end if;
  if exists (select 1 from public.free360_circles where id = p_circle_id) then
    return 'invalid_request';
  end if;
  begin
    insert into public.free360_circles(id, owner_id) values (p_circle_id, p_user);
    insert into public.free360_members(user_id, circle_id) values (p_user, p_circle_id);
    update public.free360_setup set consumed_at = v_now, consumed_by = p_user where secret_hash = v_hash;
  exception
    when unique_violation then
      -- Concurrent double-redeem lost the race (or the circle id collided):
      -- nothing was consumed (subtransaction rolled back); report the outcome.
      if exists (select 1 from public.free360_members where user_id = p_user) then
        return 'already_member';
      end if;
      return 'invalid_request';
    when foreign_key_violation then
      return 'invalid_request';
  end;
  return 'ok';
end;
$$;

-- Privilege lockdown. The generator stays administrator-only (no grant). The
-- redemption and rate limiter are service-only; the rate limiter gets no grant
-- at all so only the table owner and SECURITY DEFINER callers can reach it.
-- The legacy direct creation RPC is disabled for every API role: circle
-- creation now requires the create-circle Edge Function.
revoke all on function public.free360_new_setup_code() from public, anon, authenticated;
revoke all on function public.free360_setup_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke all on function public.free360_redeem_setup_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.free360_redeem_setup_code(uuid, uuid, text) to service_role;
revoke all on function public.free360_create_circle(uuid, text) from public, anon, authenticated;

do $$
declare v_outstanding integer;
begin
  select count(*) into v_outstanding
    from public.free360_setup where consumed_at is null and expires_at > now();
  raise notice 'setup-code-security applied: % unexpired outstanding setup code(s). Legacy codes without expiry were invalidated; circles/members preserved.', v_outstanding;
end;
$$;
