-- =====================================================================
-- BLISSCCO | Day 3 | Part 5 : SECURITY (RLS policies + guards)
-- Pehle Part 1-4 chale hone chahiye. Ye file CHALANE SE PEHLE padho
-- (DAY3-SECURITY-REVIEW.md dekho). Dobara chalane par safe hai.
--
-- Security ke 4 layers:
--  1. GRANT (column-level): user ko sirf wahi columns milte hain jo wo badal sakta hai
--     (role/status/review columns kabhi nahi). Delete kisi ko nahi.
--  2. RLS policies: kaun si ROW dikhegi / badli ja sakti hai.
--  3. Guard triggers: status workflow (draft -> pending_review ...) enforce karte hain.
--     RLS purani aur nayi row ko compare nahi kar sakta, isliye trigger zaroori hai.
--  4. Admin RPC functions: approvals sirf admin function se (function ke andar admin check).
--
-- Rules
--  * anon (bina login) ko kisi table par koi access nahi.
--  * service_role key sirf server par. Browser/NEXT_PUBLIC me kabhi nahi.
--  * Policies "to authenticated" hain aur har ek row ownership se bandhi hai;
--    koi "using (true)" wali policy nahi.
--  * Recursion se bachne ke liye admin/ownership lookups SECURITY DEFINER helper
--    functions se hote hain (private schema me, API se expose nahi).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. private schema (Data API me expose nahi hota)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER = owner ke haq se chalte hain, isliye
--    profiles/advertisers par RLS dobara trigger nahi hota => recursion nahi)
--    search_path '' => koi fake object inject nahi kar sakta.
--    Ye sirf CALLER ki apni info batate hain (auth.uid() se).
-- ---------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function private.is_active_profile()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  );
$$;

-- Caller ka advertiser id (profile active ho tab). Account status koi bhi.
create or replace function private.my_advertiser_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select a.id
  from public.advertisers a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and p.status = 'active';
$$;

-- Caller ka advertiser id, sirf jab advertiser account 'active' (admin-approved) ho.
create or replace function private.my_active_advertiser_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select a.id
  from public.advertisers a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and p.status = 'active' and a.status = 'active';
$$;

revoke all on function private.is_admin()                from public, anon;
revoke all on function private.is_active_profile()       from public, anon;
revoke all on function private.my_advertiser_id()        from public, anon;
revoke all on function private.my_active_advertiser_id() from public, anon;
grant execute on function private.is_admin()                to authenticated;
grant execute on function private.is_active_profile()       to authenticated;
grant execute on function private.my_advertiser_id()        to authenticated;
grant execute on function private.my_active_advertiser_id() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Extra constraint: approved creative me review time zaroori
--    (direct approve bina review ke database hi rok dega)
-- ---------------------------------------------------------------------
alter table public.ad_creatives drop constraint if exists ad_creatives_approved_needs_review_check;
alter table public.ad_creatives add constraint ad_creatives_approved_needs_review_check
  check (status <> 'approved' or reviewed_at is not null);

