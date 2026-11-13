# PHASE 6 — DAY 3 — PART 2: Security Follow-up 2 (live results F1, F4, F2, F5)

> **Update 2026-11-13:** live results added in `PHASE6-DAY3-PART2-SECURITY-FOLLOWUP-3-REPORT.md`.

Date: 2026-11-13. No deploy, no Production change, no SQL, no env change. Payments, payouts, ledger OFF. Commit SHA: none (owner will commit at the end, see section 6).
Labels: **OWNER-LIVE** = result reported by owner from real site · **CODE** = sandbox code/tests · **NOT VERIFIED** = not proven.

## 1. F1 — Headers (OWNER-LIVE) and assessment
| Header | Production `blisscco.online` | Preview | Source |
|---|---|---|---|
| CSP | **Missing** | **Missing** | Not set in code (`next.config.mjs`) |
| HSTS | `max-age=63072000` | `max-age=63072000; includeSubDomains; preload` | **Not set in code** (grep: no `Strict-Transport-Security` in repo). Added by Vercel |
| nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy | present | present | `next.config.mjs` (PASS, matches code) |
| X-Robots-Tag noindex | — | present | Vercel Preview default |

**HSTS difference:** platform behaviour, not our code. Preview (Vercel-owned domain) gets `includeSubDomains; preload`; the custom domain gets the plain 2-year value. Production already has HSTS (PASS). Not preload-eligible, which is fine. **Recommendation: no change.** Adding `includeSubDomains`/`preload` on `blisscco.online` is hard to undo; do it only if every subdomain is HTTPS-only and you want preload listing. Status: **PASS (HSTS), no action**. UPDATED: owner-live confirmed, see FOLLOWUP-3.

**CSP requirements (CODE inspection; nothing changed):**
| Directive | Need | Why |
|---|---|---|
| `default-src 'self'` | yes | base |
| `script-src` | `'self'` + inline: Next.js adds inline hydration scripts. Strict = per-request **nonce** (needs middleware on all pages; today matcher is only `/dashboard`, `/login`, `/signup`). Quick = `'unsafe-inline'` (weak for XSS) | no `<script>`/`dangerouslySetInnerHTML` written by us |
| `style-src 'self' 'unsafe-inline'` | yes | 12 `style=` attributes + Next inline styles |
| `img-src 'self' data: https://<project>.supabase.co` | yes | `CreativePreview.tsx` shows signed Storage URLs (`createSignedUrls`) |
| `font-src 'self'` | yes | `next/font/google` is self-hosted at build |
| `connect-src 'self'` | yes | browser Supabase client is unused; `/api/diag` is same-origin |
| `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'` | yes | matches X-Frame-Options DENY |
| `form-action` | **skip at first** | Chrome also checks redirects after a form POST; Google sign-in redirects would break |
**Plan (needs your approval, Preview first):** `Content-Security-Policy-Report-Only` in `next.config.mjs` on Preview → watch DevTools console violations → fix → enforce → Production. No report endpoint exists today. Status: **OPEN (assess only)**. UPDATED 2026-11-13: Report-Only CSP added for Preview only and live-checked: only `vercel.live` toolbar violations, none from our code. Enforcement still needs approval (FOLLOWUP-3).

## 2. F4 — Cookies (Preview observation: HttpOnly off, Secure off, SameSite Lax)
- **CODE:** only 2 places set Supabase cookies (`lib/supabase/server.ts`, `lib/supabase/middleware.ts`); both pass options through `hardenCookieOptions` (HttpOnly, Secure in production, SameSite Lax). No other cookie setter for `sb-` cookies. 7 tests pass.
- **Likely cause (NOT VERIFIED):** the observed set (HttpOnly false, Secure false, Lax) is what you would expect from library defaults, i.e. the Preview is **not running this change yet**, or the cookies were created **before** it. Cookies are rewritten only at login/token refresh, so an old session keeps old flags. I cannot see the deployment from here.
- **To verify (owner):** (a) Vercel Preview deployment commit contains `lib/supabase/cookie-options.ts`; (b) log out, clear site cookies, log in again on that Preview; (c) re-check the `sb-…-auth-token*` rows. If flags are still wrong **on a deployment that has the file**, send the `Set-Cookie` response header (DevTools → Network → any `/dashboard` request → Response Headers, values blanked) and I will treat it as a real bug.
- Status: **PASS** (UPDATED 2026-11-13: after re-login all `sb-` cookies, including the 2 flow cookies, show HttpOnly + Secure + Lax. Old cookies were the cause).

