-- =====================================================================
-- BLISSCCO | Day 12 | Prompt 6 Part 2 | Migration (file day-12-12) : analytics ke liye READ-ONLY functions (impressions, clicks, CTR)
-- Pehle day-12-1, day-12-2 (ad_events), day-12-7 (impression writer), day-12-10 (click writer) chali hon. Dobara chalane par safe hai (create or replace).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Ye migration kyun ZAROORI hai (naya table/column/event nahi):
--   ad_events par kisi bhi role ko table-grant nahi (service_role ko bhi nahi, day-12-2). Isliye server ke paas padhne ka koi raasta hi nahi.
--   Existing project ka tareeka: security-definer function jo CALLER ki pehchaan (auth.uid()) se ownership khud jaanche (jaise get_my_campaign_spend).
--   Isse service-role key ka analytics me kabhi kaam hi nahi padta: app sirf logged-in user ke session se function bulata hai.
--
-- Is file me sirf 2 functions (koi table / column / index / trigger / grant-change / policy nahi):
--  A. public.get_my_campaign_analytics(p_campaign_id uuid default null)
--       Campaign-level: (campaign_id, impressions, clicks, ctr). Kaun dekh sakta hai:
--         - advertiser: SIRF apne campaigns (campaigns.advertiser_id = private.my_advertiser_id())
--         - admin (active): sab (get_my_campaign_spend jaisa hi niyam)
--         - publisher / anon / suspended profile: koi row nahi
--       Doosre ka campaign id do toh 0 rows (exist karta hai ya nahi, ye bhi nahi batata).
--  B. public.get_my_publisher_analytics()
--       Publisher ko CAMPAIGN / advertiser ki pehchaan kabhi nahi milti (Day 12 Part 1, section 3). Isliye publisher ko sirf apni
--       traffic ke TOTALS milte hain: (impressions, clicks, ctr), ad_events.publisher_id = caller ka publisher. Campaign id kabhi nahi.
--
-- Paribhasha (existing events se, kuch naya nahi):
--   impressions = ad_events me event_type = 'impression' ki rows ('serve' event ya ad_serve_log impression NAHI hai)
--   clicks      = ad_events me event_type = 'click' ki rows
--   ctr         = clicks / impressions * 100 (percent), 4 decimal tak; impressions = 0 => 0 (division hota hi nahi)
--   Ek serve = max 1 impression + max 1 click (ad_events_one_per_type_key), isliye ginti double nahi hoti.
--   Lifetime, par ad_events ki retention ke andar (purge_old_ad_logs: serve log ke saath 90 din). Isse purane events nahi dikhenge.
--
-- Jo NAHI badalta: ad_events, ad_serve_log, record_ad_*, record_ad_serve, spend / budget, RLS, koi existing grant.
-- =====================================================================

-- FIX (Day 14 Part 2): revoke ab service_role par bhi (pehle sirf public, anon). Header + day-12-13 T5 ka matlab 'service_role execute nahi kar sakta' tha, par Supabase ke default
--   privileges service_role ko naye public function par EXECUTE dete hain, isliye wo revoke ke bina bacha rehta tha. Sirf tightening: authenticated ka grant wahi hai, app user-session se hi bulata hai.
-- Dependencies (actual): day-3-5 (private.is_admin, private.my_advertiser_id), day-3-1/3-2/3-3 (profiles, publishers, campaigns), day-12-2 (ad_events).

begin;

-- ---------- A. campaign-level ----------
create or replace function public.get_my_campaign_analytics(p_campaign_id uuid default null)
returns table (campaign_id uuid, impressions bigint, clicks bigint, ctr numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select t.campaign_id,
         t.impressions,
         t.clicks,
         case when t.impressions = 0 then 0::numeric
              else round(t.clicks * 100.0 / t.impressions, 4) end as ctr
  from (
    select c.id as campaign_id, c.created_at,
           count(e.id) filter (where e.event_type = 'impression') as impressions,
           count(e.id) filter (where e.event_type = 'click')      as clicks
    from public.campaigns c
    left join public.ad_events e
           on e.campaign_id = c.id and e.event_type in ('impression', 'click')
    where (p_campaign_id is null or c.id = p_campaign_id)
      and (c.advertiser_id = (select private.my_advertiser_id()) or (select private.is_admin()))
    group by c.id, c.created_at
    order by c.created_at desc
    limit 500
  ) t
  order by t.created_at desc
$$;

revoke all on function public.get_my_campaign_analytics(uuid) from public, anon, service_role;
grant execute on function public.get_my_campaign_analytics(uuid) to authenticated;

comment on function public.get_my_campaign_analytics(uuid) is
  'Campaign-level impressions / clicks / CTR (clicks*100/impressions, 0 jab impressions 0). Advertiser sirf apne campaigns; admin sab; baaki koi row nahi. Sirf padhta hai.';

-- ---------- B. publisher totals (campaign pehchaan ke bina) ----------
create or replace function public.get_my_publisher_analytics()
returns table (impressions bigint, clicks bigint, ctr numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select t.impressions,
         t.clicks,
         case when t.impressions = 0 then 0::numeric
              else round(t.clicks * 100.0 / t.impressions, 4) end as ctr
  from (
    select count(e.id) filter (where e.event_type = 'impression') as impressions,
           count(e.id) filter (where e.event_type = 'click')      as clicks
    from public.publishers p
    join public.profiles pr on pr.id = p.profile_id
    left join public.ad_events e
           on e.publisher_id = p.id and e.event_type in ('impression', 'click')
    where p.profile_id = (select auth.uid()) and pr.status = 'active'
    group by p.id
  ) t
$$;

revoke all on function public.get_my_publisher_analytics() from public, anon, service_role;
grant execute on function public.get_my_publisher_analytics() to authenticated;

comment on function public.get_my_publisher_analytics() is
  'Publisher ki apni traffic ke impressions / clicks / CTR totals. Campaign ya advertiser ki pehchaan kabhi nahi. Sirf padhta hai.';

commit;

-- Check 1 (Expect: 2 rows, dono prosecdef = true, provolatile = 's')
--   select proname, prosecdef, provolatile from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('get_my_campaign_analytics', 'get_my_publisher_analytics') order by 1;
-- Check 2 (Expect: sirf 'authenticated' ke paas EXECUTE; anon / PUBLIC / service_role nahi)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('get_my_campaign_analytics', 'get_my_publisher_analytics')
--   and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- Phir day-12-13-campaign-analytics-tests.sql (rollback-only) chalao.
