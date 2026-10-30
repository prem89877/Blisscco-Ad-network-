-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 4 | Part 5 : Pause / Resume ke tests (SQL Editor)
--
-- Pehle: day-4-1 chali ho, aur day-3-6 ka SETUP block chala ho
-- (users janvi01506 (Advertiser A) / sanjaytalekar740 (Advertiser B), 'TEST Advertiser A/B', 'TEST Campaign A/B', 'TEST creative A').
-- Har TEST block ALAG se chalao. Har block begin...rollback me hai, kuch save nahi hota.
-- "ERROR" kai tests me EXPECTED hai. Sirf test project par chalao.
-- Resume ke mukhya tests day-4-2 ke Test 7, 8, 9, 10 me pehle se hain
-- (7: bina approved creative, 8: approved creative ke saath, 9: end_date guzri, 10: pause).
-- =====================================================================


-- ===================== R1 (permitted): A apna active campaign pause kar sakta hai =====================
-- Expect: 1 row, status = paused
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A' returning name, status;
rollback;


-- ===================== R2 (permitted): pause se campaign delete nahi hota =====================
-- Expect: 1 row (count = 1), status = paused. Creative bhi bacha rehta hai (count = 1)
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
select (select count(*) from public.campaigns where name = 'TEST Campaign A') as campaigns_left,
       (select count(*) from public.ad_creatives where headline = 'TEST creative A') as creatives_left;
rollback;


-- ===================== R3 (forbidden): B, A ka active campaign pause nahi kar sakta =====================
-- Expect: 0 rows (UPDATE 0)
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('test.a_campaign', (select c.id::text from public.campaigns c where c.name = 'TEST Campaign A'), true);
do $$ begin
  if nullif(current_setting('test.a_campaign', true), '') is null then
    raise exception 'SETUP missing: TEST Campaign A not found. Run the day-3-6 SETUP block first.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'sanjaytalekar740@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'paused' where id = current_setting('test.a_campaign')::uuid returning id;
rollback;


-- ===================== R4 (forbidden): draft campaign seedha pause nahi hota =====================
-- Expect: ERROR Campaign status change draft -> paused is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
rollback;


-- ===================== R5 (forbidden): draft campaign seedha active nahi hota =====================
-- Expect: ERROR Campaign status change draft -> active is not allowed
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;


-- ===================== R6 (forbidden): completed campaign resume (active) nahi hota =====================
-- Expect: ERROR Campaign status change completed -> active is not allowed
begin;
update public.campaigns set status = 'completed' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
rollback;


-- ===================== R7 (forbidden): active se seedha archived nahi (pehle pause) =====================
-- Expect: ERROR Campaign status change active -> archived is not allowed
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'archived' where name = 'TEST Campaign A';
rollback;


-- ===================== R8 (forbidden): suspended advertiser pause nahi kar sakta =====================
-- Expect: 0 rows (UPDATE 0)
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
update public.advertisers set status = 'suspended' where company_name = 'TEST Advertiser A';
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A' returning id;
rollback;


-- ===================== R9 (forbidden): bina login (anon) pause nahi kar sakta =====================
-- Expect: ERROR permission denied for table campaigns
begin;
set local role anon;
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
rollback;

-- Cleanup ki zaroorat nahi (sab rollback).
