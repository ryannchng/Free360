-- Run once in the SQL editor of a fresh Supabase project dedicated to one group.
-- The SQL editor runs as the project administrator. Do not expose a service-role key in the app.
create table if not exists public.free360_circles (
  id uuid primary key,
  singleton boolean not null default true unique check (singleton),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.free360_setup (
  singleton boolean primary key default true check (singleton),
  secret_hash bytea not null
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

alter table public.free360_circles enable row level security;
alter table public.free360_setup enable row level security;
alter table public.free360_members enable row level security;
alter table public.free360_invites enable row level security;
alter table public.free360_snapshots enable row level security;
alter table public.free360_events enable row level security;

revoke all on public.free360_circles, public.free360_setup, public.free360_members, public.free360_invites,
  public.free360_snapshots, public.free360_events from anon, authenticated;
grant select on public.free360_snapshots, public.free360_events to authenticated;

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

-- Run SELECT public.free360_new_setup_code() in the SQL editor after this script.
-- Only the project administrator can execute it. The plaintext code is never stored.
create or replace function public.free360_new_setup_code()
returns text language plpgsql set search_path = '' as $$
declare v_code text;
begin
  if exists (select 1 from public.free360_circles) or exists (select 1 from public.free360_setup) then
    raise exception 'A circle or setup code already exists';
  end if;
  v_code := replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.free360_setup(secret_hash) values (pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')));
  return v_code;
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
    and length(p_envelope->>'ciphertext') between 1 and 8192
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

revoke all on function public.free360_new_setup_code(), public.free360_is_member(uuid), public.free360_create_circle(uuid, text),
  public.free360_create_invite(uuid, text), public.free360_claim_invite(uuid, text, uuid),
  public.free360_valid_envelope(jsonb), public.free360_publish_snapshot(jsonb),
  public.free360_publish_event(jsonb) from public, anon;
grant execute on function public.free360_is_member(uuid), public.free360_create_circle(uuid, text),
  public.free360_create_invite(uuid, text), public.free360_claim_invite(uuid, text, uuid),
  public.free360_publish_snapshot(jsonb), public.free360_publish_event(jsonb) to authenticated;

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
