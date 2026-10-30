-- =====================================================================
-- BLISSCCO | Day 10 | Part 1 : publisher account hardening (database level)
-- Pehle day-3-5 aur day-7-1 chali honi chahiye. Dobara chalane par safe hai (sirf `create or replace` / policy dobara banana).
-- KOI table/column/data nahi badalta, kisi ka grant kam nahi karta. PEHLE TEST project par chalao, phir asli par.
-- (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Do chhote gap (code padhkar mile):
--  A. issue_publisher_key_for sirf publisher.status = 'active' dekhta tha. Profile suspended ho toh bhi key ban sakti thi
--     agar koi function ko seedha bulaye. (Dashboard ka server code pehle hi roak deta hai, aur authorize_publisher_key
--     profile status dekhta hai, isliye serve nahi hota; ye sirf defense in depth hai.) Ab profile bhi 'active' chahiye.
--  B. publishers_update_own: suspended publisher bhi API se apna naam/website/category badal sakta tha.
--     Ab suspended publisher apni row nahi badal sakta. (Pending/active ke liye kuch nahi badla. Dashboard me abhi edit form nahi hai.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. issue_publisher_key_for : (day-7-1 jaisa hi) + profile bhi active
--    Signature, return type aur grants same (service_role only).
-- ---------------------------------------------------------------------
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
    raise exception 'Active key limit (5) reached. Revoke an old key first.' using errcode = '22023';
  end if;

  insert into public.publisher_api_keys (publisher_id, key_prefix, key_hash, key_hint, label, expires_at)
  values (p_publisher_id, p_key_prefix, p_key_hash, p_key_hint, nullif(btrim(coalesce(p_label, '')), ''), p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- B. publishers_update_own : suspended publisher apni row nahi badal sakta
--    Baaki sab (apni row, active profile, column grants) bilkul same.
-- ---------------------------------------------------------------------
drop policy if exists publishers_update_own on public.publishers;

create policy publishers_update_own on public.publishers
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select private.is_active_profile()) and status <> 'suspended')
  with check (profile_id = (select auth.uid()));

commit;

-- Check 1 (Expect: ok = true): naya function laga hai
--   select pg_get_functiondef('public.issue_publisher_key_for(uuid, text, text, text, text, timestamptz)'::regprocedure) like '%pr.status = ''active''%' as ok;
-- Check 2 (Expect: sirf service_role aur postgres): key function ka access pehle jaisa hi
--   select grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'issue_publisher_key_for' order by grantee;
-- Check 3 (Expect: 1 row, qual me "suspended" dikhe): policy badli
--   select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'publishers' and policyname = 'publishers_update_own';
-- Check 4 (Expect: 4 rows: select_admin, select_own, insert_own, update_own): baaki policies chhui nahi
--   select policyname from pg_policies where schemaname = 'public' and tablename = 'publishers' order by policyname;
