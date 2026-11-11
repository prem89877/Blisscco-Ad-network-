-- =====================================================================
-- BLISSCCO PHASE 6 — STEP 4 — PART 3
-- PILOT BUDGET LIMITS DATABASE GUARD ($1,000 / $2,000)
--
-- Closes two critical gaps:
--   G1 (race): pilotTotalProblem() in app code is read-then-write.
--   G2 (bypass): campaigns_insert_own / campaigns_update_own RLS policies
--       allow direct Supabase API inserts/updates bypassing app logic.
--
-- Limits enforced:
--   - Single campaign total_budget <= $1,000.00
--   - All counted campaigns of the advertiser <= $2,000.00
--
-- Trigger firing order on public.campaigns:
--   Postgres fires BEFORE triggers in alphabetical order by trigger name:
--     1. campaigns_guard_budget   (day-9-3: prevents total_budget < spent)
--     2. campaigns_guard_changes  (day-3-5: status transitions & locks)
--     3. campaigns_guard_pilot_limits (this trigger: advisory lock & pilot caps)
--     4. campaigns_guard_pricing  (part 1: pricing model locks)
--
-- Lock order:
--   Uses pg_advisory_xact_lock(hashtextextended('blisscco:pilot_advertiser:' || advertiser_id, 0))
--   This serializes all inserts/updates of the SAME advertiser and avoids
--   deadlocks with row locks taken by record_ad_serve / settle_event_billing.
-- =====================================================================

begin;

create or replace function private.guard_pilot_campaign_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Parity with lib/campaigns/constants.ts
  c_pilot_max_campaign_budget constant numeric := 1000; -- must equal PILOT_MAX_CAMPAIGN_BUDGET
  c_pilot_max_advertiser_total constant numeric := 2000; -- must equal PILOT_MAX_ADVERTISER_TOTAL
  -- Counted statuses: draft, pending_review, active, paused, completed (must equal PILOT_COUNTED_STATUSES)
  v_others numeric;
begin
  -- 1. On UPDATE: check only if budget changed, status moved into counted, or advertiser changed.
  -- Old oversized campaigns (> $1,000 created before limits) can still be renamed, approved, or paused!
  if tg_op = 'UPDATE' then
    if (new.total_budget is not distinct from old.total_budget)
       and not (old.status in ('rejected', 'archived') and new.status in ('draft', 'pending_review', 'active', 'paused', 'completed'))
       and (new.advertiser_id is not distinct from old.advertiser_id) then
      return new;
    end if;
  end if;

  -- 2. Advisory transaction lock serializes creates and budget edits for this advertiser (Closes G1 race).
  perform pg_advisory_xact_lock(hashtextextended('blisscco:pilot_advertiser:' || new.advertiser_id::text, 0));

  -- 3. Per-campaign limit check ($1,000)
  if tg_op = 'INSERT' or (new.total_budget is distinct from old.total_budget) then
    if new.total_budget > c_pilot_max_campaign_budget then
      raise exception 'During the pilot, one campaign can have a total budget of at most $1,000.00.'
        using errcode = '23514', hint = 'pilot_campaign_limit';
    end if;
  end if;

  -- 4. Per-advertiser cumulative limit check ($2,000)
  -- Counted statuses mirror PILOT_COUNTED_STATUSES. Rejected and archived are excluded.
  if new.status in ('draft', 'pending_review', 'active', 'paused', 'completed') then
    select coalesce(sum(c.total_budget), 0)
      into v_others
      from public.campaigns c
     where c.advertiser_id = new.advertiser_id
       and (tg_op = 'INSERT' or c.id <> new.id)
       and c.status in ('draft', 'pending_review', 'active', 'paused', 'completed');

    if (v_others + new.total_budget) > c_pilot_max_advertiser_total then
      raise exception 'During the pilot, all your campaigns together can have at most $2,000.00 in total budget.'
        using errcode = '23514', hint = 'pilot_advertiser_limit';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_pilot_campaign_limits() from public, anon, authenticated, service_role;

drop trigger if exists campaigns_guard_pilot_limits on public.campaigns;

create trigger campaigns_guard_pilot_limits
  before insert or update of total_budget, status, advertiser_id
  on public.campaigns
  for each row
  execute function private.guard_pilot_campaign_limits();

commit;

-- =====================================================================
-- READ-ONLY VERIFICATION (Footer checks)
-- =====================================================================

-- 1. Verify trigger exists and is active
-- Expect: 1 row with tgname = 'campaigns_guard_pilot_limits'
select
  tgname,
  tgenabled,
  case when tgenabled = 'O' then 'pass: active' else 'FAIL' end as status
from pg_trigger
where tgname = 'campaigns_guard_pilot_limits';

-- 2. Verify function permissions (no EXECUTE for public/app roles)
-- Expect: 0 rows
select
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'private'
  and routine_name = 'guard_pilot_campaign_limits'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');

-- 3. Informational: Advertisers currently above the pilot limit (legacy campaigns)
select
  advertiser_id,
  sum(total_budget) as total_committed,
  count(*)::int as active_campaigns_count
from public.campaigns
where status in ('draft', 'pending_review', 'active', 'paused', 'completed')
group by advertiser_id
having sum(total_budget) > 2000;
