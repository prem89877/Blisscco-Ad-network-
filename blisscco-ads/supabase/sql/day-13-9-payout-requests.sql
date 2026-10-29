-- =====================================================================
-- BLISSCCO | Day 13 | Part 4 | Migration (file day-13-9) : MANUAL publisher payout-request workflow
-- Pehle chali honi chahiye: day-13-1 (financial_ledger), day-3-1 (profiles, set_updated_at, private.is_admin via day-3-5), day-3-2 (publishers).
-- Dobara chalane par safe hai (if not exists / create or replace / drop trigger if exists).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- REPO AUDIT (kya pehle se hai, kya nahi):
--   * Payout table / payout status / minimum-payout rule poore repo me NAHI hai (grep: sirf "no payouts" ke comments). Isliye ye migration naya table banati hai
--     aur KOI minimum amount invent nahi karti: sirf amount > 0 aur available balance ke andar.
--   * Status ki convention: text + CHECK (campaigns / creatives jaisa), lowercase snake. Yahan: requested | approved | rejected | paid.
--   * Admin convention: security-definer function + private.is_admin() (day-3-5), user ke apne session (authenticated) se bulaya jata hai, service-role key nahi.
--   * financial_ledger me payout entry-type NAHI hai aur use badalna ledger ke CHECK / guard badalna hota. Is migration me financial_ledger ko KUCH nahi chhua jata.
--
-- BALANCE KA HISAB (ek hi jagah: private.publisher_payout_position):
--   ledger_balance = publisher account ki SAARI USD ledger entries ka jod (earnings + adjustments + reversals, jaisa day-13-7 me)
--   reserved       = requested + approved payout requests ka jod (abhi tak chuke nahi, par balance me se rok diye gaye)
--   paid           = paid payout requests ka jod
--   available      = ledger_balance - reserved - paid          (rejected request ka paisa wapas available ho jata hai)
--   Ledger balance GROSS hi rehta hai (payout se ghatta nahi); payout alag table me track hota hai.
--
-- Is file me:
--  A. public.publisher_payout_requests : status text + CHECK, amount numeric(14,4) > 0, USD, request_key (retry-safe), reviewer / paid-by columns.
--       KOI bank / card / UPI / account number / payment-provider column nahi. Admin reject ki wajah (free text) hai, paid par koi free text nahi.
--  B. public.publisher_payout_events : append-only audit (kaun, kab, kis status se kis status par, wajah).
--  C. Ek publisher ka sirf EK khula (requested / approved) request: partial unique index. (publisher_id, request_key) unique: wahi retry dobara nahi banta.
--  D. Guard trigger: sirf valid transitions (requested -> approved | rejected, approved -> paid | rejected). paid / rejected aakhri. amount / publisher / key kabhi nahi badalte.
--       DELETE / TRUNCATE band. Ye DATABASE me hai, UI ke button par bharosa nahi.
--  E. Audit trigger (AFTER INSERT / UPDATE): har status badlav ek events row banata hai, usi transaction me. Function ya UI isse bypass nahi kar sakte.
--  F. private.publisher_payout_position : upar ka hisab.
--  G. public.request_my_payout(amount, request_key) : publisher apne hi balance par request kare. publisher id parameter me NAHI aati (auth.uid() se).
--       publishers row par FOR NO KEY UPDATE lock => ek publisher ke payout kaam ek-ek karke: do request ek hi balance dobara reserve nahi kar sakte.
--  H. public.admin_review_payout_request(id, 'approve' | 'reject', reason) aur public.admin_mark_payout_paid(id): SIRF active admin (private.is_admin()), warna 42501.
--       'paid' ka matlab sirf admin ne MANUALLY (apne bank / UPI se) paisa bhej diya aur yahan record kiya. Is migration me paisa bhejne ka koi code / provider nahi.
--  I. public.get_my_payout_summary / get_my_payout_requests (publisher, apne), public.admin_list_payout_requests (sirf admin).
--  J. RLS on, koi policy nahi, tables se saare roles ke grant hata (ledger jaisa). Functions: authenticated ko EXECUTE (anon / service_role ko nahi); andar ka check hi asli rok hai.
--
-- Jo NAHI badalta: financial_ledger, ledger_settings, record_ad_serve, spend / budget, RLS / grants ki koi purani cheez, koi purani row.
-- =====================================================================

