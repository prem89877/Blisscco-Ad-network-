-- =====================================================================
-- BLISSCCO | Day 9 | Part 2 : campaign budget rules (database level)
-- Pehle Day 3 aur Day 7 ki SQL chalni chahiye. Dobara chalane par safe hai (idempotent).
-- KOI table/column drop nahi hota, koi data delete/badla nahi jata, RLS ko haath nahi lagta.
--
-- Is file me 2 cheezein:
--  A. total_budget par upar ki seema (<= 10,000,000.00), jo app (MAX_BUDGET) ke barabar hai.
--     Purani rows me agar kisi ki value isse badi mili toh migration ROK deti hai (kuch badalti nahi).
--  B. Trigger: total_budget ab tak ke kharch (campaign_spend_daily ka sum) se neeche NAHI ja sakta.
--     Ye app ke check ke neeche ki asli deewar hai: SQL/API se seedha update karne par ya
--     "padhne aur likhne ke beech serve ho gaya" wali race me bhi budget kharch se neeche nahi jata.
--     Race-safe: trigger campaign row par lock leta hai, aur record_ad_serve bhi usi row par lock leta hai.
--
-- Jo DB me NAHI rakha (jaan-boojh kar): minimum budget ($1 total / $0.50 daily). Wo sirf tab lagta hai jab
-- value badli ho, taaki purana campaign sirf naam badalne par na atke. DB CHECK har update par poori row dekhta hai.
-- =====================================================================

begin;

-- ---------- A. total budget ki upar seema ----------
do $$
begin
  if exists (select 1 from public.campaigns where total_budget > 10000000) then
    raise exception 'Day 9-3 roka gaya: kuch campaigns ka total_budget 10,000,000 se zyada hai. Pehle unhe dekho: select id, total_budget from public.campaigns where total_budget > 10000000;';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_total_budget_max_check' and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_total_budget_max_check check (total_budget <= 10000000);
  end if;
end $$;

-- ---------- B. total budget kharch se neeche nahi ----------
create or replace function private.guard_campaign_budget()
returns trigger
language plpgsql
security definer                 -- kharch ki table authenticated ko seedha padhne nahi deti, isliye
set search_path = ''
as $$
declare
  v_spent numeric;
begin
  -- Sirf tab dekho jab total budget badal raha ho.
  if new.total_budget is not distinct from old.total_budget then
    return new;
  end if;

  -- Campaign row par lock: record_ad_serve bhi isi row par "for update" leta hai, isliye kharch + budget
  -- ek saath nahi badal sakte (race nahi).
  perform 1 from public.campaigns c where c.id = old.id for update;

  select coalesce(sum(d.spent), 0) into v_spent
  from public.campaign_spend_daily d
  where d.campaign_id = old.id;

  if new.total_budget < v_spent then
    raise exception 'Total budget cannot be lower than the amount already spent'
      using errcode = '23514', hint = 'budget_below_spend';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_budget() from public, anon, authenticated;

drop trigger if exists campaigns_guard_budget on public.campaigns;
create trigger campaigns_guard_budget
  before update of total_budget on public.campaigns
  for each row execute function private.guard_campaign_budget();

commit;

-- Check 1 (Expect: 1 row each)
--   select conname from pg_constraint where conrelid = 'public.campaigns'::regclass and conname = 'campaigns_total_budget_max_check';
--   select tgname from pg_trigger where tgname = 'campaigns_guard_budget' and not tgisinternal;
-- Check 2 (Expect: 0 rows) : kisi campaign ka budget kharch se neeche toh nahi (purana data)
--   select c.id, c.total_budget, s.total_spent
--   from public.campaigns c
--   join (select campaign_id, sum(spent) total_spent from public.campaign_spend_daily group by 1) s on s.campaign_id = c.id
--   where c.total_budget < s.total_spent;
