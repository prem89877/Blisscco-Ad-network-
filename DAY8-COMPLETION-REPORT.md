# Day 8 / Part 6 : Completion report + Day 9 plan (SIRF DOCS, koi code/SQL nahi badla)

Date: 26 Oct 2026. Status: **Day 9 abhi implement nahi hua. Aapki approval ka intezaar.**

Label ka matlab (har jagah yahi):
- **CONFIRMED (code)** = maine is session me file padhkar dekha. Chalakar nahi dekha.
- **REPORTED** = pichhle audit ya aapne bataya; maine dobara verify nahi kiya.
- **UNVERIFIED / NOT RUN** = chala nahi ya dekha nahi. Isko "pass" mat maanna.

---

## 1. Kya consolidate kiya (source)

| Day 8 part | Source | Status |
|---|---|---|
| Part 1-2: repo, build, dependency audit | **Mere paas inka output nahi hai** (repo me file nahi, is chat me nahi). Maine koi finding invent nahi ki. Sirf ye CONFIRMED hain: `package-lock.json` repo me nahi hai, `node_modules` nahi hai, CI `npm install` par fallback karta hai | PARTIAL. Part 1-2 ka output bhejoge to is report me jod dunga |
| Part 3: Supabase static audit | `DAY8-PART3-SUPABASE-AUDIT.md` | Sirf SQL padhkar. Live DB par **NOT RUN** |
| Part 4: ad-delivery audit | `DAY8-PART4-AD-DELIVERY-AUDIT.md` | Code padhkar. Live concurrency test **NOT RUN** |
| Part 5: tracking audit | Pichhli chat (koi file nahi bani thi) | Code padhkar. Findings neeche C1-C3 me hain |
| Week 1 verification | `DAY7-PART6-WEEK1-VERIFICATION.md` | 972/972 tests pass (Day 7 me chale the, **is session me dobara NOT RUN**) |

Is session me **npm install, npm test, tsc, build, live Supabase, Vercel, browser kuch nahi chala** (internet band, node_modules nahi).

---

## 2. Confirmed bugs / gaps (CONFIRMED, code padhkar)

| ID | Kya | Saboot |
|---|---|---|
| C1 | **Advertiser ka paisa "served" par katta hai, jo unverified event hai.** Impression/click se kuch nahi katta. | `day-7-1` `record_ad_serve`: `campaign_spend_daily += CPM/1000` |
| C2 | Rendered impression aur click ka koi endpoint, table ya event hai hi nahi. Publisher ko serve ID bhi nahi milti. | `app/api` me sirf `ads/match`; `ad_serve_log` me koi `serve_ref`/event column nahi |
| C3 | Analytics: `/dashboard/analytics` sirf "Not available yet" text hai. `AnalyticsView.tsx` demo data par hai aur kahin mount nahi (dead code). Asli numbers sirf campaign detail page par (spend + "Ads shown") | `app/dashboard/analytics/page.tsx`, `components/dashboard/AnalyticsView.tsx`, grep |
| C4 | **Minimum budget nahi.** `total_budget > 0` chalta hai. Daily budget `$0.001` bhi allowed, jabki ek serve ki keemat `$0.002` (CPM $2). Aisa campaign kabhi serve nahi hota par "Active" dikhta hai. | `lib/campaigns/validation.ts`, `day-3-3` CHECK `> 0`, `day-7-1` `v_unit` |
| C5 | **Active/paused campaign ka total budget already-kharch se neeche kiya ja sakta hai.** `updateCampaign` spend padhta hi nahi, aur DB trigger sirf `pending_review/completed/archived` lock karta hai. Nateeja: campaign chupchap exhaust, status "Active". | `app/dashboard/advertiser/campaigns/actions.ts`, `day-4-3` guard |
| C6 | Koi bhi code/SQL campaign ko `completed` nahi karta (sirf `completed -> archived` hai). End date guzarne ya budget khatam hone par status "Active"/"Paused" hi rehta hai. | grep: koi `-> 'completed'` transition nahi |
| C7 | Active campaign ka budget aur dates dobara admin review ke bina badal sakte hain (S4, aapka faisla pending). | `day-4-3` guard |
| C8 | Rate limit per key hai, per publisher nahi: 5 keys x 60 = 300/min. Serve par charge hone se ye advertiser ka budget tezi se jala sakta hai (default CPM par ~$36/ghanta). | `authorize_publisher_key`, `issue_publisher_key_for` (limit 5) |
| C9 | Record reject hone par doosra candidate try nahi hota (sirf fill-rate ghatta hai, overspend nahi). | `lib/ads/serve.ts` step 4 |
| C10 | `package-lock.json` nahi hai, isliye build ke versions pakke nahi. | zip me file nahi |
| C11 | SQL files "dobara chalane par safe" nahi: `3-5`, `4-1`, `5-8` purane versions se naye function overwrite kar dete hain. | Part 3 S1 (REPORTED, SQL text padha gaya tha) |

