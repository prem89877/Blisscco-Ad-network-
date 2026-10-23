-- =====================================================================
-- BLISSCCO | Day 4 | Part 1 : advertiser auto-active + campaign guards
-- Pehle Day 3 Part 1-5 chalne chahiye. Dobara chalane par safe hai.
-- KOI table/column drop nahi hota, koi purana data delete nahi hota.
--
-- Is file me 3 cheezein:
--  A. Naya advertiser signup => advertisers row automatically 'active' (aapka faisla).
--  B. Purane advertiser profiles ke liye row backfill (sirf jin ke paas row nahi hai).
--  C. Campaign guards (DB level, direct API se bhi lagu):
--       - resume (paused -> active) sirf tab jab >= 1 approved creative ho aur end_date guzri na ho
--       - ek advertiser ke max 50 non-archived campaigns
--
-- Dhyan: kisi user ko admin banana ho toh pehle uski advertisers row delete karo (agar uske campaigns na hon),
-- phir profiles.role = 'admin' karo (role change advertisers_profile_fk se rukta hai jab tak row hai).
-- =====================================================================

begin;

-- A. Signup trigger: profile + (advertiser ke liye) active advertiser row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  requested_name text := nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 100), '');
  final_role     text;
  company        text;
begin
  final_role := case when requested_role in ('advertiser', 'publisher') then requested_role else 'advertiser' end;

  insert into public.profiles (id, role, display_name)
  values (new.id, final_role, requested_name);

  if final_role = 'advertiser' then
    -- Company name: display_name, nahi toh email ka pehla hissa, nahi toh 'My company'. (Baad me edit ho sakta hai.)
    company := coalesce(
      requested_name,
      nullif(left(btrim(split_part(coalesce(new.email, ''), '@', 1)), 150), ''),
      'My company'
    );
    insert into public.advertisers (profile_id, company_name, status)
    values (new.id, company, 'active');
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- B. Backfill: advertiser profiles jinki advertisers row nahi hai
insert into public.advertisers (profile_id, company_name, status)
select p.id,
       coalesce(
         nullif(left(btrim(coalesce(p.display_name, '')), 150), ''),
         nullif(left(btrim(split_part(coalesce(u.email, ''), '@', 1)), 150), ''),
         'My company'
       ),
       'active'
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'advertiser'
  and not exists (select 1 from public.advertisers a where a.profile_id = p.id);

-- (Optional, abhi comment me) Purane 'pending' advertisers ko bhi active karna ho toh:
-- update public.advertisers set status = 'active' where status = 'pending';

-- C. Campaign guards (day-3-5 wale function ka naya version; purane niyam same + 2 naye)
create or replace function private.guard_campaign_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- SQL Editor / admin functions (postgres role) par guard lagu nahi.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New campaigns must start as draft' using errcode = '42501';
    end if;
    -- NAYA: ek advertiser ke max 50 non-archived campaigns
    if (select count(*) from public.campaigns c
        where c.advertiser_id = new.advertiser_id and c.status <> 'archived') >= 50 then
      raise exception 'Campaign limit reached' using errcode = '42501', hint = 'campaign_limit_reached';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.advertiser_id is distinct from old.advertiser_id
     or new.currency_code is distinct from old.currency_code then
    raise exception 'id, advertiser and currency cannot be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('draft', 'pending_review'), ('pending_review', 'draft'), ('rejected', 'draft'),
      ('active', 'paused'), ('paused', 'active'),
      ('draft', 'archived'), ('rejected', 'archived'), ('paused', 'archived'), ('completed', 'archived')
    ) then
      raise exception 'Campaign status change % -> % is not allowed', old.status, new.status
        using errcode = '42501';
    end if;

    -- NAYA: resume ke liye approved creative + end_date guzri na ho
    if old.status = 'paused' and new.status = 'active' then
      if not exists (
        select 1 from public.ad_creatives x
        where x.campaign_id = new.id and x.status = 'approved'
      ) then
        raise exception 'Campaign needs an approved creative before it can resume'
          using errcode = '42501', hint = 'resume_needs_approved_creative';
      end if;
      if new.end_date is not null and new.end_date < current_date then
        raise exception 'Campaign end date has passed'
          using errcode = '42501', hint = 'resume_campaign_ended';
      end if;
    end if;
  elsif old.status in ('pending_review', 'completed', 'archived') then
    if (new.name, new.category, new.total_budget, new.daily_budget, new.start_date, new.end_date)
       is distinct from
       (old.name, old.category, old.total_budget, old.daily_budget, old.start_date, old.end_date) then
      raise exception 'Campaign is locked while status is %', old.status using errcode = '42501';
    end if;
  end if;

  if new.category is distinct from old.category and old.status not in ('draft', 'rejected') then
    raise exception 'Category can only be changed while draft or rejected' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_changes() from public, anon, authenticated;

commit;

-- Check 1 (Expect: 0 rows) : advertiser profile bina advertiser row ke
--   select p.id from public.profiles p
--   where p.role = 'advertiser' and not exists (select 1 from public.advertisers a where a.profile_id = p.id);
-- Check 2 : trigger ab bhi laga hai (Expect: 1 row)
--   select tgname from pg_trigger where tgname = 'campaigns_guard_changes';