begin;

create schema if not exists private;

-- ---------- A. requests ----------
create table if not exists public.publisher_payout_requests (
  id               uuid           primary key default gen_random_uuid(),
  publisher_id     uuid           not null references public.publishers (id) on delete restrict,
  amount           numeric(14, 4) not null,
  currency_code    text           not null default 'USD',
  status           text           not null default 'requested',
  request_key      uuid           not null,
  requested_by     uuid           not null references public.profiles (id) on delete restrict,
  reviewed_by      uuid           references public.profiles (id) on delete restrict,
  reviewed_at      timestamptz,
  rejection_reason text,
  paid_by          uuid           references public.profiles (id) on delete restrict,
  paid_at          timestamptz,
  created_at       timestamptz    not null default now(),
  updated_at       timestamptz    not null default now(),

  constraint publisher_payout_requests_key_key unique (publisher_id, request_key),
  constraint publisher_payout_amount_check check (amount > 0),
  -- Project ka niyam: abhi sirf USD (financial_ledger jaisa).
  constraint publisher_payout_currency_check check (currency_code = 'USD'),
  constraint publisher_payout_status_check check (status in ('requested', 'approved', 'rejected', 'paid')),
  constraint publisher_payout_review_pair_check check ((reviewed_by is null) = (reviewed_at is null)),
  constraint publisher_payout_reviewed_check check (status = 'requested' or reviewed_by is not null),
  constraint publisher_payout_requested_clean_check check (status <> 'requested' or (reviewed_by is null and paid_by is null and rejection_reason is null)),
  constraint publisher_payout_paid_pair_check check ((paid_by is null) = (paid_at is null)),
  constraint publisher_payout_paid_status_check check ((status = 'paid') = (paid_by is not null)),
  constraint publisher_payout_reason_check check (
    ((status = 'rejected') = (rejection_reason is not null))
    and (rejection_reason is null or length(btrim(rejection_reason)) between 3 and 500)
  )
);

comment on table public.publisher_payout_requests is
  'Manual publisher payout requests. Status: requested -> approved -> paid (ya rejected). Koi paisa yahan se NAHI bhejta: paid = admin ne bahar se manually bhej diya aur record kiya. Bank / card / UPI / account details KABHI nahi.';
comment on column public.publisher_payout_requests.request_key is
  'Client ka random uuid: wahi request dobara bheja toh nayi row nahi banti (retry-safe).';
comment on column public.publisher_payout_requests.rejection_reason is
  'Admin ki likhi wajah (3..500 chars). Publisher ko dikhti hai.';

-- Ek publisher ka sirf EK khula request (requested / approved). Rejected / paid ke baad naya ban sakta hai.
create unique index if not exists publisher_payout_one_open_key
  on public.publisher_payout_requests (publisher_id)
  where status in ('requested', 'approved');

create index if not exists publisher_payout_publisher_idx    on public.publisher_payout_requests (publisher_id, created_at desc);
create index if not exists publisher_payout_status_idx       on public.publisher_payout_requests (status, created_at);
create index if not exists publisher_payout_requested_by_idx on public.publisher_payout_requests (requested_by);
create index if not exists publisher_payout_reviewed_by_idx  on public.publisher_payout_requests (reviewed_by) where reviewed_by is not null;
create index if not exists publisher_payout_paid_by_idx      on public.publisher_payout_requests (paid_by) where paid_by is not null;

drop trigger if exists publisher_payout_requests_set_updated_at on public.publisher_payout_requests;
create trigger publisher_payout_requests_set_updated_at
  before update on public.publisher_payout_requests
  for each row execute function public.set_updated_at();

