# PHASE 6 — DAY 3 — PART 2: Security Follow-up 3 (live results + CI)

Date: 2026-11-13. No SQL, no env change, no Production change, no payments/payouts/ledger. No secrets printed or stored.
Labels: **OWNER-LIVE** = owner ran it on the real Preview/Production and sent screenshots/output · **CODE** = sandbox code/tests · **NOT TESTED** = not done.
CI: **PASS** (section 5).
Preview host: `blisscco-ads-git-preview-day-c-…vercel.app`. 

## 1. Results
| # | Item | Evidence | Status |
|---|---|---|---|
| F1a | Headers Production (`curl -sI`) | OWNER-LIVE: HSTS, nosniff, X-Frame DENY, Referrer, Permissions present. **CSP missing** | **OPEN** (CSP not enforced) |
| F1b | HSTS difference | OWNER-LIVE: Preview `includeSubDomains; preload`, Production plain `max-age=63072000`. Not in repo code; Vercel adds it | **PASS, no action** |
| F1c | CSP Report-Only on Preview | CODE: `config/csp.mjs` + `next.config.mjs`, 5/5 new tests pass. OWNER-LIVE: Preview response and `curl` show `content-security-policy-report-only` with expected directives and Supabase origin in `img-src` | **PASS** |
| F1d | CSP violations (console) | OWNER-LIVE screenshots: only `[Report Only]` lines are `https://vercel.live/_next-live/feedback/feedback.js` (Vercel Preview toolbar, not our code). Pages seen: publisher dashboard, advertiser dashboard and creatives, admin dashboard, login. Other console noise (`TrustedHTML`, `ch-ua-form-factors`, youtube) comes from `accounts.google.com` | **PASS** (no violation from our code). Not exhaustive: Console may clear on navigation |
| F1e | CSP on Production | Not added, by design (Preview only). Owner decided not to enforce on Production now | **OPEN (deferred by owner)** |
| F4 | Cookie flags | OWNER-LIVE after re-login: `sb-…-auth-token.0/.1`, both `…flow…` cookies, `bc_country_later`, `blc_oauth_intent` all HttpOnly ✓ Secure ✓ SameSite Lax. Earlier missing flags were old cookies. CODE: `hardenCookieOptions` used in `server.ts` and `middleware.ts` | **PASS** |
| F2a | `/api/diag` logged out | OWNER-LIVE `curl -i -X POST` on Preview: `HTTP/2 401`, `cache-control: no-store`, empty body | **PASS** |
| F2b | `/api/diag` logged in => 204 | CODE tests only. Owner tried in Kiwi browser, no output shown; needs logged-in browser (cookie is secret, not usable from Termux/sandbox) | **PENDING (NOT TESTED live)** |
| F2c | `/api/diag` 429 live | CODE tests only; same reason. Per-instance limiter may be inconclusive live (accepted Day 2) | **PENDING (NOT TESTED live)** |
| F5 | Payments | OWNER-REPORTED: no payment provider set. Not checked on Vercel by me. Webhook answers 503 when unset (CODE) | **PASS (owner-reported)** |
| N1 | Login error redirect (`flow_state_already_used` sent to `denim-store-bsl.vercel.app`, 503) | OWNER-LIVE: owner set Supabase Site URL to the production domain (I cannot see the dashboard) and re-tested login on Preview: no error, no redirect. Earlier cause (Site URL / Redirect URLs) is consistent but not proven by me | **PASS** (owner-reported) |
| N2 | Item 4 of owner's list = CI results | OWNER-LIVE: CI #134 (attempt 2) green, see section 5 | **PASS** |

## 2. Static inspection vs executed
- **Static (CODE):** headers in `next.config.mjs`, CSP definition, cookie hardening, `/api/diag` handler order (login before cross-site check). No SQL executed, no RLS changed.
- **Executed by owner (live):** F1a, F1b, F1c, F1d, F4, F2a.
- **Executed in sandbox:** CSP test (5/5). Earlier round: 5623 tests, 5621 pass, 1 sandbox-only fail (`day 28 part 1`, missing real `next`/`react` types), 1 skip.

## 3. Code changed this round
| File | Change |
|---|---|
| `config/csp.mjs` (new) | CSP Report-Only, Preview only |
| `next.config.mjs` | adds `...cspHeaders(process.env)`; 4 old headers unchanged |
| `tests/diagnostics/phase6-day3-part2-csp.test.ts` (new) | 5 tests |
| `tests/diagnostics/phase6-day3-part2-diag-auth.test.ts` | type fix only (CI #132) |
| `tests/ads/day14-part4-integration.test.ts` | flaky `flip` helper fixed (CI #133), no protection weakened |

## 4. Remaining
- **OPEN (deferred by owner):** CSP enforcement (Preview first, then Production, needs approval). If Preview enforces, `https://vercel.live` must be allowed there only.
- **PENDING:** F2b, F2c (live logged-in `/api/diag` 204 and 429). Code tests pass; no live proof.
- Per-instance limiters remain (accepted Day 2).

## 5. CI (OWNER-LIVE: logs + GitHub Actions screenshot; not run by me)
| Run | Commit | Result | Cause / fix |
|---|---|---|---|
| #132 | `960ae7f` | FAIL | type error in diag test; fixed (`phase6-day3-part2-ci-fix.zip`) |
| #133 | `6b84594` | FAIL | 2 flaky tamper tests (`flip` helper, ~1.6% chance); fixed (`phase6-day3-part2-ci-fix-2.zip`) |
| #134 attempt 1 | `c4dd473` | FAIL | `next/font` Google Fonts download crash at build (runner/network, no code change); tests and lint had passed |
| **#134 attempt 2** | `c4dd47336dedf30cfd4a1dcd08bc96dd93eeb246` | **PASS** | install, typecheck, tests **5628 / 5628**, ESLint clean, `next build` compiled, 16/16 pages |

- **CI status: PASS (verified by owner logs + screenshot).** Final head SHA: `c4dd47336dedf30cfd4a1dcd08bc96dd93eeb246`, branch `preview-day-c`.
- The sandbox-only failure (`day 28 part 1`) does not occur in CI (0 failed).
- **NOT TESTED:** DB integration workflow this round (last green: #22, Nov 12, before these changes; no SQL changed here).
- CI does not prove the live items in section 1; those stay as listed.
