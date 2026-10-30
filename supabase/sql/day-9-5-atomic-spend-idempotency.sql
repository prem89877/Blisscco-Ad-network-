-- =====================================================================
-- BLISSCCO | Day 9 | Part 3 : atomic spend limits + retry-safe (idempotent) serve record
-- Pehle day-5-3, day-5-8, day-7-1 aur day-9-3 chali honi chahiye. Dobara chalane par safe hai (idempotent).
-- KOI table/column drop nahi hota, koi purana data delete/badla nahi jata, RLS ko haath nahi lagta.
-- PEHLE TEST project par chalao, phir asli par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Pehle se jo sahi tha (badla nahi):
--   record_ad_serve (3 args, day-7-1) campaign row par LOCK leta hai, total + daily limit check karta hai, aur
--   spend + serve log + daily counter EK hi transaction me likhta hai. Error ho toh sab rollback => failed request par kharch nahi.
--
-- Is file me 4 cheezein:
--  A. ad_serve_requests table : "ye retry-key is publisher ke liye pehle charge ho chuki hai" ka record (48 ghante).
--  B. record_ad_serve (4 args, naya overload) : Idempotency-Key ke saath. Wahi key dobara aaye toh DOBARA charge NAHI,
--     wahi ad wapas. Do request EK SAATH wahi key bheje tab bhi ek hi baar charge (advisory lock).
--     Purana 3-arg function jaisa tha waisa hi hai (bina key wali request ka behaviour same).
--  C. find_idempotent_serve : selection se PEHLE check: key pehle charge ho chuki hai? (taaki budget khatam hone ke baad
--     bhi retry ko wahi ad mile, "no-fill" nahi).
--  D. campaign_spend_daily par "aakhri deewar" trigger: kisi bhi tareeke se (aaj ya future ka koi code) total ya daily limit
--     paar karne wali spend likhi hi nahi ja sakti.
--  + purge_old_ad_logs ab 48 ghante purani retry-keys bhi hatata hai.
-- =====================================================================

begin;

