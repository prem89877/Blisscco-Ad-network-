# Blisscco Online Ad Network — MVP Feature Status (Day 30 Part 1)

This document describes what the current repository contains, based only on the existing code. It is a documentation task: no application behavior, SQL, migration, credential, payment, ledger or deployment file was changed.

**Nothing was run to write it.** No test, type check, lint, build, `npm install`, database check or live endpoint check was started. "Implemented" below means "the code is present in the repository". It does not mean "tested" or "working in a deployed environment".

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
- **A deployed Preview or Production environment that has been checked.** Nothing here confirms either one, or which SQL files have been applied to any database.
- **Matching on conversation text, user profiles or an external AI service.** Not implemented, by design.

## Known verification limitations

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

## What stays manual

- Run the official checks and the TEST PostgreSQL integration yourself, after MVP completion.
- Obtain a real Revive URL from its owner and check it in Preview only, using the existing checklist in `DAY27-REAL-REVIVE-VERIFICATION.md`.
- Keep `REVIVE_FALLBACK_ENABLED` and `REVIVE_JSON_PREVIEW_ENABLED` unset until that check is done.

## Not changed

Application behavior, SQL and migration files, Production data, credentials, payment and ledger behavior, and deployment and workflow configuration were not changed by this task. No `.sh` script was added, so `.github/workflows/ci.yml` is unchanged.
