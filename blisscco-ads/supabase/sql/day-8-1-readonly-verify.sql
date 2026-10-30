-- =====================================================================
-- BLISSCCO | Day 8 | Part 3 : Supabase ki READ-ONLY jaanch (sirf SELECT)
--
-- !! NOT RUN: ye file maine kisi Postgres/Supabase par CHALAI NAHI hai (sandbox me Postgres nahi tha).
--    Isliye "Expect" ka matlab hai "SQL padhkar jo hona chahiye", asli result nahi.
--    Pehle TEST project par chalao. Koi table/policy/function/data nahi badalta, kuch save nahi hota.
--
-- Kaise chalao: Supabase > SQL Editor. Har BLOCK ALAG chalao (editor saaf karke ek block paste karo),
-- kyunki editor sirf aakhri result dikhata hai. Koi block alag aaye toh uska screenshot bhejo.
-- Koi password / key is file me nahi hai aur kisi block ko chahiye bhi nahi.
-- =====================================================================


-- ===== A1. Tables aur RLS =====
-- Expect (Day 8 ke waqt): 12 rows, rls_on = true har row me. (Day 14 note: Day 9-13 ke baad 7 tables aur aate hain => 19 rows, sab rls_on = true:
--   Day 9 ka 1, Day 12 ka 1 aur Day 13 ke 5 tables; naam supabase/MIGRATION-ORDER.md aur us din ki migration files me hain.)
--   ad_categories, ad_creatives, ad_platform_settings, ad_serve_log, advertisers, api_rate_limits,
--   campaign_spend_daily, campaigns, creative_serve_daily, profiles, publisher_api_keys, publishers
select c.relname as table_name, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by c.relname;


-- ===== A2. Saari policies =====
-- Expect: sirf profiles, advertisers, publishers, campaigns, ad_creatives par policies; sab "to authenticated";
-- koi policy anon ke liye nahi, koi "using (true)" nahi. profiles: select_own, select_admin, update_own.
--   advertisers/publishers/campaigns/ad_creatives: select_own, select_admin, insert_own, update_own. Koi delete policy nahi.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ===== A3. RLS ON par koi policy nahi (matlab: sirf SECURITY DEFINER functions chhoo sakte hain) =====
-- Expect (Day 8 ke waqt 7 rows; Day 9-13 ke baad 14: upar ke 7 naye tables bhi RLS on + koi policy nahi): ad_categories, ad_platform_settings, ad_serve_log, api_rate_limits,
--                  campaign_spend_daily, creative_serve_daily, publisher_api_keys
select c.relname as table_name
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
order by c.relname;


-- ===== B1. Kis role ko kis table par kya haq (poora matrix) =====
-- Expect:
--   anon: sab false.
--   authenticated: select sirf profiles, advertisers, publishers, campaigns, ad_creatives par; delete kahin nahi.
--   service_role: ad_serve_log, creative_serve_daily, campaign_spend_daily, api_rate_limits, ad_platform_settings,
--                 publisher_api_keys par sab false (day-5-2 / day-5-3 ne hataya). Baaki 6 tables par Supabase ke
--                 default grants ho sakte hain (app inhe service_role se seedha nahi padhti) - dekh lo.
select c.relname as table_name, r.rolname as role_name,
       has_table_privilege(r.rolname, c.oid, 'select') as can_select,
       has_table_privilege(r.rolname, c.oid, 'insert') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'update') as can_update,
       has_table_privilege(r.rolname, c.oid, 'delete') as can_delete
from pg_class c
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by c.relname, r.rolname;


-- ===== B2. authenticated ko kin COLUMNS par insert/update ka haq hai =====
-- Expect: profiles me sirf display_name update; role/status/id kahin nahi.
--   advertisers: insert (profile_id, company_name, website_url), update (company_name, website_url); status nahi.
--   publishers: insert (profile_id, name, website_url, category), update (name, website_url, category); status nahi.
--   campaigns: status update ho sakta hai (trigger transitions rokta hai); description insert/update (day-4-3).
--   ad_creatives: status update ho sakta hai (trigger rokta hai); rejection_reason/reviewed_* kabhi nahi.
select table_name, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
order by table_name, privilege_type, column_name;


-- ===== C1. Functions (public + private): SECURITY DEFINER, search_path, kaun execute kar sakta hai =====
-- Expect: private.* functions par anon_exec = false. public.authorize_publisher_key, record_ad_serve,
--   load_ad_candidates, issue/list/revoke_publisher_key_for: sirf service_exec = true (anon/auth false).
--   admin_* functions aur get_my_campaign_spend: auth_exec = true, anon_exec = false.
--   health_ping: anon_exec = true (jaan-boojh kar). match_contextual_ad aur private.issue/revoke_publisher_key:
--   teeno false (execute hata diya gaya hai).
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       coalesce(p.proconfig::text, '') as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by n.nspname, p.proname;


-- ===== C2. SECURITY DEFINER function jisme search_path set NAHI =====
-- Expect: 0 rows.
select n.nspname as schema_name, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg where cfg like 'search_path=%')
order by n.nspname, p.proname;


