-- =====================================================================
-- BLISSCCO | Day 5 | Part 3 : matching ke support tables
-- Pehle day-5-1 aur day-5-2 chali honi chahiye. Dobara chalane par safe hai.
--
-- Tables
--  * ad_platform_settings : ek hi row; fixed platform CPM + per-key rate limit
--  * ad_serve_log         : har serve ka record (publisher, creative, topic, time). Prompt/IP/user id NAHI.
--  * creative_serve_daily : roz ka serve count (rotation ke liye)
--  * campaign_spend_daily : roz ka kharch (budget gate padhta hai; likhna Day 6 me impression par)
--  * api_rate_limits      : per-key per-minute counter
--
-- Sab par RLS on aur sab roles se grant hata diya (service_role bhi). Sirf
-- public.match_contextual_ad (security definer) inhe chhoo sakta hai.
-- =====================================================================

begin;

-- ---------- settings (ek row) ----------
create table if not exists public.ad_platform_settings (
  id                    boolean primary key default true,
  cpm_usd               numeric(8, 4) not null default 2.0000,
  rate_limit_per_minute integer not null default 60,
  updated_at            timestamptz not null default now(),

  constraint ad_platform_settings_single_row check (id),
  constraint ad_platform_settings_cpm_check check (cpm_usd > 0 and cpm_usd <= 1000),
  constraint ad_platform_settings_rate_check check (rate_limit_per_minute between 1 and 10000)
);

comment on table  public.ad_platform_settings is 'Single row. cpm_usd = har 1000 impressions ki fixed keemat (USD).';
comment on column public.ad_platform_settings.cpm_usd is 'ASSUMPTION: abhi poore platform ke liye ek fixed CPM (default 2.00 USD). Business faisla badle toh yahan update karo.';

insert into public.ad_platform_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists ad_platform_settings_set_updated_at on public.ad_platform_settings;
create trigger ad_platform_settings_set_updated_at
  before update on public.ad_platform_settings
  for each row execute function public.set_updated_at();

-- ---------- serve log ----------
create table if not exists public.ad_serve_log (
  id           bigint generated always as identity primary key,
  publisher_id uuid not null references public.publishers (id) on delete restrict,
  creative_id  uuid not null references public.ad_creatives (id) on delete restrict,
  campaign_id  uuid not null references public.campaigns (id) on delete restrict,
  topic        text not null,
  served_at    timestamptz not null default now(),

  constraint ad_serve_log_topic_check check (topic ~ '^[a-z0-9_]{1,50}$')
);

comment on table public.ad_serve_log is 'Kis publisher ko kaun sa creative kis topic par diya. Chatbot prompt, IP ya user id yahan KABHI nahi.';

create index if not exists ad_serve_log_served_at_idx   on public.ad_serve_log (served_at);
create index if not exists ad_serve_log_creative_idx    on public.ad_serve_log (creative_id);
create index if not exists ad_serve_log_publisher_idx   on public.ad_serve_log (publisher_id, served_at);
create index if not exists ad_serve_log_campaign_idx    on public.ad_serve_log (campaign_id);

-- ---------- roz ka serve count ----------
create table if not exists public.creative_serve_daily (
  creative_id uuid not null references public.ad_creatives (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  day         date not null,
  serves      integer not null default 0,

  primary key (creative_id, day),
  constraint creative_serve_daily_serves_check check (serves >= 0)
);

create index if not exists creative_serve_daily_campaign_idx on public.creative_serve_daily (campaign_id, day);

-- ---------- roz ka kharch (Day 6 me impression par likha jayega) ----------
create table if not exists public.campaign_spend_daily (
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  day         date not null,
  spent       numeric(12, 4) not null default 0,

  primary key (campaign_id, day),
  constraint campaign_spend_daily_spent_check check (spent >= 0)
);

comment on table public.campaign_spend_daily is 'Budget gate yahan se padhta hai. Abhi koi likhta nahi (impression tracking Day 6), isliye spend 0 rahega.';

-- ---------- rate limit counters ----------
create table if not exists public.api_rate_limits (
  key_id       uuid not null references public.publisher_api_keys (id) on delete cascade,
  window_start timestamptz not null,
  hits         integer not null default 0,

  primary key (key_id, window_start),
  constraint api_rate_limits_hits_check check (hits >= 0)
);

-- ---------- access band ----------
alter table public.ad_platform_settings enable row level security;
alter table public.ad_serve_log         enable row level security;
alter table public.creative_serve_daily enable row level security;
alter table public.campaign_spend_daily enable row level security;
alter table public.api_rate_limits      enable row level security;

revoke all on table public.ad_platform_settings, public.ad_serve_log, public.creative_serve_daily,
                    public.campaign_spend_daily, public.api_rate_limits
  from public, anon, authenticated, service_role;
revoke all on sequence public.ad_serve_log_id_seq from public, anon, authenticated, service_role;

commit;

-- Check (Expect: 1 row): select cpm_usd, rate_limit_per_minute from public.ad_platform_settings;
