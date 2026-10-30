-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 6 | Part 3 : publisher API-key authentication ke SQL tests
-- KOI schema/function/grant NAHI badalta (sirf test). Isliye koi migration nahi hai.
-- Sirf TEST project par chalao. Asli publisher ya asli key par kabhi nahi.
--
-- Publisher = delieveryboy09@gmail.com (Publisher C), Advertiser = janvi01506@gmail.com (Advertiser A): sab check inhi emails se hote hain.
-- Pehle: day-5-1 se day-5-6 aur day-5-8 chali hon, aur day-3-6 ka SETUP block chala ho
-- (TEST Publisher C, TEST Campaign A, TEST creative A, users janvi01506 (Advertiser A) / delieveryboy09 (Publisher C)).
-- Har block ALAG se chalao (editor saaf karke ek block paste karo). Poori file ek saath RUN mat karna.
-- Har block begin...rollback me hai, kuch save nahi hota. Koi asli/nakli "blc_live_" key yahan likhi nahi hai:
-- har block apni key private.issue_publisher_key se banata hai aur rollback par wo gayab ho jaati hai.
--
-- Ye file maine kisi database par CHALAYI NAHI (sandbox me Postgres nahi). Jab tak tum har block ka
-- expected result na dekho, ye "tested" nahi hai.
--
-- Maujooda day-5-9 (S1-S15) pehle se: sahi key, anjaan key, galat format hash, suspended publisher,
-- revoked key, rate limit, anon/authenticated function access. Yahan sirf wahi hai jo pehle nahi tha.
-- Supabase SQL Editor sirf AAKHRI select ka result dikhata hai.
-- =====================================================================


-- ===================== A1 (forbidden): publisher status 'pending' (naya publisher ka default) =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.publishers set status = 'pending' where profile_id = (select id from auth.users where email = 'delieveryboy09@gmail.com');
set local role service_role;
select public.authorize_publisher_key(current_setting('test.hash')) ->> 'outcome' as outcome;
rollback;


-- ===================== A2 (forbidden): publisher ka profile suspended =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.profiles set status = 'suspended'
 where id = (select id from auth.users where email = 'delieveryboy09@gmail.com');
set local role service_role;
select public.authorize_publisher_key(current_setting('test.hash')) ->> 'outcome' as outcome;
rollback;


-- ===================== A3 (forbidden): hash ka format UPPERCASE (sirf lowercase 64-hex chalta hai) =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
set local role service_role;
select public.authorize_publisher_key(upper(current_setting('test.hash'))) ->> 'outcome' as outcome;
rollback;


