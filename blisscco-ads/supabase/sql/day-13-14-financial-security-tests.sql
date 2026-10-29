-- =====================================================================
-- BLISSCCO | Day 13 | Part 5 : financial security hardening ke SQL tests (ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI. Jab tak tum khud chalakar expected result na dekh lo, ise "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par KABHI NAHI: ye settings ki values badalta (rollback me wapas) aur test payout rows banata hai.
-- Pehle chali hon: day-13-1, day-13-4, day-13-9, day-13-12. Fixtures: day-3-6 SETUP ka 'TEST Publisher C' aur ek ACTIVE admin profile (profiles.role = 'admin').
-- TEST Publisher C par pehle se koi khula (requested / approved) payout request nahi hona chahiye.
-- Poora ek saath chalao (ek hi transaction). Expect: status = PASS har row me. ERROR aaye toh pehle `rollback;` chalao.
--
-- Kya jaanchta hai: settings badlav ka record, history append-only, settings row delete / truncate band, koi app role history / settings nahi chhu sakta,
-- payout guard ke 3 naye niyam (requester mismatch, review trail frozen, self-review) aur ki sahi (admin) raasta ab bhi chalta hai.
-- =====================================================================

begin;
create temp table t13e (test text, passed boolean, got text);

-- Helper: ek statement chalao, hint (ya sqlstate) wapas do; error nahi aaya toh 'NO ERROR'.
create function pg_temp.t13e_hint(p_sql text) returns text language plpgsql as $fn$
declare h text;
begin
  execute p_sql;
  return 'NO ERROR';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, sqlstate);
end
$fn$;

-- T1: settings badlav ka record
do $do$
declare
  n0 int; n1 int; n2 int; h1 record; h2 record; h3 record;
  v_share integer; v_new_share integer; v_cpm numeric; v_new_cpm numeric; v_enabled boolean;
begin
  select s.publisher_share_bps, s.ledger_enabled into v_share, v_enabled from public.ledger_settings s where s.id;
  select s.cpm_usd into v_cpm from public.ad_platform_settings s where s.id;
  v_new_share := case when v_share = 1234 then 1235 else 1234 end;
  v_new_cpm   := case when v_cpm = 3.1234 then 3.1235 else 3.1234 end;

  select count(*) into n0 from public.financial_settings_history;

  update public.ledger_settings set publisher_share_bps = v_new_share where id;
  select * into h1 from public.financial_settings_history order by id desc limit 1;

  update public.ad_platform_settings set cpm_usd = v_new_cpm where id;
  select * into h2 from public.financial_settings_history order by id desc limit 1;

  update public.ledger_settings set ledger_enabled = not v_enabled where id;
  select * into h3 from public.financial_settings_history order by id desc limit 1;
  select count(*) into n1 from public.financial_settings_history;

  update public.ledger_settings set ledger_enabled = ledger_enabled, publisher_share_bps = publisher_share_bps where id;
  select count(*) into n2 from public.financial_settings_history;

  insert into t13e values ('T1.1 revenue share change is recorded (setting, old -> new, kind = update)',
    h1.setting = 'publisher_share_bps' and h1.change_kind = 'update' and h1.old_value = coalesce(v_share::text, 'null') and h1.new_value = v_new_share::text,
    coalesce(h1.setting || ' ' || coalesce(h1.old_value, '-') || ' -> ' || coalesce(h1.new_value, '-'), 'no row'));
  insert into t13e values ('T1.2 CPM change is recorded',
    h2.setting = 'cpm_usd' and h2.change_kind = 'update' and h2.old_value = v_cpm::text and h2.new_value = v_new_cpm::text,
    coalesce(h2.setting || ' ' || coalesce(h2.old_value, '-') || ' -> ' || coalesce(h2.new_value, '-'), 'no row'));
  insert into t13e values ('T1.3 ledger on/off change is recorded',
    h3.setting = 'ledger_enabled' and h3.old_value = v_enabled::text and h3.new_value = (not v_enabled)::text,
    coalesce(h3.setting || ' ' || coalesce(h3.old_value, '-') || ' -> ' || coalesce(h3.new_value, '-'), 'no row'));
  insert into t13e values ('T1.4 exactly 3 new history rows for 3 real changes', n1 = n0 + 3, (n1 - n0)::text);
  insert into t13e values ('T1.5 an update that changes nothing writes no history row', n2 = n1, (n2 - n1)::text);
end
$do$;

-- T2: history append-only
do $do$
declare a text; b text; c text;
begin
  a := pg_temp.t13e_hint('update public.financial_settings_history set new_value = ''x''');
  b := pg_temp.t13e_hint('delete from public.financial_settings_history');
  c := pg_temp.t13e_hint('truncate public.financial_settings_history');
  insert into t13e values ('T2.1 history UPDATE blocked', a = 'settings_history_append_only', a);
  insert into t13e values ('T2.2 history DELETE blocked', b = 'settings_history_append_only', b);
  insert into t13e values ('T2.3 history TRUNCATE blocked', c = 'settings_history_append_only', c);
end
$do$;