## 3. Suspected risks (kuch cheezein jo ho sakti hain, saboot poora nahi)

- S-a: Throughput: `record_ad_serve` campaign row lock + `api_rate_limits` upsert zyada traffic par line lagwa sakte hain. Load test nahi hua.
- S-b: Latency: ek request = 3 sequential DB calls; Vercel region aur DB (ap-southeast-1) ka fark. Asli numbers nahi napay.
- S-c: `load_ad_candidates` bade data par dheema ho sakta hai (abhi data kam).
- S-d: IP guard sirf per-instance memory hai; Vercel Firewall rule nahi laga.
- S-e: Test SQL files me asli-jaise email addresses hard-coded (REPORTED Part 3 S2).
- S-f: `unit_cost` mismatch authorize vs record (CPM 2.0 par farak nahi).
- S-g: Fake clicks/impressions, jab tak endpoints nahi bane tab tak sirf future risk.

## 4. Unverified (NOT RUN; aapke haath se hi pure honge)

1. `day-7-1`, `7-2`, `7-3`, `7-5` SQL live Supabase par chali ya nahi (aapne bataya chal gayi: REPORTED; output maine nahi dekha).
2. `day-8-1-readonly-verify.sql` ke blocks (maine bhi chalayi nahi, file khud "NOT RUN" likhti hai).
3. Latest commit ka Vercel build **Ready** hai ya nahi (pichhla `efe26a6` fail tha: REPORTED).
4. Asli signup/login/Google, campaign create/edit/pause/resume, key banana, `POST /api/v1/ads/match` live par.
5. Phone par screen/mobile check.
6. `npm test` (972), `tsc`, `eslint`, `next build` ka taaza result.
7. Live concurrency test (budget overspend nahi hota, sirf code padhkar kaha gaya).

---

## 5. Week 1 jo bachana hai (preserve, inhe mat todna)

- Auth: signup/login/logout/Google, `middleware.ts`, `requireRole/requireAccount` har dashboard page par.
- Roles + RLS: 12 tables par RLS, `guard_profile_changes`, admin sirf `SECURITY DEFINER` functions se.
- Advertiser flow: campaign create/edit/pause/resume, optimistic lock (`expectedUpdatedAt`), 50-campaign limit, creative form + admin review.
- Publisher flow: key issue/list/revoke (hash only, 5 active, expiry).
- Ad API: `POST /api/ads/match` aur `/api/v1/ads/match` (ek hi handler), strict validation, IP guard, per-key rate limit, no-store headers, 5 public fields.
- Matching: category taxonomy, eligibility, selection, `record_ad_serve` ka campaign lock + budget gate.
- Privacy: prompt/IP/user id kahin store nahi.
- Tests: 972 tests (Day 7 ka result); naye changes ke baad bhi inme se koi todna nahi.
- Mobile UI: viewport, `MobileNav`, scrollable tables, bade tap targets.

---

## 6. Prioritized issue list

**P0: safe, functional MVP rokne wale (public launch/payments se pehle)**
1. C1 + C2: unverified serve par charge + impression/click nahi. (Part 5 ka Phase 1/2; **Day 9 me nahi**, alag approval.)
2. Live verification (section 4 ke items 1, 3, 4): bina iske "working MVP" claim nahi kar sakte.
3. C10: `package-lock.json` (build reproducible).

**P1: Day 9 ka focus (advertiser campaigns + budget validation)**
4. C5: budget kharch se neeche na jaye.
5. C4: minimum budget rules.
6. C6: budget khatam/ended campaign ko honestly dikhana (status label).
7. Budget/remaining info advertiser ko saaf dikhana (honest: spend "served" par ginta hai).

**P2: baad me**
8. C8 per-publisher rate limit, C9 retry, S-f unit cost, Vercel region, Firewall rule.
9. C7 (aapka faisla), C11 + S-e (SQL files ki safai), analytics real data (Part 5 Phase 3).

---

## 7. Day 8 final checklist

