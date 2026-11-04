# Blisscco Online Ad Network — MVP Feature Status (Day 30 Part 1)

This document describes what the current repository contains, based only on the existing code. It is a documentation task: no application behavior, SQL, migration, credential, payment, ledger or deployment file was changed.

**Nothing was run to write it.** No test, type check, lint, build, `npm install`, database check or live endpoint check was started. "Implemented" below means "the code is present in the repository". It does not mean "tested" or "working in a deployed environment".

**Status update (Phase 2 Step 4).** The paragraph above describes the original authoring of this file. Later steps recorded results from other people and other runs. They are kept apart in the section "Evidence status by source (Phase 2 Step 4)" below, each with its source. "Implemented" still means only that the code is present. A feature counts as checked only where that section says so.

## Implemented features

Code is present for each item. None has been confirmed by a run (see "Known verification limitations").

### Advertiser

- Advertiser account setup, and a dashboard area at `app/dashboard/advertiser/campaigns/`.
- Campaign create and edit: name, one of nine categories (developer tools, education, finance, fitness, food, gaming, lifestyle, technology, travel), total budget, optional daily budget, start date and optional end date (`app/dashboard/advertiser/campaigns/actions.ts`, `lib/campaigns/validation.ts`).
- Campaign statuses: draft, pending review, active, paused, completed, rejected, archived (`lib/campaigns/constants.ts`).
- Ad creatives per campaign (headline, body, button text, https destination URL; up to 20 per campaign) with status changes (`creative-actions.ts`, `lib/campaigns/creative-validation.ts`).
- Send for review, pause and resume (`changeCampaignReviewState`, `pauseCampaign`, `resumeCampaign`).
- A delivery note on the campaign page that explains why a campaign may not be showing ads (`lib/campaigns/delivery.ts`, `components/campaigns/DeliveryNote.tsx`).
- Per-campaign performance panel (impressions, clicks, CTR) and an advertiser analytics overview (`lib/ads/campaign-performance.ts`, `lib/ads/analytics-overview.ts`).
- Admin review of campaigns and accounts (`app/dashboard/admin/`).

### Publisher

