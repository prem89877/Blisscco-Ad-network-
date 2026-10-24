-- =====================================================================
-- BLISSCCO | Day 3 | Part 6 : SECURITY TEST (do test users ke saath)
-- Ye tests tab tak "pass" nahi maane jaate jab tak tumne khud run karke
-- expected result na dekha ho.
--
-- Kaise chalana hai
--  1. Supabase > Authentication > Users > "Add user" se 5 test users banao
--     (auto confirm ON, koi bhi password):
--        janvi01506@gmail.com       (Advertiser A)
--        sanjaytalekar740@gmail.com       (Advertiser B)
--        delieveryboy09@gmail.com       (Publisher C)
--        muskelon2266@gmail.com       (Publisher D)
--        premtalekar09@gmail.com   (admin; sirf Test 13 ke liye)
--  2. SQL Editor me EK baar SETUP block chalao.
--  3. Phir har TEST block ALAG se chalao (editor saaf karke ek block paste karo).
--     Har test begin...rollback me hai, kuch save nahi hota.
--     "ERROR" aana kai tests me EXPECTED hai.
--  4. Aakhir me CLEANUP block chalao, phir 5 test users Dashboard se delete karo.
--  Sirf test project/test data par chalao, real users par nahi.
--  WARNING: poori file ek saath RUN mat karna. CLEANUP block delete karta hai (sirf exact TEST names).
-- =====================================================================


-- ===================== SETUP (ek baar, postgres role) =====================
-- Expect: 5 rows (profiles), sab role = advertiser (abhi). Day 4 migration ke baad har advertiser ki row auto bhi ban chuki hoti hai.
select u.email, p.role, p.status
from public.profiles p join auth.users u on u.id = p.id
where u.email in ('janvi01506@gmail.com', 'sanjaytalekar740@gmail.com', 'delieveryboy09@gmail.com', 'muskelon2266@gmail.com', 'premtalekar09@gmail.com');

-- Day 4 ke baad advertisers row signup par khud ban jati hai, isliye insert ya update dono chalte hain (on conflict).
insert into public.advertisers (profile_id, company_name, status)
select id, 'TEST Advertiser A', 'active' from auth.users where email = 'janvi01506@gmail.com'
on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active';
insert into public.advertisers (profile_id, company_name, status)
select id, 'TEST Advertiser B', 'active' from auth.users where email = 'sanjaytalekar740@gmail.com'
on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active';

insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
select id, 'TEST Campaign A', 'beauty', 100, current_date from public.advertisers where company_name = 'TEST Advertiser A';
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
select id, 'TEST Campaign B', 'beauty', 100, current_date from public.advertisers where company_name = 'TEST Advertiser B';

insert into public.ad_creatives (campaign_id, headline, body, destination_url)
select id, 'TEST creative A', 'Test body', 'https://example.com' from public.campaigns where name = 'TEST Campaign A';
insert into public.ad_creatives (campaign_id, headline, body, destination_url)
select id, 'TEST creative B', 'Test body', 'https://example.com' from public.campaigns where name = 'TEST Campaign B';

-- Publisher/admin test users: signup par auto-bani advertisers row pehle hatao (warna role change FK se rukta hai)
delete from public.advertisers
where profile_id in (select id from auth.users where email in
  ('delieveryboy09@gmail.com', 'muskelon2266@gmail.com', 'premtalekar09@gmail.com'));

-- Publisher users: role SQL Editor se 'publisher' karo (signup metadata Dashboard "Add user" me nahi hoti)
update public.profiles set role = 'publisher'
where id in (select id from auth.users where email in ('delieveryboy09@gmail.com', 'muskelon2266@gmail.com'));

insert into public.publishers (profile_id, name, status)
select id, 'TEST Publisher C', 'active' from auth.users where email = 'delieveryboy09@gmail.com';
insert into public.publishers (profile_id, name, status)
select id, 'TEST Publisher D', 'active' from auth.users where email = 'muskelon2266@gmail.com';

-- Admin user banao (sirf SQL Editor se hota hai, API se nahi)
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'premtalekar09@gmail.com');


-- ===================== TEST 1: A ko sirf apna data dikhe =====================
-- Expect (sirf A ki rows): profile 1 row, advertiser 'TEST Advertiser A',
-- campaign 'TEST Campaign A', creative 'TEST creative A'. B ka kuch nahi.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'profile' as what, id::text as value from public.profiles
union all select 'advertiser', company_name from public.advertisers
union all select 'campaign', name from public.campaigns
union all select 'creative', headline from public.ad_creatives;
rollback;


-- ===================== TEST 2: A, B ka campaign nahi badal sakta =====================
-- Expect: 0 rows (B ka campaign A ko dikhta hi nahi).
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'HACKED' where name = 'TEST Campaign B' returning id;
rollback;


