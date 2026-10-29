-- =====================================================================
-- BLISSCCO | Day 13 | Part 2 | Migration (file day-13-4) : ledger ko serve ke saath ATOMIC jodna + admin reversal / adjustment
-- Pehle chali honi chahiye: day-13-1 (ledger), day-12-5 (record_ad_serve + serve_ref), day-3-1 (profiles, set_updated_at). Dobara chalane par safe hai.
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- ZAROORI: ye migration chalane ke baad bhi ledger BAND rehta hai (ledger_settings.ledger_enabled = false). Serve bilkul pehle jaisa chalta hai,
-- ledger me kuch nahi likhta. Ledger ON karna alag, jaan-boojh kar kiya jaane wala kadam hai (neeche "ON KAISE KAREIN").
--
-- Is file me:
--  A. public.ledger_settings (ek row): ledger_enabled (default false) + publisher_share_bps (default NULL = batwara tay NAHI). RLS on, saare roles se grant hata.
--  B. BUG FIX private.ledger_append: 4 se zyada decimal ki amount pehle chupchap round hoti thi; ab 'ledger_invalid_amount' se refuse (null / bahut badi bhi).
--  C. private.ledger_record_serve(serve_ref, campaign, publisher, amount): ek serve ke ledger entries likhta hai.
--       advertiser_charge = wahi amount jo record_ad_serve ne campaign_spend_daily me jodi (v_unit). Koi doosra hisab nahi.
--       publisher_earning / platform_revenue SIRF tab, jab publisher_share_bps set ho:
--         publisher_earning = TRUNCATE(charge x bps / 10000, 4 decimal);  platform_revenue = charge - publisher_earning (jodh hamesha charge ke barabar).
--         Jo entry 0 nikle wo nahi banti (ledger me amount 0 mana hai).
--  D. public.record_ad_serve (3 args): day-12-5 ka function JAS KA TAS + sirf EK line (perform private.ledger_record_serve). Spend / budget check / lock / serve log /
--     daily counter ka koi badlav nahi. Ledger me koi error => poora serve rollback (kuch aadha nahi). 4-arg version nahi badla: wo isi ko bulata hai,
--     aur retry (replay_serve) par ye function chalta hi nahi => dobara charge nahi, dobara ledger entry nahi. (Upar se ek serve + ek type = ek entry ka unique index bhi.)
--  E. public.ledger_reverse_entry / public.ledger_add_adjustment: admin ke liye (service_role only). Actor ACTIVE ADMIN profile hona chahiye. Nayi row; purani kabhi nahi badalti.
--     Reversal / adjustment campaign_spend_daily (budget) ko NAHI chhuta: budget wapas NAHI milta (ye business faisla baaki hai; docs dekho).
--
-- Jo NAHI badalta: koi purani row, campaign_spend_daily / creative_serve_daily / ad_serve_log ka logic, billing basis (charge abhi bhi SERVE par, CPM / 1000),
-- 4-arg record_ad_serve, RLS / grants (naye objects ke grants neeche dikhte hain). Koi BACKFILL nahi.
--
-- ON KAISE KAREIN (alag approval ke baad, pehle denim par): 
--   update public.ledger_settings set ledger_enabled = true where id;                    -- sirf charge ledger me
--   update public.ledger_settings set publisher_share_bps = <business faisla> where id;   -- tab hi earning / platform_revenue
-- Band karna: ledger_enabled = false (purani entries rehti hain; nayi nahi banti).
-- =====================================================================

begin;

create schema if not exists private;

-- ---------- A. settings ----------
create table if not exists public.ledger_settings (
  id                  boolean primary key default true,
  ledger_enabled      boolean not null default false,
  publisher_share_bps integer,
  updated_at          timestamptz not null default now(),

  constraint ledger_settings_single_row check (id),
  constraint ledger_settings_share_check check (publisher_share_bps is null or publisher_share_bps between 0 and 10000)
);

comment on table public.ledger_settings is
  'Single row. ledger_enabled (default false) = serve ke saath ledger likhna. publisher_share_bps (basis points, 7000 = 70%) KHALI = batwara tay nahi; project me koi percentage defined nahi hai.';
comment on column public.ledger_settings.publisher_share_bps is
  'Publisher ka hissa, basis points (0..10000). NULL = tay nahi: sirf advertiser_charge likhta hai. Badalne ka asar sirf AAGE ki serves par (purani entries kabhi nahi badalti).';

insert into public.ledger_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists ledger_settings_set_updated_at on public.ledger_settings;
create trigger ledger_settings_set_updated_at
  before update on public.ledger_settings
  for each row execute function public.set_updated_at();

alter table public.ledger_settings enable row level security;
revoke all on table public.ledger_settings from public, anon, authenticated, service_role;

-- ---------- B. BUG FIX: private.ledger_append amount ko exact maange ----------
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
  -- Day 13 Part 2 (bug fix): column numeric(14,4) hai, isliye 4 se zyada decimal wali amount chupchap round ho jaati thi (aur wahi retry galat "conflict" dikhati).
  -- Ab amount EXACT honi chahiye: NULL nahi, 4 decimal se zyada nahi, numeric(14,4) ki seema ke andar.
  if p_amount is null or p_amount <> round(p_amount, 4) or abs(p_amount) >= 10000000000 then
    raise exception 'Ledger amount must be a decimal with at most 4 decimals' using errcode = '22023', hint = 'ledger_invalid_amount';
  end if;

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