-- T3: settings row delete / truncate band
do $do$
declare a text; b text; c text; d text;
begin
  a := pg_temp.t13e_hint('delete from public.ledger_settings');
  b := pg_temp.t13e_hint('truncate public.ledger_settings');
  c := pg_temp.t13e_hint('delete from public.ad_platform_settings');
  d := pg_temp.t13e_hint('truncate public.ad_platform_settings');
  insert into t13e values ('T3.1 ledger_settings DELETE blocked', a = 'settings_no_delete', a);
  insert into t13e values ('T3.2 ledger_settings TRUNCATE blocked', b = 'settings_no_delete', b);
  insert into t13e values ('T3.3 ad_platform_settings DELETE blocked', c = 'settings_no_delete', c);
  insert into t13e values ('T3.4 ad_platform_settings TRUNCATE blocked', d = 'settings_no_delete', d);
end
$do$;

-- T4: koi app role settings / history / ledger / payout tables nahi chhu sakta
do $do$
declare bad text;
begin
  select string_agg(r.rolname || ':' || t.tbl, ', ') into bad
  from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
  cross join (values ('public.financial_settings_history'), ('public.ledger_settings'), ('public.ad_platform_settings'), ('public.financial_ledger'),
                     ('public.publisher_payout_requests'), ('public.publisher_payout_events')) t(tbl)
  where has_table_privilege(r.rolname, t.tbl, 'select,insert,update,delete,truncate');
  insert into t13e values ('T4.1 anon / authenticated / service_role have NO privilege on any money table', bad is null, coalesce(bad, 'none'));
end
$do$;

-- T5: payout guard ke naye niyam (fixtures: TEST Publisher C + ek active admin)
do $do$
declare
  v_c uuid; v_cp uuid; v_adm uuid; v_id uuid;
  h_mismatch text; h_self_approve text; h_frozen text; h_self_pay text;
  st text; n_ev int; ev_to text[];
begin
  select p.id, p.profile_id into v_c, v_cp from public.publishers p where p.name = 'TEST Publisher C';
  select pr.id into v_adm from public.profiles pr where pr.role = 'admin' and pr.status = 'active' limit 1;
  if v_c is null then raise exception 'Fixtures missing: day-3-6 SETUP pehle chalao (TEST Publisher C)'; end if;
  if v_adm is null then raise exception 'Fixtures missing: ek active admin profile chahiye'; end if;
  if exists (select 1 from public.publisher_payout_requests r where r.publisher_id = v_c and r.status in ('requested', 'approved')) then
    raise exception 'TEST Publisher C par khula payout request pehle se hai: saaf karo';
  end if;

  -- N1: request kisi doosre (admin) profile ke naam par insert nahi ho sakti
  h_mismatch := pg_temp.t13e_hint(format(
    'insert into public.publisher_payout_requests (publisher_id, amount, request_key, requested_by) values (%L, 0.0010, gen_random_uuid(), %L)', v_c, v_adm));

  -- Sahi insert (publisher ka apna profile)
  insert into public.publisher_payout_requests (publisher_id, amount, request_key, requested_by)
  values (v_c, 0.0010, gen_random_uuid(), v_cp) returning id into v_id;

  -- N3: publisher khud apni request approve nahi kar sakta
  h_self_approve := pg_temp.t13e_hint(format(
    'update public.publisher_payout_requests set status = ''approved'', reviewed_by = %L, reviewed_at = now() where id = %L', v_cp, v_id));

  -- Sahi raasta: admin approve karta hai
  update public.publisher_payout_requests set status = 'approved', reviewed_by = v_adm, reviewed_at = now() where id = v_id;

  -- N2: paid karte waqt reviewed_at badalna band
  h_frozen := pg_temp.t13e_hint(format(
    'update public.publisher_payout_requests set status = ''paid'', paid_by = %L, paid_at = now(), reviewed_at = reviewed_at + interval ''1 second'' where id = %L', v_adm, v_id));

  -- N3: publisher khud ko "paid" nahi bana sakta
  h_self_pay := pg_temp.t13e_hint(format(
    'update public.publisher_payout_requests set status = ''paid'', paid_by = %L, paid_at = now() where id = %L', v_cp, v_id));

  -- Sahi raasta: admin paid mark karta hai
  update public.publisher_payout_requests set status = 'paid', paid_by = v_adm, paid_at = now() where id = v_id;

  select r.status into st from public.publisher_payout_requests r where r.id = v_id;
  select count(*), array_agg(e.to_status order by e.id) into n_ev, ev_to from public.publisher_payout_events e where e.payout_request_id = v_id;

  insert into t13e values ('T5.1 request made for a different profile is blocked at insert', h_mismatch = 'payout_requester_mismatch', h_mismatch);
  insert into t13e values ('T5.2 requester cannot approve their own request', h_self_approve = 'payout_self_review', h_self_approve);
  insert into t13e values ('T5.3 review details cannot change when marking paid', h_frozen = 'payout_review_trail_frozen', h_frozen);
  insert into t13e values ('T5.4 requester cannot mark their own request paid', h_self_pay = 'payout_self_review', h_self_pay);
  insert into t13e values ('T5.5 the normal path still works: requested -> approved -> paid by an admin (status paid, 3 audit events)',
    st = 'paid' and n_ev = 3 and ev_to = array['requested', 'approved', 'paid'], coalesce(st, '-') || ' / ' || coalesce(array_to_string(ev_to, ','), '-'));
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t13e order by test;
rollback;
