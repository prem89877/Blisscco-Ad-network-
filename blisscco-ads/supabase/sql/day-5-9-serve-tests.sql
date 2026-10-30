-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 5 | Part 9 : authorize_publisher_key + record_ad_serve ke SQL tests
-- Ye tests tab tak "pass" nahi maane jaate jab tak tumne khud run karke expected result na dekha ho.
-- (Maine ye SQL kisi database par NAHI chalaya: sandbox me Postgres nahi hai.)
--
-- FIX: S7-S13 me creative id pehle (postgres ke roop me) test.cid me rakhi jaati hai, kyunki service_role
-- ko tables par seedha access nahi hona chahiye. Function ko sirf current_setting('test.cid') milta hai.
-- S14/S15 me "ERROR permission denied" EXPECTED hai (wahi pass hai).
--
-- Pehle: day-5-1 se day-5-6 aur day-5-8 chali hon, aur day-3-6 ka SETUP block chala ho
-- (TEST Publisher C, TEST Campaign A, TEST creative A, users janvi01506 (Advertiser A) / delieveryboy09 (Publisher C)).
-- Har TEST block ALAG se chalao (editor saaf karke ek block paste karo).
-- Har block begin...rollback me hai, kuch save nahi hota. "ERROR" kai tests me EXPECTED hai.
-- Sirf test project par chalao. Poori file ek saath RUN mat karna.
-- =====================================================================


-- ===================== S1 (permitted): sahi key => ok + publisher_id + unit_cost_usd =====================
-- Expect: outcome = ok, publisher_status = active, unit_cost_usd = 0.002 (default CPM 2.00 / 1000), publisher_id = TEST Publisher C ki id
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.authorize_publisher_key(current_setting('test.hash')) as result;
rollback;


-- ===================== S2 (forbidden): anjaan key =====================
-- Expect: outcome = unauthorized (publisher_id nahi)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.authorize_publisher_key(repeat('0', 64)) as result;
rollback;


-- ===================== S3 (forbidden): galat format ka hash =====================
-- Expect: outcome = unauthorized
begin;
set local role service_role;
select public.authorize_publisher_key('not-a-hash') as a, public.authorize_publisher_key(null) as b;
rollback;


-- ===================== S4 (forbidden): publisher suspended =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.publishers set status = 'suspended' where name = 'TEST Publisher C';
set local role service_role;
select public.authorize_publisher_key(current_setting('test.hash')) as result;
rollback;


-- ===================== S5 (forbidden): revoked key =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.publisher_api_keys set status = 'revoked', revoked_at = now() where key_hash = current_setting('test.hash');
set local role service_role;
select public.authorize_publisher_key(current_setting('test.hash')) as result;
rollback;


-- ===================== S6 (permitted): rate limit: limit 2 => teesri call rate_limited =====================
-- Expect: {ok,ok,rate_limited}
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.ad_platform_settings set rate_limit_per_minute = 2;
set local role service_role;
select array_agg(public.authorize_publisher_key(current_setting('test.hash')) ->> 'outcome' order by g) as outcomes
from generate_series(1, 3) g;
rollback;


-- NOTE: Supabase SQL Editor sirf AAKHRI select ka result dikhata hai. Isliye har block ka result ek hi final select me aata hai.

-- ===================== S7 (permitted): record_ad_serve: serve log + daily counter =====================
-- Expect: 1 row: outcome = ok, log_rows = 1, topic = gaming, daily_serves = 1
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome,
       (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows,
       (select max(topic) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as topic,
       (select sum(serves) from public.creative_serve_daily where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as daily_serves;
rollback;


-- ===================== S8 (forbidden): record par campaign paused =====================
-- Expect: 1 row: outcome = rejected, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome, (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== S9 (forbidden): record par creative approved nahi =====================
-- Expect: 1 row: outcome = rejected, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
update public.ad_creatives set status = 'pending_review' where headline = 'TEST creative A';
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome, (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== S10 (forbidden): record par topic campaign category se alag =====================
-- Expect: 1 row: outcome = rejected, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'technology')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome, (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== S11 (forbidden): record par expired aur future campaign =====================
-- Expect: 1 row: expired = rejected, future = rejected, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
update public.campaigns set start_date = current_date - 10, end_date = current_date - 1 where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.expired', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
update public.campaigns set start_date = current_date + 1, end_date = current_date + 5 where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.future', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.expired')::jsonb ->> 'outcome' as expired,
       current_setting('test.future')::jsonb ->> 'outcome' as future,
       (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== S12 (forbidden): record par advertiser suspended =====================
-- Expect: 1 row: outcome = rejected, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
update public.advertisers set status = 'suspended' where company_name = 'TEST Advertiser A';
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome, (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== S13 (forbidden): galat key / sensitive topic / null creative =====================
-- Expect: 1 row: a = unauthorized, b = rejected (health taxonomy me nahi), c = rejected
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
set local role service_role;
select public.record_ad_serve(repeat('0', 64), current_setting('test.cid')::uuid, 'gaming') ->> 'outcome' as a,
       public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'health') ->> 'outcome' as b,
       public.record_ad_serve(current_setting('test.hash'), null, 'gaming') ->> 'outcome' as c;
rollback;


-- ===================== S14 (forbidden): anon dono functions nahi chala sakta =====================
-- Block S14a. Expect: ERROR permission denied for function authorize_publisher_key
begin;
set local role anon;
select public.authorize_publisher_key(repeat('0', 64));
rollback;

-- Block S14b (alag chalao). Expect: ERROR permission denied for function record_ad_serve
begin;
set local role anon;
select public.record_ad_serve(repeat('0', 64), gen_random_uuid(), 'gaming');
rollback;


-- ===================== S15 (forbidden): authenticated dono functions nahi chala sakta =====================
-- Block S15a. Expect: ERROR permission denied for function authorize_publisher_key
begin;
set local role authenticated;
select public.authorize_publisher_key(repeat('0', 64));
rollback;

-- Block S15b (alag chalao). Expect: ERROR permission denied for function record_ad_serve
begin;
set local role authenticated;
select public.record_ad_serve(repeat('0', 64), gen_random_uuid(), 'gaming');
rollback;
