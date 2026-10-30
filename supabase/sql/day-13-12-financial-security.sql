-- =====================================================================
-- BLISSCCO | Day 13 | Part 5 | Migration (file day-13-12) : financial security hardening (ledger / payout / settings)
-- Pehle chali honi chahiye: day-13-1 (ledger), day-13-4 (ledger_settings), day-13-9 (payout requests), day-5-3 (ad_platform_settings), day-3-1 (set_updated_at).
-- Dobara chalane par safe hai (if not exists / create or replace / drop trigger if exists / baseline sirf ek baar).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
-- Ye migration koi balance, ledger entry, payout request ya purani row NAHI badalti. Sirf: naya audit table + naye guards (aur ek guard function ka naya version).
--
-- AUDIT me jo ASLI GAP mila (baaki sab Day 13 me pehle se theek tha: day-13 ke saare tables par koi grant nahi, saare functions search_path = '', ownership auth.uid() se):
--   GAP 1  Paisa tay karne wali SETTINGS chupchap badal sakti thi aur koi nishaan nahi bachta tha:
--            ledger_settings.publisher_share_bps (revenue share), ledger_settings.ledger_enabled, ad_platform_settings.cpm_usd (har serve ki keemat).
--          Aur in single-row tables ki row DELETE karne par wo apne aap default par laut jaati thi (share NULL, ledger band, CPM 2.00) -- bina kisi record ke.
--          FIX: A (append-only history table + har badlav par trigger) aur B (DELETE / TRUNCATE band).
--   GAP 2  Payout request ke DB guard me teen kamzoriyan (sirf SQL-owner / future function se reachable, par DB ko khud rokna chahiye):
--            (a) 'paid' karte waqt reviewed_by / reviewed_at chupke se badle ja sakte the,
--            (b) request kisi doosre profile ke naam par insert ho sakti thi (requested_by != publisher ka apna profile),
--            (c) reviewer / payer wahi profile ho sakta tha jisne request ki (self-approval).
--          FIX: C (private.guard_payout_request ka naya version; baaki sab purane niyam jas ke tas).
--
-- Jo NAHI badalta: financial_ledger, ledger_settings / ad_platform_settings ki koi value, record_ad_serve, spend / budget, payout functions ke naam / signature / grants,
-- RLS, koi purani row. Settings ka behaviour (update) pehle jaisa chalta hai; sirf ab uska record bachta hai.
-- =====================================================================

begin;

create schema if not exists private;

-- ---------- A. settings history (append-only) ----------
create table if not exists public.financial_settings_history (
  id          bigint      generated always as identity primary key,
  setting     text        not null,
  change_kind text        not null,
  old_value   text,
  new_value   text,
  changed_by  uuid,
  db_role     text        not null default current_user,
  changed_at  timestamptz not null default now(),

  constraint financial_settings_history_setting_check check (setting in ('ledger_enabled', 'publisher_share_bps', 'cpm_usd')),
  constraint financial_settings_history_kind_check check (change_kind in ('baseline', 'update')),
  constraint financial_settings_history_value_check check (length(coalesce(old_value, '')) <= 50 and length(coalesce(new_value, '')) <= 50)
);

comment on table public.financial_settings_history is
  'Append-only: paisa tay karne wali settings (revenue share, ledger on/off, CPM) ka har badlav. baseline = migration ke waqt ki value; update = uske baad ka har badlav. changed_by = auth.uid() (NULL = SQL editor / server). UPDATE / DELETE / TRUNCATE band.';
comment on column public.financial_settings_history.changed_by is
  'auth.uid() agar badlav kisi login session se hua; SQL editor / service se NULL (tab db_role dekho).';

create index if not exists financial_settings_history_setting_idx on public.financial_settings_history (setting, id);

-- Baseline: abhi ki value ek baar (dobara chalane par nahi dohrata). Sirf history table me likhta hai; settings ko nahi chhuta.
insert into public.financial_settings_history (setting, change_kind, old_value, new_value)
select 'ledger_enabled', 'baseline', null, s.ledger_enabled::text
from public.ledger_settings s
where s.id and not exists (select 1 from public.financial_settings_history h where h.setting = 'ledger_enabled');

insert into public.financial_settings_history (setting, change_kind, old_value, new_value)
select 'publisher_share_bps', 'baseline', null, coalesce(s.publisher_share_bps::text, 'null')
from public.ledger_settings s
where s.id and not exists (select 1 from public.financial_settings_history h where h.setting = 'publisher_share_bps');

insert into public.financial_settings_history (setting, change_kind, old_value, new_value)
select 'cpm_usd', 'baseline', null, s.cpm_usd::text
from public.ad_platform_settings s
where s.id and not exists (select 1 from public.financial_settings_history h where h.setting = 'cpm_usd');

create or replace function private.guard_financial_settings_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'financial_settings_history is append-only' using errcode = '23514', hint = 'settings_history_append_only';
end;
$$;

revoke all on function private.guard_financial_settings_history() from public, anon, authenticated, service_role;

drop trigger if exists financial_settings_history_guard on public.financial_settings_history;
create trigger financial_settings_history_guard
  before update or delete on public.financial_settings_history
  for each row execute function private.guard_financial_settings_history();

drop trigger if exists financial_settings_history_no_truncate on public.financial_settings_history;
create trigger financial_settings_history_no_truncate
  before truncate on public.financial_settings_history
  for each statement execute function private.guard_financial_settings_history();

