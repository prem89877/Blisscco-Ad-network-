> UPDATE: final steps, saare tests, commit aur Vercel checklist ke liye `DAY4-FINAL-REVIEW.md` dekho (ye file sirf shuruaati hissa hai).

# Day 4: Real campaign management (setup + testing)

## Kya naya hai
- `/dashboard/advertiser/campaigns` : apne campaigns ki list
- `/dashboard/advertiser/campaigns/new` : naya campaign (draft)
- `/dashboard/advertiser/campaigns/<id>` : details, Pause / Resume
- `/dashboard/advertiser/campaigns/<id>/edit` : edit
- Purani demo pages (landing, Overview, Advertiser demo workspace, Campaigns demo) jaisi thi waisi hain.
- Advertiser page par ek "Manage my campaigns" link jodi gayi hai.

## Faisle (aapne chune)
1. Signup par advertiser auto-active (DB trigger + backfill).
2. Active/paused campaign me full edit (sirf category draft/rejected me badalti hai, ye DB ka purana niyam hai).
3. Start date: naye campaign me kal (UTC) se pehle ki date nahi; edit me purani start date waise hi rakh sakte ho.
4. DB guards: resume ke liye approved creative + end_date guzri na ho; max 50 non-archived campaigns.

## DEPLOY ORDER (zaroori)
1. Supabase SQL Editor: `supabase/sql/day-4-1-campaign-guards.sql` chalao (pehle Day 3 ke parts chalne chahiye).
   Check: `select p.id from public.profiles p where p.role='advertiser' and not exists (select 1 from public.advertisers a where a.profile_id=p.id);` => 0 rows.
2. Phir zip ki files project me usi path par rakho, commit + push, Vercel Ready hone do.
3. (Agar Day 3 ke test users the) `day-3-6-security-test.sql` ka SETUP naya hai: dobara chalana ho toh pehle CLEANUP chalao.

## Testing checklist
SQL (SQL Editor, block by block): `day-4-2-campaign-tests.sql` Tests 1-13. Expected result har block ke comment me hai.

App (Android Chrome, advertiser account se):
- [ ] Naya email signup (advertiser) ya Google login => login ke baad `/dashboard/advertiser/campaigns` khulta hai, "No campaigns yet".
- [ ] New campaign: khali form submit => field errors dikhte hain; sahi values => detail page "Campaign created as a draft."
- [ ] Budget "abc", "-5", "10.999" aur daily > total => helpful error.
- [ ] End date < start date => error. Start date kal se pehle => error.
- [ ] Edit: naam/budget badalo => "Changes saved." Category draft me badalti hai.
- [ ] Do accounts: A ka campaign link (URL) B ke login me kholo => 404 (page not found).
- [ ] Publisher account se `/dashboard/advertiser/campaigns` => `/dashboard` par wapas.
- [ ] Logout ke baad campaigns URL => `/login`.
- [ ] Pause/Resume: SQL se ek campaign ko active karo (day-4-2 Test 8 jaisa: approved creative + `update campaigns set status='active'` as postgres), phir app me Pause => "Campaign paused.", Resume => "Campaign resumed."
- [ ] Bina approved creative ke Resume => "cannot be resumed until it has at least one approved creative."
- [ ] Mobile (360px): form aur list me horizontal scroll nahi, buttons 44px.

## Verified vs manual
- Verified (is environment me): files ka TypeScript syntax parse hota hai.
- Tested (tumhari report): SQL tests `day-4-2`, `day-4-4`, `day-4-5` Supabase me chalaye, sab successfully pass.
- NAHI chala: `npm install`, type-check, `next build`, app/browser tests (internet nahi). Vercel build aur upar ka checklist aapko chalana hai.