-- ---------------------------------------------------------------------
-- 3. Guard triggers (status workflow)
--    Sirf API users par lagte hain (current_user = anon/authenticated).
--    SQL Editor (postgres), service_role aur neeche ke admin functions par nahi.
-- ---------------------------------------------------------------------
create or replace function private.guard_campaign_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New campaigns must start as draft' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.advertiser_id is distinct from old.advertiser_id
     or new.currency_code is distinct from old.currency_code then
    raise exception 'id, advertiser and currency cannot be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Advertiser ke allowed transitions. 'active' tak pahunchna sirf admin approval se.
    if (old.status, new.status) not in (
      ('draft', 'pending_review'), ('pending_review', 'draft'), ('rejected', 'draft'),
      ('active', 'paused'), ('paused', 'active'),
      ('draft', 'archived'), ('rejected', 'archived'), ('paused', 'archived'), ('completed', 'archived')
    ) then
      raise exception 'Campaign status change % -> % is not allowed', old.status, new.status
        using errcode = '42501';
    end if;
  elsif old.status in ('pending_review', 'completed', 'archived') then
    if (new.name, new.category, new.total_budget, new.daily_budget, new.start_date, new.end_date)
       is distinct from
       (old.name, old.category, old.total_budget, old.daily_budget, old.start_date, old.end_date) then
      raise exception 'Campaign is locked while status is %', old.status using errcode = '42501';
    end if;
  end if;

  -- Category review ke baad badalna = bait-and-switch, isliye sirf draft/rejected me.
  if new.category is distinct from old.category and old.status not in ('draft', 'rejected') then
    raise exception 'Category can only be changed while draft or rejected' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.guard_creative_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft'
       or new.rejection_reason is not null
       or new.reviewed_by is not null
       or new.reviewed_at is not null then
      raise exception 'New creatives must start as draft without review data' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.campaign_id is distinct from old.campaign_id then
    raise exception 'id and campaign cannot be changed' using errcode = '42501';
  end if;

  content_changed := (new.headline, new.body, new.cta_text, new.destination_url)
                     is distinct from
                     (old.headline, old.body, old.cta_text, old.destination_url);

  if content_changed then
    if old.status = 'pending_review' then
      raise exception 'Withdraw to draft before editing a creative under review' using errcode = '42501';
    end if;
    if old.status = 'archived' then
      raise exception 'Archived creative is read-only' using errcode = '42501';
    end if;
    if old.status <> 'draft' then
      -- approved / paused / rejected creative edit => dobara review zaroori
      new.status := 'draft';
      new.rejection_reason := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      return new;
    end if;
  elsif (new.rejection_reason, new.reviewed_by, new.reviewed_at)
        is distinct from
        (old.rejection_reason, old.reviewed_by, old.reviewed_at) then
    raise exception 'Review fields cannot be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('draft', 'pending_review'), ('pending_review', 'draft'), ('rejected', 'draft'),
      ('approved', 'paused'), ('paused', 'approved'),
      ('draft', 'archived'), ('rejected', 'archived'), ('approved', 'archived'), ('paused', 'archived')
    ) then
      raise exception 'Creative status change % -> % is not allowed', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_campaign_changes() from public, anon, authenticated;
revoke all on function private.guard_creative_changes() from public, anon, authenticated;

drop trigger if exists campaigns_guard_changes on public.campaigns;
create trigger campaigns_guard_changes
  before insert or update on public.campaigns
  for each row execute function private.guard_campaign_changes();

drop trigger if exists ad_creatives_guard_changes on public.ad_creatives;
create trigger ad_creatives_guard_changes
  before insert or update on public.ad_creatives
  for each row execute function private.guard_creative_changes();