-- ===== C3. Function ka ASLI (aakhri) version sahi hai? (purani SQL dobara chalne se piche jaana pakadta hai) =====
-- Expect: sab 4 rows me ok = true. false = koi purani migration baad me dobara chal gayi (ya order galat tha).
select 'guard_campaign_changes: 50 campaign limit + resume check + description lock (day-4-3)' as check_name,
       (d like '%campaign_limit_reached%' and d like '%resume_needs_approved_creative%' and d like '%new.description%') as ok
from (select pg_get_functiondef('private.guard_campaign_changes()'::regprocedure) as d) x
union all
select 'record_ad_serve: budget likhta hai + campaign row lock (day-7-1)',
       (d like '%campaign_spend_daily%' and d like '%for update of c%')
from (select pg_get_functiondef('public.record_ad_serve(text, uuid, text)'::regprocedure) as d) x
union all
select 'authorize_publisher_key: expiry check (day-7-1) + minute-gated cleanup (day-7-5)',
       (d like '%expires_at%' and d like '%v_hits = 1%')
from (select pg_get_functiondef('public.authorize_publisher_key(text)'::regprocedure) as d) x
union all
select 'handle_new_user: advertiser row banata hai (day-4-1)',
       (d like '%into public.advertisers%')
from (select pg_get_functiondef('public.handle_new_user()'::regprocedure) as d) x;


-- ===== D1. Triggers =====
-- Expect (sab tgenabled = O): auth.users par on_auth_user_created; profiles par profiles_guard_changes +
--   profiles_set_updated_at; campaigns par campaigns_guard_changes + campaigns_set_updated_at;
--   ad_creatives par ad_creatives_guard_changes + ad_creatives_set_updated_at; advertisers, publishers,
--   ad_platform_settings par *_set_updated_at.
select c.relnamespace::regnamespace as schema_name, c.relname as table_name, t.tgname as trigger_name, t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and (c.relnamespace = 'public'::regnamespace or (c.relnamespace = 'auth'::regnamespace and c.relname = 'users'))
order by 1, 2, 3;


-- ===== D2. Constraints jo "NOT VALID" reh gaye =====
-- Expect: 0 rows (day-5-1 aur day-5-11 ne validate kiya tha).
select conrelid::regclass as table_name, conname, contype
from pg_constraint
where connamespace = 'public'::regnamespace and not convalidated
order by 1, 2;


-- ===== D3. Foreign keys aur delete ka rule =====
-- Expect: zyadatar restrict. api_rate_limits -> publisher_api_keys cascade. ad_creatives.reviewed_by set null.
-- profiles -> auth.users cascade (auth.users delete karne par profile jaati hai, par advertiser/publisher row restrict se rokti hai).
select conrelid::regclass as table_name, conname, confrelid::regclass as references_table,
       case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade'
                        when 'n' then 'set null' when 'd' then 'set default' end as on_delete
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by 1, 2;


-- ===== D4. Indexes =====
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;


-- ===== D5. Foreign key jiske pehle column par koi index nahi =====
-- Expect: khali ya sirf chhoti tables (jaise publishers.category, campaigns.category ka FK). Bade tables par aaye toh batao.
select c.conrelid::regclass as table_name, c.conname
from pg_constraint c
where c.contype = 'f' and c.connamespace = 'public'::regnamespace
  and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
order by 1, 2;


-- ===== E1. Platform settings (CPM aur rate limit) =====
-- Expect: 1 row. cpm_usd default 2.0000, rate_limit_per_minute default 60 (agar tumne badla nahi).
select cpm_usd, rate_limit_per_minute, updated_at from public.ad_platform_settings;


-- ===== E2. Sirf ginti (koi naam/email nahi) =====
select 'admin profiles' as what, count(*) as n from public.profiles where role = 'admin'
union all select 'advertisers active', count(*) from public.advertisers where status = 'active'
union all select 'publishers active', count(*) from public.publishers where status = 'active'
union all select 'publishers pending', count(*) from public.publishers where status = 'pending'
union all select 'campaigns active', count(*) from public.campaigns where status = 'active'
union all select 'creatives approved', count(*) from public.ad_creatives where status = 'approved'
union all select 'api keys active', count(*) from public.publisher_api_keys where status = 'active'
union all select 'ad_serve_log rows', count(*) from public.ad_serve_log
union all select 'campaign_spend_daily rows', count(*) from public.campaign_spend_daily;
-- Expect: admin profiles = jitne admin tumne banaye (1 hona chahiye); baaki sirf jaankari ke liye.


-- ===== F1. Extensions =====
-- Expect: pg_cron dikhe toh safai job schedule ho sakti hai. Na dikhe toh wo job nahi chal raha.
select extname, extversion from pg_extension where extname in ('pg_cron', 'pgcrypto') order by extname;


-- ===== F2. Safai ka job (SIRF agar F1 me pg_cron dikha; warna "relation cron.job does not exist" error aayega, wo theek hai) =====
-- Expect: 1 row, jobname = blisscco-purge-old-logs, schedule = 17 3 * * *, active = true.
select jobname, schedule, active from cron.job where jobname = 'blisscco-purge-old-logs';
