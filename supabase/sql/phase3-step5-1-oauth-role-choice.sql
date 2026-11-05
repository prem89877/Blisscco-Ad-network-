-- =====================================================================
-- BLISSCCO | Phase 3 Step 5 | Migration (file phase3-step5-1) : naya Google user ko apna account type (advertiser / publisher) chunne dena
-- Pehle day-3-1 (profiles, handle_new_user), day-3-2 (advertisers) chali hon. Dobara chalane par safe hai.
--
-- Problem: login ya Google se aane wala naya user trigger se seedha 'advertiser' ban jata tha (role metadata me nahi hoti).
-- Fix: naye Google user par profiles.role_choice_pending = true lagta hai; app use "Advertiser ya AI Publisher chuno" page par bhejti hai;
--      choice sirf niche ke function se hoti hai. Role badalne ka koi aur raasta (authenticated / anon) NAHI khulta.
--
-- Is file me:
--  A. profiles.role_choice_pending (boolean, default false). Authenticated ko sirf padhna (existing select grant); likhne ka grant nahi.
--  B. public.mark_role_choice_pending(user) : sirf service_role. Sirf bilkul naye (10 min se purane nahi) advertiser profile par, jiske paas koi campaign nahi.
--  C. public.set_initial_account_role(user, role) : sirf service_role. Sirf jab flag true ho. 'admin' kabhi nahi.
--     publisher => khaali auto-bani advertisers row hatati hai (campaign ho toh error), phir role badalti hai. advertiser => sirf flag hatata hai.
--
-- Jo NAHI badalta: handle_new_user, guard_profile_changes, RLS, mojooda users (unka flag false rehta hai), billing / ledger / ad-serving.
-- =====================================================================

begin;

alter table public.profiles add column if not exists role_choice_pending boolean not null default false;

create or replace function public.mark_role_choice_pending(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.profiles p
     set role_choice_pending = true
   where p.id = p_user_id
     and p.role = 'advertiser'
     and p.created_at > now() - interval '10 minutes'
     and not exists (
       select 1 from public.campaigns c
       join public.advertisers a on a.id = c.advertiser_id
       where a.profile_id = p.id
     );
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

create or replace function public.set_initial_account_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('advertiser', 'publisher') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id and role_choice_pending) then
    raise exception 'role choice not pending' using errcode = '42501';
  end if;

  if p_role = 'publisher' then
    if exists (
      select 1 from public.campaigns c
      join public.advertisers a on a.id = c.advertiser_id
      where a.profile_id = p_user_id
    ) then
      raise exception 'account already has campaigns' using errcode = '42501';
    end if;
    delete from public.advertisers where profile_id = p_user_id;
    update public.profiles set role = 'publisher', role_choice_pending = false where id = p_user_id;
  else
    update public.profiles set role_choice_pending = false where id = p_user_id;
  end if;
end;
$$;

revoke all on function public.mark_role_choice_pending(uuid) from public, anon, authenticated;
revoke all on function public.set_initial_account_role(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_role_choice_pending(uuid) to service_role;
grant execute on function public.set_initial_account_role(uuid, text) to service_role;

commit;

-- Check 1 (Expect: 2 rows, dono prosecdef = true)
--   select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mark_role_choice_pending', 'set_initial_account_role') order by 1;
-- Check 2 (Expect: dono function sirf service_role ko EXECUTE; anon / authenticated / PUBLIC ko nahi)
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--   and routine_name in ('mark_role_choice_pending', 'set_initial_account_role') and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- Check 3 (Expect: 0 rows: mojooda kisi user par flag nahi)
--   select id from public.profiles where role_choice_pending;