-- ---------- C. private.ledger_record_serve ----------
create or replace function private.ledger_record_serve(
  p_serve_ref    text,
  p_campaign_id  uuid,
  p_publisher_id uuid,
  p_amount       numeric
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

  -- Ledger ON hai toh serve_ref ke bina entry nahi ban sakti: serve ko hi fail karo (aadha record nahi).
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

revoke all on function private.ledger_record_serve(text, uuid, uuid, numeric) from public, anon, authenticated, service_role;

comment on function private.ledger_record_serve(text, uuid, uuid, numeric) is
  'record_ad_serve ke andar (usi transaction me) ek serve ke ledger entries likhta hai. Amount caller (record_ad_serve ka v_unit) deta hai, kabhi client nahi. Kisi role ko EXECUTE nahi.';

-- ---------- D. record_ad_serve (3 args): day-12-5 + ledger ki EK line ----------
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
  v_publisher_id uuid;
  v_campaign_id  uuid;
  v_total        numeric;
  v_daily        numeric;
  v_cpm          numeric;
  v_unit         numeric;
  v_spent_total  numeric;
  v_spent_today  numeric;
  v_today        date := (now() at time zone 'utc')::date;
  v_serve_ref    text;
  v_served_at    timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  -- Publisher key se hi dhoondo (caller se publisher id kabhi nahi liya jaata). Rate limit yahan nahi badhta.
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

  -- Creative dobara verify + campaign row par LOCK (budget ek ek karke jaanchna zaroori hai)
  select c.id, c.total_budget, c.daily_budget
    into v_campaign_id, v_total, v_daily
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

  -- Ek serve ki keemat = CPM / 1000 (kam se kam 0.0001 USD)
  select s.cpm_usd into v_cpm from public.ad_platform_settings s where s.id;
  if v_cpm is null then
    v_cpm := 2;
  end if;
  v_unit := greatest(round(v_cpm / 1000.0, 4), 0.0001);

  select coalesce(sum(d.spent), 0) into v_spent_total
  from public.campaign_spend_daily d where d.campaign_id = v_campaign_id;

  select coalesce(sum(d.spent), 0) into v_spent_today
  from public.campaign_spend_daily d where d.campaign_id = v_campaign_id and d.day = v_today;

  if v_spent_total + v_unit > v_total then
    return jsonb_build_object('outcome', 'rejected');
  end if;
  if v_daily is not null and v_spent_today + v_unit > v_daily then
    return jsonb_build_object('outcome', 'rejected');
  end if;

  insert into public.campaign_spend_daily (campaign_id, day, spent)
  values (v_campaign_id, v_today, v_unit)
  on conflict (campaign_id, day)
  do update set spent = public.campaign_spend_daily.spent + excluded.spent;

  insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic)
  values (v_publisher_id, p_creative_id, v_campaign_id, p_topic)
  returning serve_ref, served_at into v_serve_ref, v_served_at;

  insert into public.creative_serve_daily (creative_id, campaign_id, day, serves)
  values (p_creative_id, v_campaign_id, v_today, 1)
  on conflict (creative_id, day)
  do update set serves = public.creative_serve_daily.serves + 1;

  -- Day 13 Part 2: ledger usi transaction me (spend ke saath). v_unit WAHI keemat hai jo upar campaign_spend_daily me gayi: koi doosra hisab nahi.
  -- Ledger band ho (default) toh ye kuch nahi karta. Ledger me koi bhi error => poora serve (spend, log, counter) rollback: aadha record kabhi nahi.
  -- Budget yahan DOBARA nahi ghatta (campaign_spend_daily ko ledger kabhi nahi chhuta); retry par ye function chalta hi nahi (replay_serve pehle lautati hai).
  perform private.ledger_record_serve(v_serve_ref, v_campaign_id, v_publisher_id, v_unit);

  -- Day 12 Part 3: sirf serve_ref (opaque) + served_at wapas. Sequential id kabhi nahi. serve_ref NULL ho sakta hai (day-12-1 na chali ho)
  -- toh app token nahi banata; spend/serve log/counter ka koi behaviour badla nahi.
  return jsonb_build_object('outcome', 'ok', 'serve_ref', v_serve_ref, 'served_at', v_served_at);
end;
$$;

comment on function public.record_ad_serve(text, uuid, text) is
  'Serve record: key + creative dobara verify, BUDGET check (campaign lock), phir spend + serve log + daily counter (+ ledger, agar ledger_enabled). Jawab me serve_ref + served_at. Execute: service_role only.';

revoke all on function public.record_ad_serve(text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_ad_serve(text, uuid, text) to service_role;

-- ---------- E. admin ke liye reversal / adjustment ----------
create or replace function private.ledger_is_active_admin(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_actor and p.role = 'admin' and p.status = 'active');
$$;

revoke all on function private.ledger_is_active_admin(uuid) from public, anon, authenticated, service_role;

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
begin
  if p_actor is null or not private.ledger_is_active_admin(p_actor) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_entry_id is null or p_entry_id <= 0
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,200}$'
     or length(v_reason) not between 3 and 500 then
    return jsonb_build_object('outcome', 'invalid');
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
  'Admin: kisi entry ka poora ulta (nayi row). Actor active admin profile hona chahiye. Budget / spend nahi chhuta. Execute: service_role only.';

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
  'Admin: signed adjustment (nayi row, wajah + actor ke naam par). Amount exact (<= 4 decimal), 0 nahi. Budget / spend nahi chhuta. Execute: service_role only.';

commit;

-- Verify: day-13-5-ledger-service-verify.sql (read-only). Rollback-only tests: day-13-6-ledger-service-tests.sql (sirf TEST project).
