# PHASE 6 — DAY 2 — PART 1: Ad Matching, Country & Regional Eligibility Verification

Date: 2026-11-12 | Source: uploaded `blisscco-ad-network.zip` (current implementation inspected) | Environment: sandbox, no database, no network, no `npm ci`

## 1. Test counts and actual results

| Suite | Before | After | Pass | Fail |
|---|---|---|---|---|
| `tests/ads/*.test.ts` | 3486 | **3505** | 3495 | **10** (environment only, see 4.1) |
| `tests/regions/*.test.ts` | 268 | 268 | 268 | 0 |
| New file `tests/ads/phase6-day2-part1-matching-geo.test.ts` | 0 | 19 | 19 | 0 |

Run method: `tsc -p tsconfig.test.json` then `node --require ./tests/register.cjs --test .test-build/tests/<dir>/*.test.js` (same as `npm test`, per directory).

## 2. What was verified (task by task)

1. **Matching, taxonomy, selection, loader** — `category-matching.ts`, `taxonomy.ts`, `selection.ts`, `candidate-loader.ts` read in full. Exact slug/alias only, sensitive and legacy categories rejected before any database call, deterministic ranking (least-served campaign, least-served creative, ids), public response limited to 5 fields. Existing tests already cover this; no defect found.
2. **Scenario matrix** (new tests, section A, end to end through `serveAd` + real `selectAd`): correct category fills; unrelated, missing, empty, non-string category give no-fill (loader not called); paused/draft/completed/pending_review/rejected campaign gives no-fill; exhausted total or daily budget gives no-fill; no candidates gives no-fill; exhausted campaign loses to one with budget. Nothing is recorded on any no-fill.
3. **Country and regional targeting** — `regional-eligibility.ts`, `publisher-country-db.ts`, `campaign-targeting.ts`, `campaign-regions-db.ts` read in full; existing 268 region tests pass.
4. **Unverified / missing / invalid country** (new tests, section B): pending, rejected, missing, verified-without-code, `UK`, `XX`, empty, 3-letter code all give `ineligible`; odd or unreadable shapes never give `ok` (fail closed); lookalike region ids (case, spaces, `all`, `*`, `__proto__`, `constructor`) never match; client-supplied country/region never reaches selection (region comes only from the server dependency). Country verification and fallback rules were **not changed**.
5. **Reserved-budget pre-filter** — see section 3.

## 3. Bug found: `load_ad_candidates` does not pre-filter fully reserved budgets

- **Cause:** `public.load_ad_candidates` (latest definition: `supabase/sql/day-9-7-lifecycle-guards.sql`) excludes only campaigns whose **settled** spend (`campaign_spend_daily`) reached `total_budget`. Live holds (`ad_budget_reservations`, status `held`) are not counted. `phase6-step4-part2-event-billing.sql` states this was left unchanged on purpose and that `record_ad_serve` rejects such campaigns.
- **Why it matters:** `serveAd` tries at most 3 `record_ad_serve` attempts. Ranking puts the campaign with the fewest serves **today** first, so campaigns whose budget was reserved before 00:00 UTC (holds live 24 h) rank first. If 3 or more such campaigns are ahead, all attempts are rejected and the request ends in no-fill, while a lower-ranked campaign with budget is never tried.
- **Reproduced:** test `REPRODUCED: 3 fully reserved campaigns ranked first ...` (passes today and documents the current behaviour). With 1 or 2 fully reserved campaigns ahead the request still fills (next-ads fall through).
- **Severity:** low. Needs 3 or more fully reserved campaigns ranked above an eligible one. Budget is never overspent; the effect is a lost fill.
- **Proposed minimal fix (NOT applied):** one new TEST-first SQL file that re-creates only `load_ad_candidates` with one extra read-only condition: exclude a campaign when settled spend plus live holds (`status = 'held' and expires_at > now()`) is already `>= total_budget`, and when held plus settled spend for `p_today` is `>= daily_budget`. Conservative on purpose (only fully reserved campaigns are dropped). `record_ad_serve`, the reservation tables and all budget guards stay untouched, so database budget protection is not weakened. The new test `with a held-aware pre-filter ...` shows the fill works and that a stale pre-filter is still rejected by the database guard.
- **Why not applied:** it needs a SQL migration (applied manually to TEST first) and the earlier decision in the Part 2 billing file was deliberate. Needs your go-ahead.

## 4. Unresolved issues and notes

1. **10 failing tests in `tests/ads` are environment only**: `@types/node` and `next` are not installed in the sandbox (`day28 part 1` publisher-example compile tests, `Day 20 part 4` guide compile tests). They fail with "run `npm ci`". Same 10 fail before and after my change; please confirm they are green in your CI/Termux.
2. **Spec vs implementation, all-regions rule:** the prompt says only all-regions campaigns may qualify when country verification is unavailable. The code has **no "all-regions" campaign type** (`PHASE6-STEP2-PART2-CAMPAIGN-TARGETING-REPORT.md` confirms: empty targeting means Rest of World only; explicit all-region is not supported). Actual behaviour: flag `REGIONAL_ELIGIBILITY_ENFORCED=1` and country not verified gives **no-fill for every campaign**; flag off gives the old behaviour with no regional filter. This is stricter than the prompt, never looser, so nothing was changed. Please confirm this is the intended rule.
3. Type-check (`tsc`) could only report the missing `@types/node` (TS2688); no other type error appeared and test output was emitted.
4. No real database, Preview or Production was touched.

## 5. Changed files

| File | Change |
|---|---|
| `tests/ads/phase6-day2-part1-matching-geo.test.ts` | New, 19 tests |
| `PHASE6-DAY2-PART1-MATCHING-GEO-REPORT.md` | New |

No `lib/`, SQL, CI, Vercel or deployment file changed. No AI matching added; no raw chatbot prompt stored.

---
## UPDATE (2026-11-13)
- The "10 failing tests" in section 3 were sandbox-only (`@types/node`/`next` missing). **CI #130 is green** on GitHub (owner-supplied; counts not seen). CI #129 had 1 unrelated static-guard failure (SQL comment), fixed in #130.
- Pending decisions: **all-regions rule = CLOSED (Day 3, owner: keep existing behaviour)**. `load_ad_candidates` live holds: owner approval wording received, scope needs confirmation, **not implemented**. CI #131 green (owner-reported).
