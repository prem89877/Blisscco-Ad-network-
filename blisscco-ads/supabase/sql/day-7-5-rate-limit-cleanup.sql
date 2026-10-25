-- =====================================================================
-- BLISSCCO | Day 7 | Part 5 : rate-limit safai ka bojh kam karna (OPTIONAL, performance)
-- Pehle day-7-1 chali honi chahiye. Dobara chalane par safe hai (create or replace).
--
-- Kya badalta hai: sirf authorize_publisher_key me ek line ki jagah.
--   Pehle: HAR ad request par "purani rate-limit rows delete" ka extra write chalta tha.
--   Ab   : wo delete sirf tab chalta hai jab us key ka naya minute shuru ho (hits = 1).
-- Kya NAHI badalta: key check, rate limit ki ginti (atomic upsert), limit, jawab ka shape, grants.
--   (create or replace function se execute permissions wahi rehti hain: sirf service_role.)
--
-- Pehle TEST project par chalao. Phir day-7-2-verify.sql / day-7-3-authz-gap-tests.sql dobara chalake dekho.
-- =====================================================================

begin;

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

  insert into public.api_rate_limits (key_id, window_start, hits)
  values (v_key_id, v_window, 1)
  on conflict (key_id, window_start)
  do update set hits = public.api_rate_limits.hits + 1
  returning hits into v_hits;

  -- Purani rows ki safai ab har request par nahi: sirf jab is key ka naya minute shuru ho (hits = 1).
  -- Ek key ke liye 60 request/minute par pehle 60 delete chalte the, ab ~1. (Roz raat ka purge bhi chalta hai.)
  if v_hits = 1 then
    delete from public.api_rate_limits
     where key_id = v_key_id and window_start < now() - interval '1 hour';
  end if;

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

commit;

-- Check (Expect: sirf postgres aur service_role; anon/authenticated/public nahi)
select grantee
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'authorize_publisher_key'
order by grantee;
