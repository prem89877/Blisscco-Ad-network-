-- =====================================================================
-- BLISSCCO | Day 12 | Part 2 | Migration 2 of 2 (file day-12-2) : ad_events (serve / impression / click ka alag event model) + retention
-- Pehle day-12-1-serve-ref.sql chali honi chahiye (composite FK uski unique key par tikta hai). Dobara chalane par safe hai.
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Faisle (Day 12 Part 1, section 10):
--   D1 = Blisscco-native events pehle. Source list generic hai ('external' = baad me koi bhi bahari system). Koi bahari ad-server code nahi.
--   D2 = serve_ref publisher ko opt-in request header se milega. Ye migration sirf DB tayyar karti hai; API/header ka code is migration me NAHI.
--   D3 (1 serve = 1 click) aur "1 serve = 1 impression" DB me unique rules se lagu. D4/D5/D6 (click ke liye impression pehle, delay, bot) abhi DB me NAHI:
--      wo writer function ka kaam hain (alag part).
--
-- Is file me:
--  A. public.ad_events : sirf wahi jo attribution, verification, dedupe aur analytics ko chahiye. Prompt / IP / user agent / user id / referrer KABHI nahi.
--  B. Dedupe: event_id unique, (serve_id, event_type) unique, (source, external_event_id) unique.
--  C. Attribution: composite FK (serve_id, publisher_id, creative_id, campaign_id) -> ad_serve_log. Galat publisher/campaign/creative ka event insert hi nahi hota.
--  D. Guard trigger: append-only (UPDATE band) + event serve se pehle ka nahi ho sakta.
--  E. RLS on + saare roles se grant hata hua (project ka tareeka). Sirf security-definer code chhoo sakta hai.
--  F. Retention: private.purge_old_ad_logs ab pehle events hatata hai, phir serve log (usi 90 din ke cutoff par). Baaki purge ka kaam jaisa tha waisa.
--
-- Jo NAHI badalta: record_ad_serve, billing/spend, campaign_spend_daily, creative_serve_daily, ad_serve_requests, koi purani row.
-- Serve ko impression NAHI ginte: koi trigger/function ad_serve_log se ad_events me kuch nahi likhta.
-- =====================================================================

begin;

-- ---------- A. table ----------
create table if not exists public.ad_events (
  id                bigint generated always as identity primary key,
  event_id          uuid        not null default gen_random_uuid(),
  serve_id          bigint      not null,
  publisher_id      uuid        not null,
  campaign_id       uuid        not null,
  creative_id       uuid        not null,
  event_type        text        not null,
  source            text        not null,
  external_event_id text,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),

  constraint ad_events_event_id_key unique (event_id),
  -- Ek serve = ek serve-event, ek impression, ek click (D3 = 1 click). Teeno type alag rows hain, interchangeable nahi.
  constraint ad_events_one_per_type_key unique (serve_id, event_type),
  -- Attribution DB khud pakka karta hai: teeno ids usi serve row ke honi chahiye.
  constraint ad_events_serve_attribution_fk
    foreign key (serve_id, publisher_id, creative_id, campaign_id)
    references public.ad_serve_log (id, publisher_id, creative_id, campaign_id)
    on delete restrict,
  constraint ad_events_type_check check (event_type in ('serve', 'impression', 'click')),
  constraint ad_events_source_check check (source in ('blisscco_beacon', 'blisscco_redirect', 'publisher_server', 'external')),
  constraint ad_events_external_id_check check (external_event_id is null or external_event_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  -- Client ka occurred_at bharose ka nahi: future me (5 min se zyada) nahi ho sakta. Asli samay received_at hai (server ka).
  constraint ad_events_not_future_check check (occurred_at <= received_at + interval '5 minutes')
);

comment on table public.ad_events is
  'Serve / impression / click events, har ek ek serve se juda. Sirf attribution+dedupe+analytics ka data. Chatbot prompt, IP, user agent, user id KABHI nahi. Append-only. Purge: serve log ke saath (90 din).';
comment on column public.ad_events.event_type is
  'serve | impression | click: alag cheezein. ad_serve_log hi serve ka authoritative record aur billing ka aadhar hai; ye column serve ko impression nahi banata.';
comment on column public.ad_events.source is
  'Event kahan se aaya: blisscco_beacon | blisscco_redirect | publisher_server | external (future bahari system).';
comment on column public.ad_events.external_event_id is
  'Bhejne wale ki apni event id (replay rokne ke liye). Ginti ki pehchaan nahi: ginti (serve_id, event_type) se hoti hai.';

