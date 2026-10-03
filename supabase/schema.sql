-- Run in the SQL editor of a Supabase project dedicated to one group.
-- The SQL editor runs as the project administrator. Do not expose a service-role key in the app.
-- The script is idempotent; re-run it after updating the app to apply schema changes
-- (for example, to add 24-hour location history to an existing project).
create table if not exists public.free360_circles (
  id uuid primary key,
  singleton boolean not null default true unique check (singleton),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.free360_setup (
  secret_hash bytea primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  consumed_at timestamptz,
  consumed_by uuid
);

create table if not exists public.free360_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  circle_id uuid not null references public.free360_circles(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists free360_members_circle_idx on public.free360_members(circle_id);

create table if not exists public.free360_invites (
  id uuid primary key,
  circle_id uuid not null references public.free360_circles(id) on delete cascade,
  secret_hash bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists free360_invites_circle_idx on public.free360_invites(circle_id);

create table if not exists public.free360_snapshots (
  circle_id uuid not null references public.free360_circles(id) on delete cascade,
  device_id uuid not null references auth.users(id) on delete cascade,
  envelope jsonb not null,
  received_at timestamptz not null default now(),
  primary key (circle_id, device_id)
);

create table if not exists public.free360_events (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.free360_circles(id) on delete cascade,
  device_id uuid not null references auth.users(id) on delete cascade,
  envelope jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists free360_events_recent_idx on public.free360_events(circle_id, received_at desc, id desc);

-- Append-only location trail, encrypted like snapshots. Rows older than 24 hours
-- are deleted by free360_publish_history on every publish.
create table if not exists public.free360_history (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.free360_circles(id) on delete cascade,
  device_id uuid not null references auth.users(id) on delete cascade,
  envelope jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists free360_history_recent_idx on public.free360_history(circle_id, received_at desc, id desc);
create index if not exists free360_history_device_idx on public.free360_history(circle_id, device_id, id desc);

alter table public.free360_circles enable row level security;
alter table public.free360_setup enable row level security;
alter table public.free360_members enable row level security;
alter table public.free360_invites enable row level security;
alter table public.free360_snapshots enable row level security;
alter table public.free360_events enable row level security;
alter table public.free360_history enable row level security;

revoke all on public.free360_circles, public.free360_setup, public.free360_members, public.free360_invites,
  public.free360_snapshots, public.free360_events, public.free360_history from anon, authenticated;
grant select on public.free360_snapshots, public.free360_events, public.free360_history to authenticated;

create or replace function public.free360_is_member(p_circle_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.free360_members
    where circle_id = p_circle_id and user_id = (select auth.uid())
  );
$$;

drop policy if exists free360_snapshots_read on public.free360_snapshots;
create policy free360_snapshots_read on public.free360_snapshots for select to authenticated
  using (public.free360_is_member(circle_id));
drop policy if exists free360_events_read on public.free360_events;
create policy free360_events_read on public.free360_events for select to authenticated
  using (public.free360_is_member(circle_id));
drop policy if exists free360_history_read on public.free360_history;
create policy free360_history_read on public.free360_history for select to authenticated
  using (public.free360_is_member(circle_id));

-- Run SELECT public.free360_new_setup_code() in the SQL editor after this script
-- (and multi-circle.sql plus setup-code-security.sql, in that order).
-- Only the project administrator can execute it. It returns one single-use
-- 16-digit code (grouped XXXX-XXXX-XXXX-XXXX) expiring in 30 minutes.
-- The plaintext code is never stored: only its sha256 hash is kept.
-- The shared hardening block below is intentionally identical in schema.sql,
-- multi-circle.sql, and setup-code-security.sql so reapplying any of them
-- converges to the same secure state instead of undoing it.
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

create or replace function public.free360_create_circle(p_circle_id uuid, p_setup_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in on this device first'; end if;
  if not exists (
    select 1 from public.free360_setup
    where secret_hash = pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_setup_code, ''), 'UTF8'))
  ) then raise exception 'Invalid group setup code'; end if;
  if exists (select 1 from public.free360_circles) then
    raise exception 'This Supabase project already has a circle';
  end if;
  insert into public.free360_circles(id, owner_id) values (p_circle_id, v_user);
  insert into public.free360_members(user_id, circle_id) values (v_user, p_circle_id);
  delete from public.free360_setup;
end;
$$;

-- Setup-code hardening (shared block, identical in schema.sql, multi-circle.sql,
-- and setup-code-security.sql). Upgrades pre-hardening free360_setup rows and
-- invalidates legacy outstanding codes ONCE (expires_at IS NULL rows only).
alter table public.free360_setup add column if not exists created_at timestamptz;
alter table public.free360_setup add column if not exists expires_at timestamptz;
alter table public.free360_setup add column if not exists consumed_at timestamptz;
alter table public.free360_setup add column if not exists consumed_by uuid;
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

create or replace function public.free360_create_invite(p_invite_id uuid, p_secret text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_circle uuid;
  v_expiry timestamptz := now() + interval '15 minutes';
begin
  if v_user is null then raise exception 'Sign in on this device first'; end if;
  select id into v_circle from public.free360_circles where owner_id = v_user;
  if v_circle is null then raise exception 'Only the circle owner can invite people'; end if;
  if length(p_secret) < 40 or length(p_secret) > 100 then raise exception 'Invalid invitation secret'; end if;
  delete from public.free360_invites where expires_at <= now();
  if (select count(*) from public.free360_invites where circle_id = v_circle) >= 20 then
    raise exception 'Too many active invitations';
  end if;
  insert into public.free360_invites(id, circle_id, secret_hash, expires_at)
    values (p_invite_id, v_circle, pg_catalog.sha256(pg_catalog.convert_to(p_secret, 'UTF8')), v_expiry);
  return v_expiry;
end;
$$;

create or replace function public.free360_claim_invite(p_invite_id uuid, p_secret text, p_circle_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_circle uuid;
  v_claimed uuid;
begin
  if v_user is null then raise exception 'Sign in on this device first'; end if;
  if exists (select 1 from public.free360_members where user_id = v_user) then
    raise exception 'This device already belongs to a circle';
  end if;
  select circle_id into v_circle from public.free360_invites
    where id = p_invite_id and secret_hash = pg_catalog.sha256(pg_catalog.convert_to(p_secret, 'UTF8'))
      and circle_id = p_circle_id
      and expires_at > now();
  if v_circle is null then raise exception 'Invitation expired, invalid, or already used'; end if;
  perform 1 from public.free360_circles where id = v_circle for update;
  if (select count(*) from public.free360_members where circle_id = v_circle) >= 20 then
    raise exception 'This circle is full';
  end if;
  delete from public.free360_invites
    where id = p_invite_id and circle_id = v_circle and expires_at > now()
    returning circle_id into v_claimed;
  if v_claimed is null then raise exception 'Invitation already used'; end if;
  insert into public.free360_members(user_id, circle_id) values (v_user, v_circle);
  return v_circle;
end;
$$;

create or replace function public.free360_valid_envelope(p_envelope jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_envelope is not null
    and jsonb_typeof(p_envelope) = 'object'
    and p_envelope->>'version' = '1'
    and jsonb_typeof(p_envelope->'nonce') = 'string'
    and jsonb_typeof(p_envelope->'ciphertext') = 'string'
    and length(p_envelope->>'nonce') between 20 and 100
    and length(p_envelope->>'ciphertext') between 24 and 8192
    and octet_length(p_envelope::text) <= 12000;
$$;

create or replace function public.free360_publish_snapshot(p_envelope jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_circle uuid;
begin
  select circle_id into v_circle from public.free360_members where user_id = v_user;
  if v_circle is null then raise exception 'This device is not a circle member'; end if;
  if not public.free360_valid_envelope(p_envelope) then raise exception 'Invalid encrypted envelope'; end if;
  insert into public.free360_snapshots(circle_id, device_id, envelope)
    values (v_circle, v_user, p_envelope)
    on conflict (circle_id, device_id) do update
      set envelope = excluded.envelope, received_at = now();
end;
$$;

create or replace function public.free360_publish_event(p_envelope jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_circle uuid;
begin
  select circle_id into v_circle from public.free360_members where user_id = v_user;
  if v_circle is null then raise exception 'This device is not a circle member'; end if;
  if not public.free360_valid_envelope(p_envelope) then raise exception 'Invalid encrypted envelope'; end if;
  perform 1 from public.free360_circles where id = v_circle for update;
  insert into public.free360_events(circle_id, device_id, envelope) values (v_circle, v_user, p_envelope);
  delete from public.free360_events where id in (
    select id from public.free360_events where circle_id = v_circle
    order by received_at desc, id desc offset 100
  );
end;
$$;

create or replace function public.free360_publish_history(p_envelope jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_circle uuid;
begin
  select circle_id into v_circle from public.free360_members where user_id = v_user;
  if v_circle is null then raise exception 'This device is not a circle member'; end if;
  if not public.free360_valid_envelope(p_envelope) then raise exception 'Invalid encrypted envelope'; end if;
  insert into public.free360_history(circle_id, device_id, envelope) values (v_circle, v_user, p_envelope);
  delete from public.free360_history where circle_id = v_circle and received_at < now() - interval '24 hours';
  delete from public.free360_history where id in (
    select id from public.free360_history where circle_id = v_circle and device_id = v_user
    order by id desc offset 2000
  );
end;
$$;

revoke all on function public.free360_new_setup_code(), public.free360_is_member(uuid), public.free360_create_circle(uuid, text),
  public.free360_create_invite(uuid, text), public.free360_claim_invite(uuid, text, uuid),
  public.free360_valid_envelope(jsonb), public.free360_publish_snapshot(jsonb),
  public.free360_publish_event(jsonb), public.free360_publish_history(jsonb) from public, anon, authenticated;
grant execute on function public.free360_is_member(uuid),
  public.free360_create_invite(uuid, text), public.free360_claim_invite(uuid, text, uuid),
  public.free360_publish_snapshot(jsonb), public.free360_publish_event(jsonb),
  public.free360_publish_history(jsonb) to authenticated;

-- Setup-code privilege lockdown. The generator stays administrator-only (no
-- grant). Redemption is service-only for the create-circle Edge Function; the
-- rate limiter gets no grant at all. The legacy direct creation RPC keeps its
-- revocation above and is granted to NOBODY: circle creation requires the
-- Edge Function. (free360_new_setup_code/redeem/rate-limit revokes live in the
-- shared hardening block; repeated here so this file converges standalone.)
revoke all on function public.free360_new_setup_code() from public, anon, authenticated;
revoke all on function public.free360_setup_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke all on function public.free360_redeem_setup_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.free360_redeem_setup_code(uuid, uuid, text) to service_role;
revoke all on function public.free360_create_circle(uuid, text) from public, anon, authenticated;

-- Postgres Changes needs these tables in the project's Realtime publication.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'free360_snapshots') then
    alter publication supabase_realtime add table public.free360_snapshots;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'free360_events') then
    alter publication supabase_realtime add table public.free360_events;
  end if;
end;
$$;
