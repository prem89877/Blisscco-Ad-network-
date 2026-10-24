-- =====================================================================
-- BLISSCCO | Day 5 | Part 7 : load_ad_candidates ke SQL tests
-- Ye tests tab tak "pass" nahi maane jaate jab tak tumne khud run karke expected result na dekha ho.
-- (Maine ye SQL kisi database par nahi chalaya: sandbox me Postgres nahi hai.)
--
-- Pehle: day-5-1 se day-5-4 aur day-5-6 chali hon, aur day-3-6 ka SETUP block chala ho
-- (TEST Campaign A, TEST creative A, ...). Har TEST block ALAG se chalao (editor saaf karke ek block paste karo).
-- Har block begin...rollback me hai, kuch save nahi hota. "ERROR" L9 me EXPECTED hai.
-- Sirf test project par chalao. Poori file ek saath RUN mat karna.
--
-- Har block ka PREP: TEST Campaign A ko gaming + active, TEST creative A ko approved karta hai
-- (aur start_date/end_date ko khula karta hai), phir function service_role ki tarah chalta hai.
-- =====================================================================


-- ===================== L1 (permitted): active campaign + approved creative milta hai =====================
-- Expect: 1 ya zyada row; ek row me headline = TEST creative A, campaign_status = active, creative_status = approved
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select creative_id, headline, creative_status, campaign_status, category from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date);
rollback;


-- ===================== L2 (excluded): paused campaign =====================
-- Expect: TEST creative A wali row NAHI aani chahiye (0 rows agar koi aur gaming campaign nahi)
begin;
update public.campaigns set category = 'gaming', status = 'paused', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select creative_id, headline from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date) where headline = 'TEST creative A';
rollback;


-- ===================== L3 (excluded): expired campaign (end_date kal) =====================
-- Expect: 0 rows
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 10, end_date = current_date - 1 where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select creative_id, headline from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date) where headline = 'TEST creative A';
rollback;


-- ===================== L4 (excluded): future-dated campaign (start_date kal) =====================
-- Expect: 0 rows
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date + 1, end_date = current_date + 5 where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select creative_id, headline from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date) where headline = 'TEST creative A';
rollback;


-- ===================== L5 (excluded): creative approved nahi (pending_review) =====================
-- Expect: 0 rows
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'pending_review' where headline = 'TEST creative A';
set local role service_role;
select creative_id, headline from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date) where headline = 'TEST creative A';
rollback;


-- ===================== L6 (no result): galat / sensitive / inactive / bura-format category =====================
-- Expect: 4 ke 4 count = 0 (technology me campaign gaming hai; health taxonomy me nahi; beauty inactive; 'GAMING' format galat)
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select
  (select count(*) from public.load_ad_candidates('technology', (now() at time zone 'utc')::date) where headline = 'TEST creative A') as technology,
  (select count(*) from public.load_ad_candidates('health',     (now() at time zone 'utc')::date)) as health,
  (select count(*) from public.load_ad_candidates('beauty',     (now() at time zone 'utc')::date)) as beauty,
  (select count(*) from public.load_ad_candidates('GAMING',     (now() at time zone 'utc')::date)) as bad_format;
rollback;


-- ===================== L7 (permitted): kharch aur serve counts sahi jode jaate hain =====================
-- Expect: spent_total = 1.7500, spent_today = 0.2500, campaign_serves_today = 3, creative_serves_today = 3
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
-- Is campaign ki pehle se maujood spend/serve rows (asli serve ya purane test) isi transaction me hatao,
-- taaki neeche ke numbers pakke rahein. Rollback par sab wapas aa jaata hai.
delete from public.campaign_spend_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
delete from public.creative_serve_daily where campaign_id = (select id from public.campaigns where name = 'TEST Campaign A');
insert into public.campaign_spend_daily (campaign_id, day, spent)
  select id, (now() at time zone 'utc')::date - 1, 1.5 from public.campaigns where name = 'TEST Campaign A';
insert into public.campaign_spend_daily (campaign_id, day, spent)
  select id, (now() at time zone 'utc')::date, 0.25 from public.campaigns where name = 'TEST Campaign A';
insert into public.creative_serve_daily (creative_id, campaign_id, day, serves)
  select x.id, x.campaign_id, (now() at time zone 'utc')::date, 3 from public.ad_creatives x where x.headline = 'TEST creative A';
set local role service_role;
select spent_total, spent_today, campaign_serves_today, creative_serves_today
from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date) where headline = 'TEST creative A';
rollback;


-- ===================== L8 (no result): p_today UTC aaj se bahut door =====================
-- Expect: count = 0 dono (aaj + 30 din, aaj - 30 din)
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 60, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select
  (select count(*) from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date + 30)) as far_future,
  (select count(*) from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date - 30)) as far_past;
rollback;


-- ===================== L9 (forbidden): anon / authenticated function chala hi nahi sakte =====================
-- Expect: ERROR permission denied for function load_ad_candidates (dono block alag chalao)
begin;
set local role authenticated;
select * from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date);
rollback;

begin;
set local role anon;
select * from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date);
rollback;


-- ===================== L10 (privacy): sirf 19 columns, advertiser ka naam/email/profile id nahi =====================
-- Expect: exactly ye 19 naam: advertiser_profile_status, advertiser_status, body, campaign_id, campaign_serves_today,
-- campaign_status, category, creative_id, creative_serves_today, creative_status, cta_text, daily_budget, destination_url,
-- end_date, headline, spent_today, spent_total, start_date, total_budget. (company_name, email, profile_id jaisa kuch nahi)
begin;
update public.campaigns set category = 'gaming', status = 'active', start_date = current_date - 5, end_date = null where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select col from (
  select jsonb_object_keys(to_jsonb(r)) as col
  from (select * from public.load_ad_candidates('gaming', (now() at time zone 'utc')::date) limit 1) r
) k order by col;
rollback;