-- ---------- B. audit events (append-only) ----------
create table if not exists public.publisher_payout_events (
  id                bigint      generated always as identity primary key,
  payout_request_id uuid        not null references public.publisher_payout_requests (id) on delete restrict,
  from_status       text,
  to_status         text        not null,
  actor_profile_id  uuid        not null references public.profiles (id) on delete restrict,
  actor_role        text        not null,
  reason            text,
  created_at        timestamptz not null default now(),

  constraint publisher_payout_events_to_check check (to_status in ('requested', 'approved', 'rejected', 'paid')),
  constraint publisher_payout_events_from_check check (from_status is null or from_status in ('requested', 'approved', 'rejected', 'paid')),
  constraint publisher_payout_events_first_check check ((from_status is null) = (to_status = 'requested')),
  constraint publisher_payout_events_role_check check (actor_role in ('publisher', 'admin')),
  constraint publisher_payout_events_reason_check check (reason is null or length(reason) <= 500)
);

comment on table public.publisher_payout_events is
  'Append-only audit: payout request ka har status badlav (kisne, kab, kahan se kahan, wajah). Sirf audit trigger likhta hai. UPDATE / DELETE / TRUNCATE band.';

create index if not exists publisher_payout_events_request_idx on public.publisher_payout_events (payout_request_id, id);
create index if not exists publisher_payout_events_actor_idx   on public.publisher_payout_events (actor_profile_id);

-- ---------- D. guards ----------
create or replace function private.guard_payout_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payout requests cannot be deleted' using errcode = '23514', hint = 'payout_no_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'A payout request must start as requested' using errcode = '23514', hint = 'payout_must_start_requested';
    end if;
    return new;
  end if;

  -- UPDATE: pehchaan aur paisa kabhi nahi badalte.
  if new.id <> old.id
     or new.publisher_id <> old.publisher_id
     or new.amount <> old.amount
     or new.currency_code <> old.currency_code
     or new.request_key <> old.request_key
     or new.requested_by <> old.requested_by
     or new.created_at <> old.created_at then
    raise exception 'Payout request identity and amount cannot change' using errcode = '23514', hint = 'payout_immutable_field';
  end if;

  -- Sirf valid transitions. Status badle bina koi update nahi (reason / reviewer chupke se nahi badal sakte).
  if not (
       (old.status = 'requested' and new.status in ('approved', 'rejected'))
    or (old.status = 'approved'  and new.status in ('paid', 'rejected'))
  ) then
    raise exception 'Invalid payout status change: % -> %', old.status, new.status using errcode = '23514', hint = 'payout_invalid_transition';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_payout_request() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_requests_guard on public.publisher_payout_requests;
create trigger publisher_payout_requests_guard
  before insert or update or delete on public.publisher_payout_requests
  for each row execute function private.guard_payout_request();

create or replace function private.guard_payout_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'publisher_payout_events is append-only' using errcode = '23514', hint = 'payout_events_append_only';
end;
$$;

revoke all on function private.guard_payout_event() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_events_guard on public.publisher_payout_events;
create trigger publisher_payout_events_guard
  before update or delete on public.publisher_payout_events
  for each row execute function private.guard_payout_event();

drop trigger if exists publisher_payout_events_no_truncate on public.publisher_payout_events;
create trigger publisher_payout_events_no_truncate
  before truncate on public.publisher_payout_events
  for each statement execute function private.guard_payout_event();

create or replace function private.guard_payout_request_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Payout requests cannot be truncated' using errcode = '23514', hint = 'payout_no_delete';
end;
$$;

revoke all on function private.guard_payout_request_truncate() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_requests_no_truncate on public.publisher_payout_requests;
create trigger publisher_payout_requests_no_truncate
  before truncate on public.publisher_payout_requests
  for each statement execute function private.guard_payout_request_truncate();

-- ---------- E. audit trigger (har status badlav = ek events row, usi transaction me) ----------
-- Actor row ke apne columns se aata hai (requested_by / reviewed_by / paid_by): function ya console se badlav ho, audit chhoot nahi sakta.
create or replace function private.audit_payout_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.publisher_payout_events (payout_request_id, from_status, to_status, actor_profile_id, actor_role, reason)
    values (new.id, null, new.status, new.requested_by, 'publisher', null);
  elsif new.status is distinct from old.status then
    insert into public.publisher_payout_events (payout_request_id, from_status, to_status, actor_profile_id, actor_role, reason)
    values (
      new.id,
      old.status,
      new.status,
      case when new.status = 'paid' then new.paid_by else new.reviewed_by end,
      'admin',
      case when new.status = 'rejected' then new.rejection_reason else null end
    );
  end if;
  return null;
