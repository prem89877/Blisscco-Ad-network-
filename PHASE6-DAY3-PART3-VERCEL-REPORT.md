# PHASE 6 — DAY 3 — PART 3: Vercel, Preview and Deployment Safety Verification

Date: 2026-11-13 (UTC) · Scope: read-only. No deploy, rollback, promotion, alias, env, firewall, Production SQL or DB write. No stress test. No publisher contacted. No real key issued. Payments/payouts/ledger/Revive stay OFF.
No secret value was printed or stored. `filter_project_envs` was called **without** `decrypt`; Vercel returned only ciphertext for encrypted vars and empty values for Sensitive vars.

## Evidence labels
- **VERIFIED** = I read it live via the read-only Vercel connector on 2026-11-13 (or read the ZIP).
- **OWNER-REPORTED** = owner told me / earlier reports; I did not see it.
- **NOT TESTED** = not done.
- **BLOCKED** = I cannot do it here (reason given).

## 1. Final verdict
| | Status |
|---|---|
| Vercel read-only audit | **DONE (VERIFIED)** with gaps listed |
| Firewall `ads-rate-limit` | **STILL ACTIVE (VERIFIED)** |
| Preview HTTP checks | **PARTLY DONE (OWNER-RUN, output seen, 2026-11-13 10:02 UTC).** Auth, headers, HTTPS PASS. Valid key PASS. Ad-filled PASS (topic `travel`, TEST key, 2026-11-13 23:24 UTC). Section G output was cut off |
| Deployment protection | **GAP: a red CI can be deployed (VERIFIED from Vercel + owner CI history)** |
| Production | **NO-GO (unchanged).** A green deployment does not approve Production |

## 2. Project and deployments (VERIFIED, Vercel connector, 2026-11-13)
- Project: `blisscco-ads`, `prj_6n4vwxqWJfXi9ojxnutpy0i7HxAQ`, framework nextjs, Node 22.x, function region `icn1`.
- Repo: `prem89877/Blisscco-Ad-network-`.
- Domains: `blisscco.online`, `www.blisscco.online`, `blisscco-ads.vercel.app`, team URL, `…-git-main-…vercel.app`.

| Env | Deployment | State | Commit SHA | Branch | Created (UTC) |
|---|---|---|---|---|---|
| **Preview (latest, re-read 2026-11-14)** | `dpl_BmPEjLw82mrmPgSATjegEJ9KTz7C` | READY | `fd595f37c275facd17adcf3c317286e0cf094abb` | `preview-day-c` | 2026-11-13 23:38 UTC |
| Preview (HTTP checks of 10/10b/10c ran against this one until 23:38 UTC) | `dpl_2Huewrmoap95bBCSJMD3ryqKAL5X` | READY | `c4dd47336dedf30cfd4a1dcd08bc96dd93eeb246` | `preview-day-c` | 2026-11-13 05:27 UTC |
| **Production (latest)** | `dpl_6FjHDgCeTxzAf9L5b1zWQWpHbJVW` | READY | `573b6082ccf49c3b566467e64d63cdacd183736e` | `main` | 2026-11-08 05:54 |

- Preview alias: `blisscco-ads-git-preview-day-c-prem-tadekar-s-projects.vercel.app` (no alias error).
- **Production runs a 5-day-old commit.** It does NOT contain Day 3 changes (N1 destination re-check, N2 comments, CSP Report-Only, `/api/diag` hardening). Everything verified on Preview is **not** verified for Production.
- The Preview SHA `c4dd473…` equals the CI #134 attempt 2 head SHA (OWNER-REPORTED green). The Production SHA `573b608…` has **no CI evidence in my hands**.
- GitHub CI status: **BLOCKED** (no GitHub connector, ZIP has no `.git`). OWNER-REPORTED only: CI #134 attempt 2 green, 5628/5628 tests.