-- ---------- A. retry-key record ----------
create table if not exists public.ad_serve_requests (
  publisher_id    uuid        not null references public.publishers (id) on delete restrict,
  idempotency_key text        not null,
  creative_id     uuid        not null references public.ad_creatives (id) on delete restrict,
  campaign_id     uuid        not null references public.campaigns (id) on delete restrict,
  created_at      timestamptz not null default now(),

  primary key (publisher_id, idempotency_key),
  constraint ad_serve_requests_key_check check (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$')
);

comment on table public.ad_serve_requests is
  'Retry-safety: (publisher, Idempotency-Key) -> jo creative charge hua. 48 ghante baad purge. Prompt/IP/user id KABHI nahi.';

create index if not exists ad_serve_requests_created_at_idx on public.ad_serve_requests (created_at);

alter table public.ad_serve_requests enable row level security;
revoke all on table public.ad_serve_requests from public, anon, authenticated, service_role;

-- ---------- helper: pehle charge hui key ka jawab (sirf private, API se bahar) ----------
-- Return: null = key pehle use nahi hui | {outcome: ok, replayed: true, ad: {...}} | {outcome: rejected, replayed: true}
-- "rejected" = pehle charge ho chuka hai par ab creative approved ya campaign active nahi: ad dobara nahi dete (kharch wapas nahi aata).
create or replace function private.replay_serve(p_publisher_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creative uuid;
  r          record;
begin
  select q.creative_id into v_creative
  from public.ad_serve_requests q
  where q.publisher_id = p_publisher_id and q.idempotency_key = p_key;

  if not found then
    return null;
  end if;

  select x.id, x.headline, x.body, x.cta_text, x.destination_url
    into r
  from public.ad_creatives x
  join public.campaigns c on c.id = x.campaign_id
  where x.id = v_creative
    and x.status = 'approved'
    and c.status = 'active';

  if not found then
    return jsonb_build_object('outcome', 'rejected', 'replayed', true);
  end if;

  return jsonb_build_object(
    'outcome',  'ok',
    'replayed', true,
    'ad', jsonb_build_object(
      'id', r.id, 'headline', r.headline, 'body', r.body, 'cta_text', r.cta_text, 'destination_url', r.destination_url
    )
  );
end;
$$;

revoke all on function private.replay_serve(uuid, text) from public, anon, authenticated, service_role;

-- ---------- B. record_ad_serve (4 args): retry-safe ----------
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

  insert into public.ad_serve_requests (publisher_id, idempotency_key, creative_id, campaign_id)
  values (v_publisher_id, p_idempotency_key, p_creative_id, v_campaign_id)
  on conflict (publisher_id, idempotency_key) do nothing;

  return v_result;
end;
$$;

comment on function public.record_ad_serve(text, uuid, text, text) is
  'Retry-safe serve record: wahi Idempotency-Key dobara aaye toh dobara charge nahi, wahi ad. Execute: service_role only.';

revoke all on function public.record_ad_serve(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_ad_serve(text, uuid, text, text) to service_role;

-- ---------- C. selection se pehle: kya ye key pehle charge ho chuki hai? ----------
-- Return: {outcome: found, ad} | {outcome: none} | {outcome: rejected} | {outcome: unauthorized}
-- Rate limit yahan nahi badhta (authorize_publisher_key pehle hi ginti kar chuka hota hai).
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
    return jsonb_build_object('outcome', 'found', 'ad', v_replay -> 'ad');
  end if;
  return jsonb_build_object('outcome', 'rejected');
end;
$$;

comment on function public.find_idempotent_serve(text, text) is
  'Kya ye Idempotency-Key is publisher ke liye pehle charge ho chuki hai? Read-only. Execute: service_role only.';

revoke all on function public.find_idempotent_serve(text, text) from public, anon, authenticated;
grant execute on function public.find_idempotent_serve(text, text) to service_role;

-- ---------- D. aakhri deewar: spend limit paar nahi ho sakti ----------
-- record_ad_serve pehle se check karta hai. Ye trigger uske neeche ki deewar hai: koi bhi aur code/SQL spend badhaye
-- aur total ya daily limit paar ho, toh 23514 error aur poori transaction rollback.
-- Sirf spend BADHNE par dekhta hai (purani rows ya limit ghatane par kuch nahi chhuta). Campaign lock wahi hai jo record_ad_serve ka.
create or replace function private.guard_campaign_spend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total     numeric;
  v_daily     numeric;
  v_old_spent numeric := 0;
  v_others    numeric;
begin
  if tg_op = 'UPDATE' then
    v_old_spent := old.spent;
  end if;

  if new.spent <= v_old_spent then
    return new;
  end if;

  select c.total_budget, c.daily_budget
    into v_total, v_daily
  from public.campaigns c
  where c.id = new.campaign_id
  for update;

  if not found then
    raise exception 'Campaign not found for spend row' using errcode = '23503';
  end if;

  select coalesce(sum(d.spent), 0) into v_others
  from public.campaign_spend_daily d
  where d.campaign_id = new.campaign_id and d.day <> new.day;

  if v_others + new.spent > v_total then
    raise exception 'Spend would exceed the campaign total budget'
      using errcode = '23514', hint = 'total_budget_exceeded';
  end if;

  if v_daily is not null and new.spent > v_daily then
    raise exception 'Spend would exceed the campaign daily budget'
      using errcode = '23514', hint = 'daily_budget_exceeded';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_spend() from public, anon, authenticated, service_role;

drop trigger if exists campaign_spend_guard_limits on public.campaign_spend_daily;
create trigger campaign_spend_guard_limits
  before insert or update of spent on public.campaign_spend_daily
  for each row execute function private.guard_campaign_spend();

-- ---------- purge: retry-keys 48 ghante baad ----------
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
  v_requests   bigint;
begin
  delete from public.ad_serve_log where served_at < now() - make_interval(days => v_days);
  get diagnostics v_serve_log = row_count;

  delete from public.creative_serve_daily where day < ((now() at time zone 'utc')::date - v_days);
  get diagnostics v_serve_day = row_count;

  delete from public.api_rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  delete from public.ad_serve_requests where created_at < now() - interval '48 hours';
  get diagnostics v_requests = row_count;

  return jsonb_build_object(
    'ad_serve_log', v_serve_log,
    'creative_serve_daily', v_serve_day,
    'api_rate_limits', v_rate,
    'ad_serve_requests', v_requests
  );
end;
$$;

revoke all on function private.purge_old_ad_logs(integer) from public, anon, authenticated, service_role;

commit;

-- Check 1 (Expect: 1 row): table + RLS on
--   select relname, relrowsecurity from pg_class where oid = 'public.ad_serve_requests'::regclass;
-- Check 2 (Expect: record_ad_serve ke 2 rows (3 args aur 4 args), find_idempotent_serve 1 row; sab security_definer = true)
--   select proname, pronargs, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('record_ad_serve','find_idempotent_serve') order by proname, pronargs;
-- Check 3 (Expect: har function ke liye sirf service_role aur postgres)
--   select routine_name, specific_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('record_ad_serve','find_idempotent_serve') order by 1,2,3;
-- Check 4 (Expect: 1 row) : trigger laga hai
--   select tgname from pg_trigger where tgname = 'campaign_spend_guard_limits' and not tgisinternal;
-- Check 5 (Expect: 0 rows) : purane data me kisi campaign ka spend uske budget se zyada toh nahi (sirf dekhne ke liye; kuch badalta nahi)
--   select c.id, c.total_budget, s.total_spent from public.campaigns c
--   join (select campaign_id, sum(spent) total_spent from public.campaign_spend_daily group by 1) s on s.campaign_id = c.id
--   where s.total_spent > c.total_budget;
