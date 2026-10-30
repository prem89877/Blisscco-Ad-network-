-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 12 | Part 2 : ad_events + serve_ref ke SQL tests (HAR BLOCK ROLLBACK-ONLY: kuch save nahi hota)
-- (Maine ye SQL kisi database par CHALAYA NAHI: sandbox me Postgres nahi hai. Jab tak tum khud chalakar expected
--  result na dekh lo, inhe "pass" mat maanna.)
--
-- SIRF TEST project (denim) par chalao. ASLI (blisscco ad network) par NAHI.
-- Pehle: day-12-1-serve-ref.sql aur day-12-2-ad-events.sql chal chuki hon, aur day-3-6 ka SETUP block chala ho
--   (TEST Publisher C, TEST Campaign A, TEST creative A, TEST Campaign B). Ye tests wahi TEST rows use karte hain.
-- Har block ALAG se chalao (editor saaf karke ek block paste karo). SQL Editor sirf AAKHRI select dikhata hai.
-- Har block ka result: table (test, status, got). Expect: status = PASS har row me. "got" = Postgres error code (23505 = duplicate,
--   23503 = galat reference, 23514 = rule/CHECK, 42501 = permission denied) ya OK.
-- Har block "rollback" par khatam hota hai, isliye jo serve/event/delete banta hai wo wapas ho jata hai.
-- Agar kisi block me beech me ERROR aa jaye (fixtures missing, typo), toh pehle `rollback;` chalao, phir aage badho.
-- =====================================================================


-- ===================== T1 : serve_ref (auto, unique, format, null nahi) =====================
begin;
create temp table t12 (test text, passed boolean, got text);

create function pg_temp.t12_try(p_sql text) returns text language plpgsql as $fn$
declare v_con text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  return sqlstate || ' ' || coalesce(v_con, '');
end
$fn$;

create function pg_temp.t12_serve(p_ago interval default interval '0') returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning id into v_id;
  if v_id is null then
    raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao';
  end if;
  return v_id;
end
$fn$;

do $do$
declare
  a bigint; b bigint; ra text; rb text; r text;
begin
  a := pg_temp.t12_serve();
  b := pg_temp.t12_serve();
  select serve_ref into ra from public.ad_serve_log where id = a;
  select serve_ref into rb from public.ad_serve_log where id = b;

  insert into t12 values ('T1.1 new serve gets bsr_ + 40 hex serve_ref automatically (record_ad_serve ko badalna nahi pada)', ra ~ '^bsr_[0-9a-f]{40}$', ra);
  insert into t12 values ('T1.2 two serves get different serve_ref', ra is distinct from rb, ra || ' / ' || rb);

  r := pg_temp.t12_try(format('update public.ad_serve_log set serve_ref = %L where id = %s', ra, b));
  insert into t12 values ('T1.3 duplicate serve_ref is rejected (unique)', r like '23505%', r);

  r := pg_temp.t12_try(format('update public.ad_serve_log set serve_ref = %L where id = %s', 'abc', b));
  insert into t12 values ('T1.4 malformed serve_ref is rejected (format check)', r like '23514%', r);

  r := pg_temp.t12_try(format($q$insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, serve_ref)
                                 select s.publisher_id, s.creative_id, s.campaign_id, 'gaming', null from public.ad_serve_log s where s.id = %s$q$, a));
  insert into t12 values ('T1.5 NEW serve with explicit NULL serve_ref is rejected (required check, NOT VALID but enforced for new rows)', r like '23514%', r);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12 order by test;
rollback;


-- ===================== T2 : serve / impression / click alag events, ek serve par teeno ban sakte hain =====================
begin;
create temp table t12 (test text, passed boolean, got text);

create function pg_temp.t12_try(p_sql text) returns text language plpgsql as $fn$
declare v_con text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  return sqlstate || ' ' || coalesce(v_con, '');
end
$fn$;

create function pg_temp.t12_serve(p_ago interval default interval '0') returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning id into v_id;
  if v_id is null then
    raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao';
  end if;
  return v_id;
