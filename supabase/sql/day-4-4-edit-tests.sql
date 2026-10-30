-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 4 | Part 4 : Edit Campaign ke tests (SQL Editor)
--
-- Pehle: day-4-1 aur day-4-3 chale hon, aur day-3-6 ka SETUP block chala ho
-- (users janvi01506 (Advertiser A) / sanjaytalekar740 (Advertiser B), 'TEST Advertiser A/B', 'TEST Campaign A/B').
-- Har TEST block ALAG se chalao. Har block begin...rollback me hai, kuch save nahi hota.
-- "ERROR" kai tests me EXPECTED hai (neeche likha hai). Sirf test project par chalao.
-- Maan ke chalte hain ki 'TEST Campaign A/B' draft status me hain (day-3-6 SETUP).
--
-- ERROR: 22P02 invalid input syntax for type uuid: ""  aaye toh matlab TEST Advertiser B /
-- TEST Campaign B row nahi mili (SETUP chala nahi, ya CLEANUP chal chuka hai). Pehle neeche wali
-- CHECK query chalao; B ki rows na hon toh day-3-6 ke 2 test users (Dashboard se) banao aur
-- uska SETUP block chalao. (E2 aur E3 ab saaf message dete hain: "SETUP missing ...")
--
-- CHECK (Expect: 2 rows, A aur B, dono me advertiser + campaign dikhe, status draft/active)
--   select u.email, a.company_name, a.status as adv_status, c.name as campaign, c.status as camp_status
--   from auth.users u
--   left join public.advertisers a on a.profile_id = u.id
--   left join public.campaigns c on c.advertiser_id = a.id
--   where u.email in ('janvi01506@gmail.com', 'sanjaytalekar740@gmail.com');
-- =====================================================================


-- ===================== E1: A apne draft campaign ke saare fields edit kar sakta hai =====================
-- Expect: 1 row, naya naam/description/category/budget/dates
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns
   set name = 'TEST A edited', description = 'Edited description', category = 'finance',
       total_budget = 900.25, daily_budget = 30, start_date = current_date + 1, end_date = current_date + 20
 where name = 'TEST Campaign A'
returning name, description, category, total_budget, daily_budget, start_date, end_date;
rollback;


-- ===================== E2: A, B ka campaign ID se bhi edit nahi kar sakta =====================
-- Expect: 0 rows (UPDATE 0)
begin;
select set_config('test.b_campaign', (select c.id::text from public.campaigns c where c.name = 'TEST Campaign B'), true);
do $$ begin
  if nullif(current_setting('test.b_campaign', true), '') is null then
    raise exception 'SETUP missing: TEST Campaign B not found. Run the day-3-6 SETUP block first.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'HACKED', description = 'HACKED'
 where id = current_setting('test.b_campaign')::uuid
returning id;
rollback;


-- ===================== E3: A campaign ko B ke advertiser par transfer nahi kar sakta =====================
-- Expect: ERROR permission denied for table campaigns (advertiser_id update grant me nahi)
begin;
select set_config('test.b_adv', (select a.id::text from public.advertisers a where a.company_name = 'TEST Advertiser B'), true);
do $$ begin
  if nullif(current_setting('test.b_adv', true), '') is null then
    raise exception 'SETUP missing: TEST Advertiser B not found. Run the day-3-6 SETUP block first.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set advertiser_id = current_setting('test.b_adv')::uuid where name = 'TEST Campaign A';
rollback;


-- ===================== E4: currency aur id badli nahi ja sakti =====================
-- Expect: ERROR permission denied for table campaigns
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set currency_code = 'INR' where name = 'TEST Campaign A';
rollback;


-- ===================== E5: status se bypass nahi: draft -> active seedha nahi =====================
-- Expect: ERROR Campaign status change draft -> active is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;


-- ===================== E6: pending_review me naam edit nahi hota =====================
-- Expect: ERROR Campaign is locked while status is pending_review
begin;
update public.campaigns set status = 'pending_review' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'TEST locked rename' where name = 'TEST Campaign A';
rollback;


-- ===================== E7: pending_review me description bhi lock (day-4-3 ka guard) =====================
-- Expect: ERROR Campaign is locked while status is pending_review
begin;
update public.campaigns set status = 'pending_review' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set description = 'locked change' where name = 'TEST Campaign A';
rollback;


-- ===================== E8: galat values DB bhi rokta hai (server validation ke peeche doosri deewar) =====================
-- E8a Expect: ERROR violates check constraint "campaigns_total_budget_check"
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set total_budget = -5 where name = 'TEST Campaign A';
rollback;

-- E8b Expect: ERROR violates check constraint "campaigns_daily_budget_check" (daily > total)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set total_budget = 100, daily_budget = 500 where name = 'TEST Campaign A';
rollback;

-- E8c Expect: ERROR violates check constraint "campaigns_schedule_check" (end < start)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set start_date = current_date + 10, end_date = current_date + 1 where name = 'TEST Campaign A';
rollback;

-- E8d Expect: ERROR violates check constraint "campaigns_description_check" (khali/1000+ chars)
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set description = repeat('x', 1001) where name = 'TEST Campaign A';
rollback;


-- ===================== E9: suspended advertiser edit nahi kar sakta =====================
-- Expect: 0 rows (UPDATE 0)
begin;
update public.advertisers set status = 'suspended' where company_name = 'TEST Advertiser A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set name = 'TEST suspended edit' where name = 'TEST Campaign A' returning id;
rollback;


-- ===================== E10: bina login (anon) edit nahi kar sakta =====================
-- Expect: ERROR permission denied for table campaigns
begin;
set local role anon;
update public.campaigns set name = 'HACKED' where name = 'TEST Campaign A';
rollback;

-- Cleanup ki zaroorat nahi (sab rollback).
