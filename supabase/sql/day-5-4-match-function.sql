-- =====================================================================
-- BLISSCCO | Day 5 | Part 4 : public.match_contextual_ad (matching engine ka dil)
-- Pehle day-5-1, 5-2, 5-3 chali honi chahiye. Dobara chalane par safe hai
-- (create or replace, koi data nahi badalta).
--
-- Ek hi call me (ek round trip, ek transaction):
--   1. API key (hash) + publisher + publisher profile 'active' check
--   2. per-key rate limit (per minute, DB counter)
--   3. topic taxonomy me aur active ho
--   4. eligible creative dhoondhna + rotation
--   5. serve log + daily counter
-- Return: jsonb { outcome: ok | no_fill | unauthorized | rate_limited, ad?: {...} }
--
-- Security
--  * SECURITY DEFINER (owner ke haq se chalta hai, isliye RLS-band tables padh sakta hai),
--    search_path = '' (fake object inject nahi ho sakta).
--  * Execute SIRF service_role ko. anon/authenticated/public ko nahi.
--  * Function public schema me hai kyunki private schema API me expose nahi hai
--    (rpc wahan se nahi chalega). Isi wajah se execute revoke zaroori hai.
--  * Return me sirf ad ke public fields: id, headline, body, cta_text, destination_url.
--    Advertiser, campaign id, budget, status kuch nahi.
--
-- Eligibility (sab ek saath):
--   creative.status = approved
--   campaign.status = active, campaign.category = topic
--   start_date <= aaj (UTC) aur (end_date khali ya >= aaj)
--   advertiser.status = active aur advertiser ka profile.status = active
--   budget: ab tak ka kharch + 1 impression ki keemat <= total_budget,
--           aaj ka kharch + 1 impression ki keemat <= daily_budget (agar set hai)
--
-- Rotation:
--   Pass 1: publisher ke bheje exclude ids hata kar. Kuch na mile aur exclude list khali na ho
--   toh Pass 2: exclude ke bina (alternative na ho tabhi repeat).
--   Order: aaj sabse kam serve hua campaign -> aaj sabse kam serve hua creative -> random.
-- =====================================================================

create or replace function public.match_contextual_ad(
  p_key_hash    text,
  p_topic       text,
  p_exclude_ids uuid[] default '{}'::uuid[]
)
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
  v_unit_cost    numeric;
  v_today        date := (now() at time zone 'utc')::date;
  v_window       timestamptz := date_trunc('minute', now());
  v_hits         integer;
  v_exclude      uuid[] := coalesce(p_exclude_ids, '{}'::uuid[]);
  v_pass         integer;
  v_creative_id  uuid;
  v_campaign_id  uuid;
  v_headline     text;
  v_body         text;
  v_cta          text;
  v_url          text;
begin
  -- 1. Authentication
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

  -- Settings (row na mile toh safe defaults)
  select s.cpm_usd, s.rate_limit_per_minute
    into v_cpm, v_limit
  from public.ad_platform_settings s
  where s.id;

  if v_cpm is null then
    v_cpm := 2;
    v_limit := 60;
  end if;
  v_unit_cost := v_cpm / 1000.0;

  -- 2. Rate limit (per key, per minute)
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

  -- 3. Topic: taxonomy me aur active ho (warna safe no-fill, kuch batate nahi)
  if p_topic is null or not exists (
    select 1 from public.ad_categories c where c.slug = p_topic and c.is_active
  ) then
    return jsonb_build_object('outcome', 'no_fill');
  end if;

  if cardinality(v_exclude) > 20 then
    v_exclude := v_exclude[1:20];
  end if;

  -- 4. Eligible creative + rotation
  for v_pass in 1..2 loop
    select x.id, c.id, x.headline, x.body, x.cta_text, x.destination_url
      into v_creative_id, v_campaign_id, v_headline, v_body, v_cta, v_url
    from public.ad_creatives x
    join public.campaigns  c  on c.id  = x.campaign_id
    join public.advertisers a on a.id  = c.advertiser_id
    join public.profiles   ap on ap.id = a.profile_id
    where x.status = 'approved'
      and c.status = 'active'
      and c.category = p_topic
      and c.start_date <= v_today
      and (c.end_date is null or c.end_date >= v_today)
      and a.status  = 'active'
      and ap.status = 'active'
      and (v_pass = 2 or not (x.id = any (v_exclude)))
      and coalesce((select sum(s.spent) from public.campaign_spend_daily s
                    where s.campaign_id = c.id), 0) + v_unit_cost <= c.total_budget
      and (c.daily_budget is null
           or coalesce((select s.spent from public.campaign_spend_daily s
                        where s.campaign_id = c.id and s.day = v_today), 0) + v_unit_cost <= c.daily_budget)
    order by
      coalesce((select sum(d.serves) from public.creative_serve_daily d
                where d.campaign_id = c.id and d.day = v_today), 0) asc,
      coalesce((select d2.serves from public.creative_serve_daily d2
                where d2.creative_id = x.id and d2.day = v_today), 0) asc,
      random()
    limit 1;

    if v_creative_id is not null or cardinality(v_exclude) = 0 then
      exit;
    end if;
  end loop;

  if v_creative_id is null then
    return jsonb_build_object('outcome', 'no_fill');
  end if;

  -- 5. Record: sirf publisher + creative + topic + time. Prompt/IP/user id nahi.
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic)
  values (v_publisher_id, v_creative_id, v_campaign_id, p_topic);

  insert into public.creative_serve_daily (creative_id, campaign_id, day, serves)
  values (v_creative_id, v_campaign_id, v_today, 1)
  on conflict (creative_id, day)
  do update set serves = public.creative_serve_daily.serves + 1;

  return jsonb_build_object(
    'outcome', 'ok',
    'ad', jsonb_build_object(
      'id',              v_creative_id,
      'headline',        v_headline,
      'body',            v_body,
      'cta_text',        v_cta,
      'destination_url', v_url
    )
  );
end;
$$;

revoke all on function public.match_contextual_ad(text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.match_contextual_ad(text, text, uuid[]) to service_role;

-- Check 1 (Expect: 1 row, security_definer = true)
--   select proname, prosecdef as security_definer from pg_proc
--   where proname = 'match_contextual_ad' and pronamespace = 'public'::regnamespace;
-- Check 2 (Expect: sirf service_role aur postgres)
--   select grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'match_contextual_ad' order by grantee;
