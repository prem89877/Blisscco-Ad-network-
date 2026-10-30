-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 9 | Part 3 : spend limit + retry-safety ke SQL tests (HAR BLOCK ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI: sandbox me Postgres nahi hai. Jab tak tum khud chalakar expected
--  result na dekh lo, inhe "pass" mat maanna.)
--
-- Pehle: day-9-5-atomic-spend-idempotency.sql chal chuki ho, aur day-3-6 ka SETUP block chala ho
-- (TEST Publisher C, TEST Campaign A, TEST creative A). Sirf TEST project par chalao.
-- Har TEST block ALAG se chalao (editor saaf karke ek block paste karo). SQL Editor sirf AAKHRI select dikhata hai.
-- Default CPM 2.00 maanke: ek serve = 0.002 USD. (Check: select cpm_usd from public.ad_platform_settings;)
-- "ERROR" kuch tests me EXPECTED hai (wahi pass hai).
-- =====================================================================


-- ===================== T1 : TOTAL limit =====================
-- total budget 0.01 => sirf 5 serve (5 x 0.002). 6th aur 7th rejected.
-- Expect: outcomes = ok,ok,ok,ok,ok,rejected,rejected | spent_total = 0.0100 | log_rows = 5
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set daily_budget = null, total_budget = 0.01 where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r', (select string_agg(public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming') ->> 'outcome', ',' order by g) from generate_series(1, 7) g), true);
reset role;
select current_setting('test.r') as outcomes,
       (select sum(spent) from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A')) as spent_total,
       (select count(*) from public.ad_serve_log where creative_id = current_setting('test.cid')::uuid and served_at >= now()) as log_rows;
rollback;


-- ===================== T2 : DAILY limit =====================
-- total 100, daily 0.01 => aaj sirf 5 serve. Baaki rejected.
-- Expect: outcomes = ok,ok,ok,ok,ok,rejected,rejected | spent_today = 0.0100
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set total_budget = 100, daily_budget = 0.01 where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r', (select string_agg(public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming') ->> 'outcome', ',' order by g) from generate_series(1, 7) g), true);
reset role;
select current_setting('test.r') as outcomes,
       (select spent from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A') and day = (now() at time zone 'utc')::date) as spent_today;
rollback;


-- ===================== T3 : retry (wahi Idempotency-Key) => DOBARA charge nahi =====================
-- Expect: first_outcome = ok | first_replayed = (null) | second_outcome = ok | second_replayed = true | same_ad = true
--         spent_total = 0.0020 | log_rows = 1 | key_rows = 1
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set total_budget = 100, daily_budget = 50 where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r1', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0001')::text, true);
select set_config('test.r2', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0001')::text, true);
reset role;
select current_setting('test.r1')::jsonb ->> 'outcome'  as first_outcome,
       current_setting('test.r1')::jsonb ->> 'replayed' as first_replayed,
       current_setting('test.r2')::jsonb ->> 'outcome'  as second_outcome,
       current_setting('test.r2')::jsonb ->> 'replayed' as second_replayed,
       (current_setting('test.r2')::jsonb -> 'ad' ->> 'id') = current_setting('test.cid') as same_ad,
       (select sum(spent) from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A')) as spent_total,
       (select count(*) from public.ad_serve_log where creative_id = current_setting('test.cid')::uuid and served_at >= now()) as log_rows,
       (select count(*) from public.ad_serve_requests where creative_id = current_setting('test.cid')::uuid) as key_rows;
rollback;


-- ===================== T4 : failed request par kharch nahi + key "jali" nahi =====================
-- Campaign paused => rejected. Kuch likha nahi (spend 0, log 0, key 0). Phir campaign active karke WAHI key => ok (key burn nahi hui).
-- Expect: rejected_outcome = rejected | spent_after_reject = 0 | key_rows_after_reject = 0 | retry_outcome = ok | spent_after_retry = 0.0020
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set total_budget = 100, daily_budget = 50 where name = 'TEST Campaign A';
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r1', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0002')::text, true);
reset role;
select set_config('test.spent1', coalesce((select sum(spent) from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A')), 0)::text, true);
select set_config('test.keys1', (select count(*) from public.ad_serve_requests where creative_id = current_setting('test.cid')::uuid)::text, true);
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r2', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0002')::text, true);
reset role;
select current_setting('test.r1')::jsonb ->> 'outcome' as rejected_outcome,
       current_setting('test.spent1') as spent_after_reject,
       current_setting('test.keys1') as key_rows_after_reject,
       current_setting('test.r2')::jsonb ->> 'outcome' as retry_outcome,
       (select sum(spent) from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A')) as spent_after_retry;
rollback;


-- ===================== T5 : budget khatam, phir bhi purani key ka retry => wahi ad =====================
-- total 0.002 => pehli serve ok (budget poora), nayi key rejected, par pehli key ka retry ok + replayed.
-- Expect: a = ok | b_new_key = rejected | c_retry_first_key = ok | c_replayed = true | spent_total = 0.0020
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set daily_budget = null, total_budget = 0.01 where name = 'TEST Campaign A';
-- 0.01 me se 0.008 pehle se kharch maan lo, taaki sirf ek serve (0.002) bache
insert into public.campaign_spend_daily (campaign_id, day, spent)
values ((select id from public.campaigns where name = 'TEST Campaign A'), (now() at time zone 'utc')::date - 1, 0.008);
set local role service_role;
select set_config('test.ra', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0003')::text, true);
select set_config('test.rb', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0004')::text, true);
select set_config('test.rc', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0003')::text, true);
reset role;
select current_setting('test.ra')::jsonb ->> 'outcome'  as a,
       current_setting('test.rb')::jsonb ->> 'outcome'  as b_new_key,
       current_setting('test.rc')::jsonb ->> 'outcome'  as c_retry_first_key,
       current_setting('test.rc')::jsonb ->> 'replayed' as c_replayed,
       (select sum(spent) from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A')) as spent_total;
rollback;


-- ===================== T6 : aakhri deewar (trigger): limit paar karne wali spend likhi hi nahi ja sakti =====================
-- Expect: over_total_sqlstate = 23514 | over_daily_sqlstate = 23514 | within_limit = ok
begin;
update public.campaigns set status = 'active' where name = 'TEST Campaign A';
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set total_budget = 10, daily_budget = 5 where name = 'TEST Campaign A';
do $$
declare
  camp uuid := (select id from public.campaigns where name = 'TEST Campaign A');
  r1 text; r2 text; r3 text;
begin
  begin
    insert into public.campaign_spend_daily (campaign_id, day, spent) values (camp, (now() at time zone 'utc')::date, 10.5);
    r1 := 'no error';
  exception when others then r1 := sqlstate; end;

  begin
    insert into public.campaign_spend_daily (campaign_id, day, spent) values (camp, (now() at time zone 'utc')::date, 5.5);
    r2 := 'no error';
  exception when others then r2 := sqlstate; end;

  begin
    insert into public.campaign_spend_daily (campaign_id, day, spent) values (camp, (now() at time zone 'utc')::date, 4.9);
    r3 := 'ok';
  exception when others then r3 := sqlstate; end;

  perform set_config('test.r', json_build_object('over_total_sqlstate', r1, 'over_daily_sqlstate', r2, 'within_limit', r3)::text, true);
end $$;
select current_setting('test.r')::jsonb as result;
rollback;


-- ===================== T7 : galat Idempotency-Key / galat key hash =====================
-- Expect: short_key = rejected | bad_hash = unauthorized | spent_total = 0 | key_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
set local role service_role;
select set_config('test.r1', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming', 'short')::text, true);
select set_config('test.r2', public.record_ad_serve(repeat('0', 64), current_setting('test.cid')::uuid, 'gaming', 'retry-test-0005')::text, true);
reset role;
select current_setting('test.r1')::jsonb ->> 'outcome' as short_key,
       current_setting('test.r2')::jsonb ->> 'outcome' as bad_hash,
       coalesce((select sum(spent) from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A')), 0) as spent_total,
       (select count(*) from public.ad_serve_requests where creative_id = current_setting('test.cid')::uuid) as key_rows;
rollback;


-- ===================== T8 : anon / authenticated nahi chala sakte =====================
-- Expect: ERROR permission denied for function record_ad_serve (aur find_idempotent_serve). Wahi pass hai.
begin;
set local role authenticated;
select public.record_ad_serve(repeat('0', 64), gen_random_uuid(), 'gaming', 'retry-test-0006');
rollback;

begin;
set local role anon;
select public.find_idempotent_serve(repeat('0', 64), 'retry-test-0006');
rollback;


-- ===================== T9 (MANUAL, 2 SQL Editor tabs): do request ek saath, budget me sirf ek serve ki jagah =====================
-- Ye test ek tab me nahi ho sakta (concurrency chahiye). Sirf TEST project par.
-- Setup (tab 1, chalao aur COMMIT hone do; baad me safai niche):
--   update public.campaigns set category='gaming', status='active', start_date=current_date-5, end_date=null, daily_budget=null where name='TEST Campaign A';
--   update public.ad_creatives set status='approved', reviewed_at=now() where headline='TEST creative A';
--   delete from public.campaign_spend_daily where campaign_id=(select id from public.campaigns where name='TEST Campaign A');
--   update public.campaigns set total_budget=0.01 where name='TEST Campaign A';
--   insert into public.campaign_spend_daily (campaign_id, day, spent) values ((select id from public.campaigns where name='TEST Campaign A'), current_date - 1, 0.008);   -- sirf 1 serve (0.002) bacha
--   select private.issue_publisher_key((select id from public.publishers where name='TEST Publisher C'));  -- key copy karo, uska sha256 hex = HASH
-- Tab 1: begin; set local role service_role; select public.record_ad_serve('<HASH>', '<creative id>', 'gaming');   -- ok   (COMMIT mat karo abhi)
-- Tab 2: begin; set local role service_role; select public.record_ad_serve('<HASH>', '<creative id>', 'gaming');   -- ATK jayega (campaign row lock)
-- Tab 1: commit;
-- Tab 2: ab jawab aayega: outcome = rejected   (budget overspend nahi hua). Phir tab 2: commit;
-- Check: select sum(spent) from public.campaign_spend_daily where campaign_id=(select id from public.campaigns where name='TEST Campaign A');  -- Expect 0.0100 (0.0120 nahi)
-- Safai: delete from public.campaign_spend_daily where campaign_id=(select id from public.campaigns where name='TEST Campaign A');
--        update public.campaigns set total_budget=<purani value> where name='TEST Campaign A';   (aur daily_budget bhi purani)
-- Same tarah same-key concurrency: dono tab me record_ad_serve(<HASH>, <cid>, 'gaming', 'retry-test-0007') => ek hi baar charge, doosre ko replayed = true.