end;
$$;

revoke all on function private.audit_payout_request() from public, anon, authenticated, service_role;

drop trigger if exists publisher_payout_requests_audit on public.publisher_payout_requests;
create trigger publisher_payout_requests_audit
  after insert or update on public.publisher_payout_requests
  for each row execute function private.audit_payout_request();

-- ---------- F. balance ka ek hisab ----------
create or replace function private.publisher_payout_position(p_publisher_id uuid)
returns table (ledger_balance numeric, reserved numeric, paid numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(l.amount) from public.financial_ledger l
               where l.publisher_id = p_publisher_id and l.account = 'publisher' and l.currency_code = 'USD'), 0),
    coalesce((select sum(r.amount) from public.publisher_payout_requests r
               where r.publisher_id = p_publisher_id and r.status in ('requested', 'approved')), 0),
    coalesce((select sum(r.amount) from public.publisher_payout_requests r
               where r.publisher_id = p_publisher_id and r.status = 'paid'), 0)
$$;

revoke all on function private.publisher_payout_position(uuid) from public, anon, authenticated, service_role;

-- ---------- G. publisher: apna payout request ----------
-- Return jsonb: {outcome: requested | duplicate | forbidden | not_eligible | invalid | conflict | open_request_exists | insufficient, ...}
-- Publisher id parameter me nahi aati: logged-in user (auth.uid()) ka apna publisher hi use hota hai.
create or replace function public.request_my_payout(p_amount numeric, p_request_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_pub     uuid;
  v_pub_st  text;
  v_prof_st text;
  v_ex      record;
  v_pos     record;
  v_avail   numeric;
  v_id      uuid;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  -- Apna publisher + row lock. NO KEY UPDATE: do payout kaam ek-ek karke chalte hain (isi se ek balance do baar reserve nahi hota),
  -- par ledger likhne wale (publisher_id FK ka KEY SHARE) rukte nahi.
  select p.id, p.status, pr.status
    into v_pub, v_pub_st, v_prof_st
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  where p.profile_id = v_uid
  for no key update of p;

  if not found then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if v_prof_st <> 'active' or v_pub_st <> 'active' then
    return jsonb_build_object('outcome', 'not_eligible');
  end if;

  -- Amount exact: > 0, 4 decimal tak, numeric(14,4) se badi nahi. Chupchap round kabhi nahi.
  if p_amount is null or p_request_key is null
     or p_amount <= 0
     or p_amount <> round(p_amount, 4)
     or p_amount > 9999999999.9999 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Wahi retry (wahi key): nayi row nahi. Wahi key + alag amount = conflict.
  select r.id, r.amount, r.status into v_ex
  from public.publisher_payout_requests r
  where r.publisher_id = v_pub and r.request_key = p_request_key;
  if found then
    if v_ex.amount = p_amount then
      return jsonb_build_object('outcome', 'duplicate', 'id', v_ex.id, 'status', v_ex.status, 'amount', v_ex.amount::text);
    end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;

  if exists (select 1 from public.publisher_payout_requests r where r.publisher_id = v_pub and r.status in ('requested', 'approved')) then
    return jsonb_build_object('outcome', 'open_request_exists');
  end if;

  select * into v_pos from private.publisher_payout_position(v_pub);
  v_avail := v_pos.ledger_balance - v_pos.reserved - v_pos.paid;
  if p_amount > v_avail then
    return jsonb_build_object('outcome', 'insufficient', 'available', greatest(v_avail, 0)::numeric(20, 4)::text);
  end if;

  begin
    insert into public.publisher_payout_requests (publisher_id, amount, request_key, requested_by)
    values (v_pub, p_amount, p_request_key, v_uid)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'open_request_exists');
  end;

  return jsonb_build_object('outcome', 'requested', 'id', v_id, 'status', 'requested', 'amount', p_amount::numeric(14, 4)::text);
end;
$$;

revoke all on function public.request_my_payout(numeric, uuid) from public, anon, service_role;
grant execute on function public.request_my_payout(numeric, uuid) to authenticated;

