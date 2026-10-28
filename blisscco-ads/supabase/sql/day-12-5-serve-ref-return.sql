-- =====================================================================
-- BLISSCCO | Day 12 | Part 3 | Migration 3 (file day-12-5) : serve_ref + served_at ko record_ad_serve / retry se wapas lana
-- Pehle day-5-8, day-7-1, day-9-5, day-9-7, day-12-1 chali honi chahiye. Dobara chalane par safe hai (idempotent).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Kyun: tracking token ko "ye serve" ka reference chahiye. day-12-1 ne serve_ref column + default bana diya, par record_ad_serve
-- use wapas nahi deta, aur Idempotency-Key ki retry ko pata nahi ki pehle kaun si serve row bani thi. Is file ke bina app token
-- nahi bana sakta (code safe hai: serve_ref na mile toh ad pehle jaisa jaata hai, bas `tracking` nahi).
--
-- Kya badalta hai (additive; spend/billing/budget logic WAHI hai):
--  A. ad_serve_requests.serve_id : naya NULLABLE bigint (FK -> ad_serve_log.id, ON DELETE SET NULL). Purani rows NULL rehti hain
--     (purge 48 ghante me hata deta hai). Retry isi se "wahi serve row" dhoondti hai.
--  B. record_ad_serve (3 args) : day-7-1 ka function JAS KA TAS; farak sirf itna ki ad_serve_log INSERT ab `returning serve_ref, served_at`
--     leta hai aur jawab me 'serve_ref' + 'served_at' jodta hai. Budget check, campaign lock, spend, serve log, daily counter: koi badlav nahi.
--  C. record_ad_serve (4 args) : day-9-5 jaisa; naya sirf: serve row ka id serve_ref se dhoondh kar ad_serve_requests.serve_id me likhta hai.
--     Wahi key dobara aaye toh DOBARA charge NAHI aur DOOSRI serve row NAHI: replay wahi serve_ref wapas deta hai.
--  D. private.replay_serve : day-9-7 jaisa (schedule + advertiser + profile check); jawab me serve_ref + served_at (serve_id NULL ho toh null).
--  E. find_idempotent_serve : day-9-5 jaisa; 'found' me serve_ref + served_at bhi.
--
-- Jo NAHI hota: koi table/column drop nahi, koi purani row nahi badalti, campaign_spend_daily / creative_serve_daily ka logic nahi badla,
-- ad_events me kuch nahi likha jaata (serve ko impression nahi ginte), RLS/grants jaise the waise (function grants dobara wahi lage hain).
-- =====================================================================

begin;

-- ---------- A. ad_serve_requests.serve_id ----------
alter table public.ad_serve_requests add column if not exists serve_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_requests'::regclass and conname = 'ad_serve_requests_serve_id_fkey') then
    alter table public.ad_serve_requests
      add constraint ad_serve_requests_serve_id_fkey
      foreign key (serve_id) references public.ad_serve_log (id) on delete set null;
  end if;
end
$$;

comment on column public.ad_serve_requests.serve_id is
  'Is retry-key se jo serve row bani thi (NULL = migration se pehle ki key). Retry isi se wahi serve_ref wapas deti hai. Bahar kabhi nahi jaata.';

-- ---------- B. record_ad_serve (3 args): serve_ref + served_at wapas ----------
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
  v_serve_ref    text;
  v_served_at    timestamptz;
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
  values (v_publisher_id, p_creative_id, v_campaign_id, p_topic)
  returning serve_ref, served_at into v_serve_ref, v_served_at;

  insert into public.creative_serve_daily (creative_id, campaign_id, day, serves)
  values (p_creative_id, v_campaign_id, v_today, 1)
  on conflict (creative_id, day)
  do update set serves = public.creative_serve_daily.serves + 1;

  -- Day 12 Part 3: sirf serve_ref (opaque) + served_at wapas. Sequential id kabhi nahi. serve_ref NULL ho sakta hai (day-12-1 na chali ho)
  -- toh app token nahi banata; spend/serve log/counter ka koi behaviour badla nahi.
  return jsonb_build_object('outcome', 'ok', 'serve_ref', v_serve_ref, 'served_at', v_served_at);
end;
$$;

comment on function public.record_ad_serve(text, uuid, text) is
  'Serve record: key + creative dobara verify, BUDGET check (campaign lock), phir spend + serve log + daily counter. Jawab me serve_ref + served_at. Execute: service_role only.';

