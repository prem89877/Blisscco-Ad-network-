-- =====================================================================
-- BLISSCCO | Phase 4 | Step 3 | Part 1 : advertiser creative submission
-- (brand name, logo, banner, keywords) + private image bucket + ownership policies.
--
-- TEST PROJECT PAR HI CHALAO. Production par kabhi nahi (owner ke likhit faisle ke bina).
-- Pehle chalne chahiye: day-3-4, day-3-5 (guard + grants), day-5-11.
--
-- Kya badalta hai (sirf zaroori):
--  1. ad_creatives me 4 naye NULLABLE columns: brand_name, logo_path, banner_path, keywords.
--     Purane creatives aur purana "Add an ad" form bina badlaav chalte hain (columns NULL).
--  2. Private storage bucket "creative-assets" (public = false, 2 MB, sirf png/jpeg/webp).
--  3. storage.objects policies: advertiser sirf apne advertiser/campaign folder me upload kare,
--     sirf apne folder ki images dekhe; admin review ke liye sab dekh sake. Publisher/anon ko kuch nahi.
--  4. Column GRANTS naye columns ke liye (review columns phir bhi kabhi writable nahi).
--  5. guard_creative_changes() dobara define: purana poora logic SAME + naye columns "content" maane jate hain
--     (approved ad ki image badalne par dobara review zaroori) + image path apne advertiser/campaign ka ho.
--
-- Kya NAHI badalta: ad matching, serve/impression/click/ledger functions, publisher API, RLS policies
-- of existing tables, admin_review_creative(). Keywords sirf review ke liye hain, matching me use nahi hote.
-- Images publisher API ko nahi jaatin (API contract wahi: 5 text fields).
--
-- Rerun rule: ye file rerun-safe hai. Par day-3-5 DOBARA chalane se guard_creative_changes() purana ho jata hai;
-- tab is file ko phir chalao.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Naye columns (NULLABLE) + CHECKs
-- ---------------------------------------------------------------------
alter table public.ad_creatives
  add column if not exists brand_name  text,
  add column if not exists logo_path   text,
  add column if not exists banner_path text,
  add column if not exists keywords    text;

comment on column public.ad_creatives.brand_name  is 'Advertiser ka brand / business naam jo ad me dikhna hai (review ke liye).';
comment on column public.ad_creatives.logo_path   is 'Private bucket creative-assets me logo ka path: <advertiser_id>/<campaign_id>/logo-<uuid>.<ext>';
comment on column public.ad_creatives.banner_path is 'Private bucket creative-assets me banner ka path: <advertiser_id>/<campaign_id>/banner-<uuid>.<ext>';
comment on column public.ad_creatives.keywords    is 'Advertiser ke diye keywords (comma se alag). SIRF review ke liye; ad matching me use nahi hote.';

alter table public.ad_creatives drop constraint if exists ad_creatives_brand_name_check;
alter table public.ad_creatives add constraint ad_creatives_brand_name_check
  check (brand_name is null or char_length(btrim(brand_name)) between 1 and 80);