comment on function public.request_my_payout(numeric, uuid) is
  'Publisher apne hi available balance par payout request kare. Publisher id auth.uid() se. Lock + partial unique index: ek balance do baar reserve nahi hota. Koi paisa nahi bhejta.';

-- ---------- H. admin: approve / reject / paid (sirf active admin) ----------
-- Lock ka order hamesha: publishers row -> payout row (request_my_payout ke saath deadlock nahi).
create or replace function public.admin_review_payout_request(p_request_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_pub     uuid;
  v_pub_st  text;
  v_prof_st text;
  v_r       record;
  v_pos     record;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approve', 'reject') then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if p_decision = 'reject' and length(v_reason) not between 3 and 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select r.publisher_id into v_pub from public.publisher_payout_requests r where r.id = p_request_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select p.status, pr.status into v_pub_st, v_prof_st
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  where p.id = v_pub
  for no key update of p;

  select r.* into v_r from public.publisher_payout_requests r where r.id = p_request_id for update;

  if p_decision = 'approve' and v_r.status <> 'requested' then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_r.status);
  end if;
  if p_decision = 'reject' and v_r.status not in ('requested', 'approved') then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_r.status);
  end if;

  if p_decision = 'reject' then
    update public.publisher_payout_requests
       set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), rejection_reason = v_reason
     where id = v_r.id;
    return jsonb_build_object('outcome', 'rejected', 'id', v_r.id, 'status', 'rejected');
  end if;

  -- Approve: publisher abhi bhi active ho aur ledger abhi bhi request ko cover kare (request ke baad reversal / negative adjustment aa sakta hai).
  if v_prof_st <> 'active' or v_pub_st <> 'active' then
    return jsonb_build_object('outcome', 'not_eligible');
  end if;
  select * into v_pos from private.publisher_payout_position(v_pub);
  if v_pos.ledger_balance < v_pos.reserved + v_pos.paid then
    return jsonb_build_object('outcome', 'insufficient');
  end if;

  update public.publisher_payout_requests
     set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
   where id = v_r.id;
  return jsonb_build_object('outcome', 'approved', 'id', v_r.id, 'status', 'approved');
end;
$$;

revoke all on function public.admin_review_payout_request(uuid, text, text) from public, anon, service_role;
grant execute on function public.admin_review_payout_request(uuid, text, text) to authenticated;

comment on function public.admin_review_payout_request(uuid, text, text) is
  'Admin only (private.is_admin, warna 42501): requested -> approved | rejected, approved -> rejected. Reject par wajah (3..500) zaroori. Koi paisa nahi bhejta.';

