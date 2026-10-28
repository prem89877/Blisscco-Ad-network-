-- =====================================================================
-- BLISSCCO | Day 12 | Part 2 : migration ke BAAD ki READ-ONLY jaanch (kuch likhta/badalta nahi, sirf SELECT)
-- Pehle day-12-1-serve-ref.sql aur day-12-2-ad-events.sql chali hon. Test (denim) aur asli dono par chala sakte ho.
-- Ek hi select hai: har row = ek check. Expect: poori status column = PASS (koi FAIL nahi).
-- (Ye file kisi database par chalayi NAHI gayi hai.)
-- =====================================================================

with checks(check_name, passed, detail) as (
  values
  -- ---- serve_ref (migration 1) ----
  ('serve_ref column exists, nullable text',
    (select data_type = 'text' and is_nullable = 'YES' from information_schema.columns
      where table_schema = 'public' and table_name = 'ad_serve_log' and column_name = 'serve_ref'),
    'ad_serve_log.serve_ref'),
  ('serve_ref has default (bsr_ ...)',
    coalesce((select column_default like '%bsr_%' from information_schema.columns
      where table_schema = 'public' and table_name = 'ad_serve_log' and column_name = 'serve_ref'), false),
    'new serves get a reference automatically'),
  ('serve_ref unique index exists',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'ad_serve_log_serve_ref_key'),
    'ad_serve_log_serve_ref_key'),
  ('serve_ref format check exists',
    exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_serve_ref_format'),
    'bsr_ + 40 hex'),
  ('serve_ref required check exists (NOT VALID is expected until legacy rows are purged)',
    exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_serve_ref_required'),
    (select 'convalidated=' || convalidated::text from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_serve_ref_required')),
  ('attribution unique key exists',
    exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_attribution_key' and contype = 'u'),
    'unique (id, publisher_id, creative_id, campaign_id)'),
  ('no serve_ref values are malformed or duplicated',
    (select count(*) = 0 from public.ad_serve_log where serve_ref is not null and serve_ref !~ '^bsr_[0-9a-f]{40}$')
      and (select count(*) = 0 from (select serve_ref from public.ad_serve_log where serve_ref is not null group by 1 having count(*) > 1) d),
    'format + uniqueness of existing values'),

  -- ---- ad_events (migration 2) ----
  ('ad_events table exists with RLS on',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ad_events')), false),
    'row level security'),
  ('ad_events: nobody except the owner has any table privilege (PUBLIC, anon, authenticated, service_role all revoked)',
    (select count(*) = 0 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = to_regclass('public.ad_events') and a.grantee <> c.relowner),
    'ACL entries for non-owners must be 0'),
  ('ad_events: no RLS policies (deny all by default)',
    (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename = 'ad_events'),
    'policy count must be 0'),
  ('ad_events: composite attribution FK exists (RESTRICT)',
    exists (select 1 from pg_constraint where conrelid = to_regclass('public.ad_events') and conname = 'ad_events_serve_attribution_fk' and contype = 'f' and confdeltype = 'r'),
    'serve_id + publisher + creative + campaign -> ad_serve_log'),
  ('ad_events: dedupe constraints exist',
    (select count(*) = 2 from pg_constraint where conrelid = to_regclass('public.ad_events') and conname in ('ad_events_event_id_key', 'ad_events_one_per_type_key') and contype = 'u')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'ad_events_source_external_key'),
    'event_id, (serve_id,event_type), (source,external_event_id)'),
  ('ad_events: CHECK constraints exist',
    (select count(*) = 4 from pg_constraint where conrelid = to_regclass('public.ad_events') and contype = 'c'
       and conname in ('ad_events_type_check', 'ad_events_source_check', 'ad_events_external_id_check', 'ad_events_not_future_check')),
    'type, source, external id, not-future'),
  ('ad_events: guard trigger enabled',
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.ad_events') and tgname = 'ad_events_guard' and not tgisinternal and tgenabled = 'O'),
    'append-only + not before serve'),
  ('ad_events: id sequence has no privileges for anyone except the owner',
    (select count(*) = 0 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
       where c.oid = 'public.ad_events_id_seq'::regclass and a.grantee <> c.relowner),
    'ad_events_id_seq'),
  ('ad_events: contains NO personal/prompt columns',
    (select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name = 'ad_events'
       and column_name ~* '(prompt|message|(^|_)ip(_|$)|ip_address|user_agent|useragent|(^|_)ua(_|$)|user_id|email|referrer|referer|cookie|fingerprint|conversation)'),
    'allowed columns only: id, event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at, received_at'),
  ('ad_events: exactly the expected columns',
    (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'ad_events')
      = 'campaign_id,creative_id,event_id,event_type,external_event_id,id,occurred_at,publisher_id,received_at,serve_id,source',
    'column list'),

  -- ---- retention ----
  ('purge function exists, security definer, no grant to app roles',
    exists (select 1 from pg_proc where oid = 'private.purge_old_ad_logs(integer)'::regprocedure and prosecdef)
      and not exists (select 1 from information_schema.routine_privileges
                       where routine_schema = 'private' and routine_name = 'purge_old_ad_logs' and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role')),
    'private.purge_old_ad_logs(integer)'),
  ('purge function deletes ad_events before ad_serve_log and still handles spend-safe tables',
    (select position('delete from public.ad_events' in prosrc) > 0
        and position('delete from public.ad_events' in prosrc) < position('delete from public.ad_serve_log' in prosrc)
        and position('delete from public.ad_serve_requests' in prosrc) > 0
        and position('delete from public.campaign_spend_daily' in prosrc) = 0
       from pg_proc where oid = 'private.purge_old_ad_logs(integer)'::regprocedure),
    'campaign_spend_daily is never purged'),

  -- ---- billing / serve unchanged ----
  ('record_ad_serve (3 and 4 args) does not mention events or serve_ref (billing untouched)',
    (select count(*) = 2 and bool_and(position('ad_events' in prosrc) = 0 and position('serve_ref' in prosrc) = 0)
       from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_ad_serve'),
    'both overloads present and unchanged'),
  ('no function writes to ad_events yet (writer comes in a later part)',
    (select count(*) = 0 from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and proname <> 'purge_old_ad_logs' and prosrc ilike '%insert into public.ad_events%'),
    'ad_events has no writer function in this part'),

  -- ---- data sanity (read-only) ----
  ('every event matches its serve (publisher/campaign/creative)',
    (select count(*) = 0 from public.ad_events e join public.ad_serve_log s on s.id = e.serve_id
       where (s.publisher_id, s.campaign_id, s.creative_id) is distinct from (e.publisher_id, e.campaign_id, e.creative_id)),
    'mismatch count must be 0'),
  ('no click/impression without a serve (orphans)',
    (select count(*) = 0 from public.ad_events e where not exists (select 1 from public.ad_serve_log s where s.id = e.serve_id)),
    'orphan count must be 0')
)
select check_name, case when passed then 'PASS' else 'FAIL' end as status, detail
from checks
order by (case when passed then 1 else 0 end), check_name;

-- Info (alag select, sirf dekhne ke liye): purani serves jinke paas serve_ref nahi (expected: migration se pehle ki rows)
--   select count(*) filter (where serve_ref is null) as legacy_without_ref, count(*) filter (where serve_ref is not null) as with_ref from public.ad_serve_log;
-- Info: events ginti type ke hisaab se
--   select event_type, count(*) from public.ad_events group by 1 order by 1;
