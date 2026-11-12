-- =====================================================================
-- BLISSCCO PHASE 6 — DAY 2 — PART 3
-- ROLLBACK-ONLY: pilot limit boundary + update/reopen/advertiser-move checks
-- TEST project ONLY (Denim Hub Bsl). Run by owner in SQL Editor. WRITTEN, NOT RUN BY AI.
-- Ends with an INTENTIONAL exception => whole transaction rolls back. Copy the error text as evidence.
-- Does NOT touch the ledger settings table. No daily caps. No permanent rows.
-- =====================================================================
create or replace function pg_temp.try_sql(q text) returns text language plpgsql as $f$
declare h text;
begin
  execute q;
  return 'OK';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h,'no-hint') || ' | ' || sqlstate || ' | ' || left(sqlerrm, 90);
end $f$;

do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  a uuid; b uuid; r text; out text := ''; n int := 0;
  trg text;
  procedure_note text;
begin
  insert into auth.users (id,email,raw_user_meta_data) values (ua,'p3-adv-a@blisscco.test','{"role":"advertiser"}'::jsonb);
  insert into auth.users (id,email,raw_user_meta_data) values (ub,'p3-adv-b@blisscco.test','{"role":"advertiser"}'::jsonb);
  insert into public.advertisers (profile_id,company_name,status) select ua,'P3 A','active' where not exists (select 1 from public.advertisers where profile_id=ua);
  insert into public.advertisers (profile_id,company_name,status) select ub,'P3 B','active' where not exists (select 1 from public.advertisers where profile_id=ub);
  select id into a from public.advertisers where profile_id=ua;
  select id into b from public.advertisers where profile_id=ub;

  select tgenabled::text into trg from pg_trigger where tgname='campaigns_guard_pilot_limits';
  out := out || format(E'T0 trigger enabled (expect O): %s => %s\n', coalesce(trg,'MISSING'), case when trg='O' then 'PASS' else 'FAIL' end);

  -- helper pattern: r := pg_temp.try_sql(...); verdict
  -- T1 insert exactly 1000.00
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'P3-C1','technology',1000.00,current_date)$q$,a));
  out := out || format(E'T1 insert 1000.00 (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  -- T2 insert 1000.01
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'P3-OVER','technology',1000.01,current_date)$q$,a));
  out := out || format(E'T2 insert 1000.01 (expect pilot_campaign_limit): %s => %s\n', r, case when r like 'pilot_campaign_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);
  -- T3 second 1000.00 => total 2000.00
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'P3-C2','technology',1000.00,current_date)$q$,a));
  out := out || format(E'T3 insert 1000.00 -> advertiser total 2000.00 (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  -- T4 +0.01 => 2000.01
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'P3-C3','technology',0.01,current_date)$q$,a));
  out := out || format(E'T4 insert 0.01 -> total 2000.01 (expect pilot_advertiser_limit): %s => %s\n', r, case when r like 'pilot_advertiser_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);
  -- T5 update C1 to 1000.01
  r := pg_temp.try_sql(format($q$update public.campaigns set total_budget=1000.01 where advertiser_id=%L and name='P3-C1'$q$,a));
  out := out || format(E'T5 update C1 to 1000.01 (expect pilot_campaign_limit): %s => %s\n', r, case when r like 'pilot_campaign_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);
  -- T6 lower C2 to 500.00 (expect OK), then raise C2 to 500.01 + others 1000 => 1500.01 OK; raise to 1000.01 => campaign limit
  r := pg_temp.try_sql(format($q$update public.campaigns set total_budget=500.00 where advertiser_id=%L and name='P3-C2'$q$,a));
  out := out || format(E'T6a lower C2 to 500.00 (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  -- T7 add C4 500.00 => total 2000.00 OK, then raise C4 to 500.01 => 2000.01 advertiser limit
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'P3-C4','technology',500.00,current_date)$q$,a));
  out := out || format(E'T7a insert C4 500.00 -> total 2000.00 (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  r := pg_temp.try_sql(format($q$update public.campaigns set total_budget=500.01 where advertiser_id=%L and name='P3-C4'$q$,a));
  out := out || format(E'T7b raise C4 to 500.01 -> total 2000.01 (expect pilot_advertiser_limit): %s => %s\n', r, case when r like 'pilot_advertiser_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);
  -- T8 rejected campaign (not counted) then reopen to draft while advertiser is full
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,status) values (%L,'P3-REJ','technology',100.00,current_date,'rejected')$q$,a));
  out := out || format(E'T8a insert rejected 100.00 (not counted, expect OK or INCONCLUSIVE): %s => %s\n', r, case when r='OK' then 'PASS' else 'INCONCLUSIVE' end);
  r := pg_temp.try_sql(format($q$update public.campaigns set status='draft' where advertiser_id=%L and name='P3-REJ'$q$,a));
  out := out || format(E'T8b reopen rejected->draft when full (expect pilot_advertiser_limit): %s => %s\n', r, case when r like 'pilot_advertiser_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE (other guard blocked?)' end);
  -- T9 move campaign of advertiser B into full advertiser A
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'P3-B1','technology',100.00,current_date)$q$,b));
  r := pg_temp.try_sql(format($q$update public.campaigns set advertiser_id=%L where advertiser_id=%L and name='P3-B1'$q$,a,b));
  out := out || format(E'T9 move B campaign 100.00 into full A (expect pilot_advertiser_limit): %s => %s\n', r, case when r like 'pilot_advertiser_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE (other guard blocked?)' end);
  -- T10 final totals for A (counted statuses)
  select format('%s', coalesce(sum(total_budget),0)) into r from public.campaigns where advertiser_id=a and status in ('draft','pending_review','active','paused','completed');
  out := out || format(E'T10 advertiser A counted total (expect <= 2000.00): %s => %s\n', r, case when r::numeric <= 2000 then 'PASS' else 'FAIL' end);

  raise exception E'ROLLBACK-ONLY RESULT (this error is INTENTIONAL; transaction rolled back):\n%', out;
end $$;
