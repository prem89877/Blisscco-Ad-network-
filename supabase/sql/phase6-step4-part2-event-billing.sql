-- =====================================================================
-- BLISSCCO | Phase 6 | Step 4 Part 2 : EVENT-BASED BILLING (valid impression / valid click par charge)
-- Pehle chali honi chahiye: day-12-1, day-12-2, day-12-5, day-12-7, day-12-10, day-13-1, day-13-4, day-9-3, day-9-7 aur
-- phase6-step4-part1-campaign-pricing (campaigns.pricing_model / cpm_rate_usd / cpc_rate_usd).
-- FORWARD-ONLY: koi purani migration file nahi badli, koi table/column drop nahi, koi purani row nahi badalti, koi BACKFILL nahi.
-- Dobara chalane par safe hai (create table if not exists / create or replace / drop+create trigger).
-- PEHLE TEST project (denim) par chalao. PRODUCTION PAR ABHI NAHI. (Ye file kisi database par chalayi NAHI gayi hai.)
-- Ledger BAND rehta hai (ledger_settings.ledger_enabled = false). Is file me ledger ON karne wali koi line nahi hai.
--
-- ---------------------------------------------------------------------
-- PURANA BEHAVIOUR (jo ab khatam hota hai)
-- ---------------------------------------------------------------------
--   record_ad_serve (day-12-5 / day-13-4) har SERVE par campaign_spend_daily me CPM/1000 jodta tha (aur ledger ON hota toh ledger me bhi).
--   Yaani ad ka JSON response dene par hi advertiser se paisa kat jaata tha, chahe ad kabhi dikha ho ya nahi.
--
-- NAYA BEHAVIOUR (ye file)
-- ---------------------------------------------------------------------
--   * Serve (API response)  : paisa NAHI katta. Sirf budget RESERVE hota hai (ek "hold"). campaign_spend_daily nahi badalti.
--   * CPM campaign          : sirf us serve ke PEHLE valid impression par charge (settlement).
--   * CPC campaign          : sirf us serve ke PEHLE valid click par charge. Click ko ab bhi impression chahiye (D4, day-12-10).
--   * Duplicate / invalid / expired / not_counted / ineligible event : kabhi charge nahi.
--   * Legacy serves (is migration se pehle ke): reservation row hi nahi hoti => unke events par charge NAHI (unka charge serve par ho chuka hai).
--
-- Amount KABHI client se nahi aata. Do nayi baatein trusted database records se:
--   - pricing  : campaigns.pricing_model / cpm_rate_usd / cpc_rate_usd (serve ke waqt reservation me SNAPSHOT ho jaati hai;
--                baad me advertiser rate badle toh purani reserved serve ki keemat nahi badalti). model NULL = purana campaign = platform CPM
--                (ad_platform_settings.cpm_usd), wahi formula jo pehle tha: greatest(round(cpm / 1000, 4), 0.0001).
--   - publisher: ad_serve_log.publisher_id (serve ke waqt API key se nikla). Event RPC ka p_publisher_id sirf MILAN ke liye hai.
--
-- ---------------------------------------------------------------------
-- BUDGET PROTECTION (reserve -> settle / release)
-- ---------------------------------------------------------------------
--   Serve ke waqt (campaign row par FOR UPDATE lock ke andar):
--     spent_total + held_total + amount  <= total_budget
--     spent_today + held_today + amount  <= daily_budget   (agar daily_budget set ho)
--   spent_*  = campaign_spend_daily (ab sirf SETTLED / charged paisa).  held_* = abhi tak zinda reservations.
--   Isliye bahut saari serves ek saath aayein toh bhi, impression/click ka intezaar karte hue, budget paar nahi ho sakta.
--   Settlement (impression/click par) usi campaign lock ke andar hold -> spent badalta hai: total (spent + held) NAHI badalta,
--   isliye budget kabhi "do baar gina" ya "chhoot" nahi sakta.
--   Release: reservation ki umr = serve se 24 ghante (wahi window jo impression/click ke liye hai, day-12-7 / day-12-10).
--   expires_at guzarte hi hold budget me ginna band (turant, bina kisi job ke). Row ko 'released' mark karna:
--   (a) record_ad_serve usi campaign ke expired holds ko saaf karta hai, (b) public.release_expired_budget_reservations() (service_role) bulk saaf karta hai.
--
-- UTC ACCOUNTING RULES
-- ---------------------------------------------------------------------
--   1. Sab "din" UTC hain: (now() at time zone 'utc')::date. Database session timezone ka koi asar nahi.
--   2. Reservation ka reserve_day = SERVE ka UTC din. Settlement ka paisa campaign_spend_daily me usi reserve_day par jaata hai,
--      EVENT ke din par NAHI. Wajah: daily_budget ki jaanch serve ke din hi ho chuki hai; settlement ko doosre din par daalte toh
--      us din ka daily limit bina jaanche paar ho sakta tha. (Raat 23:59 UTC ki serve, 00:01 UTC ka impression => kharch pichle din ka.)
--   3. daily_budget check: spent_today (settled, reserve_day = aaj) + held_today (reserve_day = aaj, expire nahi hui) + amount.
--      Kal ki holds aaj ke daily limit me nahi ginti; wo kal ke din ki hain (aur aaj tak ya toh settle ho jaati hain ya expire).
--   4. total_budget check: saare dinon ka spent + saari zinda holds + amount.
--   5. Hold ki umr: served_at + 24 ghante (exactly). Event window bhi wahi: now() >= served_at + 24h => event rejected.
--   6. Ek serve = ek reservation = zyada se zyada ek settlement (primary key serve_id + status guard).
--
-- Jaan-boojh kar jo nahi badla: ad_events ki structure / dedupe constraint (ad_events_one_per_type_key), serve_ref, ad_serve_requests / retry-replay
-- (4-arg record_ad_serve + replay_serve + find_idempotent_serve waise hi), lookup_serve_for_event / lookup_serve_for_click, click_target,
-- tracking token security, RLS / grants (naye objects par bhi RLS on, saare roles se grant hata).
-- Jaan-boojh kar nahi kiya: public.load_ad_candidates ko nahi badla (wo sirf pre-filter hai; asli budget guard record_ad_serve hai).
--   Poori tarah reserved campaign candidate me aa sakta hai; record_ad_serve use 'rejected' karta hai aur app agla candidate try karta hai (no-fill safe).
-- =====================================================================

