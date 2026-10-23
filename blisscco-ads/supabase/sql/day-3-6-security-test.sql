-- =====================================================================
-- BLISSCCO | Day 3 | Part 6 : SECURITY TEST (do test users ke saath)
-- Ye tests tab tak "pass" nahi maane jaate jab tak tumne khud run karke
-- expected result na dekha ho.
--
-- Kaise chalana hai
--  1. Supabase > Authentication > Users > "Add user" se 3 test users banao
--     (auto confirm ON, koi bhi password):
--        blisscco-test-a@example.com       (Advertiser A)
--        blisscco-test-b@example.com       (Advertiser B)
--        blisscco-test-admin@example.com   (admin; sirf Test 15 ke liye)
--  2. SQL Editor me EK baar SETUP block chalao.
--  3. Phir har TEST block ALAG se chalao (editor saaf karke ek block paste karo).
--     Har test begin...rollback me hai, kuch save nahi hota.
--     "ERROR" aana kai tests me EXPECTED hai.
--  4. Aakhir me CLEANUP block chalao, phir 3 test users Dashboard se delete karo.
--  Sirf test project/test data par chalao, real users par nahi.
-- =====================================================================


-- ===================== SETUP (ek baar, postgres role) =====================
-- Expect: 3 rows (profiles) role = advertiser, advertiser, advertiser
select u.email, p.role, p.status
from public.profiles p join auth.users u on u.id = p.id
where u.email like 'blisscco-test-%';

insert into public.advertisers (profile_id, company_name, status)
select id, 'TEST Advertiser A', 'active' from auth.users where email = 'blisscco-test-a@example.com';
insert into public.advertisers (profile_id, company_name, status)
select id, 'TEST Advertiser B', 'active' from auth.users where email = 'blisscco-test-b@example.com';

insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
select id, 'TEST Campaign A', 'beauty', 100, current_date from public.advertisers where company_name = 'TEST Advertiser A';
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
select id, 'TEST Campaign B', 'beauty', 100, current_date from public.advertisers where company_name = 'TEST Advertiser B';

insert into public.ad_creatives (campaign_id, headline, body, destination_url)
select id, 'TEST creative A', 'Test body', 'https://example.com' from public.campaigns where name = 'TEST Campaign A';
insert into public.ad_creatives (campaign_id, headline, body, destination_url)
select id, 'TEST creative B', 'Test body', 'https://example.com' from public.campaigns where name = 'TEST Campaign B';

-- Admin user banao (sirf SQL Editor se hota hai, API se nahi)
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'blisscco-test-admin@example.com');


-- ===================== TEST 1: A ko sirf apna data dikhe =====================
-- Expect (sirf A ki rows): profile 1 row, advertiser 'TEST Advertiser A',
-- campaign 'TEST Campaign A', creative 'TEST creative A'. B ka kuch nahi.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'profile' as what, id::text as value from public.profiles
union all select 'advertiser', company_name from public.advertisers
union all select 'campaign', name from public.campaigns
union all select 'creative', headline from public.ad_creatives;
rollback;


-- ===================== TEST 2: A, B ka campaign nahi badal sakta =====================
-- Expect: 0 rows (B ka campaign A ko dikhta hi nahi).
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'HACKED' where name = 'TEST Campaign B' returning id;
rollback;


-- ===================== TEST 3: A khud ko admin nahi bana sakta =====================
-- Expect: ERROR permission denied for table profiles (role column ka haq nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set role = 'admin' where id = auth.uid();
rollback;


-- ===================== TEST 4: A apna display_name badal sakta hai, dusre ka nahi =====================
-- Expect: 1 row (display_name = 'Test A')
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set display_name = 'Test A' where id = auth.uid() returning display_name;
rollback;

-- Expect: 0 rows (dusre ka profile dikhta hi nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.profiles set display_name = 'HACKED' where id <> auth.uid() returning id;
rollback;


-- ===================== TEST 5: A khud advertiser status 'active' nahi kar sakta =====================
-- Expect: ERROR permission denied for table advertisers (status column)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.advertisers set status = 'suspended' where profile_id = auth.uid();
rollback;


-- ===================== TEST 6: A campaign khud 'active' (approve) nahi kar sakta =====================
-- Expect: ERROR Campaign status change draft -> active is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;

-- Expect: 1 row, status = pending_review (review ke liye bhejna allowed)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'pending_review' where name = 'TEST Campaign A' returning status;
rollback;


-- ===================== TEST 7: A, B ke advertiser ke naam par campaign nahi bana sakta =====================
-- Expect: ERROR new row violates row-level security policy for table "campaigns"
begin;
select set_config('test.b_adv', (select id::text from public.advertisers where company_name = 'TEST Advertiser B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
values (current_setting('test.b_adv')::uuid, 'x', 'beauty', 10, current_date);
rollback;


-- ===================== TEST 8: A, B ke campaign me creative nahi daal sakta =====================
-- Expect: ERROR new row violates row-level security policy for table "ad_creatives"
begin;
select set_config('test.b_camp', (select id::text from public.campaigns where name = 'TEST Campaign B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.ad_creatives (campaign_id, headline, body, destination_url)
values (current_setting('test.b_camp')::uuid, 'x', 'x', 'https://example.com');
rollback;


-- ===================== TEST 9: Delete kisi ko nahi =====================
-- Expect: ERROR permission denied for table campaigns
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
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
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.admin_review_campaign(current_setting('test.b_camp')::uuid, 'approve');
rollback;


-- ===================== TEST 12: Creative khud 'approved' nahi kar sakta =====================
-- Expect: ERROR Creative status change draft -> approved is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set status = 'approved' where headline = 'TEST creative A';
rollback;

-- Expect: ERROR permission denied for table ad_creatives (review column)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set reviewed_at = now() where headline = 'TEST creative A';
rollback;


-- ===================== TEST 13: Admin sab dekh sakta hai aur approve kar sakta hai =====================
-- Expect (last query): TEST Campaign A = active, TEST Campaign B = draft;
-- creative A = approved. Admin ko dono advertisers ka data dikhta hai.
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set status = 'pending_review' where headline = 'TEST creative A';
update public.campaigns    set status = 'pending_review' where name = 'TEST Campaign A';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-admin@example.com'), 'role', 'authenticated')::text, true);
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
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'blisscco-test-a@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.ad_creatives set destination_url = 'https://example.com/changed' where headline = 'TEST creative A' returning status;
rollback;


-- ===================== CLEANUP (postgres role) =====================
delete from public.ad_creatives where headline like 'TEST creative%';
delete from public.campaigns    where name like 'TEST Campaign%';
delete from public.advertisers  where company_name like 'TEST Advertiser%';
-- Phir Authentication > Users se 3 test users delete karo.
