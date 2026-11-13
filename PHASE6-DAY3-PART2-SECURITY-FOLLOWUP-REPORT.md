# PHASE 6 — DAY 3 — PART 2: Security Follow-up (F1–F5 approved decisions)

Date: 2026-11-13. Source: uploaded ZIP (unchanged; no `.git`, **commit SHA: none** — owner commits). Scope: only the approved F1–F5 decisions.
No SQL, no env change, no deploy, no Production/TEST access. Payments, payouts, ledger OFF (untouched). Razorpay/Payoneer not implemented or activated.
Labels: **LIVE** = real website/cookies · **CODE** = code/tests in sandbox. Anything not completed is NOT claimed as PASS.

## 1. Status per finding
| # | Decision | What was done | CODE | LIVE |
|---|---|---|---|---|
| F1 | B: verify live headers, no config change | **No config change.** Sandbox has no network and no site URL, so headers could not be fetched | n/a | **NOT TESTED** (owner step below). CSP/HSTS present or missing: **UNKNOWN**. Code (`next.config.mjs`) sets neither (unchanged) |
| F2 | A: secure `/api/diag` | Login required (verified JWT via `getClaims()`), per-user 30/min + per-instance 120/min in-memory limit, `Sec-Fetch-Site` cross-site refused, old quiet rules kept | **IMPLEMENTED, tested, passed** | **NOT TESTED** (needs deploy) |
| F3 | A: keep Day 2 per-instance limiter | **Unchanged.** No Redis/shared storage (a test locks "no Redis import" for diag) | n/a | n/a |
| F4 | A: verify live cookies, fix flags | Cookie flags forced in code: HttpOnly, Secure (production), SameSite Lax (None never kept), path `/`. Applied in `lib/supabase/server.ts` and `lib/supabase/middleware.ts` | **IMPLEMENTED, tested, passed** | **NOT TESTED**: live flags before/after not seen |
| F5 | B: Cashfree code unchanged, inactive | **Unchanged.** No timestamp-window work. Risk below | n/a | n/a |

## 2. Code changes (CODE)
| File | Change |
|---|---|
| `lib/diagnostics/diag-handler.ts` | NEW. Pure handler: cross-site check, login, limiter, same field whitelist/log line as before |
| `app/api/diag/route.ts` | Now thin: `getClaims()` login + calls handler |
| `lib/supabase/cookie-options.ts` | NEW. `hardenCookieOptions()` |
| `lib/supabase/server.ts` | `cookieStore.set(..., hardenCookieOptions(options))` (+ import) |
| `lib/supabase/middleware.ts` | `response.cookies.set(..., hardenCookieOptions(options))` (+ import) |
| `tests/diagnostics/diagnostics.test.ts` | Route tests now call handler with an injected login; wiring checks point to handler. Same assertions (log line, 204 quiet rules), none weakened |
| `tests/diagnostics/phase6-day3-part2-diag-auth.test.ts` | NEW, 13 tests |
| `tests/auth/phase6-day3-part2-cookie-flags.test.ts` | NEW, 7 tests |
| `PHASE6-DAY3-PART2-SECURITY-FOLLOWUP-REPORT.md` | NEW (this file) |
No script added, `.github/workflows/ci.yml` unchanged (not needed).

## 3. Tests (CODE, sandbox, global `tsc` + borrowed `@types/node`)
| Run | Total | Pass | Fail | Skip |
|---|---|---|---|---|
| diagnostics + auth folders | 219 | 219 | 0 | 0 |
| New tests only (13 + 7) | 20 | 20 | 0 | 0 |
| Security-related subset (same 28 files + new cookie/diag) | 694 | 694 | 0 | 0 |
| Full `npm test` equivalent | 5621 | 5619 | **1** | 1 |
- Before this change: 5601 / 5599 / 1 / 1. Now +20 new tests, all pass. The 1 fail is the same sandbox-only `day 28 part 1: publisher example files compile strictly` (needs real `next`/`react` types). The 1 skip is unchanged.
- **Not run here:** `npm run lint`, `npm run lint:eslint`, `npm run build`, DB tests. Must be green in CI before this is called done. Status: **NOT VERIFIED**.

## 4. Behaviour changes owner must know
1. **F2:** a logged-out visitor's error-screen report (`app/error.tsx`, `app/global-error.tsx` on public pages) now gets 401 and is not logged. The old route comment allowed logged-out reports; the approved auth rule removes them. Dashboard buttons/errors (logged in) keep working. The sender is fire-and-forget, so no UI effect.
2. **F4:** HttpOnly means browser JS cannot read the session cookie. Safe today: `lib/supabase/client.ts` (browser client) is imported nowhere (a test locks this); OAuth and code exchange are server-side. If anyone imports the browser client later, login state breaks in the browser. Existing users keep old cookies until the next token refresh/login (cookies are rewritten only then).
3. **F4:** Secure is forced only when `NODE_ENV=production` (Vercel Preview and Production are https).

## 5. F5 — future accidental activation risk (report only)
- Cashfree adapter stays in `REGISTRY` (`lib/payments/provider.ts` line 49). Activation needs only env: `PAYMENT_PROVIDER=cashfree` + `CASHFREE_ENV=sandbox` + client id/secret. `.env.example` has these as commented lines (uncommenting by mistake is the realistic path).
- Impact if activated by mistake: `/api/payments/webhook` would accept Cashfree webhooks (HMAC checked, constant-time, no timestamp window; events idempotent, status re-read from provider API). Cashfree is BLOCKED by the provider per code comment, so real events are unlikely.
- Mitigation not applied (out of scope): remove Cashfree from `REGISTRY` or add a test that fails if `PAYMENT_PROVIDER=cashfree` appears in any deploy doc. Owner check: confirm `PAYMENT_PROVIDER` is **unset** on Vercel Production/Preview. Re-open timestamp-window work only if Cashfree is ever used.
- Planned Razorpay + Payoneer: **not touched.** (Razorpay adapter already exists in code, inactive; no Payoneer code.)

## 6. Owner actions (not executed by me; need your go-ahead / deploy)
1. **F1 live headers** (any page): `curl -sI https://<your-site>/ | grep -i -E "strict-transport-security|content-security-policy|x-frame|x-content-type"`. Send output; I report CSP/HSTS present or missing.
2. **F4 live cookies:** log in on the deployed site, then Browser DevTools → Application → Cookies → the `sb-…-auth-token*` rows: check HttpOnly, Secure, SameSite. Do before and after deploying this change if possible.
3. **F2 live:** after deploy, `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<your-site>/api/diag -H "Content-Type: text/plain" -d '{"event":"action_slow"}'` → expect **401**. Logged-in browser action slow report → expect a `[diag]` line in Vercel logs.
4. Commit, push, confirm CI (lint, test, eslint, build) is green and send the run # + head SHA.
5. Check `PAYMENT_PROVIDER` is unset on Vercel (F5).

## 7. Remaining risks / deferred
- F1: CSP/HSTS status unknown until step 1; no header change made (decision B).
- F3: per-instance limits remain bypassable across instances (accepted Day 2); edge rule `ads-rate-limit` is the real cap.
- F5: Cashfree code remains in repo; timestamp window deferred.
- Not verified: lint/eslint/build, live Set-Cookie flags, live `/api/diag` 401/429.
- Commit SHA: none.
