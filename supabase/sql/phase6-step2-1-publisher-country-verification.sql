-- =====================================================================
-- BLISSCCO | Phase 6 | Step 2 Part 1 : publisher country verification (database level)
-- Pehle day-3-2 (publishers), day-3-5 (private.is_admin, RLS, guard pattern) aur day-10-1 chali honi chahiye.
-- Dobara chalane par safe hai (add column if not exists / create or replace / drop+create constraint).
-- PEHLE TEST project par chalao. PRODUCTION PAR ABHI NAHI. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Kya hai:
--  * publishers me 5 naye columns: country_code, country_status, country_submitted_at, country_reviewed_by, country_reviewed_at.
--  * Workflow: publisher country batata hai => 'pending'. Admin approve => 'verified'. Admin reject => 'rejected'.
--    Country na di ho => sab columns null (= "missing").
--  * Publisher in columns ko seedha NAHI badal sakta: column GRANT nahi diya (day-3-5 ka update grant sirf name/website_url/category).
--    Uske upar guard trigger bhi hai (defense in depth). Publisher sirf submit_publisher_country() se country bhejta hai, aur wo hamesha 'pending' banata hai.
--  * Admin sirf admin_review_publisher_country() se approve/reject karta hai (private.is_admin()), admin id + time record hota hai.
--    Admin apne hi publisher account ka country approve nahi kar sakta (hint: self_approval_blocked).
--  * Admin ne jo country dekhi wahi approve hoti hai (p_expected_country): beech me publisher country badal de toh approve nahi hota (hint: country_changed).
--  * get_publisher_country_state() sirf service_role ke liye (ad-serving): country_code sirf tab lautata hai jab status 'verified' ho.
--
-- Jaan-boojh kar NAHI kiya:
--  * ISO country list / country->region mapping yahan NAHI hai. Wo sirf lib/regions/country-region.ts (Phase 6 Step 1) me hai
--    (duplicate mapping nahi). Database sirf format ('^[A-Z]{2}$') check karta hai; ISO membership TypeScript me check hoti hai
--    (submit, admin approve aur serving, teeno jagah). Non-ISO code serving me kabhi eligible nahi hota.
--  * Pricing / payments / ledger / payouts ko haath nahi lagta. authorize_publisher_key / record_ad_serve nahi badle.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Naye columns (purani rows: sab null = country missing)
-- ---------------------------------------------------------------------
alter table public.publishers add column if not exists country_code         text;
alter table public.publishers add column if not exists country_status       text;
alter table public.publishers add column if not exists country_submitted_at timestamptz;
alter table public.publishers add column if not exists country_reviewed_by  uuid references public.profiles (id) on delete restrict;
alter table public.publishers add column if not exists country_reviewed_at  timestamptz;

alter table public.publishers drop constraint if exists publishers_country_check;
alter table public.publishers add constraint publishers_country_check check (
  -- missing: sab khali
  (country_code is null and country_status is null and country_submitted_at is null
     and country_reviewed_by is null and country_reviewed_at is null)
  or
  -- pending: country + submit time, review data khali
  (country_code ~ '^[A-Z]{2}$' and country_status = 'pending' and country_submitted_at is not null
     and country_reviewed_by is null and country_reviewed_at is null)
  or
  -- verified / rejected: admin id + time zaroori
  (country_code ~ '^[A-Z]{2}$' and country_status in ('verified', 'rejected') and country_submitted_at is not null
     and country_reviewed_by is not null and country_reviewed_at is not null)
);

comment on column public.publishers.country_code is 'ISO 3166-1 alpha-2 (format check yahan; ISO membership lib/regions/country-region.ts me). Publisher ka batayi hui country.';
comment on column public.publishers.country_status is 'pending | verified | rejected (null = country nahi di). Sirf verified country regional eligibility ke liye use hoti hai.';
comment on column public.publishers.country_reviewed_by is 'Country approve/reject karne wale admin ka profile id.';

create index if not exists publishers_country_status_idx on public.publishers (country_status) where country_status = 'pending';

-- ---------------------------------------------------------------------
-- 2. Guard trigger: API users (anon/authenticated) country columns kabhi nahi badal sakte.
--    SQL Editor (postgres), service_role aur neeche ke SECURITY DEFINER functions par nahi lagta (day-3-5 jaisa pattern).
-- ---------------------------------------------------------------------
create or replace function private.guard_publisher_country_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.country_code is not null or new.country_status is not null or new.country_submitted_at is not null
       or new.country_reviewed_by is not null or new.country_reviewed_at is not null then
      raise exception 'Country can only be submitted through submit_publisher_country' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.country_code, new.country_status, new.country_submitted_at, new.country_reviewed_by, new.country_reviewed_at)
     is distinct from
     (old.country_code, old.country_status, old.country_submitted_at, old.country_reviewed_by, old.country_reviewed_at) then
    raise exception 'Country fields cannot be changed directly' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_publisher_country_changes() from public, anon, authenticated;

drop trigger if exists publishers_guard_country_changes on public.publishers;
create trigger publishers_guard_country_changes
  before insert or update on public.publishers
  for each row execute function private.guard_publisher_country_changes();

