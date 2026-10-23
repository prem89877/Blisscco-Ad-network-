# Day 4 FINAL REVIEW: campaign management

Ye file DAY4-CAMPAIGNS-SETUP.md ki jagah final guide hai (usme sirf Day 4 ke pehle hisse ke steps hain).

## 1. Is review me kya CHALA aur kya NAHI (sach-sach)

Chala (is environment me, asli result):
- 93 TypeScript/TSX files ka syntax parse: 0 syntax errors.
- 231 local imports ka static check (har import ki file maujood hai, har named/default export maujood hai): 0 problems.
- "use server" files (actions.ts) me sirf async exports: OK.
- Logic ke unit tests (validation, filters, run-state, errors, redirect safety, formatting): 67 passed, 0 failed.
  Isme budget ("0", "-5", "NaN", "Infinity", "1e5", "10.999" ...), dates (Feb 30, end < start, past start),
  invalid category, ownership fields form se na aana, pause/resume eligibility, DB error text leak na hona shamil hain.
- Security greps: service-role/secret key client code me nahi, client components server-only modules import nahi karte.
- SQL migrations ka padhna: koi DROP TABLE / TRUNCATE / DELETE nahi.

NAHI chala (environment me internet nahi, npm install timeout ho gaya, exit 124):
- `npm install`, `npm run lint` (= tsc --noEmit), `next build`.
- Koi bhi SQL test (Supabase access nahi), koi bhi app/browser test, mobile screen test.
=> In sab ko Vercel build aur neeche ke checklist se tumhe chalana hai. Jab tak tum chalake dekh na lo, inhe "pass" mat maanna.

## 2. Security review ke nateeje
- Server authorization: har page `requireRole(["advertiser"])`, har action `requireActiveAdvertiser()` (role + advertiser row + status DB se).
- Advertiser id kabhi form/URL se nahi: `getMyAdvertiser()` session ke user.id se DB me dhoondta hai.
- RLS: campaigns par select/insert/update policies `my_advertiser_id()` / `my_active_advertiser_id()` se. DELETE ka na policy na grant.
- Column grants: insert me (advertiser_id, name, category, total_budget, daily_budget, start_date, end_date, description),
  update me (name, category, status, budgets, dates, description). currency/id/advertiser_id badle nahi ja sakte (trigger + grant).
- Status transitions DB trigger me (draft/pending_review/active/paused/...); resume par approved creative + end_date guard.
- Service-role key: `lib/supabase/admin.ts` kahin import nahi hota; env.ts secret key galti se public var me ho toh error deta hai.
- Errors: user ko sirf friendly text; server log me sirf error code/hint (message/details nahi). Unexpected error par error.tsx sirf reference code dikhata hai.
- Open redirect: safeNextPath sirf /dashboard ke andar ke paths allow karta hai (tested).
- Migrations: sab `if not exists` / `create or replace`, koi destructive step nahi.
- Dhyan: agar kabhi `day-3-5-security.sql` dobara chalao, wo grants reset karti hai aur guard function purana kar deti hai.
  Tab `day-4-1-campaign-guards.sql` aur `day-4-3-campaign-description.sql` dobara chalana zaroori hai.

## 3. Is review ke fixes (4 files + ye doc)
- Database error ko ab "Campaign not found" nahi dikhaya jata: pages error screen (Try again) dikhate hain, actions "Something went wrong".
  (lib/campaigns/queries.ts, actions.ts, [id]/page.tsx, [id]/edit/page.tsx)
- Lambe campaign naam mobile par screen se bahar nahi jaate (break-words). (list page, details, edit)

## 4. DEPLOY ORDER (ek baar, sahi order me)
1. Supabase SQL Editor me, is order me (jo pehle chal chuki hon unhe dobara chalana safe hai):
   day-3-1 ... day-3-5 (pehle se chali honi chahiye), phir
   `day-4-1-campaign-guards.sql`, phir `day-4-3-campaign-description.sql`.
2. Check queries (day-4-3 ke neeche likhi) chalao: 1 row / 1 row / 2 rows.
3. Code push karo (section 6), Vercel Ready hone do.
4. Tests (section 5) chalao.

## 5. FULL TESTING (kuch change na karna ho toh bhi ye karo)

### 5a. SQL tests (Supabase SQL Editor, test project par)
Tayyari: Dashboard > Authentication > Users > Add user (auto confirm ON): blisscco-test-a@example.com aur blisscco-test-b@example.com
(+ day-3-6 ke baaki users agar day-3-6 ke saare tests chalane hain). Phir `day-3-6-security-test.sql` ka sirf SETUP block chalao.
Har TEST block ALAG se chalao. Sab begin...rollback me hain.
- [ ] day-4-2-campaign-tests.sql: Test 1 to 13 (expected har block ke upar likha hai)
- [ ] day-4-4-edit-tests.sql: E1, E2, E3, E4, E5, E6, E7, E8a-d, E9, E10
- [ ] day-4-5-runstate-tests.sql: R1 to R9
Sab ke baad (agar chaho) day-3-6 ka CLEANUP block chalao.

