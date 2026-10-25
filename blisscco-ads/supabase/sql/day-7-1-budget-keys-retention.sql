-- =====================================================================
-- NOTE (owner): Deployment se pehle impressions aur clicks ki ginti (tracking) aur baaki related cheezein (etc.)
-- ka kaam/review kiya jayega. Tab tak charge "serve" par lagta hai.
-- BLISSCCO | Day 7 | Part 1 : budget enforce + publisher key self-service + safai job
-- Pehle day-5-1 se day-5-11 chali honi chahiye. Dobara chalane par safe hai.
-- PEHLE TEST project par chalao, phir asli par.
--
-- Is file me 4 kaam:
--  1. record_ad_serve ab BUDGET rokta hai. Har serve ki keemat (CPM / 1000) campaign_spend_daily me likhi
--     jaati hai. total ya daily budget paar hone wala serve "rejected" (publisher ko no-fill).
--     Campaign row par lock hota hai, isliye do request ek saath budget paar nahi kar sakti.
--     NOTE: abhi "serve" par charge lagta hai (impression tracking alag feature hai).
--  2. Publisher keys: label, expiry (optional), key ke aakhri 4 characters (pehchaan), aur 3 naye
--     functions (issue / list / revoke) jo SIRF service_role chala sakta hai. Dashboard unhe server se bulata hai.
--     authorize_publisher_key aur record_ad_serve ab expired key ko bhi roakte hain.
--  3. Purana single-call function match_contextual_ad band (execute sabse hata diya).
--  4. Purane logs ki safai: private.purge_old_ad_logs (pg_cron ho toh roz raat ko khud chalta hai).
-- =====================================================================

begin;

-- ---------- 1. publisher_api_keys: naye columns ----------
alter table public.publisher_api_keys add column if not exists label      text;
alter table public.publisher_api_keys add column if not exists expires_at timestamptz;
alter table public.publisher_api_keys add column if not exists key_hint   text;

alter table public.publisher_api_keys drop constraint if exists publisher_api_keys_label_check;
alter table public.publisher_api_keys add constraint publisher_api_keys_label_check
  check (label is null or char_length(btrim(label)) between 1 and 60);

alter table public.publisher_api_keys drop constraint if exists publisher_api_keys_hint_check;
alter table public.publisher_api_keys add constraint publisher_api_keys_hint_check
  check (key_hint is null or key_hint ~ '^[0-9a-f]{4}$');

-- ---------- 2. authorize_publisher_key: expired key bhi band ----------
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
    and (k.expires_at is null or k.expires_at > now())
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
  'Publisher key check (active + not expired) + per-key rate limit. Execute: service_role only.';

-- ---------- 3. record_ad_serve: budget enforce ----------
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
  v_total        numeric;
  v_daily        numeric;
  v_cpm          numeric;
  v_unit         numeric;
  v_spent_total  numeric;
  v_spent_today  numeric;
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
    and (k.expires_at is null or k.expires_at > now())
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

  -- Creative dobara verify + campaign row par LOCK (budget ek ek karke jaanchna zaroori hai)
  select c.id, c.total_budget, c.daily_budget
    into v_campaign_id, v_total, v_daily
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
    and ap.status = 'active'
  for update of c;

  if v_campaign_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Ek serve ki keemat = CPM / 1000 (kam se kam 0.0001 USD)
  select s.cpm_usd into v_cpm from public.ad_platform_settings s where s.id;
  if v_cpm is null then
    v_cpm := 2;
  end if;
  v_unit := greatest(round(v_cpm / 1000.0, 4), 0.0001);

  select coalesce(sum(d.spent), 0) into v_spent_total
  from public.campaign_spend_daily d where d.campaign_id = v_campaign_id;

  select coalesce(sum(d.spent), 0) into v_spent_today
  from public.campaign_spend_daily d where d.campaign_id = v_campaign_id and d.day = v_today;

  if v_spent_total + v_unit > v_total then
    return jsonb_build_object('outcome', 'rejected');
  end if;
  if v_daily is not null and v_spent_today + v_unit > v_daily then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  insert into public.campaign_spend_daily (campaign_id, day, spent)
  values (v_campaign_id, v_today, v_unit)
  on conflict (campaign_id, day)
  do update set spent = public.campaign_spend_daily.spent + excluded.spent;

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
  'Serve record: key + creative dobara verify, BUDGET check (campaign lock), phir spend + serve log + daily counter. Execute: service_role only.';

revoke all on function public.authorize_publisher_key(text)       from public, anon, authenticated;
revoke all on function public.record_ad_serve(text, uuid, text)   from public, anon, authenticated;
grant execute on function public.authorize_publisher_key(text)     to service_role;
grant execute on function public.record_ad_serve(text, uuid, text) to service_role;