| Item | Status |
|---|---|
| Repo/build/dependency audit (Part 1-2) | Output mere paas nahi: **UNVERIFIED** |
| Supabase static audit (Part 3) | Done (static) |
| Ad-delivery audit (Part 4) | Done (code padhkar) |
| Tracking/analytics audit (Part 5) | Done (code padhkar) |
| Day 8 completion report (ye file) | Done |
| Koi code/SQL/production data badla? | **Nahi** |
| Live Supabase verification | NOT RUN (aap karoge) |
| Vercel Ready (latest commit) | NOT RUN |
| Taaza `npm test`/`tsc`/build | NOT RUN |
| Day 9 plan taiyar | Done, **approval baaki** |

Remaining blockers: section 4 ke 1-7 + P0 items.

---

## 8. Aapke faisle (Day 9 shuru hone se pehle)

- **D1 Minimum budget:** proposal: total >= **$1.00**, daily >= **$0.50** (CPM $2 par 250 serves/din). Number aapka.
- **D2 Active campaign ka budget badhana (S4):** proposal: Day 9 me **jaisa hai waisa** (badhana allowed, ghatana sirf kharch tak). Re-review baad me.
- **D3 Auto-complete:** proposal: Day 9 me **status badalna nahi**, sirf display label ("Budget used up" / "Ended"). DB me `completed` set karna alag, baad me.
- **D4 Optional DB migration** (trigger + min-budget CHECK): chahiye ya sirf app-level rules? Recommendation: dono, par migration alag approval se.

---

## 9. Day 9 plan (Advertiser campaigns + budget validation)

Rule: koi cheez scratch se nahi; purani files me chhote badlav. Charge abhi bhi "serve" par hai; Day 9 isko **nahi** badalta.

### T1: Budget rules ek jagah (pure module)
- Files: **new** `lib/campaigns/budget.ts`; edit `lib/campaigns/constants.ts` (`MIN_TOTAL_BUDGET`, `MIN_DAILY_BUDGET`), `lib/campaigns/validation.ts` (min checks + messages).
- Reason: C4. Rules server-side validation me, ek hi source.
- Expected: total < $1.00 ya daily < $0.50 par field error; baaki purane rules same.
- Security: server hi asli check (browser nahi). Koi DB/secret nahi.
- Acceptance: `1500.50/100` pass; `0.99` total reject; `0.49` daily reject; `1.00` accept; purane tests (`campaign-rules`, `day7-part4-fixes`) bina badlav pass.

### T2: Edit par "kharch se neeche nahi" (app level)
- Files: edit `app/dashboard/advertiser/campaigns/actions.ts` (`updateCampaign`), `lib/campaigns/budget.ts` (`checkBudgetEdit`), `lib/campaigns/queries.ts` (sirf reuse `getCampaignSpend`, koi badlav nahi).
- Reason: C5. Active/paused/draft me `new total < spent_total` reject: "Already $X spent; total cannot be lower."
- Expected: spend padhna fail ho (null) aur status active/paused ho to **edit rokna** ("try again"); draft/rejected ko spend check nahi chahiye.
- Security: spend `get_my_campaign_spend` se (owner/admin only, RLS-safe); advertiser id form se nahi. Race: read aur write ke beech serve ho sakta hai, isliye T3 chahiye (D4).
- Acceptance: unit tests (pure function) + 2-account manual test (B ka campaign A edit nahi kar sakta).

### T3: DB guard (D4 ke baad, **migration approval chahiye**)
- Files: **new** `supabase/sql/day-9-1-budget-guards.sql`.
- Kya: (a) `private.guard_campaign_changes()` ka **poora latest version (day-4-3) copy + naya check**: active/paused par `total_budget >= kharch`; kharch padhne ke liye chhota `SECURITY DEFINER` helper (kyunki delivery tables authenticated se band hain); (b) `campaigns_min_budget_check` **NOT VALID** (purani rows nahi todta), validate alag step.
- Reason: C5 race band karna; S1 regression se bachna (purana function overwrite na ho).
- Security: `search_path = ''`, sab schema-qualified, helper ka execute sirf trigger ke liye, anon/authenticated ko direct nahi. Spend data advertiser ko leak nahi hota.
- Acceptance: **pehle TEST project**; `begin ... rollback` SQL test: kharch ke neeche edit reject, upar accept, dusre advertiser ka campaign reject, min budget par insert reject, purani row par validate pehle count dikhaye.

### T4: Detail page par remaining budget + honest label
- Files: edit `app/dashboard/advertiser/campaigns/[id]/page.tsx`; `lib/campaigns/budget.ts` (`describeBudget`).
- Reason: C6 + honest reporting.
- Expected: "Remaining budget", "% used", aur derived label: "Budget used up" (kharch >= total), "Ended" (end date guzri) jab status active/paused ho. **DB status nahi badalta.** Note line: "Spend is counted when an ad is handed to a chatbot (not verified impressions)."
- Security: wahi `getCampaignSpend`; koi naya data expose nahi.
- Acceptance: unit tests (exact boundary: kharch == total => used up; 0.0001 kam => not); phone par screenshot.

