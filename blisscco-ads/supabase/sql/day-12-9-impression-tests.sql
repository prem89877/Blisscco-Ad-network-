-- =====================================================================
-- BLISSCCO | Day 12 | Part 4 : impression writer ke SQL tests (HAR BLOCK ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI: sandbox me Postgres nahi hai. Jab tak tum khud chalakar expected
--  result na dekh lo, inhe "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par NAHI.
-- Pehle: day-12-1, 12-2, 12-5, 12-7 chal chuki hon, aur day-3-6 ka SETUP block chala ho (TEST Publisher C, TEST Publisher D, TEST creative A).
-- Har block ALAG se chalao. SQL Editor sirf AAKHRI select dikhata hai. Expect: status = PASS har row me.
-- Har block "rollback" par khatam hota hai. Beech me ERROR aaye toh pehle `rollback;` chalao.
-- NOTE: do requests ka EXACT ek saath aana yahan test nahi hota (ek session). Uski guarantee unique constraint + ON CONFLICT DO NOTHING hai
--       (T1.4 constraint ko seedha test karta hai).
-- =====================================================================


-- ===================== T1 : valid impression, duplicate, ek serve = ek impression =====================
begin;
create temp table t12i (test text, passed boolean, got text);

create function pg_temp.t12i_serve(p_ago interval default interval '0', p_pub text default 'TEST Publisher C') returns text language plpgsql as $fn$
declare v_ref text;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = p_pub), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning serve_ref into v_ref;
  if v_ref is null then raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao'; end if;
  return v_ref;
end
$fn$;

do $do$
declare
  ref text; pub uuid; r1 jsonb; r2 jsonb; r3 jsonb; n int; con text;
begin
  ref := pg_temp.t12i_serve();
  select publisher_id into pub from public.ad_serve_log where serve_ref = ref;

  set local role service_role;
  r1 := public.record_ad_impression(ref, pub);
  r2 := public.record_ad_impression(ref, pub);
  r3 := public.record_ad_impression(ref, pub);
  reset role;

  select count(*) into n from public.ad_events e join public.ad_serve_log s on s.id = e.serve_id where s.serve_ref = ref and e.event_type = 'impression';

  insert into t12i values ('T1.1 first call = recorded', r1 ->> 'outcome' = 'recorded', r1::text);
  insert into t12i values ('T1.2 second and third call (retry / replay) = duplicate', r2 ->> 'outcome' = 'duplicate' and r3 ->> 'outcome' = 'duplicate', r2::text || r3::text);
  insert into t12i values ('T1.3 exactly ONE impression row for that serve', n = 1, n::text);

  begin
    insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at)
    select s.id, s.publisher_id, s.campaign_id, s.creative_id, 'impression', 'blisscco_beacon', now() from public.ad_serve_log s where s.serve_ref = ref;
    insert into t12i values ('T1.4 the constraint itself refuses a 2nd impression for the same serve', false, 'second insert was ALLOWED');
  exception when unique_violation then
    get stacked diagnostics con = constraint_name;
    insert into t12i values ('T1.4 the constraint itself refuses a 2nd impression for the same serve', con = 'ad_events_one_per_type_key', con);
  end;

  insert into t12i values ('T1.5 stored row is a blisscco_beacon impression with a server time and no click/serve rows',
    (select count(*) = 1 and bool_and(source = 'blisscco_beacon' and event_type = 'impression' and occurred_at >= now() - interval '1 minute')
       from public.ad_events e join public.ad_serve_log s on s.id = e.serve_id where s.serve_ref = ref), '');
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12i order by test;
rollback;


-- ===================== T2 : rejected cases (kuch nahi likhta) + lookup =====================
begin;
create temp table t12i (test text, passed boolean, got text);

create function pg_temp.t12i_serve(p_ago interval default interval '0', p_pub text default 'TEST Publisher C') returns text language plpgsql as $fn$
declare v_ref text;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = p_pub), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning serve_ref into v_ref;
  if v_ref is null then raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao'; end if;
  return v_ref;
end
$fn$;

do $do$
declare
  ref text; old_ref text; pub uuid; other_pub uuid; res jsonb; before_n bigint; after_n bigint; lk jsonb;
