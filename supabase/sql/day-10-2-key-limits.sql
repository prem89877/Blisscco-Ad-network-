-- =====================================================================
-- BLISSCCO | Day 10 | Part 2 : publisher API key limits + clear error hints
-- Pehle day-5-2, day-7-1 aur day-10-1 chali honi chahiye. Dobara chalane par safe hai (sirf `create or replace`).
-- KOI table / column / data nahi badalta. Maujooda keys jaisi hain waisi chalti rehti hain. Revoke / authorize ko nahi chhuta.
-- (Ye file kisi database par chalayi NAHI gayi hai. Pehle TEST project par chalao, phir asli par.)
--
-- Kya badalta hai (sirf issue_publisher_key_for):
--  1. Errors me `hint`: 'key_limit' (5 active), 'key_daily_limit', 'invalid_key_data', 'invalid_expiry'.
--     Pehle sab 22023 the, to galat data par bhi "5 active keys" ka message dikhta tha.
--  2. Ek publisher 24 ghante me 20 se zyada nayi key nahi bana sakta (banao-revoke-banao ka loop table nahi bharega).
--  3. Day-10-1 ka profile-active check jaisa tha waisa hi.
-- Code is migration ke bina bhi chalta hai (hint na ho toh purane jaisa "limit" maanta hai): deploy ka order koi bhi.
-- =====================================================================

begin;

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
    raise exception 'Invalid key data' using errcode = '22023', hint = 'invalid_key_data';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future' using errcode = '22023', hint = 'invalid_expiry';
  end if;

  -- publisher row par lock: do request ek saath limit paar nahi kar sakti
  perform 1
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  where p.id = p_publisher_id
    and p.status  = 'active'
    and pr.status = 'active'
  for update of p;
  if not found then
    raise exception 'Publisher not found or not active' using errcode = 'P0002';
  end if;

  if (select count(*) from public.publisher_api_keys k
      where k.publisher_id = p_publisher_id and k.status = 'active') >= 5 then
    raise exception 'Active key limit (5) reached. Revoke an old key first.' using errcode = '22023', hint = 'key_limit';
  end if;

  if (select count(*) from public.publisher_api_keys k
      where k.publisher_id = p_publisher_id and k.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Too many keys created in 24 hours' using errcode = '22023', hint = 'key_daily_limit';
  end if;

  insert into public.publisher_api_keys (publisher_id, key_prefix, key_hash, key_hint, label, expires_at)
  values (p_publisher_id, p_key_prefix, p_key_hash, p_key_hint, nullif(btrim(coalesce(p_label, '')), ''), p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz) to service_role;

commit;

-- Check 1 (Expect: true): naya function laga hai
--   select pg_get_functiondef('public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz)'::regprocedure) like '%key_daily_limit%' as ok;
-- Check 2 (Expect: true): day-10-1 ka profile check bacha hai
--   select pg_get_functiondef('public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz)'::regprocedure) like '%pr.status = ''active''%' as ok;
-- Check 3 (Expect: sirf postgres, service_role): access pehle jaisa
--   select grantee from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'issue_publisher_key_for' order by grantee;