end
$fn$;

create function pg_temp.t12_ev(p_serve bigint, p_type text, p_source text default 'blisscco_beacon', p_ext text default null,
                               p_offset interval default interval '10 seconds', p_event uuid default gen_random_uuid())
returns text language plpgsql as $fn$
begin
  return pg_temp.t12_try(format(
    $q$insert into public.ad_events (event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at)
       select %L::uuid, s.id, s.publisher_id, s.campaign_id, s.creative_id, %L, %L, %L, s.served_at + %L::interval
       from public.ad_serve_log s where s.id = %s$q$,
    p_event, p_type, p_source, p_ext, p_offset::text, p_serve));
end
$fn$;

do $do$
declare
  s bigint; r1 text; r2 text; r3 text; n int; spend_before numeric; spend_after numeric;
begin
  s := pg_temp.t12_serve();
  spend_before := (select coalesce(sum(spent), 0) from public.campaign_spend_daily);

  r1 := pg_temp.t12_ev(s, 'serve');
  r2 := pg_temp.t12_ev(s, 'impression');
  r3 := pg_temp.t12_ev(s, 'click', 'blisscco_redirect');
  insert into t12 values ('T2.1 serve, impression and click can each be recorded once for the same serve', r1 = 'OK' and r2 = 'OK' and r3 = 'OK', r1 || ',' || r2 || ',' || r3);

  select count(distinct event_type) into n from public.ad_events where serve_id = s;
  insert into t12 values ('T2.2 three distinct event types are stored (not interchangeable)', n = 3, n::text);

  select count(*) into n from public.ad_events e join public.ad_serve_log l on l.id = e.serve_id
   where e.serve_id = s and e.publisher_id = l.publisher_id and e.campaign_id = l.campaign_id and e.creative_id = l.creative_id;
  insert into t12 values ('T2.3 every event carries the serve''s own publisher, campaign and creative', n = 3, n::text);

  spend_after := (select coalesce(sum(spent), 0) from public.campaign_spend_daily);
  insert into t12 values ('T2.4 recording events does not touch spend/billing', spend_before = spend_after, spend_before::text || ' -> ' || spend_after::text);

  select count(*) into n from public.ad_events where serve_id = s and event_type = 'impression';
  insert into t12 values ('T2.5 a serve alone never creates an impression (only the explicit impression event exists)', n = 1, n::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12 order by test;
rollback;


-- ===================== T3 : duplicate events =====================
begin;
create temp table t12 (test text, passed boolean, got text);

create function pg_temp.t12_try(p_sql text) returns text language plpgsql as $fn$
declare v_con text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  return sqlstate || ' ' || coalesce(v_con, '');
end
$fn$;

create function pg_temp.t12_serve(p_ago interval default interval '0') returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning id into v_id;
  if v_id is null then
    raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao';
  end if;
  return v_id;
end
$fn$;

create function pg_temp.t12_ev(p_serve bigint, p_type text, p_source text default 'blisscco_beacon', p_ext text default null,
                               p_offset interval default interval '10 seconds', p_event uuid default gen_random_uuid())
returns text language plpgsql as $fn$
begin
  return pg_temp.t12_try(format(
    $q$insert into public.ad_events (event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at)
       select %L::uuid, s.id, s.publisher_id, s.campaign_id, s.creative_id, %L, %L, %L, s.served_at + %L::interval
       from public.ad_serve_log s where s.id = %s$q$,
    p_event, p_type, p_source, p_ext, p_offset::text, p_serve));
end
$fn$;

do $do$
declare
  s1 bigint; s2 bigint; s3 bigint; s4 bigint; s5 bigint; e uuid := gen_random_uuid(); r text; n int;
begin
  s1 := pg_temp.t12_serve(); s2 := pg_temp.t12_serve(); s3 := pg_temp.t12_serve(); s4 := pg_temp.t12_serve(); s5 := pg_temp.t12_serve();

  r := pg_temp.t12_ev(s1, 'impression');
  insert into t12 values ('T3.1 first impression for a serve is accepted', r = 'OK', r);

  r := pg_temp.t12_ev(s1, 'impression');
  insert into t12 values ('T3.2 second impression for the same serve is rejected (one impression per serve)', r = '23505 ad_events_one_per_type_key', r);

  r := pg_temp.t12_ev(s1, 'click');
  r := pg_temp.t12_ev(s1, 'click', 'blisscco_redirect');
  insert into t12 values ('T3.3 second click for the same serve is rejected (one click per serve)', r = '23505 ad_events_one_per_type_key', r);

  r := pg_temp.t12_ev(s2, 'impression', p_event => e);
  r := pg_temp.t12_ev(s3, 'impression', p_event => e);
  insert into t12 values ('T3.4 reusing the same event_id on another serve is rejected (event_id unique)', r = '23505 ad_events_event_id_key', r);

  r := pg_temp.t12_ev(s2, 'click', 'external', 'ext-1');
  insert into t12 values ('T3.5 external event with an external id is accepted once', r = 'OK', r);

  r := pg_temp.t12_ev(s3, 'click', 'external', 'ext-1');
  insert into t12 values ('T3.6 the same (source, external_event_id) replayed on another serve is rejected', r = '23505 ad_events_source_external_key', r);

  r := pg_temp.t12_ev(s3, 'click', 'publisher_server', 'ext-1');
  insert into t12 values ('T3.7 the same external id from a different source is a different event (accepted)', r = 'OK', r);

  r := pg_temp.t12_ev(s4, 'impression') || ',' || pg_temp.t12_ev(s5, 'impression');
  insert into t12 values ('T3.8 events without an external id never collide with each other', r = 'OK,OK', r);

  select count(*) into n from public.ad_events where serve_id = s1;
  insert into t12 values ('T3.9 after all the duplicate attempts serve 1 still has exactly 1 impression and 1 click', n = 2, n::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12 order by test;
rollback;


-- ===================== T4 : galat references, galat values, append-only, restrict =====================
begin;
create temp table t12 (test text, passed boolean, got text);

create function pg_temp.t12_try(p_sql text) returns text language plpgsql as $fn$
declare v_con text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  return sqlstate || ' ' || coalesce(v_con, '');
end
$fn$;

create function pg_temp.t12_serve(p_ago interval default interval '0') returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning id into v_id;
  if v_id is null then
    raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao';
  end if;
  return v_id;
end
$fn$;

create function pg_temp.t12_ev(p_serve bigint, p_type text, p_source text default 'blisscco_beacon', p_ext text default null,
                               p_offset interval default interval '10 seconds', p_event uuid default gen_random_uuid())
returns text language plpgsql as $fn$
begin
  return pg_temp.t12_try(format(
    $q$insert into public.ad_events (event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at)
       select %L::uuid, s.id, s.publisher_id, s.campaign_id, s.creative_id, %L, %L, %L, s.served_at + %L::interval
       from public.ad_serve_log s where s.id = %s$q$,
    p_event, p_type, p_source, p_ext, p_offset::text, p_serve));
end
$fn$;

create function pg_temp.t12_raw(p_serve bigint, p_pub uuid, p_camp uuid, p_cr uuid, p_type text) returns text language plpgsql as $fn$
begin
  return pg_temp.t12_try(format(
    $q$insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at)
       values (%s, %L, %L, %L, %L, 'blisscco_beacon', now())$q$,
    p_serve, p_pub, p_camp, p_cr, p_type));
end
$fn$;

do $do$
declare
  s bigint; pub uuid; camp uuid; cr uuid; other_camp uuid; other_pub uuid; r text; n int;
begin
  s := pg_temp.t12_serve();
  select publisher_id, campaign_id, creative_id into pub, camp, cr from public.ad_serve_log where id = s;
  select id into other_camp from public.campaigns where name = 'TEST Campaign B';
  select id into other_pub from public.publishers where name = 'TEST Publisher D';

  r := pg_temp.t12_raw(-1, pub, camp, cr, 'impression');
  insert into t12 values ('T4.1 event for a serve that does not exist is rejected', r = '23503 ad_events_serve_attribution_fk', r);

  r := pg_temp.t12_raw(s, gen_random_uuid(), camp, cr, 'impression');
  insert into t12 values ('T4.2 wrong publisher (random id) for a real serve is rejected', r = '23503 ad_events_serve_attribution_fk', r);

  r := pg_temp.t12_raw(s, coalesce(other_pub, gen_random_uuid()), camp, cr, 'impression');
  insert into t12 values ('T4.3 wrong publisher (another real publisher) for a real serve is rejected', r = '23503 ad_events_serve_attribution_fk', r);

  r := pg_temp.t12_raw(s, pub, coalesce(other_camp, gen_random_uuid()), cr, 'impression');
  insert into t12 values ('T4.4 wrong campaign for a real serve is rejected', r = '23503 ad_events_serve_attribution_fk', r);

  r := pg_temp.t12_raw(s, pub, camp, gen_random_uuid(), 'impression');
  insert into t12 values ('T4.5 wrong creative for a real serve is rejected', r = '23503 ad_events_serve_attribution_fk', r);

  r := pg_temp.t12_ev(s, 'view');
  insert into t12 values ('T4.6 unknown event_type is rejected', r = '23514 ad_events_type_check', r);

  r := pg_temp.t12_ev(s, 'impression', 'some_other_source');
  insert into t12 values ('T4.7 unknown source is rejected', r = '23514 ad_events_source_check', r);

  r := pg_temp.t12_ev(s, 'impression', 'external', 'has space');
  insert into t12 values ('T4.8 external id with unsafe characters is rejected', r = '23514 ad_events_external_id_check', r);

  r := pg_temp.t12_ev(s, 'impression', p_offset => interval '1 hour');
  insert into t12 values ('T4.9 event time in the future is rejected', r = '23514 ad_events_not_future_check', r);

  r := pg_temp.t12_ev(s, 'impression', p_offset => interval '-1 hour');
  insert into t12 values ('T4.10 event before its own serve is rejected (guard trigger)', r like '23514%', r);

  select count(*) into n from public.ad_events where serve_id = s;
  insert into t12 values ('T4.11 none of the rejected attempts left a row behind', n = 0, n::text);

  r := pg_temp.t12_ev(s, 'impression');
  r := pg_temp.t12_try(format('update public.ad_events set event_type = %L where serve_id = %s', 'click', s));
  insert into t12 values ('T4.12 events are append-only: UPDATE is rejected', r like '23514%', r);

  r := pg_temp.t12_try(format('delete from public.ad_serve_log where id = %s', s));
  insert into t12 values ('T4.13 a serve that has events cannot be deleted directly (RESTRICT)', r like '23503%', r);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12 order by test;
rollback;


-- ===================== T5 : unauthorized access (anon / authenticated / service_role) =====================
-- Expect: har role ke liye har operation 42501 (permission denied). ALLOWED dikhe toh FAIL.
begin;
create temp table t12 (test text, passed boolean, got text);

create function pg_temp.t12_try(p_sql text) returns text language plpgsql as $fn$
declare v_con text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  return sqlstate || ' ' || coalesce(v_con, '');
end
$fn$;

create function pg_temp.t12_serve(p_ago interval default interval '0') returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning id into v_id;
  if v_id is null then
    raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao';
  end if;
  return v_id;
end
$fn$;

create function pg_temp.t12_ev(p_serve bigint, p_type text, p_source text default 'blisscco_beacon', p_ext text default null,
                               p_offset interval default interval '10 seconds', p_event uuid default gen_random_uuid())
returns text language plpgsql as $fn$
begin
  return pg_temp.t12_try(format(
    $q$insert into public.ad_events (event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at)
       select %L::uuid, s.id, s.publisher_id, s.campaign_id, s.creative_id, %L, %L, %L, s.served_at + %L::interval
       from public.ad_serve_log s where s.id = %s$q$,
    p_event, p_type, p_source, p_ext, p_offset::text, p_serve));
end
$fn$;

do $do$
declare
  s bigint; pub uuid; camp uuid; cr uuid; res text; rl text; i int;
  roles text[] := array['anon', 'authenticated', 'service_role'];
  labels text[]; sqls text[];
  out_label text[] := '{}'; out_res text[] := '{}';
begin
  s := pg_temp.t12_serve();
  select publisher_id, campaign_id, creative_id into pub, camp, cr from public.ad_serve_log where id = s;
  res := pg_temp.t12_ev(s, 'impression');
  if res <> 'OK' then
    raise exception 'fixture event insert failed: %', res;
  end if;

  labels := array['select ad_events', 'insert ad_events', 'update ad_events', 'delete ad_events', 'select ad_serve_log', 'run private.purge_old_ad_logs'];
  sqls := array[
    'select count(*) from public.ad_events',
    format('insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at) values (%s, %L, %L, %L, %L, %L, now())', s, pub, camp, cr, 'click', 'blisscco_beacon'),
    'update public.ad_events set source = ''external''',
    'delete from public.ad_events',
    'select count(*) from public.ad_serve_log',
    'select private.purge_old_ad_logs(90)'
  ];

  foreach rl in array roles loop
    execute format('set local role %I', rl);
    for i in 1 .. array_length(labels, 1) loop
      begin
        execute sqls[i];
        res := 'ALLOWED';
      exception when others then
        res := sqlstate;
      end;
      out_label := out_label || (rl || ': ' || labels[i]);
      out_res := out_res || res;
    end loop;
    reset role;
  end loop;

  for i in 1 .. array_length(out_label, 1) loop
    insert into t12 values ('T5 ' || out_label[i], out_res[i] = '42501', out_res[i]);
  end loop;
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12 order by test;
rollback;


-- ===================== T6 : retention (events serve ke saath purge, spend nahi chhuta, minimum 30 din) =====================
-- Dhyan: purge function is block me test project ke SAARE purane logs bhi delete karega, par rollback se sab wapas aa jata hai.
begin;
create temp table t12 (test text, passed boolean, got text);

create function pg_temp.t12_try(p_sql text) returns text language plpgsql as $fn$
declare v_con text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  return sqlstate || ' ' || coalesce(v_con, '');
end
$fn$;

create function pg_temp.t12_serve(p_ago interval default interval '0') returns bigint language plpgsql as $fn$
declare v_id bigint;
begin
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at)
  select (select id from public.publishers where name = 'TEST Publisher C'), x.id, x.campaign_id, 'gaming', now() - p_ago
  from public.ad_creatives x where x.headline = 'TEST creative A'
  returning id into v_id;
  if v_id is null then
    raise exception 'Fixtures missing: day-3-6 SETUP block pehle chalao';
  end if;
  return v_id;