## 3. F2 — `/api/diag` returned 204 instead of 401 on Preview
Possible causes, in order of likelihood:
1. **Preview still runs the old route** (old code always answered 204). 
2. **Test was sent while logged in** (browser console `fetch` with your session): 204 is then the correct answer.
3. **Request carried a foreign `Origin` / cross-site header** (e.g. online API tester): old order answered 204 before checking login.
**Fix (CODE, done):** login is now checked **first**; any logged-out request returns **401** regardless of Origin / Sec-Fetch-Site. Cross-site check runs after login. Only `lib/diagnostics/diag-handler.ts` changed (+2 tests); no other route touched.
**Verify (owner, after deploy, with no cookies):** `curl -i -X POST https://<preview>/api/diag -H "Content-Type: text/plain" -d '{"event":"action_slow"}'` → expect `HTTP/2 401`. If you get Vercel's own login/HTML page, Preview protection is blocking it (not our code). A logged-in browser request should still give 204.
Status: **PASS** (UPDATED 2026-11-13: owner curl, logged out, Preview => `HTTP/2 401`, `cache-control: no-store`, empty body). Logged-in 204 live: NOT TESTED.

## 4. F5 — Payments
Owner says: **no payment provider is set** (OWNER-REPORTED; I did not check Vercel). That means `PAYMENT_PROVIDER` is unset, so `/api/payments/webhook` answers 503 and Cashfree stays inactive. Risk of accidental activation: **Low**. Cashfree code unchanged; Razorpay/Payoneer not touched.

## 5. Tests (CODE, sandbox)
| Run | Total | Pass | Fail | Skip |
|---|---|---|---|---|
| diagnostics + auth folders | 221 | 221 | 0 | 0 |
| Full `npm test` equivalent | 5623 | 5621 | **1** | 1 |
- The 1 fail = same sandbox-only `day 28 part 1: publisher example files compile strictly` (missing real `next`/`react` types). Previous round: 5621 / 5619 / 1 / 1; this round +2 tests, all pass.
- `npm run lint`, `lint:eslint`, `build`: not run in sandbox. UPDATED 2026-11-13: CI #134 (attempt 2), commit `c4dd47336dedf30cfd4a1dcd08bc96dd93eeb246`, branch `preview-day-c`: typecheck, tests (5628/5628), ESLint, production build all passed (OWNER-LIVE: logs + GitHub screenshot). **PASS (CI)**.

## 6. Changed files this round / deferred
| File | Change |
|---|---|
| `lib/diagnostics/diag-handler.ts` | login checked before cross-site check |
| `tests/diagnostics/phase6-day3-part2-diag-auth.test.ts` | +2 tests |
| `PHASE6-DAY3-PART2-SECURITY-FOLLOWUP-2-REPORT.md` | new |
**Deferred (owner, at the end):** commit + push, CI run # and head SHA (lint, test, eslint, build). UPDATED: done, CI-verified head SHA `c4dd47336dedf30cfd4a1dcd08bc96dd93eeb246` (CI #134). Commit SHA: **c4dd473**.
**Apply order:** the previous zip (`phase6-day3-part2-followup.zip`, 8 code/test files) must also be applied; this zip builds on it.

## 7. Remaining risks
- CSP missing on both sites (OPEN, plan above). 
- UPDATED: live cookie flags and live `/api/diag` 401 are now PASS (FOLLOWUP-3). Supabase login error redirect to another Vercel domain: PASS (owner changed Site URL and re-tested). Still pending: live logged-in `/api/diag` 204 and 429.
- Per-instance limiters remain (accepted Day 2).
