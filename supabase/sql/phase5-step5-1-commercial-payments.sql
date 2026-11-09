-- Phase 5 Step 5, file 1: Commercial payment infrastructure (provider-neutral) + publisher payout hardening.
--
-- TEST PROJECT PAR PEHLE. PRODUCTION PAR APPLY MAT KARO jab tak owner likhit na kahe.
-- NOT RUN ANYWHERE: ye file Claude ne sirf likhi hai (koi Postgres is session me nahi tha). Owner TEST par chalaye, phir niche ke
-- verify checks (V1..V10) chalaye. Dobara chalane par safe hai (if not exists / create or replace / drop trigger if exists).
--
-- Pehle chali honi chahiye: day-3-1, day-3-2, day-3-3 (profiles, advertisers, campaigns), day-13-1, day-13-4, day-13-9, day-13-12, day-13-15.
--
-- KYA YE FILE KARTI HAI
--   A. advertiser_payments (+ append-only advertiser_payment_events, payment_webhook_events): USD payment ka record, status machine,
--      duplicate rok (request_key, internal_reference, provider + provider_payment_id), refund / chargeback status.
--   B. payments_apply_verified_event(): provider ka event SIRF server se (service_role), signature + provider API se status verify HONE KE BAAD.
--      Same provider event dobara aaye => 'duplicate_event', kuch nahi badalta. Amount / currency / provider id mismatch => status nahi badalta.
--   C. payment_settings / payout_settings (singleton) + payments_audit_log (append-only).
--   D. Payout hardening, MAUJOODA TABLES KO BADLE BINA: publisher_payout_settlements (unique payout reference, bank / provider reference,
--      failed / completed / reversed), BEFORE INSERT limits trigger (min / max / mahine me ek), BEFORE UPDATE gate trigger (paid = settlement + payouts_enabled).
--
-- KYA YE FILE NAHI KARTI (jaanbujhkar)
--   * Koi payment provider chuna nahi gaya. Is file me kisi provider ka naam, URL, key ya format nahi hai. provider sirf ek text label hai.
--   * Koi advertiser wallet / prepaid balance NAHI banta, campaigns.total_budget ya campaign_spend_daily ko ye file chhoo bhi nahi sakti.
--     Payment ka record alag hai; budget badalna maujooda campaign flow se hi hoga (owner ka faisla pending: prepaid wallet ya nahi).
--   * financial_ledger, ledger_settings, record_ad_serve, maujooda payout tables / functions ki koi definition nahi badli. Koi purani row nahi badli.
--   * Koi paisa nahi bhejti, koi payout apne aap shuru nahi karti.
--
-- Owner ko dikhne wala behaviour badlav (TEST par):
--   * Payout request ab minimum 20.0000 USD aur maximum 500.0000 USD aur mahine me ek (owner ka faisla, Phase 5 Step 3 section 7). Chhoti test requests ab fail hongi.
--   * "Mark as paid" ab payout_settings.payouts_enabled = true aur ek bahar ka payment reference maangta hai. Default: payouts_enabled = false.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- C. settings + audit (pehle, kyunki baaki functions inhe padhte hain)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_settings (
  id                     boolean       primary key default true,
  payments_enabled       boolean       not null default false,
  max_single_payment_usd numeric(12, 2),
  updated_at             timestamptz   not null default now(),
  constraint payment_settings_singleton_check check (id),
  constraint payment_settings_max_check check (max_single_payment_usd is null or (max_single_payment_usd > 0 and max_single_payment_usd <= 10000000))
);
insert into public.payment_settings (id) values (true) on conflict (id) do nothing;

comment on table public.payment_settings is
  'Ek hi row. payments_enabled=false (default): naya payment intent nahi banta. Maujooda payments ke provider events phir bhi record hote hain. max_single_payment_usd null = koi cap nahi (owner ne number nahi diya).';

create table if not exists public.payout_settings (
  id              boolean        primary key default true,
  payouts_enabled boolean        not null default false,
  min_payout_usd  numeric(14, 4) not null default 20,
  max_payout_usd  numeric(14, 4) not null default 500,
  once_per_month  boolean        not null default true,
  updated_at      timestamptz    not null default now(),
  constraint payout_settings_singleton_check check (id),
  constraint payout_settings_range_check check (min_payout_usd > 0 and max_payout_usd >= min_payout_usd and max_payout_usd <= 9999999999.9999)
);
insert into public.payout_settings (id) values (true) on conflict (id) do nothing;

comment on table public.payout_settings is
  'Ek hi row. Owner ka faisla (Phase 5 Step 3): min 20 USD, max 500 USD, mahine me ek. payouts_enabled=false (default): koi payout "paid" mark nahi ho sakta (pilot me payouts band).';

create table if not exists public.payments_audit_log (
  id               bigint      generated always as identity primary key,
  actor_profile_id uuid        references public.profiles (id) on delete restrict,
  action           text        not null,
  subject_type     text        not null,
  subject_id       text,
  detail           text,
  created_at       timestamptz not null default now(),
  constraint payments_audit_action_check check (action ~ '^[a-z_]{3,60}$'),
  constraint payments_audit_subject_check check (subject_type ~ '^[a-z_]{3,40}$'),
  constraint payments_audit_detail_check check (detail is null or length(detail) <= 500)
);
create index if not exists payments_audit_log_actor_idx on public.payments_audit_log (actor_profile_id) where actor_profile_id is not null;
create index if not exists payments_audit_log_created_idx on public.payments_audit_log (created_at desc);

comment on table public.payments_audit_log is
  'Append-only: payment / payout settings badlav, settlement, reversal. detail me koi secret, bank / card / UPI detail kabhi nahi.';

create or replace function private.payments_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'This table is append-only' using errcode = '23514', hint = 'payments_append_only';
end;
$$;
revoke all on function private.payments_append_only() from public, anon, authenticated, service_role;

