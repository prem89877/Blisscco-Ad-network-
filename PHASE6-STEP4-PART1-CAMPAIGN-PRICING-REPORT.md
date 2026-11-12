# Phase 6 Step 4 Part 1: Campaign Pricing & Contextual Matching Readiness

Status: code + tests done. **SQL migration NOT run on any database** (no Postgres in the build sandbox; waiting for approval to run on the test project `denim` first). Production untouched.

## 1. Contextual matching audit (taxonomy.ts, category-matching.ts, selection.ts, regional files)

Checked by reading the code, by probing ~50 inputs, and by the existing 899 test files (all pass).

**No confirmed defects** in: exact slug/alias matching, sensitive-topic rejection, no-match / no-fill behaviour, regional eligibility.

- Exact match only: `game`, `gaming_pro`, `unions`, `__proto__`, `constructor` are unsupported; free text (>3 words) rejected; no AI call; raw prompt is never stored.
- Sensitive terms (`health`, `religion`, `politics`, `race`, `union`, ...) are rejected with `sensitive_category`. Nothing sensitive can ever be matched because matching is allow-list based.
- Regional: campaign with no region (null/empty) = Rest of World only; listed regions only; unknown region id or missing row = fail closed. Verified by probe + tests.
- Fallback inside matching: a `no_match` always becomes a safe no-fill. Fallback topics are tried in order, sensitive primary topic stops everything.

**Observations (not changed: you said do not change serving in this part):**

1. *Low-severity policy gap.* Sensitive detection is exact-token. Variants such as `mentalhealth`, `health_care`, `cancer`, `unions`, `sexualorientation` resolve to `unsupported_category`, not `sensitive_category`. They are still never matched to an ad. But `fallbackAllowedFor()` (fallback-routing.ts) only blocks the external Revive fallback when the reason is exactly `sensitive_category`, so for these variants the external fallback may still run if `REVIVE_FALLBACK_ENABLED=true`. The provider request carries no topic, so no topic data leaves Blisscco; it is only a gate-policy gap. Revive fallback is OFF by default. Suggested follow-up: widen the sensitive list, or block fallback whenever the topic is not a supported category.
2. *Doc/behaviour mismatch (harmless).* The comment says newline/non-ASCII is rejected, but input is NFKC-normalised and trimmed first, so `"gaming\n"` and fullwidth `ｇａｍｉｎｇ` resolve to `gaming`. Still exact-match to a real slug.

## 2. Pricing design

Migration: `supabase/sql/phase6-step4-part1-campaign-pricing.sql` (forward-only, one transaction, re-runnable).

| Column | Type | Meaning |
|---|---|---|
| `pricing_model` | text, null | `cpm` / `cpc` / null |
| `cpm_rate_usd` | numeric(10,4), null | USD per 1,000 impressions |
| `cpc_rate_usd` | numeric(10,4), null | USD per click |

- **Legacy:** all old campaigns stay null = platform default (`ad_platform_settings.cpm_usd`). No backfill.
- **Constraints:** model enum; shape (model null => both null, cpm => only cpm, cpc => only cpc); CPM 0.10-1000.00; CPC 0.01-100.00; CPC <= total and daily budget; explicit USD check (`campaigns_pricing_usd_check`) on top of the existing `campaigns_currency_usd_only`.
- **Why CPM min 0.10:** one serve is charged at least $0.0001 (`record_ad_serve`), i.e. $0.10 CPM. A lower CPM would be misleading.
- **Lock:** pricing is locked in `pending_review` / `completed` / `archived` by a separate trigger (`campaigns_guard_pricing`). `guard_campaign_changes` was not redefined.
- **Grants:** column-wise insert/update to `authenticated` only.
- **`ad_platform_settings`, matching, serve, record, ledger functions: not touched.** The campaign rate is only stored; delivery and charges still use the platform CPM. The form says this honestly.

## 3. App changes

- `lib/campaigns/pricing-rules.ts` (new): exact integer parsing (1 unit = $0.0001), limits, messages, `checkPricing`. Used by server and browser form.
- Server rule: pricing is **optional** (blank = platform default), so old callers and old tests keep working. The form pre-selects CPM $2.00 for new campaigns. `requirePricing` option exists if you want it mandatory later.
- Only the chosen model's rate is read; the other is ignored and stored as null. Currency is never read from the form.
- Create sends pricing columns only when chosen. Edit sends all 3 columns only when pricing actually changed. A campaign with pricing cannot go back to blank.
- `edit/page.tsx` needed no change (form gets pricing through the `campaign` prop).

## 4. Tests actually run

- New file `tests/campaigns/phase6-step4-part1-pricing.test.ts`: **65 tests, 65 pass**.
- Full suite before: 5378 tests, 5366 pass, 11 fail, 1 skip. After: **5443 tests, 5431 pass, 11 fail, 1 skip** (+65, same 11).
- The 11 failures exist before my changes: tests that compile examples with real Node types; `@types/node` is not installed in the sandbox (no network).
- Mutation check: I injected 2 bugs (always send pricing keys; SQL CPC max 200) and the new tests failed as expected, then reverted.

**Not run:** the SQL on any database; `next build` / `npm run lint` (no node_modules); the form in a browser (type/logic only; React types missing in sandbox).

## 5. Deploy order (important)

`queries.ts` now selects the 3 new columns. **Apply the migration BEFORE deploying this code** to an environment, otherwise the campaign list/detail pages will error. Test project (denim) first; production only after your approval.

## 6. Decisions I made that you may want to change

- CPM 0.10-1000, CPC 0.01-100 limits.
- Advertisers can set/edit their own pricing, also while active/paused (same as budgets). Safe now because rates are not used for charging yet; decide re-approval rules before Part 2 uses them.

---

## UPDATE 2026-11-12 — TEST database status (supersedes "NOT run on any database" above)
Evidence labels used in these updates: **VERIFIED** = proof exists (pasted query output, GitHub Actions screenshot or log); **CONFIRMED BY USER** = owner statement, no independent artefact; **INFERRED** = follows logically from verified evidence; **OPEN** = not proven. Production was not touched; no Production SQL was run for any item below.

| Item | Status | Evidence |
|---|---|---|
| Part 1 migration applied on TEST (Denim Hub Bsl) | **VERIFIED** | Owner's read-only footer query on Denim: 3 pricing columns present, 6 pricing constraints present, trigger `campaigns_guard_pricing` present, 0 `anon` grants on the pricing columns |
| Footer checks V1, V2, V4, V5 | **VERIFIED (PASS)** | Same query output (3 / 6 / 1 / 0, as expected) |
| Footer checks V3 (old rows have null pricing), V6 (`ad_platform_settings` unchanged) | **OPEN** | Not run |
| Pricing behaviour through the DB (CPM and CPC charge amounts) | **VERIFIED executed; PASS INFERRED** | `financial-tests.sql` ran on Denim (see Part 3 update); DB integration workflow #17 green |
| Production | untouched | **OPEN**: Production not verified |