end
$fn$;

create function pg_temp.t12_ev(p_serve bigint, p_type text, p_source text default 'blisscco_beacon', p_ext text default null,
                               p_offset interval default interval '10 seconds', p_event uuid default gen_random_uuid())
returns text language plpgsql as $fn$
begin
  return pg_temp.t12_try(format(
    $q$insert into public.ad_events (event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at)
       select %L::uuid, s.id, s.publisher_id, s.campaign_id, s.creative_id, %L, %L, %L, s.served_at + %L::interval
       from public.ad_serve_log s where s.id = %s$q$,
    p_event, p_type, p_source, p_ext, p_offset::text, p_serve));
end
$fn$;

do $do$
declare
  s_old bigint; s_40 bigint; s_20 bigint; s_new bigint;
  r text; j jsonb; spend_before numeric; spend_after numeric; n int;
begin
  s_old := pg_temp.t12_serve(interval '100 days');
  s_40  := pg_temp.t12_serve(interval '40 days');
  s_20  := pg_temp.t12_serve(interval '20 days');
  s_new := pg_temp.t12_serve();
  r := pg_temp.t12_ev(s_old, 'impression') || ',' || pg_temp.t12_ev(s_old, 'click')
    || ',' || pg_temp.t12_ev(s_40, 'impression') || ',' || pg_temp.t12_ev(s_20, 'impression') || ',' || pg_temp.t12_ev(s_new, 'impression');
  insert into t12 values ('T6.0 fixture events inserted', r = 'OK,OK,OK,OK,OK', r);

  spend_before := (select coalesce(sum(spent), 0) from public.campaign_spend_daily);

  j := private.purge_old_ad_logs(90);

  insert into t12 values ('T6.1 purge result reports ad_events', j ? 'ad_events' and (j ->> 'ad_events')::int >= 2, j::text);

  select count(*) into n from public.ad_events where serve_id = s_old;
  insert into t12 values ('T6.2 events of a 100-day-old serve are purged', n = 0, n::text);

  select count(*) into n from public.ad_serve_log where id = s_old;
  insert into t12 values ('T6.3 the 100-day-old serve itself is purged (no FK error: events were removed first)', n = 0, n::text);

  select count(*) into n from public.ad_events where serve_id in (s_40, s_20, s_new);
  insert into t12 values ('T6.4 events of recent serves (40, 20, 0 days) are kept at 90 days retention', n = 3, n::text);

  j := private.purge_old_ad_logs(1);   -- minimum 30 din: 1 maanga toh bhi 30 hi lagu

  select count(*) into n from public.ad_events where serve_id = s_40;
  insert into t12 values ('T6.5 keep_days below 30 is clamped to 30: the 40-day-old serve and its event are purged', n = 0 and not exists (select 1 from public.ad_serve_log where id = s_40), n::text);

  select count(*) into n from public.ad_events where serve_id in (s_20, s_new);
  insert into t12 values ('T6.6 keep_days=1 did NOT purge the 20-day and fresh events (clamp to 30 days works)', n = 2, n::text);

  spend_after := (select coalesce(sum(spent), 0) from public.campaign_spend_daily);
  insert into t12 values ('T6.7 purge never touches campaign_spend_daily', spend_before = spend_after, spend_before::text || ' -> ' || spend_after::text);
