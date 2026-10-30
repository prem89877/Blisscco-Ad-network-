# Day 3: Security (RLS) review guide

Status: `day-3-6-security-test.sql` tumne Supabase me chalaya aur successfully pass hua (tumhari report; maine khud SQL nahi chalaya).
Baaki bhi tumne chalaye, sab successfully: `day-4-2`, `day-4-4`, `day-4-5`, `day-5-5` (M1-M27).

## Chalane se pehle review (Android)
1. `supabase/sql/day-3-5-security.sql` poori padho (GitHub/Spck me). Dhyan do: `grant` lines, `with check`, `using` lines.
2. Test project/test data par hi pehle chalao. Real users abhi nahi hain toh abhi sabse safe time hai.
3. Supabase > SQL Editor me poori file paste karke Run. File `begin ... commit` me hai.
4. Error aaye toh error text bhejo. Aadha apply hone ka dar nahi: file dobara chalane par safe hai.
5. Phir Dashboard > Database > Tables me 5 tables par "RLS enabled" dekho, aur Advisors > Security Advisor me warnings dekho.
6. Phir `day-3-6-security-test.sql` ke tests chalao (test users ke saath).

## 4 layers
1. Column GRANTs: role/status/review columns user ko kabhi writable nahi. DELETE kisi ko nahi.
2. RLS policies: row ownership.
3. Triggers: status workflow (RLS purani+nayi row compare nahi kar sakta).
4. Admin functions: approvals sirf `admin_*` functions se, andar `is_admin()` check.

## Policies (sab sirf `authenticated`; `anon` ke liye koi policy/grant nahi)
| Table | Policy | Operation | Kaun / kab |
|---|---|---|---|
| profiles | profiles_select_own | SELECT | sirf apni row |
| profiles | profiles_select_admin | SELECT | admin sab |
| profiles | profiles_update_own | UPDATE | apni active row; column grant ki wajah se sirf display_name |
| advertisers | advertisers_select_own | SELECT | apna advertiser account |
| advertisers | advertisers_select_admin | SELECT | admin |
| advertisers | advertisers_insert_own | INSERT | apne profile_id par, active profile; status hamesha pending |
| advertisers | advertisers_update_own | UPDATE | apna account; sirf company_name, website_url |
| publishers | publishers_select_own / _select_admin | SELECT | owner / admin |
| publishers | publishers_insert_own | INSERT | apne profile_id par; status pending |
| publishers | publishers_update_own | UPDATE | sirf name, website_url, category |
| campaigns | campaigns_select_own / _select_admin | SELECT | apne advertiser ke campaigns / admin |
| campaigns | campaigns_insert_own | INSERT | sirf approved (active) advertiser; status draft |
| campaigns | campaigns_update_own | UPDATE | sirf active advertiser, apne campaigns; status trigger se bandha |
| ad_creatives | ad_creatives_select_own / _select_admin | SELECT | apne campaign ke creatives / admin |
| ad_creatives | ad_creatives_insert_own | INSERT | apne open campaign me, status draft |
| ad_creatives | ad_creatives_update_own | UPDATE | apne open campaign ke creatives; review columns nahi |

DELETE ki policy kahin nahi: records archive hote hain (status = archived).

## Workflow (triggers)
- Campaign: advertiser sirf draft -> pending_review, wapas draft, rejected -> draft, active <-> paused, aur archive kar sakta hai.
  `active` banana sirf admin approval se. Category sirf draft/rejected me badal sakti hai.
- Creative: draft -> pending_review. Approved/paused/rejected creative ka text ya URL badalte hi wo draft ho jata hai (dobara review).
  Review ke dauran edit nahi.
- Admin: `admin_review_creative`, `admin_review_campaign` (approve ke liye kam se kam ek approved creative), `admin_set_advertiser_status`, `admin_set_publisher_status`.

## Admin role
User khud admin nahi ban sakta. Pehla admin SQL Editor se:
`update public.profiles set role = 'admin' where id = 'USER-UUID';`
(Is ke liye profile par advertiser/publisher row nahi honi chahiye.)

## Abhi kya cover nahi hai
- Publisher "integration settings" ki table abhi exist nahi karti. Jab banegi (API keys), key sirf hash me, aur browser ko select ka haq nahi.
- Ads dikhane/tracking (impressions, clicks) ki tables baad ke stage me, server-side se.
- Service-role key sirf server par. Browser ya `NEXT_PUBLIC_` me kabhi nahi. Ye SQL service-role ke bina chalta hai.