begin;

create schema if not exists private;

-- ---------------------------------------------------------------------
-- A. public.ad_budget_reservations : har serve ka budget hold
-- ---------------------------------------------------------------------
create table if not exists public.ad_budget_reservations (
  serve_id           bigint      primary key references public.ad_serve_log (id) on delete cascade,
  campaign_id        uuid        not null references public.campaigns (id) on delete restrict,
  publisher_id       uuid        not null references public.publishers (id) on delete restrict,
  pricing_model      text        not null,
  amount             numeric(12, 4) not null,
  reserve_day        date        not null,
  status             text        not null default 'held',
  billed_event_type  text,
  reserved_at        timestamptz not null default now(),
  expires_at         timestamptz not null,
  settled_at         timestamptz,
  released_at        timestamptz,

  constraint ad_budget_reservations_model_check  check (pricing_model in ('cpm', 'cpc')),
  constraint ad_budget_reservations_amount_check check (amount > 0),
  constraint ad_budget_reservations_status_check check (status in ('held', 'settled', 'released')),
  constraint ad_budget_reservations_expiry_check check (expires_at > reserved_at),
  -- Shape: held = kuch settle/release nahi; settled = event type + settled_at; released = released_at.
  constraint ad_budget_reservations_shape_check check (
    (status = 'held'     and settled_at is null     and released_at is null     and billed_event_type is null)
    or (status = 'settled'  and settled_at is not null and released_at is null     and billed_event_type is not null)
    or (status = 'released' and settled_at is null     and released_at is not null and billed_event_type is null)
  ),
  -- CPM sirf impression par, CPC sirf click par settle ho sakta hai (database khud pakka karta hai).
  constraint ad_budget_reservations_event_model_check check (
    status <> 'settled'
    or (pricing_model = 'cpm' and billed_event_type = 'impression')
    or (pricing_model = 'cpc' and billed_event_type = 'click')
  )
);

comment on table public.ad_budget_reservations is
  'Serve ka budget hold. Serve par paisa nahi katta, sirf hold. Valid impression (CPM) / valid click (CPC) par settled (campaign_spend_daily me jaata hai); 24 ghante baad released. Amount trusted pricing ka snapshot. Client se kabhi nahi.';
comment on column public.ad_budget_reservations.reserve_day is
  'Serve ka UTC din. Settlement ka kharch isi din par likha jaata hai (event ke din par nahi), taaki daily budget ki jaanch sahi rahe.';
comment on column public.ad_budget_reservations.expires_at is
  'served_at + 24 ghante. Iske baad hold budget me nahi ginta aur event bhi charge nahi hota.';

-- Budget sums (serve ke andar) tez rakhne ke liye: sirf zinda holds par partial indexes.
create index if not exists ad_budget_reservations_held_campaign_idx
  on public.ad_budget_reservations (campaign_id, reserve_day) where status = 'held';