create or replace function public.admin_mark_payout_paid(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_pub     uuid;
  v_pub_st  text;
  v_prof_st text;
  v_r       record;
  v_pos     record;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_request_id is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select r.publisher_id into v_pub from public.publisher_payout_requests r where r.id = p_request_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select p.status, pr.status into v_pub_st, v_prof_st
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  where p.id = v_pub
  for no key update of p;

  select r.* into v_r from public.publisher_payout_requests r where r.id = p_request_id for update;

  if v_r.status <> 'approved' then
    return jsonb_build_object('outcome', 'invalid_transition', 'status', v_r.status);
  end if;
  if v_prof_st <> 'active' or v_pub_st <> 'active' then
    return jsonb_build_object('outcome', 'not_eligible');
  end if;
  select * into v_pos from private.publisher_payout_position(v_pub);
  if v_pos.ledger_balance < v_pos.reserved + v_pos.paid then
    return jsonb_build_object('outcome', 'insufficient');
  end if;

  update public.publisher_payout_requests
     set status = 'paid', paid_by = v_uid, paid_at = now()
   where id = v_r.id;
  return jsonb_build_object('outcome', 'paid', 'id', v_r.id, 'status', 'paid');
end;
$$;

revoke all on function public.admin_mark_payout_paid(uuid) from public, anon, service_role;
grant execute on function public.admin_mark_payout_paid(uuid) to authenticated;

comment on function public.admin_mark_payout_paid(uuid) is
  'Admin only (42501 warna): approved -> paid. Ye sirf RECORD hai ki admin ne paisa bahar se manually bhej diya. Koi transfer / provider call / ledger entry nahi.';

-- ---------- I. padhne ke functions ----------
create or replace function public.get_my_payout_summary()
returns table (
  currency_code    text,
  eligible         boolean,
  ledger_balance   text,
  reserved         text,
  paid_out         text,
  available        text,
  has_open_request boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'USD'::text,
         (p.status = 'active'),
         pos.ledger_balance::numeric(20, 4)::text,
         pos.reserved::numeric(20, 4)::text,
         pos.paid::numeric(20, 4)::text,
         greatest(pos.ledger_balance - pos.reserved - pos.paid, 0)::numeric(20, 4)::text,
         exists (select 1 from public.publisher_payout_requests r where r.publisher_id = p.id and r.status in ('requested', 'approved'))
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  cross join lateral private.publisher_payout_position(p.id) pos
  where p.profile_id = (select auth.uid()) and pr.status = 'active'
$$;

revoke all on function public.get_my_payout_summary() from public, anon, service_role;
grant execute on function public.get_my_payout_summary() to authenticated;

comment on function public.get_my_payout_summary() is
  'Caller ke apne publisher ka payout hisab (ledger balance, reserved, paid, available; USD, exact text). Publisher id parameter nahi. Sirf padhta hai.';

create or replace function public.get_my_payout_requests(p_limit integer default 25)
returns table (
  id               uuid,
  amount           text,
  status           text,
  rejection_reason text,
  created_at       timestamptz,
  reviewed_at      timestamptz,
  paid_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.amount::numeric(14, 4)::text,
         r.status,
         r.rejection_reason,
         r.created_at,
         r.reviewed_at,
         r.paid_at
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  join public.publisher_payout_requests r on r.publisher_id = p.id
  where p.profile_id = (select auth.uid()) and pr.status = 'active'
  order by r.created_at desc, r.id desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
$$;

revoke all on function public.get_my_payout_requests(integer) from public, anon, service_role;
grant execute on function public.get_my_payout_requests(integer) to authenticated;

comment on function public.get_my_payout_requests(integer) is
  'Caller ke apne publisher ke payout requests (naye pehle, max 100). Reviewer / actor ids kabhi nahi. Sirf padhta hai.';

create or replace function public.admin_list_payout_requests(p_limit integer default 50)
returns table (
  id               uuid,
  publisher_id     uuid,
  publisher_name   text,
  amount           text,
  status           text,
  rejection_reason text,
  created_at       timestamptz,
  reviewed_at      timestamptz,
  paid_at          timestamptz,
  ledger_covers    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.publisher_id,
         p.name,
         r.amount::numeric(14, 4)::text,
         r.status,
         r.rejection_reason,
         r.created_at,
         r.reviewed_at,
         r.paid_at,
         (pos.ledger_balance >= pos.reserved + pos.paid)
  from public.publisher_payout_requests r
  join public.publishers p on p.id = r.publisher_id
  cross join lateral private.publisher_payout_position(r.publisher_id) pos
  where private.is_admin()
  order by (r.status in ('requested', 'approved')) desc, r.created_at desc, r.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.admin_list_payout_requests(integer) from public, anon, service_role;
grant execute on function public.admin_list_payout_requests(integer) to authenticated;

comment on function public.admin_list_payout_requests(integer) is
  'Sirf active admin ko rows milti hain (baaki sab ko 0 rows). Khule requests pehle. Sirf padhta hai.';

-- ---------- J. access band (ledger jaisa: RLS on, koi policy nahi, saare roles se grant hata) ----------
alter table public.publisher_payout_requests enable row level security;
alter table public.publisher_payout_events   enable row level security;

revoke all on table public.publisher_payout_requests from public, anon, authenticated, service_role;
revoke all on table public.publisher_payout_events   from public, anon, authenticated, service_role;
revoke all on sequence public.publisher_payout_events_id_seq from public, anon, authenticated, service_role;

commit;

-- Verify: day-13-10-payout-requests-verify.sql (read-only). Rollback-only behaviour tests: day-13-11-payout-requests-tests.sql (sirf TEST project).
