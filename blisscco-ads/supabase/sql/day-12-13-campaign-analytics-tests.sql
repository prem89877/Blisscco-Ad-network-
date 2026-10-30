-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 12 | Prompt 6 Part 2 : analytics functions ke SQL tests (HAR BLOCK ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI. Jab tak tum khud chalakar expected result na dekh lo, inhe "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par NAHI.
-- Pehle: day-12-12-campaign-analytics.sql chal chuki ho; day-3-6 SETUP (TEST Publisher C / D) aur day-7-3 SETUP
--        (TEST Advertiser A / B, TEST Campaign A / B, TEST creative A / B) chale hon.
-- Har block ALAG se chalao. SQL Editor sirf AAKHRI select dikhata hai. Expect: status = PASS har row me.
-- Beech me ERROR aaye toh pehle `rollback;` chalao.
-- =====================================================================

begin;
create temp table t12a (test text, passed boolean, got text);

-- Fixtures (rollback me jayenge): TEST Campaign A ke 3 serves (Publisher C ke) -> 2 impressions + 1 click. Campaign B ke 0 events.
do $do$
declare
  v_pub uuid := (select id from public.publishers where name = 'TEST Publisher C');
  v_cr  uuid := (select x.id from public.ad_creatives x where x.headline = 'TEST creative A');
  v_cmp uuid := (select x.campaign_id from public.ad_creatives x where x.headline = 'TEST creative A');
  s1 bigint; s2 bigint; s3 bigint;
begin
  if v_pub is null or v_cr is null then raise exception 'Fixtures missing: day-3-6 / day-7-3 SETUP pehle chalao'; end if;
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at) values (v_pub, v_cr, v_cmp, 'gaming', now()) returning id into s1;
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at) values (v_pub, v_cr, v_cmp, 'gaming', now()) returning id into s2;
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at) values (v_pub, v_cr, v_cmp, 'gaming', now()) returning id into s3;
  insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at) values
    (s1, v_pub, v_cmp, v_cr, 'impression', 'blisscco_beacon', now()),
    (s2, v_pub, v_cmp, v_cr, 'impression', 'blisscco_beacon', now()),
    (s1, v_pub, v_cmp, v_cr, 'click', 'blisscco_redirect', now()),
    (s3, v_pub, v_cmp, v_cr, 'serve', 'publisher_server', now());   -- 'serve' event impression/click me NAHI ginta
end
$do$;

-- T1: Advertiser A apna campaign dekhta hai: 2 impressions, 1 click, CTR 50
do $do$
declare r record; n int; a_camp uuid := (select id from public.campaigns where name = 'TEST Campaign A');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_campaign_analytics(a_camp);
  select * into r from public.get_my_campaign_analytics(a_camp);
  reset role;
  insert into t12a values ('T1.1 A sees exactly 1 row for own campaign', n = 1, n::text);
  insert into t12a values ('T1.2 impressions 2, clicks 1, ctr 50 (serve event not counted)', r.impressions = 2 and r.clicks = 1 and r.ctr = 50, row_to_json(r)::text);
end
$do$;

-- T2: Advertiser B, A ka campaign maange => 0 rows; B ki list me A ka campaign nahi; B ka apna (zero events) = 0/0/0
do $do$
declare n_other int; n_leak int; r record; a_camp uuid := (select id from public.campaigns where name = 'TEST Campaign A'); b_camp uuid := (select id from public.campaigns where name = 'TEST Campaign B');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'sanjaytalekar740@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_other from public.get_my_campaign_analytics(a_camp);
  select count(*) into n_leak from public.get_my_campaign_analytics(null) where campaign_id = a_camp;
  select * into r from public.get_my_campaign_analytics(b_camp);
  reset role;
  insert into t12a values ('T2.1 B asking for A campaign => 0 rows', n_other = 0, n_other::text);
  insert into t12a values ('T2.2 A campaign never appears in B list', n_leak = 0, n_leak::text);
  insert into t12a values ('T2.3 B own campaign with no events => 0 / 0 / ctr 0 (no division error)', r.impressions = 0 and r.clicks = 0 and r.ctr = 0, row_to_json(r)::text);
end
$do$;

-- T3: Publisher C ko campaign analytics nahi milta; publisher totals milte hain (2 / 1 / 50), campaign column hai hi nahi; Publisher D ko 0 / 0 / 0
do $do$
declare n_c int; r record; r_d record; cols int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_c from public.get_my_campaign_analytics(null);
  select * into r from public.get_my_publisher_analytics();
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'muskelon2266@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r_d from public.get_my_publisher_analytics();
  reset role;
  select count(*) into cols from information_schema.parameters where specific_schema = 'public' and parameter_mode = 'OUT'
    and specific_name like 'get_my_publisher_analytics%' and parameter_name = 'campaign_id';
  insert into t12a values ('T3.1 publisher gets no campaign analytics rows', n_c = 0, n_c::text);
  insert into t12a values ('T3.2 publisher C totals 2 / 1 / 50', r.impressions = 2 and r.clicks = 1 and r.ctr = 50, row_to_json(r)::text);
  insert into t12a values ('T3.3 publisher D (other traffic) sees 0 / 0 / 0, not C numbers', r_d.impressions = 0 and r_d.clicks = 0 and r_d.ctr = 0, row_to_json(r_d)::text);
  insert into t12a values ('T3.4 publisher function has no campaign_id output column', cols = 0, cols::text);
end
$do$;

-- T4: Advertiser publisher-function se kuch nahi dekhta; anon dono functions par permission denied
do $do$
declare n int; denied_a boolean := false; denied_b boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_publisher_analytics();
  reset role;
  set local role anon;
  begin perform * from public.get_my_campaign_analytics(null); exception when insufficient_privilege then denied_a := true; end;
  begin perform * from public.get_my_publisher_analytics();   exception when insufficient_privilege then denied_b := true; end;
  reset role;
  insert into t12a values ('T4.1 advertiser gets no publisher analytics row', n = 0, n::text);
  insert into t12a values ('T4.2 anon denied on both functions', denied_a and denied_b, denied_a::text || denied_b::text);
end
$do$;

-- T5: service_role bhi in functions ko nahi chala sakta (key leak ho bhi jaye toh analytics ka darwaza nahi)
do $do$
declare denied boolean := false;
begin
  set local role service_role;
  begin perform * from public.get_my_campaign_analytics(null); exception when insufficient_privilege then denied := true; end;
  reset role;
  insert into t12a values ('T5.1 service_role cannot execute get_my_campaign_analytics', denied, denied::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12a order by test;
rollback;
