-- =====================================================================
-- BLISSCCO PHASE 6 — DAY 2 — PART 4 — G-1 ROLLBACK-ONLY TEST
-- Run AFTER phase6-day2-part4-g1-reopen-guard.sql. TEST project ONLY. WRITTEN, NOT RUN BY AI.
-- Ends with an INTENTIONAL exception => everything (incl. the temporary trigger disable) rolls back.
-- =====================================================================
create or replace function pg_temp.try_sql(q text) returns text language plpgsql as $f$
declare h text;
begin
  execute q;
  return 'OK';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h,'no-hint') || ' | ' || sqlstate || ' | ' || left(sqlerrm, 110);
end $f$;

do $$
declare
  ua uuid := gen_random_uuid();
  a uuid; r text; out text := ''; trg text;
begin
  insert into auth.users (id,email,raw_user_meta_data) values (ua,'g1-adv@blisscco.test','{"role":"advertiser"}'::jsonb);
  insert into public.advertisers (profile_id,company_name,status) select ua,'G1 A','active' where not exists (select 1 from public.advertisers where profile_id=ua);
  select id into a from public.advertisers where profile_id=ua;

  select tgenabled::text into trg from pg_trigger where tgname='campaigns_guard_pilot_limits';
  out := out || format(E'G0 trigger enabled (expect O): %s => %s\n', coalesce(trg,'MISSING'), case when trg='O' then 'PASS' else 'FAIL' end);

  -- Build legacy oversized rows (only possible with the guard temporarily disabled; rolled back at the end).
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,status) values (%L,'G1-LEG-REJ','technology',100.00,current_date,'rejected')$q$,a));
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,status) values (%L,'G1-EDGE-REJ','technology',100.00,current_date,'rejected')$q$,a));
  alter table public.campaigns disable trigger campaigns_guard_pilot_limits;
  update public.campaigns set total_budget = 1500.00 where advertiser_id = a and name = 'G1-LEG-REJ';
  update public.campaigns set total_budget = 1000.01 where advertiser_id = a and name = 'G1-EDGE-REJ';
  alter table public.campaigns enable trigger campaigns_guard_pilot_limits;
  select tgenabled::text into trg from pg_trigger where tgname='campaigns_guard_pilot_limits';
  out := out || format(E'G0b trigger re-enabled (expect O): %s => %s\n', trg, case when trg='O' then 'PASS' else 'FAIL' end);

  -- G1 core: reopen rejected 1500.00 at unchanged budget
  r := pg_temp.try_sql(format($q$update public.campaigns set status='draft' where advertiser_id=%L and name='G1-LEG-REJ'$q$,a));
  out := out || format(E'G1 reopen rejected 1500.00 unchanged (expect pilot_campaign_limit): %s => %s\n', r, case when r like 'pilot_campaign_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);
  -- G2 boundary 1000.01 refused
  r := pg_temp.try_sql(format($q$update public.campaigns set status='draft' where advertiser_id=%L and name='G1-EDGE-REJ'$q$,a));
  out := out || format(E'G2 reopen rejected 1000.01 (expect pilot_campaign_limit): %s => %s\n', r, case when r like 'pilot_campaign_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);
  -- G3 reduce while rejected, then reopen
  r := pg_temp.try_sql(format($q$update public.campaigns set total_budget=1000.00 where advertiser_id=%L and name='G1-LEG-REJ'$q$,a));
  out := out || format(E'G3a reduce rejected to 1000.00 (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  r := pg_temp.try_sql(format($q$update public.campaigns set status='draft' where advertiser_id=%L and name='G1-LEG-REJ'$q$,a));
  out := out || format(E'G3b reopen at exactly 1000.00 (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  -- Build a legacy oversized LIVE campaign now (after G3, so it cannot affect the advertiser total checks above).
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'G1-LEG-LIVE','technology',100.00,current_date)$q$,a));
  alter table public.campaigns disable trigger campaigns_guard_pilot_limits;
  update public.campaigns set total_budget = 1500.00 where advertiser_id = a and name = 'G1-LEG-LIVE';
  alter table public.campaigns enable trigger campaigns_guard_pilot_limits;
  -- G4 other legacy oversized (not rejected) keep working: rename is not blocked
  r := pg_temp.try_sql(format($q$update public.campaigns set name='G1-LEG-LIVE-RENAMED' where advertiser_id=%L and name='G1-LEG-LIVE'$q$,a));
  out := out || format(E'G4 rename legacy oversized live campaign (expect OK): %s => %s\n', r, case when r='OK' then 'PASS' else 'FAIL' end);
  -- G5 regression: fresh insert 1000.01 still refused
  r := pg_temp.try_sql(format($q$insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (%L,'G1-NEW-OVER','technology',1000.01,current_date)$q$,a));
  out := out || format(E'G5 insert 1000.01 (expect pilot_campaign_limit): %s => %s\n', r, case when r like 'pilot_campaign_limit%' then 'PASS' when r='OK' then 'FAIL-BYPASS' else 'INCONCLUSIVE' end);

  raise exception E'ROLLBACK-ONLY RESULT (this error is INTENTIONAL; transaction rolled back):\n%', out;
end $$;