### T5: Edit form me hints
- Files: edit `components/campaigns/CampaignForm.tsx` (props: `spentTotal?`), `app/dashboard/advertiser/campaigns/[id]/edit/page.tsx` (spend fetch).
- Expected: min budget hint, "Already spent $X" (sirf edit par).
- Security: spend server par fetch, fail ho to hint chhupta hai (T2 edit rokta hai).
- Acceptance: create form par min hint; edit par spent; spend load fail par page crash nahi.

### T6: Tests aur docs
- Files: **new** `tests/campaigns/budget-rules.test.ts`; **new** `supabase/sql/day-9-2-budget-tests.sql` (TEST ONLY, rollback); **new** `DAY9-BUDGET-VALIDATION.md`.
- Acceptance: `npm test` me purane 972 + naye sab pass (**chalakar dikhana, bina chalaye PASS nahi likhunga**).

Day 9 me jaan-boojh kar **nahi**: impression/click tracking, billing change, auto-complete DB job, per-publisher rate limit, naya paid service.

### Sequence
1. (Manual) pre-checks + faisle D1-D4.
2. T1 → T2 (app level, DB nahi chhuta).
3. T4 → T5 (UI).
4. T6 tests (app).
5. T3 migration file likhna → (Manual) TEST project par chalana + SQL tests → tabhi production.
6. (Manual) preview par 2-account test → merge.

---

## 10. Aapko haath se karna hai (Android)

**Supabase dashboard:**
- Day 8 baaki: naye TEST project par migrations ka order (Part 3 section 7) aur `day-8-1-readonly-verify.sql` ke blocks ek-ek, screenshot bhejna.
- Dashboard checks: Exposed schemas sirf `public`; Email confirmation + Redirect URLs; `pg_cron` on?; Backups/PITR; Advisors (Security + Performance).
- Day 9: `day-9-1` (T3) pehle TEST par SQL Editor me chalana, phir `day-9-2` tests.

**GitHub (phone browser):**
- Branch `day9-budget` banana; **Upload files se folder flatten ho sakta hai**, isliye "Add file > Create new file" me poora path likhkar paste karo.
- CI chalne par Actions > run > Artifacts se `package-lock.json` download karke repo me daalo (C10).
- PR kholo, CI green dekho.

**Vercel:**
- Latest deployment **Ready**? Preview URL par test. `/api/supabase-health` => `{"status":"ok"}`.
- Env: `SUPABASE_SECRET_KEY` sirf server env me; koi `NEXT_PUBLIC_` me secret nahi.
- Firewall rate-limit rule (DAY7-FIXES) lagana, optional par recommended.

**Phone testing (2 advertiser accounts):** A ka campaign B edit/pause nahi kar sakta; budget min/edit rules; detail page par remaining budget.

---

## 11. Effort estimate (andaza, pakka nahi)

| Kaam | Coding | Manual testing |
|---|---|---|
| T1 budget rules + tests | 1.0 h | |
| T2 edit guard | 1.0 h | |
| T3 SQL migration + SQL tests | 1.5 h | Supabase TEST par chalana 1.0 h |
| T4 detail page | 1.0 h | |
| T5 form hints | 0.75 h | |
| T6 docs + test cleanup | 0.75 h | |
| GitHub commit/PR (phone) | | 0.75 h |
| Vercel preview check | | 0.5 h |
| 2-account phone test | | 1.5 h |
| `package-lock.json` + Day 8 manual checks | | 1.0 h |
| **Total** | **~6 h** | **~4.75 h** |

(Bug nikalne par extra 1-2 h; Day 8 ke bache live checks alag.)

---

## 12. Day 9 ki success definition

Day 9 tabhi "success" hai jab, **chalakar dikhaya gaya ho**:
1. Naya campaign min budget se kam par nahi banta (server par), aur daily <= total ab bhi.
2. Active/paused campaign ka total budget kharch ke neeche kar hi nahi sakte (app **aur** DB, jaise D4 approve ho).
3. Advertiser ko remaining budget, % used aur "Budget used up/Ended" saaf dikhta hai, aur likha hai ki spend "served" par ginta hai.
4. Dusre advertiser ka campaign dekha/badla nahi ja sakta (2 accounts, phone par).
5. Purane 972 tests + naye tests pass (`npm test` ka asli output), aur Vercel preview Ready.
6. Koi production data nahi badla; koi secret expose nahi hua; impression/click/billing ka kuch nahi chhua gaya.