alter table public.financial_settings_history enable row level security;
revoke all on table public.financial_settings_history from public, anon, authenticated, service_role;
revoke all on sequence public.financial_settings_history_id_seq from public, anon, authenticated, service_role;

-- ---------- A2. har badlav ka record (usi transaction me) ----------
create or replace function private.log_financial_setting_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_table_name = 'ledger_settings' then
    if new.ledger_enabled is distinct from old.ledger_enabled then
      insert into public.financial_settings_history (setting, change_kind, old_value, new_value, changed_by)
      values ('ledger_enabled', 'update', old.ledger_enabled::text, new.ledger_enabled::text, v_uid);
    end if;
    if new.publisher_share_bps is distinct from old.publisher_share_bps then
      insert into public.financial_settings_history (setting, change_kind, old_value, new_value, changed_by)
      values ('publisher_share_bps', 'update', coalesce(old.publisher_share_bps::text, 'null'), coalesce(new.publisher_share_bps::text, 'null'), v_uid);
    end if;
  elsif tg_table_name = 'ad_platform_settings' then
    if new.cpm_usd is distinct from old.cpm_usd then
      insert into public.financial_settings_history (setting, change_kind, old_value, new_value, changed_by)
      values ('cpm_usd', 'update', old.cpm_usd::text, new.cpm_usd::text, v_uid);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.log_financial_setting_change() from public, anon, authenticated, service_role;

drop trigger if exists ledger_settings_log_change on public.ledger_settings;
create trigger ledger_settings_log_change
  after update on public.ledger_settings
  for each row execute function private.log_financial_setting_change();

drop trigger if exists ad_platform_settings_log_change on public.ad_platform_settings;
create trigger ad_platform_settings_log_change
  after update on public.ad_platform_settings
  for each row execute function private.log_financial_setting_change();

-- ---------- B. settings row delete / truncate band ----------
-- Row delete hoti toh "insert ... on conflict do nothing" / code ka default use hota: share NULL, ledger band, CPM 2.00 -- chupchap.
create or replace function private.guard_financial_settings_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Financial settings rows cannot be deleted or truncated' using errcode = '23514', hint = 'settings_no_delete';
end;
$$;

revoke all on function private.guard_financial_settings_delete() from public, anon, authenticated, service_role;

drop trigger if exists ledger_settings_no_delete on public.ledger_settings;
create trigger ledger_settings_no_delete
  before delete on public.ledger_settings
  for each row execute function private.guard_financial_settings_delete();

drop trigger if exists ledger_settings_no_truncate on public.ledger_settings;
create trigger ledger_settings_no_truncate
  before truncate on public.ledger_settings
  for each statement execute function private.guard_financial_settings_delete();

drop trigger if exists ad_platform_settings_no_delete on public.ad_platform_settings;
create trigger ad_platform_settings_no_delete
  before delete on public.ad_platform_settings
  for each row execute function private.guard_financial_settings_delete();

drop trigger if exists ad_platform_settings_no_truncate on public.ad_platform_settings;
create trigger ad_platform_settings_no_truncate
  before truncate on public.ad_platform_settings
  for each statement execute function private.guard_financial_settings_delete();

-- ---------- C. payout guard ka naya version (day-13-9 ka function + teen naye niyam) ----------
-- Purane niyam jas ke tas: DELETE band, INSERT sirf 'requested' se, identity / amount kabhi nahi badalte, sirf valid transitions.
-- Naye niyam (sirf UPDATE / INSERT par EXTRA rok; koi purani valid cheez nahi rukti):
--   N1 (INSERT)  requested_by wahi profile ho jo is publisher ka apna profile hai.
--   N2 (->paid)  reviewed_by / reviewed_at 'paid' karte waqt badle nahi ja sakte (review ka nishaan wahi rehta hai jo approve ke waqt tha).
--   N3 (UPDATE)  reviewer / payer wahi profile nahi ho sakta jisne request ki (self-approval nahi).
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
    if not exists (select 1 from public.publishers p where p.id = new.publisher_id and p.profile_id = new.requested_by) then
      raise exception 'A payout request must be made by the publisher''s own profile' using errcode = '23514', hint = 'payout_requester_mismatch';
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

  -- N2: paid karte waqt review ka nishaan wahi rehta hai.
  if new.status = 'paid'
     and (new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'Review details cannot change when a payout is marked paid' using errcode = '23514', hint = 'payout_review_trail_frozen';
  end if;

  -- N3: self-approval nahi.
  if new.reviewed_by is not distinct from new.requested_by
     or new.paid_by is not distinct from new.requested_by then
    raise exception 'A payout cannot be reviewed or paid by the profile that requested it' using errcode = '23514', hint = 'payout_self_review';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_payout_request() from public, anon, authenticated, service_role;

-- Trigger pehle se day-13-9 me bana hai (publisher_payout_requests_guard) aur naye function ko hi bulata hai; phir bhi dobara bandh dete hain taaki order / events pakke rahein.
drop trigger if exists publisher_payout_requests_guard on public.publisher_payout_requests;
create trigger publisher_payout_requests_guard
  before insert or update or delete on public.publisher_payout_requests
  for each row execute function private.guard_payout_request();

commit;

-- Verify (read-only): day-13-13-financial-security-verify.sql. Rollback-only tests (sirf TEST project): day-13-14-financial-security-tests.sql.
