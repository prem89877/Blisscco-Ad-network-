-- =====================================================================
-- BLISSCCO | Day 12 | Part 3 : day-12-5 ke BAAD ki READ-ONLY jaanch (kuch likhta/badalta nahi, sirf SELECT)
-- Pehle day-12-5-serve-ref-return.sql chali ho. Test (denim) aur asli dono par chala sakte ho.
-- Ek hi select: har row = ek check. Expect: poori passed column = true (koi false nahi).
-- (Ye file kisi database par chalayi NAHI gayi hai.)
-- =====================================================================

with checks(check_name, passed, detail) as (
  values
  ('ad_serve_requests.serve_id exists (nullable bigint)',
    coalesce((select data_type = 'bigint' and is_nullable = 'YES' from information_schema.columns
      where table_schema = 'public' and table_name = 'ad_serve_requests' and column_name = 'serve_id'), false),
    'retry-key -> serve row link'),
  ('ad_serve_requests.serve_id FK is ON DELETE SET NULL (purge can never be blocked)',
    exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_requests'::regclass
      and conname = 'ad_serve_requests_serve_id_fkey' and contype = 'f' and confdeltype = 'n'),
    'ad_serve_requests_serve_id_fkey'),
  ('record_ad_serve: both overloads exist, security definer',
    (select count(*) = 2 and bool_and(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_ad_serve'),
    '3 args + 4 args'),
  ('record_ad_serve: both overloads return serve_ref',
    (select count(*) = 2 and bool_and(position('serve_ref' in prosrc) > 0) from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'record_ad_serve'),
    'serve_ref in result'),
  ('record_ad_serve: neither overload touches ad_events (a serve is not an impression)',
    (select bool_and(position('ad_events' in prosrc) = 0) from pg_proc
      where pronamespace = 'public'::regnamespace and proname = 'record_ad_serve'),
    'no event writes'),
  ('record_ad_serve 3-arg still enforces budget + writes spend, serve log and daily counter (billing logic present)',
    (select position('campaign_spend_daily' in prosrc) > 0 and position('v_spent_total + v_unit > v_total' in prosrc) > 0
        and position('insert into public.ad_serve_log' in prosrc) > 0 and position('insert into public.creative_serve_daily' in prosrc) > 0
       from pg_proc where oid = 'public.record_ad_serve(text, uuid, text)'::regprocedure),
    'unchanged billing statements'),
  ('record_ad_serve 4-arg still takes the advisory lock and replays before charging',
    (select position('pg_advisory_xact_lock' in prosrc) > 0 and position('private.replay_serve' in prosrc) > 0
       from pg_proc where oid = 'public.record_ad_serve(text, uuid, text, text)'::regprocedure),
    'retry cannot charge twice'),
  ('replay_serve + find_idempotent_serve return serve_ref',
    (select count(*) = 2 and bool_and(position('serve_ref' in prosrc) > 0) from pg_proc
      where pronamespace in ('public'::regnamespace, 'private'::regnamespace) and proname in ('replay_serve', 'find_idempotent_serve')),
    '2 functions'),
  ('record_ad_serve / find_idempotent_serve: only service_role (+ owner) can execute; anon, authenticated, PUBLIC cannot',
    (select count(*) = 0 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.pronamespace = 'public'::regnamespace and p.proname in ('record_ad_serve', 'find_idempotent_serve')
         and a.grantee <> p.proowner and a.grantee <> coalesce((select oid from pg_roles where rolname = 'service_role'), 0)),
    'ACL entries for other roles must be 0'),
  ('every retry-key link points to a serve of the same publisher, creative and campaign',
    (select count(*) = 0 from public.ad_serve_requests q join public.ad_serve_log s on s.id = q.serve_id
       where s.publisher_id <> q.publisher_id or s.creative_id <> q.creative_id or s.campaign_id <> q.campaign_id),
    'attribution of linked retry keys'),
  ('no two retry keys share one serve row (one key = one serve)',
    (select count(*) = 0 from (select serve_id from public.ad_serve_requests where serve_id is not null group by 1 having count(*) > 1) d),
    'serve_id unique among linked rows')
)
select check_name, passed, case when passed then 'PASS' else 'FAIL' end as status, detail from checks order by passed, check_name;
