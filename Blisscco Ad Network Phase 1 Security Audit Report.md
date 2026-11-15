# Blisscco Ad Network: Phase 1 Security Audit Report

Production: `mfliodvkaszqywajbshu` (read-only). TEST: `ficwuieqjdhrrxbvuqot` (runtime tests with real Auth logins). Date: 15 Nov 2026. No Production changes were made.

## 1. Executive summary

- **Confirmed vulnerabilities: 0. CRITICAL/HIGH: 0.**
- Production catalog (functions, grants, RLS, policies, storage) verified read-only and matches the repo migrations.
- Runtime negative tests on TEST: 10 test groups, all PASS.
- Remaining: 3 small items (section 10). Leaked Password Protection stays **DEFERRED, plan limitation**.
- **Phase 1 status: PARTIAL** (close after section 10 items are done or accepted).

## 2. Part 1: SECURITY DEFINER functions (Production)

| Check | Result | Status |
| --- | --- | --- |
| SECURITY DEFINER functions | 94 (public + private) | PASS |
| PUBLIC EXECUTE | 0 functions | PASS |
| anon EXECUTE | 0 functions | PASS |
| authenticated EXECUTE | 34 (29 public + 5 private helpers) | PASS |
| search\_path pinned | 94/94 | PASS |
| Authorization logic (live definitions, all 34 read in full) | Admin functions check `private.is_admin()` first; user functions derive owner from `auth.uid()`; no caller-supplied owner IDs; no dynamic SQL | PASS |
| IDOR (`get_my_campaign_*` with `p_campaign_id`) | Filtered by advertiser ownership or admin | PASS |
| `private` schema exposed to API | Exposed schemas = `public`, `graphql_public` only | PASS |
| `campaign_can_afford_serve` (private, authenticated) | Ownership check inside; not reachable via API | PASS |

## 3. Part 2: RLS, policies, table grants (Production)

- 30 public tables, all RLS on. FORCE RLS off (INFO: only postgres owns tables).
- 25 tables: RLS on, 0 policies, no grants for anon/authenticated/service\_role. Fail-closed, reachable only via SECURITY DEFINER functions. **PASS**
- 5 tables with policies (profiles, advertisers, publishers, campaigns, ad\_creatives): own-row and admin SELECT; own-row INSERT/UPDATE; no DELETE; no anon policies. **PASS**
- Column grants: profiles update only `display_name`; advertisers cannot change `status`/`profile_id`; publishers cannot change status/country columns. No anon/PUBLIC column grants. **PASS**
- Guard triggers cover all new creative columns, campaign status transitions, budget and pilot limits. **PASS**

## 4. Anonymous access tests (TEST)

| Test | Result | Status |
| --- | --- | --- |
| T1: anon GET `profiles`, `campaigns` | `42501 permission denied` | PASS |
| T1: anon `admin_list_payments` | `42501 permission denied` | PASS |
| Production anon on `profiles` (read-only SQL role switch) | `42501 permission denied` | PASS |

## 5. Authenticated access tests (TEST, real logins: ADV\_A, ADV\_B, PUB, ADM)

| Test | Result | Status |
| --- | --- | --- |
| T2 ADV\_A reads ADV\_B campaign | `[]` | PASS |
| T3 ADV\_A updates ADV\_B campaign | `[]`, name unchanged | PASS |
| T4 ADV\_A `get_my_campaign_spend` on B campaign | `[]` | PASS |
| Control: ADV\_A sees own campaign | 1 row | PASS |
| T5 PUB reads/updates advertiser campaigns | `[]`, update 0 rows | PASS |
| T6 non-admin calls admin RPCs | `[]` or `42501 Admin only` | PASS |
| T7 role to admin / status draft to active / budget 5000 | permission denied / not allowed / pilot limit | PASS |
| T8 payout over balance, direct payout table write, other user's summary | `insufficient` / permission denied / `[]` | PASS |
| T10 admin positive control and non-admin differential | admin gets data, non-admin `[]` | PASS |

## 6. Storage security

| Check | Result | Status |
| --- | --- | --- |
| Production bucket `creative-assets` | private, 4 MB, png/jpeg/webp | PASS |
| 4 Production policies (insert/select own, select admin, delete own), no UPDATE, no anon | verified | PASS |
| T9 ADV\_A uploads into ADV\_B folder | RLS violation | PASS |
| T9 ADV\_B reads/deletes ADV\_A file | not found / `403 Access denied` | PASS |
| T9 anon / public URL | blocked | PASS |
| Control: owner upload, read, delete | 200 | PASS |

Note: the TEST project had no `creative-assets` bucket; it was created in TEST only.

## 7. Auth configuration (Production)

| Setting | Value | Status |
| --- | --- | --- |
| Password | min 8, letters + digits | PARTIAL (INFO) |
| Confirm email | ON | PASS |
| TOTP MFA | Enabled (optional for users) | PASS |
| AAL1 session limit (15 min) | ON | PASS |
| Access token expiry | 3600 s | PASS |
| Refresh token reuse detection | ON, interval 10 s | PASS |
| SMS MFA | Disabled, Pro plan | DEFERRED |
| Time-box / inactivity timeout / single session | 0 / 0 / off, Pro plan | DEFERRED |
| **Leaked Password Protection** | disabled | **DEFERRED: requires higher Supabase plan** |

## 8. Findings (all LOW or INFO, none confirmed as vulnerabilities)

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Advertiser can change CPM/CPC rate on active/paused campaign without re-review. Rates are range-limited and snapshotted per serve, so past billing is not affected. | LOW (business policy) | Decision needed |
| 2 | `advertisers.country_code` is self-updatable with no guard. Matters only if country drives pricing or compliance. | LOW | Verify usage |
| 3 | Storage delete policy has no campaign-status check: advertiser can delete creative assets of a running ad (availability, not data leak). | LOW | Optional hardening |
| 4 | `admin_set_advertiser_status` / `admin_set_publisher_status` write no audit log. | INFO | Optional |
| 5 | Admin MFA is optional; admin can approve payouts and change settings. | LOW | Recommend enrolling TOTP on admin |
| 6 | `rls_auto_enable()` is not in repo (Supabase helper); all EXECUTE closed. Old finding F9 is resolved. | INFO | Record in migrations |
| 7 | Legacy 3-arg `record_ad_serve` overload still exists (service\_role only). | INFO | Remove later |
| 8 | Publisher can see reviewer admin UUIDs (`country_reviewed_by`). | INFO | Accepted |

## 9. Proposed fixes (none applied)

No CRITICAL/HIGH fixes are required. Optional hardening, each reversible and migration-based (exact SQL on request, applied only after your approval):

- Findings 1 and 2: decide the policy first (lock pricing and country after approval, or accept as is).
- Finding 3: add a campaign-status condition to the delete policy.
- Finding 4: add audit-log inserts to the two status functions.
- Finding 5: enroll TOTP on the admin account (dashboard action, no code).

## 10. Remaining for Phase 1

1. Runtime tests were done on TEST. Production schema and policies were verified by catalog only, not by a live negative test. Accept this or run a Production smoke test with dedicated test accounts.
2. Not runtime-tested: advertiser writing publisher-owned rows (covered by policy review).
3. Not reviewed yet: Auth rate limits, URL configuration (redirect allow-list), installed extensions.

Leaked Password Protection, SMS MFA and session time-box stay DEFERRED (plan limitation) and are not counted as PASS.
