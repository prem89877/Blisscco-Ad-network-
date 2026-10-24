-- =====================================================================
-- BLISSCCO | Day 4 | Part 2 : campaign management ke tests (SQL Editor)
--
-- Pehle: day-4-1-campaign-guards.sql chala ho, aur day-3-6 ka SETUP block chala ho
-- (users janvi01506 (Advertiser A) / sanjaytalekar740 (Advertiser B), 'TEST Advertiser A/B', 'TEST Campaign A/B', 'TEST creative A/B').
-- Har TEST block ALAG se chalao. Har block begin...rollback me hai, kuch save nahi hota.
-- "ERROR" kai tests me EXPECTED hai (neeche likha hai).
-- Sirf test project/test data par chalao.
-- =====================================================================


-- ===================== TEST 1: signup par advertiser row active hai =====================
-- Expect: 2 rows (A aur B), status = active
select u.email, a.company_name, a.status
from auth.users u join public.advertisers a on a.profile_id = u.id
where u.email in ('janvi01506@gmail.com', 'sanjaytalekar740@gmail.com');


-- ===================== TEST 2: A apna draft campaign bana sakta hai =====================
-- Expect: 1 row, status = draft
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.campaigns (advertiser_id, name, category, total_budget, daily_budget, start_date, end_date)
values ((select private.my_advertiser_id()), 'TEST new draft', 'education', 250.50, 25, current_date, current_date + 30)
returning name, status, total_budget;
rollback;


-- ===================== TEST 3: A, B ke advertiser_id par campaign nahi bana sakta =====================
-- Expect: ERROR new row violates row-level security policy for table "campaigns"
begin;
select set_config('test.b_adv', (select a.id::text from public.advertisers a where a.company_name = 'TEST Advertiser B'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
values (current_setting('test.b_adv')::uuid, 'TEST steal', 'education', 10, current_date);
rollback;


-- ===================== TEST 4: A seedha status 'active' ke saath insert nahi kar sakta =====================
-- Expect: ERROR permission denied for table campaigns (status column insert grant me nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.campaigns (advertiser_id, name, category, status, total_budget, start_date)
values ((select private.my_advertiser_id()), 'TEST sneaky', 'education', 'active', 10, current_date);
rollback;


-- ===================== TEST 5: A ko sirf apne campaigns dikhte hain =====================
-- Expect: sirf 'TEST Campaign A' (B ka nahi)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select name from public.campaigns;
rollback;


-- ===================== TEST 6: A, B ka campaign edit nahi kar sakta =====================
-- Expect: 0 rows
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'HACKED' where name = 'TEST Campaign B' returning id;
rollback;


-- ===================== TEST 7: resume bina approved creative ke nahi hota =====================
-- Expect: ERROR Campaign needs an approved creative before it can resume
--         HINT: resume_needs_approved_creative
begin;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;


-- ===================== TEST 8: approved creative ke saath resume ho jata hai =====================
-- Expect: 1 row, status = active
begin;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A' returning name, status;
rollback;


-- ===================== TEST 9: end_date guzar chuki ho toh resume nahi hota =====================
-- Expect: ERROR Campaign end date has passed
--         HINT: resume_campaign_ended
begin;
update public.campaigns set status = 'paused', start_date = current_date - 10, end_date = current_date - 1 where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;


-- ===================== TEST 10: active campaign pause ho jata hai =====================
-- Expect: 1 row, status = paused
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A' returning name, status;
rollback;


-- ===================== TEST 11: active campaign ka budget/naam badal sakta hai ("Full" edit) =====================
-- Expect: 1 row, naya naam aur budget
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'TEST Campaign A edited', total_budget = 500 where name = 'TEST Campaign A' returning name, total_budget;
rollback;


-- ===================== TEST 12: active campaign ki category nahi badalti =====================
-- Expect: ERROR Category can only be changed while draft or rejected
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set category = 'finance' where name = 'TEST Campaign A';
rollback;


-- ===================== TEST 13: 50 campaign ki limit =====================
-- Expect: ERROR Campaign limit reached
--         HINT: campaign_limit_reached
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  adv uuid := (select private.my_advertiser_id());
  i   int;
begin
  for i in 1..51 loop
    insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
    values (adv, 'TEST cap ' || i, 'education', 10, current_date);
  end loop;
end $$;
rollback;

-- Cleanup ki zaroorat nahi (sab rollback). Test data hatane ke liye day-3-6 ka CLEANUP block chalao.
