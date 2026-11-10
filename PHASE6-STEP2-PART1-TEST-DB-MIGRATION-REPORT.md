# Blisscco Phase 6 Step 2 Part 1: TEST database migration report

Date: 2026-11-10
Project used: **Denim Hub Bsl** (id `ficwuieqjdhrrxbvuqot`, ap-northeast-2), as named by the owner as the TEST project.
Production (`Blisscco-Ad-network-`, id `mfliodvkaszqywajbshu`): **not accessed, not changed.**
Part 2: not started.

## What was done

1. Read-only check of the TEST project: 34 public tables, `publishers` had 1 row, 8 profiles, `private` schema, `private.is_admin()` and `private.is_active_profile()` present (prerequisites OK). `publishers` had no `country_*` columns before.
2. Applied `supabase/sql/phase6-step2-1-publisher-country-verification.sql` as migration `phase6_step2_1_publisher_country_verification` (result: success). Only change from the file: the outer `begin;` / `commit;` and the trailing comment block were left out because the migration runner already wraps it in one transaction. All statements are otherwise identical.
3. Ran verify checks V1 to V7 (plus 2 extra).
4. Ran behaviour tests inside a transaction that is always rolled back (nothing from the tests persists).

## Verify checks V1 to V7: actual vs expected

| Check | Expected | Actual | Result |
|---|---|---|---|
| V1 new `country_*` columns | 5 rows | 5 | PASS |
| V2 authenticated INSERT/UPDATE grant on country columns | 0 rows | 0 | PASS |
| V3 grantees of `get_publisher_country_state` | service_role + postgres only | postgres, service_role | PASS |
| V4 anon on submit/admin functions | 0 rows | 0 | PASS |
| V4 authenticated on submit/admin functions | both | both | PASS |
| V5 self_approval_blocked and country_changed present in admin function | true | true | PASS |
| V6 guard trigger | 1 row | 1 | PASS |
| V7 rows with country but no submit time | 0 | 0 | PASS |
| extra: anon/authenticated/PUBLIC on `get_publisher_country_state` | 0 | 0 | PASS |
| extra: existing publisher rows with all-null country | all | 1 of 1 | PASS |

## Behaviour tests (rolled back, real database)

| # | Test | Actual | Result |
|---|---|---|---|
| T1 | CHECK: `verified` without admin id/time | check_violation | PASS |
| T2 | CHECK: code not `^[A-Z]{2}$` (`india`) | check_violation | PASS |
| T3 | Publisher (authenticated) writes country columns directly | blocked, 42501 | PASS |
| T4 | Publisher calls `submit_publisher_country(' in ')` | returns `pending` (trimmed, upper-cased) | PASS |
| T5 | Publisher approves own country | refused, 42501 | PASS |
| T6 | Submit with bad format `XX1` | refused, 22023 | PASS |
| T7-0 | Admin approves when no country submitted | refused, hint `country_not_submitted` | PASS |
| T7a | Admin approves a country different from what is stored | refused, hint `country_changed` | PASS |
| T7d | Decision `verified` (only approve/reject allowed) | refused, 22023 | PASS |
| T7b/c | Admin approves pending | `verified`; admin id = caller, review time set | PASS |
| T8 | Serving state when verified | `{"country_code":"IN","country_status":"verified"}` | PASS |
| T9 | Admin rejects | `rejected` | PASS |
| T9b | Approve a rejected country | refused, hint `country_not_pending` | PASS |
| T10 | Serving state when rejected | country_code `null` | PASS |
| T11 | Authenticated user calls `get_publisher_country_state` | refused, 42501 | PASS |
| T12 | Serving state when pending | country_code `null` | PASS |
| T13 | Publisher owner made an admin (self-approval path) | blocked by role foreign key, so a publisher account cannot be admin | PASS |

Note on the test method: my first two test runs did not give valid results (wrong column name for `admins`; then `is_admin()` needs `profiles.role = 'admin'`, not an `admins` row). Those runs were discarded. The final run above is the valid one. Self-approval hint `self_approval_blocked` itself could not be triggered on TEST, because the role foreign key does not allow a publisher account to be an admin; the function check is present (V5) and covered by the repository SQL/unit tests.

## State after the tests

Rollback confirmed: publishers with any country value = 0; publishers 1, profiles 8 (unchanged). The TEST project already had 1 profile with role `admin` (before and after), which can be used for manual admin testing.

## Observations for the owner

- The TEST project "Denim Hub Bsl" also contains non-Blisscco tables (`products`, `visit_requests`, `push_subscriptions`, `customer_push_subscriptions`). Make sure this project really is your Blisscco TEST project, and not a shared or live project of another app. The migration is additive only (5 nullable columns, 1 index, 1 trigger, 3 functions), so existing data is not changed.
- `REGIONAL_ELIGIBILITY_ENFORCED` was not set anywhere. The serving gate stays OFF.

## Still manual / not done (NOT marked complete)

- `npm run lint`, `npm run lint:eslint`, `npm test`, `npm run build`, GitHub CI.
- UI checks on TEST: publisher submit at setup and from dashboard, admin approve/reject buttons, "country changed" message, mobile layout.
- Ad-serving checks with `REGIONAL_ELIGIBILITY_ENFORCED=1` (verified gets an ad; pending, rejected, missing get no-fill).
- Production: not touched. Applying this SQL there is a separate owner decision.
