-- =====================================================================
-- BLISSCCO | Day 6 | Part 2 : authorize_publisher_key + record_ad_serve ke SQL tests
-- Ye tests tab tak "pass" nahi maane jaate jab tak tumne khud run karke expected result na dekha ho.
-- (Maine ye SQL kisi database par NAHI chalaya: sandbox me Postgres nahi hai.)
--
-- Pehle: day-5-1 se day-5-6 aur day-6-1 chali hon, aur day-3-6 ka SETUP block chala ho
-- (TEST Publisher C, TEST Campaign A, TEST creative A, users blisscco-test-a/c).
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


-- ===================== S7 (permitted): record_ad_serve: serve log + daily counter =====================
-- Expect: result outcome = ok; log_rows = 1; daily_serves = 1; topic = gaming
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as result;
reset role;
select (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows,
       (select max(topic) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as topic,
       (select sum(serves) from public.creative_serve_daily where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as daily_serves;
rollback;


-- ===================== S8 (forbidden): record par creative eligible nahi (campaign paused) =====================
-- Expect: result outcome = rejected; log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as result;
reset role;
select count(*) as log_rows from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A');
rollback;


-- ===================== S9 (forbidden): record par creative approved nahi =====================
-- Expect: outcome = rejected; log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.ad_creatives set status = 'pending_review' where headline = 'TEST creative A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as result;
reset role;
select count(*) as log_rows from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A');
rollback;


-- ===================== S10 (forbidden): record par topic campaign category se alag =====================
-- Expect: outcome = rejected; log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'technology') as result;
reset role;
select count(*) as log_rows from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A');
rollback;


-- ===================== S11 (forbidden): record par expired / future campaign =====================
-- Expect: dono outcome = rejected
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set start_date = current_date - 10, end_date = current_date - 1 where name = 'TEST Campaign A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as expired;
reset role;
update public.campaigns set start_date = current_date + 1, end_date = current_date + 5 where name = 'TEST Campaign A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as future;
rollback;


-- ===================== S12 (forbidden): record par advertiser suspended =====================
-- Expect: outcome = rejected
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.advertisers set status = 'suspended' where company_name = 'TEST Advertiser A';
set local role service_role;
select public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as result;
rollback;


-- ===================== S13 (forbidden): record par galat key / sensitive topic / null creative =====================
-- Expect: a = unauthorized, b = rejected (health taxonomy me nahi), c = rejected
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.record_ad_serve(repeat('0', 64), (select id from public.ad_creatives where headline = 'TEST creative A'), 'gaming') as a,
       public.record_ad_serve(current_setting('test.hash'), (select id from public.ad_creatives where headline = 'TEST creative A'), 'health') as b,
       public.record_ad_serve(current_setting('test.hash'), null, 'gaming') as c;
rollback;


-- ===================== S14 (forbidden): anon dono functions nahi chala sakta =====================
-- Expect: ERROR permission denied for function authorize_publisher_key
begin;
set local role anon;
select public.authorize_publisher_key(repeat('0', 64));
rollback;
-- Expect: ERROR permission denied for function record_ad_serve
begin;
set local role anon;
select public.record_ad_serve(repeat('0', 64), gen_random_uuid(), 'gaming');
rollback;


-- ===================== S15 (forbidden): authenticated dono functions nahi chala sakta =====================
-- Expect: ERROR permission denied (dono)
begin;
set local role authenticated;
select public.authorize_publisher_key(repeat('0', 64));
rollback;
begin;
set local role authenticated;
select public.record_ad_serve(repeat('0', 64), gen_random_uuid(), 'gaming');
rollback;
