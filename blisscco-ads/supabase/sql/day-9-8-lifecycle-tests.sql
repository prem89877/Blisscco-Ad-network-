-- =====================================================================
-- BLISSCCO | Day 9 | Part 4 : lifecycle guard tests (ROLLBACK-ONLY)
-- Pehle day-9-7-lifecycle-guards.sql chali honi chahiye. Ye file kisi database par chalayi NAHI gayi hai.
--
-- Ye NAYI migration nahi hai: kuch save nahi hota. Poora kaam ek DO block me hota hai jo ant me JAAN-BOOJH KAR
-- error raise karta hai ("DAY9_LIFECYCLE_RESULTS [...]"), isliye poora transaction rollback hota hai.
-- Supabase SQL Editor me ek baar me poora block chalao. "ERROR P0001 DAY9_LIFECYCLE_RESULTS" dikhna SAHI hai.
-- Result JSON me har test ka "pass": true/false dekho. SIRF TEST project par chalao.
--
-- Zaroori: kam se kam 1 active advertiser. Admin (profiles.role = 'admin', status 'active') ho toh admin tests (A1..A4) bhi chalte hain,
-- warna wo "skipped" dikhte hain. Publisher ho toh replay test (P1..P2) chalta hai, warna skipped.
-- Test rows ke naam 'ZZ9-7 ...' se shuru hote hain (sab rollback me jate hain).
-- =====================================================================

do $$
declare
  res        jsonb := '[]'::jsonb;
  v_adv      uuid;
  v_prof     uuid;
  v_admin    uuid;
  v_pub      uuid;
  c_paused   uuid;   -- resume tests ka campaign
  cr_ok      uuid;   -- us campaign ka approved creative
  c_pend     uuid;   -- admin approve tests ka campaign (pending_review)
  cr_pend    uuid;   -- pending_review creative
  c_act      uuid;   -- active campaign (replay / loader tests)
  cr_act     uuid;
  h          text;
  n          bigint;
  j          jsonb;
  v_today    date := (now() at time zone 'utc')::date;