-- ---------------------------------------------------------------------
-- 4. Admin functions (approvals). Public schema me hain taaki frontend/server
--    supabase.rpc() se bula sake, par har function ke andar admin check hai.
--    Role/admin banana yahan NAHI hai (wo sirf SQL Editor / service_role se).
-- ---------------------------------------------------------------------
create or replace function public.admin_set_advertiser_status(p_advertiser_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.advertisers set status = p_status where id = p_advertiser_id;
  if not found then
    raise exception 'Advertiser not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_set_publisher_status(p_publisher_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.publishers set status = p_status where id = p_publisher_id;
  if not found then
    raise exception 'Publisher not found' using errcode = 'P0002';
  end if;
end;
$$;

-- decision: 'approve' (pending_review -> active) ya 'reject' (-> rejected)
create or replace function public.admin_review_campaign(p_campaign_id uuid, p_decision text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status     text;
  v_adv_status text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  select c.status, a.status into v_status, v_adv_status
  from public.campaigns c
  join public.advertisers a on a.id = c.advertiser_id
  where c.id = p_campaign_id
  for update of c;

  if not found then
    raise exception 'Campaign not found' using errcode = 'P0002';
  end if;

  if p_decision = 'approve' then
    if v_status <> 'pending_review' then
      raise exception 'Only pending_review campaigns can be approved' using errcode = '22023';
    end if;
    if v_adv_status <> 'active' then
      raise exception 'Advertiser account is not active' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ad_creatives x where x.campaign_id = p_campaign_id and x.status = 'approved') then
      raise exception 'Approve at least one creative first' using errcode = '22023';
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

-- decision: 'approve' (pending_review -> approved) ya 'reject' (reason zaroori)
create or replace function public.admin_review_creative(p_creative_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status          text;
  v_campaign_status text;
begin
  if not private.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  select x.status, c.status into v_status, v_campaign_status
  from public.ad_creatives x
  join public.campaigns c on c.id = x.campaign_id
  where x.id = p_creative_id
  for update of x;

  if not found then
    raise exception 'Creative not found' using errcode = 'P0002';
  end if;
  if v_campaign_status in ('archived', 'completed') then
    raise exception 'Campaign is closed' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    if v_status <> 'pending_review' then
      raise exception 'Only pending_review creatives can be approved' using errcode = '22023';
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

revoke all on function public.admin_set_advertiser_status(uuid, text)      from public, anon;
revoke all on function public.admin_set_publisher_status(uuid, text)       from public, anon;
revoke all on function public.admin_review_campaign(uuid, text)            from public, anon;
revoke all on function public.admin_review_creative(uuid, text, text)      from public, anon;
grant execute on function public.admin_set_advertiser_status(uuid, text)   to authenticated;
grant execute on function public.admin_set_publisher_status(uuid, text)    to authenticated;
grant execute on function public.admin_review_campaign(uuid, text)         to authenticated;
grant execute on function public.admin_review_creative(uuid, text, text)   to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS ON + column-level GRANTS
--    Pehle sab hata do (rerun-safe), phir sirf zaroori wapas do.
--    DELETE kisi table par kisi ko nahi (archive status use hota hai).
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.advertisers  enable row level security;
alter table public.publishers   enable row level security;
alter table public.campaigns    enable row level security;
alter table public.ad_creatives enable row level security;

revoke all on table public.profiles, public.advertisers, public.publishers,
                    public.campaigns, public.ad_creatives from anon, authenticated;

-- profiles: padho; sirf display_name badlo. Insert trigger se hota hai.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- advertisers: apna account banao (status hamesha 'pending'); company_name/website_url badlo.
grant select on public.advertisers to authenticated;
grant insert (profile_id, company_name, website_url) on public.advertisers to authenticated;
grant update (company_name, website_url) on public.advertisers to authenticated;

-- publishers: same pattern.
grant select on public.publishers to authenticated;
grant insert (profile_id, name, website_url, category) on public.publishers to authenticated;
grant update (name, website_url, category) on public.publishers to authenticated;

-- campaigns: status guard trigger se bandha hai.
grant select on public.campaigns to authenticated;
grant insert (advertiser_id, name, category, total_budget, daily_budget, start_date, end_date)
  on public.campaigns to authenticated;
grant update (name, category, status, total_budget, daily_budget, start_date, end_date)
  on public.campaigns to authenticated;

-- ad_creatives: review columns (rejection_reason, reviewed_by, reviewed_at) kabhi writable nahi.
grant select on public.ad_creatives to authenticated;
grant insert (campaign_id, headline, body, cta_text, destination_url)
  on public.ad_creatives to authenticated;
grant update (headline, body, cta_text, destination_url, status)
  on public.ad_creatives to authenticated;

-- ---------------------------------------------------------------------
-- 6. POLICIES (sab "to authenticated"; anon ke liye koi policy nahi)
--    (select auth.uid()) / (select private.fn()) => ek baar evaluate, tez.
-- ---------------------------------------------------------------------

-- ===== profiles =====
drop policy if exists profiles_select_own   on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_own   on public.profiles;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select private.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and status = 'active')
  with check (id = (select auth.uid()));

-- ===== advertisers =====
drop policy if exists advertisers_select_own   on public.advertisers;
drop policy if exists advertisers_select_admin on public.advertisers;
drop policy if exists advertisers_insert_own   on public.advertisers;
drop policy if exists advertisers_update_own   on public.advertisers;

create policy advertisers_select_own on public.advertisers
  for select to authenticated
  using (profile_id = (select auth.uid()));

create policy advertisers_select_admin on public.advertisers
  for select to authenticated
  using ((select private.is_admin()));

create policy advertisers_insert_own on public.advertisers
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select private.is_active_profile()));

