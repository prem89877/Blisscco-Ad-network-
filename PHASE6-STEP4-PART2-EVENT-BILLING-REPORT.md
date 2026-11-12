# Phase 6 Step 4 Part 2: Valid Impression / Click Billing

Status: SQL + tests likhe. **Migration kisi bhi database par CHALAYI NAHI gayi** (sandbox me Postgres nahi). Production untouched. Ledger BAND hai.

## 1. Pehle kya tha, ab kya hai (simple bhasha me)
| | Pehle | Ab |
|---|---|---|
| Serve (API response) | CPM/1000 turant kat jaata tha | **Kuch nahi katta.** Sirf budget "hold" (reserve) hota hai |
| CPM campaign | Serve par | Sirf pehle valid **impression** par |
| CPC campaign | Serve par | Sirf pehle valid **click** par (click ko impression chahiye, D4 jaisa pehle) |
| Duplicate / invalid / expired event | -- | Kabhi charge nahi |
| Ledger | Serve ke andar (agar ON) | Event ke andar (ON karna alag approval; abhi OFF) |

Amount aur publisher kabhi client se nahi: pricing `campaigns` row se (serve ke waqt reservation me snapshot), publisher API-key / serve row se.

## 2. Naya table: `ad_budget_reservations`
Ek serve = ek row. `held` -> `settled` (charge hua) ya `released` (24h baad, bina charge). Amount/model/dates badal nahi sakte (trigger). RLS on, kisi role ko grant nahi.

## 3. Budget protection
Serve ke waqt (campaign row lock ke andar): `spent + held + naya hold <= total` aur `<= daily`. Settlement usi lock ke andar hold ko spend banata hai, isliye total (spent+held) badalta nahi. Bahut saari serves ek saath aayein toh bhi budget paar nahi hota. `total_budget` edit aur resume check (`campaign_can_afford_serve`) ab holds bhi ginte hain.

## 4. UTC accounting rules
1. Sab din UTC (`(now() at time zone 'utc')::date`).
2. Spend **serve ke UTC din** par likha jaata hai (event ke din par nahi) -> daily limit sahi rehti hai. 23:59 UTC ki serve + 00:01 UTC ka impression = kharch pichle din ka.
3. Daily check = aaj ka spent + aaj ki zinda holds + naya hold.
4. Total check = saara spent + saari zinda holds + naya hold.
5. Hold umr = serve se exactly 24h = event window. Event `now() >= served_at + 24h` par reject.
6. Release: expire hold turant budget me ginna band; `record_ad_serve` us campaign ki expired holds `released` mark karta hai; bulk ke liye `release_expired_budget_reservations()` (service_role).

## 5. Atomic / retry-safe
`record_ad_impression` / `record_ad_click` ek hi function (ek transaction) me: event insert -> settlement (reservation + spend + ledger). Koi bhi error => event bhi rollback, to retry "duplicate" nahi banta. Dedupe wahi `ad_events_one_per_type_key`. 4-arg `record_ad_serve` (Idempotency-Key), `replay_serve`, serve_ref, tracking token: **badle nahi**.

Legacy: migration se pehle ki serves ki reservation nahi => unke events par dobara charge NAHI.

## 6. Tests (actually run)
- `tests/ads/phase6-step4-part2-event-billing.test.ts`: 50 tests, 50 pass (SQL text checks + model).
- `tests/ledger/phase6-step4-part2-event-ledger.test.ts`: 14 tests, 14 pass.
- `tests/integration/phase6-step4-part2-event-billing-db.test.ts`: **NOT RUN** (TEST DB env nahi; SKIP hota hai). Asli Postgres ka saboot yahi dega.
- Poori suite: 5507 tests, 5495 pass, 11 fail, 1 skip. Wahi 11 purane failures (`@types/node` sandbox me nahi), koi naya nahi.
- Model tests = mera hath se likha aaina, SQL ka saboot nahi. SQL static checks sirf text dekhte hain.