create index if not exists ad_budget_reservations_held_expiry_idx
  on public.ad_budget_reservations (expires_at) where status = 'held';

-- Reservation ek taraf ki yatra: held -> settled | released. Baaki sab column immutable. (DELETE sirf serve-log purge ke cascade se.)
create or replace function private.guard_budget_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'held' then
      raise exception 'Budget reservation is final once settled or released' using errcode = '23514', hint = 'reservation_final';
    end if;
    if new.status not in ('settled', 'released') then
      raise exception 'Budget reservation can only move from held to settled or released' using errcode = '23514', hint = 'reservation_bad_transition';
    end if;
    if (new.serve_id, new.campaign_id, new.publisher_id, new.pricing_model, new.amount, new.reserve_day, new.reserved_at, new.expires_at)
       is distinct from
       (old.serve_id, old.campaign_id, old.publisher_id, old.pricing_model, old.amount, old.reserve_day, old.reserved_at, old.expires_at) then
      raise exception 'Budget reservation amount, model and dates are immutable' using errcode = '23514', hint = 'reservation_immutable';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_budget_reservation() from public, anon, authenticated, service_role;

drop trigger if exists ad_budget_reservations_guard on public.ad_budget_reservations;
create trigger ad_budget_reservations_guard
  before update on public.ad_budget_reservations
  for each row execute function private.guard_budget_reservation();

