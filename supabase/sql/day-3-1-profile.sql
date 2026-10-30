-- =====================================================================
-- BLISSCCO | Day 3 | Part 1 of 4 : shared helper + profiles
-- Supabase SQL Editor me parts ko ORDER me chalao: 1 -> 2 -> 3 -> 4
-- Har file ek baar chalao (dobara chalane par bhi crash nahi hoga).
--
-- Design notes
-- * Primary keys UUID. profiles.id = auth.users.id (Supabase Auth ka user).
-- * role/status ke liye text + CHECK (enum se badalna aasan hota hai).
-- * Email profiles me copy NAHI karte; wo auth.users me already hai
--   (kam personal data = kam risk).
-- * Is stage me sirf tables. Security policies + API grants agle stage me.
--   RLS ON + grants REVOKED => abhi app/API in tables ko chhu nahi sakti.
-- =====================================================================

-- ---------- shared: updated_at trigger function ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'advertiser',
  status       text not null default 'active',
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_role_check
    check (role in ('advertiser', 'publisher', 'admin')),
  constraint profiles_status_check
    check (status in ('active', 'suspended')),
  constraint profiles_display_name_check
    check (display_name is null or char_length(display_name) between 1 and 100),
  -- (id, role) unique: advertisers/publishers is pair se link hote hain taaki
  -- advertiser row sirf 'advertiser' role wale profile se ban sake.
  constraint profiles_id_role_key unique (id, role)
);

comment on table  public.profiles is 'Ek row per login user: account role + status. Email auth.users me rehta hai.';
comment on column public.profiles.role is 'advertiser | publisher | admin. User khud admin nahi ban sakta (guard trigger).';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- guard: users role/status khud nahi badal sakte ----------
-- API se aane wale requests 'anon' ya 'authenticated' DB role se chalte hain.
-- SQL Editor (postgres) aur service_role par ye rok nahi lagti, isliye
-- pehla admin SQL Editor se bana sakte ho (neeche example).
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.role not in ('advertiser', 'publisher') or new.status <> 'active' then
        raise exception 'Not allowed to set this role or status' using errcode = '42501';
      end if;
    else
      if new.id     is distinct from old.id
      or new.role   is distinct from old.role
      or new.status is distinct from old.status then
        raise exception 'Not allowed to change id, role or status' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_changes on public.profiles;
create trigger profiles_guard_changes
  before insert or update on public.profiles
  for each row execute function public.guard_profile_changes();

-- ---------- naya user signup => profile row apne aap ----------
-- SECURITY DEFINER: owner ke haq se chalta hai, user ke nahi.
-- Signup metadata user ke control me hota hai, isliye sirf 'advertiser' ya
-- 'publisher' maanta hai. 'admin' kabhi nahi, baaki sab 'advertiser' ban jata hai.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  requested_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 100), '');
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    case when requested_role in ('advertiser', 'publisher') then requested_role else 'advertiser' end,
    requested_name
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user()        from public, anon, authenticated;
revoke all on function public.guard_profile_changes()  from public, anon, authenticated;
revoke all on function public.set_updated_at()         from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- access: abhi band ----------
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
-- Policies + zaroori GRANTs next stage (security policies) me.

-- Pehla admin banana (jab user signup kar chuka ho), SQL Editor me, UUID apna daalo:
--   update public.profiles set role = 'admin' where id = 'PASTE-USER-UUID-HERE';
