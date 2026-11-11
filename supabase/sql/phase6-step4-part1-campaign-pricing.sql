-- =====================================================================
-- BLISSCCO | Phase 6 | Step 4 Part 1 : campaign-level pricing (CPM / CPC), database level
-- Pehle day-3-3 (campaigns), day-3-5 (column grants), day-4-1 (campaign guards) aur phase6-step2-2 chali honi chahiye.
-- FORWARD-ONLY: koi table/column drop nahi hota, koi purani row badalti nahi, koi purani migration file nahi badli.
-- Dobara chalane par safe hai (add column if not exists / drop+create constraint / create or replace / drop+create trigger).
-- PEHLE TEST project (denim) par chalao. PRODUCTION PAR ABHI NAHI. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Kya hai (campaigns me 3 naye nullable columns):
--   pricing_model  text           : 'cpm' | 'cpc' | null
--   cpm_rate_usd   numeric(10, 4) : har 1000 impressions ki keemat (USD), sirf pricing_model = 'cpm' par
--   cpc_rate_usd   numeric(10, 4) : har click ki keemat (USD),            sirf pricing_model = 'cpc' par
--
-- LEGACY COMPATIBILITY: purani sab campaigns par teeno columns null rehte hain. null = "platform default":
--   ad serving ab bhi public.ad_platform_settings.cpm_usd (ek fixed platform CPM) se hi charge karti hai, jaisa pehle.
--   Koi backfill nahi: purani row ko koi nayi keemat chupke se nahi di jaati.
--
-- MONEY: numeric(10, 4) (exact decimals, float kabhi nahi). 4 decimal isliye ki serve ki keemat bhi 4 decimal tak
--   (greatest(round(cpm / 1000, 4), 0.0001), day-5-8) hoti hai aur CPC jaise 0.0150 ko 2 decimal me nahi rakha ja sakta.
-- USD: rates campaigns.currency_code me hi hain, aur wo column CHECK se sirf 'USD' hai (campaigns_currency_usd_only, day-3-3).
--   Neeche ek aur CHECK (campaigns_pricing_usd_check) saaf likhta hai ki pricing wali row USD hi ho, taaki currency
--   kabhi multi-currency ki ho jaye toh bhi pricing chupke se galat currency me na padhi jaye.
-- LIMITS (TypeScript lib/campaigns/pricing-rules.ts me wahi numbers; badalna ho toh DONO jagah):
--   CPM 0.10 .. 1000.00  (0.10 kam se kam: ek serve ka floor $0.0001 = $0.10 CPM; usse kam rate sach nahi hota)
--   CPC 0.01 .. 100.00   (aur ek click ki keemat total budget (aur daily budget, agar hai) se zyada nahi)
--
-- Jaan-boojh kar NAHI kiya:
--   * ad_platform_settings ko haath nahi lagta (cpm_usd waise hi platform fallback hai).
--   * load_ad_candidates / record_ad_serve / authorize_publisher_key / match function nahi badle (serving same).
--   * Campaign ka rate abhi kisi charge / ledger / earnings me use NAHI hota. Sirf store hota hai (readiness).
--   * private.guard_campaign_changes ko dobara define nahi kiya (purani redefine-chain ko haath nahi lagta):
--     pricing ka lock ek ALAG trigger se aata hai (neeche).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Naye columns (purani rows: null = platform default)
-- ---------------------------------------------------------------------
alter table public.campaigns add column if not exists pricing_model text;
alter table public.campaigns add column if not exists cpm_rate_usd  numeric(10, 4);
alter table public.campaigns add column if not exists cpc_rate_usd  numeric(10, 4);

-- ---------------------------------------------------------------------
-- 2. Constraints (purani rows sab null hain, isliye sab pass hoti hain)
-- ---------------------------------------------------------------------
alter table public.campaigns drop constraint if exists campaigns_pricing_model_check;
alter table public.campaigns add constraint campaigns_pricing_model_check
  check (pricing_model is null or pricing_model in ('cpm', 'cpc'));

-- Shape: model ke hisaab se sirf uska rate bhara, doosra null. model null => dono null.
alter table public.campaigns drop constraint if exists campaigns_pricing_shape_check;
alter table public.campaigns add constraint campaigns_pricing_shape_check check (
  (pricing_model is null and cpm_rate_usd is null and cpc_rate_usd is null)
  or (pricing_model = 'cpm' and cpm_rate_usd is not null and cpc_rate_usd is null)
  or (pricing_model = 'cpc' and cpc_rate_usd is not null and cpm_rate_usd is null)
);

alter table public.campaigns drop constraint if exists campaigns_cpm_rate_range_check;
alter table public.campaigns add constraint campaigns_cpm_rate_range_check
  check (cpm_rate_usd is null or (cpm_rate_usd >= 0.10 and cpm_rate_usd <= 1000.00));

