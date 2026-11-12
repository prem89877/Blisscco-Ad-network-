-- =====================================================================
-- BLISSCCO PHASE 6 — DAY 2 — PART 4 — G-1 TIGHTENING (forward-only)
-- Owner decision 2026-11-12: rejected campaigns above $1,000 cannot reopen without a budget
-- reduced to <= $1,000.00 (then normal re-approval). No new daily caps. No limit/rule values changed.
-- Only function private.guard_pilot_campaign_limits() is replaced; trigger definition is re-created identically.
-- TEST project ONLY. WRITTEN, NOT RUN BY AI. Re-run phase6-day2-part3-pilot-limits-boundary-rollback.sql afterwards (regression, expect 13/13 PASS).
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
  -- G-1 (owner-approved 2026-11-12): a REJECTED campaign above the cap cannot re-enter the counted
  -- statuses at an unchanged budget; its budget must first be reduced to <= $1,000.00 (and it is then
  -- re-approved through the normal review flow). Other legacy oversized campaigns are NOT affected.
  if tg_op = 'INSERT'
     or (new.total_budget is distinct from old.total_budget)
     or (old.status = 'rejected' and new.status in ('draft', 'pending_review', 'active', 'paused', 'completed')) then
    if new.total_budget > c_pilot_max_campaign_budget then
      raise exception 'During the pilot, one campaign can have a total budget of at most $1,000.00. Reduce the budget to $1,000.00 or less before reopening.'
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

-- READ-ONLY VERIFICATION
select tgname, tgenabled, case when tgenabled = 'O' then 'pass: active' else 'FAIL' end as status
from pg_trigger where tgname = 'campaigns_guard_pilot_limits';

select case when pg_get_functiondef('private.guard_pilot_campaign_limits()'::regprocedure) like '%old.status = ''rejected''%'
            then 'pass: G-1 rule present' else 'FAIL: G-1 rule missing' end as g1_status;