-- ===================== A4 (forbidden): record_ad_serve par REVOKED key =====================
-- Expect: 1 row: outcome = unauthorized, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where advertiser_id = (select a.id from public.advertisers a join auth.users u on u.id = a.profile_id where u.email = 'janvi01506@gmail.com') and name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
update public.publisher_api_keys set status = 'revoked', revoked_at = now() where key_hash = current_setting('test.hash');
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome,
       (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== A5 (forbidden): record_ad_serve par SUSPENDED publisher =====================
-- Expect: 1 row: outcome = unauthorized, log_rows = 0
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where advertiser_id = (select a.id from public.advertisers a join auth.users u on u.id = a.profile_id where u.email = 'janvi01506@gmail.com') and name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
update public.publishers set status = 'suspended' where profile_id = (select id from auth.users where email = 'delieveryboy09@gmail.com');
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select current_setting('test.r')::jsonb ->> 'outcome' as outcome,
       (select count(*) from public.ad_serve_log where creative_id = (select id from public.ad_creatives where headline = 'TEST creative A')) as log_rows;
rollback;


-- ===================== A6 (permitted): rate limit har key ka alag counter hai =====================
-- Limit 1 per minute. Key 1: ok, phir rate_limited. Key 2 (usi publisher ki doosri key): ab bhi ok.
-- Expect: 1 row: key1_first = ok, key1_second = rate_limited, key2_first = ok
-- (Agar teeno call minute ki seema par kat jayein toh key1_second ok aa sakta hai: block dobara chalao.)
begin;
select set_config('test.key1', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.key2', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash1', encode(sha256(convert_to(current_setting('test.key1'), 'UTF8')), 'hex'), true);
select set_config('test.hash2', encode(sha256(convert_to(current_setting('test.key2'), 'UTF8')), 'hex'), true);
update public.ad_platform_settings set rate_limit_per_minute = 1;
set local role service_role;
select set_config('test.o1', public.authorize_publisher_key(current_setting('test.hash1')) ->> 'outcome', true);
select set_config('test.o2', public.authorize_publisher_key(current_setting('test.hash1')) ->> 'outcome', true);
select set_config('test.o3', public.authorize_publisher_key(current_setting('test.hash2')) ->> 'outcome', true);
reset role;
select current_setting('test.o1') as key1_first, current_setting('test.o2') as key1_second, current_setting('test.o3') as key2_first;
rollback;


-- ===================== A7 (permitted): sahi key par last_used_at set hota hai, rate-limit row ban-ti hai =====================
-- Expect: 1 row: before = null, after_is_set = true, rate_rows = 1
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
select set_config('test.before', coalesce((select last_used_at::text from public.publisher_api_keys where key_hash = current_setting('test.hash')), 'null'), true);
set local role service_role;
select set_config('test.o', public.authorize_publisher_key(current_setting('test.hash')) ->> 'outcome', true);
reset role;
select current_setting('test.before') as before,
       (select last_used_at is not null from public.publisher_api_keys where key_hash = current_setting('test.hash')) as after_is_set,
       (select count(*) from public.api_rate_limits r join public.publisher_api_keys k on k.id = r.key_id where k.key_hash = current_setting('test.hash')) as rate_rows,
       current_setting('test.o') as outcome;
rollback;


-- ===================== A8 (permitted): key sirf HASH ke roop me store hoti hai =====================
-- Expect: 1 row: plain_key_rows = 0, hash_stored = true, prefix_len = 13, prefix_is_not_full_key = true,
--                columns = {created_at,id,key_hash,key_prefix,last_used_at,publisher_id,revoked_at,status}
begin;
select set_config('test.key', private.issue_publisher_key((select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
select (select count(*) from public.publisher_api_keys
         where key_hash = current_setting('test.key') or key_prefix = current_setting('test.key')) as plain_key_rows,
       exists (select 1 from public.publisher_api_keys where key_hash = current_setting('test.hash')) as hash_stored,
       (select char_length(key_prefix) from public.publisher_api_keys where key_hash = current_setting('test.hash')) as prefix_len,
       (select key_prefix <> current_setting('test.key') from public.publisher_api_keys where key_hash = current_setting('test.hash')) as prefix_is_not_full_key,
       (select array_agg(column_name::text order by column_name) from information_schema.columns
         where table_schema = 'public' and table_name = 'publisher_api_keys') as columns;
rollback;


-- ===================== A9 (forbidden): ek publisher ki 5 se zyada active keys nahi =====================
-- Expect: "Success. No rows returned" (koi error nahi). Agar 6th key ban gayi toh ERROR "TEST FAILED" aayega.
begin;
do $$
declare
  v_pub    uuid := (select p.id from public.publishers p join auth.users u on u.id = p.profile_id where u.email = 'delieveryboy09@gmail.com');
  v_active integer;
begin
  select count(*) into v_active
    from public.publisher_api_keys where publisher_id = v_pub and status = 'active';
  while v_active < 5 loop
    perform private.issue_publisher_key(v_pub);
    v_active := v_active + 1;
  end loop;
  begin
    perform private.issue_publisher_key(v_pub);
    raise exception 'TEST FAILED: a 6th active key was issued';
  exception
    when sqlstate '22023' then
      null; -- expected: active key limit reached
  end;
end;
$$;
rollback;


-- ===================== A10 (forbidden): keys table seedha nahi padh sakte (teeno roles) =====================
-- Block A10a. Expect: ERROR permission denied for table publisher_api_keys
begin;
set local role service_role;
select count(*) from public.publisher_api_keys;
rollback;

-- Block A10b (alag chalao). Expect: ERROR permission denied for table publisher_api_keys
begin;
set local role authenticated;
select count(*) from public.publisher_api_keys;
rollback;

-- Block A10c (alag chalao). Expect: ERROR permission denied for table publisher_api_keys
begin;
set local role anon;
select count(*) from public.publisher_api_keys;
rollback;


-- ===================== A11 (forbidden): key issue/revoke functions service_role/anon/authenticated se nahi chalte =====================
-- Block A11a. Expect: ERROR (permission denied for schema private ya function issue_publisher_key)
begin;
set local role service_role;
select private.issue_publisher_key(gen_random_uuid());
rollback;

-- Block A11b (alag chalao). Expect: ERROR (permission denied)
begin;
set local role authenticated;
select private.issue_publisher_key(gen_random_uuid());
rollback;


-- ===================== V (live check, sirf padhta hai, kuch nahi badalta) =====================
-- V1. Expect: 0 rows (keys table par anon/authenticated/service_role ko koi grant nahi)
select grantee, privilege_type from information_schema.table_privileges
where table_schema = 'public' and table_name = 'publisher_api_keys'
  and grantee in ('anon', 'authenticated', 'service_role');

-- V2. Expect: rls_on = true
select relname, relrowsecurity as rls_on from pg_class
where relnamespace = 'public'::regnamespace and relname in ('publisher_api_keys', 'api_rate_limits');

-- V3. Expect: har function ke liye sirf postgres aur service_role
select routine_name, grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name in ('authorize_publisher_key', 'record_ad_serve')
order by routine_name, grantee;

-- V4. Expect: ek bhi row nahi (koi key abhi kisi galat status me nahi: status/revoked_at ka mel)
select id, status, revoked_at from public.publisher_api_keys
where (status = 'revoked') <> (revoked_at is not null);