-- Access band (project ka tareeka): RLS on, koi policy nahi, saare roles se grant hata. Sirf security-definer functions chhoote hain.
alter table public.ad_budget_reservations enable row level security;
revoke all on table public.ad_budget_reservations from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- B. Ledger: charge ab EVENT par (serve par nahi). Ledger band hai toh ye kuch nahi likhta.
--    Idempotency key purani jaisi: 'serve:<serve_ref>:advertiser_charge' (+ earning / revenue) => ek serve par ek hi charge entry
--    (financial_ledger ka partial unique index (source_ref, entry_type) bhi yahi rokta hai).
--    private.ledger_record_serve (purana) database me pada rehta hai par ab koi use nahi bulata.
-- ---------------------------------------------------------------------
create or replace function private.ledger_record_event(
  p_serve_ref    text,
  p_campaign_id  uuid,
  p_publisher_id uuid,
  p_amount       numeric,
  p_event_type   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled  boolean;
  v_bps      integer;
  v_adv      uuid;
  v_pub_amt  numeric;
  v_plat_amt numeric;
  v_n        integer := 1;
begin
  select s.ledger_enabled, s.publisher_share_bps into v_enabled, v_bps from public.ledger_settings s where s.id;
  if v_enabled is not true then
    return jsonb_build_object('outcome', 'disabled');
  end if;

  if p_event_type is null or p_event_type not in ('impression', 'click') then
    raise exception 'Ledger event billing needs an impression or click event' using errcode = '22023', hint = 'ledger_bad_event_type';
  end if;

  -- Ledger ON hai toh serve_ref ke bina entry nahi ban sakti: event ko hi fail karo (poora event + charge rollback).
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' then
    raise exception 'Ledger is enabled but the serve has no valid serve_ref' using errcode = '22023', hint = 'ledger_serve_ref_missing';
  end if;

  select c.advertiser_id into v_adv from public.campaigns c where c.id = p_campaign_id;
  if v_adv is null then
    raise exception 'Campaign not found for ledger entry' using errcode = '23503', hint = 'ledger_campaign_missing';
  end if;

  perform private.ledger_append('advertiser_charge', 'advertiser', p_amount, 'serve:' || p_serve_ref || ':advertiser_charge', 'serve', p_serve_ref, v_adv, p_publisher_id, p_campaign_id);

  if v_bps is not null then
    v_pub_amt  := trunc((p_amount * v_bps) / 10000, 4);
    v_plat_amt := p_amount - v_pub_amt;
    if v_pub_amt > 0 then
      perform private.ledger_append('publisher_earning', 'publisher', v_pub_amt, 'serve:' || p_serve_ref || ':publisher_earning', 'serve', p_serve_ref, null, p_publisher_id, p_campaign_id);
      v_n := v_n + 1;
    end if;
    if v_plat_amt > 0 then
      perform private.ledger_append('platform_revenue', 'platform', v_plat_amt, 'serve:' || p_serve_ref || ':platform_revenue', 'serve', p_serve_ref, null, null, p_campaign_id);
      v_n := v_n + 1;
    end if;
  end if;

  return jsonb_build_object('outcome', 'recorded', 'entries', v_n);
end;
$$;

revoke all on function private.ledger_record_event(text, uuid, uuid, numeric, text) from public, anon, authenticated, service_role;

comment on function private.ledger_record_event(text, uuid, uuid, numeric, text) is
  'Valid impression/click settlement ke andar (usi transaction me) ledger entries likhta hai. Amount settlement deta hai (trusted reservation), client nahi. Ledger band ho toh kuch nahi. Kisi role ko EXECUTE nahi.';

-- ---------------------------------------------------------------------
-- C. private.settle_event_billing : ek event ka (atomic) charge
--    Sirf record_ad_impression / record_ad_click ke andar se, event INSERT ke BAAD, usi transaction me.
--    Lock order (record_ad_serve jaisa, deadlock nahi): pehle campaign row, phir reservation row.
-- ---------------------------------------------------------------------
create or replace function private.settle_event_billing(p_serve_id bigint, p_event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res       record;
  v_serve_ref text;
  v_active    boolean;
begin
  if p_serve_id is null or p_event_type is null or p_event_type not in ('impression', 'click') then
    return jsonb_build_object('billed', false, 'reason', 'invalid_event');
  end if;

  -- Reservation nahi => migration se pehle ki serve (charge serve par ho chuka): kabhi dobara charge nahi.
  select r.campaign_id, r.pricing_model into v_res from public.ad_budget_reservations r where r.serve_id = p_serve_id;
  if not found then
    return jsonb_build_object('billed', false, 'reason', 'legacy_serve');
  end if;

  -- CPM sirf impression, CPC sirf click par charge hota hai. Doosra event record hota hai par charge nahi.
  if (v_res.pricing_model = 'cpm' and p_event_type <> 'impression')
     or (v_res.pricing_model = 'cpc' and p_event_type <> 'click') then
    return jsonb_build_object('billed', false, 'reason', 'not_billable_event');
  end if;

  -- 1) campaign row lock (record_ad_serve bhi yahi lock leta hai: budget ginti aur settlement ek saath nahi chal sakte)
  perform 1 from public.campaigns c where c.id = v_res.campaign_id for update;

  -- 2) reservation row lock + dobara padho (lock ke baad ki sahi halat)
  select r.* into v_res from public.ad_budget_reservations r where r.serve_id = p_serve_id for update;

  if v_res.status = 'settled' then
    return jsonb_build_object('billed', false, 'reason', 'already_settled');
  end if;
  if v_res.status = 'released' then
    return jsonb_build_object('billed', false, 'reason', 'released');
  end if;

  -- Hold ki umr khatam: charge nahi, hold release.
  if v_res.expires_at <= now() then
    update public.ad_budget_reservations r set status = 'released', released_at = now() where r.serve_id = p_serve_id;
    return jsonb_build_object('billed', false, 'reason', 'expired');
  end if;

  -- Publisher trusted records se (serve ke waqt wala), aur abhi bhi active hona chahiye. Nahi toh event record rahe, charge nahi.
  select exists (
    select 1 from public.publishers p join public.profiles pr on pr.id = p.profile_id
    where p.id = v_res.publisher_id and p.status = 'active' and pr.status = 'active'
  ) into v_active;
  if not v_active then
    return jsonb_build_object('billed', false, 'reason', 'publisher_inactive');
  end if;

  select s.serve_ref into v_serve_ref from public.ad_serve_log s where s.id = p_serve_id;

  update public.ad_budget_reservations r
     set status = 'settled', settled_at = now(), billed_event_type = p_event_type
   where r.serve_id = p_serve_id and r.status = 'held';

  -- Kharch = reserve_day (serve ka UTC din) par. Amount = reservation ka snapshot, kabhi caller ka nahi.
  insert into public.campaign_spend_daily (campaign_id, day, spent)
  values (v_res.campaign_id, v_res.reserve_day, v_res.amount)
  on conflict (campaign_id, day)
  do update set spent = public.campaign_spend_daily.spent + excluded.spent;

  -- Ledger (band ho toh no-op). Koi bhi error => poora event + settlement + spend rollback.
  perform private.ledger_record_event(v_serve_ref, v_res.campaign_id, v_res.publisher_id, v_res.amount, p_event_type);

  return jsonb_build_object('billed', true, 'amount', v_res.amount);
end;
$$;

revoke all on function private.settle_event_billing(bigint, text) from public, anon, authenticated, service_role;

comment on function private.settle_event_billing(bigint, text) is
  'Ek valid event ka charge: reservation held -> settled, campaign_spend_daily (reserve_day) me jodna, ledger (agar ON). Sab ek transaction me, campaign lock ke andar. Duplicate / expired / legacy / galat event type par kuch nahi.';

