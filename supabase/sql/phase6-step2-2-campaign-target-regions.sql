-- =====================================================================
-- BLISSCCO | Phase 6 | Step 2 Part 2 : campaign target regions (database level)
-- Pehle day-3-3 (campaigns), day-3-5 (column grants) aur phase6-step2-1 (publisher country) chali honi chahiye.
-- Dobara chalane par safe hai (add column if not exists / drop+create constraint / create or replace).
-- PEHLE TEST project par chalao. PRODUCTION PAR ABHI NAHI. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Kya hai:
--  * campaigns me EK naya nullable column: target_regions text[]  (repo me campaign region targeting pehle se nahi thi; ye uski ekmatra jagah hai).
--    null ya khali array = koi region select nahi = SIRF Rest of World (all-region NAHI; owner decision). Purani rows null rehti hain.
--  * Database sirf SHAPE check karta hai (zyada se zyada 8 entries, lowercase letters / underscore). Kaun se region ids valid hain
--    aur country->region mapping sirf lib/regions/country-region.ts me hai (duplicate list nahi). Anjaana id TypeScript me
--    fail closed hota hai (us campaign ko koi publisher nahi milta).
--  * get_campaign_target_regions(uuid[]) : read-only, sirf service_role (ad-serving). Kuch likhta nahi.
--
-- Jaan-boojh kar NAHI kiya:
--  * load_ad_candidates / record_ad_serve / authorize_publisher_key ko nahi badla (purani function-redefining chain ko haath nahi lagta).
--  * Column GRANT nahi diya: day-3-5 ka campaigns update/insert grant column-wise hai, isliye anon / authenticated (publisher ya advertiser) API se
--    ise nahi badal sakte; sirf SQL Editor / service_role / admin. Koi client region likh nahi sakta.
--  * Advertiser ke liye form / UI nahi (Part 3). Publisher is column ko kabhi nahi chhoota (campaigns par uska koi access nahi).
--  * Pricing / payments / ledger / payouts ko haath nahi lagta.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Naya column (purani rows: null = Rest of World only)
-- ---------------------------------------------------------------------
alter table public.campaigns add column if not exists target_regions text[];

alter table public.campaigns drop constraint if exists campaigns_target_regions_check;
alter table public.campaigns add constraint campaigns_target_regions_check check (
  target_regions is null
  or cardinality(target_regions) = 0
  or (
    cardinality(target_regions) <= 8
    and array_to_string(target_regions, ',') ~ '^[a-z_]{1,30}(,[a-z_]{1,30})*$'
  )
);

comment on column public.campaigns.target_regions is 'Campaign ke target regions (region ids lib/regions/country-region.ts me). null ya khali = sirf Rest of World, all-region nahi.';

-- ---------------------------------------------------------------------
-- 2. get_campaign_target_regions: ad-serving ke liye read-only (service_role only).
--    Har maange gaye campaign ki ek row; null target_regions null hi jaata hai (khali array bhi khali). Kuch likhta nahi.
-- ---------------------------------------------------------------------
create or replace function public.get_campaign_target_regions(p_campaign_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('campaign_id', c.id, 'target_regions', to_jsonb(c.target_regions))),
    '[]'::jsonb
  )
  from public.campaigns c
  where c.id = any (p_campaign_ids);
$$;

-- ---------------------------------------------------------------------
-- 3. Access
-- ---------------------------------------------------------------------
revoke all on function public.get_campaign_target_regions(uuid[]) from public, anon, authenticated;
grant execute on function public.get_campaign_target_regions(uuid[]) to service_role;

commit;

-- ---------------------------------------------------------------------
-- Read-only checks (TEST par chalao; sab expected jawab comment me)
-- ---------------------------------------------------------------------
-- V1 (Expect: 1 row): naya column
--   select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'campaigns' and column_name = 'target_regions';
-- V2 (Expect: 0 rows): anon / authenticated ko function par execute nahi
--   select grantee from information_schema.routine_privileges where specific_schema = 'public' and routine_name = 'get_campaign_target_regions' and grantee in ('anon', 'authenticated', 'PUBLIC');
-- V3 (Expect: purani sab campaigns par null): koi purani row ab tak badli nahi
--   select count(*) filter (where target_regions is not null) as with_regions, count(*) as total from public.campaigns;
-- V5 (Expect: 0 rows): authenticated ko target_regions par INSERT/UPDATE grant nahi
--   select privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'campaigns' and column_name = 'target_regions' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE');
-- V4 (Expect: error check_violation): galat shape (bade letters) reject; kisi test campaign par rollback ke saath
--   begin; update public.campaigns set target_regions = array['North America'] where id = (select id from public.campaigns limit 1); rollback;
