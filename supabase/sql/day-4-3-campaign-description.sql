-- =====================================================================
-- BLISSCCO | Day 4 | Part 3 : campaigns.description (optional text)
-- Pehle day-4-1-campaign-guards.sql chal chuki honi chahiye.
-- Dobara chalane par safe hai. Koi drop/delete nahi, purana data waise hi rahta hai.
--
-- DEPLOY ORDER: PEHLE yeh SQL chalao, PHIR code push karo
-- (naya code description column padhta hai; column na ho toh campaigns load nahi honge).
--
-- Is file me:
--  A. campaigns.description column (nullable, max 1000 chars, khali string nahi)
--  B. authenticated ko sirf is column par insert/update grant (baaki grants jaise the waise)
--  C. Guard function ka naya version: locked statuses (pending_review/completed/archived)
--     me description bhi lock (pehle sirf baaki fields lock the). Baaki niyam same.
-- =====================================================================

begin;

-- A
alter table public.campaigns add column if not exists description text;

alter table public.campaigns drop constraint if exists campaigns_description_check;
alter table public.campaigns add constraint campaigns_description_check
  check (description is null or (char_length(btrim(description)) between 1 and 1000));

comment on column public.campaigns.description is 'Optional: campaign kis cheez ka hai (max 1000 chars). Khali = NULL.';

-- B (RLS policies same rehti hain; sirf column-level grant jodte hain)
grant insert (description) on public.campaigns to authenticated;
grant update (description) on public.campaigns to authenticated;

-- C
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
    if (new.name, new.description, new.category, new.total_budget, new.daily_budget, new.start_date, new.end_date)
       is distinct from
       (old.name, old.description, old.category, old.total_budget, old.daily_budget, old.start_date, old.end_date) then
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

-- Check 1 (Expect: 1 row, is_nullable = YES)
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'campaigns' and column_name = 'description';
-- Check 2 (Expect: 1 row) : trigger ab bhi laga hai
--   select tgname from pg_trigger where tgname = 'campaigns_guard_changes';
-- Check 3 (Expect: 2 rows: insert, update) : authenticated ke column grants
--   select privilege_type from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'campaigns' and column_name = 'description' and grantee = 'authenticated';