-- ---------------------------------------------------------------------
-- D. record_ad_serve (3 args): day-13-4 ka function, par PAISA NAHI KATTA -> BUDGET RESERVE karta hai
--    (4-arg wrapper, replay_serve, find_idempotent_serve waise hi: wahi key dobara aaye toh na naya reservation na naya serve.)
-- ---------------------------------------------------------------------
create or replace function public.record_ad_serve(
  p_key_hash    text,
  p_creative_id uuid,
  p_topic       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publisher_id  uuid;
  v_campaign_id   uuid;
  v_total         numeric;
  v_daily         numeric;
  v_model_col     text;
  v_cpm_rate      numeric;
  v_cpc_rate      numeric;
  v_model         text;
  v_cpm           numeric;
  v_amount        numeric;
  v_spent_total   numeric;
  v_spent_today   numeric;
  v_held_total    numeric;
  v_held_today    numeric;
  v_today         date := (now() at time zone 'utc')::date;
  v_serve_id      bigint;
  v_serve_ref     text;
  v_served_at     timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  -- Publisher key se hi dhoondo (caller se publisher id kabhi nahi liya jaata).
  select k.publisher_id
    into v_publisher_id
  from public.publisher_api_keys k
  join public.publishers p  on p.id  = k.publisher_id
  join public.profiles   pr on pr.id = p.profile_id
  where k.key_hash = p_key_hash
    and k.status  = 'active'
    and (k.expires_at is null or k.expires_at > now())
    and p.status  = 'active'
    and pr.status = 'active';

  if v_publisher_id is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  if p_creative_id is null
     or p_topic is null
     or p_topic !~ '^[a-z0-9_]{1,50}$'
     or not exists (select 1 from public.ad_categories k2 where k2.slug = p_topic and k2.is_active) then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Creative dobara verify + campaign row par LOCK. Pricing bhi yahin se (trusted campaign row), caller se kuch nahi.
  select c.id, c.total_budget, c.daily_budget, c.pricing_model, c.cpm_rate_usd, c.cpc_rate_usd
    into v_campaign_id, v_total, v_daily, v_model_col, v_cpm_rate, v_cpc_rate
  from public.ad_creatives x
  join public.campaigns   c  on c.id  = x.campaign_id
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where x.id = p_creative_id
    and x.status = 'approved'
    and c.status = 'active'
    and c.category = p_topic
    and c.start_date <= v_today
    and (c.end_date is null or c.end_date >= v_today)
    and a.status  = 'active'
    and ap.status = 'active'
  for update of c;

  if v_campaign_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Reservation ki keemat (= wahi jo settlement par charge hogi):
  --   cpc              => campaign ka cpc_rate_usd (ek click ki keemat)
  --   cpm / NULL(purana) => ek impression ki keemat = CPM / 1000 (kam se kam 0.0001 USD). NULL model = platform CPM.
  if v_model_col = 'cpc' then
    v_model  := 'cpc';
    v_amount := v_cpc_rate;
  else
    v_model := 'cpm';
    if v_model_col = 'cpm' then
      v_cpm := v_cpm_rate;
    end if;
    if v_cpm is null then
      select s.cpm_usd into v_cpm from public.ad_platform_settings s where s.id;
    end if;
    if v_cpm is null then
      v_cpm := 2;
    end if;
    v_amount := greatest(round(v_cpm / 1000.0, 4), 0.0001);
  end if;

  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Is campaign ki expire ho chuki holds ko saaf karo (hum campaign lock ke andar hain).
  update public.ad_budget_reservations r
     set status = 'released', released_at = now()
   where r.campaign_id = v_campaign_id and r.status = 'held' and r.expires_at <= now();

  select coalesce(sum(d.spent), 0) into v_spent_total
  from public.campaign_spend_daily d where d.campaign_id = v_campaign_id;

  select coalesce(sum(d.spent), 0) into v_spent_today
  from public.campaign_spend_daily d where d.campaign_id = v_campaign_id and d.day = v_today;

  select coalesce(sum(r.amount), 0) into v_held_total
  from public.ad_budget_reservations r
  where r.campaign_id = v_campaign_id and r.status = 'held' and r.expires_at > now();

  select coalesce(sum(r.amount), 0) into v_held_today
  from public.ad_budget_reservations r
  where r.campaign_id = v_campaign_id and r.status = 'held' and r.expires_at > now() and r.reserve_day = v_today;

  -- Budget guard: kharch + chal rahi holds + ye naya hold, total aur daily limit se upar nahi.
  if v_spent_total + v_held_total + v_amount > v_total then
    return jsonb_build_object('outcome', 'rejected');
  end if;
  if v_daily is not null and v_spent_today + v_held_today + v_amount > v_daily then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- NOTE: yahan campaign_spend_daily me koi INSERT nahi hai (serve par charge nahi). Na ledger.
  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic)
  values (v_publisher_id, p_creative_id, v_campaign_id, p_topic)
  returning id, serve_ref, served_at into v_serve_id, v_serve_ref, v_served_at;

  insert into public.creative_serve_daily (creative_id, campaign_id, day, serves)
  values (p_creative_id, v_campaign_id, v_today, 1)
  on conflict (creative_id, day)
  do update set serves = public.creative_serve_daily.serves + 1;

  insert into public.ad_budget_reservations (serve_id, campaign_id, publisher_id, pricing_model, amount, reserve_day, reserved_at, expires_at)
  values (v_serve_id, v_campaign_id, v_publisher_id, v_model, v_amount, v_today, v_served_at, v_served_at + interval '24 hours');

  return jsonb_build_object('outcome', 'ok', 'serve_ref', v_serve_ref, 'served_at', v_served_at);