alter table public.ad_creatives drop constraint if exists ad_creatives_logo_path_check;
alter table public.ad_creatives add constraint ad_creatives_logo_path_check
  check (logo_path is null or logo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$');

alter table public.ad_creatives drop constraint if exists ad_creatives_banner_path_check;
alter table public.ad_creatives add constraint ad_creatives_banner_path_check
  check (banner_path is null or banner_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/banner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$');

alter table public.ad_creatives drop constraint if exists ad_creatives_keywords_check;
alter table public.ad_creatives add constraint ad_creatives_keywords_check
  check (keywords is null or char_length(keywords) <= 200);

-- ---------------------------------------------------------------------
-- 2. Column grants: naye content columns advertiser likh sakta hai.
--    rejection_reason / reviewed_by / reviewed_at ab bhi kabhi writable nahi.
-- ---------------------------------------------------------------------
grant insert (campaign_id, headline, body, cta_text, destination_url, brand_name, logo_path, banner_path, keywords)
  on public.ad_creatives to authenticated;
grant update (headline, body, cta_text, destination_url, status, brand_name, logo_path, banner_path, keywords)
  on public.ad_creatives to authenticated;

-- ---------------------------------------------------------------------
-- 3. guard_creative_changes(): day-3-5 ka logic SAME, sirf do jod:
--    (a) content_changed me naye columns (approved/paused/rejected ad ki image ya brand badle => status draft, review dobara)
--    (b) image path apne advertiser aur isi campaign ka ho (API users par; SQL Editor / service_role par nahi lagta)
-- ---------------------------------------------------------------------
create or replace function private.guard_creative_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
  v_advertiser    text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Image path ownership: <advertiser_id>/<campaign_id>/... apne hi advertiser aur is campaign ka.
  if new.logo_path is not null or new.banner_path is not null then
    select c.advertiser_id::text into v_advertiser from public.campaigns c where c.id = new.campaign_id;
    if v_advertiser is null
       or (new.logo_path is not null
           and (split_part(new.logo_path, '/', 1) <> v_advertiser or split_part(new.logo_path, '/', 2) <> new.campaign_id::text))
       or (new.banner_path is not null
           and (split_part(new.banner_path, '/', 1) <> v_advertiser or split_part(new.banner_path, '/', 2) <> new.campaign_id::text)) then
      raise exception 'Image path does not belong to this advertiser and campaign' using errcode = '42501';
    end if;
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

  content_changed := (new.headline, new.body, new.cta_text, new.destination_url,
                      new.brand_name, new.logo_path, new.banner_path, new.keywords)
                     is distinct from
                     (old.headline, old.body, old.cta_text, old.destination_url,
                      old.brand_name, old.logo_path, old.banner_path, old.keywords);

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

revoke all on function private.guard_creative_changes() from public, anon, authenticated;

drop trigger if exists ad_creatives_guard_changes on public.ad_creatives;
create trigger ad_creatives_guard_changes
  before insert or update on public.ad_creatives
  for each row execute function private.guard_creative_changes();

-- ---------------------------------------------------------------------
-- 4. Private storage bucket (public = false: koi public URL nahi; dikhane ke liye signed URL, server se)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creative-assets', 'creative-assets', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- ---------------------------------------------------------------------
-- 5. storage.objects policies (sirf is bucket ke liye). anon ke liye koi policy nahi.
--    Path: <advertiser_id>/<campaign_id>/<logo|banner>-<uuid>.<ext>
-- ---------------------------------------------------------------------
drop policy if exists creative_assets_insert_own   on storage.objects;
drop policy if exists creative_assets_select_own   on storage.objects;
drop policy if exists creative_assets_select_admin on storage.objects;
drop policy if exists creative_assets_delete_own   on storage.objects;

-- Upload: active advertiser, apne advertiser folder me, apne (band na hue) campaign ke folder me.
create policy creative_assets_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'creative-assets'
    and (storage.foldername(name))[1] = (select private.my_active_advertiser_id())::text
    and exists (
      select 1 from public.campaigns c
      where c.id::text = (storage.foldername(name))[2]
        and c.advertiser_id = (select private.my_active_advertiser_id())
        and c.status not in ('archived', 'completed')
    )
  );

-- Dekhna: advertiser sirf apne folder ki images.
create policy creative_assets_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'creative-assets'
    and (storage.foldername(name))[1] = (select private.my_advertiser_id())::text
  );

-- Admin review ke liye sab images dekh sakta hai.
create policy creative_assets_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'creative-assets' and (select private.is_admin()));

-- Hatana: sirf apne folder ki (failed submit ka bacha hua / badli hui purani image saaf karne ke liye).
create policy creative_assets_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'creative-assets'
    and (storage.foldername(name))[1] = (select private.my_active_advertiser_id())::text
  );

commit;

-- =====================================================================
-- CHECKS (sirf padhte hain). Chalane ke baad ek ek karke dekho:
--
-- C1. Naye columns (Expect: 4 rows, sab is_nullable = YES):
--   select column_name, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'ad_creatives'
--     and column_name in ('brand_name', 'logo_path', 'banner_path', 'keywords') order by column_name;
--
-- C2. Bucket private hai (Expect: 1 row, public = false, file_size_limit = 2097152):
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'creative-assets';
--
-- C3. Policies (Expect: 4 rows, sab roles = {authenticated}):
--   select policyname, cmd, roles from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname like 'creative_assets_%' order by policyname;
--
-- C4. Guard naya hai (Expect: true, true):
--   select pg_get_functiondef('private.guard_creative_changes()'::regprocedure) like '%banner_path%' as has_assets,
--          pg_get_functiondef('private.guard_creative_changes()'::regprocedure) like '%Image path does not belong%' as has_ownership;
--
-- C5. Review columns abhi bhi advertiser ke liye writable nahi (Expect: 0 rows):
--   select column_name from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'ad_creatives' and grantee = 'authenticated'
--     and privilege_type in ('INSERT', 'UPDATE') and column_name in ('rejection_reason', 'reviewed_by', 'reviewed_at');
-- =====================================================================
