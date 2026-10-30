-- =====================================================================
-- BLISSCCO | Day 9 | Part 4 : campaign lifecycle guards (database level)
-- Pehle day-3-5, day-4-1, day-4-3, day-5-6, day-7-1, day-9-3 aur day-9-5 chali honi chahiye.
-- Dobara chalane par safe hai (sirf `create or replace`). KOI table/column/status-value/data nahi badalta,
-- RLS ko haath nahi lagta, koi grant kam nahi hota. PEHLE TEST project par chalao, phir asli par.
-- (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Jo gap mile (code padhkar) aur is file me kya fix hai:
--  A. RESUME (paused -> active) approved creative aur end_date to dekhta tha, par BUDGET nahi.
--     Poora kharch ho chuka campaign resume ho kar "Active" dikhta tha jabki record_ad_serve usse kabhi serve nahi karta.
--     Ab resume tab hi hota hai jab ek serve ki keemat jitna budget bacha ho. (hint: resume_budget_exhausted)
--     Saath me: "aaj" ab UTC se tay hota hai (pehle current_date = database session ki timezone). Serve code bhi UTC use karta hai.
--  B. admin_review_campaign (approve) ab ye bhi rokta hai: end_date guzar gayi, budget bacha nahi, advertiser/profile active nahi,
--     aur admin ka APNE advertiser account ka campaign (self-approval).
--  C. admin_review_creative (approve) ab advertiser/profile active na ho ya admin ka apna account ho toh rokta hai.
--     (Abhi role-FK ki wajah se admin advertiser ban nahi sakta; ye defense in depth hai.)
--  D. private.replay_serve (retry me wahi ad dobara dena) sirf "creative approved + campaign active" dekhta tha.
--     Ab schedule (start/end), advertiser aur advertiser-profile bhi dekhta hai. Budget JAAN-BOOJH KAR nahi dekhta:
--     us request ka charge pehle ho chuka hai, retry me dobara charge nahi hota.
--  E. public.load_ad_candidates ab poora-kharch campaign pehle hi hata deta hai. Warna 200-row limit me
--     kam-serve hue (par budget khatam) campaigns bhar kar sahi campaigns ko bahar kar sakte the.
--
-- Status values same hain: draft | pending_review | active | paused | completed | rejected | archived.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Helper: kya is campaign me ek serve ki keemat jitna total budget bacha hai?
-- record_ad_serve (day-7-1) wali hi keemat: greatest(round(cpm/1000, 4), 0.0001).
-- security definer: kharch ki table authenticated ko seedha padhne nahi deti.
-- Sirf campaign ka apna advertiser ya admin jawab pa sakta hai; baaki sab ko false (kisi aur ke budget ka andaza nahi lagta).
-- p_total_budget: resume ke saath budget badhaya ja raha ho toh naya total (warna table wala).
-- ---------------------------------------------------------------------
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

  select c.total_budget into v_total from public.campaigns c where c.id = p_campaign_id;
  if v_total is null then
    return false;
  end if;
  v_total := coalesce(p_total_budget, v_total);

  select coalesce(sum(d.spent), 0) into v_spent
  from public.campaign_spend_daily d where d.campaign_id = p_campaign_id;

  select s.cpm_usd into v_cpm from public.ad_platform_settings s where s.id;
  if v_cpm is null then
    v_cpm := 2;
  end if;
  v_unit := greatest(round(v_cpm / 1000.0, 4), 0.0001);

  return (v_total - v_spent) >= v_unit;
end;
$$;

revoke all on function private.campaign_can_afford_serve(uuid, numeric) from public, anon;
grant execute on function private.campaign_can_afford_serve(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- A. Campaign guard (day-4-3 ka version + resume par budget + UTC din)
--    Purane niyam bilkul same: 50 campaign limit, allowed transitions, locked statuses, category lock.
-- ---------------------------------------------------------------------
create or replace function private.guard_campaign_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- SQL Editor / admin functions (postgres role) par guard lagu nahi.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New campaigns must start as draft' using errcode = '42501';
    end if;
    -- ek advertiser ke max 50 non-archived campaigns
    if (select count(*) from public.campaigns c
        where c.advertiser_id = new.advertiser_id and c.status <> 'archived') >= 50 then
      raise exception 'Campaign limit reached' using errcode = '42501', hint = 'campaign_limit_reached';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.advertiser_id is distinct from old.advertiser_id
     or new.currency_code is distinct from old.currency_code then
    raise exception 'id, advertiser and currency cannot be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Advertiser ke allowed transitions. 'active' tak pahunchna sirf admin approval se (resume ko chhodkar, jo neeche ke niyamo se bandha hai).
    if (old.status, new.status) not in (
      ('draft', 'pending_review'), ('pending_review', 'draft'), ('rejected', 'draft'),
      ('active', 'paused'), ('paused', 'active'),
      ('draft', 'archived'), ('rejected', 'archived'), ('paused', 'archived'), ('completed', 'archived')
    ) then
      raise exception 'Campaign status change % -> % is not allowed', old.status, new.status
        using errcode = '42501';
    end if;

    -- Resume: approved creative + end_date guzri na ho + budget bacha ho
    if old.status = 'paused' and new.status = 'active' then
      if not exists (
        select 1 from public.ad_creatives x
        where x.campaign_id = new.id and x.status = 'approved'
      ) then
        raise exception 'Campaign needs an approved creative before it can resume'
          using errcode = '42501', hint = 'resume_needs_approved_creative';
      end if;
      if new.end_date is not null and new.end_date < (now() at time zone 'utc')::date then
        raise exception 'Campaign end date has passed'
          using errcode = '42501', hint = 'resume_campaign_ended';
      end if;
      if not private.campaign_can_afford_serve(new.id, new.total_budget) then
        raise exception 'Campaign has no budget left to serve ads'
          using errcode = '42501', hint = 'resume_budget_exhausted';
      end if;
    end if;
  elsif old.status in ('pending_review', 'completed', 'archived') then
    if (new.name, new.description, new.category, new.total_budget, new.daily_budget, new.start_date, new.end_date)
       is distinct from
       (old.name, old.description, old.category, old.total_budget, old.daily_budget, old.start_date, old.end_date) then
      raise exception 'Campaign is locked while status is %', old.status using errcode = '42501';
    end if;
  end if;

  if new.category is distinct from old.category and old.status not in ('draft', 'rejected') then
    raise exception 'Category can only be changed while draft or rejected' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B. admin_review_campaign : approve ke liye poori eligibility + self-approval block
--    decision: 'approve' (pending_review -> active) ya 'reject' (-> rejected)
-- ---------------------------------------------------------------------
create or replace function public.admin_review_campaign(p_campaign_id uuid, p_decision text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status        text;
  v_end_date      date;
  v_adv_status    text;
  v_adv_profile   uuid;
  v_prof_status   text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  select c.status, c.end_date, a.status, a.profile_id, ap.status
    into v_status, v_end_date, v_adv_status, v_adv_profile, v_prof_status
  from public.campaigns c
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where c.id = p_campaign_id
  for update of c;

  if not found then
    raise exception 'Campaign not found' using errcode = 'P0002';
  end if;

  if p_decision = 'approve' then
    -- Apne hi account ke campaign ko approve nahi (separation of duties).
    if v_adv_profile = (select auth.uid()) then
      raise exception 'Admins cannot approve their own campaigns'
        using errcode = '42501', hint = 'self_approval_blocked';
    end if;
    if v_status <> 'pending_review' then
      raise exception 'Only pending_review campaigns can be approved' using errcode = '22023';
    end if;
    if v_adv_status <> 'active' or v_prof_status <> 'active' then
      raise exception 'Advertiser account is not active' using errcode = '22023', hint = 'advertiser_not_active';
    end if;
    if not exists (select 1 from public.ad_creatives x where x.campaign_id = p_campaign_id and x.status = 'approved') then
      raise exception 'Approve at least one creative first' using errcode = '22023', hint = 'approve_needs_creative';
    end if;
    if v_end_date is not null and v_end_date < (now() at time zone 'utc')::date then
      raise exception 'Campaign end date has passed' using errcode = '22023', hint = 'approve_campaign_ended';
    end if;
    if not private.campaign_can_afford_serve(p_campaign_id) then
      raise exception 'Campaign has no budget left to serve ads' using errcode = '22023', hint = 'approve_needs_budget';
    end if;
    update public.campaigns set status = 'active' where id = p_campaign_id;
  elsif p_decision = 'reject' then
    if v_status not in ('pending_review', 'active', 'paused') then
      raise exception 'Campaign cannot be rejected from status %', v_status using errcode = '22023';
    end if;
    update public.campaigns set status = 'rejected' where id = p_campaign_id;
  else
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- C. admin_review_creative : approve par advertiser active + self-approval block
--    decision: 'approve' (pending_review -> approved) ya 'reject' (reason zaroori)
-- ---------------------------------------------------------------------
create or replace function public.admin_review_creative(p_creative_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status          text;
  v_campaign_status text;
  v_adv_status      text;
  v_adv_profile     uuid;
  v_prof_status     text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  select x.status, c.status, a.status, a.profile_id, ap.status
    into v_status, v_campaign_status, v_adv_status, v_adv_profile, v_prof_status
  from public.ad_creatives x
  join public.campaigns   c  on c.id  = x.campaign_id
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where x.id = p_creative_id
  for update of x;

  if not found then
    raise exception 'Creative not found' using errcode = 'P0002';
  end if;
  if v_campaign_status in ('archived', 'completed') then
    raise exception 'Campaign is closed' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    if v_adv_profile = (select auth.uid()) then
      raise exception 'Admins cannot approve their own ads'
        using errcode = '42501', hint = 'self_approval_blocked';
    end if;
    if v_status <> 'pending_review' then
      raise exception 'Only pending_review creatives can be approved' using errcode = '22023';
    end if;
    if v_adv_status <> 'active' or v_prof_status <> 'active' then
      raise exception 'Advertiser account is not active' using errcode = '22023', hint = 'advertiser_not_active';
    end if;
    update public.ad_creatives
       set status = 'approved', rejection_reason = null,
           reviewed_by = (select auth.uid()), reviewed_at = now()
     where id = p_creative_id;
  elsif p_decision = 'reject' then
    if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(p_reason) > 500 then
      raise exception 'Rejection reason (1-500 chars) is required' using errcode = '22023';
    end if;
    if v_status not in ('pending_review', 'approved', 'paused') then
      raise exception 'Creative cannot be rejected from status %', v_status using errcode = '22023';
    end if;
    update public.ad_creatives
       set status = 'rejected', rejection_reason = btrim(p_reason),
           reviewed_by = (select auth.uid()), reviewed_at = now()
     where id = p_creative_id;
  else
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
end;
$$;

-- create or replace purane grants nahi badalta, par dobara likhna rerun-safe hai.
revoke all on function public.admin_review_campaign(uuid, text)       from public, anon;
revoke all on function public.admin_review_creative(uuid, text, text) from public, anon;
grant execute on function public.admin_review_campaign(uuid, text)       to authenticated;
grant execute on function public.admin_review_creative(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- D. replay_serve : retry me bhi schedule + advertiser + profile dekho (budget nahi: charge pehle ho chuka)
--    Signature, return shape aur grants same (day-9-5 ka test unhe dekhta hai).
-- ---------------------------------------------------------------------
create or replace function private.replay_serve(p_publisher_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creative uuid;
  v_today    date := (now() at time zone 'utc')::date;
  r          record;
begin
  select q.creative_id into v_creative
  from public.ad_serve_requests q
  where q.publisher_id = p_publisher_id and q.idempotency_key = p_key;

  if not found then
    return null;
  end if;

  select x.id, x.headline, x.body, x.cta_text, x.destination_url
    into r
  from public.ad_creatives x
  join public.campaigns   c  on c.id  = x.campaign_id
  join public.advertisers a  on a.id  = c.advertiser_id
  join public.profiles    ap on ap.id = a.profile_id
  where x.id = v_creative
    and x.status = 'approved'
    and c.status = 'active'
    and c.start_date <= v_today
    and (c.end_date is null or c.end_date >= v_today)
    and a.status  = 'active'
    and ap.status = 'active';

  if not found then
    return jsonb_build_object('outcome', 'rejected', 'replayed', true);
  end if;

  return jsonb_build_object(
    'outcome',  'ok',
    'replayed', true,
    'ad', jsonb_build_object(
      'id', r.id, 'headline', r.headline, 'body', r.body, 'cta_text', r.cta_text, 'destination_url', r.destination_url
    )
  );
end;
$$;

revoke all on function private.replay_serve(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- E. load_ad_candidates : (day-5-6 jaisa hi) + total budget khatam wale campaigns pehle hi bahar
--    Return columns, ordering, limit 200 aur grants bilkul same.
--    Daily budget yahan nahi dekhte (wo roz badalta hai); TypeScript layer + record_ad_serve dobara jaanchte hain.
-- ---------------------------------------------------------------------
create or replace function public.load_ad_candidates(
  p_category text,
  p_today    date
)
returns table (
  creative_id               uuid,
  headline                  text,
  body                      text,
  cta_text                  text,
  destination_url           text,
  creative_status           text,
  campaign_id               uuid,
  campaign_status           text,
  category                  text,
  start_date                date,
  end_date                  date,
  total_budget              numeric,
  daily_budget              numeric,
  spent_total               numeric,
  spent_today               numeric,
  advertiser_status         text,
  advertiser_profile_status text,
  campaign_serves_today     integer,
  creative_serves_today     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    x.id,
    x.headline,
    x.body,
    x.cta_text,
    x.destination_url,
    x.status,
    c.id,
    c.status,
    c.category,
    c.start_date,
    c.end_date,
    c.total_budget,
    c.daily_budget,
    coalesce((select sum(s.spent) from public.campaign_spend_daily s
              where s.campaign_id = c.id), 0),
    coalesce((select s.spent from public.campaign_spend_daily s
              where s.campaign_id = c.id and s.day = p_today), 0),
    a.status,
    ap.status,
    coalesce((select sum(d.serves) from public.creative_serve_daily d
              where d.campaign_id = c.id and d.day = p_today), 0)::integer as campaign_serves_today,
    coalesce((select d2.serves from public.creative_serve_daily d2
              where d2.creative_id = x.id and d2.day = p_today), 0)::integer as creative_serves_today
  from public.ad_creatives x
  join public.campaigns  c  on c.id  = x.campaign_id
  join public.advertisers a on a.id  = c.advertiser_id
  join public.profiles   ap on ap.id = a.profile_id
  where p_category is not null
    and p_today is not null
    and p_category ~ '^[a-z0-9_]{1,50}$'
    and p_today between ((now() at time zone 'utc')::date - 1) and ((now() at time zone 'utc')::date + 1)
    and exists (select 1 from public.ad_categories k where k.slug = p_category and k.is_active)
    and c.category = p_category
    and x.status  = 'approved'
    and c.status  = 'active'
    and a.status  = 'active'
    and ap.status = 'active'
    and c.start_date <= p_today
    and (c.end_date is null or c.end_date >= p_today)
    and coalesce((select sum(s3.spent) from public.campaign_spend_daily s3
                  where s3.campaign_id = c.id), 0) < c.total_budget
  order by campaign_serves_today asc, creative_serves_today asc, c.id asc, x.id asc
  limit 200
$$;

comment on function public.load_ad_candidates(text, date) is
  'Read-only: eligible-looking ad candidates for one category and one UTC day (budget-exhausted campaigns excluded). Execute: service_role only.';

revoke all on function public.load_ad_candidates(text, date) from public, anon, authenticated;
grant execute on function public.load_ad_candidates(text, date) to service_role;

commit;

-- Check 1 (Expect: 4 rows, ok = true): naye versions laga hain
--   select 'guard_campaign_changes' as fn, pg_get_functiondef('private.guard_campaign_changes()'::regprocedure) like '%resume_budget_exhausted%' as ok
--   union all select 'admin_review_campaign', pg_get_functiondef('public.admin_review_campaign(uuid, text)'::regprocedure) like '%self_approval_blocked%'
--   union all select 'admin_review_creative', pg_get_functiondef('public.admin_review_creative(uuid, text, text)'::regprocedure) like '%self_approval_blocked%'
--   union all select 'replay_serve', pg_get_functiondef('private.replay_serve(uuid, text)'::regprocedure) like '%c.start_date <= v_today%';
-- Check 2 (Expect: sirf authenticated aur postgres): helper ka access
--   select grantee from information_schema.routine_privileges
--   where routine_schema = 'private' and routine_name = 'campaign_can_afford_serve' order by grantee;
-- Check 3 (Expect: sirf service_role aur postgres): load_ad_candidates ka access pehle jaisa hi
--   select grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'load_ad_candidates' order by grantee;
-- Check 4 (Expect: 0 rows, sirf dekhne ke liye): active campaign jiska budget khatam hai ("Active" dikhta hai par serve nahi karta)
--   select c.id, c.name, c.total_budget, s.total_spent
--   from public.campaigns c
--   join (select campaign_id, sum(spent) as total_spent from public.campaign_spend_daily group by 1) s on s.campaign_id = c.id
--   where c.status = 'active' and c.total_budget - s.total_spent < 0.002;