-- ===================== TEST 3: A khud ko admin nahi bana sakta =====================
-- Expect: ERROR permission denied for table profiles (role column ka haq nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set role = 'admin' where id = auth.uid();
rollback;


-- ===================== TEST 4: A apna display_name badal sakta hai, dusre ka nahi =====================
-- Expect: 1 row (display_name = 'Test A')
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set display_name = 'Test A' where id = auth.uid() returning display_name;
rollback;

-- Expect: 0 rows (dusre ka profile dikhta hi nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set display_name = 'HACKED' where id <> auth.uid() returning id;
rollback;


-- ===================== TEST 5: A khud advertiser status 'active' nahi kar sakta =====================
-- Expect: ERROR permission denied for table advertisers (status column)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.advertisers set status = 'suspended' where profile_id = auth.uid();
rollback;


-- ===================== TEST 6: A campaign khud 'active' (approve) nahi kar sakta =====================
-- Expect: ERROR Campaign status change draft -> active is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;

-- Expect: 1 row, status = pending_review (review ke liye bhejna allowed)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'pending_review' where name = 'TEST Campaign A' returning status;
rollback;


-- ===================== TEST 7: A, B ke advertiser ke naam par campaign nahi bana sakta =====================
-- Expect: ERROR new row violates row-level security policy for table "campaigns"
begin;
select set_config('test.b_adv', (select id::text from public.advertisers where company_name = 'TEST Advertiser B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
values (current_setting('test.b_adv')::uuid, 'x', 'beauty', 10, current_date);
rollback;


-- ===================== TEST 8: A, B ke campaign me creative nahi daal sakta =====================
-- Expect: ERROR new row violates row-level security policy for table "ad_creatives"
begin;
select set_config('test.b_camp', (select id::text from public.campaigns where name = 'TEST Campaign B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.ad_creatives (campaign_id, headline, body, destination_url)
values (current_setting('test.b_camp')::uuid, 'x', 'x', 'https://example.com');
rollback;


-- ===================== TEST 9: Delete kisi ko nahi =====================
-- Expect: ERROR permission denied for table campaigns
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
delete from public.campaigns where name = 'TEST Campaign A';
rollback;


-- ===================== TEST 10: Anonymous (bina login) kuch nahi kar sakta =====================
-- Expect: ERROR permission denied for table campaigns
begin;
set local role anon;
select * from public.campaigns;
rollback;

-- Expect: ERROR permission denied for table campaigns
begin;
set local role anon;
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
values (gen_random_uuid(), 'x', 'beauty', 10, current_date);
rollback;


-- ===================== TEST 11: Non-admin admin function nahi chala sakta =====================
-- Expect: ERROR Admin only
begin;
select set_config('test.b_camp', (select id::text from public.campaigns where name = 'TEST Campaign B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.admin_review_campaign(current_setting('test.b_camp')::uuid, 'approve');
rollback;


-- ===================== TEST 12: Creative khud 'approved' nahi kar sakta =====================
-- Expect: ERROR Creative status change draft -> approved is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set status = 'approved' where headline = 'TEST creative A';
rollback;

-- Expect: ERROR permission denied for table ad_creatives (review column)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set reviewed_at = now() where headline = 'TEST creative A';
rollback;


-- ===================== TEST 13: Admin sab dekh sakta hai aur approve kar sakta hai =====================
-- Expect (last query): TEST Campaign A = active, TEST Campaign B = draft;
-- creative A = approved. Admin ko dono advertisers ka data dikhta hai.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set status = 'pending_review' where headline = 'TEST creative A';
update public.campaigns    set status = 'pending_review' where name = 'TEST Campaign A';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'premtalekar09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.admin_review_creative((select id from public.ad_creatives where headline = 'TEST creative A'), 'approve');
select public.admin_review_campaign((select id from public.campaigns where name = 'TEST Campaign A'), 'approve');
select 'campaign' as what, name as item, status from public.campaigns where name like 'TEST Campaign%'
union all select 'creative', headline, status from public.ad_creatives where headline like 'TEST creative%';
rollback;


-- ===================== TEST 14: Approved creative edit karne par dobara review =====================
-- Expect: 1 row, status = draft (approval wapas hat gaya)
begin;
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set destination_url = 'https://example.com/changed' where headline = 'TEST creative A' returning status;
rollback;


-- ===================== TEST 15: Publisher C ko sirf apna data dikhe =====================
-- Expect: profile 1 row, publisher 'TEST Publisher C'. Advertiser/campaign/creative ki 0 rows.
-- (TEST Publisher D kahin nahi dikhna chahiye.)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'profile' as what, id::text as value from public.profiles
union all select 'publisher', name from public.publishers
union all select 'advertiser', company_name from public.advertisers
union all select 'campaign', name from public.campaigns
union all select 'creative', headline from public.ad_creatives;
rollback;


-- ===================== TEST 16: Publisher C, D ka publisher row nahi badal sakta =====================
-- Expect: 0 rows
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.publishers set name = 'HACKED' where name = 'TEST Publisher D' returning id;
rollback;

-- Expect: 1 row (apna naam badal sakta hai)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.publishers set name = 'TEST Publisher C renamed' where name = 'TEST Publisher C' returning name;
rollback;


-- ===================== TEST 17: Publisher khud status 'active/suspended' nahi kar sakta =====================
-- Expect: ERROR permission denied for table publishers (status column)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.publishers set status = 'suspended' where name = 'TEST Publisher C';
rollback;


-- ===================== TEST 18: Publisher C, D ke profile par publisher row nahi bana sakta =====================
-- Expect: ERROR new row violates row-level security policy for table "publishers"
begin;
select set_config('test.d_profile', (select id::text from auth.users where email = 'muskelon2266@gmail.com'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.publishers (profile_id, name) values (current_setting('test.d_profile')::uuid, 'x');
rollback;


-- ===================== TEST 19: Role mix nahi hota (publisher advertiser nahi ban sakta, ulta bhi) =====================
-- Expect: ERROR ... violates foreign key constraint "advertisers_profile_fk"
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.advertisers (profile_id, company_name) values (auth.uid(), 'x');
rollback;

-- Expect: ERROR ... violates foreign key constraint "publishers_profile_fk" (A ka role advertiser hai)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.publishers (profile_id, name) values (auth.uid(), 'x');
rollback;


-- ===================== TEST 20: Privileged role/status badalne ki koshish =====================
-- Expect: ERROR permission denied for table profiles (publisher khud admin banne ki koshish)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set role = 'admin' where id = auth.uid();
rollback;

-- Expect: ERROR permission denied for table profiles (suspended hone ke baad khud ko wapas active na kar sake)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set status = 'active' where id = auth.uid();
rollback;

-- Expect: ERROR permission denied for table profiles (naya admin profile insert karna)
begin;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.profiles (id, role) values (gen_random_uuid(), 'admin');
rollback;

-- Expect: ERROR Admin only (publisher admin function nahi chala sakta)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.admin_set_publisher_status((select id from public.publishers where name = 'TEST Publisher D'), 'suspended');
rollback;


-- ===================== TEST 21: Anonymous private function/schema nahi chala sakta =====================
-- Expect: ERROR permission denied for function admin_review_campaign
begin;
set local role anon;
select public.admin_review_campaign(gen_random_uuid(), 'approve');
rollback;

-- Expect: ERROR permission denied for schema private
begin;
set local role anon;
select private.is_admin();
rollback;


-- ===================== STRUCTURE CHECKS (postgres role, sirf padhta hai) =====================
-- S1. RLS: Expect 5 rows, rls_on = true sab par
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
order by c.relname;

-- S2. Expect: 0 rows (public me koi table bina RLS ke nahi)
select c.relname as table_without_rls
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;

-- S3. Privileges: Expect anon_any = false sab par; auth_delete = false sab par
select t.name,
       has_table_privilege('anon', 'public.' || t.name, 'select,insert,update,delete,truncate,references,trigger') as anon_any,
       has_table_privilege('authenticated', 'public.' || t.name, 'delete,truncate') as auth_delete_or_truncate
from (values ('profiles'), ('advertisers'), ('publishers'), ('campaigns'), ('ad_creatives')) as t(name);

-- S4. Anon ke liye executable functions. Expect: sirf public.health_ping() (agar Part 7 chalaya)
select p.oid::regprocedure as anon_can_execute
from pg_proc p
where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and has_function_privilege('anon', p.oid, 'execute');

-- S5. Foreign keys + delete rule. Expect: sab 'ON DELETE RESTRICT' (profiles->auth.users cascade chhodkar,
--     ad_creatives.reviewed_by SET NULL)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by 1, 2;

-- S6. Indexes
select tablename, indexname from pg_indexes where schemaname = 'public' order by 1, 2;


-- ===================== CLEANUP (postgres role) =====================
delete from public.ad_creatives where headline in ('TEST creative A', 'TEST creative B');
delete from public.campaigns    where name in ('TEST Campaign A', 'TEST Campaign B');
delete from public.advertisers  where company_name in ('TEST Advertiser A', 'TEST Advertiser B');
delete from public.publishers   where name in ('TEST Publisher C', 'TEST Publisher D');
-- Phir Authentication > Users se 5 test users delete karo.