drop trigger if exists payments_audit_log_no_change on public.payments_audit_log;
create trigger payments_audit_log_no_change before update or delete on public.payments_audit_log
  for each row execute function private.payments_append_only();
drop trigger if exists payments_audit_log_no_truncate on public.payments_audit_log;
create trigger payments_audit_log_no_truncate before truncate on public.payments_audit_log
  for each statement execute function private.payments_append_only();

-- ---------------------------------------------------------------------------
-- A. advertiser payments
-- ---------------------------------------------------------------------------
create table if not exists public.advertiser_payments (
  id                  uuid          primary key default gen_random_uuid(),
  internal_reference  text          not null,
  advertiser_id       uuid          not null references public.advertisers (id) on delete restrict,
  campaign_id         uuid          references public.campaigns (id) on delete restrict,
  provider            text          not null,
  provider_payment_id text,
  request_key         uuid          not null,
  amount              numeric(12, 2) not null,
  refunded_amount     numeric(12, 2) not null default 0,
  currency_code       text          not null default 'USD',
  status              text          not null default 'created',
  verified_at         timestamptz,
  created_by          uuid          not null references public.profiles (id) on delete restrict,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),

  constraint advertiser_payments_reference_key unique (internal_reference),
  constraint advertiser_payments_request_key_key unique (advertiser_id, request_key),
  constraint advertiser_payments_reference_check check (internal_reference ~ '^BPY-[0-9A-F]{16}$'),
  constraint advertiser_payments_provider_check check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint advertiser_payments_provider_id_check check (provider_payment_id is null or length(provider_payment_id) between 1 and 200),
  constraint advertiser_payments_amount_check check (amount > 0 and amount <= 10000000),
  constraint advertiser_payments_refund_check check (refunded_amount >= 0 and refunded_amount <= amount),
  constraint advertiser_payments_currency_check check (currency_code = 'USD'),
  constraint advertiser_payments_status_check check (status in ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded', 'disputed', 'dispute_won', 'dispute_lost')),
  -- Browser / client ke kehne se "succeeded" nahi: succeeded (aur uske baad ke har status) ke saath verified_at zaroori.
  constraint advertiser_payments_verified_check check (status in ('created', 'pending', 'failed', 'cancelled') or verified_at is not null),
  constraint advertiser_payments_refund_status_check check (
    (status = 'refunded' and refunded_amount = amount)
    or (status = 'partially_refunded' and refunded_amount > 0 and refunded_amount < amount)
    or (status in ('created', 'pending', 'failed', 'cancelled') and refunded_amount = 0)
    or status in ('succeeded', 'disputed', 'dispute_won', 'dispute_lost')
  )
);

create unique index if not exists advertiser_payments_provider_ref_key
  on public.advertiser_payments (provider, provider_payment_id) where provider_payment_id is not null;
create index if not exists advertiser_payments_advertiser_idx on public.advertiser_payments (advertiser_id, created_at desc);
create index if not exists advertiser_payments_campaign_idx on public.advertiser_payments (campaign_id) where campaign_id is not null;
create index if not exists advertiser_payments_created_by_idx on public.advertiser_payments (created_by);
create index if not exists advertiser_payments_status_idx on public.advertiser_payments (status, created_at);

comment on table public.advertiser_payments is
  'Advertiser ka USD payment record (provider-neutral). Ye wallet nahi: budget / spend ko ye table nahi chhoota. Card / bank detail yahan kabhi nahi. Status sirf payments_apply_verified_event / payments_attach_provider_payment se badalta hai.';

drop trigger if exists advertiser_payments_set_updated_at on public.advertiser_payments;
create trigger advertiser_payments_set_updated_at before update on public.advertiser_payments
  for each row execute function public.set_updated_at();

create table if not exists public.advertiser_payment_events (
  id                bigint         generated always as identity primary key,
  payment_id        uuid           not null references public.advertiser_payments (id) on delete restrict,
  from_status       text,
  to_status         text           not null,
  source            text           not null,
  provider_event_id text,
  amount_usd        numeric(12, 2),
  actor_profile_id  uuid           references public.profiles (id) on delete restrict,
  note              text,
  created_at        timestamptz    not null default now(),
  constraint advertiser_payment_events_source_check check (source in ('system', 'webhook', 'admin')),
  constraint advertiser_payment_events_first_check check ((from_status is null) = (to_status = 'created')),
  constraint advertiser_payment_events_note_check check (note is null or length(note) <= 200)
);
create index if not exists advertiser_payment_events_payment_idx on public.advertiser_payment_events (payment_id, id);
create index if not exists advertiser_payment_events_actor_idx on public.advertiser_payment_events (actor_profile_id) where actor_profile_id is not null;

comment on table public.advertiser_payment_events is 'Append-only: payment ka har status badlav (kis source se, kaunsa provider event).';

drop trigger if exists advertiser_payment_events_no_change on public.advertiser_payment_events;
create trigger advertiser_payment_events_no_change before update or delete on public.advertiser_payment_events
  for each row execute function private.payments_append_only();
drop trigger if exists advertiser_payment_events_no_truncate on public.advertiser_payment_events;
create trigger advertiser_payment_events_no_truncate before truncate on public.advertiser_payment_events
  for each statement execute function private.payments_append_only();

-- Provider ke events (idempotency ki jad). Payload / customer data NAHI rakhte: sirf id, type, payload ka sha256 aur natija.
create table if not exists public.payment_webhook_events (
  id                 bigint       generated always as identity primary key,
  provider           text         not null,
  provider_event_id  text         not null,
  event_type         text         not null,
  payload_sha256     text         not null,
  processing_outcome text         not null default 'received',
  payment_id         uuid         references public.advertiser_payments (id) on delete restrict,
  received_at        timestamptz  not null default now(),
  processed_at       timestamptz,
  constraint payment_webhook_events_key unique (provider, provider_event_id),
  constraint payment_webhook_events_provider_check check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint payment_webhook_events_event_id_check check (length(provider_event_id) between 1 and 200),
  constraint payment_webhook_events_type_check check (length(event_type) between 1 and 100),
  constraint payment_webhook_events_sha_check check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_webhook_events_outcome_check check (processing_outcome in (
    'received', 'processed', 'unknown_payment', 'provider_mismatch', 'reference_mismatch', 'currency_mismatch', 'amount_mismatch', 'ignored_invalid_transition', 'invalid_refund'
  ))
);
create index if not exists payment_webhook_events_payment_idx on public.payment_webhook_events (payment_id) where payment_id is not null;