alter table public.campaigns drop constraint if exists campaigns_cpc_rate_range_check;
alter table public.campaigns add constraint campaigns_cpc_rate_range_check
  check (cpc_rate_usd is null or (cpc_rate_usd >= 0.01 and cpc_rate_usd <= 100.00));

-- Ek click ki keemat total / daily budget se zyada nahi (warna campaign ek click bhi afford nahi kar sakta).
alter table public.campaigns drop constraint if exists campaigns_cpc_rate_budget_check;
alter table public.campaigns add constraint campaigns_cpc_rate_budget_check check (
  cpc_rate_usd is null
  or (cpc_rate_usd <= total_budget and (daily_budget is null or cpc_rate_usd <= daily_budget))
);

alter table public.campaigns drop constraint if exists campaigns_pricing_usd_check;
alter table public.campaigns add constraint campaigns_pricing_usd_check
  check (pricing_model is null or currency_code = 'USD');

comment on column public.campaigns.pricing_model is 'cpm | cpc | null. null = purana campaign: platform default (ad_platform_settings.cpm_usd). Abhi sirf store hota hai, serving / charge me use nahi.';
comment on column public.campaigns.cpm_rate_usd is 'USD, har 1000 impressions ki keemat. Sirf pricing_model = cpm par. 0.10 .. 1000.00.';
comment on column public.campaigns.cpc_rate_usd is 'USD, har click ki keemat. Sirf pricing_model = cpc par. 0.01 .. 100.00 aur total / daily budget se zyada nahi.';

-- ---------------------------------------------------------------------
-- 3. Lock: pending_review / completed / archived me pricing nahi badalti (budget / dates jaisa).
--    Alag trigger function: guard_campaign_changes ko dobara define nahi kiya.
--    SQL Editor / admin functions (postgres role) par lagu nahi, sirf anon / authenticated par.
-- ---------------------------------------------------------------------
create or replace function private.guard_campaign_pricing_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status in ('pending_review', 'completed', 'archived')
     and (new.pricing_model, new.cpm_rate_usd, new.cpc_rate_usd)
         is distinct from
         (old.pricing_model, old.cpm_rate_usd, old.cpc_rate_usd) then
    raise exception 'Campaign pricing is locked while status is %', old.status using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_pricing_changes() from public, anon, authenticated;

drop trigger if exists campaigns_guard_pricing on public.campaigns;
create trigger campaigns_guard_pricing
  before update on public.campaigns
  for each row execute function private.guard_campaign_pricing_changes();

-- ---------------------------------------------------------------------
-- 4. Access: advertiser apne campaign ka pricing likh sakta hai (RLS + guard ke andar), column-wise grant.
--    Publisher ka campaigns par koi access nahi (change nahi).
-- ---------------------------------------------------------------------
grant insert (pricing_model, cpm_rate_usd, cpc_rate_usd) on public.campaigns to authenticated;
grant update (pricing_model, cpm_rate_usd, cpc_rate_usd) on public.campaigns to authenticated;

commit;

-- ---------------------------------------------------------------------
-- Read-only checks (TEST par chalao; sab expected jawab comment me)
-- ---------------------------------------------------------------------
-- V1 (Expect: 3 rows; numeric / numeric / text):
--   select column_name, data_type, numeric_precision, numeric_scale from information_schema.columns
--   where table_schema = 'public' and table_name = 'campaigns' and column_name in ('pricing_model', 'cpm_rate_usd', 'cpc_rate_usd');
-- V2 (Expect: 6 rows): pricing ke constraints
--   select conname from pg_constraint where conrelid = 'public.campaigns'::regclass
--     and conname in ('campaigns_pricing_model_check', 'campaigns_pricing_shape_check', 'campaigns_cpm_rate_range_check',
--                     'campaigns_cpc_rate_range_check', 'campaigns_cpc_rate_budget_check', 'campaigns_pricing_usd_check');
-- V3 (Expect: with_pricing = 0 jab tak koi advertiser nayi campaign / edit na kare): purani rows null hain
--   select count(*) filter (where pricing_model is not null) as with_pricing, count(*) as total from public.campaigns;
-- V4 (Expect: 1 row): lock trigger laga hai
--   select tgname from pg_trigger where tgname = 'campaigns_guard_pricing' and not tgisinternal;
-- V5 (Expect: 0 rows): anon ko pricing columns par koi grant nahi
--   select privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name = 'campaigns'
--     and column_name in ('pricing_model', 'cpm_rate_usd', 'cpc_rate_usd') and grantee = 'anon';
-- V6 (Expect: ad_platform_settings badli nahi): ek hi row, cpm_usd jaisa pehle tha
--   select cpm_usd, rate_limit_per_minute from public.ad_platform_settings;
