-- =====================================================================
-- BLISSCCO | Phase 6 | Step 3 Part 1 : advertiser business country (database level)
-- Pehle day-3-2 (advertisers) aur day-3-5 (column grants + RLS) chali honi chahiye.
-- Dobara chalane par safe hai (add column if not exists / drop+create constraint / grant dobara).
-- PEHLE TEST project par chalao. PRODUCTION PAR ABHI NAHI. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Kya hai:
--  * advertisers me EK naya nullable column: country_code text  (advertiser ki business country; ISO 3166-1 alpha-2).
--    Purani rows null rehti hain: koi purana advertiser naya account nahi banata, koi campaign data nahi badalta.
--  * Database sirf SHAPE check karta hai (do bade letters). Kaun sa code officially assigned ISO code hai aur country -> region mapping
--    sirf lib/regions/country-region.ts me hai (SQL me koi country / region list nahi, duplicate nahi). Region database me STORE nahi hota:
--    hamesha us central mapping se nikalta hai (purana / galat region kabhi nahi bachta).
--  * UPDATE grant sirf is ek column par (authenticated). Row level security purani hi hai (day-3-5: advertisers_update_own):
--    advertiser sirf apni row, aur sirf active profile. INSERT grant NAHI badla: signup ka insert pehle jaisa hi rehta hai,
--    country uske BAAD alag update se aati hai (column na ho tab bhi signup nahi tootta).
--
-- Jaan-boojh kar NAHI kiya:
--  * Koi verification / status column nahi (advertiser ki country sirf business-profile jaankari hai; ad-serving ka gate publisher country hai).
--  * status, company_name, website_url ke grant, RLS policies, triggers ko haath nahi lagta.
--  * Pricing / payments / billing (USD) / ledger / payouts / campaigns / publishers ko haath nahi lagta.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Naya column (purani rows: null = country abhi chuni nahi)
-- ---------------------------------------------------------------------
alter table public.advertisers add column if not exists country_code text;

alter table public.advertisers drop constraint if exists advertisers_country_code_check;
alter table public.advertisers add constraint advertisers_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

comment on column public.advertisers.country_code is 'Advertiser ki business country: ISO 3166-1 alpha-2 (do bade letters). null = chuni nahi. Region yahan store nahi hota (lib/regions/country-region.ts se nikalta hai).';

-- ---------------------------------------------------------------------
-- 2. Access: advertiser apni country badal sakta hai (RLS: sirf apni row). Insert grant jaisa tha waisa.
-- ---------------------------------------------------------------------
grant update (country_code) on public.advertisers to authenticated;

commit;

-- ---------------------------------------------------------------------
-- Read-only checks (TEST par chalao; sab expected jawab comment me)
-- ---------------------------------------------------------------------
-- V1 (Expect: 1 row, text, YES): naya column
--   select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'advertisers' and column_name = 'country_code';
-- V2 (Expect: with_country = 0, total = jitne advertisers pehle the): koi purani row badli nahi
--   select count(*) filter (where country_code is not null) as with_country, count(*) as total from public.advertisers;
-- V3 (Expect: sirf UPDATE): authenticated ko country_code par INSERT nahi, UPDATE hai
--   select privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'advertisers' and column_name = 'country_code' and grantee = 'authenticated';
-- V4 (Expect: error check_violation): galat shape (chhote letters) reject; kisi test advertiser par rollback ke saath
--   begin; update public.advertisers set country_code = 'in' where id = (select id from public.advertisers limit 1); rollback;
-- V5 (Expect: company_name, website_url, country_code): authenticated ke UPDATE columns (status / profile_id nahi)
--   select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'advertisers' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by column_name;
