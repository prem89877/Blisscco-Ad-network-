-- =====================================================================
-- BLISSCCO | Day 5 | Part 8 : serve ke 2 chhote functions (TypeScript selection layer ke liye)
-- Pehle day-5-1 se day-5-6 chali honi chahiye. Dobara chalane par safe hai
-- (create or replace; koi table/column/data nahi badalta).
--
-- Kyun: ab ad ka CHUNAV TypeScript (category-matching + selection layer) karta hai, aur database
-- sirf 3 kaam karta hai. `match_contextual_ad` (day-5-4) purana single-call path hai; use chheda nahi gaya.
--
--   1. public.authorize_publisher_key(p_key_hash)
--        key + publisher + publisher ka profile 'active' check, per-key rate limit, last_used_at.
--        Return: { outcome: ok | unauthorized | rate_limited, publisher_id?, publisher_status?, unit_cost_usd? }
--   2. public.load_ad_candidates(...)        (day-5-6, pehle se hai, read-only)
--   3. public.record_ad_serve(p_key_hash, p_creative_id, p_topic)
--        key dobara verify + creative ko DOBARA verify (approved, active campaign/advertiser/profile,
--        category, dates) + serve log + daily counter. Return: { outcome: ok | rejected | unauthorized }
--
-- Security
--  * SECURITY DEFINER + search_path = '' ; har object schema-qualified.
--  * Execute SIRF service_role ko. anon/authenticated/public ko nahi.
--  * publisher_id kabhi caller se nahi liya jaata: record_ad_serve key-hash se publisher khud dhoondta hai.
--  * Return me advertiser, campaign id, budget kuch nahi.
--  * Prompt/IP/user id kahin store nahi hota (serve log me sirf publisher, creative, campaign, topic, time).
--
-- Jaan-boojh kar NAHI:
--  * Budget check record_ad_serve me nahi hai. Kharch (campaign_spend_daily) abhi koi likhta nahi,
--    isliye TypeScript me spendTracking = "unavailable" hai. Impression tracking aane par dono jagah saath lagana.
--  * Select aur record ke beech race: do request ek hi creative chun sakti hain (rotation thoda aage-peeche).
--    Record function creative ko dobara verify karta hai, isliye ineligible creative kabhi record/serve nahi hota.
-- =====================================================================

create or replace function public.authorize_publisher_key(p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_id       uuid;
  v_publisher_id uuid;
  v_cpm          numeric;
  v_limit        integer;
  v_window       timestamptz := date_trunc('minute', now());
  v_hits         integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  select k.id, k.publisher_id
    into v_key_id, v_publisher_id
  from public.publisher_api_keys k
  join public.publishers p  on p.id  = k.publisher_id
  join public.profiles   pr on pr.id = p.profile_id
  where k.key_hash = p_key_hash
    and k.status  = 'active'
    and p.status  = 'active'
    and pr.status = 'active';

  if v_key_id is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  select s.cpm_usd, s.rate_limit_per_minute
    into v_cpm, v_limit
  from public.ad_platform_settings s
  where s.id;

  if v_cpm is null then
    v_cpm := 2;
    v_limit := 60;
  end if;

  -- Rate limit (per key, per minute): day-5-4 jaisa hi counter
  delete from public.api_rate_limits
   where key_id = v_key_id and window_start < now() - interval '1 hour';

  insert into public.api_rate_limits (key_id, window_start, hits)
  values (v_key_id, v_window, 1)
  on conflict (key_id, window_start)
  do update set hits = public.api_rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  update public.publisher_api_keys
     set last_used_at = now()
   where id = v_key_id
     and (last_used_at is null or last_used_at < now() - interval '1 minute');

  return jsonb_build_object(
    'outcome',          'ok',
    'publisher_id',     v_publisher_id,
    'publisher_status', 'active',
    'unit_cost_usd',    v_cpm / 1000.0
  );
end;
$$;

comment on function public.authorize_publisher_key(text) is
  'Publisher key check + per-key rate limit. Execute: service_role only. Return me advertiser/campaign/budget nahi.';

create or replace function public.record_ad_serve(
  p_key_hash    text,
  p_creative_id uuid,
  p_topic       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publisher_id uuid;
  v_campaign_id  uuid;
  v_today        date := (now() at time zone 'utc')::date;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  -- Publisher key se hi dhoondo (caller se publisher id kabhi nahi liya jaata). Rate limit yahan nahi badhta.
  select k.publisher_id
    into v_publisher_id
  from public.publisher_api_keys k
  join public.publishers p  on p.id  = k.publisher_id
  join public.profiles   pr on pr.id = p.profile_id
  where k.key_hash = p_key_hash
    and k.status  = 'active'
    and p.status  = 'active'
    and pr.status = 'active';

  if v_publisher_id is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  if p_creative_id is null
     or p_topic is null
     or p_topic !~ '^[a-z0-9_]{1,50}$'
     or not exists (select 1 from public.ad_categories k2 where k2.slug = p_topic and k2.is_active) then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Creative dobara verify: TypeScript ke chunav par bharosa nahi, wahi eligibility (budget ko chhodkar).
  select c.id
    into v_campaign_id
  from public.ad_creatives x
  join public.campaigns   c  on c.id  = x.campaign_id
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where x.id = p_creative_id
    and x.status = 'approved'
    and c.status = 'active'
    and c.category = p_topic
    and c.start_date <= v_today
    and (c.end_date is null or c.end_date >= v_today)
    and a.status  = 'active'
    and ap.status = 'active';

  if v_campaign_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic)
  values (v_publisher_id, p_creative_id, v_campaign_id, p_topic);

  insert into public.creative_serve_daily (creative_id, campaign_id, day, serves)
  values (p_creative_id, v_campaign_id, v_today, 1)
  on conflict (creative_id, day)
  do update set serves = public.creative_serve_daily.serves + 1;

  return jsonb_build_object('outcome', 'ok');
end;
$$;

comment on function public.record_ad_serve(text, uuid, text) is
  'Serve record: key + creative dobara verify, phir serve log + daily counter. Execute: service_role only.';

revoke all on function public.authorize_publisher_key(text)       from public, anon, authenticated;
revoke all on function public.record_ad_serve(text, uuid, text)   from public, anon, authenticated;
grant execute on function public.authorize_publisher_key(text)     to service_role;
grant execute on function public.record_ad_serve(text, uuid, text) to service_role;

-- Check 1 (Expect: 2 rows, security_definer = true dono)
--   select proname, prosecdef as security_definer from pg_proc
--   where proname in ('authorize_publisher_key', 'record_ad_serve') and pronamespace = 'public'::regnamespace;
-- Check 2 (Expect: har function ke liye sirf service_role aur postgres)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('authorize_publisher_key', 'record_ad_serve')
--   order by routine_name, grantee;