begin
  select a.id, a.profile_id into v_adv, v_prof
  from public.advertisers a join public.profiles p on p.id = a.profile_id
  where a.status = 'active' and p.status = 'active' order by a.created_at limit 1;
  if v_adv is null then
    raise exception 'DAY9_LIFECYCLE_RESULTS %', '[{"t":"SETUP","pass":false,"got":"no active advertiser found"}]';
  end if;
  select id into v_admin from public.profiles where role = 'admin' and status = 'active' limit 1;
  select id into v_pub from public.publishers limit 1;

  -- ===== SETUP (postgres role: guard triggers lagu nahi) =====
  insert into public.campaigns (advertiser_id, name, category, status, total_budget, daily_budget, start_date)
  values (v_adv, 'ZZ9-7 resume', 'lifestyle', 'paused', 100, null, v_today - 5) returning id into c_paused;
  insert into public.ad_creatives (campaign_id, headline, body, destination_url, status, reviewed_at)
  values (c_paused, 'ZZ9-7 ad', 'ZZ9-7 body', 'https://example.com/zz97', 'approved', now()) returning id into cr_ok;

  -- ===== R1..R7 : owner (authenticated advertiser) resume =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- R1: sab theek => resume ho jata hai
  begin
    update public.campaigns set status = 'active' where id = c_paused;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('t', 'R1 resume: approved ad + in schedule + budget left', 'expect', '1 row', 'got', n::text, 'pass', n = 1);
  exception when others then
    res := res || jsonb_build_object('t', 'R1 resume: approved ad + in schedule + budget left', 'expect', '1 row', 'got', sqlstate || ' ' || sqlerrm, 'pass', false);
  end;

  -- R2: kharch = total budget => resume roka jata hai (NAYA)
  execute 'reset role';
  update public.campaigns set status = 'paused' where id = c_paused;
  insert into public.campaign_spend_daily (campaign_id, day, spent) values (c_paused, v_today, 100.00);
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.campaigns set status = 'active' where id = c_paused;
    res := res || jsonb_build_object('t', 'R2 resume with total budget fully spent', 'expect', '42501 resume_budget_exhausted', 'got', 'success', 'pass', false);
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := res || jsonb_build_object('t', 'R2 resume with total budget fully spent', 'expect', '42501 resume_budget_exhausted', 'got', sqlstate || ' ' || coalesce(h, ''), 'pass', sqlstate = '42501' and h = 'resume_budget_exhausted');
  end;

  -- R3: budget badhane ke saath resume => allowed (naya total dekha jata hai)
  begin
    update public.campaigns set status = 'active', total_budget = 200 where id = c_paused;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('t', 'R3 resume together with a higher total budget', 'expect', '1 row', 'got', n::text, 'pass', n = 1);
  exception when others then
    res := res || jsonb_build_object('t', 'R3 resume together with a higher total budget', 'expect', '1 row', 'got', sqlstate || ' ' || sqlerrm, 'pass', false);
  end;

  -- R4: end_date guzar gayi => resume roka jata hai
  execute 'reset role';
  update public.campaigns set status = 'paused', total_budget = 100, end_date = v_today - 1 where id = c_paused;
  delete from public.campaign_spend_daily where campaign_id = c_paused;
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.campaigns set status = 'active' where id = c_paused;
    res := res || jsonb_build_object('t', 'R4 resume after end date', 'expect', '42501 resume_campaign_ended', 'got', 'success', 'pass', false);
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := res || jsonb_build_object('t', 'R4 resume after end date', 'expect', '42501 resume_campaign_ended', 'got', sqlstate || ' ' || coalesce(h, ''), 'pass', sqlstate = '42501' and h = 'resume_campaign_ended');
  end;

  -- R5: approved creative nahi => resume roka jata hai
  execute 'reset role';
  update public.campaigns set end_date = null where id = c_paused;
  update public.ad_creatives set status = 'draft', reviewed_at = null where id = cr_ok;
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.campaigns set status = 'active' where id = c_paused;
    res := res || jsonb_build_object('t', 'R5 resume without an approved ad', 'expect', '42501 resume_needs_approved_creative', 'got', 'success', 'pass', false);
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := res || jsonb_build_object('t', 'R5 resume without an approved ad', 'expect', '42501 resume_needs_approved_creative', 'got', sqlstate || ' ' || coalesce(h, ''), 'pass', sqlstate = '42501' and h = 'resume_needs_approved_creative');
  end;

  -- R6: owner khud creative ko approve / review fields nahi badal sakta
  begin
    update public.ad_creatives set status = 'approved' where id = cr_ok;
    res := res || jsonb_build_object('t', 'R6a owner sets own creative to approved', 'expect', 'error', 'got', 'success', 'pass', false);
  exception when others then
    res := res || jsonb_build_object('t', 'R6a owner sets own creative to approved', 'expect', 'error', 'got', sqlstate, 'pass', true);
  end;
  begin
    update public.ad_creatives set reviewed_at = now(), reviewed_by = v_prof where id = cr_ok;
    res := res || jsonb_build_object('t', 'R6b owner writes review columns', 'expect', 'error', 'got', 'success', 'pass', false);
  exception when others then
    res := res || jsonb_build_object('t', 'R6b owner writes review columns', 'expect', 'error (no column grant)', 'got', sqlstate, 'pass', true);
  end;

  -- R7: owner admin functions nahi chala sakta
  begin
    perform public.admin_review_creative(cr_ok, 'approve', null);
    res := res || jsonb_build_object('t', 'R7a owner calls admin_review_creative', 'expect', '42501', 'got', 'success', 'pass', false);
  exception when others then
    res := res || jsonb_build_object('t', 'R7a owner calls admin_review_creative', 'expect', '42501', 'got', sqlstate, 'pass', sqlstate = '42501');
  end;
  begin
    perform public.admin_review_campaign(c_paused, 'approve');
    res := res || jsonb_build_object('t', 'R7b owner calls admin_review_campaign', 'expect', '42501', 'got', 'success', 'pass', false);
  exception when others then
    res := res || jsonb_build_object('t', 'R7b owner calls admin_review_campaign', 'expect', '42501', 'got', sqlstate, 'pass', sqlstate = '42501');
  end;

  -- ===== A1..A4 : admin approve rules (sirf agar admin maujood hai) =====
  execute 'reset role';
  if v_admin is null then
    res := res || jsonb_build_object('t', 'A1..A4 admin tests', 'expect', 'run', 'got', 'skipped: no active admin profile', 'pass', true);
  else
    insert into public.campaigns (advertiser_id, name, category, status, total_budget, start_date, end_date)
    values (v_adv, 'ZZ9-7 pending', 'lifestyle', 'pending_review', 50, v_today - 5, v_today - 1) returning id into c_pend;
    insert into public.ad_creatives (campaign_id, headline, body, destination_url, status)
    values (c_pend, 'ZZ9-7 pend ad', 'body', 'https://example.com/zz97p', 'pending_review') returning id into cr_pend;

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    -- A1: approved ad nahi => campaign approve nahi
    begin
      perform public.admin_review_campaign(c_pend, 'approve');
      res := res || jsonb_build_object('t', 'A1 approve campaign without an approved ad', 'expect', '22023 approve_needs_creative', 'got', 'success', 'pass', false);
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      res := res || jsonb_build_object('t', 'A1 approve campaign without an approved ad', 'expect', '22023 approve_needs_creative', 'got', sqlstate || ' ' || coalesce(h, ''), 'pass', sqlstate = '22023' and h = 'approve_needs_creative');
    end;

    -- A2: admin creative approve karta hai (ok), phir dobara approve (roka)
    begin
      perform public.admin_review_creative(cr_pend, 'approve', null);
      select case when (status = 'approved' and reviewed_by = v_admin and reviewed_at is not null) then 1 else 0 end into n from public.ad_creatives where id = cr_pend;
      res := res || jsonb_build_object('t', 'A2a admin approves a pending ad (reviewer recorded)', 'expect', '1', 'got', coalesce(n::text, 'null'), 'pass', n = 1);
    exception when others then
      res := res || jsonb_build_object('t', 'A2a admin approves a pending ad (reviewer recorded)', 'expect', 'true', 'got', sqlstate || ' ' || sqlerrm, 'pass', false);
    end;
    begin
      perform public.admin_review_creative(cr_pend, 'approve', null);
      res := res || jsonb_build_object('t', 'A2b approving an already approved ad', 'expect', '22023', 'got', 'success', 'pass', false);
    exception when others then
      res := res || jsonb_build_object('t', 'A2b approving an already approved ad', 'expect', '22023', 'got', sqlstate, 'pass', sqlstate = '22023');
    end;

    -- A3: ab ad approved hai, par end_date guzar gayi => campaign approve nahi
    begin
      perform public.admin_review_campaign(c_pend, 'approve');
      res := res || jsonb_build_object('t', 'A3 approve campaign whose end date passed', 'expect', '22023 approve_campaign_ended', 'got', 'success', 'pass', false);
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      res := res || jsonb_build_object('t', 'A3 approve campaign whose end date passed', 'expect', '22023 approve_campaign_ended', 'got', sqlstate || ' ' || coalesce(h, ''), 'pass', sqlstate = '22023' and h = 'approve_campaign_ended');
    end;

    -- A4: dates theek karo => approve ho jata hai aur status active
    execute 'reset role';
    update public.campaigns set end_date = null where id = c_pend;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.admin_review_campaign(c_pend, 'approve');
      execute 'reset role';
      select count(*) into n from public.campaigns where id = c_pend and status = 'active';
      res := res || jsonb_build_object('t', 'A4 approve a valid campaign', 'expect', 'status active', 'got', n::text, 'pass', n = 1);
    exception when others then
      res := res || jsonb_build_object('t', 'A4 approve a valid campaign', 'expect', 'status active', 'got', sqlstate || ' ' || sqlerrm, 'pass', false);
    end;
  end if;

  -- ===== F : function definitions me self-approval check hai =====
  execute 'reset role';
  select case when pg_get_functiondef('public.admin_review_campaign(uuid, text)'::regprocedure) like '%self_approval_blocked%'
               and pg_get_functiondef('public.admin_review_creative(uuid, text, text)'::regprocedure) like '%self_approval_blocked%'
              then 1 else 0 end into n;
  res := res || jsonb_build_object('t', 'F1 self-approval check present in both admin functions', 'expect', '1', 'got', n::text, 'pass', n = 1);

  -- ===== P1..P2 : retry replay ab schedule dekhta hai (postgres role) =====
  if v_pub is null then
    res := res || jsonb_build_object('t', 'P1..P2 replay tests', 'expect', 'run', 'got', 'skipped: no publisher', 'pass', true);
  else
    insert into public.campaigns (advertiser_id, name, category, status, total_budget, start_date)
    values (v_adv, 'ZZ9-7 replay', 'lifestyle', 'active', 100, v_today - 5) returning id into c_act;
    insert into public.ad_creatives (campaign_id, headline, body, destination_url, status, reviewed_at)
    values (c_act, 'ZZ9-7 replay ad', 'body', 'https://example.com/zz97r', 'approved', now()) returning id into cr_act;
    insert into public.ad_serve_requests (publisher_id, idempotency_key, creative_id, campaign_id)
    values (v_pub, 'zz97-replay-key', cr_act, c_act);

    j := private.replay_serve(v_pub, 'zz97-replay-key');
    res := res || jsonb_build_object('t', 'P1 replay of a live campaign returns the ad', 'expect', 'ok', 'got', coalesce(j ->> 'outcome', 'null'), 'pass', j ->> 'outcome' = 'ok');

    update public.campaigns set start_date = v_today - 10, end_date = v_today - 1 where id = c_act;
    j := private.replay_serve(v_pub, 'zz97-replay-key');
    res := res || jsonb_build_object('t', 'P2 replay after the campaign ended', 'expect', 'rejected', 'got', coalesce(j ->> 'outcome', 'null'), 'pass', j ->> 'outcome' = 'rejected');
  end if;

  -- ===== L1..L2 : load_ad_candidates budget filter =====
  insert into public.campaigns (advertiser_id, name, category, status, total_budget, start_date)
  values (v_adv, 'ZZ9-7 loader', 'lifestyle', 'active', 10, v_today - 5) returning id into c_act;
  insert into public.ad_creatives (campaign_id, headline, body, destination_url, status, reviewed_at)
  values (c_act, 'ZZ9-7 loader ad', 'body', 'https://example.com/zz97l', 'approved', now()) returning id into cr_act;

  select count(*) into n from public.load_ad_candidates('lifestyle', v_today) where campaign_id = c_act;
  res := res || jsonb_build_object('t', 'L1 loader returns an active campaign with budget', 'expect', '1', 'got', n::text, 'pass', n = 1);

  insert into public.campaign_spend_daily (campaign_id, day, spent) values (c_act, v_today, 10.00);
  select count(*) into n from public.load_ad_candidates('lifestyle', v_today) where campaign_id = c_act;
  res := res || jsonb_build_object('t', 'L2 loader hides a campaign whose total budget is spent', 'expect', '0', 'got', n::text, 'pass', n = 0);

  raise exception 'DAY9_LIFECYCLE_RESULTS %', res::text;   -- jaan-boojh kar error: poora transaction rollback
end $$;

-- Chalane ke baad (alag se) check: kuch save nahi hua?  Expect: test_rows_left = 0
--   select count(*) as test_rows_left from public.campaigns where name like 'ZZ9-7%';