## 3. Environment variables (names, scopes, type; values NOT read)
| Name | Scope | Type | Note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Preview (all branches) | encrypted | separate variable from Production |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | encrypted | separate variable (updated 2026-11-03 00:36) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production + Preview (shared) | encrypted | **shared entry** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preview, branch `preview-day-c` only | encrypted | branch override |
| `SUPABASE_SECRET_KEY` | Preview (all branches) | **sensitive** | |
| `SUPABASE_SECRET_KEY` | Preview, branch `preview-day-c` | **sensitive** | override |
| `SUPABASE_SECRET_KEY` | Production | **sensitive** | |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | **sensitive** | not read by app code (grep of `lib/ app/ config/`); likely legacy |
| `AD_TRACKING_SECRET` | Production + Preview (one entry) | **sensitive** | **same secret in both** |
| `NEXT_PUBLIC_SITE_URL` | Preview / Production (two entries) | encrypted | separate |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Production + Preview | encrypted | |
| `PILOT_METRICS_ENABLED` | Production + Preview | encrypted | |
| `EMERGENCY_STOP_ENFORCED` | **Preview only** | encrypted | **absent on Production** |
| `REGIONAL_ELIGIBILITY_ENFORCED` | Preview only | encrypted | absent on Production (default OFF in code) |

Observations:
- All three real secrets (`SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AD_TRACKING_SECRET`) are **Sensitive** ✔. `securityIssues` empty on every entry. No payment, ledger or Revive variable exists on Vercel ✔ (consistent with OFF).
- `hiddenProductionEnvCount` = 0.
- Flags are encrypted, not Sensitive (acceptable; they are not secrets).