revoke all on function public.record_ad_serve(text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_ad_serve(text, uuid, text) to service_role;

-- ---------- C. record_ad_serve (4 args): retry wahi serve row se juda ----------
create or replace function public.record_ad_serve(
  p_key_hash        text,
  p_creative_id     uuid,
  p_topic           text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publisher_id uuid;
  v_replay       jsonb;
  v_result       jsonb;
  v_campaign_id  uuid;
  v_serve_id     bigint;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Publisher key se hi dhoondo (caller se publisher id kabhi nahi liya jaata)
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

  -- Wahi (publisher, key) wali do request ek saath aayein toh line me lagti hain: doosri ko pehli ka nateeja dikhega.
  -- (Lock transaction ke ant me khud chhoot jaata hai.)
  perform pg_advisory_xact_lock(hashtextextended(v_publisher_id::text || ':' || p_idempotency_key, 0));

  v_replay := private.replay_serve(v_publisher_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;                              -- dobara charge NAHI
  end if;

  -- Asli kaam purana 3-arg function karta hai (campaign lock + total/daily check + spend + log + counter).
  -- Ye usi transaction ke andar chalta hai: aage koi bhi error aaye toh spend bhi wapas (rollback).
  v_result := public.record_ad_serve(p_key_hash, p_creative_id, p_topic);

  if v_result ->> 'outcome' is distinct from 'ok' then
    return v_result;                              -- rejected / unauthorized: kuch likha nahi gaya, key bhi save nahi hoti
  end if;

  select x.campaign_id into v_campaign_id from public.ad_creatives x where x.id = p_creative_id;

  -- Day 12 Part 3: is retry-key ko usi serve row se jodo jo abhi bani (serve_ref unique hai). Row na mile toh NULL (token nahi banega).
  select s.id into v_serve_id from public.ad_serve_log s where s.serve_ref = v_result ->> 'serve_ref';

  insert into public.ad_serve_requests (publisher_id, idempotency_key, creative_id, campaign_id, serve_id)
  values (v_publisher_id, p_idempotency_key, p_creative_id, v_campaign_id, v_serve_id)
  on conflict (publisher_id, idempotency_key) do nothing;

  return v_result;
end;
$$;

comment on function public.record_ad_serve(text, uuid, text, text) is
  'Retry-safe serve record: wahi Idempotency-Key dobara aaye toh dobara charge nahi, wahi ad, wahi serve_ref. Execute: service_role only.';

revoke all on function public.record_ad_serve(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_ad_serve(text, uuid, text, text) to service_role;

-- ---------- D. replay_serve: serve_ref + served_at ----------
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

-- ---------- E. find_idempotent_serve: serve_ref + served_at ----------
create or replace function public.find_idempotent_serve(p_key_hash text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publisher_id uuid;
  v_replay       jsonb;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

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

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    return jsonb_build_object('outcome', 'none');
  end if;

  v_replay := private.replay_serve(v_publisher_id, p_idempotency_key);

  if v_replay is null then
    return jsonb_build_object('outcome', 'none');
  end if;
  if v_replay ->> 'outcome' = 'ok' then
    return jsonb_build_object('outcome', 'found', 'ad', v_replay -> 'ad',
                              'serve_ref', v_replay -> 'serve_ref', 'served_at', v_replay -> 'served_at');
  end if;
  return jsonb_build_object('outcome', 'rejected');
end;
$$;

comment on function public.find_idempotent_serve(text, text) is
  'Kya ye Idempotency-Key is publisher ke liye pehle charge ho chuki hai? Read-only. Found me serve_ref + served_at. Execute: service_role only.';

revoke all on function public.find_idempotent_serve(text, text) from public, anon, authenticated;
grant execute on function public.find_idempotent_serve(text, text) to service_role;

commit;

-- ---------- Checks (sab READ-ONLY; test project par migration ke baad chalao) ----------
-- Check 1 (Expect: 1 row, serve_id bigint YES)
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'ad_serve_requests' and column_name = 'serve_id';
-- Check 2 (Expect: record_ad_serve 2 rows (3 aur 4 args), find_idempotent_serve 1 row; sab prosecdef = true)
--   select proname, pronargs, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('record_ad_serve', 'find_idempotent_serve') order by proname, pronargs;
-- Check 3 (Expect: har function par sirf service_role aur postgres ke grants: anon / authenticated / PUBLIC nahi)
--   select routine_name, specific_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('record_ad_serve', 'find_idempotent_serve') order by 1, 2, 3;
-- Check 4 (Expect: 0 rows) ad_serve_requests ki koi row ab bhi galat serve se juda nahi (publisher / creative / campaign sab milte hain)
--   select q.publisher_id, q.idempotency_key from public.ad_serve_requests q join public.ad_serve_log s on s.id = q.serve_id
--   where s.publisher_id <> q.publisher_id or s.creative_id <> q.creative_id or s.campaign_id <> q.campaign_id;
