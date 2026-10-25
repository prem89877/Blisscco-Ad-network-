-- =====================================================================
-- BLISSCCO | Day 7 | Part 3 : do-account (A aur B) authorization tests  --  NOT RUN
--
-- !! NOT RUN: ye file maine (assistant) kisi asli Supabase database par CHALAI NAHI hai
--    (mere paas Supabase/Postgres nahi tha). Isliye ye tab tak "pass" nahi maani jaayegi
--    jab tak tum khud run karke neeche likha "Expect" na dekh lo. Agar koi Expect na mile, pehle dekho
--    ki test galat to nahi likha gaya, phir (zaroorat ho toh) code/policy dekho.
--
-- Ye NAYI migration nahi hai: koi table/policy/function nahi badalta. Sirf padhta hai ya begin...rollback me chalta hai.
-- Day 3-6 / 4-2 / 4-4 / 4-5 / 6-1 ke tests ko dohraata nahi; sirf wo jagah bharta hai jo un me nahi thi:
--   B ko A ke creative/advertiser/profile dikhte nahi, B A ke creative/campaign badal nahi sakta,
--   B A ka paused campaign resume nahi kar sakta, B A ka kharch nahi dekh sakta, anon kharch function nahi chala sakta,
--   service-only functions par permission ka poora table, har table/column par kisko kya haq hai, suspended user.
--
-- Pehle: dono test users (janvi01506 = Advertiser A, sanjaytalekar740 = Advertiser B) Supabase me bane hon.
-- Phir neeche ka SETUP block EK baar chalao (day-3-6 ka SETUP chalana zaroori nahi). Sirf test project par chalao.
-- Har block ALAG se chalao (editor saaf karke ek block paste karo). Kuch save nahi hota (rollback / sirf padhna).
-- "ERROR" kuch tests me EXPECTED hai (neeche likha hai).
-- =====================================================================


-- ===================== SETUP (EK baar chalao, safe hai: dobara chalane par duplicate nahi banta) =====================
-- Ye test data banata hai (A aur B ke advertiser, campaign, creative). Baaki G/F blocks ke liye ZAROORI.
-- Expect (last query): 2 rows, A aur B dono ke liye advertiser + campaign + creative dikhe.
update public.advertisers set company_name = 'TEST Advertiser A', status = 'active'
 where profile_id = (select id from auth.users where email = 'janvi01506@gmail.com');
update public.advertisers set company_name = 'TEST Advertiser B', status = 'active'
 where profile_id = (select id from auth.users where email = 'sanjaytalekar740@gmail.com');

insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
select a.id, 'TEST Campaign A', 'beauty', 100, current_date from public.advertisers a
where a.company_name = 'TEST Advertiser A' and not exists (select 1 from public.campaigns c where c.name = 'TEST Campaign A');
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
select a.id, 'TEST Campaign B', 'beauty', 100, current_date from public.advertisers a
where a.company_name = 'TEST Advertiser B' and not exists (select 1 from public.campaigns c where c.name = 'TEST Campaign B');

insert into public.ad_creatives (campaign_id, headline, body, destination_url)
select c.id, 'TEST creative A', 'Test body', 'https://example.com' from public.campaigns c
where c.name = 'TEST Campaign A' and not exists (select 1 from public.ad_creatives x where x.headline = 'TEST creative A');
insert into public.ad_creatives (campaign_id, headline, body, destination_url)
select c.id, 'TEST creative B', 'Test body', 'https://example.com' from public.campaigns c
where c.name = 'TEST Campaign B' and not exists (select 1 from public.ad_creatives x where x.headline = 'TEST creative B');

select u.email, a.company_name, c.name as campaign, c.status as camp_status, x.headline as creative, x.status as creative_status
from auth.users u
left join public.advertisers a on a.profile_id = u.id
left join public.campaigns c on c.advertiser_id = a.id
left join public.ad_creatives x on x.campaign_id = c.id
where u.email in ('janvi01506@gmail.com', 'sanjaytalekar740@gmail.com')
order by u.email;


