-- =====================================================================
-- BLISSCCO | Day 13 | Part 1 | Migration (file day-13-1) : append-only financial ledger (sirf neev)
-- Pehle chali honi chahiye (DDL ki asli dependency): day-3-1 (profiles), day-3-2 (advertisers, publishers), day-3-3 (campaigns). private schema ye file khud banati hai.
-- day-9-5 / Day 12 is DDL ke liye zaroori NAHI (ye file unhe chhuti hi nahi; sirf future wiring unpar tikegi). Test file (day-13-3) ko ad_categories (day-5-1) bhi chahiye. Dobara chalane par safe hai (if not exists / create or replace).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- REPO AUDIT (kya pehle se hai, kya nahi):
--   * Koi ledger / transactions / earnings / payout table NAHI hai. Isliye ye migration naya table banati hai.
--   * Charge ka aadhar abhi SERVE hai (Day 12 report: "Charge ka aadhar abhi bhi serve hai"). record_ad_serve (day-12-5, 3 + 4 args) har serve par
--     campaign_spend_daily.spent me CPM/1000 (ad_platform_settings.cpm_usd, default 2.00 USD, kam se kam 0.0001) jodta hai. Impression / click par koi charge nahi.
--   * Kharch sirf DAILY TOTAL hai (campaign_spend_daily). Har serve ki apni amount kahin save nahi hoti, aur ad_serve_log 90 din baad purge hota hai.
--   * Publisher ka koi earnings / revenue-share / payout data ya percentage poore repo me NAHI hai. Isliye is migration me koi percentage / dar / amount
--     hardcode NAHI hai: publisher_earning aur platform_revenue ki amount hamesha CALLER deta hai (jab business faisla hoga).
--   * Currency: poore platform ke liye sirf USD (campaigns.currency_code CHECK = 'USD', ad_platform_settings.cpm_usd). Wahi convention yahan: currency_code column + CHECK 'USD'.
--   * Paisa numeric hota hai (campaign_spend_daily.spent numeric(12,4)); float kabhi nahi. Ledger numeric(14,4).
--
-- Is file me:
--  A. public.financial_ledger : append-only. entry_type = advertiser_charge | publisher_earning | platform_revenue | adjustment | reversal.
--     account = advertiser | publisher | platform (kiske balance par asar). Amount SIGNED, kabhi 0 nahi. Charge / earning / revenue hamesha > 0; reversal usi ka ULTA.
--  B. Idempotency: idempotency_key UNIQUE. Ek serve par ek entry_type ki sirf ek entry (source_ref par partial unique). Ek entry ka sirf ek reversal.
--  C. private.guard_ledger_entry : UPDATE / DELETE / TRUNCATE band. Insert par campaign-advertiser milan aur reversal ke rules (amount = -original, wahi parties).
--  D. private.ledger_append(...) aur private.ledger_reverse(...) : EKLAUTE writers. Duplicate => 'duplicate' (kuch nayi row nahi). Wahi key alag payload ke saath => error.
--  E. Restrictive permissions: RLS on, koi policy nahi, saare roles (service_role bhi) se grant hata. Functions par bhi kisi role ko EXECUTE nahi:
--     inhe sirf aage ke security-definer functions (jaise future me record_ad_serve) usi transaction me bulayenge.
--
-- Jo NAHI hota: record_ad_serve / spend / budget / campaign_spend_daily / creative_serve_daily / ad_serve_log me KOI badlav nahi. Koi purani row nahi badalti.
-- Koi BACKFILL nahi: purana kharch ledger me nahi daalta (har serve ki amount save nahi hai, aur purani balances ko dobara likhna mana hai).
-- Impression ko billable nahi maana: koi impression / click se ledger nahi bhara jaata. Writers sirf ginti-agnostic hain: amount + source caller deta hai.
-- Is migration ke baad ledger KHALI hai aur record_ad_serve use abhi nahi bharta (agla step: alag approval).
-- =====================================================================

begin;

create schema if not exists private;