-- ---------- 4. publisher key self-service (sirf service_role; dashboard server se bulata hai) ----------
-- publisher_id hamesha server logged-in user se nikalta hai, form se kabhi nahi.
create or replace function public.issue_publisher_key_for(
  p_publisher_id uuid,
  p_key_hash     text,
  p_key_prefix   text,
  p_key_hint     text,
  p_label        text,
  p_expires_at   timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_key_prefix is null or p_key_prefix !~ '^blc_live_[0-9a-f]{4}$'
     or p_key_hint is null or p_key_hint !~ '^[0-9a-f]{4}$' then
    raise exception 'Invalid key data' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future' using errcode = '22023';
  end if;

  -- publisher row par lock: do request ek saath 5 se zyada key nahi bana sakti
  perform 1 from public.publishers p where p.id = p_publisher_id and p.status = 'active' for update;
  if not found then
    raise exception 'Publisher not found or not active' using errcode = 'P0002';
  end if;

  if (select count(*) from public.publisher_api_keys k
      where k.publisher_id = p_publisher_id and k.status = 'active') >= 5 then
    raise exception 'Active key limit (5) reached. Revoke an old key first.' using errcode = '22023';
  end if;

  insert into public.publisher_api_keys (publisher_id, key_prefix, key_hash, key_hint, label, expires_at)
  values (p_publisher_id, p_key_prefix, p_key_hash, p_key_hint, nullif(btrim(coalesce(p_label, '')), ''), p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_publisher_keys_for(p_publisher_id uuid)
returns table (
  id           uuid,
  label        text,
  key_prefix   text,
  key_hint     text,
  status       text,
  created_at   timestamptz,
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.label, k.key_prefix, k.key_hint, k.status, k.created_at, k.last_used_at, k.expires_at, k.revoked_at
  from public.publisher_api_keys k
  where k.publisher_id = p_publisher_id
  order by k.created_at desc
  limit 20
$$;

create or replace function public.revoke_publisher_key_for(p_publisher_id uuid, p_key_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.publisher_api_keys
     set status = 'revoked', revoked_at = now()
   where id = p_key_id and publisher_id = p_publisher_id and status = 'active';
  return found;
end;
$$;

revoke all on function public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.list_publisher_keys_for(uuid)                                     from public, anon, authenticated;
revoke all on function public.revoke_publisher_key_for(uuid, uuid)                              from public, anon, authenticated;
grant execute on function public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.list_publisher_keys_for(uuid)                                     to service_role;
grant execute on function public.revoke_publisher_key_for(uuid, uuid)                              to service_role;

-- ---------- 4b. Advertiser apna kharch dekh sake (sirf apne campaign ka; doosre ka ho toh sab 0) ----------
create or replace function public.get_my_campaign_spend(p_campaign_id uuid)
returns table (spent_total numeric, spent_today numeric, serves_total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(s.spent) from public.campaign_spend_daily s where s.campaign_id = c.id), 0),
    coalesce((select s.spent from public.campaign_spend_daily s
              where s.campaign_id = c.id and s.day = (now() at time zone 'utc')::date), 0),
    coalesce((select sum(d.serves) from public.creative_serve_daily d where d.campaign_id = c.id), 0)::bigint
  from public.campaigns c
  where c.id = p_campaign_id
    and (c.advertiser_id = (select private.my_advertiser_id()) or (select private.is_admin()))
$$;

revoke all on function public.get_my_campaign_spend(uuid) from public, anon;
grant execute on function public.get_my_campaign_spend(uuid) to authenticated;

-- ---------- 5. purana match_contextual_ad band ----------
do $$
begin
  if to_regprocedure('public.match_contextual_ad(text, text, uuid[])') is not null then
    revoke all on function public.match_contextual_ad(text, text, uuid[]) from public, anon, authenticated, service_role;
  end if;
end
$$;

-- ---------- 6. purane logs ki safai ----------
-- campaign_spend_daily ko KABHI nahi chhuta (total budget uske sum se nikalta hai).
create or replace function private.purge_old_ad_logs(p_keep_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days       integer := greatest(coalesce(p_keep_days, 90), 30);
  v_serve_log  bigint;
  v_serve_day  bigint;
  v_rate       bigint;
begin
  delete from public.ad_serve_log where served_at < now() - make_interval(days => v_days);
  get diagnostics v_serve_log = row_count;

  delete from public.creative_serve_daily where day < ((now() at time zone 'utc')::date - v_days);
  get diagnostics v_serve_day = row_count;

  delete from public.api_rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  return jsonb_build_object('ad_serve_log', v_serve_log, 'creative_serve_daily', v_serve_day, 'api_rate_limits', v_rate);
end;
$$;

revoke all on function private.purge_old_ad_logs(integer) from public, anon, authenticated, service_role;

commit;

-- ---------------------------------------------------------------------
-- Roz raat ki safai (sirf agar Supabase me pg_cron extension ON ho). Fail ho toh migration nahi rukti.
-- Agar "pg_cron" nahi hai: Supabase > Database > Extensions me pg_cron ON karo, phir ye block dobara chalao.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('blisscco-purge-old-logs', '17 3 * * *', 'select private.purge_old_ad_logs(90)');
  else
    raise notice 'pg_cron is OFF: purge job not scheduled. Run select private.purge_old_ad_logs(90); by hand now and then.';
  end if;
exception when others then
  raise notice 'Could not schedule purge job: %', sqlerrm;
end
$$;

-- Check 1 (Expect: 6 rows, security_definer = true sab ke liye)
--   select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('authorize_publisher_key','record_ad_serve','issue_publisher_key_for','list_publisher_keys_for','revoke_publisher_key_for','get_my_campaign_spend');
-- Check 2 (Expect: har function ke liye sirf service_role aur postgres)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in
--   ('authorize_publisher_key','record_ad_serve','issue_publisher_key_for','list_publisher_keys_for','revoke_publisher_key_for','get_my_campaign_spend')
--   order by routine_name, grantee;