begin
  ref := pg_temp.t12i_serve();
  old_ref := pg_temp.t12i_serve(interval '25 hours');
  select publisher_id into pub from public.ad_serve_log where serve_ref = ref;
  select id into other_pub from public.publishers where name = 'TEST Publisher D';
  select count(*) into before_n from public.ad_events;

  -- (har call ke around role service_role: temp table t12i ko sirf owner likh sakta hai, isliye insert se pehle reset role)
  set local role service_role; res := public.record_ad_impression('bsr_' || repeat('0', 40), pub); reset role;
  insert into t12i values ('T2.1 unknown serve_ref = rejected', res ->> 'outcome' = 'rejected', res::text);
  set local role service_role; res := public.record_ad_impression('not-a-ref', pub); reset role;
  insert into t12i values ('T2.2 malformed serve_ref = rejected', res ->> 'outcome' = 'rejected', res::text);
  set local role service_role; res := public.record_ad_impression(null, pub); reset role;
  insert into t12i values ('T2.3 null serve_ref = rejected', res ->> 'outcome' = 'rejected', res::text);
  set local role service_role; res := public.record_ad_impression(ref, other_pub); reset role;
  insert into t12i values ('T2.4 another publisher cannot report this serve = rejected', res ->> 'outcome' = 'rejected', res::text);
  set local role service_role; res := public.record_ad_impression(ref, null); reset role;
  insert into t12i values ('T2.5 null publisher = rejected', res ->> 'outcome' = 'rejected', res::text);
  set local role service_role; res := public.record_ad_impression(old_ref, pub); reset role;
  insert into t12i values ('T2.6 serve older than 24 hours = rejected', res ->> 'outcome' = 'rejected', res::text);

  set local role service_role; lk := public.lookup_serve_for_event(ref); reset role;
  insert into t12i values ('T2.7 lookup returns exactly outcome + publisher_id + served_at',
    lk ->> 'outcome' = 'found' and (select array_agg(k order by k) from jsonb_object_keys(lk) k) = array['outcome', 'publisher_id', 'served_at'], lk::text);
  set local role service_role; lk := public.lookup_serve_for_event('bsr_' || repeat('1', 40)); reset role;
  insert into t12i values ('T2.8 lookup of an unknown ref = not_found', lk = jsonb_build_object('outcome', 'not_found'), lk::text);

  select count(*) into after_n from public.ad_events;
  insert into t12i values ('T2.9 none of the rejected calls wrote anything', before_n = after_n, before_n::text || ' -> ' || after_n::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12i order by test;
rollback;


-- ===================== T3 : permissions + no second charge =====================
begin;
create temp table t12i (test text, passed boolean, got text);

do $do$
declare
  ref text; pub uuid; camp uuid; spend_before numeric; spend_after numeric; serves_before bigint; serves_after bigint; r text; role_name text;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming'
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning serve_ref, publisher_id, campaign_id into ref, pub, camp;
  if ref is null then raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao'; end if;

  select coalesce(sum(spent), 0) into spend_before from public.campaign_spend_daily where campaign_id = camp;
  select count(*) into serves_before from public.ad_serve_log;

  set local role service_role;
  perform public.record_ad_impression(ref, pub);
  reset role;

  select coalesce(sum(spent), 0) into spend_after from public.campaign_spend_daily where campaign_id = camp;
  select count(*) into serves_after from public.ad_serve_log;
  insert into t12i values ('T3.1 an impression does NOT charge again (campaign spend unchanged)', spend_before = spend_after, spend_before::text || ' -> ' || spend_after::text);
  insert into t12i values ('T3.2 an impression does not create a serve', serves_before = serves_after, serves_before::text || ' -> ' || serves_after::text);

  foreach role_name in array array['anon', 'authenticated'] loop
    execute format('set local role %I', role_name);
    begin
      perform public.record_ad_impression(ref, pub);
      r := 'OK';
    exception when others then r := sqlstate;
    end;
    reset role;
    insert into t12i values ('T3.3 ' || role_name || ' cannot call record_ad_impression (42501)', r = '42501', r);

    execute format('set local role %I', role_name);
    begin
      perform public.lookup_serve_for_event(ref);
      r := 'OK';
    exception when others then r := sqlstate;
    end;
    reset role;
    insert into t12i values ('T3.4 ' || role_name || ' cannot call lookup_serve_for_event (42501)', r = '42501', r);
  end loop;

  set local role service_role;
  begin
    perform count(*) from public.ad_events;
    r := 'OK';
  exception when others then r := sqlstate;
  end;
  reset role;
  insert into t12i values ('T3.5 service_role still has NO direct table access to ad_events (only the function writes)', r = '42501', r);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12i order by test;
rollback;
