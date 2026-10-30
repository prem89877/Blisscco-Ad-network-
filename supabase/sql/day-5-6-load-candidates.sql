-- =====================================================================
-- BLISSCCO | Day 5 | Part 6 : public.load_ad_candidates (sirf PADHNE wala function)
-- Pehle day-5-1 se day-5-4 chali honi chahiye. Dobara chalane par safe hai
-- (create or replace; koi table/column/data nahi badalta, koi write nahi).
--
-- Kyun chahiye: day-5-3 ne creative_serve_daily aur campaign_spend_daily se service_role ke
-- grant bhi hata diye the. Isliye server ka candidate loader unhe seedha nahi padh sakta.
-- Ye function (security definer) wahi padhkar sirf zaroori columns deta hai.
--
-- Security
--  * READ-ONLY (language sql, stable): koi insert/update/delete nahi, koi counter nahi badalta.
--  * SECURITY DEFINER + search_path = '' (fake object inject nahi ho sakta); har object schema-qualified.
--  * Execute SIRF service_role ko. anon/authenticated/public ko nahi.
--  * Return me advertiser ka naam/email/profile id kuch nahi: sirf AdCandidate ke fields
--    (creative text + URL, status, campaign id/category/dates/budget, kharch, serve counts).
--    Ye data server-side hi rehta hai; publisher ko sirf toPublicAd() ke 5 fields jaate hain.
--  * Input sakht: category slug-format + ad_categories me active ho; p_today UTC aaj se +-1 din
--    ke andar ho. Warna khali result (error nahi, kuch batate nahi).
--  * Max 200 rows, order selection strategy jaisa (kam serve hua campaign, kam serve hua creative, ids),
--    taaki 200 par kaatne se sabse behtar candidates na chhootein.
--
-- Coarse filter yahan lagta hai (approved creative, active campaign/advertiser/profile, category, dates).
-- Poori eligibility (budget, completeness, exclude list) TypeScript layer dobara jaanchti hai.
--
-- Budget ke baare me: spent_total / spent_today campaign_spend_daily se aate hain. Wahan abhi koi nahi
-- likhta (Day 6), isliye ye 0 honge. TypeScript me spendTracking = "unavailable" rakhna jab tak ye na badle.
-- =====================================================================

create or replace function public.load_ad_candidates(
  p_category text,
  p_today    date
)
returns table (
  creative_id               uuid,
  headline                  text,
  body                      text,
  cta_text                  text,
  destination_url           text,
  creative_status           text,
  campaign_id               uuid,
  campaign_status           text,
  category                  text,
  start_date                date,
  end_date                  date,
  total_budget              numeric,
  daily_budget              numeric,
  spent_total               numeric,
  spent_today               numeric,
  advertiser_status         text,
  advertiser_profile_status text,
  campaign_serves_today     integer,
  creative_serves_today     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    x.id,
    x.headline,
    x.body,
    x.cta_text,
    x.destination_url,
    x.status,
    c.id,
    c.status,
    c.category,
    c.start_date,
    c.end_date,
    c.total_budget,
    c.daily_budget,
    coalesce((select sum(s.spent) from public.campaign_spend_daily s
              where s.campaign_id = c.id), 0),
    coalesce((select s.spent from public.campaign_spend_daily s
              where s.campaign_id = c.id and s.day = p_today), 0),
    a.status,
    ap.status,
    coalesce((select sum(d.serves) from public.creative_serve_daily d
              where d.campaign_id = c.id and d.day = p_today), 0)::integer as campaign_serves_today,
    coalesce((select d2.serves from public.creative_serve_daily d2
              where d2.creative_id = x.id and d2.day = p_today), 0)::integer as creative_serves_today
  from public.ad_creatives x
  join public.campaigns  c  on c.id  = x.campaign_id
  join public.advertisers a on a.id  = c.advertiser_id
  join public.profiles   ap on ap.id = a.profile_id
  where p_category is not null
    and p_today is not null
    and p_category ~ '^[a-z0-9_]{1,50}$'
    and p_today between ((now() at time zone 'utc')::date - 1) and ((now() at time zone 'utc')::date + 1)
    and exists (select 1 from public.ad_categories k where k.slug = p_category and k.is_active)
    and c.category = p_category
    and x.status  = 'approved'
    and c.status  = 'active'
    and a.status  = 'active'
    and ap.status = 'active'
    and c.start_date <= p_today
    and (c.end_date is null or c.end_date >= p_today)
  order by campaign_serves_today asc, creative_serves_today asc, c.id asc, x.id asc
  limit 200
$$;

comment on function public.load_ad_candidates(text, date) is
  'Read-only: eligible-looking ad candidates for one category and one UTC day. Execute: service_role only.';

revoke all on function public.load_ad_candidates(text, date) from public, anon, authenticated;
grant execute on function public.load_ad_candidates(text, date) to service_role;

-- Check 1 (Expect: 1 row, security_definer = true)
--   select proname, prosecdef as security_definer from pg_proc
--   where proname = 'load_ad_candidates' and pronamespace = 'public'::regnamespace;
-- Check 2 (Expect: sirf service_role aur postgres)
--   select grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'load_ad_candidates' order by grantee;
