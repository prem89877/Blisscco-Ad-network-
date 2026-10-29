-- =====================================================================
-- BLISSCCO | Day 12 | Part 4 : day-12-7 ke BAAD ki READ-ONLY jaanch (kuch likhta/badalta nahi, sirf SELECT)
-- Pehle day-12-7-record-ad-impression.sql chali ho. Test (denim) aur asli dono par chala sakte ho.
-- Ek hi select: har row = ek check. Expect: poori status column = PASS (koi FAIL nahi).
-- (Ye file kisi database par chalayi NAHI gayi hai.)
-- =====================================================================

with checks(check_name, passed, detail) as (
  values
  ('both functions exist and are security definer with an empty search_path',
    (select count(*) = 2 and bool_and(prosecdef) and bool_and(coalesce(proconfig::text, '') like '%search_path=""%')
       from pg_proc where pronamespace = 'public'::regnamespace and proname in ('lookup_serve_for_event', 'record_ad_impression')),
    'lookup_serve_for_event(text), record_ad_impression(text, uuid)'),
  ('only service_role may execute them (PUBLIC, anon, authenticated have no EXECUTE)',
    (select count(*) = 0 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.pronamespace = 'public'::regnamespace and p.proname in ('lookup_serve_for_event', 'record_ad_impression')
         and a.privilege_type = 'EXECUTE' and a.grantee not in (p.proowner, 'service_role'::regrole::oid)),
    'EXECUTE for anyone except owner and service_role must be 0'),
  ('service_role can execute both',
    (select count(*) = 2 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('lookup_serve_for_event', 'record_ad_impression')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')),
    'grant execute to service_role'),
  ('the impression writer inserts only impression rows, with ON CONFLICT DO NOTHING on the one-per-type constraint',
    (select position('insert into public.ad_events' in prosrc) > 0
        and position($$'impression'$$ in prosrc) > 0
        and position('on conflict on constraint ad_events_one_per_type_key do nothing' in prosrc) > 0
        and position($$'click'$$ in prosrc) = 0 and position($$'serve'$$ in prosrc) = 0
       from pg_proc where oid = 'public.record_ad_impression(text, uuid)'::regprocedure),
    'no click / serve rows, atomic dedupe'),
  ('the impression writer never touches spend or serve counters (no second charge)',
    (select position('campaign_spend_daily' in prosrc) = 0 and position('creative_serve_daily' in prosrc) = 0
        and position('update public.ad_serve_log' in prosrc) = 0 and position('insert into public.ad_serve_log' in prosrc) = 0
       from pg_proc where oid = 'public.record_ad_impression(text, uuid)'::regprocedure),
    'spend stays serve-based'),
  ('the impression writer takes its time from the database clock, not from the caller',
    (select position('now()' in prosrc) > 0 and position('p_occurred' in prosrc) = 0
       from pg_proc where oid = 'public.record_ad_impression(text, uuid)'::regprocedure),
    'occurred_at = now()'),
  ('the lookup is read-only (no insert/update/delete)',
    (select position('insert ' in lower(prosrc)) = 0 and position('update ' in lower(prosrc)) = 0 and position('delete ' in lower(prosrc)) = 0
        and provolatile = 's'
       from pg_proc where oid = 'public.lookup_serve_for_event(text)'::regprocedure),
    'stable, select only'),
  ('the lookup returns only publisher_id and served_at (no campaign, creative or sequential id)',
    (select position('campaign_id' in prosrc) = 0 and position('creative_id' in prosrc) = 0 and position('''publisher_id''' in prosrc) > 0
       from pg_proc where oid = 'public.lookup_serve_for_event(text)'::regprocedure),
    'minimal fields'),
  ('record_ad_serve (3 and 4 args) still does not mention ad_events (a serve is not an impression)',
    (select count(*) = 2 and bool_and(position('ad_events' in prosrc) = 0)
       from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_ad_serve'),
    'both overloads present; none touches ad_events'),
  ('the only function that inserts into ad_events (besides none) is record_ad_impression',
    (select count(*) = 0 from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and proname <> 'record_ad_impression' and prosrc ilike '%insert into public.ad_events%'),
    'single writer'),
  ('ad_events keeps the one-impression-per-serve unique constraint',
    exists (select 1 from pg_constraint where conrelid = to_regclass('public.ad_events') and conname = 'ad_events_one_per_type_key' and contype = 'u'),
    'unique (serve_id, event_type)'),

  -- ---- data sanity (read-only) ----
  ('no serve has more than one impression event',
    (select count(*) = 0 from (select serve_id from public.ad_events where event_type = 'impression' group by 1 having count(*) > 1) d),
    'duplicate impressions must be 0'),
  ('every impression event has a serve (and its attribution matches)',
    (select count(*) = 0 from public.ad_events e
       where e.event_type = 'impression'
         and not exists (select 1 from public.ad_serve_log s where s.id = e.serve_id and s.publisher_id = e.publisher_id
                           and s.campaign_id = e.campaign_id and s.creative_id = e.creative_id)),
    'orphan / mismatched impressions must be 0'),
  ('impressions never exceed serves',
    (select (select count(*) from public.ad_events where event_type = 'impression') <= (select count(*) from public.ad_serve_log)),
    'impressions <= serves')
)
select check_name, case when passed then 'PASS' else 'FAIL' end as status, detail
from checks
order by (case when passed then 1 else 0 end), check_name;

-- Info (alag select, sirf dekhne ke liye): serve vs impression ginti
--   select (select count(*) from public.ad_serve_log) as serves, (select count(*) from public.ad_events where event_type = 'impression') as impressions;
