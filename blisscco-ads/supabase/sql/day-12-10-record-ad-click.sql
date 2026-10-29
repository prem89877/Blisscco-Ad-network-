-- =====================================================================
-- BLISSCCO | Day 12 | Prompt 5 Part 3 : click redirect ke liye 2 database functions (migration day-12-10)
-- Pehle day-12-1, 12-2, 12-5, 12-7 chali hon. Dobara chalane par safe hai (create or replace).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Koi table/column/constraint nahi badalta: sirf 3 naye functions. ad_events ka structure (day-12-2) jaisa tha waisa.
--  A. private.click_target(creative_id) : creative click ke layak hai toh uska destination_url, warna NULL.
--     Layak = wahi shart jo retry-replay me hai (private.replay_serve): creative approved, campaign active + schedule ke andar, advertiser + profile active.
--     (Ek naya rule nahi: serve ke samay jo shart thi wahi click ke samay bhi.) Sirf andar se (security definer functions) chalta hai.
--  B. public.lookup_serve_for_click(serve_ref) : SIRF PADHTA HAI. publisher_id, creative_id, served_at, destination_url (NULL agar layak nahi), eligible.
--     Campaign / advertiser / sequential id kabhi nahi. App ref ke publisher-tag + creative-tag se isko milata hai.
--  C. public.record_ad_click(serve_ref, publisher_id, creative_id) : serve dobara dhoondta hai, publisher + creative milata hai (caller ka diya sirf milan ke liye),
--     24 ghante ki seema, eligibility, FIR click insert (ek serve = ek click: ad_events_one_per_type_key, ON CONFLICT DO NOTHING).
--     occurred_at hamesha database ka now(). source = 'blisscco_redirect'.
--
-- DECISION D4 (DAY12-PART1-ARCHITECTURE.md, "Click ke liye impression pehle zaroori? Haan"): click TAB hi ginta hai jab us serve ka impression pehle ad_events me ho.
--   Impression na ho toh outcome = 'not_counted' (user phir bhi destination par jaata hai, click nahi likhta). Impression baad me aaye aur user dobara click kare toh 'recorded'.
--   Agar aap ye rule nahi chahte: function me "D4" wala ek `if not exists (...) then return not_counted` block hata do.
--
-- Jo NAHI badalta: record_ad_serve, record_ad_impression, spend / budget / campaign_spend_daily / creative_serve_daily, ad_serve_log, RLS / grants (ad_events par ab bhi
-- kisi role ko table-grant nahi). CLICK PAR CHARGE NAHI HOTA: in functions me spend/budget ka koi statement nahi hai.
-- Privacy: sirf serve_ref, publisher_id, creative_id. IP, user agent, prompt, user id, referrer kuch nahi aata, kuch store nahi hota.
-- =====================================================================

begin;

-- ---------- A. click ke layak destination (sirf andar ka helper) ----------
create or replace function private.click_target(p_creative_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_dest  text;
begin
  select x.destination_url into v_dest
  from public.ad_creatives x
  join public.campaigns   c  on c.id  = x.campaign_id
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where x.id = p_creative_id
    and x.status = 'approved'
    and c.status = 'active'
    and c.start_date <= v_today
    and (c.end_date is null or c.end_date >= v_today)
    and a.status  = 'active'
    and ap.status = 'active';
  return v_dest; -- NULL = click ke layak nahi (ya creative hai hi nahi)
end;
$$;

revoke all on function private.click_target(uuid) from public, anon, authenticated, service_role;

-- ---------- B. read-only lookup ----------
create or replace function public.lookup_serve_for_click(p_serve_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_publisher_id uuid;
  v_creative_id  uuid;
  v_served_at    timestamptz;
  v_dest         text;
begin
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select s.publisher_id, s.creative_id, s.served_at
    into v_publisher_id, v_creative_id, v_served_at
  from public.ad_serve_log s
  where s.serve_ref = p_serve_ref;

  if v_publisher_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_dest := private.click_target(v_creative_id);

  return jsonb_build_object(
    'outcome', 'found',
    'publisher_id', v_publisher_id,
    'creative_id', v_creative_id,
    'served_at', v_served_at,
    'destination_url', v_dest,
    'eligible', v_dest is not null
  );
end;
$$;

revoke all on function public.lookup_serve_for_click(text) from public, anon, authenticated;
grant execute on function public.lookup_serve_for_click(text) to service_role;

-- ---------- C. atomic click writer ----------
create or replace function public.record_ad_click(p_serve_ref text, p_publisher_id uuid, p_creative_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serve_id  bigint;
  v_publisher uuid;
  v_campaign  uuid;
  v_creative  uuid;
  v_served_at timestamptz;
  v_dest      text;
  v_event_id  bigint;
begin
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' or p_publisher_id is null or p_creative_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Serve DATABASE se dhoondo: campaign kabhi caller se nahi liya jaata; publisher/creative sirf milan ke liye.
  select s.id, s.publisher_id, s.campaign_id, s.creative_id, s.served_at
    into v_serve_id, v_publisher, v_campaign, v_creative, v_served_at
  from public.ad_serve_log s
  where s.serve_ref = p_serve_ref;

  if v_serve_id is null or v_publisher is distinct from p_publisher_id or v_creative is distinct from p_creative_id then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Click ki sabse badi umr: serve ke 24 ghante. (Ref ki expiry app me alag se, aksar chhoti, lagti hai.)
  if now() > v_served_at + interval '24 hours' then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Creative click ke layak hai? Nahi toh na click likhte hain na destination dete hain.
  v_dest := private.click_target(v_creative);
  if v_dest is null then
    return jsonb_build_object('outcome', 'ineligible');
  end if;

  -- D4: click tabhi ginta hai jab is serve ka impression pehle ho chuka ho. Warna user ko redirect hoga, click nahi likhta.
  if not exists (select 1 from public.ad_events e where e.serve_id = v_serve_id and e.event_type = 'impression') then
    return jsonb_build_object('outcome', 'not_counted', 'destination_url', v_dest);
  end if;

  -- Atomic dedupe: ek serve = ek click. Constraint ad_events_one_per_type_key (serve_id, event_type).
  insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at)
  values (v_serve_id, v_publisher, v_campaign, v_creative, 'click', 'blisscco_redirect', now())
  on conflict on constraint ad_events_one_per_type_key do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome', 'duplicate', 'destination_url', v_dest);
  end if;

  return jsonb_build_object('outcome', 'recorded', 'destination_url', v_dest);
end;
$$;

revoke all on function public.record_ad_click(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_ad_click(text, uuid, uuid) to service_role;

comment on function public.record_ad_click(text, uuid, uuid) is
  'Ek serve ka PEHLA click likhta hai (recorded), baaki duplicate; impression pehle na ho toh not_counted. Destination database ke creative row se. Spend ko nahi chhuta.';

commit;

-- Check 1 (Expect: 2 rows, dono prosecdef = true)
--   select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('lookup_serve_for_click', 'record_ad_click') order by 1;
-- (Phir day-12-11-click-verify.sql chalao: sab PASS.)