comment on table public.payment_webhook_events is
  'Har VERIFIED provider event ek baar. Wahi (provider, provider_event_id) dobara => duplicate_event, kuch nahi badalta. Invalid signature wale events yahan nahi aate (server pehle hi 400 deta hai).';

drop trigger if exists payment_webhook_events_no_delete on public.payment_webhook_events;
create trigger payment_webhook_events_no_delete before delete on public.payment_webhook_events
  for each row execute function private.payments_append_only();
drop trigger if exists payment_webhook_events_no_truncate on public.payment_webhook_events;
create trigger payment_webhook_events_no_truncate before truncate on public.payment_webhook_events
  for each statement execute function private.payments_append_only();

-- Guard: pehchaan / paisa kabhi nahi badalta; sirf valid status transitions; refund kabhi ghatta nahi.
create or replace function private.guard_advertiser_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted' using errcode = '23514', hint = 'payment_no_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'created' or new.refunded_amount <> 0 or new.verified_at is not null then
      raise exception 'A payment must start as created' using errcode = '23514', hint = 'payment_must_start_created';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.internal_reference <> old.internal_reference
     or new.advertiser_id <> old.advertiser_id
     or new.campaign_id is distinct from old.campaign_id
     or new.provider <> old.provider
     or new.request_key <> old.request_key
     or new.amount <> old.amount
     or new.currency_code <> old.currency_code
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'Payment identity and amount cannot change' using errcode = '23514', hint = 'payment_immutable_field';
  end if;

  if old.provider_payment_id is not null and new.provider_payment_id is distinct from old.provider_payment_id then
    raise exception 'Provider payment id is set once' using errcode = '23514', hint = 'payment_provider_id_immutable';
  end if;
  if new.refunded_amount < old.refunded_amount then
    raise exception 'Refunded amount cannot decrease' using errcode = '23514', hint = 'payment_refund_decrease';
  end if;
  if old.verified_at is not null and new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set once' using errcode = '23514', hint = 'payment_verified_immutable';
  end if;

  if new.status = old.status then
    -- Sirf partially_refunded -> partially_refunded (refund badha); baaki koi "same status" update nahi.
    if not (old.status = 'partially_refunded' and new.refunded_amount > old.refunded_amount) then
      if new.provider_payment_id is not distinct from old.provider_payment_id then
        raise exception 'No-op payment update' using errcode = '23514', hint = 'payment_noop_update';
      end if;
    end if;
    return new;
  end if;

  if not (
       (old.status = 'created'            and new.status in ('pending', 'succeeded', 'failed', 'cancelled'))
    or (old.status = 'pending'            and new.status in ('succeeded', 'failed', 'cancelled'))
    or (old.status = 'succeeded'          and new.status in ('partially_refunded', 'refunded', 'disputed'))
    or (old.status = 'partially_refunded' and new.status in ('refunded', 'disputed'))
    or (old.status = 'disputed'           and new.status in ('dispute_won', 'dispute_lost'))
  ) then
    raise exception 'Invalid payment status change: % -> %', old.status, new.status using errcode = '23514', hint = 'payment_invalid_transition';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_advertiser_payment() from public, anon, authenticated, service_role;

drop trigger if exists advertiser_payments_guard on public.advertiser_payments;
create trigger advertiser_payments_guard before insert or update or delete on public.advertiser_payments
  for each row execute function private.guard_advertiser_payment();
drop trigger if exists advertiser_payments_no_truncate on public.advertiser_payments;
create trigger advertiser_payments_no_truncate before truncate on public.advertiser_payments
  for each statement execute function private.payments_append_only();

-- ---------------------------------------------------------------------------
-- B. server-only functions (service_role). Advertiser id server session se aati hai, kabhi form / browser se nahi.
-- ---------------------------------------------------------------------------