create policy advertisers_update_own on public.advertisers
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select private.is_active_profile()))
  with check (profile_id = (select auth.uid()));

-- ===== publishers =====
drop policy if exists publishers_select_own   on public.publishers;
drop policy if exists publishers_select_admin on public.publishers;
drop policy if exists publishers_insert_own   on public.publishers;
drop policy if exists publishers_update_own   on public.publishers;

create policy publishers_select_own on public.publishers
  for select to authenticated
  using (profile_id = (select auth.uid()));

create policy publishers_select_admin on public.publishers
  for select to authenticated
  using ((select private.is_admin()));

create policy publishers_insert_own on public.publishers
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and (select private.is_active_profile()));

create policy publishers_update_own on public.publishers
  for update to authenticated
  using (profile_id = (select auth.uid()) and (select private.is_active_profile()))
  with check (profile_id = (select auth.uid()));

-- ===== campaigns =====
drop policy if exists campaigns_select_own   on public.campaigns;
drop policy if exists campaigns_select_admin on public.campaigns;
drop policy if exists campaigns_insert_own   on public.campaigns;
drop policy if exists campaigns_update_own   on public.campaigns;

create policy campaigns_select_own on public.campaigns
  for select to authenticated
  using (advertiser_id = (select private.my_advertiser_id()));

create policy campaigns_select_admin on public.campaigns
  for select to authenticated
  using ((select private.is_admin()));

create policy campaigns_insert_own on public.campaigns
  for insert to authenticated
  with check (advertiser_id = (select private.my_active_advertiser_id()));

create policy campaigns_update_own on public.campaigns
  for update to authenticated
  using (advertiser_id = (select private.my_active_advertiser_id()))
  with check (advertiser_id = (select private.my_active_advertiser_id()));

-- ===== ad_creatives (ownership campaign -> advertiser ke through) =====
drop policy if exists ad_creatives_select_own   on public.ad_creatives;
drop policy if exists ad_creatives_select_admin on public.ad_creatives;
drop policy if exists ad_creatives_insert_own   on public.ad_creatives;
drop policy if exists ad_creatives_update_own   on public.ad_creatives;

create policy ad_creatives_select_own on public.ad_creatives
  for select to authenticated
  using (exists (
    select 1 from public.campaigns c
    where c.id = ad_creatives.campaign_id
      and c.advertiser_id = (select private.my_advertiser_id())
  ));

create policy ad_creatives_select_admin on public.ad_creatives
  for select to authenticated
  using ((select private.is_admin()));

create policy ad_creatives_insert_own on public.ad_creatives
  for insert to authenticated
  with check (exists (
    select 1 from public.campaigns c
    where c.id = ad_creatives.campaign_id
      and c.advertiser_id = (select private.my_active_advertiser_id())
      and c.status not in ('archived', 'completed')
  ));

create policy ad_creatives_update_own on public.ad_creatives
  for update to authenticated
  using (exists (
    select 1 from public.campaigns c
    where c.id = ad_creatives.campaign_id
      and c.advertiser_id = (select private.my_active_advertiser_id())
      and c.status not in ('archived', 'completed')
  ))
  with check (exists (
    select 1 from public.campaigns c
    where c.id = ad_creatives.campaign_id
      and c.advertiser_id = (select private.my_active_advertiser_id())
      and c.status not in ('archived', 'completed')
  ));

commit;
