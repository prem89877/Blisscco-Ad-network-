-- =====================================================================
-- BLISSCCO | Day 3 | Part 2 of 4 : advertisers + publishers
-- Pehle Part 1 chala hona chahiye.
--
-- Design notes
-- * Ek profile = ek advertiser account (ya ek publisher account), UNIQUE(profile_id).
-- * Composite foreign key (profile_id, profile_role) -> profiles(id, role):
--   advertiser row sirf role='advertiser' wale profile ke liye ban sakti hai,
--   publisher row sirf role='publisher' ke liye. Is wajah se profile ka role
--   tab tak nahi badal sakta jab tak uske advertiser/publisher row hai.
-- * ON DELETE RESTRICT: profile/account galti se delete nahi hoga jab tak
--   uske business records hain. Hatana ho toh status = 'suspended' karo.
-- * Koi card/bank/payment detail yahan NAHI. Payments baad me payment provider
--   (jaise Stripe/Razorpay) sambhalega; hum sirf uska reference id rakhenge.
-- =====================================================================

-- ---------- advertisers ----------
create table if not exists public.advertisers (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null,
  profile_role text not null default 'advertiser',
  company_name text not null,
  website_url  text,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint advertisers_profile_id_key unique (profile_id),
  constraint advertisers_profile_fk
    foreign key (profile_id, profile_role)
    references public.profiles (id, role)
    on delete restrict on update restrict,
  constraint advertisers_profile_role_check check (profile_role = 'advertiser'),
  constraint advertisers_company_name_check
    check (char_length(btrim(company_name)) between 1 and 150),
  constraint advertisers_website_url_check
    check (website_url is null or (website_url ~* '^https://[^[:space:]]+$' and char_length(website_url) <= 2048)),
  constraint advertisers_status_check
    check (status in ('pending', 'active', 'suspended'))
);

comment on table  public.advertisers is 'Advertiser business account. Naya account pending se shuru hota hai (approval baad me).';
comment on column public.advertisers.status is 'pending | active | suspended';

create index if not exists advertisers_status_idx on public.advertisers (status);

drop trigger if exists advertisers_set_updated_at on public.advertisers;
create trigger advertisers_set_updated_at
  before update on public.advertisers
  for each row execute function public.set_updated_at();

-- ---------- publishers ----------
create table if not exists public.publishers (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null,
  profile_role text not null default 'publisher',
  name         text not null,   -- chatbot / platform ka naam
  website_url  text,
  category     text,            -- publisher ka main topic (matching ke liye, optional)
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint publishers_profile_id_key unique (profile_id),
  constraint publishers_profile_fk
    foreign key (profile_id, profile_role)
    references public.profiles (id, role)
    on delete restrict on update restrict,
  constraint publishers_profile_role_check check (profile_role = 'publisher'),
  constraint publishers_name_check
    check (char_length(btrim(name)) between 1 and 150),
  constraint publishers_website_url_check
    check (website_url is null or (website_url ~* '^https://[^[:space:]]+$' and char_length(website_url) <= 2048)),
  constraint publishers_category_check
    check (category is null or category ~ '^[a-z0-9_]{1,50}$'),
  constraint publishers_status_check
    check (status in ('pending', 'active', 'suspended'))
);

comment on table  public.publishers is 'AI chatbot publisher account. Yahan chatbot prompts/conversations KABHI store nahi hote.';
comment on column public.publishers.category is 'Lowercase slug, jaise beauty, finance, education (campaigns.category jaisa format).';

create index if not exists publishers_status_idx on public.publishers (status);

drop trigger if exists publishers_set_updated_at on public.publishers;
create trigger publishers_set_updated_at
  before update on public.publishers
  for each row execute function public.set_updated_at();

-- ---------- access: abhi band ----------
alter table public.advertisers enable row level security;
alter table public.publishers  enable row level security;
revoke all on table public.advertisers from anon, authenticated;
revoke all on table public.publishers  from anon, authenticated;
