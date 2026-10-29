-- =====================================================================
-- BLISSCCO | Day 13 | Part 4 : payout request workflow ke SQL tests (ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI. Jab tak tum khud chalakar expected result na dekh lo, ise "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par KABHI NAHI.
-- Pehle chali hon: day-13-1, day-13-4, day-13-9. Fixtures: day-3-6 SETUP (TEST Publisher C / D, Advertiser A) aur ek ACTIVE admin profile (profiles.role = 'admin').
-- TEST Publisher C / D ki ledger entries aur payout requests pehle se KHALI honi chahiye (earnings tests rollback hote hain, isliye aam taur par hain).
-- Poora ek saath chalao (ek hi transaction). Expect: status = PASS har row me. ERROR aaye toh pehle `rollback;` chalao.
--
-- Kya jaanchta hai: ownership, permissions (publisher / advertiser / anon / service_role / direct table), duplicate request, khula request, invalid amount,
-- balance limit, valid / invalid state transitions, DB-level guards, audit trail, ledger ka na chhua jana.
-- Concurrency (do session ek saath) ek transaction me nahi dikh sakti: file ke neeche 2-session manual check likha hai.
-- =====================================================================

begin;
create temp table t13d (test text, passed boolean, got text);
create temp table t13d_ids (k text primary key, v text);

-- Fixtures (rollback me jayenge).
--   Publisher C: earning 0.0150 + 0.0100  => ledger balance 0.0250
--   Publisher D: earning 0.0070           => ledger balance 0.0070
do $do$
declare
  v_c   uuid := (select id from public.publishers where name = 'TEST Publisher C');
  v_d   uuid := (select id from public.publishers where name = 'TEST Publisher D');
  v_adm uuid := (select id from public.profiles where role = 'admin' and status = 'active' limit 1);
  v_dirty int;
begin
  if v_c is null or v_d is null then raise exception 'Fixtures missing: day-3-6 SETUP pehle chalao'; end if;
  if v_adm is null then raise exception 'Fixtures missing: ek active admin profile chahiye (profiles.role = admin, status = active)'; end if;
  select (select count(*) from public.financial_ledger where publisher_id in (v_c, v_d))
       + (select count(*) from public.publisher_payout_requests where publisher_id in (v_c, v_d)) into v_dirty;
  if v_dirty > 0 then raise exception 'TEST Publisher C / D par pehle se ledger ya payout rows hain: fixtures saaf nahi, tests ke exact numbers galat honge'; end if;

  update public.ledger_settings set ledger_enabled = true, publisher_share_bps = 7000 where id;
  perform private.ledger_append('publisher_earning', 'publisher', 0.0150, 't13d:c:earn1', 'serve', 'bsr_' || md5('t13d1') || substr(md5('t13d1x'), 1, 8), null, v_c);
  perform private.ledger_append('publisher_earning', 'publisher', 0.0100, 't13d:c:earn2', 'serve', 'bsr_' || md5('t13d2') || substr(md5('t13d2x'), 1, 8), null, v_c);
  perform private.ledger_append('publisher_earning', 'publisher', 0.0070, 't13d:d:earn1', 'serve', 'bsr_' || md5('t13d3') || substr(md5('t13d3x'), 1, 8), null, v_d);

  insert into t13d_ids values ('c', v_c::text), ('d', v_d::text), ('adm', v_adm::text);
end
$do$;

-- T1: C apne balance par request karta hai
do $do$
declare r jsonb; n int; ev record; v_c uuid; v_cp uuid;
begin
  select (select v::uuid from t13d_ids where k = 'c') into v_c;
  v_cp := (select id from auth.users where email = 'delieveryboy09@gmail.com');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.request_my_payout(0.0100, '11111111-1111-4111-8111-111111111111');
  reset role;
  insert into t13d_ids values ('r1', r ->> 'id');
  select count(*) into n from public.publisher_payout_requests where publisher_id = v_c;
  select * into ev from public.publisher_payout_events where payout_request_id = (r ->> 'id')::uuid;
  insert into t13d values ('T1.1 C requests 0.0100: outcome requested, status requested, amount exact text', r ->> 'outcome' = 'requested' and r ->> 'status' = 'requested' and r ->> 'amount' = '0.0100', r::text);
  insert into t13d values ('T1.2 exactly 1 row stored; audit: null -> requested by C (publisher)', n = 1 and ev.from_status is null and ev.to_status = 'requested' and ev.actor_profile_id = v_cp and ev.actor_role = 'publisher', coalesce(ev.to_status, 'no event'));
end
$do$;

-- T2: duplicate / khula request
do $do$
declare d1 jsonb; d2 jsonb; d3 jsonb; n int; v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  d1 := public.request_my_payout(0.0100, '11111111-1111-4111-8111-111111111111'); -- wahi retry
  d2 := public.request_my_payout(0.0200, '11111111-1111-4111-8111-111111111111'); -- wahi key, alag amount
  d3 := public.request_my_payout(0.0050, '22222222-2222-4222-8222-222222222222'); -- naya key, par ek request khula hai
  reset role;
  select count(*) into n from public.publisher_payout_requests where publisher_id = (select v::uuid from t13d_ids where k = 'c');
  insert into t13d values ('T2.1 same key + same amount = duplicate (same id, no new row)', d1 ->> 'outcome' = 'duplicate' and d1 ->> 'id' = (select v from t13d_ids where k = 'r1'), d1::text);
  insert into t13d values ('T2.2 same key + different amount = conflict', d2 ->> 'outcome' = 'conflict', d2::text);
  insert into t13d values ('T2.3 second request while one is open = open_request_exists', d3 ->> 'outcome' = 'open_request_exists', d3::text);
  insert into t13d values ('T2.4 still exactly 1 payout row for C', n = 1, n::text);
end
$do$;

-- T3: galat amounts (kabhi row nahi banti)
do $do$
declare o text[] := array[]::text[]; n int; v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  o := o || (public.request_my_payout(0, gen_random_uuid()) ->> 'outcome');
  o := o || (public.request_my_payout(-0.0100, gen_random_uuid()) ->> 'outcome');
  o := o || (public.request_my_payout(0.00005, gen_random_uuid()) ->> 'outcome');
  o := o || (public.request_my_payout(null::numeric, gen_random_uuid()) ->> 'outcome');
  o := o || (public.request_my_payout(0.0100, null::uuid) ->> 'outcome');
  o := o || (public.request_my_payout(10000000000, gen_random_uuid()) ->> 'outcome');
  reset role;
  select count(*) into n from public.publisher_payout_requests where publisher_id = (select v::uuid from t13d_ids where k = 'c');
  insert into t13d values ('T3.1 zero / negative / 5 decimals / null amount / null key / too large are all invalid', o = array['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid'], array_to_string(o, ','));
  insert into t13d values ('T3.2 no row was created by invalid requests', n = 1, n::text);
end
$do$;

-- T4: ownership: D sirf apna dekhta hai; balance limit
do $do$
declare n_own int; n_leak int; s record; i1 jsonb; i2 jsonb; n_c int; v_dp uuid := (select id from auth.users where email = 'muskelon2266@gmail.com');
  r1 uuid := (select v::uuid from t13d_ids where k = 'r1'); -- temp table role badalne se PEHLE padhni hai (authenticated ko uski permission nahi)
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_dp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_own from public.get_my_payout_requests(100);
  select count(*) into n_leak from public.get_my_payout_requests(100) where id = r1;
  select * into s from public.get_my_payout_summary();
  i1 := public.request_my_payout(0.0071, '33333333-3333-4333-8333-333333333333'); -- balance 0.0070 se zyada
  i2 := public.request_my_payout(0.0070, '33333333-3333-4333-8333-333333333333'); -- exactly balance
  reset role;
  insert into t13d_ids values ('rd', i2 ->> 'id');
  insert into t13d values ('T4.1 D sees 0 payout requests of its own and never C''s request', n_own = 0 and n_leak = 0, n_own::text || '/' || n_leak::text);
  insert into t13d values ('T4.2 D summary shows only D numbers (ledger 0.0070, available 0.0070)', s.ledger_balance = '0.0070' and s.available = '0.0070' and s.reserved = '0.0000' and s.paid_out = '0.0000' and s.eligible, row_to_json(s)::text);
  insert into t13d values ('T4.3 D asks 0.0071 on a 0.0070 balance: insufficient, tells available 0.0070', i1 ->> 'outcome' = 'insufficient' and i1 ->> 'available' = '0.0070', i1::text);
  insert into t13d values ('T4.4 D asks exactly 0.0070: requested', i2 ->> 'outcome' = 'requested', i2::text);

  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'delieveryboy09@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_c from public.get_my_payout_requests(100);
  reset role;
  insert into t13d values ('T4.5 C still sees exactly 1 request (its own), not D''s', n_c = 1, n_c::text);
end
$do$;

-- T5: C ka hisab (request ka paisa reserved)
do $do$
declare s record; v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into s from public.get_my_payout_summary();
  reset role;
  insert into t13d values ('T5.1 C: ledger 0.0250, reserved 0.0100, paid 0.0000, available 0.0150, open request true',
    s.ledger_balance = '0.0250' and s.reserved = '0.0100' and s.paid_out = '0.0000' and s.available = '0.0150' and s.has_open_request and s.currency_code = 'USD', row_to_json(s)::text);
end
$do$;

-- T6: permissions
do $do$
declare
  r1 uuid := (select v::uuid from t13d_ids where k = 'r1');
  st1 text := 'none'; st2 text := 'none'; n_list int; adv jsonb;
  a_ok boolean := true; s_ok boolean := true; tbl1 text := 'none'; tbl2 text := 'none'; tbl3 text := 'none';
  v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
begin
  -- publisher admin kaam nahi kar sakta
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_review_payout_request(r1, 'approve', null); exception when others then st1 := sqlstate; end;
  begin perform public.admin_mark_payout_paid(r1);                       exception when others then st2 := sqlstate; end;
  select count(*) into n_list from public.admin_list_payout_requests(50);
  -- direct table access band
  begin perform count(*) from public.publisher_payout_requests;                              exception when insufficient_privilege then tbl1 := 'denied'; end;
  begin update public.publisher_payout_requests set status = 'paid' where id = r1;           exception when insufficient_privilege then tbl2 := 'denied'; end;
  begin perform count(*) from public.publisher_payout_events;                                exception when insufficient_privilege then tbl3 := 'denied'; end;
  reset role;
  insert into t13d values ('T6.1 publisher calling admin_review / admin_mark_payout_paid gets 42501', st1 = '42501' and st2 = '42501', st1 || '/' || st2);
  insert into t13d values ('T6.2 publisher gets 0 rows from admin_list_payout_requests', n_list = 0, n_list::text);
  insert into t13d values ('T6.3 publisher cannot read or update the payout tables directly', tbl1 = 'denied' and tbl2 = 'denied' and tbl3 = 'denied', tbl1 || '/' || tbl2 || '/' || tbl3);

  -- advertiser publisher nahi hai
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'janvi01506@gmail.com'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  adv := public.request_my_payout(0.0010, gen_random_uuid());
  reset role;
  insert into t13d values ('T6.4 advertiser cannot request a payout (forbidden)', adv ->> 'outcome' = 'forbidden', adv::text);

  -- anon aur service_role: sab functions par permission denied
  set local role anon;
  begin perform public.request_my_payout(0.0010, gen_random_uuid()); a_ok := false;     exception when insufficient_privilege then null; end;
  begin perform public.admin_review_payout_request(r1, 'approve', null); a_ok := false; exception when insufficient_privilege then null; end;
  begin perform public.admin_mark_payout_paid(r1); a_ok := false;                       exception when insufficient_privilege then null; end;
  begin perform * from public.get_my_payout_summary(); a_ok := false;                   exception when insufficient_privilege then null; end;
  begin perform * from public.get_my_payout_requests(5); a_ok := false;                 exception when insufficient_privilege then null; end;
  begin perform * from public.admin_list_payout_requests(5); a_ok := false;             exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  begin perform public.request_my_payout(0.0010, gen_random_uuid()); s_ok := false;     exception when insufficient_privilege then null; end;
  begin perform public.admin_review_payout_request(r1, 'approve', null); s_ok := false; exception when insufficient_privilege then null; end;
  begin perform public.admin_mark_payout_paid(r1); s_ok := false;                       exception when insufficient_privilege then null; end;
  begin perform * from public.get_my_payout_summary(); s_ok := false;                   exception when insufficient_privilege then null; end;
  begin perform * from public.admin_list_payout_requests(5); s_ok := false;             exception when insufficient_privilege then null; end;
  begin perform count(*) from public.publisher_payout_requests; s_ok := false;          exception when insufficient_privilege then null; end;
  reset role;
  insert into t13d values ('T6.5 anon is denied on all 6 payout functions', a_ok, a_ok::text);
  insert into t13d values ('T6.6 service_role is denied on the functions and the table', s_ok, s_ok::text);
end
$do$;

-- T7: admin transitions on C's request R1
do $do$
declare
  r1 uuid := (select v::uuid from t13d_ids where k = 'r1');
  v_adm uuid := (select v::uuid from t13d_ids where k = 'adm');
  v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
  x1 jsonb; x2 jsonb; x3 jsonb; x4 jsonb; x5 jsonb; x6 jsonb; x7 jsonb; x8 jsonb; x9 jsonb; x10 jsonb; s record; row_status text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  x1 := public.admin_mark_payout_paid(r1);                              -- requested -> paid: nahi
  x2 := public.admin_review_payout_request(r1, 'maybe', null);          -- galat decision
  x3 := public.admin_review_payout_request(r1, 'reject', null);         -- reject bina wajah
  x4 := public.admin_review_payout_request(r1, 'reject', 'ab');         -- wajah bahut chhoti
  x5 := public.admin_review_payout_request(r1, 'approve', null);        -- ok
  x6 := public.admin_review_payout_request(r1, 'approve', null);        -- dobara approve
  x7 := public.admin_mark_payout_paid(r1);                              -- ok
  x8 := public.admin_mark_payout_paid(r1);                              -- dobara paid
  x9 := public.admin_review_payout_request(r1, 'approve', null);        -- paid ko approve
  x10 := public.admin_review_payout_request(r1, 'reject', 'TEST should not work after paid');
  reset role;
  select status into row_status from public.publisher_payout_requests where id = r1;
  insert into t13d values ('T7.1 requested -> paid directly is refused (invalid_transition)', x1 ->> 'outcome' = 'invalid_transition', x1::text);
  insert into t13d values ('T7.2 unknown decision, reject without reason, reject with 2-char reason are all invalid', x2 ->> 'outcome' = 'invalid' and x3 ->> 'outcome' = 'invalid' and x4 ->> 'outcome' = 'invalid', (x2 ->> 'outcome') || ',' || (x3 ->> 'outcome') || ',' || (x4 ->> 'outcome'));
  insert into t13d values ('T7.3 requested -> approved works', x5 ->> 'outcome' = 'approved', x5::text);
  insert into t13d values ('T7.4 approving twice = invalid_transition (current status approved)', x6 ->> 'outcome' = 'invalid_transition' and x6 ->> 'status' = 'approved', x6::text);
  insert into t13d values ('T7.5 approved -> paid works; paying twice = invalid_transition', x7 ->> 'outcome' = 'paid' and x8 ->> 'outcome' = 'invalid_transition' and x8 ->> 'status' = 'paid', (x7 ->> 'outcome') || ',' || (x8 ->> 'outcome'));
  insert into t13d values ('T7.6 a paid request can be neither approved nor rejected', x9 ->> 'outcome' = 'invalid_transition' and x10 ->> 'outcome' = 'invalid_transition' and row_status = 'paid', row_status);

  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into s from public.get_my_payout_summary();
  reset role;
  insert into t13d values ('T7.7 after paid: ledger stays 0.0250 (gross), paid 0.0100, reserved 0.0000, available 0.0150, no open request',
    s.ledger_balance = '0.0250' and s.paid_out = '0.0100' and s.reserved = '0.0000' and s.available = '0.0150' and not s.has_open_request, row_to_json(s)::text);
end
$do$;

-- T8: reject se paisa wapas available; approved request bhi reject ho sakti hai
do $do$
declare
  v_adm uuid := (select v::uuid from t13d_ids where k = 'adm');
  v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
  v_dp uuid := (select id from auth.users where email = 'muskelon2266@gmail.com');
  rd uuid := (select v::uuid from t13d_ids where k = 'rd');
  q1 jsonb; q2 jsonb; s1 record; rj jsonb; s2 record; rl record; ra jsonb; sd record; dj1 jsonb; dj2 jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  q1 := public.request_my_payout(0.0151, '44444444-4444-4444-8444-444444444444'); -- available 0.0150 se zyada
  q2 := public.request_my_payout(0.0150, '55555555-5555-4555-8555-555555555555'); -- ok
  select * into s1 from public.get_my_payout_summary();
  reset role;
  insert into t13d_ids values ('r2', q2 ->> 'id');
  insert into t13d values ('T8.1 over-balance after a paid payout is refused (insufficient, available 0.0150)', q1 ->> 'outcome' = 'insufficient' and q1 ->> 'available' = '0.0150', q1::text);
  insert into t13d values ('T8.2 exact available amount works and reserves everything (available 0.0000)', q2 ->> 'outcome' = 'requested' and s1.available = '0.0000' and s1.reserved = '0.0150', row_to_json(s1)::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  rj := public.admin_review_payout_request((q2 ->> 'id')::uuid, 'reject', 'TEST: wrong period');
  ra := public.admin_review_payout_request((q2 ->> 'id')::uuid, 'approve', null);
  -- D: approve phir approved -> rejected
  dj1 := public.admin_review_payout_request(rd, 'approve', null);
  dj2 := public.admin_review_payout_request(rd, 'reject', 'TEST: changed mind');
  reset role;
  insert into t13d values ('T8.3 admin rejects with a reason; a rejected request cannot be approved again', rj ->> 'outcome' = 'rejected' and ra ->> 'outcome' = 'invalid_transition' and ra ->> 'status' = 'rejected', (rj ->> 'outcome') || ',' || (ra ->> 'outcome'));
  insert into t13d values ('T8.4 approved -> rejected is allowed', dj1 ->> 'outcome' = 'approved' and dj2 ->> 'outcome' = 'rejected', (dj1 ->> 'outcome') || ',' || (dj2 ->> 'outcome'));

  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into s2 from public.get_my_payout_summary();
  select * into rl from public.get_my_payout_requests(100) where id = (q2 ->> 'id')::uuid;
  reset role;
  insert into t13d values ('T8.5 rejected money is available again (0.0150) and the reason is visible to the publisher', s2.available = '0.0150' and s2.reserved = '0.0000' and rl.status = 'rejected' and rl.rejection_reason = 'TEST: wrong period', row_to_json(s2)::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_dp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into sd from public.get_my_payout_summary();
  reset role;
  insert into t13d values ('T8.6 D: after reject, available is back to 0.0070 and nothing is paid', sd.available = '0.0070' and sd.paid_out = '0.0000' and not sd.has_open_request, row_to_json(sd)::text);
end
$do$;

-- T9: DATABASE ke apne guards (UI / function se alag; yahan seedha table par, owner role se)
do $do$
declare
  r1 uuid := (select v::uuid from t13d_ids where k = 'r1');
  r2 uuid := (select v::uuid from t13d_ids where k = 'r2');
  v_c uuid := (select v::uuid from t13d_ids where k = 'c');
  v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
  h1 text := 'none'; h2 text := 'none'; h3 text := 'none'; h4 text := 'none'; h5 text := 'none'; h6 text := 'none'; h7 text := 'none';
begin
  begin update public.publisher_payout_requests set status = 'approved' where id = r2;  -- rejected -> approved
  exception when others then get stacked diagnostics h1 = pg_exception_hint; end;
  begin update public.publisher_payout_requests set status = 'requested' where id = r1; -- paid -> requested
  exception when others then get stacked diagnostics h2 = pg_exception_hint; end;
  begin update public.publisher_payout_requests set amount = 9.9999 where id = r1;
  exception when others then get stacked diagnostics h3 = pg_exception_hint; end;
  begin delete from public.publisher_payout_requests where id = r1;
  exception when others then get stacked diagnostics h4 = pg_exception_hint; end;
  begin insert into public.publisher_payout_requests (publisher_id, amount, request_key, requested_by, status) values (v_c, 0.0010, gen_random_uuid(), v_cp, 'paid');
  exception when others then get stacked diagnostics h5 = pg_exception_hint; end;
  begin update public.publisher_payout_events set reason = 'tampered' where payout_request_id = r1;
  exception when others then get stacked diagnostics h6 = pg_exception_hint; end;
  begin delete from public.publisher_payout_events where payout_request_id = r1;
  exception when others then get stacked diagnostics h7 = pg_exception_hint; end;
  insert into t13d values ('T9.1 DB refuses rejected -> approved and paid -> requested (payout_invalid_transition)', h1 = 'payout_invalid_transition' and h2 = 'payout_invalid_transition', h1 || '/' || h2);
  insert into t13d values ('T9.2 DB refuses changing the amount of an existing request', h3 = 'payout_immutable_field', h3);
  insert into t13d values ('T9.3 DB refuses deleting a payout request', h4 = 'payout_no_delete', h4);
  insert into t13d values ('T9.4 DB refuses inserting a request that is not "requested"', h5 = 'payout_must_start_requested', h5);
  insert into t13d values ('T9.5 audit events can be neither updated nor deleted', h6 = 'payout_events_append_only' and h7 = 'payout_events_append_only', h6 || '/' || h7);
end
$do$;

-- T10: audit trail
do $do$
declare
  r1 uuid := (select v::uuid from t13d_ids where k = 'r1');
  r2 uuid := (select v::uuid from t13d_ids where k = 'r2');
  rd uuid := (select v::uuid from t13d_ids where k = 'rd');
  v_adm uuid := (select v::uuid from t13d_ids where k = 'adm');
  v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
  seq1 text; seq2 text; seq3 text; actors1 text; reason2 text; n_all int;
begin
  select string_agg(coalesce(e.from_status, 'none') || '>' || e.to_status, ',' order by e.id),
         string_agg(e.actor_role || ':' || case when e.actor_profile_id = v_cp then 'C' when e.actor_profile_id = v_adm then 'ADM' else '?' end, ',' order by e.id)
    into seq1, actors1 from public.publisher_payout_events e where e.payout_request_id = r1;
  select string_agg(coalesce(e.from_status, 'none') || '>' || e.to_status, ',' order by e.id), max(e.reason) filter (where e.to_status = 'rejected')
    into seq2, reason2 from public.publisher_payout_events e where e.payout_request_id = r2;
  select string_agg(coalesce(e.from_status, 'none') || '>' || e.to_status, ',' order by e.id) into seq3 from public.publisher_payout_events e where e.payout_request_id = rd;
  select count(*) into n_all from public.publisher_payout_events where payout_request_id in (r1, r2, rd);
  insert into t13d values ('T10.1 R1 history: none>requested, requested>approved, approved>paid by C then admin then admin', seq1 = 'none>requested,requested>approved,approved>paid' and actors1 = 'publisher:C,admin:ADM,admin:ADM', seq1 || ' | ' || actors1);
  insert into t13d values ('T10.2 R2 history ends in rejected with the admin reason', seq2 = 'none>requested,requested>rejected' and reason2 = 'TEST: wrong period', seq2 || ' | ' || coalesce(reason2, ''));
  insert into t13d values ('T10.3 D history: requested, approved, rejected', seq3 = 'none>requested,requested>approved,approved>rejected', seq3);
  insert into t13d values ('T10.4 rejected / failed calls wrote no extra events (3 + 2 + 3 = 8)', n_all = 8, n_all::text);
end
$do$;

-- T11: request ke baad ledger ghat jaye (negative adjustment): approved request paid nahi ho sakti
do $do$
declare
  v_adm uuid := (select v::uuid from t13d_ids where k = 'adm');
  v_c uuid := (select v::uuid from t13d_ids where k = 'c');
  v_cp uuid := (select id from auth.users where email = 'delieveryboy09@gmail.com');
  q jsonb; ap jsonb; pd jsonb; lst record; rj jsonb; q2 jsonb; s record; r3 uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  q := public.request_my_payout(0.0100, '66666666-6666-4666-8666-666666666666'); -- available 0.0150, ok
  reset role;
  r3 := (q ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ap := public.admin_review_payout_request(r3, 'approve', null);
  reset role;
  -- Ledger me -0.0200 adjustment: balance 0.0250 -> 0.0050 (reserved 0.0100 + paid 0.0100 = 0.0200 se kam)
  perform private.ledger_append('adjustment', 'publisher', -0.0200, 't13d:c:adj1', 'manual', null, null, v_c, null, 'TEST adjustment', v_adm);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  select * into lst from public.admin_list_payout_requests(50) where id = r3;
  pd := public.admin_mark_payout_paid(r3);
  rj := public.admin_review_payout_request(r3, 'reject', 'TEST: balance dropped');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  q2 := public.request_my_payout(0.0001, '77777777-7777-4777-8777-777777777777');
  select * into s from public.get_my_payout_summary();
  reset role;
  insert into t13d values ('T11.1 request 0.0100 approved while balance was enough', q ->> 'outcome' = 'requested' and ap ->> 'outcome' = 'approved', (q ->> 'outcome') || ',' || (ap ->> 'outcome'));
  insert into t13d values ('T11.2 after a -0.0200 adjustment the admin list flags ledger_covers = false', lst.ledger_covers = false and lst.status = 'approved', coalesce(lst.ledger_covers::text, 'no row'));
  insert into t13d values ('T11.3 marking paid is refused (insufficient) and admin can still reject the approved request', pd ->> 'outcome' = 'insufficient' and rj ->> 'outcome' = 'rejected', (pd ->> 'outcome') || ',' || (rj ->> 'outcome'));
  insert into t13d values ('T11.4 available never goes below 0 and a new request is refused (insufficient)', s.available = '0.0000' and s.ledger_balance = '0.0050' and s.paid_out = '0.0100' and q2 ->> 'outcome' = 'insufficient', row_to_json(s)::text);
end
$do$;

-- T12: suspended publisher request nahi kar sakta
do $do$
declare
  v_adm uuid := (select v::uuid from t13d_ids where k = 'adm');
  v_dp uuid := (select id from auth.users where email = 'muskelon2266@gmail.com');
  v_d uuid := (select v::uuid from t13d_ids where k = 'd');
  q jsonb; s record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_publisher_status(v_d, 'suspended');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_dp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  q := public.request_my_payout(0.0010, '88888888-8888-4888-8888-888888888888');
  select * into s from public.get_my_payout_summary();
  reset role;
  insert into t13d values ('T12.1 suspended publisher gets not_eligible and the summary says eligible = false', q ->> 'outcome' = 'not_eligible' and s.eligible = false, (q ->> 'outcome') || ',' || coalesce(s.eligible::text, 'no row'));
end
$do$;

-- T13: payout kaam ne ledger ko chhua nahi, aur koi paisa-bhejne wali cheez nahi
do $do$
declare
  v_c uuid := (select v::uuid from t13d_ids where k = 'c');
  v_d uuid := (select v::uuid from t13d_ids where k = 'd');
  n_c int; n_d int; n_payout_like int;
begin
  select count(*) into n_c from public.financial_ledger where publisher_id = v_c;
  select count(*) into n_d from public.financial_ledger where publisher_id = v_d;
  select count(*) into n_payout_like from public.financial_ledger where publisher_id in (v_c, v_d) and (reason ilike '%payout%' or idempotency_key ilike '%payout%');
  insert into t13d values ('T13.1 ledger holds only the fixture rows (C: 2 earnings + 1 adjustment = 3, D: 1) and no payout-made entries', n_c = 3 and n_d = 1 and n_payout_like = 0, n_c::text || '/' || n_d::text || '/' || n_payout_like::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t13d order by test;
rollback;

-- ---------------------------------------------------------------------
-- MANUAL 2-SESSION CHECK (concurrency; sirf TEST project, apne test publisher ke saath; transaction rollback karke khatam karo):
--   Session A:  begin;  set local role authenticated;  select set_config('request.jwt.claims', '{"sub":"<publisher user id>","role":"authenticated"}', true);
--               select public.request_my_payout(<amount <= available>, gen_random_uuid());     -- outcome 'requested' (abhi COMMIT mat karo)
--   Session B:  (same user, same pattern)  select public.request_my_payout(<amount <= available>, gen_random_uuid());
--               => B ruka rehta hai (publishers row ka lock). A ne `commit;` kiya => B turant 'open_request_exists' dega (ya 'insufficient').
--               Dono kabhi 'requested' nahi dena chahiye. Phir A ya B apna kaam rollback / saaf karo.
-- ---------------------------------------------------------------------
