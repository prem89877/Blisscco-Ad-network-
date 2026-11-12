-- phase6-fix-replay-serve-serveref.sql  (TEST = Denim Hub Bsl ONLY; owner approval needed; NOT executed by Claude)
-- Reason: private.replay_serve on TEST lacks 'serve_ref' (day-9-7 definition overwrote day-12-5's). Re-applies the day-12-5 definition verbatim.
-- Run the read-only check in the chat first. Safe to re-run (create or replace).
begin;
create or replace function private.replay_serve(p_publisher_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creative uuid;
  v_serve_id bigint;
  v_serve_ref text;
  v_served_at timestamptz;
  v_today    date := (now() at time zone 'utc')::date;
  r          record;
begin
  select q.creative_id, q.serve_id into v_creative, v_serve_id
  from public.ad_serve_requests q
  where q.publisher_id = p_publisher_id and q.idempotency_key = p_key;

  if not found then
    return null;
  end if;

  select x.id, x.headline, x.body, x.cta_text, x.destination_url
    into r
  from public.ad_creatives x
  join public.campaigns   c  on c.id  = x.campaign_id
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where x.id = v_creative
    and x.status = 'approved'
    and c.status = 'active'
    and c.start_date <= v_today
    and (c.end_date is null or c.end_date >= v_today)
    and a.status  = 'active'
    and ap.status = 'active';

  if not found then
    return jsonb_build_object('outcome', 'rejected', 'replayed', true);
  end if;

  -- Day 12 Part 3: wahi serve row ka reference (retry me DOOSRI serve row nahi banti). serve_id NULL / row purge ho gayi => dono null.
  select s.serve_ref, s.served_at into v_serve_ref, v_served_at from public.ad_serve_log s where s.id = v_serve_id;

  return jsonb_build_object(
    'outcome',  'ok',
    'replayed', true,
    'serve_ref', v_serve_ref,
    'served_at', v_served_at,
    'ad', jsonb_build_object(
      'id', r.id, 'headline', r.headline, 'body', r.body, 'cta_text', r.cta_text, 'destination_url', r.destination_url
    )
  );
end;
$$;

revoke all on function private.replay_serve(uuid, text) from public, anon, authenticated, service_role;
commit;

-- Verify (expect true):
--   select pg_get_functiondef('private.replay_serve(uuid,text)'::regprocedure) like '%serve_ref%' as has_serve_ref;