### Preview vs Production Supabase separation
- **Structural: separate** URL and secret-key entries per scope (VERIFIED).
- **Preview URL = TEST project: OBSERVED (indirect).** The Preview CSP header contains `https://ficwuieqjdhrrxbvuqot.supabase.co`, and `config/csp.mjs` builds that origin from `NEXT_PUBLIC_SUPABASE_URL`. Owner states `ficwuieqjdhrrxbvuqot` = TEST (OWNER-REPORTED; matches Day 1 report). Production project ref per owner: `mfliodvkaszqywajbshu` (OWNER-REPORTED).
- **Production URL = `mfli…`: SEEN IN VERCEL UI (owner screenshot, 2026-11-14 05:06 IST):** Preview entry starts `https://ficwuieqj…`, Production entry starts `https://mfliodvka…`. Two different projects. Only the prefix was visible; full value not read. (The current Production deployment has no CSP header, so there is no HTTP observation.)
- **Preview secret key → TEST: inferred only.** The TEST publisher key and TEST campaign worked on Preview, so the Preview server reads a database holding that data. Not proof by value.
- **Remaining by-value gap (original text):** I did not decrypt; ciphertexts differ by design and prove nothing. Owner must compare the project ref in the Supabase dashboard with the two Vercel URL entries.
- **Risk A:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` has one entry for Production+Preview. Only `preview-day-c` has a Preview override. **Any other Preview branch** would pair the Preview URL with the shared key. Likely wrong project or broken auth; at worst a Production-project key against a TEST URL. Owner check.
- **Risk B:** the generic Preview `SUPABASE_SECRET_KEY` (all branches, last edited 2026-11-03 00:40) is older than the `preview-day-c` override (2026-11-04 03:24). Owner must confirm it points to TEST, not Production.
- **Risk C:** `AD_TRACKING_SECRET` is one value for Production and Preview. A tracking token minted on Preview verifies on Production. Recommend separate secrets before pilot.

## 4. Emergency stop gap (VERIFIED + code read)
`lib/ads/emergency-stop.ts`: flag is active only if `EMERGENCY_STOP_ENFORCED` is exactly `"1"`; default OFF. The variable exists **only for Preview**. On Production the emergency stop is **not enforced** until the owner adds it. Same for G3 in earlier reports (still open).

## 5. Vercel Firewall (VERIFIED, read-only, 2026-11-13)
| Item | Day 2 report | Now |
|---|---|---|
| `firewallEnabled` | true | **true** |
| Config version / updatedAt | v1 / 2026-11-12 05:50 UTC | **v1 / 2026-11-12 05:50:57 UTC (unchanged)** |
| Rule | `ads-rate-limit` | `ads-rate-limit`, id `rule_ads_rate_limit_pDzdxn`, **active, valid, no validation errors** |
| Condition | path starts with `/api/v1/ads/` | same |
| Limit | 600 req / 60 s / IP, fixed window | **same** (algo `fixed_window`, key `ip`) |
| Action | 429 | `rate_limit` mitigation (429 per Day 2 observation; status code itself not exposed here) |
| Pending changes / IP rules | none | `changes: []`, `ips: []` |
- Custom rules: 1. Project-wide (Production + Preview).
- OWASP CRS: `gen`, `rce`, `sqli`, `xss` active in **log** mode only (no blocking). Not requested; reported for awareness.
- Not load-tested (not allowed). No rule created, edited or deleted.

## 6. Preview HTTP checks
**Status: BLOCKED for me.** Sandbox network is disabled; my fetch tool refuses URLs I did not see in results, cannot POST and cannot read headers. The Vercel `web_fetch_vercel_url` tool creates a share link (a write), so I did not use it.
- Preview is **publicly reachable**: `ssoProtection` and `passwordProtection` both disabled (VERIFIED).
- Owner script `day3-part3-preview-check.sh` was run; results are in section 10.

Historical (Day 2, OWNER-LIVE; **not** re-observed today):
| Check | Historical result |
|---|---|
| No key / invalid key / Basic | 401 `{"error":"unauthorized"}` |
| Valid key, no eligible ad | 200 `{"fill":false}` |
| Malformed JSON / wrong content-type / body > 2048 B | 400 / 415 / 413 |
| Repeated bad keys | 29× 401, 30th = 429 `retry-after: 60` |
| Valid ad-filled response | **never observed live** |
| Latency | **no Day 2 sample recorded** |
Historical latency (Step 5 report, G6): avg 790 ms, max 2,413 ms against limits 400 / 1,200 ms = FAIL. Source date and environment are not stated. **Not a current observation.**
Day 3 Part 2 (OWNER-LIVE, earlier today): Production headers present except CSP; Preview CSP Report-Only present; `/api/diag` logged-out = 401 no-store. HSTS differs between Preview and Production (Vercel-added).

## 7. Deployment protection review
| Question | Finding | Evidence |
|---|---|---|
| Can a red CI be deployed? | **YES.** Preview deployments for commits whose CI was red are READY: `960ae7f` (CI #132 FAIL, deployed 2026-11-13 04:44) and `6b84594` (CI #133 FAIL, deployed 05:19). `c4dd473` deployed 05:28 although CI #134 attempt 1 had failed | VERIFIED (Vercel states) + OWNER-REPORTED (CI results) |
| Why | Vercel deploys on every push independent of GitHub Actions. `ci.yml` runs on `push`/`pull_request` but nothing makes Vercel wait. `next.config.mjs` sets `eslint.ignoreDuringBuilds: true` | VERIFIED (ZIP) |
| Production `main` deploys | Automatic on push to `main` (deployments from `main` at 2026-11-06, 07, 08) | VERIFIED |
| GitHub branch protection / required checks | **None.** Owner screenshots: Settings → Branches shows no classic rule (05:58 IST); Settings → Rulesets says "You haven't created any rulesets" (05:04 IST) | OWNER SCREENSHOT seen |
| Vercel Deployment Checks | **"No checks configured"** (owner screenshot, Project → Settings → Build and Deployment, 05:02 phone time). Note: this feature gates promotion to Production, not Preview | OWNER SCREENSHOT seen |
| Preview protection | Vercel Authentication and password protection **off** | VERIFIED |
| Rollback readiness | `dpl_6FjHDgCe…` (573b608) and `dpl_5LUfG1DS…` (953bb3d) are rollback candidates | VERIFIED |
| Deployment safety plan item 1.3 | Still "PENDING OWNER CONFIRMATION" | ZIP |
Settings were not changed.

## 8. VERIFIED / OWNER-REPORTED / NOT TESTED / BLOCKED
**VERIFIED (live Vercel read, 2026-11-13):** project/deployment states and SHAs; env names, scopes, Sensitive status; no payment/ledger/Revive env; firewall rule unchanged and active; Preview public; red-CI commits were deployed; Production on old commit; `EMERGENCY_STOP_ENFORCED` absent on Production; ZIP code facts (flags default OFF).

**OWNER-RUN (output seen):** Preview HTTP results in sections 10 and 10b (401 ×7, 308 redirect, security headers, valid key 200, one ad-filled response, latency samples).

**OWNER-REPORTED:** CI #134 attempt 2 green 5628/5628; CI #132/#133/#134-a1 failures; Day 2 curl results; Day 3 Part 2 live headers and `/api/diag` 401; ledger/payments/payouts OFF.

**NOT TESTED:** live 503 (intentionally not induced); server-side ad-match latency (only phone end-to-end samples exist); exact 429 threshold; firewall under load; Preview-to-TEST-DB mapping by value.

**OWNER SCREENSHOTS (seen):** no GitHub branch protection and no Rulesets; Vercel Deployment Checks empty; Vercel env URL prefixes (`ficwuieqj…` Preview, `mfliodvka…` Production); GitHub Actions run list; Vercel deployments list.

**BLOCKED:** HTTP checks by me (no network/POST; owner ran them instead); GitHub CI status read by me directly (screenshots used instead); Production Supabase URL by value (needs decrypt, not allowed).

## 9. Unresolved owner actions (priority order)
1. **High:** Add `EMERGENCY_STOP_ENFORCED=1` to Production **only when you decide**, and test the stop on Production with a safe procedure (G3). Currently OFF on Production.
2. **High:** GitHub has no classic rule and no ruleset; Vercel Deployment Checks is empty (screenshots). Add a ruleset on `main` requiring the `CI` check, and Vercel Deployment Checks. Today a red CI deploys. (Owner decision; I changed nothing.)
3. **High:** Production is on `573b608`. Decide the release path for Day 3 code. Do not call Production verified until CI-green code is deployed and re-checked.
4. ~~The TEST key was pasted in chat.~~ **DONE, OWNER-REPORTED 2026-11-14:** key revoked (not verified by me). 
4b. **Low:** TEST campaign `destination_url` is a real affiliate link; OWNER-REPORTED: Preview-only test campaign. Optionally read TEST DB (read-only) to confirm the 12 match calls created no spend/ledger rows.
5. **Low:** Preview URL = TEST (`ficw…`) and Production URL = `mfli…` are now seen. Still unconfirmed: both Preview secret keys (generic and `preview-day-c`) belong to `ficw…` (inferred only).
6. **Medium:** Split `AD_TRACKING_SECRET` into separate Production and Preview values.
7. **Medium:** Fix the shared `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` scope (branch overrides or Preview-only entry) for non-`preview-day-c` branches.
8. **Low:** Consider Vercel Authentication on Preview (it is public). Confirm `SUPABASE_SERVICE_ROLE_KEY` is unused, then remove it later.
9. **Low:** G6 latency re-measure on 3 occasions (still open).
10. Gates A–D, G2, G4, G8, G11, G12: unchanged, owner-only.

## 10. HTTP results from owner script (OWNER-RUN, output seen; OBSERVED today)
Run: 2026-11-13 10:02:01 UTC, Termux, Android (India). Host: Preview alias `blisscco-ads-git-preview-day-c-…vercel.app`. 12 requests, 1 s apart. Edge `bom1`, function `icn1`. Production not touched. No key printed.

| # | Check | HTTP | total (s) | ttfb (s) | Body |
|---|---|---|---|---|---|
| A | `http://` request | **308** → `https://` same host | — | — | — |
| B1 | no key | 401 | 1.459 (first request, includes cold start) | 1.458 | `{"error":"unauthorized"}` |
| B2 | no key | 401 | 0.334 | 0.333 | same |
| B3 | no key | 401 | 0.361 | 0.360 | same |
| C1 | invalid key | 401 | 0.357 | 0.353 | same |
| C2 | invalid key | 401 | 0.487 | 0.486 | same |
| D | `Basic` scheme | 401 | 0.467 | 0.466 | same |
| E | wrong content-type, no key | 401 | 0.391 | 0.389 | same (auth is checked before content-type) |
| F | valid TEST key / ad-filled | **NOT TESTED** (`BLC_TEST_KEY` not set) | — | — | — |
| G | security headers on `/` | **200** (re-run by owner separately, 2026-11-14, see 10c) | 0.590 | — | — |