### 5b. App tests (Android Chrome, 2 advertiser accounts: A aur B; naye email se signup)
Create:
- [ ] A: New campaign, khali form submit => har required field par error.
- [ ] Budget `0`, `-5`, `abc`, `Infinity`, `1e5`, `10.999` => error. Daily > total => error.
- [ ] End date < start date => error. Start date 2+ din pehle => error.
- [ ] Sahi values + description => detail page "Campaign created as a draft.", status Draft.
- [ ] Description 1001+ characters => error.
List:
- [ ] A ki list me sirf A ke campaigns. Search, status filter, category filter chalte hain. "Clear filters" kaam karta hai.
- [ ] B ki list me A ka campaign nahi. B ke login se A ka campaign URL => "Campaign not found". A ka edit URL => "Campaign not found".
- [ ] URL me `?advertiser_id=<A ki id>` jodne par B ko A ka data nahi dikhta.
Details / Edit:
- [ ] Details me saare fields dikhte hain (description, category, budget, dates, created/updated).
- [ ] Edit: naam/description/budget badlo => "Changes saved." aur details me naya data.
- [ ] Do tab me edit: pehle tab save, doosre tab save => "changed since you opened this form" error.
Pause / Resume:
- [ ] SQL se ek campaign ko active karo (day-4-2 Test 8 jaisa: approved creative + `update campaigns set status='active'` as postgres).
- [ ] Active par sirf Pause dikhe. Pause => confirmation => "Yes, pause campaign" => "Campaign paused. Ad serving is not live yet...".
- [ ] Paused par sirf Resume dikhe (approved creative ho toh). Bina approved creative ke Resume ki jagah wajah ka text.
- [ ] Draft/pending_review/completed/archived par Pause/Resume nahi dikhta.
Sessions / errors:
- [ ] Logout karke campaigns URL kholo => /login. Ek tab me logout, doosre me Save/Pause dabao => /login par jata hai.
- [ ] Publisher account se /dashboard/advertiser/campaigns => /dashboard par wapas.
Purane pages (kuch toota nahi):
- [ ] Landing page `/`, `/login`, `/signup`, `/privacy`, `/terms` khulte hain.
- [ ] `/dashboard`, `/dashboard/advertiser` (demo workspace + "Manage my campaigns" link), `/dashboard/publisher`, `/dashboard/campaigns` (demo), `/dashboard/analytics` khulte hain.
- [ ] `/api/supabase-health` => `{"status":"ok"}`.
Mobile (360px wide, Chrome Android):
- [ ] Form, list, details, edit me horizontal scroll nahi. Buttons/inputs 44px. Lambe naam (150 akshar bina space) wrap ho jate hain.
- [ ] Bottom nav (MobileNav) campaigns pages par kaam karta hai.

## 6. Android-friendly GitHub commit checklist
1. Zips ki files apne phone par extract karo (Files app). Sirf badli hui files hain, folder structure same rakho.
2. Repo kholo (GitHub web "Desktop site" me, ya Spck Editor). Har file usi exact path par replace/add karo
   (jaise `app/dashboard/advertiser/campaigns/actions.ts`). `[id]` wale folder ka naam square brackets ke saath hi rakho.
3. Naye files: supabase/sql/day-4-3-campaign-description.sql, day-4-4-edit-tests.sql, day-4-5-runstate-tests.sql,
   lib/campaigns/filters.ts, lib/campaigns/run-state.ts, components/campaigns/CampaignFilters.tsx,
   app/dashboard/advertiser/campaigns/loading.tsx, error.tsx, not-found.tsx, DAY4-FINAL-REVIEW.md.
4. Commit se pehle diff dekho: `.env` ya koi key/secret file add nahi honi chahiye. `.env.example` me sirf placeholders.
5. Commit message: `Day 4: campaign list, details, edit, pause/resume, security review`.
6. Direct main par commit karo (ya branch + pull request; PR par Vercel preview milega).
7. Commit ke baad Vercel ka build start hota hai (section 7).

## 7. Vercel deployment verify karna
1. Vercel app/site > project > Deployments: naya deployment "Building" se "Ready" hona chahiye. "Error" aaye toh deployment kholo > Build Logs me pehla error padho
   (TypeScript error ho toh file aur line wahin likhi hoti hai) aur mujhe bhejo.
2. Settings > Environment Variables me ye hone chahiye (Production):
   - NEXT_PUBLIC_SUPABASE_URL  (https://xxxx.supabase.co)
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  (sb_publishable_...)
   - (optional) NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_CONTACT_EMAIL
   Ye NAHI hone chahiye: koi sb_secret_ / service_role key. Variable change karo toh Redeploy karna padta hai.
3. Live site par `/api/supabase-health` kholo => `{"status":"ok"}`.
4. Landing page `/` khulta hai; login karke `/dashboard/advertiser/campaigns` khulta hai.
5. Supabase > Authentication > URL Configuration me Site URL aur Redirect URLs me tumhari Vercel site honi chahiye (login/Google ke liye).

## 8. Day 4 final completion checklist
- [ ] SQL: day-4-1 aur day-4-3 chali, 3 check queries ka result sahi.
- [ ] Code push hua, Vercel deployment Ready.
- [ ] Vercel env variables sahi, secret key nahi, /api/supabase-health ok.
- [ ] SQL tests: day-4-2 (1-13), day-4-4 (E1-E10), day-4-5 (R1-R9) ke expected results mile.
- [ ] App tests (5b) saare pass; mobile 360px par scroll nahi.
- [ ] Purane landing/dashboard/demo pages theek khulte hain.
- [ ] Do accounts se isolation (list, details URL, edit URL, pause) verified.
- [ ] Koi secret/key repo me commit nahi hui.

Day 4 me JAAN-BOOJHKAR nahi bana (aage ke stages): ad-matching engine, publisher API, payments, impression/click tracking.
Pause/Resume sirf campaign STATUS badalta hai, asli ad delivery par asar nahi (ad serving abhi bani nahi).