-- ---------- A. table ----------
create table if not exists public.financial_ledger (
  id                bigint generated always as identity primary key,
  entry_id          uuid        not null default gen_random_uuid(),
  entry_type        text        not null,
  account           text        not null,
  amount            numeric(14, 4) not null,
  currency_code     text        not null default 'USD',
  advertiser_id     uuid        references public.advertisers (id) on delete restrict,
  publisher_id      uuid        references public.publishers (id)  on delete restrict,
  campaign_id       uuid        references public.campaigns (id)   on delete restrict,
  source_type       text        not null,
  source_ref        text,
  idempotency_key   text        not null,
  reverses_entry_id bigint      references public.financial_ledger (id) on delete restrict,
  reason            text,
  created_by        uuid        references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),

  constraint financial_ledger_entry_id_key unique (entry_id),
  constraint financial_ledger_idempotency_key_key unique (idempotency_key),
  constraint financial_ledger_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,200}$'),
  constraint financial_ledger_type_check check (entry_type in ('advertiser_charge', 'publisher_earning', 'platform_revenue', 'adjustment', 'reversal')),
  constraint financial_ledger_account_check check (account in ('advertiser', 'publisher', 'platform')),
  -- Project ka niyam: abhi sirf USD (campaigns.currency_code jaisa). Doosri currency aaye toh yahi CHECK badlega, kuch aur nahi.
  constraint financial_ledger_currency_check check (currency_code = 'USD'),
  constraint financial_ledger_amount_nonzero_check check (amount <> 0),
  -- Charge / earning / revenue sirf positive. (Adjustment signed; reversal trigger me original ka ulta.)
  constraint financial_ledger_amount_sign_check check (
    entry_type not in ('advertiser_charge', 'publisher_earning', 'platform_revenue') or amount > 0
  ),
  -- Har type ka apna account (adjustment / reversal kisi bhi account par ho sakte hain).
  constraint financial_ledger_type_account_check check (
    (entry_type = 'advertiser_charge' and account = 'advertiser')
    or (entry_type = 'publisher_earning' and account = 'publisher')
    or (entry_type = 'platform_revenue' and account = 'platform')
    or entry_type in ('adjustment', 'reversal')
  ),
  -- Account ke hisaab se party zaroori.
  constraint financial_ledger_party_check check (
    (account <> 'advertiser' or advertiser_id is not null)
    and (account <> 'publisher' or publisher_id is not null)
  ),
  constraint financial_ledger_charge_campaign_check check (entry_type <> 'advertiser_charge' or campaign_id is not null),
  -- Source: serve se bani entry ek opaque serve reference rakhti hai (FK nahi: serve log 90 din me purge hota hai, ledger kabhi nahi).
  constraint financial_ledger_source_type_check check (source_type in ('serve', 'manual')),
  constraint financial_ledger_source_ref_check check (
    (source_type = 'serve' and source_ref ~ '^bsr_[0-9a-f]{40}$')
    or (source_type = 'manual' and source_ref is null)
  ),
  -- Adjustment / reversal hamesha insaan ke naam par aur wajah ke saath, aur manual source se.
  constraint financial_ledger_manual_entry_check check (
    entry_type not in ('adjustment', 'reversal')
    or (source_type = 'manual' and created_by is not null and reason is not null and length(btrim(reason)) between 3 and 500)
  ),
  constraint financial_ledger_reverses_check check ((entry_type = 'reversal') = (reverses_entry_id is not null)),
  constraint financial_ledger_reason_length_check check (reason is null or length(reason) <= 500)
);

comment on table public.financial_ledger is
  'Append-only paisa ka khata. Signed amount, USD. Koi UPDATE / DELETE nahi: galti ka ilaaj reversal ya adjustment (nayi row). Sirf security-definer code likhta hai. Chatbot prompt / IP / user id KABHI nahi.';
comment on column public.financial_ledger.account is
  'Kiske balance par asar: advertiser (kharch) | publisher (kamai) | platform (revenue). Balance = sum(amount) per account/party/currency.';
comment on column public.financial_ledger.amount is
  'Signed, kabhi 0 nahi. charge / earning / platform_revenue hamesha > 0. reversal = original ka ulta. adjustment = +/-.';
comment on column public.financial_ledger.source_ref is
  'source_type=serve: us serve ka opaque reference (bsr_ + 40 hex). Foreign key nahi, kyunki serve log purge hota hai aur ledger kabhi nahi.';
comment on column public.financial_ledger.idempotency_key is
  'Wahi key dobara = duplicate (nayi row nahi). Format caller tay karta hai, jaise serve:<reference>:advertiser_charge.';

-- ---------- B. dedupe + lookup indexes ----------
-- Ek serve par har entry_type ki sirf ek entry (alag idempotency key se bhi duplicate nahi banti).
create unique index if not exists financial_ledger_one_per_serve_type_key
  on public.financial_ledger (source_ref, entry_type)
  where source_type = 'serve';