Latency summary (7 samples, 401 path only): min 0.334 s, median 0.391 s, max 1.459 s (cold). TLS about 0.07–0.14 s, connect about 0.03–0.065 s.
**Limits:** these are auth-failure responses (no database call), from a phone in India to a function in Seoul. They are **not** ad-match latency, are far below the 50-request minimum for real evidence, and say nothing about G6. Historical G6 (avg 790 ms, max 2,413 ms) is a different measurement and stays **Open**.

Headers on every API response (OBSERVED): `HTTP/2`, `cache-control: no-store`, `content-type: application/json`, `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()`, `content-security-policy-report-only` (self-only, Supabase origin in `img-src`, `frame-ancestors 'none'`), `vary: Authorization`, `x-blisscco-api-version: 1`. `server: Vercel` is shown. **No** `access-control-allow-*` (no CORS, as designed). No stack trace, no key echoed, same body for all 401 cases.
Not seen on API: `retry-after` (only on 429, not triggered), enforced CSP (Report-Only only, as decided).
Also in the paste (earlier, 05:15 UTC, Day 3 Part 2 evidence): `POST /api/diag` logged out = 401, `cache-control: no-store`, empty body. Two lines that started with `fetch(...)` failed in bash because that is browser JavaScript, not a shell command. No effect on results.

