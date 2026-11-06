-- =====================================================================
-- BLISSCCO | Phase 4 | Step 3B | Part 1 : public.get_creative_rich_assets (sirf PADHNE wala function)
--
-- TEST PROJECT PAR HI CHALAO. Production par kabhi nahi (owner ke likhit faisle ke bina).
-- Pehle chalna chahiye: phase4-step3-1 (brand_name / logo_path / banner_path columns + private bucket).
--
-- Kya karta hai: ek creative ka brand naam aur image paths deta hai, SIRF tab jab
--   creative = approved, campaign = active, advertiser = active, advertiser profile = active.
-- Warna {"outcome":"not_found"} (wajah nahi batata: pending / rejected / paused / archived sab ek jaise).
-- Match API (rich fields banane ke liye) aur /api/v1/ads/asset/[id] proxy, dono isi ko bulate hain.
--
-- Security:
--  * READ-ONLY (language sql, stable): koi insert/update/delete nahi, koi counter, spend, serve, ledger ya payout nahi.
--  * SECURITY DEFINER + search_path = '' ; har object schema-qualified.
--  * Execute SIRF service_role ko. anon / authenticated / public ko nahi.
--  * Bucket private hi rehta hai; storage policies ko haath nahi lagaya. Existing RLS / functions / trigger unchanged.
--  * advertiser_id / campaign_id server-side path-ownership check ke liye hain; publisher ko kabhi nahi jaate.
-- Rerun-safe (create or replace).
-- =====================================================================

create or replace function public.get_creative_rich_assets(p_creative_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'outcome',       'ok',
        'advertiser_id', c.advertiser_id,
        'campaign_id',   c.id,
        'brand_name',    x.brand_name,
        'logo_path',     x.logo_path,
        'banner_path',   x.banner_path
      )
      from public.ad_creatives x
      join public.campaigns   c  on c.id  = x.campaign_id
      join public.advertisers a  on a.id  = c.advertiser_id
      join public.profiles    ap on ap.id = a.profile_id
      where p_creative_id is not null
        and x.id = p_creative_id
        and x.status  = 'approved'
        and c.status  = 'active'
        and a.status  = 'active'
        and ap.status = 'active'
    ),
    jsonb_build_object('outcome', 'not_found')
  )
$$;

comment on function public.get_creative_rich_assets(uuid) is
  'Read-only: brand name + image paths of ONE creative, only if approved + active campaign + active advertiser. Execute: service_role only.';

revoke all on function public.get_creative_rich_assets(uuid) from public, anon, authenticated;
grant execute on function public.get_creative_rich_assets(uuid) to service_role;

-- Check R1 (Expect: 1 row, security_definer = true)
--   select proname, prosecdef as security_definer from pg_proc
--   where proname = 'get_creative_rich_assets' and pronamespace = 'public'::regnamespace;
-- Check R2 (Expect: sirf service_role aur postgres)
--   select grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'get_creative_rich_assets' order by grantee;
-- Check R3 (Expect: private bucket => public = false)
--   select id, public from storage.buckets where id = 'creative-assets';
-- Check R4 (TEST data par, ek approved + active creative ka id daalo. Expect: outcome ok)
--   select public.get_creative_rich_assets('<approved-active-creative-id>'::uuid);
-- Check R5 (ek pending / rejected / paused creative ka id. Expect: {"outcome": "not_found"})
--   select public.get_creative_rich_assets('<pending-creative-id>'::uuid);