end;
$$;

comment on function public.record_ad_serve(text, uuid, text) is
  'Serve record: key + creative dobara verify, campaign lock, BUDGET RESERVE (spent + holds + amount <= total / daily), serve log + daily counter + reservation. PAISA NAHI KATTA: charge valid impression (CPM) / valid click (CPC) par. Execute: service_role only.';

revoke all on function public.record_ad_serve(text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_ad_serve(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- E. record_ad_impression: day-12-7 + settlement (event insert + charge + spend + ledger = EK transaction)
--    Window check ab >= (reservation ki expires_at se bilkul mel khata hai).
-- ---------------------------------------------------------------------
create or replace function public.record_ad_impression(p_serve_ref text, p_publisher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serve_id    bigint;
  v_publisher   uuid;
  v_campaign    uuid;
  v_creative    uuid;
  v_served_at   timestamptz;
  v_event_id    bigint;
  v_bill        jsonb;
begin
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' or p_publisher_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Serve DATABASE se dhoondo: publisher / campaign / creative kabhi caller se nahi liye jaate.
  select s.id, s.publisher_id, s.campaign_id, s.creative_id, s.served_at
    into v_serve_id, v_publisher, v_campaign, v_creative, v_served_at
  from public.ad_serve_log s
  where s.serve_ref = p_serve_ref;

  if v_serve_id is null or v_publisher is distinct from p_publisher_id then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Impression ki sabse badi umr: serve ke 24 ghante (reservation ki expires_at wahi hai).
  if now() >= v_served_at + interval '24 hours' then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Atomic dedupe: ek serve = ek impression. Constraint ad_events_one_per_type_key (serve_id, event_type).
  insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at)
  values (v_serve_id, v_publisher, v_campaign, v_creative, 'impression', 'blisscco_beacon', now())
  on conflict on constraint ad_events_one_per_type_key do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome', 'duplicate', 'billed', false);  -- duplicate par kabhi charge nahi
  end if;

  -- Charge isi transaction me: settlement fail ho toh event insert bhi rollback (retry safe).
  v_bill := private.settle_event_billing(v_serve_id, 'impression');

  return jsonb_build_object('outcome', 'recorded', 'billed', coalesce((v_bill ->> 'billed')::boolean, false));
end;
$$;

revoke all on function public.record_ad_impression(text, uuid) from public, anon, authenticated;
grant execute on function public.record_ad_impression(text, uuid) to service_role;

comment on function public.record_ad_impression(text, uuid) is
  'Ek serve ka PEHLA valid impression likhta hai (recorded), baaki duplicate. CPM campaign par isi transaction me charge (settlement); CPC par charge nahi. Serve / API response / page load kabhi charge nahi.';

-- ---------------------------------------------------------------------
-- F. record_ad_click: day-12-10 + settlement (CPC). Impression pehle zaroori (D4) jaisa pehle tha.
-- ---------------------------------------------------------------------
create or replace function public.record_ad_click(p_serve_ref text, p_publisher_id uuid, p_creative_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serve_id  bigint;
  v_publisher uuid;
  v_campaign  uuid;
  v_creative  uuid;
  v_served_at timestamptz;
  v_dest      text;
  v_event_id  bigint;
  v_bill      jsonb;
begin
  if p_serve_ref is null or p_serve_ref !~ '^bsr_[0-9a-f]{40}$' or p_publisher_id is null or p_creative_id is null then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Serve DATABASE se dhoondo: campaign kabhi caller se nahi liya jaata; publisher/creative sirf milan ke liye.
  select s.id, s.publisher_id, s.campaign_id, s.creative_id, s.served_at
    into v_serve_id, v_publisher, v_campaign, v_creative, v_served_at
  from public.ad_serve_log s
  where s.serve_ref = p_serve_ref;

  if v_serve_id is null or v_publisher is distinct from p_publisher_id or v_creative is distinct from p_creative_id then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Click ki sabse badi umr: serve ke 24 ghante.
  if now() >= v_served_at + interval '24 hours' then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Creative click ke layak hai? Nahi toh na click likhte hain, na destination dete hain, na charge.
  v_dest := private.click_target(v_creative);
  if v_dest is null then
    return jsonb_build_object('outcome', 'ineligible');
  end if;

  -- D4: click tabhi ginta (aur CPC par charge) hai jab is serve ka impression pehle ho chuka ho. Warna redirect hoga, click/charge nahi.
  if not exists (select 1 from public.ad_events e where e.serve_id = v_serve_id and e.event_type = 'impression') then
    return jsonb_build_object('outcome', 'not_counted', 'destination_url', v_dest, 'billed', false);
  end if;

  -- Atomic dedupe: ek serve = ek click. Constraint ad_events_one_per_type_key (serve_id, event_type).
  insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at)
  values (v_serve_id, v_publisher, v_campaign, v_creative, 'click', 'blisscco_redirect', now())
  on conflict on constraint ad_events_one_per_type_key do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome', 'duplicate', 'destination_url', v_dest, 'billed', false);
  end if;

  -- CPC: charge isi transaction me. CPM campaign par ye 'not_billable_event' deta hai (click record, charge nahi).
  v_bill := private.settle_event_billing(v_serve_id, 'click');

  return jsonb_build_object('outcome', 'recorded', 'destination_url', v_dest, 'billed', coalesce((v_bill ->> 'billed')::boolean, false));
end;
$$;

revoke all on function public.record_ad_click(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_ad_click(text, uuid, uuid) to service_role;

comment on function public.record_ad_click(text, uuid, uuid) is
  'Ek serve ka PEHLA valid click likhta hai (recorded), baaki duplicate; impression pehle na ho toh not_counted. CPC campaign par isi transaction me charge; CPM par click par charge nahi. Destination database ke creative row se.';

-- ---------------------------------------------------------------------
-- G. Expired holds ki bulk safai (optional; budget me expire hold waise bhi turant ginna band ho jaata hai)
-- ---------------------------------------------------------------------
create or replace function public.release_expired_budget_reservations(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit    integer := greatest(1, least(coalesce(p_limit, 1000), 10000));
  v_released integer;
begin
  -- skip locked: jis hold par abhi settlement chal raha ho use chhod do (wo ya settle hoga ya agli baar expire milega).
  with due as (
    select r.serve_id
    from public.ad_budget_reservations r
    where r.status = 'held' and r.expires_at <= now()
    order by r.expires_at
    limit v_limit
    for update skip locked
  ), done as (
    update public.ad_budget_reservations r
       set status = 'released', released_at = now()
      from due
     where r.serve_id = due.serve_id
    returning 1
  )
  select count(*)::integer into v_released from done;

  return jsonb_build_object('outcome', 'ok', 'released', v_released);
end;
$$;

revoke all on function public.release_expired_budget_reservations(integer) from public, anon, authenticated;
grant execute on function public.release_expired_budget_reservations(integer) to service_role;

comment on function public.release_expired_budget_reservations(integer) is
  'Expire ho chuki (24 ghante) holds ko released mark karta hai. Budget par asar nahi (expire hold pehle se nahi ginti). Execute: service_role only.';

-- ---------------------------------------------------------------------
-- H. Budget guards ab zinda holds ko bhi ginte hain (budget kamzor NAHI hota)
-- ---------------------------------------------------------------------

-- H1. total_budget ab kharch + zinda holds se neeche nahi ja sakta (warna reserved serve settle hone par budget paar karti).
create or replace function private.guard_campaign_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spent numeric;
  v_held  numeric;
begin
  -- Sirf tab dekho jab total budget badal raha ho.
  if new.total_budget is not distinct from old.total_budget then
    return new;
  end if;

  -- Campaign row par lock: record_ad_serve / settle_event_billing bhi isi row par "for update" lete hain.
  perform 1 from public.campaigns c where c.id = old.id for update;

  select coalesce(sum(d.spent), 0) into v_spent
  from public.campaign_spend_daily d
  where d.campaign_id = old.id;

  select coalesce(sum(r.amount), 0) into v_held
  from public.ad_budget_reservations r
  where r.campaign_id = old.id and r.status = 'held' and r.expires_at > now();

  if new.total_budget < v_spent + v_held then
    raise exception 'Total budget cannot be lower than the amount already spent plus pending reservations'
      using errcode = '23514', hint = 'budget_below_spend';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_budget() from public, anon, authenticated;

-- H2. Resume / approve: "ek charge jitna budget bacha hai?" ab holds ghatakar, aur campaign ki apni keemat ke hisaab se
--     (CPC campaign ke liye cpc_rate_usd, baaki ke liye CPM / 1000). Baaki sab jaisa day-9-7 me tha.
create or replace function private.campaign_can_afford_serve(p_campaign_id uuid, p_total_budget numeric default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total numeric;
  v_spent numeric;
  v_held  numeric;
  v_model text;
  v_cpm_r numeric;
  v_cpc_r numeric;
  v_cpm   numeric;
  v_unit  numeric;
begin
  if not (
    private.is_admin()
    or exists (
      select 1 from public.campaigns c
      where c.id = p_campaign_id and c.advertiser_id = (select private.my_advertiser_id())
    )
  ) then
    return false;
  end if;

  select c.total_budget, c.pricing_model, c.cpm_rate_usd, c.cpc_rate_usd
    into v_total, v_model, v_cpm_r, v_cpc_r
  from public.campaigns c where c.id = p_campaign_id;
  if v_total is null then
    return false;
  end if;
  v_total := coalesce(p_total_budget, v_total);

  select coalesce(sum(d.spent), 0) into v_spent
  from public.campaign_spend_daily d where d.campaign_id = p_campaign_id;

  select coalesce(sum(r.amount), 0) into v_held
  from public.ad_budget_reservations r
  where r.campaign_id = p_campaign_id and r.status = 'held' and r.expires_at > now();

  if v_model = 'cpc' then
    v_unit := v_cpc_r;
  else
    v_cpm := case when v_model = 'cpm' then v_cpm_r else null end;
    if v_cpm is null then
      select s.cpm_usd into v_cpm from public.ad_platform_settings s where s.id;
    end if;
    if v_cpm is null then
      v_cpm := 2;
    end if;
    v_unit := greatest(round(v_cpm / 1000.0, 4), 0.0001);
  end if;

  return v_unit is not null and (v_total - v_spent - v_held) >= v_unit;
end;
$$;

revoke all on function private.campaign_can_afford_serve(uuid, numeric) from public, anon;
grant execute on function private.campaign_can_afford_serve(uuid, numeric) to authenticated;

commit;

-- =====================================================================
-- READ-ONLY CHECKS (TEST project par migration ke baad; expected jawab comment me)
-- =====================================================================
-- Check 1 (Expect: 1 row, RLS on): reservation table
--   select relname, relrowsecurity from pg_class where oid = 'public.ad_budget_reservations'::regclass;
-- Check 2 (Expect: 0 rows): kisi app role ko table par grant nahi
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'ad_budget_reservations' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
-- Check 3 (Expect: 4 rows, sab prosecdef = true): functions
--   select proname, pronargs, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
--   and (proname in ('record_ad_impression', 'record_ad_click', 'release_expired_budget_reservations') or (proname = 'record_ad_serve' and pronargs = 3));
-- Check 4 (Expect: sirf service_role (aur postgres) ke paas EXECUTE; anon / authenticated / PUBLIC nahi)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('record_ad_serve', 'record_ad_impression', 'record_ad_click', 'release_expired_budget_reservations')
--     and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- Check 5 (Expect: 0 rows): koi settled reservation galat model/event se juda nahi, aur settled amount spend se zyada nahi
--   select campaign_id, reserve_day from public.ad_budget_reservations where status = 'settled'
--   group by campaign_id, reserve_day
--   having sum(amount) > coalesce((select d.spent from public.campaign_spend_daily d where d.campaign_id = ad_budget_reservations.campaign_id and d.day = ad_budget_reservations.reserve_day), 0);
-- Check 6 (Expect: 0 rows): koi campaign apne budget se upar (kharch + zinda holds) nahi
--   select c.id from public.campaigns c
--   where c.total_budget < coalesce((select sum(d.spent) from public.campaign_spend_daily d where d.campaign_id = c.id), 0)
--                        + coalesce((select sum(r.amount) from public.ad_budget_reservations r where r.campaign_id = c.id and r.status = 'held' and r.expires_at > now()), 0);
-- Check 7 (Expect: 0): ledger band hai
--   select count(*) from public.ledger_settings where ledger_enabled;