-- Ek entry ka sirf ek (poora) reversal.
create unique index if not exists financial_ledger_one_reversal_key
  on public.financial_ledger (reverses_entry_id)
  where reverses_entry_id is not null;

create index if not exists financial_ledger_campaign_idx   on public.financial_ledger (campaign_id, created_at) where campaign_id is not null;
create index if not exists financial_ledger_advertiser_idx on public.financial_ledger (advertiser_id, created_at) where advertiser_id is not null;
create index if not exists financial_ledger_publisher_idx  on public.financial_ledger (publisher_id, created_at) where publisher_id is not null;
create index if not exists financial_ledger_account_idx    on public.financial_ledger (account, entry_type, created_at);
create index if not exists financial_ledger_created_by_idx on public.financial_ledger (created_by) where created_by is not null;

-- ---------- C. guard: append-only + insert rules ----------
create or replace function private.guard_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  o       record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'financial_ledger is append-only' using errcode = '23514', hint = 'ledger_append_only';
  end if;

  -- Campaign aur advertiser dono diye hon toh campaign usi advertiser ka ho.
  if new.campaign_id is not null and new.advertiser_id is not null then
    select c.advertiser_id into v_owner from public.campaigns c where c.id = new.campaign_id;
    if v_owner is distinct from new.advertiser_id then
      raise exception 'Campaign does not belong to this advertiser' using errcode = '23514', hint = 'ledger_campaign_advertiser_mismatch';
    end if;
  end if;

  if new.entry_type = 'reversal' then
    select l.* into o from public.financial_ledger l where l.id = new.reverses_entry_id;
    if not found then
      raise exception 'Reversal target not found' using errcode = '23503', hint = 'ledger_reversal_target_missing';
    end if;
    if o.entry_type = 'reversal' then
      raise exception 'A reversal cannot be reversed' using errcode = '23514', hint = 'ledger_reversal_of_reversal';
    end if;
    if new.amount <> -o.amount
       or new.account <> o.account
       or new.currency_code <> o.currency_code
       or new.advertiser_id is distinct from o.advertiser_id
       or new.publisher_id  is distinct from o.publisher_id
       or new.campaign_id   is distinct from o.campaign_id then
      raise exception 'Reversal must exactly negate the original entry' using errcode = '23514', hint = 'ledger_reversal_mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_ledger_entry() from public, anon, authenticated, service_role;

drop trigger if exists financial_ledger_guard on public.financial_ledger;
create trigger financial_ledger_guard
  before insert or update or delete on public.financial_ledger
  for each row execute function private.guard_ledger_entry();

create or replace function private.guard_ledger_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'financial_ledger is append-only' using errcode = '23514', hint = 'ledger_append_only';
end;
$$;

revoke all on function private.guard_ledger_truncate() from public, anon, authenticated, service_role;

drop trigger if exists financial_ledger_no_truncate on public.financial_ledger;
create trigger financial_ledger_no_truncate
  before truncate on public.financial_ledger
  for each statement execute function private.guard_ledger_truncate();

