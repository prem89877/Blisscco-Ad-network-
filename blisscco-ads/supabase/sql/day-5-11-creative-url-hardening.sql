-- =====================================================================
-- BLISSCCO | Day 5 | Part 11 : creative destination URL me userinfo ("user@host") band
-- Pehle day-3-4 ka CHECK sirf "https://" + bina space + max 2048 dekhta tha. Isliye
--   https://trusted-site.com@evil.example/page
-- paas ho jata tha: browser asli host evil.example par jaata hai (phishing ka purana tareeka).
-- Ab naye/badle hue creatives par ye reject hota hai. "@" path ya query me allowed hai (https://example.com/a@b).
--
-- Dobara chalane par safe hai. Koi data delete/badla nahi jaata.
-- Constraint NOT VALID hai: purani rows ko turant nahi todta; naye insert/update par lagu. Purani rows ki jaanch
-- STEP 2 me, validate STEP 3 me (alag chalao).
-- TypeScript side (lib/ads/category-matching.ts) wahi check pehle se lagata hai: purani kharab row bhi publisher tak nahi jaati.
-- =====================================================================

-- STEP 1 (constraint lagao)
begin;
alter table public.ad_creatives drop constraint if exists ad_creatives_destination_url_no_userinfo_check;
alter table public.ad_creatives add constraint ad_creatives_destination_url_no_userinfo_check
  check (destination_url !~* '^https://[^/?#]*@') not valid;
commit;

-- STEP 2 (purani rows ki jaanch, sirf padhta hai). Expect: 0 rows.
-- Agar rows aayein: un creatives ka URL Dashboard/SQL se theek karo (ya creative reject/archive karo), phir STEP 3.
select id, status, left(destination_url, 60) as url_start
from public.ad_creatives
where destination_url ~* '^https://[^/?#]*@';

-- STEP 3 (validate; STEP 2 me 0 rows aayein tabhi). Agar ERROR aaye toh constraint NOT VALID hi rehta hai aur naye data par lagu rehta hai.
alter table public.ad_creatives validate constraint ad_creatives_destination_url_no_userinfo_check;

-- Check (Expect: 1 row, convalidated = true STEP 3 ke baad):
--   select conname, convalidated from pg_constraint where conname = 'ad_creatives_destination_url_no_userinfo_check';