-- ===================== G1 (forbidden): B ko A ka data dikhta nahi; apna dikhta hai =====================
-- Expect: 1 row. Pehle 4 columns = 0 (A ka campaign, creative, advertiser, profile B ko nahi dikhte), aakhri 2 = 1 (B ka apna).
begin;
select set_config('test.a_id', (select id::text from auth.users where email = 'janvi01506@gmail.com'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'sanjaytalekar740@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select
  (select count(*) from public.campaigns   where name = 'TEST Campaign A')           as a_campaign_seen_by_b,
  (select count(*) from public.ad_creatives where headline = 'TEST creative A')       as a_creative_seen_by_b,
  (select count(*) from public.advertisers where company_name = 'TEST Advertiser A')  as a_advertiser_seen_by_b,
  (select count(*) from public.profiles    where id = current_setting('test.a_id')::uuid) as a_profile_seen_by_b,
  (select count(*) from public.campaigns   where name = 'TEST Campaign B')           as own_campaign,
  (select count(*) from public.ad_creatives where headline = 'TEST creative B')       as own_creative;
rollback;


-- ===================== G2 (forbidden): B, A ka creative / campaign badal nahi sakta =====================
-- Expect: 1 row, teeno columns = 0 (kuch badla nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'sanjaytalekar740@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
with
  u1 as (update public.ad_creatives set headline = 'HACKED' where headline = 'TEST creative A' returning 1),
  u2 as (update public.ad_creatives set status = 'pending_review' where headline = 'TEST creative A' returning 1),
  u3 as (update public.campaigns set name = 'HACKED' where name = 'TEST Campaign A' returning 1)
select (select count(*) from u1) as creative_text_changed,
       (select count(*) from u2) as creative_status_changed,
       (select count(*) from u3) as campaign_changed;
rollback;


-- ===================== G3 (forbidden): B, A ka PAUSED campaign resume (active) nahi kar sakta =====================
-- Expect: 0 rows (UPDATE 0)
begin;
update public.campaigns   set status = 'paused' where name = 'TEST Campaign A';                                -- postgres role: guard lagu nahi
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';   -- resume ki shart pooori
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'sanjaytalekar740@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A' returning id, status;
rollback;

-- G3b (permitted, control): wahi setup, par A khud resume kare. Expect: 1 row, status = active
begin;
update public.campaigns   set status = 'paused' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A' returning id, status;
rollback;


-- ===================== G4 (forbidden): B, A ka kharch (spend) nahi dekh sakta =====================
-- Expect: 0 rows
begin;
select set_config('test.a_camp', (select id::text from public.campaigns where name = 'TEST Campaign A'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'sanjaytalekar740@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select * from public.get_my_campaign_spend(current_setting('test.a_camp')::uuid);
rollback;

-- G4b (permitted, control): A apne campaign ka kharch dekh sakta hai. Expect: 1 row (spent_total 0, spent_today 0, serves_total 0)
begin;
select set_config('test.a_camp', (select id::text from public.campaigns where name = 'TEST Campaign A'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select * from public.get_my_campaign_spend(current_setting('test.a_camp')::uuid);
rollback;


-- ===================== G5 (forbidden): anon (bina login) kharch function nahi chala sakta =====================
-- Expect: ERROR permission denied for function get_my_campaign_spend
begin;
set local role anon;
select * from public.get_my_campaign_spend('00000000-0000-0000-0000-000000000000');
rollback;


-- ===================== G6 (forbidden): A, B ke campaign se creative ko "chura" nahi sakta =====================
-- Expect: ERROR permission denied for table ad_creatives (campaign_id update grant me nahi)
begin;
select set_config('test.b_camp', (select id::text from public.campaigns where name = 'TEST Campaign B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set campaign_id = current_setting('test.b_camp')::uuid where headline = 'TEST creative A';
rollback;


-- ===================== G7 (forbidden): suspended user kuch padh/badal nahi sakta =====================
-- Expect: 1 row, dono = 0
begin;
update public.profiles set status = 'suspended' where id = (select id from auth.users where email = 'janvi01506@gmail.com');
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
with u as (update public.campaigns set name = 'HACKED' where name = 'TEST Campaign A' returning 1)
select (select count(*) from public.campaigns where name = 'TEST Campaign A') as own_campaigns_visible,
       (select count(*) from u) as rows_changed;
rollback;


-- ===================== F1 (live check, sirf padhta hai): functions par kisko EXECUTE ka haq hai =====================
-- Expect: 18 rows, can_execute = false SAB me (anon aur authenticated dono ke liye).
select f.sig, r.role, has_function_privilege(r.role, f.sig, 'EXECUTE') as can_execute
from (values ('anon'), ('authenticated')) as r(role)
cross join (values
  ('public.authorize_publisher_key(text)'),
  ('public.record_ad_serve(text, uuid, text)'),
  ('public.load_ad_candidates(text, date)'),
  ('public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz)'),
  ('public.list_publisher_keys_for(uuid)'),
  ('public.revoke_publisher_key_for(uuid, uuid)'),
  ('public.handle_new_user()'),
  ('public.guard_profile_changes()'),
  ('public.set_updated_at()')
) as f(sig)
order by f.sig, r.role;

-- F1b (live check): admin / spend functions. Expect: anon = false sab; authenticated = true sab
-- (authenticated ke liye true theek hai: har admin function ke andar private.is_admin() check hai, G-tests / day-3-6 TEST 11 se jaancho).
select f.sig, r.role, has_function_privilege(r.role, f.sig, 'EXECUTE') as can_execute
from (values ('anon'), ('authenticated')) as r(role)
cross join (values
  ('public.admin_set_advertiser_status(uuid, text)'),
  ('public.admin_set_publisher_status(uuid, text)'),
  ('public.admin_review_campaign(uuid, text)'),
  ('public.admin_review_creative(uuid, text, text)'),
  ('public.get_my_campaign_spend(uuid)')
) as f(sig)
order by f.sig, r.role;


-- ===================== F2 (live check, sirf padhta hai): table-level haq =====================
-- Expect: sirf 5 rows, sab role = authenticated, privilege = SELECT, tables: ad_creatives, advertisers, campaigns, profiles, publishers.
-- anon ke liye 0 rows. DELETE / TRUNCATE kisi ke liye nahi. Key aur delivery tables par koi row nahi.
select r.role, t.tbl, p.priv
from (values ('anon'), ('authenticated')) as r(role)
cross join (values
  ('public.profiles'), ('public.advertisers'), ('public.publishers'), ('public.campaigns'), ('public.ad_creatives'),
  ('public.ad_categories'), ('public.publisher_api_keys'), ('public.ad_platform_settings'), ('public.ad_serve_log'),
  ('public.creative_serve_daily'), ('public.campaign_spend_daily'), ('public.api_rate_limits')
) as t(tbl)
cross join (values ('SELECT'), ('DELETE'), ('TRUNCATE')) as p(priv)
where has_table_privilege(r.role, t.tbl, p.priv)
order by r.role, t.tbl, p.priv;


-- ===================== F3 (live check, sirf padhta hai): column-level haq (privilege escalation ka rasta) =====================
-- Expect: 0 rows. Agar koi row aaye toh matlab authenticated/anon ko aisa column badalne ka haq hai jo uske paas nahi hona chahiye
-- (jaise profiles.role, advertisers.status, campaigns.advertiser_id, ad_creatives.reviewed_at, key/delivery tables).
select grantee, table_name, column_name, privilege_type
from information_schema.column_privileges
where grantee in ('authenticated', 'anon', 'PUBLIC')
  and table_schema = 'public'
  and privilege_type in ('INSERT', 'UPDATE')
  and (
       (table_name = 'profiles'     and column_name <> 'display_name')
    or (table_name = 'advertisers'  and column_name not in ('profile_id', 'company_name', 'website_url'))
    or (table_name = 'advertisers'  and privilege_type = 'UPDATE' and column_name = 'profile_id')
    or (table_name = 'publishers'   and column_name not in ('profile_id', 'name', 'website_url', 'category'))
    or (table_name = 'publishers'   and privilege_type = 'UPDATE' and column_name = 'profile_id')
    or (table_name = 'campaigns'    and column_name not in ('advertiser_id', 'name', 'description', 'category', 'status', 'total_budget', 'daily_budget', 'start_date', 'end_date'))
    or (table_name = 'campaigns'    and privilege_type = 'UPDATE' and column_name = 'advertiser_id')
    or (table_name = 'campaigns'    and privilege_type = 'INSERT' and column_name = 'status')
    or (table_name = 'ad_creatives' and column_name not in ('campaign_id', 'headline', 'body', 'cta_text', 'destination_url', 'status'))
    or (table_name = 'ad_creatives' and privilege_type = 'INSERT' and column_name = 'status')
    or (table_name = 'ad_creatives' and privilege_type = 'UPDATE' and column_name = 'campaign_id')
    or table_name in ('publisher_api_keys', 'ad_categories', 'ad_platform_settings', 'ad_serve_log', 'creative_serve_daily', 'campaign_spend_daily', 'api_rate_limits')
  );


-- ===================== F4 (live check, sirf padhta hai): har public table par RLS ON =====================
-- Expect: 12 rows, rls_enabled = true sab me. Agar koi false ho toh us table par turant RLS ON karo (alag reviewed migration se).
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