-- ---------- D. eklaute writers (sirf andar se, kisi role ko EXECUTE nahi) ----------
-- Return: {outcome: 'recorded'|'duplicate', id, entry_id}. Duplicate = wahi key (ya wahi serve + type) aur BILKUL wahi payload: kuch nayi row nahi.
-- Wahi key / serve+type par ALAG payload => exception (chup-chaap galat amount nahi nigalte).
create or replace function private.ledger_append(
  p_entry_type      text,
  p_account         text,
  p_amount          numeric,
  p_idempotency_key text,
  p_source_type     text,
  p_source_ref      text default null,
  p_advertiser_id   uuid default null,
  p_publisher_id    uuid default null,
  p_campaign_id     uuid default null,
  p_reason          text default null,
  p_created_by      uuid default null,
  p_currency_code   text default 'USD'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    bigint;
  v_eid   uuid;
  e       record;
begin
  if p_entry_type = 'reversal' then
    raise exception 'Use private.ledger_reverse for reversals' using errcode = '22023', hint = 'ledger_use_reverse';
  end if;

  insert into public.financial_ledger
    (entry_type, account, amount, currency_code, advertiser_id, publisher_id, campaign_id, source_type, source_ref, idempotency_key, reason, created_by)
  values
    (p_entry_type, p_account, p_amount, p_currency_code, p_advertiser_id, p_publisher_id, p_campaign_id, p_source_type, p_source_ref, p_idempotency_key, p_reason, p_created_by)
  on conflict do nothing
  returning id, entry_id into v_id, v_eid;

  if v_id is not null then
    return jsonb_build_object('outcome', 'recorded', 'id', v_id, 'entry_id', v_eid);
  end if;

  -- Conflict: pehle wahi key, nahi toh wahi serve + type.
  select l.* into e from public.financial_ledger l where l.idempotency_key = p_idempotency_key;
  if not found and p_source_type = 'serve' then
    select l.* into e from public.financial_ledger l where l.source_type = 'serve' and l.source_ref = p_source_ref and l.entry_type = p_entry_type;
  end if;

  if not found
     or e.idempotency_key <> p_idempotency_key
     or e.entry_type <> p_entry_type
     or e.account <> p_account
     or e.amount <> p_amount
     or e.currency_code <> p_currency_code
     or e.source_type <> p_source_type
     or e.source_ref is distinct from p_source_ref
     or e.advertiser_id is distinct from p_advertiser_id
     or e.publisher_id is distinct from p_publisher_id
     or e.campaign_id is distinct from p_campaign_id then
    raise exception 'Ledger idempotency conflict: same key or serve with a different entry' using errcode = '23505', hint = 'ledger_idempotency_conflict';
  end if;

  return jsonb_build_object('outcome', 'duplicate', 'id', e.id, 'entry_id', e.entry_id);
end;
$$;

revoke all on function private.ledger_append(text, text, numeric, text, text, text, uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;

comment on function private.ledger_append(text, text, numeric, text, text, text, uuid, uuid, uuid, text, uuid, text) is
  'Ledger me EK entry likhta hai (idempotent). Koi percentage / dar nahi: amount caller deta hai. Kisi role ko EXECUTE nahi; sirf andar ke security-definer functions bulayen.';

create or replace function private.ledger_reverse(
  p_entry_id        bigint,
  p_idempotency_key text,
  p_reason          text,
  p_created_by      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       record;
  v_id    bigint;
  v_eid   uuid;
  e       record;
begin
  select l.* into o from public.financial_ledger l where l.id = p_entry_id;
  if not found then
    raise exception 'Reversal target not found' using errcode = '23503', hint = 'ledger_reversal_target_missing';
  end if;

  insert into public.financial_ledger
    (entry_type, account, amount, currency_code, advertiser_id, publisher_id, campaign_id, source_type, source_ref, idempotency_key, reverses_entry_id, reason, created_by)
  values
    ('reversal', o.account, -o.amount, o.currency_code, o.advertiser_id, o.publisher_id, o.campaign_id, 'manual', null, p_idempotency_key, o.id, p_reason, p_created_by)
  on conflict do nothing
  returning id, entry_id into v_id, v_eid;

  if v_id is not null then
    return jsonb_build_object('outcome', 'recorded', 'id', v_id, 'entry_id', v_eid);
  end if;

  -- Conflict: wahi key ya is entry ka reversal pehle ho chuka. Wahi cheez dobara => duplicate, warna error.
  select l.* into e from public.financial_ledger l where l.reverses_entry_id = o.id;
  if not found or e.idempotency_key <> p_idempotency_key then
    raise exception 'Ledger idempotency conflict: entry already reversed or key reused' using errcode = '23505', hint = 'ledger_idempotency_conflict';
  end if;

  return jsonb_build_object('outcome', 'duplicate', 'id', e.id, 'entry_id', e.entry_id);
end;
$$;

revoke all on function private.ledger_reverse(bigint, text, text, uuid) from public, anon, authenticated, service_role;

comment on function private.ledger_reverse(bigint, text, text, uuid) is
  'Kisi entry ka poora ulta (reversal) likhta hai. Original kabhi nahi badalta. Ek entry ka ek hi reversal.';

-- ---------- E. access band (project ka tareeka: RLS on, koi policy nahi, saare roles se grant hata) ----------
alter table public.financial_ledger enable row level security;

revoke all on table public.financial_ledger from public, anon, authenticated, service_role;
revoke all on sequence public.financial_ledger_id_seq from public, anon, authenticated, service_role;

commit;

-- Verify: day-13-2-ledger-verify.sql (read-only). Rollback-only behaviour tests: day-13-3-ledger-tests.sql (sirf TEST project).
