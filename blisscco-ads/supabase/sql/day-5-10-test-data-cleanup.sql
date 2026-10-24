-- =====================================================================
-- BLISSCCO | Day 5 | Part 10 : TEST data ka cleanup (Day 3-6 SETUP + Day 5 serve tests ke baad)
-- Kyun: day-3-6 ka purana CLEANUP block sirf creatives/campaigns/advertisers/publishers delete karta hai.
-- Day 5 ke tables (ad_serve_log, creative_serve_daily, campaign_spend_daily, publisher_api_keys) in par
-- "on delete restrict" foreign key se bandhe hain, isliye unki rows rehne par wo purana CLEANUP ERROR dega.
-- Ye file wahi cleanup sahi order me karti hai. Sirf EXACT TEST advertisers/publishers (aur unke apne campaigns/creatives) par kaam karti hai; asli data nahi chhuti.
--
-- Sirf test project par chalao. Har BLOCK alag chalao (editor saaf karke ek block paste karo).
-- Is file se auth.users (5 test users) delete NAHI hote: wo Dashboard > Authentication > Users se hatao.
-- =====================================================================


-- ===================== BLOCK 1: PEHLE DEKHO (sirf padhta hai, kuch nahi badalta) =====================
-- Expect: har count TEST data ka hai. Agar koi count ajeeb lage, ruko aur BLOCK 3 mat chalao.
select
  (select count(*) from public.campaigns c join public.advertisers a on a.id = c.advertiser_id
     where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B')) as test_campaigns,
  (select count(*) from public.ad_creatives x join public.campaigns c on c.id = x.campaign_id
     join public.advertisers a on a.id = c.advertiser_id
     where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B')) as test_creatives,
  (select count(*) from public.ad_serve_log) as all_serve_log_rows,
  (select count(*) from public.publisher_api_keys
     where publisher_id in (select id from public.publishers where name in ('TEST Publisher C', 'TEST Publisher D'))) as test_key_rows;


-- ===================== BLOCK 2: TEST advertisers ke saare campaigns dikhao (sirf padhta hai) =====================
-- Expect: TEST Campaign A aur B, aur shayad kuch aur campaigns (Day 4 ke tests/app se bane). Ye sab TEST advertisers ke hain.
-- Agar koi campaign asli lage (asli naam/asli advertiser), BLOCK 3 mat chalao aur mujhe bhejo.
select c.id, c.name, c.status, a.company_name,
       (select count(*) from public.ad_creatives x where x.campaign_id = c.id) as creatives
from public.campaigns c join public.advertisers a on a.id = c.advertiser_id
where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B')
order by a.company_name, c.name;


-- ===================== BLOCK 3: CLEANUP (postgres role, ek transaction) =====================
-- Order zaroori hai: pehle bachhe (log, daily, spend, keys), phir creatives, campaigns, advertisers, publishers.
-- Campaigns/creatives naam se nahi, TEST advertiser ki ownership se chune jaate hain (naam alag ho tab bhi).
-- api_rate_limits keys ke saath apne aap hat jaati hai (on delete cascade).
-- Expect: koi ERROR nahi. Phir BLOCK 1 dobara chalao: test_campaigns = 0, test_creatives = 0, test_key_rows = 0.
begin;

delete from public.ad_serve_log
 where creative_id in (select x.id from public.ad_creatives x join public.campaigns c on c.id = x.campaign_id
                         join public.advertisers a on a.id = c.advertiser_id
                         where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B'))
    or campaign_id in (select c.id from public.campaigns c join public.advertisers a on a.id = c.advertiser_id
                         where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B'))
    or publisher_id in (select id from public.publishers where name in ('TEST Publisher C', 'TEST Publisher D'));

delete from public.creative_serve_daily
 where creative_id in (select x.id from public.ad_creatives x join public.campaigns c on c.id = x.campaign_id
                         join public.advertisers a on a.id = c.advertiser_id
                         where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B'))
    or campaign_id in (select c.id from public.campaigns c join public.advertisers a on a.id = c.advertiser_id
                         where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B'));

delete from public.campaign_spend_daily
 where campaign_id in (select c.id from public.campaigns c join public.advertisers a on a.id = c.advertiser_id
                         where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B'));

delete from public.publisher_api_keys
 where publisher_id in (select id from public.publishers where name in ('TEST Publisher C', 'TEST Publisher D'));

delete from public.ad_creatives
 where campaign_id in (select c.id from public.campaigns c join public.advertisers a on a.id = c.advertiser_id
                         where a.company_name in ('TEST Advertiser A', 'TEST Advertiser B'));
delete from public.campaigns
 where advertiser_id in (select id from public.advertisers where company_name in ('TEST Advertiser A', 'TEST Advertiser B'));
delete from public.advertisers where company_name in ('TEST Advertiser A', 'TEST Advertiser B');
delete from public.publishers  where name in ('TEST Publisher C', 'TEST Publisher D');

commit;
-- Phir Authentication > Users se 5 users (janvi01506, sanjaytalekar740, delieveryboy09, muskelon2266, premtalekar09 @gmail.com) delete karo.