end
$do$;

select test, case when passed then 'PASS' else 'FAIL' end as status, got from t12 order by test;
rollback;


-- ===================== T7 : record_ad_serve ABHI BHI pehle jaisa (billing + response same), serve_ref sirf DB me, impression nahi =====================
-- Ye block TEST project par asli record_ad_serve (3-arg) chalata hai (service_role ke roop me), day-9-6 ke T1 jaisa setup. Rollback-only.
-- Expect (1 row): sab 6 columns = true
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select set_config('test.cid', (select id::text from public.ad_creatives where headline = 'TEST creative A'), true);
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
update public.campaigns set daily_budget = null, total_budget = 100 where name = 'TEST Campaign A';
set local role service_role;
select set_config('test.r', public.record_ad_serve(current_setting('test.hash'), current_setting('test.cid')::uuid, 'gaming')::text, true);
reset role;
select
  (current_setting('test.r')::jsonb ->> 'outcome') = 'ok' as outcome_ok,
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('test.r')::jsonb) k) = array['outcome'] as response_still_only_outcome,
  coalesce((select l.serve_ref ~ '^bsr_[0-9a-f]{40}$' from public.ad_serve_log l where l.creative_id = current_setting('test.cid')::uuid order by l.id desc limit 1), false) as serve_ref_set_by_default,
  (select count(*) = 0 from public.ad_events e where e.creative_id = current_setting('test.cid')::uuid) as serve_created_no_impression,
  (select sum(d.spent) from public.campaign_spend_daily d where d.campaign_id = (select id from public.campaigns where name = 'TEST Campaign A'))
    = greatest(round((select s.cpm_usd from public.ad_platform_settings s where s.id) / 1000.0, 4), 0.0001) as spend_is_exactly_one_unit,
  (select count(*) = 1 from public.ad_serve_log l where l.creative_id = current_setting('test.cid')::uuid and l.served_at >= now() - interval '1 minute') as one_serve_row;
rollback;
