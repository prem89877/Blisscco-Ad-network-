-- =====================================================================
-- BLISSCCO | Day 12 | Part 4 | Migration 4 (file day-12-7) : impression ka EKLAUTA writer (atomic, dedupe database me)
-- Pehle day-12-1, day-12-2 (ad_events) aur day-12-5 (serve_ref wapas) chali honi chahiye. Dobara chalane par safe hai (create or replace).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Impression ki PARIBHASHA (ye file isi ko lagu karti hai):
--   Ek impression = ad_events me ek row jiska event_type = 'impression', jo
--     (1) ek asli, kamyab serve ke serve_ref se juda hai (ad_serve_log me wo row maujood hai: record_ad_serve ne spend ke saath commit ki thi),
--     (2) usi publisher ka hai jis ke liye token bana (publisher_id match),
--     (3) serve ke 24 ghante ke andar aaya (app me token ki apni expiry us se bhi chhoti ho sakti hai),
--     (4) us serve ka PEHLA impression hai (doosra / retry / replay = 'duplicate', kuch nahi likhta).
--   Serve ek cheez hai, API response doosri, page load teesri: inme se koi bhi impression nahi ginta. Sirf ye function 'impression' likhta hai.
--
-- Dedupe: ad_events_one_per_type_key = unique (serve_id, event_type) (day-12-2). INSERT ... ON CONFLICT DO NOTHING isi constraint par:
--   do requests ek saath aayen toh bhi ek hi row banti hai (database serialize karta hai); memory cache / client flag par bharosa nahi.
--
-- Is file me:
--  A. public.lookup_serve_for_event(serve_ref) : SIRF PADHTA HAI. Sirf publisher_id + served_at lautata hai (campaign/creative/sequential id kabhi nahi).
--     App token ke publisher-tag se milan ke liye ise use karta hai (secret database ko kabhi nahi diya jaata).
--  B. public.record_ad_impression(serve_ref, publisher_id) : serve dobara dhoondta hai, publisher + 24h window jaanchta hai, impression insert (ya duplicate).
--     occurred_at hamesha DATABASE ka now() hai: client se koi timestamp nahi liya jaata (fake / purana / future samay nahi chal sakta).
--
-- Jo NAHI badalta: record_ad_serve (3 aur 4 args), spend / budget / campaign_spend_daily / creative_serve_daily, ad_serve_log, ad_events ki structure,
-- RLS / grants (ad_events par service_role ko ab bhi koi table-grant nahi: sirf ye security-definer function likhta hai).
-- IMPRESSION PAR DOOSRI BAAR CHARGE NAHI HOTA: is function me spend/budget ka koi statement nahi hai (serve par charge, jaisa tha).
-- Privacy: sirf serve_ref, publisher_id. IP, user agent, prompt, user id, referrer kuch nahi aata, kuch store nahi hota.
-- =====================================================================

begin;

-- ---------- A. read-only lookup ----------
create or replace function public.lookup_serve_for_event(p_serve_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_publisher_id uuid;
  v_served_at    timestamptz;
begin
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select s.publisher_id, s.served_at
    into v_publisher_id, v_served_at
  from public.ad_serve_log s
  where s.serve_ref = p_serve_ref;

  if v_publisher_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  return jsonb_build_object('outcome', 'found', 'publisher_id', v_publisher_id, 'served_at', v_served_at);
end;
$$;

revoke all on function public.lookup_serve_for_event(text) from public, anon, authenticated;
grant execute on function public.lookup_serve_for_event(text) to service_role;

-- ---------- B. atomic impression writer ----------
create or replace function public.record_ad_impression(p_serve_ref text, p_publisher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serve_id    bigint;
  v_publisher   uuid;
  v_campaign    uuid;
  v_creative    uuid;
  v_served_at   timestamptz;
  v_event_id    bigint;
begin
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' or p_publisher_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Serve DATABASE se dhoondo: publisher / campaign / creative kabhi caller se nahi liye jaate.
  select s.id, s.publisher_id, s.campaign_id, s.creative_id, s.served_at
    into v_serve_id, v_publisher, v_campaign, v_creative, v_served_at
  from public.ad_serve_log s
  where s.serve_ref = p_serve_ref;

  -- Anjaani / purge ho chuki serve, ya kisi aur publisher ki serve: kuch nahi likhta.
  if v_serve_id is null or v_publisher is distinct from p_publisher_id then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Impression ki sabse badi umr: serve ke 24 ghante. (Token ki expiry app me alag se, aksar chhoti, lagti hai.)
  if now() > v_served_at + interval '24 hours' then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Atomic dedupe: ek serve = ek impression. Constraint ad_events_one_per_type_key (serve_id, event_type).
  insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at)
  values (v_serve_id, v_publisher, v_campaign, v_creative, 'impression', 'blisscco_beacon', now())
  on conflict on constraint ad_events_one_per_type_key do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  return jsonb_build_object('outcome', 'recorded');
end;
$$;

revoke all on function public.record_ad_impression(text, uuid) from public, anon, authenticated;
grant execute on function public.record_ad_impression(text, uuid) to service_role;

comment on function public.record_ad_impression(text, uuid) is
  'Ek serve ka PEHLA impression likhta hai (recorded), baaki duplicate. Serve / API response / page load impression nahi. Spend ko nahi chhuta (serve par charge).';

commit;

-- Check 1 (Expect: 2 rows, dono prosecdef = true)
--   select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('lookup_serve_for_event', 'record_ad_impression') order by 1;
-- Check 2 (Expect: sirf service_role ke paas EXECUTE; anon/authenticated/public nahi)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('lookup_serve_for_event', 'record_ad_impression') and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- (Phir day-12-8-impression-verify.sql chalao: sab PASS.)
