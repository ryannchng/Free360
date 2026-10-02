-- Apply after schema.sql, including to existing projects. Existing circle data is preserved.
begin;
alter table public.free360_circles drop column if exists singleton;
alter table public.free360_setup drop column if exists singleton;
create unique index if not exists free360_setup_hash_idx on public.free360_setup(secret_hash);
create unique index if not exists free360_circle_owner_idx on public.free360_circles(owner_id);

create or replace function public.free360_new_setup_code()
returns text language plpgsql set search_path = '' as $$
declare v_code text;
begin
  v_code := replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.free360_setup(secret_hash) values (pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')));
  return v_code;
end;
$$;
revoke all on function public.free360_new_setup_code() from public, anon, authenticated;

create or replace function public.free360_create_circle(p_circle_id uuid, p_setup_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_claimed bytea;
begin
  if v_user is null then raise exception 'Sign in on this device first'; end if;
  if exists (select 1 from public.free360_members where user_id = v_user) then
    raise exception 'This device already belongs to a circle';
  end if;
  delete from public.free360_setup
    where secret_hash = pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_setup_code, ''), 'UTF8'))
    returning secret_hash into v_claimed;
  if v_claimed is null then raise exception 'Invalid or already used setup code'; end if;
  insert into public.free360_circles(id, owner_id) values (p_circle_id, v_user);
  insert into public.free360_members(user_id, circle_id) values (v_user, p_circle_id);
end;
$$;

create table if not exists public.free360_push_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique
);
create table if not exists public.free360_push_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.free360_push_tokens enable row level security;
alter table public.free360_push_limits enable row level security;
revoke all on public.free360_push_tokens, public.free360_push_limits from anon, authenticated;

create or replace function public.free360_register_push(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if not exists (select 1 from public.free360_members where user_id = v_user) then raise exception 'Join a circle first'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(p_token) > 200 then raise exception 'Invalid push token'; end if;
  delete from public.free360_push_tokens where token = p_token and user_id <> v_user;
  insert into public.free360_push_tokens(user_id, token) values (v_user, p_token)
    on conflict (user_id) do update set token = excluded.token;
end;
$$;

-- Service-only function: atomically rate-limit and return tokens from the sender's circle.
create or replace function public.free360_push_targets(p_user uuid)
returns table(token text) language plpgsql security definer set search_path = '' as $$
declare v_circle uuid; v_claimed uuid;
begin
  select circle_id into v_circle from public.free360_members where user_id = p_user;
  if v_circle is null then raise exception 'Not a circle member'; end if;
  insert into public.free360_push_limits(user_id, sent_at) values (p_user, now())
    on conflict (user_id) do update set sent_at = excluded.sent_at
    where public.free360_push_limits.sent_at < now() - interval '1 minute'
    returning user_id into v_claimed;
  if v_claimed is null then return; end if;
  return query select t.token from public.free360_push_tokens t
    join public.free360_members m on m.user_id = t.user_id
    where m.circle_id = v_circle and m.user_id <> p_user;
end;
$$;
revoke all on function public.free360_register_push(text), public.free360_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.free360_register_push(text) to authenticated;
grant execute on function public.free360_push_targets(uuid) to service_role;
commit;