## 7. Zaroori baatein (aapko pata honi chahiye)
1. **Deploy order:** Part 1 migration -> Part 2 migration -> code. Pehle denim par, approval ke baad.
2. **Purana integration test `tests/integration/day9-part5-db.test.ts`** serve par spend maanta hai. Migration lagne ke baad denim par wo fail hoga (naya behaviour sahi hai, test purana). Maine use badla nahi; batayein toh update kar dunga.
3. `load_ad_candidates` aur TS pre-filter ab bhi holds / campaign ke apne rate ko nahi dekhte (sirf pre-filter). DB guard sahi hai, par poora-reserved campaign candidate me aa sakta hai aur serve `rejected` ho sakti hai -> kabhi-kabhi unnecessary no-fill. Agle part me fix ho sakta hai.
4. Inactive publisher ka impression record hota hai par charge nahi.
5. Advertiser serve ke baad daily budget kam kare toh pehle se reserve hui serve settle hogi (reservation us waqt valid thi).
6. `lib/ads/service.ts` / `serve.ts` ke kuch comments abhi bhi "serve par charge" likhte hain (sirf comments, outdated).
7. 4 purane guard tests me sirf allow-list ki ek line judi (naya migration file naam) kyunki wo saari SQL files scan karte hain.
8. `ad_serve_log.served_at` ko DB test backdate karta hai; agar us table par update-guard ho toh wo 2 tests denim par fail honge (tab batana).

---

## UPDATE 2026-11-12 — TEST database results (supersedes "NOT RUN" in section 6)
Evidence labels used in these updates: **VERIFIED** = proof exists (pasted query output, GitHub Actions screenshot or log); **CONFIRMED BY USER** = owner statement, no independent artefact; **INFERRED** = follows logically from verified evidence; **OPEN** = not proven. Production was not touched; no Production SQL was run for any item below.

| Item | Status | Evidence |
|---|---|---|
| Part 2 migration applied on TEST (Denim Hub Bsl) | **VERIFIED** | Footer query on Denim: RLS on `ad_budget_reservations` = true, 0 table grants to app roles, 4 functions present (the security-definer flag was not queried), 0 EXECUTE for PUBLIC/public/anon/authenticated (service_role EXECUTE not queried), ledger OFF (0 enabled) |
| Footer checks 1, 2, 3, 4 (as count), 7 | **VERIFIED (PASS)** | Same output |
| Footer checks 5 and 6 (no overspend queries) | **OPEN** | Not run as queries; the no-overspend behaviour itself is covered by the integration test below |
| `tests/integration/phase6-step4-part2-event-billing-db.test.ts` | **VERIFIED (green)** | GitHub Actions "DB integration (TEST database only)" run #17, green. Pass counts were not visible in the screenshot: **counts NOT VERIFIED** |
| Run history | note | Runs #14 to #16 failed for the reasons listed below; #17 passed after the fixes |

What the failing runs taught (all fixed):
- Tests assumed budgets below $0.01. `campaigns.total_budget` and `daily_budget` are `numeric(12,2)`, so the tests now use total/daily budgets of $0.01 or more and larger CPM rates.
- The rollback test used an inflated spend row, which the day-9-5 spend guard refuses. It now forces the settlement failure with a temporary trigger inside the test transaction (rolled back, plus a safety-net drop).
- Day 9 Part 5, Day 16 Part 2 and Day 18 Part 4 integration tests were written for charge-on-serve and the old response shape. Updated for hold-on-serve, charge-on-impression and the new `billed` field. `npm run test:integration` now runs files serially (`--test-concurrency=1`) because the pooler allows about 15 sessions.
- **Finding (TEST database drift): the retry pieces of `day-12-5` were missing on Denim** (`ad_serve_requests.serve_id`, 4-arg `record_ad_serve`, `replay_serve` with `serve_ref`, `find_idempotent_serve`). A TEST-only script restored them without re-running the 3-arg `record_ad_serve`. Run #17 green is the evidence that retry works again (the retry tests had failed with `column q.serve_id does not exist`).
- **OPEN:** whether Production has the same gap.