-- ---------- B. dedupe + analytics indexes ----------
-- Bahari id wali duplicate event: wahi (source, external_event_id) dobara => unique violation (23505). NULL ids ko rokta nahi.
create unique index if not exists ad_events_source_external_key
  on public.ad_events (source, external_event_id)
  where external_event_id is not null;

create index if not exists ad_events_campaign_idx  on public.ad_events (campaign_id, event_type, occurred_at);
create index if not exists ad_events_publisher_idx on public.ad_events (publisher_id, event_type, occurred_at);
create index if not exists ad_events_creative_idx  on public.ad_events (creative_id, event_type);
-- (serve_id par lookup ad_events_one_per_type_key ke leading column se hota hai; purge ke liye received_at alag se zaroori nahi: purge serve_id se chalta hai.)

-- ---------- D. guard trigger (append-only + serve se pehle ka nahi) ----------
create or replace function private.guard_ad_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_served timestamptz;
begin
  if tg_op = 'UPDATE' then
    raise exception 'ad_events rows are append-only' using errcode = '23514', hint = 'ad_events_append_only';
  end if;

  select s.served_at into v_served from public.ad_serve_log s where s.id = new.serve_id;

  -- (serve_id na mile toh FK 23503 dega; yahan sirf time rule.) 1 minute ka clock-skew chhoot.
  if v_served is not null and new.occurred_at < v_served - interval '1 minute' then
    raise exception 'Event cannot happen before its serve' using errcode = '23514', hint = 'event_before_serve';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_ad_event() from public, anon, authenticated, service_role;

drop trigger if exists ad_events_guard on public.ad_events;
create trigger ad_events_guard
  before insert or update on public.ad_events
  for each row execute function private.guard_ad_event();

-- ---------- E. access band (project ka tareeka: RLS on, koi policy nahi, saare roles se grant hata) ----------
alter table public.ad_events enable row level security;

revoke all on table public.ad_events from public, anon, authenticated, service_role;
revoke all on sequence public.ad_events_id_seq from public, anon, authenticated, service_role;

-- ---------- F. retention ----------
-- day-9-5 wala function jaisa tha waisa hi hai (90 din minimum 30, rate limits 1 din, retry keys 48 ghante, campaign_spend_daily ko nahi chhuta);
-- sirf ek naya pehla step: us cutoff se purani serves ke events pehle hatao (FK RESTRICT hai, isliye events pehle zaroori).
-- Event kabhi apni serve se purana nahi hota (received_at >= served_at), isliye serve-cutoff se purge sab purane events pakad leta hai.
create or replace function private.purge_old_ad_logs(p_keep_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days       integer := greatest(coalesce(p_keep_days, 90), 30);
  v_events     bigint;
  v_serve_log  bigint;
  v_serve_day  bigint;
  v_rate       bigint;
  v_requests   bigint;
begin
  delete from public.ad_events e
  using public.ad_serve_log s
  where s.id = e.serve_id
    and s.served_at < now() - make_interval(days => v_days);
  get diagnostics v_events = row_count;

  delete from public.ad_serve_log where served_at < now() - make_interval(days => v_days);
  get diagnostics v_serve_log = row_count;

  delete from public.creative_serve_daily where day < ((now() at time zone 'utc')::date - v_days);
  get diagnostics v_serve_day = row_count;

  delete from public.api_rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  delete from public.ad_serve_requests where created_at < now() - interval '48 hours';
  get diagnostics v_requests = row_count;

  return jsonb_build_object(
    'ad_events', v_events,
    'ad_serve_log', v_serve_log,
    'creative_serve_daily', v_serve_day,
    'api_rate_limits', v_rate,
    'ad_serve_requests', v_requests
  );
end;
$$;

revoke all on function private.purge_old_ad_logs(integer) from public, anon, authenticated, service_role;

commit;

-- Check 1 (Expect: 1 row, relrowsecurity = true)
--   select relname, relrowsecurity from pg_class where oid = 'public.ad_events'::regclass;
-- Check 2 (Expect: 0 rows: kisi bhi app role ke paas table par koi grant nahi)
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'ad_events' and grantee in ('public', 'anon', 'authenticated', 'service_role');
-- Check 3 (Expect: 1 row, tgenabled = 'O')
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.ad_events'::regclass and tgname = 'ad_events_guard' and not tgisinternal;
-- Check 4 (Expect: result me 'ad_events' key hai; test project par hi chalao: purane logs delete karta hai)
--   select private.purge_old_ad_logs(90);