-- ---------------------------------------------------------------------
-- 3. submit_publisher_country: publisher apni country bhejta hai (hamesha 'pending').
--    publisher_id caller se kabhi nahi liya jaata: auth.uid() se apni row. Suspended publisher nahi bhej sakta.
--    Verified country wahi dobara bheji jaaye toh kuch nahi badalta (verified rehti hai). Alag country => dobara pending (verification gayi).
-- ---------------------------------------------------------------------
create or replace function public.submit_publisher_country(p_country_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_code    text := upper(btrim(coalesce(p_country_code, '')));
  v_id      uuid;
  v_status  text;
  v_pub_st  text;
  v_current text;
begin
  if v_uid is null or not private.is_active_profile() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z]{2}$' then
    raise exception 'Invalid country code' using errcode = '22023', hint = 'invalid_country_format';
  end if;

  select p.id, p.status, p.country_status, p.country_code
    into v_id, v_pub_st, v_status, v_current
  from public.publishers p
  where p.profile_id = v_uid
  for update of p;

  if not found then
    raise exception 'Publisher not found' using errcode = 'P0002';
  end if;
  if v_pub_st = 'suspended' then
    raise exception 'Publisher is suspended' using errcode = '42501', hint = 'publisher_suspended';
  end if;

  -- Wahi country, pending ya verified: kuch mat badlo (double-click safe, verified ko pending nahi banata).
  if v_current = v_code and v_status in ('pending', 'verified') then
    return v_status;
  end if;

  update public.publishers
     set country_code = v_code,
         country_status = 'pending',
         country_submitted_at = now(),
         country_reviewed_by = null,
         country_reviewed_at = null
   where id = v_id;

  return 'pending';
end;
$$;

-- ---------------------------------------------------------------------
-- 4. admin_review_publisher_country: approve (-> verified) / reject (-> rejected).
--    approve sirf 'pending' se. reject 'pending' ya 'verified' se (galat verified country wapas li ja sake).
--    Wahi decision dobara (double-click): kuch nahi badalta, review time overwrite nahi hota.
-- ---------------------------------------------------------------------
create or replace function public.admin_review_publisher_country(
  p_publisher_id     uuid,
  p_decision         text,
  p_expected_country text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_profile  uuid;
  v_code     text;
  v_status   text;
  v_target   text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
  v_target := case p_decision when 'approve' then 'verified' else 'rejected' end;

  select p.profile_id, p.country_code, p.country_status
    into v_profile, v_code, v_status
  from public.publishers p
  where p.id = p_publisher_id
  for update of p;

  if not found then
    raise exception 'Publisher not found' using errcode = 'P0002';
  end if;
  -- Admin apne hi publisher account ka country faisla nahi kar sakta (defense in depth; role FK ki wajah se aam taur par hota nahi).
  if v_profile = v_uid then
    raise exception 'You cannot review your own country' using errcode = '42501', hint = 'self_approval_blocked';
  end if;
  if v_code is null or v_status is null then
    raise exception 'No country submitted' using errcode = '22023', hint = 'country_not_submitted';
  end if;
  -- Admin ne jo country dekhi wahi review hoti hai (publisher ne beech me badli ho toh nahi).
  if p_expected_country is null or upper(btrim(p_expected_country)) is distinct from v_code then
    raise exception 'Country changed since you opened it' using errcode = '22023', hint = 'country_changed';
  end if;

  if v_status = v_target then
    return v_status;
  end if;
  if v_target = 'verified' and v_status <> 'pending' then
    raise exception 'Only a pending country can be approved' using errcode = '22023', hint = 'country_not_pending';
  end if;

  update public.publishers
     set country_status = v_target,
         country_reviewed_by = v_uid,
         country_reviewed_at = now()
   where id = p_publisher_id;

  return v_target;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. get_publisher_country_state: ad-serving ke liye read-only (service_role only).
--    country_code SIRF tab milta hai jab status 'verified' ho; baaki sab me null. Kuch likhta nahi.
-- ---------------------------------------------------------------------
create or replace function public.get_publisher_country_state(p_publisher_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'country_status', p.country_status,
           'country_code', case when p.country_status = 'verified' then p.country_code else null end
         )
  from public.publishers p
  where p.id = p_publisher_id;
$$;

-- ---------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------
revoke all on function public.submit_publisher_country(text)                    from public, anon;
revoke all on function public.admin_review_publisher_country(uuid, text, text)  from public, anon;
revoke all on function public.get_publisher_country_state(uuid)                 from public, anon, authenticated;
grant execute on function public.submit_publisher_country(text)                   to authenticated;
grant execute on function public.admin_review_publisher_country(uuid, text, text) to authenticated;
grant execute on function public.get_publisher_country_state(uuid)                to service_role;

commit;

-- ---------------------------------------------------------------------
-- Read-only checks (TEST par chalao; sab expected jawab comment me)
-- ---------------------------------------------------------------------
-- V1 (Expect: 5 rows): naye columns
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'publishers' and column_name like 'country_%' order by 1;
-- V2 (Expect: 0 rows): authenticated ko country columns par INSERT/UPDATE grant nahi
--   select column_name, privilege_type from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'publishers' and grantee = 'authenticated'
--     and privilege_type in ('INSERT', 'UPDATE') and column_name like 'country_%';
-- V3 (Expect: sirf service_role aur postgres): serving function ka access
--   select grantee from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'get_publisher_country_state' order by 1;
-- V4 (Expect: authenticated, postgres (+service_role)): submit / admin functions, anon nahi
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('submit_publisher_country', 'admin_review_publisher_country') and grantee = 'anon';  -- Expect 0 rows
-- V5 (Expect: ok = true): self-approval aur stale-country guard function me hai
--   select pg_get_functiondef('public.admin_review_publisher_country(uuid, text, text)'::regprocedure) like '%self_approval_blocked%'
--      and pg_get_functiondef('public.admin_review_publisher_country(uuid, text, text)'::regprocedure) like '%country_changed%' as ok;
-- V6 (Expect: 1 row): guard trigger laga hai
--   select tgname from pg_trigger where tgname = 'publishers_guard_country_changes' and not tgisinternal;
-- V7 (Expect: 0): purani publishers rows ka status/data nahi badla; country missing hi hai
--   select count(*) from public.publishers where country_code is not null and country_submitted_at is null;