-- Naya payment intent (record). Provider ko abhi koi call nahi. Retry-safe: wahi (advertiser, request_key) => wahi payment.
create or replace function public.payments_create_intent(
  p_advertiser_id uuid,
  p_campaign_id   uuid,
  p_amount        numeric,
  p_request_key   uuid,
  p_provider      text,
  p_actor         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set   record;
  v_adv   record;
  v_ex    record;
  v_ref   text;
  v_id    uuid;
begin
  if p_advertiser_id is null or p_amount is null or p_request_key is null or p_provider is null or p_actor is null
     or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 10000000
     or p_provider !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into v_set from public.payment_settings where id;
  if not found or not v_set.payments_enabled then
    return jsonb_build_object('outcome', 'payments_disabled');
  end if;
  if v_set.max_single_payment_usd is not null and p_amount > v_set.max_single_payment_usd then
    return jsonb_build_object('outcome', 'above_maximum');
  end if;

  -- Advertiser sach me wahi hai, active hai, aur actor usi advertiser ka profile hai (kisi aur ke naam par payment nahi).
  select a.id, a.status, pr.status as profile_status into v_adv
  from public.advertisers a
  join public.profiles pr on pr.id = a.profile_id
  where a.id = p_advertiser_id and a.profile_id = p_actor
  for no key update of a;
  if not found then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_adv.status <> 'active' or v_adv.profile_status <> 'active' then
    return jsonb_build_object('outcome', 'not_eligible');
  end if;

  if p_campaign_id is not null and not exists (
    select 1 from public.campaigns c where c.id = p_campaign_id and c.advertiser_id = p_advertiser_id
  ) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select p.id, p.amount, p.internal_reference, p.status, p.campaign_id into v_ex
  from public.advertiser_payments p
  where p.advertiser_id = p_advertiser_id and p.request_key = p_request_key;
  if found then
    if v_ex.amount = p_amount and v_ex.campaign_id is not distinct from p_campaign_id then
      return jsonb_build_object('outcome', 'duplicate', 'id', v_ex.id, 'reference', v_ex.internal_reference, 'status', v_ex.status);
    end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  v_ref := 'BPY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.advertiser_payments (internal_reference, advertiser_id, campaign_id, provider, request_key, amount, created_by)
  values (v_ref, p_advertiser_id, p_campaign_id, p_provider, p_request_key, p_amount, p_actor)
  returning id into v_id;

  insert into public.advertiser_payment_events (payment_id, from_status, to_status, source, amount_usd, actor_profile_id, note)
  values (v_id, null, 'created', 'system', p_amount, p_actor, 'intent created');

  return jsonb_build_object('outcome', 'created', 'id', v_id, 'reference', v_ref, 'status', 'created', 'amount', p_amount::numeric(12, 2)::text);
end;
$$;
revoke all on function public.payments_create_intent(uuid, uuid, numeric, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.payments_create_intent(uuid, uuid, numeric, uuid, text, uuid) to service_role;

-- Provider ne checkout / order banaya: uska id EK baar jodte hain, status created -> pending.
create or replace function public.payments_attach_provider_payment(p_internal_reference text, p_provider_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
begin
  if p_internal_reference is null or p_internal_reference !~ '^BPY-[0-9A-F]{16}$'
     or p_provider_payment_id is null or length(p_provider_payment_id) not between 1 and 200 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into v_p from public.advertiser_payments where internal_reference = p_internal_reference for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_p.provider_payment_id is not null then
    if v_p.provider_payment_id = p_provider_payment_id then
      return jsonb_build_object('outcome', 'duplicate', 'status', v_p.status);
    end if;
    return jsonb_build_object('outcome', 'reference_mismatch');
  end if;
  if v_p.status <> 'created' then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_p.status);
  end if;

  begin
    update public.advertiser_payments set provider_payment_id = p_provider_payment_id, status = 'pending' where id = v_p.id;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'reference_mismatch');
  end;

  insert into public.advertiser_payment_events (payment_id, from_status, to_status, source, note)
  values (v_p.id, 'created', 'pending', 'system', 'provider payment attached');
  return jsonb_build_object('outcome', 'attached', 'status', 'pending');
end;
$$;
revoke all on function public.payments_attach_provider_payment(text, text) from public, anon, authenticated;
grant execute on function public.payments_attach_provider_payment(text, text) to service_role;

-- Verified provider event lagana. CALLER KI ZIMMEDARI (lib/payments/process-event.ts): pehle webhook signature, phir provider API se status
-- server-side dobara padhna; yahan sirf wahi aata hai jo dono se mil gaya. Ye function phir bhi amount / currency / reference / transition khud jaanchta hai.
create or replace function public.payments_apply_verified_event(
  p_provider            text,
  p_provider_event_id   text,
  p_event_type          text,
  p_internal_reference  text,
  p_provider_payment_id text,
  p_new_status          text,
  p_amount              numeric,
  p_currency            text,
  p_refunded_total      numeric,
  p_payload_sha256      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evt_id bigint;
  v_p      record;
  v_out    text;
  v_from   text;
  v_refund numeric;
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,31}$'
     or p_provider_event_id is null or length(p_provider_event_id) not between 1 and 200
     or p_event_type is null or length(p_event_type) not between 1 and 100
     or p_internal_reference is null or p_internal_reference !~ '^BPY-[0-9A-F]{16}$'
     or p_new_status is null or p_new_status not in ('pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded', 'disputed', 'dispute_won', 'dispute_lost')
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Idempotency: pehle event ki row. Wahi event dobara => koi asar nahi.
  insert into public.payment_webhook_events (provider, provider_event_id, event_type, payload_sha256)
  values (p_provider, p_provider_event_id, p_event_type, p_payload_sha256)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_evt_id;
  if v_evt_id is null then
    return jsonb_build_object('outcome', 'duplicate_event');
  end if;

  select * into v_p from public.advertiser_payments where internal_reference = p_internal_reference for update;
  if not found then
    update public.payment_webhook_events set processing_outcome = 'unknown_payment', processed_at = now() where id = v_evt_id;
    return jsonb_build_object('outcome', 'unknown_payment');
  end if;

  v_out := null;
  if v_p.provider <> p_provider then
    v_out := 'provider_mismatch';
  elsif p_currency is distinct from 'USD' then
    v_out := 'currency_mismatch';
  elsif p_provider_payment_id is not null and v_p.provider_payment_id is not null and p_provider_payment_id <> v_p.provider_payment_id then
    v_out := 'reference_mismatch';
  elsif p_new_status in ('pending', 'succeeded') and p_amount is distinct from v_p.amount then
    v_out := 'amount_mismatch';
  end if;

  v_refund := v_p.refunded_amount;
  if v_out is null and p_new_status in ('partially_refunded', 'refunded') then
    if p_new_status = 'refunded' then
      v_refund := v_p.amount;
    elsif p_refunded_total is null or p_refunded_total <= v_p.refunded_amount or p_refunded_total >= v_p.amount or p_refunded_total <> round(p_refunded_total, 2) then
      v_out := 'invalid_refund';
    else
      v_refund := p_refunded_total;
    end if;
  end if;

  if v_out is not null then
    update public.payment_webhook_events set processing_outcome = v_out, payment_id = v_p.id, processed_at = now() where id = v_evt_id;
    return jsonb_build_object('outcome', v_out, 'status', v_p.status);
  end if;

  -- Transition valid hai? (out-of-order ya purana event => status nahi badalta, sirf ignore likha jaata hai)
  v_from := v_p.status;
  if not (
       (v_from = 'created'            and p_new_status in ('pending', 'succeeded', 'failed', 'cancelled'))
    or (v_from = 'pending'            and p_new_status in ('succeeded', 'failed', 'cancelled'))
    or (v_from = 'succeeded'          and p_new_status in ('partially_refunded', 'refunded', 'disputed'))
    or (v_from = 'partially_refunded' and p_new_status in ('partially_refunded', 'refunded', 'disputed'))
    or (v_from = 'disputed'           and p_new_status in ('dispute_won', 'dispute_lost'))
  ) then
    update public.payment_webhook_events set processing_outcome = 'ignored_invalid_transition', payment_id = v_p.id, processed_at = now() where id = v_evt_id;
    return jsonb_build_object('outcome', 'ignored_invalid_transition', 'status', v_from);
  end if;

  begin
    update public.advertiser_payments
       set status = p_new_status,
           refunded_amount = v_refund,
           provider_payment_id = coalesce(v_p.provider_payment_id, p_provider_payment_id),
           verified_at = case when p_new_status = 'succeeded' and v_p.verified_at is null then now() else v_p.verified_at end
     where id = v_p.id;
  exception when unique_violation then
    update public.payment_webhook_events set processing_outcome = 'reference_mismatch', payment_id = v_p.id, processed_at = now() where id = v_evt_id;
    return jsonb_build_object('outcome', 'reference_mismatch', 'status', v_from);
  end;

  insert into public.advertiser_payment_events (payment_id, from_status, to_status, source, provider_event_id, amount_usd, note)
  values (v_p.id, v_from, p_new_status, 'webhook', p_provider_event_id,
          case when p_new_status in ('partially_refunded', 'refunded') then v_refund else v_p.amount end,
          left(p_event_type, 100));

  update public.payment_webhook_events set processing_outcome = 'processed', payment_id = v_p.id, processed_at = now() where id = v_evt_id;
  return jsonb_build_object('outcome', 'processed', 'status', p_new_status);
end;
$$;
revoke all on function public.payments_apply_verified_event(text, text, text, text, text, text, numeric, text, numeric, text) from public, anon, authenticated;
grant execute on function public.payments_apply_verified_event(text, text, text, text, text, text, numeric, text, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- Advertiser / admin ke padhne ke functions (authenticated; andar auth.uid() / is_admin ka check)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_payments(p_limit integer default 25)
returns table (
  id uuid, internal_reference text, campaign_id uuid, amount numeric, refunded_amount numeric, currency_code text, status text, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.internal_reference, p.campaign_id, p.amount, p.refunded_amount, p.currency_code, p.status, p.created_at
  from public.advertiser_payments p
  join public.advertisers a on a.id = p.advertiser_id
  where a.profile_id = (select auth.uid())
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;
revoke all on function public.get_my_payments(integer) from public, anon, service_role;
grant execute on function public.get_my_payments(integer) to authenticated;

create or replace function public.admin_list_payments(p_limit integer default 50)
returns table (
  id uuid, internal_reference text, advertiser_id uuid, company_name text, campaign_id uuid, provider text, amount numeric, refunded_amount numeric, status text, verified_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.internal_reference, p.advertiser_id, a.company_name, p.campaign_id, p.provider, p.amount, p.refunded_amount, p.status, p.verified_at, p.created_at
  from public.advertiser_payments p
  join public.advertisers a on a.id = p.advertiser_id
  where private.is_admin()
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
revoke all on function public.admin_list_payments(integer) from public, anon, service_role;
grant execute on function public.admin_list_payments(integer) to authenticated;

-- Admin settings (audit ke saath). reason 3..500.
create or replace function public.admin_set_payment_settings(p_payments_enabled boolean, p_max_single_payment_usd numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_payments_enabled is null or length(v_reason) not between 3 and 500
     or (p_max_single_payment_usd is not null and (p_max_single_payment_usd <= 0 or p_max_single_payment_usd > 10000000 or p_max_single_payment_usd <> round(p_max_single_payment_usd, 2))) then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  update public.payment_settings set payments_enabled = p_payments_enabled, max_single_payment_usd = p_max_single_payment_usd, updated_at = now() where id;
  insert into public.payments_audit_log (actor_profile_id, action, subject_type, subject_id, detail)
  values (v_uid, 'payment_settings_changed', 'payment_settings', 'singleton',
          left('enabled=' || p_payments_enabled::text || '; max=' || coalesce(p_max_single_payment_usd::text, 'none') || '; ' || v_reason, 500));
  return jsonb_build_object('outcome', 'updated');
end;
$$;
revoke all on function public.admin_set_payment_settings(boolean, numeric, text) from public, anon, service_role;
grant execute on function public.admin_set_payment_settings(boolean, numeric, text) to authenticated;

create or replace function public.admin_set_payout_settings(p_payouts_enabled boolean, p_min numeric, p_max numeric, p_once_per_month boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_payouts_enabled is null or p_once_per_month is null or p_min is null or p_max is null
     or p_min <= 0 or p_max < p_min or p_max > 9999999999.9999
     or p_min <> round(p_min, 4) or p_max <> round(p_max, 4)
     or length(v_reason) not between 3 and 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  update public.payout_settings
     set payouts_enabled = p_payouts_enabled, min_payout_usd = p_min, max_payout_usd = p_max, once_per_month = p_once_per_month, updated_at = now()
   where id;
  insert into public.payments_audit_log (actor_profile_id, action, subject_type, subject_id, detail)
  values (v_uid, 'payout_settings_changed', 'payout_settings', 'singleton',
          left('enabled=' || p_payouts_enabled::text || '; min=' || p_min::text || '; max=' || p_max::text || '; monthly=' || p_once_per_month::text || '; ' || v_reason, 500));
  return jsonb_build_object('outcome', 'updated');
end;
$$;
revoke all on function public.admin_set_payout_settings(boolean, numeric, numeric, boolean, text) from public, anon, service_role;
grant execute on function public.admin_set_payout_settings(boolean, numeric, numeric, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- D. payout hardening (maujooda publisher_payout_requests / functions NAHI badle)
-- ---------------------------------------------------------------------------
create table if not exists public.publisher_payout_settlements (
  id                    uuid         primary key default gen_random_uuid(),
  payout_request_id     uuid         not null references public.publisher_payout_requests (id) on delete restrict,
  payout_reference      text         not null,
  external_reference    text,
  status                text         not null,
  failure_reason        text,
  recorded_by           uuid         not null references public.profiles (id) on delete restrict,
  created_at            timestamptz  not null default now(),
  reversed_by           uuid         references public.profiles (id) on delete restrict,
  reversed_at           timestamptz,
  reversal_reason       text,
  ledger_adjustment_key text,

  constraint publisher_payout_settlements_reference_key unique (payout_reference),
  constraint publisher_payout_settlements_reference_check check (payout_reference ~ '^BPO-[0-9A-F]{16}$'),
  constraint publisher_payout_settlements_status_check check (status in ('failed', 'completed', 'reversed')),
  constraint publisher_payout_settlements_external_check check (external_reference is null or external_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,99}$'),
  constraint publisher_payout_settlements_completed_ref_check check (status = 'failed' or external_reference is not null),
  constraint publisher_payout_settlements_failed_reason_check check ((status = 'failed') = (failure_reason is not null) and (failure_reason is null or length(btrim(failure_reason)) between 3 and 500)),
  constraint publisher_payout_settlements_reversal_check check (
    (status = 'reversed') = (reversed_by is not null and reversed_at is not null and reversal_reason is not null and ledger_adjustment_key is not null)
    and (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 400)
  )
);

-- Ek hi bank / provider reference do baar nahi (ek transfer = ek payout). Failed rows ke paas reference hota hi nahi.
create unique index if not exists publisher_payout_settlements_external_key
  on public.publisher_payout_settlements (external_reference) where external_reference is not null;
-- Ek request ka sirf EK safal settlement (completed ya reversed). Failed kai ho sakte hain.
create unique index if not exists publisher_payout_settlements_one_success_key
  on public.publisher_payout_settlements (payout_request_id) where status in ('completed', 'reversed');
create index if not exists publisher_payout_settlements_request_idx on public.publisher_payout_settlements (payout_request_id, created_at);
create index if not exists publisher_payout_settlements_recorded_by_idx on public.publisher_payout_settlements (recorded_by);
create index if not exists publisher_payout_settlements_reversed_by_idx on public.publisher_payout_settlements (reversed_by) where reversed_by is not null;

comment on table public.publisher_payout_settlements is
  'Payout ka bahar ka (manual / provider) anjaam: failed / completed / reversed. Yahan bank / card / UPI detail kabhi nahi, sirf payout_reference (BPO-...) aur bahar ka transfer reference. Blisscco koi paisa nahi bhejta.';

create or replace function private.guard_payout_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Settlements cannot be deleted' using errcode = '23514', hint = 'settlement_no_delete';
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('failed', 'completed') then
      raise exception 'A settlement starts as failed or completed' using errcode = '23514', hint = 'settlement_bad_start';
    end if;
    return new;
  end if;
  if not (old.status = 'completed' and new.status = 'reversed') then
    raise exception 'Only completed -> reversed is allowed' using errcode = '23514', hint = 'settlement_invalid_transition';
  end if;
  if new.id <> old.id or new.payout_request_id <> old.payout_request_id or new.payout_reference <> old.payout_reference
     or new.external_reference is distinct from old.external_reference or new.recorded_by <> old.recorded_by or new.created_at <> old.created_at then
    raise exception 'Settlement identity cannot change' using errcode = '23514', hint = 'settlement_immutable_field';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payout_settlement() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_settlements_guard on public.publisher_payout_settlements;
create trigger publisher_payout_settlements_guard before insert or update or delete on public.publisher_payout_settlements
  for each row execute function private.guard_payout_settlement();
drop trigger if exists publisher_payout_settlements_no_truncate on public.publisher_payout_settlements;
create trigger publisher_payout_settlements_no_truncate before truncate on public.publisher_payout_settlements
  for each statement execute function private.payments_append_only();

-- Naye payout request par limits (min / max / mahine me ek). Sirf INSERT par: purani rows aur status badlav par asar nahi.
create or replace function private.payout_request_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
begin
  select * into v_s from public.payout_settings where id;
  if not found then
    raise exception 'Payout settings missing' using errcode = '23514', hint = 'payout_settings_missing';
  end if;
  if new.amount < v_s.min_payout_usd then
    raise exception 'Payout is below the minimum' using errcode = '23514', hint = 'payout_below_minimum';
  end if;
  if new.amount > v_s.max_payout_usd then
    raise exception 'Payout is above the maximum' using errcode = '23514', hint = 'payout_above_maximum';
  end if;
  if v_s.once_per_month and exists (
    select 1 from public.publisher_payout_requests r
    where r.publisher_id = new.publisher_id
      and r.status in ('requested', 'approved', 'paid')
      and date_trunc('month', r.created_at at time zone 'UTC') = date_trunc('month', now() at time zone 'UTC')
  ) then
    raise exception 'Only one payout per month' using errcode = '23514', hint = 'payout_monthly_limit';
  end if;
  return new;
end;
$$;
revoke all on function private.payout_request_limits() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_requests_step5_limits on public.publisher_payout_requests;
create trigger publisher_payout_requests_step5_limits before insert on public.publisher_payout_requests
  for each row execute function private.payout_request_limits();

-- "paid" ke liye: payouts_enabled + ek completed settlement (bahar ka reference) pehle se maujood. Purani admin_mark_payout_paid akeli ab paid nahi kar sakti.
create or replace function private.payout_paid_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    if not exists (select 1 from public.payout_settings s where s.id and s.payouts_enabled) then
      raise exception 'Payouts are disabled' using errcode = '23514', hint = 'payouts_disabled';
    end if;
    if not exists (select 1 from public.publisher_payout_settlements t where t.payout_request_id = new.id and t.status = 'completed') then
      raise exception 'A payout needs an external payment reference first' using errcode = '23514', hint = 'payout_requires_settlement';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.payout_paid_gate() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_requests_step5_gate on public.publisher_payout_requests;
create trigger publisher_payout_requests_step5_gate before update on public.publisher_payout_requests
  for each row execute function private.payout_paid_gate();

-- Admin: bahar paisa bhej diya => reference ke saath paid. Ek transaction: settlement + (purani) admin_mark_payout_paid ki saari jaanch.
create or replace function public.admin_complete_payout(p_request_id uuid, p_external_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ref text := btrim(coalesce(p_external_reference, ''));
  v_req record;
  v_res jsonb;
  v_pref text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_request_id is null or v_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,99}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if not exists (select 1 from public.payout_settings s where s.id and s.payouts_enabled) then
    return jsonb_build_object('outcome', 'payouts_disabled');
  end if;

  select r.* into v_req from public.publisher_payout_requests r where r.id = p_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_req.status <> 'approved' then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_req.status);
  end if;
  if exists (select 1 from public.publisher_payout_settlements t where t.external_reference = v_ref) then
    return jsonb_build_object('outcome', 'reference_in_use');
  end if;

  v_pref := 'BPO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  begin
    insert into public.publisher_payout_settlements (payout_request_id, payout_reference, external_reference, status, recorded_by)
    values (p_request_id, v_pref, v_ref, 'completed', v_uid);

    v_res := public.admin_mark_payout_paid(p_request_id);
    if v_res->>'outcome' is distinct from 'paid' then
      raise exception 'payout not paid' using errcode = 'P0001';
    end if;
  exception when raise_exception then
    -- Settlement ki row bhi wapas (subtransaction rollback). Purani function ka asli outcome (not_eligible / insufficient ...) lautta hai.
    return jsonb_build_object('outcome', coalesce(v_res->>'outcome', 'invalid_transition'));
  end;

  insert into public.payments_audit_log (actor_profile_id, action, subject_type, subject_id, detail)
  values (v_uid, 'payout_completed', 'payout_request', p_request_id::text, v_pref);
  return jsonb_build_object('outcome', 'paid', 'status', 'paid', 'payout_reference', v_pref);
end;
$$;
revoke all on function public.admin_complete_payout(uuid, text) from public, anon, service_role;
grant execute on function public.admin_complete_payout(uuid, text) to authenticated;

-- Admin: bahar transfer fail hua (audit). Request approved hi rehti hai: admin dobara try kare ya reject kare (paisa tab free).
create or replace function public.admin_record_payout_failure(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_status text;
  v_pref text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_request_id is null or length(v_reason) not between 3 and 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select r.status into v_status from public.publisher_payout_requests r where r.id = p_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_status <> 'approved' then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_status);
  end if;
  v_pref := 'BPO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.publisher_payout_settlements (payout_request_id, payout_reference, status, failure_reason, recorded_by)
  values (p_request_id, v_pref, 'failed', v_reason, v_uid);
  insert into public.payments_audit_log (actor_profile_id, action, subject_type, subject_id, detail)
  values (v_uid, 'payout_failed', 'payout_request', p_request_id::text, v_pref);
  return jsonb_build_object('outcome', 'recorded', 'payout_reference', v_pref);
end;
$$;
revoke all on function public.admin_record_payout_failure(uuid, text) from public, anon, service_role;
grant execute on function public.admin_record_payout_failure(uuid, text) to authenticated;

-- Admin: paid payout wapas aa gaya (bank ne return kiya). Settlement reversed + publisher ke ledger me barabar ka + adjustment (maujooda ledger_add_adjustment),
-- taaki paid hissa wapas available ho. Purani ledger / payout row kabhi nahi badalti.
create or replace function public.admin_reverse_payout(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_req record;
  v_set record;
  v_key text;
  v_led jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_request_id is null or length(v_reason) not between 3 and 300 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select r.* into v_req from public.publisher_payout_requests r where r.id = p_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_req.status <> 'paid' then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_req.status);
  end if;
  select t.* into v_set from public.publisher_payout_settlements t where t.payout_request_id = p_request_id and t.status = 'completed' for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_key := 'payout-reversal:' || v_set.id::text;
  v_led := public.ledger_add_adjustment(v_uid, 'publisher', v_req.amount, v_key, 'Payout reversal ' || v_set.payout_reference || ': ' || v_reason, null, v_req.publisher_id, null);
  if v_led->>'outcome' not in ('recorded', 'duplicate') then
    return jsonb_build_object('outcome', 'ledger_rejected');
  end if;

  update public.publisher_payout_settlements
     set status = 'reversed', reversed_by = v_uid, reversed_at = now(), reversal_reason = v_reason, ledger_adjustment_key = v_key
   where id = v_set.id;
  insert into public.payments_audit_log (actor_profile_id, action, subject_type, subject_id, detail)
  values (v_uid, 'payout_reversed', 'payout_request', p_request_id::text, v_set.payout_reference);
  return jsonb_build_object('outcome', 'reversed', 'payout_reference', v_set.payout_reference);
end;
$$;
revoke all on function public.admin_reverse_payout(uuid, text) from public, anon, service_role;
grant execute on function public.admin_reverse_payout(uuid, text) to authenticated;

-- Admin list (khule requests ke saath settlement ki sthiti) aur publisher ke apne references.
create or replace function public.admin_list_payout_settlements(p_limit integer default 100)
returns table (payout_request_id uuid, payout_reference text, status text, has_external_reference boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.payout_request_id, t.payout_reference, t.status, (t.external_reference is not null), t.created_at
  from public.publisher_payout_settlements t
  where private.is_admin()
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;
revoke all on function public.admin_list_payout_settlements(integer) from public, anon, service_role;
grant execute on function public.admin_list_payout_settlements(integer) to authenticated;

create or replace function public.get_my_payout_references(p_limit integer default 25)
returns table (payout_request_id uuid, payout_reference text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.payout_request_id, t.payout_reference, t.status, t.created_at
  from public.publisher_payout_settlements t
  join public.publisher_payout_requests r on r.id = t.payout_request_id
  join public.publishers p on p.id = r.publisher_id
  where p.profile_id = (select auth.uid()) and t.status in ('completed', 'reversed')
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;
revoke all on function public.get_my_payout_references(integer) from public, anon, service_role;
grant execute on function public.get_my_payout_references(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Access band (ledger jaisa): RLS on, koi policy nahi, tables se saare roles ke grant hata. Sirf functions se access.
-- ---------------------------------------------------------------------------
alter table public.payment_settings              enable row level security;
alter table public.payout_settings               enable row level security;
alter table public.payments_audit_log            enable row level security;
alter table public.advertiser_payments           enable row level security;
alter table public.advertiser_payment_events     enable row level security;
alter table public.payment_webhook_events        enable row level security;
alter table public.publisher_payout_settlements  enable row level security;

revoke all on table public.payment_settings              from public, anon, authenticated, service_role;
revoke all on table public.payout_settings               from public, anon, authenticated, service_role;
revoke all on table public.payments_audit_log            from public, anon, authenticated, service_role;
revoke all on table public.advertiser_payments           from public, anon, authenticated, service_role;
revoke all on table public.advertiser_payment_events     from public, anon, authenticated, service_role;
revoke all on table public.payment_webhook_events        from public, anon, authenticated, service_role;
revoke all on table public.publisher_payout_settlements  from public, anon, authenticated, service_role;
revoke all on sequence public.payments_audit_log_id_seq            from public, anon, authenticated, service_role;
revoke all on sequence public.advertiser_payment_events_id_seq     from public, anon, authenticated, service_role;
revoke all on sequence public.payment_webhook_events_id_seq        from public, anon, authenticated, service_role;

-- ===========================================================================
-- VERIFY CHECKS (read-only SELECT; TEST par chalao, har ek ka natija "t" hona chahiye)
-- ===========================================================================
-- V1  tables maujood:
--   select count(*) = 7 as t from information_schema.tables where table_schema = 'public' and table_name in
--     ('payment_settings','payout_settings','payments_audit_log','advertiser_payments','advertiser_payment_events','payment_webhook_events','publisher_payout_settlements');
-- V2  RLS on, koi policy nahi:
--   select count(*) = 7 and bool_and(c.relrowsecurity) as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public' and c.relname in ('payment_settings','payout_settings','payments_audit_log','advertiser_payments','advertiser_payment_events','payment_webhook_events','publisher_payout_settlements');
--   select count(*) = 0 as t from pg_policies where schemaname = 'public' and tablename in ('payment_settings','payout_settings','payments_audit_log','advertiser_payments','advertiser_payment_events','payment_webhook_events','publisher_payout_settlements');
-- V3  tables par anon / authenticated / service_role ka koi grant nahi:
--   select count(*) = 0 as t from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
--     and table_name in ('payment_settings','payout_settings','payments_audit_log','advertiser_payments','advertiser_payment_events','payment_webhook_events','publisher_payout_settlements');
-- V4  payment write functions SIRF service_role ko (authenticated / anon ko nahi):
--   select count(*) = 3 as t from information_schema.routine_privileges where routine_schema = 'public' and grantee = 'service_role'
--     and routine_name in ('payments_create_intent','payments_attach_provider_payment','payments_apply_verified_event');
--   select count(*) = 0 as t from information_schema.routine_privileges where routine_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
--     and routine_name in ('payments_create_intent','payments_attach_provider_payment','payments_apply_verified_event');
-- V5  default settings surakshit (payments band, payouts band, 20 / 500 / mahine me ek):
--   select (select not payments_enabled from public.payment_settings) and (select not payouts_enabled and min_payout_usd = 20 and max_payout_usd = 500 and once_per_month from public.payout_settings) as t;
-- V6  koi purani financial row nahi badli (sirf count dekho; ye file unhe chhoti nahi): ledger / payout rows ki ginti file se pehle aur baad same honi chahiye.
-- V7  triggers maujood:
--   select count(*) = 4 as t from pg_trigger where not tgisinternal and tgname in ('advertiser_payments_guard','publisher_payout_settlements_guard','publisher_payout_requests_step5_limits','publisher_payout_requests_step5_gate');
-- V8  koi succeeded (ya aage) payment bina verified_at ke nahi:
--   select count(*) = 0 as t from public.advertiser_payments where status not in ('created','pending','failed','cancelled') and verified_at is null;
-- V9  koi duplicate provider reference nahi:
--   select count(*) = 0 as t from (select provider, provider_payment_id from public.advertiser_payments where provider_payment_id is not null group by 1, 2 having count(*) > 1) d;
-- V10 payout reconciliation: har paid request ka ek completed (ya reversed) settlement:
--   select count(*) = 0 as t from public.publisher_payout_requests r where r.status = 'paid'
--     and r.paid_at >= (select min(created_at) from public.publisher_payout_settlements)
--     and not exists (select 1 from public.publisher_payout_settlements t where t.payout_request_id = r.id and t.status in ('completed','reversed'));
--   (puraane paid rows jo is file se pehle manually mark hue the unke paas settlement nahi: ye jaanbujhkar alag rakhe gaye, unhe badla nahi gaya.)
