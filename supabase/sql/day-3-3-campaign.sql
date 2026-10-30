-- =====================================================================
-- BLISSCCO | Day 3 | Part 3 of 4 : campaigns
-- Pehle Part 1 aur 2 chalne chahiye.
--
-- Design notes
-- * MONEY: numeric(12,2) (exact decimals, float kabhi nahi). Max 9,999,999,999.99.
-- * CURRENCY ASSUMPTION: abhi poore platform ke liye ek hi currency, USD.
--   campaigns.currency_code column hai par CHECK sirf 'USD' allow karta hai.
--   INR chahiye toh neeche check me 'USD' ko 'INR' kar do (ya constraint hata kar
--   multi-currency baad me jodo). Amount ke saath currency hamesha saath rakhi hai.
-- * ON DELETE RESTRICT: advertiser delete karne par uske campaigns nahi udte.
--   Campaign hatana ho toh status = 'archived' karo (soft delete).
-- * Schedule: start_date / end_date (date). end_date khali = open-ended.
--   Din ki seema (timezone) delivery logic ke stage me tay hogi.
-- * Category: lowercase slug (beauty, finance...). Fixed list nahi, taaki
--   nayi category ke liye migration na chahiye.
-- =====================================================================

create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete restrict,
  name          text not null,
  category      text not null,
  status        text not null default 'draft',
  currency_code text not null default 'USD',
  total_budget  numeric(12, 2) not null,
  daily_budget  numeric(12, 2),
  start_date    date not null,
  end_date      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint campaigns_name_check
    check (char_length(btrim(name)) between 1 and 150),
  constraint campaigns_category_check
    check (category ~ '^[a-z0-9_]{1,50}$'),
  constraint campaigns_status_check
    check (status in ('draft', 'pending_review', 'active', 'paused', 'completed', 'rejected', 'archived')),
  constraint campaigns_currency_usd_only
    check (currency_code = 'USD'),
  constraint campaigns_total_budget_check
    check (total_budget > 0),
  constraint campaigns_daily_budget_check
    check (daily_budget is null or (daily_budget > 0 and daily_budget <= total_budget)),
  constraint campaigns_schedule_check
    check (end_date is null or end_date >= start_date)
);

comment on table  public.campaigns is 'Advertiser ke campaigns: category, budget, status, schedule.';
comment on column public.campaigns.status is 'draft | pending_review | active | paused | completed | rejected | archived';
comment on column public.campaigns.total_budget is 'Poore campaign ka budget, currency_code me (abhi USD).';
comment on column public.campaigns.daily_budget is 'Optional roz ki limit; total_budget se zyada nahi ho sakti.';

create index if not exists campaigns_advertiser_status_idx on public.campaigns (advertiser_id, status);
-- Ad matching ke liye: sirf active campaigns, category + dates se
create index if not exists campaigns_active_match_idx
  on public.campaigns (category, start_date, end_date)
  where status = 'active';

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------- access: abhi band ----------
alter table public.campaigns enable row level security;
revoke all on table public.campaigns from anon, authenticated;