- Publisher platform setup, admin approval, and a four-step setup guidance list (`lib/publisher/setup-guidance.ts`).
- API key create, rotate and revoke. A key is shown once; only a hash is stored (`lib/publisher/keys.ts`, `lib/publisher/keys-db.ts`).
- Publisher guide page with quick-start, route table and the match, impression and click contracts (`app/dashboard/publisher/guide/page.tsx`).
- Publisher analytics (impressions, clicks, CTR for the publisher's own traffic) and an earnings page that reads ledger entries (`lib/ads/publisher-overview.ts`, `lib/ledger/earnings.ts`).
- Manual payout requests: the publisher requests, an admin approves, rejects or marks paid. "Paid" is only a record that money was sent outside the system; no payment provider is used (`lib/payouts/rules.ts`).

### Contextual ad matching

- `POST /api/v1/ads/match` and the older `POST /api/ads/match` run the same handler (`lib/ads/match-handler.ts`).
- Request: bearer publisher key, JSON body with only `topic`, `fallback_topics` and `exclude_ad_ids`. Free text and other fields are rejected. Optional `Idempotency-Key` and `X-Blisscco-Tracking` headers.
- Match is by exact category slug or fixed alias only. There is no substring matching, no hierarchy and no profiling of people (`lib/ads/category-matching.ts`, `lib/ads/taxonomy.ts`).
- Sensitive topics (for example health, religion, politics) return no ad.
- Eligibility: active campaign, active advertiser, approved creative, UTC date window and budget left (`lib/ads/selection.ts`). Ordering is deterministic.
- The publisher receives only public ad fields and `sponsored: true`. Responses are `no-store`. Bad keys, rate limits, oversized bodies and unexpected errors return fixed JSON errors (401, 429, 413, 503).

### Tracking

- Opt-in signed tracking token (HMAC) and a signed click reference, both time-limited (default one hour) (`lib/ads/tracking-token.ts`, `lib/ads/click-ref.ts`).
- `POST /api/v1/ads/impression` accepts the token. `GET /api/v1/ads/click?ref=...` redirects to the destination stored in the database, never to a URL from the request.
- Only the first impression and the first click per serve count. Repeats return a duplicate result or still redirect, and write nothing new.
- Tracking is switched off safely when `AD_TRACKING_SECRET` is missing or weak. The ad is still returned, without a `tracking` field.
- By the code comments, the charge happens at serve time in the database function `record_ad_serve`. An impression or click does not charge a second time.

### Dashboard

- Role-based navigation for advertiser, publisher and admin (`lib/dashboard-nav.ts`).
- Overview, campaigns, publisher, admin, analytics and account-status pages read from the database through the signed-in session.
- The analytics pages show an error notice instead of made-up zeros when data cannot be loaded.
- Public pages: landing, privacy, terms, login and signup.

### Fallback ads (optional, off by default)

- Blisscco-first routing: Blisscco's own ad is tried first. Only a genuine "no fill" can reach the fallback (`lib/ads/fallback-routing.ts`).
- The fallback needs the server flag `REVIVE_FALLBACK_ENABLED` to be exactly `"true"` and a server-only delivery URL. Default is off. The default timeout is 800 ms. Redirects are not followed (`lib/ads/revive-adapter.ts`, `lib/ads/fallback-provider.ts`).
- A provider answer is accepted only if it passes the JSON contract: four plain-text fields and an https destination. HTML or script tags are never accepted as a creative.
- Sensitive topics never reach the provider.
- A provider ad has `sponsored: true` and no `tracking` or `click_ref`. It creates no serve record, no advertiser charge, no ledger entry and no publisher earning.
- The code is attached to the match endpoint through `serveMatchForPublisher` in `lib/ads/service.ts`. It has never been run against a real Revive server.

## Prototypes and previews

These exist in the repository but are not a connected, working feature.

- **Revive JSON preview route**, `GET /api/revive-json-preview` (`app/api/revive-json-preview/route.ts`, `lib/ads/revive-json-preview.ts`). It is off unless `REVIVE_JSON_PREVIEW_ENABLED` is exactly `"true"`, and then it returns a fixed test creative pointing at `example.com`. It is not connected to the match API, fallback, serving, billing, tracking or ledger. **The Revive JSON preview is not proof of a live Revive integration.** It only shows the JSON shape that Blisscco's own contract accepts. It does not show that any Revive server produces that shape.
- **Static fixture** `examples/revive-provider/ad.json`. A plain file with placeholder values. No Revive server made it, and no application code reads it.
- **Manual check scripts** `scripts/revive-json-preview-check.mjs` and `scripts/revive-preview-smoke-test.mjs`, for a Preview deployment only. Neither has been run.
- **Official-check helper** `scripts/day28-verify.sh`. A manual helper that chains the project checks. It has not been run, and CI does not call it.
- **Publisher example code** in `examples/publisher-node/` and `examples/publisher-nextjs/`. Sample files for publishers to copy. They are not part of the application and have not been run.
- **Demo-only dashboard pieces**: `lib/demo-data.ts` and the components that read it (`AdvertiserWorkspace`, `CampaignsExplorer`, `CampaignTable`, `AnalyticsView`). A text search of `app/`, `components/` and `lib/` found no page importing `AdvertiserWorkspace`, `CampaignsExplorer` or `AnalyticsView`. `CampaignTable` is imported only by `CampaignsExplorer`. The numbers in them are made-up and are not shown by the current dashboard pages. `RecentCampaigns` and `ActivityList` are also not imported anywhere.

## Not yet integrated

- **A real Revive endpoint.** No real Revive URL, account or response exists in the repository. Nothing has contacted one.
- **Tracking, reporting or billing for Revive ads.** Provider ads are not counted, charged or paid out by Blisscco.
- **Revive HTML or JavaScript ad tags.** Rejected by design.
- **A payment provider.** There is no automatic payout and no code that collects payment from advertisers. Payout "paid" is a manual record.
- **A Production environment that has been checked.** Production was never accessed for any check recorded here, and nothing here shows which SQL files have been applied to the Production database. A dedicated Preview with a TEST data source was checked by hand by the user for the routes listed in the evidence section, and for nothing else.
- **Matching on conversation text, user profiles or an external AI service.** Not implemented, by design.

## Known verification limitations

This list is the state at the time this file was first written. It is not rewritten item by item. Results reported later for the same items are in the Step 4 evidence section below, with their sources.

All of the following are pending. No result is claimed for any of them.

- Official dependency installation (`npm ci` from `package-lock.json`).
- Tests (`npm test`), including the Day 30 test file written with this document.
- Type check (`npm run lint`, which runs `tsc --noEmit`).
- ESLint (`npm run lint:eslint`).
- Production build (`npm run build`).
- GitHub CI (`.github/workflows/ci.yml`): no run was started or read.
- TEST PostgreSQL: the manual "DB integration" workflow and the database integration tests have not run against any TEST database.
- Real Revive endpoint verification: not done. Nothing has been checked against a real Revive server, and no Preview deployment has been contacted.

Feature descriptions above are therefore implemented, not verified. They may contain mistakes that only a run will show.

## Evidence status by source (Phase 2 Step 4)

This section keeps five kinds of evidence apart. Mixing them would make a mocked test look like a Preview result, or a user's report look like a log.

- **Implemented**: the code is present (the sections above). It is not evidence of anything else.
- **Automated**: a test file ran against in-memory fakes. It shows the code matches what the test expects. It is not a Preview result and not a real database result.
- **Preview**: a person ran the exact request against the dedicated Preview with a TEST publisher key. Claude had no access to the Preview host and saw no raw output.
- **User-confirmed**: a label that is not used for anything the user did not personally run. It is the user's word, with no log, run link or count attached.
- **Pending or unverified**: no result exists, or a result exists but does not cover the claim.

Full detail and sources: `DAY-C-PREVIEW-MANUAL-VERIFICATION-REPORT.md`, `DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md`, `PHASE2-STEP2-CAMPAIGN-PAGE-FIX-REPORT.md`, `PHASE2-STEP3-AD-SERVING-REGRESSION-REPORT.md`, `PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md` and `MVP-VERIFICATION-RUNBOOK.md`.

### Phase 2 Step 4 status (Preview, TEST publisher key, user-run)

| Feature | Source | Status |
|---|---|---|
| Valid key accepted, wrong key and missing key refused with 401 | Day C report, section 3 | **User-confirmed — completed successfully** |
| Key in the query string or the body refused, revoked key refused | Day C report, section 4 | **User-confirmed — completed successfully** |
| Match with an approved TEST campaign returns the ad, version header and no-store | Day C report, section 3 | **User-confirmed — completed successfully** |
| No-fill for a topic without a campaign and for a sensitive topic | Day C report, section 3 | **User-confirmed — completed successfully** |
| Tracking token and click reference only with the opt-in header | Day C report, sections 3 and 4 | **User-confirmed — completed successfully** |
| Impression recorded, repeat is a duplicate, changed token refused | Day C report, section 3 | **User-confirmed — completed successfully** |
| Click redirects to the stored destination, changed reference refused | Day C report, section 3 | **User-confirmed — completed successfully** |
| Wrong Content-Type gives 415, unknown body field gives 400 | Day C report, section 4 | **User-confirmed — completed successfully** |
| Impression and click leave advertiser spend unchanged | Day C report, section 4 | **User-confirmed — completed successfully** |
| Revive fallback and Revive preview flags unset in Preview | Day C report, section 4 | **User-confirmed — completed successfully** |

### Reported by the user, no log seen

| Area | Source | Status |
|---|---|---|
| Local npm checks (Day A) | Day B report, section 1 | Done (user's word only) |
| GitHub CI on the latest commit | Day B report, section 2 | Done (user's word only), no run link or counts seen |
| Real PostgreSQL integration run against the TEST project | Day B report, section 1 | Done (user's word only), no test count given |
| Google sign-in on the Preview site | Day C report, section 2 | Done (user's word only), observed while setting up Preview |
| GitHub CI after the Step 3 and Step 4 changes | User's report, 2026-11-04 | Done (user's word only), no run link, commit or counts seen |
| Real PostgreSQL recheck on the TEST project after the Step 3 and Step 4 changes | User's report, 2026-11-04 | Done (user's word only), no test count seen |

### Automated checks and what they do not cover

| Area | Source | Status |
|---|---|---|
| Ad serving regression tests with in-memory fakes, run in Claude's sandbox | Step 3 report | Automated, mocked. Preview recheck reported by the user, see Phase 2 Step 5 status. GitHub CI for the Step 3 changes: Done (user's word only), reported 2026-11-04, no run link or commit seen |
| Documentation-contract file for the publisher onboarding document, run by the user in Termux before the Step 4 edits (output seen by Claude) | Step 4 report | Automated, no failure in the output seen. Counts are in the Step 4 report |
| Documentation-contract files for the documents edited in Step 4, run in Claude's sandbox | Step 4 report | Automated, no network. Termux rerun reported by the user, see Phase 2 Step 5 status. GitHub CI after the edits: Done (user's word only), reported 2026-11-04, no run link or commit seen |
| Revive fallback wiring in the match path | Existing tests with a fake provider | Automated, mocked. Never run against a real Revive server, so **Unverified** |
| Publisher example code in `examples/publisher-node/` and `examples/publisher-nextjs/` | Existing tests with a mocked Blisscco API | Automated, mocked, and never run by an automated test against a real API. The user reports a manual run (Phase 2 Step 5 status) but no output or details were shared, so the automated evidence alone stays **Unverified** |

### Failed, pending and unverified

| Item | Source | Status |
|---|---|---|
| Two earlier CI runs failed because of document-test matching rules, not application code | Day B report, section 2 | Failed earlier. The user later reported a good run, with no link seen |
| Advertiser campaign page error screen seen once after saving a creative | Step 2 report | **Pending**, root cause not found, no code changed. Old issue not reproduced in latest user-confirmed Preview check (new advertiser account, 2026-11-04); root cause remains unknown. A user rerun on 2026-11-04 is in Phase 2 Step 5 status and does not name a cause |
| Controlled Revive test | Day C report, section 4 | **Pending**, not approved, not run |
| Revive JSON preview route, static fixture and manual check scripts | Prototype section above | **Unverified**, flags unset in Preview, scripts never run |
| Real Revive endpoint, and billing or tracking for Revive ads | Not integrated section above | Not integrated, **Unverified** |
| Whether the scheduled cleanup of old serve, event and retry records is switched on | Read-only look at the TEST project on 2026-11-03: the cleanup function exists, the `pg_cron` extension is not installed, so no nightly schedule exists there. Production was not looked at | TEST: not scheduled. Production: **Unverified** |
| Publisher earnings, ledger and payout pages on Preview | No Preview check recorded | **Unverified** in Preview |
| Admin review pages and manual creative approval on Preview | Day C report notes only; automated tests passed in Termux, see `PHASE2-STEP1-ADMIN-REVIEW-VERIFICATION-REPORT.md` | **Unverified** on Preview (manual checks pending) |
| Production deployment and Production data | Never accessed | **Unverified** |

### Phase 2 Step 5 status (user-run manual checks, 2026-11-04)

The user reported that these checks were run by hand. Claude saw no commands, output or counts. Each row covers only what it names. Payment checkout and Revive are not integrated, so their rows above stay Pending or Unverified, and so do the campaign page root cause and Production. GitHub CI and the real PostgreSQL recheck are in the table "Reported by the user, no log seen", as the user's word only.

| Feature | Source | Status |
|---|---|---|
| Recheck on Preview of key handling, ad match, no-fill, impression and click after the Step 3 and Step 4 changes | User's report, 2026-11-04 | **User-confirmed — completed successfully** |
| Termux rerun of the documentation-contract files after the Step 4 edits | User's report, 2026-11-04 | **User-confirmed — completed successfully** |
| Publisher example code in `examples/publisher-node/` and `examples/publisher-nextjs/` run by hand | User's report, 2026-11-04 | **User-confirmed — completed successfully** |
| Rerun on Preview: add an ad, then send it for review, on the advertiser page | User's report, 2026-11-04 | **User-confirmed — completed successfully** |

## What stays manual

- Run the official checks and the TEST PostgreSQL integration yourself, after MVP completion.
- Obtain a real Revive URL from its owner and check it in Preview only, using the existing checklist in `DAY27-REAL-REVIVE-VERIFICATION.md`.
- Keep `REVIVE_FALLBACK_ENABLED` and `REVIVE_JSON_PREVIEW_ENABLED` unset until that check is done.

## Not changed

Application behavior, SQL and migration files, Production data, credentials, payment and ledger behavior, and deployment and workflow configuration were not changed by this task. No `.sh` script was added, so `.github/workflows/ci.yml` is unchanged.
