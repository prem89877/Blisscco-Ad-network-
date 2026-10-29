-- =====================================================================
-- BLISSCCO | Day 12 | Prompt 5 Part 3 : day-12-10 ke BAAD ki READ-ONLY jaanch (kuch likhta/badalta nahi, sirf SELECT)
-- Pehle day-12-10-record-ad-click.sql chali ho. Test (denim) aur asli dono par chala sakte ho.
-- Ek hi select: har row = ek check. Expect: poori status column = PASS (koi FAIL nahi).
-- (Ye file kisi database par chalayi NAHI gayi hai.)
-- =====================================================================

with checks(check_name, passed, detail) as (
  values
  ('both public functions exist, security definer, empty search_path',
    (select count(*) = 2 and bool_and(prosecdef) and bool_and(coalesce('search_path=""' = any(proconfig), false))
       from pg_proc where pronamespace = 'public'::regnamespace and proname in ('lookup_serve_for_click', 'record_ad_click')),
    'lookup_serve_for_click(text), record_ad_click(text, uuid, uuid)'),
  ('only service_role may execute them (PUBLIC, anon, authenticated have no EXECUTE)',
    (select count(*) = 0 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.pronamespace = 'public'::regnamespace and p.proname in ('lookup_serve_for_click', 'record_ad_click')
         and a.privilege_type = 'EXECUTE' and a.grantee not in (p.proowner, 'service_role'::regrole::oid)),
    'EXECUTE for anyone except owner and service_role must be 0'),
  ('service_role can execute both',
    (select count(*) = 2 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('lookup_serve_for_click', 'record_ad_click')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')),
    'grant execute to service_role'),
  ('the private helper is not callable by service_role, anon or authenticated',
    (select count(*) = 1 and not bool_or(has_function_privilege('service_role', oid, 'EXECUTE'))
        and not bool_or(has_function_privilege('anon', oid, 'EXECUTE')) and not bool_or(has_function_privilege('authenticated', oid, 'EXECUTE'))
       from pg_proc where pronamespace = 'private'::regnamespace and proname = 'click_target'),
    'private.click_target(uuid)'),
  ('the click writer inserts only click rows from the redirect source, with ON CONFLICT DO NOTHING on the one-per-type constraint',
    (select position('insert into public.ad_events' in prosrc) > 0
        and position($$'click'$$ in prosrc) > 0 and position($$'blisscco_redirect'$$ in prosrc) > 0
        and position('on conflict on constraint ad_events_one_per_type_key do nothing' in prosrc) > 0
        and position($$'serve',$$ in prosrc) = 0
       from pg_proc where oid = 'public.record_ad_click(text, uuid, uuid)'::regprocedure),
    'atomic dedupe, one click per serve'),
  ('the click writer never touches spend or serve counters (no charge on click)',
    (select position('campaign_spend_daily' in prosrc) = 0 and position('creative_serve_daily' in prosrc) = 0
        and position('update public.ad_serve_log' in prosrc) = 0 and position('insert into public.ad_serve_log' in prosrc) = 0
       from pg_proc where oid = 'public.record_ad_click(text, uuid, uuid)'::regprocedure),
    'spend stays serve-based'),
  ('the click writer takes its time from the database clock, not from the caller',
    (select position('now()' in prosrc) > 0 and position('p_occurred' in prosrc) = 0
       from pg_proc where oid = 'public.record_ad_click(text, uuid, uuid)'::regprocedure),
    'occurred_at = now()'),
  ('the lookup is read-only and stable',
    (select position('insert ' in lower(prosrc)) = 0 and position('update ' in lower(prosrc)) = 0 and position('delete ' in lower(prosrc)) = 0
        and provolatile = 's'
       from pg_proc where oid = 'public.lookup_serve_for_click(text)'::regprocedure),
    'stable, select only'),
  ('the lookup does not return campaign or advertiser ids',
    (select position('campaign_id' in prosrc) = 0 and position('advertiser' in prosrc) = 0
       from pg_proc where oid = 'public.lookup_serve_for_click(text)'::regprocedure),
    'minimal fields'),
  ('ad_events inserts come only from record_ad_impression and record_ad_click',
    (select count(*) = 0 from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and proname not in ('record_ad_impression', 'record_ad_click') and prosrc ilike '%insert into public.ad_events%'),
    'two writers, each a single event type'),
  ('ad_events keeps the one-click-per-serve unique constraint',
    exists (select 1 from pg_constraint where conrelid = to_regclass('public.ad_events') and conname = 'ad_events_one_per_type_key' and contype = 'u'),
    'unique (serve_id, event_type)'),

  -- ---- data sanity (read-only) ----
  ('no serve has more than one click event',
    (select count(*) = 0 from (select serve_id from public.ad_events where event_type = 'click' group by 1 having count(*) > 1) d),
    'duplicate clicks must be 0'),
  ('every click event has a serve (attribution matches) and an impression for the same serve',
    (select count(*) = 0 from public.ad_events e
       where e.event_type = 'click' and e.source = 'blisscco_redirect'
         and (not exists (select 1 from public.ad_serve_log s where s.id = e.serve_id and s.publisher_id = e.publisher_id
                            and s.campaign_id = e.campaign_id and s.creative_id = e.creative_id)
              or not exists (select 1 from public.ad_events i where i.serve_id = e.serve_id and i.event_type = 'impression'))),
    'orphan / impression-less redirect clicks must be 0')
)
select check_name, case when passed then 'PASS' else 'FAIL' end as status, detail
from checks
order by 1;