Sample count is small by design (no load test). The 20/min app guard was not triggered (2 invalid-key requests).

### 10b. Valid TEST key and ad-filled (OWNER-RUN, output seen; OBSERVED)
Owner supplied an existing TEST publisher key (value not recorded in this report). I could not run the commands myself (the Termux connector only allows `pwd`, `list_files`, `git_*`, `node_version`, `python_version`; Vercel sandbox was not used because of the read-only rule). Preview host only. No impression/click URL opened. 12 requests with the key.

| Run (UTC) | Topic | HTTP | Result | total (s) | ttfb (s) |
|---|---|---|---|---|---|
| 23:22:56 | `travels` (not a supported slug) | 200 | `{"fill":false}` | 2.579 (first, cold) | 2.578 |
| same run, 5 samples | `travels` | 200 ×5 | `{"fill":false}` | 0.531, 0.539, 0.599, 0.577, 0.579 | 0.531–0.598 |
| 23:24:02 | `travel` | 200 | **`{"fill":true,"sponsored":true,"ad":{id, headline, body, cta_text, destination_url}}** | 1.512 (first after idle) | 1.511 |
| same run, 5 samples | `travel` | 200 ×5 | not shown (output to /dev/null) | 0.570, 0.576, 0.576, 0.726, 0.739 | 0.570–0.738 |

- **Valid key accepted: PASS.** No-fill with valid key returns exactly `{"fill":false}`, `cache-control: no-store`, `vary: Authorization`, `x-blisscco-api-version: 1`.
- **Ad-filled: PASS (single observed fill).** Fields seen: `fill`, `sponsored:true`, `ad.id` (`c3fc9b66-…-ca100d970e90`), `headline` "Gautam Tours", `body`, `cta_text`, `destination_url`. No tracking URLs or tokens in the body (tracking not requested). No key or internal field echoed.
- **Topic note:** `travels` is not a supported slug; supported is `travel`. API returned no-fill (not 400). Behaviour is safe.
- **Latency (client in India → Preview, function `icn1`; includes network, TLS and cold start):**
  - Fill path, warm samples n=5: min 0.570, median 0.576, max 0.739 s. First request 1.512 s.
  - No-fill path, warm n=5: 0.531–0.599 s. Cold first 2.579 s.
  - These are **end-to-end phone measurements**, not server time. They do not clear G6 (limits 400/1200 ms, historical avg 790 / max 2413 ms). G6 stays **Open**; sample size is far too small.
- **Finding (needs owner decision):** the TEST campaign `destination_url` is a real third-party affiliate link (`shopsy.in`, Flipkart marketplace, affiliate parameters), while the ad text says "Gautam Tours / Travel With Tour". Confirm this is intended TEST data before any pilot, and that no real user can be sent there. Destination re-check (N1) accepted it.
- **Not verified:** whether these 12 match calls created serve/impression/spend/ledger rows (needs a TEST DB read-only check before/after). No impression, click or payout was triggered by me or, per owner, by the script.

### 10c. Section G: security headers on `/` (OWNER-RUN, output seen; OBSERVED)
Owner re-ran the check separately (UTC time not shown in paste; after the 23:24 UTC run on 2026-11-13). `GET https://<preview-alias>/` → **HTTP/2 200**, total 0.590 s.
Headers present: `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()`, `content-security-policy-report-only` (self-only; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`), `cache-control: public, max-age=0, must-revalidate`.
- Same set as the API responses. **PASS** for Preview.
- CSP is **Report-Only** (not enforced) and still allows `'unsafe-inline'` for script and style. Known; enforcement is a later owner decision.
- Production page headers were **not** re-checked in this part (Day 3 Part 2 recorded them OWNER-LIVE).

## 11. Changes made
None to Vercel, GitHub, Supabase or Production. Files created: this report and `day3-part3-preview-check.sh`.

## 12. Update 2026-11-14 (owner screenshots; supersedes earlier "latest Preview" wording)
| Evidence | What it shows | Label |
|---|---|---|
| GitHub Actions list (05:14 IST) | `preview-day-c`: CI #135 `fd595f3` **green**; DB integration #23 (TEST DB only, manual) **green**; CI #134 `c4dd473` green (latest attempt); CI #133 `6b84594` **red**; CI #132 `960ae7f` **red**; CI #131 `2594671` green; CI #129 `b0aae56` red | OWNER SCREENSHOT |
| Vercel deployments list (05:14 IST) | `fd595f3` Ready (6 min ago), `c4dd473` Ready, `6b84594` **Ready**, `960ae7f` **Ready** | OWNER SCREENSHOT |
| Vercel connector (read-only, re-read now) | Latest Preview `dpl_BmPEjLw8…` = `fd595f37c275facd17adcf3c317286e0cf094abb`, READY, created 2026-11-13 23:38:50 UTC | VERIFIED |
| Match | Latest Vercel Preview SHA = commit of green CI #135. Short SHA seen on GitHub (7 chars), full SHA from Vercel | VERIFIED + SCREENSHOT |
| Red CI deployed | CI #132 and #133 are red, and their Vercel deployments are READY | VERIFIED (both sources agree) |
| GitHub protection | No classic rule, no ruleset | OWNER SCREENSHOT |
| Vercel Deployment Checks | "No checks configured" | OWNER SCREENSHOT |
| Production | Still `573b608` (main, 2026-11-08); not re-deployed | VERIFIED (connector, earlier today) |

Notes:
- This updates section 2: the Preview HTTP checks in sections 10 to 10c ran against `c4dd473` (until 23:38 UTC) and may have partly run on `fd595f3` (the 23:24 UTC fill test was before it). `fd595f3` itself was **not** re-tested over HTTP.
- CI #135 and DB integration #23 are green on `preview-day-c`, but **neither is a CI result for Production's commit** (`573b608`).
- `grok.yml` ("Grok (manual, write access)") exists in `.github/workflows`: manual trigger only, `contents/pull-requests/issues: write`, no secrets, no deploy. Low risk; listed for awareness.
- Production remains **NO-GO**. A green Preview deployment is not Production approval.
