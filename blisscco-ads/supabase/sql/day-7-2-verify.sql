-- =====================================================================
-- BLISSCCO | Day 7 | Part 2 : database ki JAANCH (sirf padhta hai, kuch badalta nahi)
-- day-7-1 chalane ke BAAD Supabase SQL Editor me chalao. Har check ke neeche "Expect" likha hai.
-- Agar koi check alag aaye toh uska screenshot bhejna.
-- =====================================================================

-- 1) 6 functions mile? (Expect: 6 rows, security_definer = true sab me)
select proname, prosecdef as security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('authorize_publisher_key','record_ad_serve','issue_publisher_key_for',
                  'list_publisher_keys_for','revoke_publisher_key_for','get_my_campaign_spend')
order by proname;

-- 2) Kis kis ko execute ki ijazat hai? (Expect: sirf service_role aur postgres; get_my_campaign_spend me authenticated bhi)
--    anon ya PUBLIC kahin nahi dikhna chahiye.
select routine_name, grantee
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('authorize_publisher_key','record_ad_serve','issue_publisher_key_for',
                       'list_publisher_keys_for','revoke_publisher_key_for','get_my_campaign_spend',
                       'load_ad_candidates','match_contextual_ad')
order by routine_name, grantee;
-- match_contextual_ad ke liye Expect: sirf postgres (service_role nahi).

-- 3) Tables par koi seedha access nahi (Expect: 0 rows)
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('publisher_api_keys','ad_serve_log','creative_serve_daily','campaign_spend_daily','api_rate_limits','ad_platform_settings')
  and grantee in ('anon','authenticated','service_role','PUBLIC');

-- 4) Key table me naye columns (Expect: expires_at, key_hint, label)
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'publisher_api_keys'
  and column_name in ('label','expires_at','key_hint') order by column_name;

-- 5) Sab 6 tables par RLS ON (Expect: row_security = true har row me)
select relname, relrowsecurity as row_security
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles','advertisers','publishers','campaigns','ad_creatives','publisher_api_keys',
                  'ad_serve_log','creative_serve_daily','campaign_spend_daily','api_rate_limits','ad_platform_settings')
order by relname;

-- 6) Safai ka job (Expect: 1 row agar pg_cron ON hai; khali ho toh pg_cron OFF hai, haath se chalana hoga)
select jobname, schedule from cron.job where jobname = 'blisscco-purge-old-logs';

-- 7) Kitne approved ads, active campaigns, active publishers hain (jaankari ke liye)
select
  (select count(*) from public.ad_creatives where status = 'approved')  as approved_ads,
  (select count(*) from public.campaigns    where status = 'active')    as active_campaigns,
  (select count(*) from public.publishers   where status = 'active')    as active_publishers,
  (select count(*) from public.advertisers  where status = 'active')    as active_advertisers;
