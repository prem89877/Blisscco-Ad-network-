-- =====================================================================
-- BLISSCCO | Day 3 | Part 4 of 4 : ad_creatives
-- Pehle Part 1, 2 aur 3 chalne chahiye.
--
-- Design notes
-- * Ek campaign ke kai creatives ho sakte hain.
-- * ON DELETE RESTRICT: creatives wale campaign ko delete nahi kar sakte.
--   Hatana ho toh status = 'archived'.
-- * Destination URL sirf https:// (safe + paid ad ke liye zaroori).
-- * Review: reviewed_by/reviewed_at moderation ke liye. Reviewer ka profile
--   delete ho toh creative nahi udta (ON DELETE SET NULL).
-- * Rejected creative me reason zaroori hai.
-- * Yahan chatbot user ka koi prompt/conversation ya personal data nahi.
-- =====================================================================

create table if not exists public.ad_creatives (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns (id) on delete restrict,
  headline         text not null,
  body             text not null,
  cta_text         text,
  destination_url  text not null,
  status           text not null default 'draft',
  rejection_reason text,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint ad_creatives_headline_check
    check (char_length(btrim(headline)) between 1 and 90),
  constraint ad_creatives_body_check
    check (char_length(btrim(body)) between 1 and 300),
  constraint ad_creatives_cta_text_check
    check (cta_text is null or char_length(btrim(cta_text)) between 1 and 30),
  constraint ad_creatives_destination_url_check
    check (destination_url ~* '^https://[^[:space:]]+$' and char_length(destination_url) <= 2048),
  constraint ad_creatives_status_check
    check (status in ('draft', 'pending_review', 'approved', 'rejected', 'paused', 'archived')),
  constraint ad_creatives_rejection_reason_check
    check (
      (status <> 'rejected' or rejection_reason is not null)
      and (rejection_reason is null or char_length(rejection_reason) <= 500)
    )
);

comment on table  public.ad_creatives is 'Campaign se jude ad text + destination URL + review status.';
comment on column public.ad_creatives.status is 'draft | pending_review | approved | rejected | paused | archived';

create index if not exists ad_creatives_campaign_status_idx on public.ad_creatives (campaign_id, status);
create index if not exists ad_creatives_reviewed_by_idx on public.ad_creatives (reviewed_by);

drop trigger if exists ad_creatives_set_updated_at on public.ad_creatives;
create trigger ad_creatives_set_updated_at
  before update on public.ad_creatives
  for each row execute function public.set_updated_at();

-- ---------- access: abhi band ----------
alter table public.ad_creatives enable row level security;
revoke all on table public.ad_creatives from anon, authenticated;

-- Optional check (chalane ke baad 5 tables dikhni chahiye):
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('profiles','advertisers','publishers','campaigns','ad_creatives')
--   order by table_name;
