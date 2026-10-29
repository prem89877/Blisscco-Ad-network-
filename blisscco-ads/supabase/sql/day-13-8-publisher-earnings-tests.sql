-- =====================================================================
-- BLISSCCO | Day 13 | Part 3 : publisher earnings functions ke SQL tests (ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI. Jab tak tum khud chalakar expected result na dekh lo, ise "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par KABHI NAHI.
-- Pehle: day-13-1, day-13-4, day-13-7 chali hon; day-3-6 SETUP (TEST Publisher C / D) aur day-7-3 SETUP (TEST Advertiser A) chale hon.
-- Poora ek saath chalao (ek hi transaction). Expect: status = PASS har row me. ERROR aaye toh pehle `rollback;` chalao.
-- =====================================================================

begin;
create temp table t13c (test text, passed boolean, got text);

-- Fixtures (rollback me jayenge).
--   Publisher C: earning 0.0150 + earning 0.0100 (jiska reversal -0.0100) + adjustment -0.0050
--     => earned 0.0250, adjustments -0.0050, reversals -0.0100, balance 0.0100, entries 4
--   Publisher D: earning 0.0070 => earned 0.0070, balance 0.0070, entries 1
do $do$
declare
  v_c   uuid := (select id from public.publishers where name = 'TEST Publisher C');
  v_d   uuid := (select id from public.publishers where name = 'TEST Publisher D');
  v_cp  uuid := (select profile_id from public.publishers where name = 'TEST Publisher C');
  e2    bigint;
begin
  if v_c is null or v_d is null then raise exception 'Fixtures missing: day-3-6 SETUP pehle chalao'; end if;
  update public.ledger_settings set ledger_enabled = true, publisher_share_bps = 7000 where id;
  perform private.ledger_append('publisher_earning', 'publisher', 0.0150, 't13c:c:earn1', 'serve', 'bsr_' || md5('t13c1') || substr(md5('t13c1x'), 1, 8), null, v_c);
  e2 := (private.ledger_append('publisher_earning', 'publisher', 0.0100, 't13c:c:earn2', 'serve', 'bsr_' || md5('t13c2') || substr(md5('t13c2x'), 1, 8), null, v_c) ->> 'id')::bigint;
  perform private.ledger_append('adjustment', 'publisher', -0.0050, 't13c:c:adj1', 'manual', null, null, v_c, null, 'TEST adjustment', v_cp);
  perform private.ledger_reverse(e2, 't13c:c:rev2', 'TEST reversal', v_cp);
  perform private.ledger_append('publisher_earning', 'publisher', 0.0070, 't13c:d:earn1', 'serve', 'bsr_' || md5('t13c3') || substr(md5('t13c3x'), 1, 8), null, v_d);
end
$do$;

-- T1: Publisher C apne exact totals dekhta hai (text, 4 decimal)
do $do$
declare r record; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_my_publisher_earnings();
  select * into r from public.get_my_publisher_earnings();
  reset role;
  insert into t13c values ('T1.1 C gets exactly 1 summary row', n = 1, n::text);
  insert into t13c values ('T1.2 C totals: earned 0.0250, adjustments -0.0050, reversals -0.0100, balance 0.0100, count 4',
    r.total_earned = '0.0250' and r.total_adjustments = '-0.0050' and r.total_reversals = '-0.0100' and r.ledger_balance = '0.0100' and r.entry_count = 4, row_to_json(r)::text);
  insert into t13c values ('T1.3 balance = earned + adjustments + reversals (exact)',
    r.ledger_balance::numeric = r.total_earned::numeric + r.total_adjustments::numeric + r.total_reversals::numeric, row_to_json(r)::text);
  insert into t13c values ('T1.4 flags and currency (enabled, share set, USD)', r.ledger_enabled and r.share_configured and r.currency_code = 'USD', row_to_json(r)::text);
end
$do$;

-- T2: Publisher D sirf apni entry dekhta hai, C ke numbers / entries nahi
do $do$
declare r record; n int; leak int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'muskelon2266@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.get_my_publisher_earnings();
  select count(*) into n from public.get_my_publisher_ledger_entries(100);
  select count(*) into leak from public.get_my_publisher_ledger_entries(100) e
    where e.entry_id in (select entry_id from public.financial_ledger where publisher_id = (select id from public.publishers where name = 'TEST Publisher C'));
  reset role;
  insert into t13c values ('T2.1 D totals: earned 0.0070, balance 0.0070, count 1', r.total_earned = '0.0070' and r.ledger_balance = '0.0070' and r.entry_count = 1 and r.total_adjustments = '0.0000', row_to_json(r)::text);
  insert into t13c values ('T2.2 D entries list has exactly 1 row', n = 1, n::text);
  insert into t13c values ('T2.3 no C entry ever appears in D list', leak = 0, leak::text);
end
$do$;

-- T3: C ki entries: 4 rows, limit clamp (1 => 1 row, 0 / negative => 1 row)
do $do$
declare n4 int; n1 int; n0 int; nneg int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n4 from public.get_my_publisher_ledger_entries();
  select count(*) into n1 from public.get_my_publisher_ledger_entries(1);
  select count(*) into n0 from public.get_my_publisher_ledger_entries(0);
  select count(*) into nneg from public.get_my_publisher_ledger_entries(-5);
  reset role;
  insert into t13c values ('T3.1 C list has 4 entries by default', n4 = 4, n4::text);
  insert into t13c values ('T3.2 limit 1 / 0 / -5 all clamp to 1 row', n1 = 1 and n0 = 1 and nneg = 1, n1::text || n0::text || nneg::text);
end
$do$;

-- T4: advertiser ko kuch nahi (dono functions 0 rows)
do $do$
declare n1 int; n2 int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n1 from public.get_my_publisher_earnings();
  select count(*) into n2 from public.get_my_publisher_ledger_entries(100);
  reset role;
  insert into t13c values ('T4.1 advertiser gets 0 summary rows and 0 entries', n1 = 0 and n2 = 0, n1::text || n2::text);
end
$do$;

-- T5: anon aur service_role dono functions par permission denied
do $do$
declare a1 boolean := false; a2 boolean := false; s1 boolean := false; s2 boolean := false;
begin
  set local role anon;
  begin perform * from public.get_my_publisher_earnings();        exception when insufficient_privilege then a1 := true; end;
  begin perform * from public.get_my_publisher_ledger_entries(5); exception when insufficient_privilege then a2 := true; end;
  reset role;
  set local role service_role;
  begin perform * from public.get_my_publisher_earnings();        exception when insufficient_privilege then s1 := true; end;
  begin perform * from public.get_my_publisher_ledger_entries(5); exception when insufficient_privilege then s2 := true; end;
  reset role;
  insert into t13c values ('T5.1 anon denied on both functions', a1 and a2, a1::text || a2::text);
  insert into t13c values ('T5.2 service_role denied on both functions', s1 and s2, s1::text || s2::text);
end
$do$;

-- T6: entries function me private columns hain hi nahi
do $do$
declare bad int;
begin
  select count(*) into bad from information_schema.parameters
   where specific_schema = 'public' and parameter_mode = 'OUT'
     and specific_name like 'get_my_publisher_ledger_entries%'
     and parameter_name in ('advertiser_id', 'campaign_id', 'source_ref', 'created_by', 'reason', 'publisher_id', 'idempotency_key', 'id');
  insert into t13c values ('T6.1 entries output has no advertiser / campaign / source_ref / created_by / reason / publisher columns', bad = 0, bad::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t13c order by test;
rollback;
