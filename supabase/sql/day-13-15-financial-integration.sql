-- =====================================================================
-- BLISSCCO | Day 13 | Part 6 | Migration (file day-13-15) : admin ledger writers ko payout workflow ke SAATH serialize karna
-- Pehle chali honi chahiye: day-13-4 (ledger_reverse_entry / ledger_add_adjustment), day-13-9 (payout requests). Dobara chalane par safe hai (create or replace).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai; approval ke baad hi.)
--
-- BUG (code padhkar confirm hua; SQL abhi chalayi nahi, isliye race ko database par reproduce NAHI kiya gaya):
--   Payout functions (request_my_payout / admin_review_payout_request / admin_mark_payout_paid) publisher ki row par FOR NO KEY UPDATE lock lekar balance padhte hain.
--   Lekin ledger_reverse_entry / ledger_add_adjustment (day-13-4) publisher ke account par entry likhte waqt WO LOCK NAHI lete.
--   Isse ek reversal / negative adjustment payout ki jaanch ke BEECH me commit ho sakta tha:
--     admin "Mark as paid" balance jaanchta hai (theek hai) -> usi pal ek reversal commit hota hai -> paid record ho jata hai, jabki balance ab request ko cover nahi karta.
--   Is race me koi paisa nahi hilta (paid sirf record hai) par admin ka record galat balance par bantta.
--
-- FIX: dono admin writers, publisher ke account par likhne se pehle wahi publishers-row lock (FOR NO KEY UPDATE) lete hain jo payout functions lete hain.
--   Lock ka order hamesha: publishers row -> (payout row | ledger insert). Deadlock nahi (record_ad_serve publishers par sirf FK KEY SHARE leta hai, jo NO KEY UPDATE se nahi takraata:
--   serve ruka nahi rehta).
--   Sirf account = 'publisher' ki entries lock leti hain (advertiser / platform entries publisher ka balance nahi badaltin).
--
-- Jo NAHI badalta: function signatures, grants (service_role only), actor / reason / amount / idempotency niyam, ledger table, record_ad_serve, campaign_spend_daily (budget),
-- impression / click, payout tables, koi balance, koi purani row. Koi data nahi chhua jata.
-- =====================================================================

begin;

create or replace function public.ledger_reverse_entry(
  p_actor           uuid,
  p_entry_id        bigint,
  p_idempotency_key text,
  p_reason          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hint   text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_acct   text;
  v_pub    uuid;
begin
  if p_actor is null or not private.ledger_is_active_admin(p_actor) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_entry_id is null or p_entry_id <= 0
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,200}$'
     or length(v_reason) not between 3 and 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Day 13 Part 6: publisher ke account ka reversal payout jaanch ke saath serialize ho (wahi lock jo payout functions lete hain).
  select l.account, l.publisher_id into v_acct, v_pub from public.financial_ledger l where l.id = p_entry_id;
  if v_acct = 'publisher' and v_pub is not null then
    perform 1 from public.publishers p where p.id = v_pub for no key update;
  end if;

  begin
    return private.ledger_reverse(p_entry_id, p_idempotency_key, v_reason, p_actor);
  exception when others then
    if sqlstate in ('40001', '40P01', '55P03', '57014') then
      raise; -- transient (deadlock / timeout): chhupana nahi, caller retry kare
    end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('outcome', case v_hint
      when 'ledger_idempotency_conflict'    then 'conflict'
      when 'ledger_reversal_target_missing' then 'not_found'
      else 'rejected' end);
  end;
end;
$$;

revoke all on function public.ledger_reverse_entry(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.ledger_reverse_entry(uuid, bigint, text, text) to service_role;

comment on function public.ledger_reverse_entry(uuid, bigint, text, text) is
  'Admin: kisi entry ka poora ulta (nayi row). Actor active admin profile hona chahiye. Publisher account par payout functions wala publishers-row lock leta hai. Budget / spend nahi chhuta. Execute: service_role only.';

create or replace function public.ledger_add_adjustment(
  p_actor           uuid,
  p_account         text,
  p_amount          numeric,
  p_idempotency_key text,
  p_reason          text,
  p_advertiser_id   uuid default null,
  p_publisher_id    uuid default null,
  p_campaign_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hint   text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_actor is null or not private.ledger_is_active_admin(p_actor) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_account is null or p_account not in ('advertiser', 'publisher', 'platform')
     or p_amount is null or p_amount = 0
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,200}$'
     or length(v_reason) not between 3 and 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Day 13 Part 6: publisher ke account ka adjustment payout jaanch ke saath serialize ho (wahi lock jo payout functions lete hain).
  if p_account = 'publisher' and p_publisher_id is not null then
    perform 1 from public.publishers p where p.id = p_publisher_id for no key update;
  end if;

  begin
    return private.ledger_append('adjustment', p_account, p_amount, p_idempotency_key, 'manual', null, p_advertiser_id, p_publisher_id, p_campaign_id, v_reason, p_actor);
  exception when others then
    if sqlstate in ('40001', '40P01', '55P03', '57014') then
      raise;
    end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('outcome', case v_hint
      when 'ledger_idempotency_conflict' then 'conflict'
      when 'ledger_invalid_amount'       then 'invalid'
      else 'rejected' end);
  end;
end;
$$;

revoke all on function public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid) to service_role;

comment on function public.ledger_add_adjustment(uuid, text, numeric, text, text, uuid, uuid, uuid) is
  'Admin: signed adjustment (nayi row, wajah + actor ke naam par). Publisher account par payout functions wala publishers-row lock leta hai. Amount exact (<= 4 decimal), 0 nahi. Budget / spend nahi chhuta. Execute: service_role only.';

commit;

-- Verify: day-13-16-financial-consistency-verify.sql (read-only; migration ke baad aur kisi bhi samay chalao).
