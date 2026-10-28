# Day 12 | Part 2 : Event database foundation (serve_ref + ad_events)

**Koi SQL kisi Supabase project par NAHI chalayi** (na denim test, na blisscco ad network asli). Supabase se connect bhi nahi kiya.
Schema repo ki `supabase/sql` files se padha (day-5-3, day-5-8, day-7-1, day-9-5, day-9-7). **Sirf versioned SQL files likhi hain.** Aapki approval ke baad hi chalegi.
**Billing nahi badli, serve ko impression nahi gina:** `record_ad_serve`, spend, `campaign_spend_daily`, API response, publisher contract, app code: kuch nahi badla.

---

## 1. D1 aur D2 (Day 12 Part 1 ke faisle, "jaise mentioned hai")

| Faisla | Kaise lagu hua | Is part me |
|---|---|---|
| **D1: Blisscco-native events pehle, Revive baad me** | `ad_events.source` generic hai: `blisscco_beacon`, `blisscco_redirect`, `publisher_server`, `external` (baad me koi bhi bahari system). Kisi bahari ad-server ka naam/code/table nahi | **DB me ho gaya** (migration 2) |
| **D2: serve_ref publisher ko opt-in request header se** | DB me `ad_serve_log.serve_ref` har naye serve ko apne aap milta hai (migration 1) | **DB tayyar. Header ka API code NAHI likha** (ye part "sirf SQL files" tha, aur header ke liye `record_ad_serve` badalna padega) |

D2 ka baaki kaam (agla part, aapki approval se): `record_ad_serve` (3 aur 4 args) + `find_idempotent_serve` ko `serve_ref` wapas dene wala banana, retry par wahi `serve_ref`, aur opt-in header wala API code.

---

## 2. Migration order

| # | File | Kya | Risk |
|---|---|---|---|
| 1 | `supabase/sql/day-12-1-serve-ref.sql` | `ad_serve_log.serve_ref` (default se auto), unique index, format CHECK, "naye rows me null nahi" CHECK (NOT VALID), `UNIQUE (id, publisher_id, creative_id, campaign_id)` | Low: additive, table rewrite nahi, purani rows nahi chhuti |
| 2 | `supabase/sql/day-12-2-ad-events.sql` | `ad_events` table, dedupe rules, composite FK, guard trigger, RLS + revoke, `purge_old_ad_logs` update | Low-Medium: naya table + ek function replace (retention) |
| 3 | `supabase/sql/day-12-3-event-verify.sql` | READ-ONLY jaanch (23 checks, ek table me PASS/FAIL). Test aur asli dono par chal sakti hai | Koi nahi (sirf SELECT) |
| 4 | `supabase/sql/day-12-4-event-tests.sql` | 7 rollback-only test blocks (T1-T7). **Sirf denim (test) par** | Koi nahi (har block rollback) |

Chalane ka order: **1 -> 2 -> 3**, phir sirf test project par **4**. Pehle **denim (test)**, phir approval ke baad **blisscco ad network (asli)** par sirf 1, 2, 3.

### Dependencies
- Migration 1 ko `day-5-3` (ad_serve_log) chahiye. Migration 2 ko migration 1 (composite FK uski unique key par tikta hai) aur `day-9-5` (`ad_serve_requests` table, purge ka purana version) chahiye.
- Test (file 4) ko `day-3-6` ka SETUP block (TEST Publisher C/D, TEST Campaign A/B, TEST creative A) chahiye. T7 ko `private.issue_publisher_key` aur `day-9-3/9-5/9-7` chahiye (jaise `day-9-6` ke tests).
- Dono migrations dobara chalane par safe hain (`if not exists`, `create or replace`, constraint checks).

---

## 3. Design (sabse chhota safe badlav)

**Serve reference.** `serve_ref` = `bsr_` + 40 hex (>= 150 bit random, `gen_random_uuid()` se; koi extension nahi). Column ka `DEFAULT` hai, isliye **`record_ad_serve` ko badalna nahi pada**: uska INSERT is column ko likhta hi nahi, to default chalta hai. Default baad ke alag step me set hota hai, isliye table rewrite/backfill nahi: **purani serves ka `serve_ref` NULL rehta hai** aur unpar event aa hi nahi sakta (jaan-boojh kar: bina reference ke unhe koi nahi jod sakta, aur historical data nahi badla).

**Sahi attribution DB khud pakka karti hai.** `ad_events` ka composite FK `(serve_id, publisher_id, creative_id, campaign_id)` -> `ad_serve_log` ki unique key. Matlab galat publisher/campaign/creative wala event insert hi nahi ho sakta, chahe likhne wala koi bhi ho.

**Event model.** `event_type` = `serve | impression | click`, alag rows. `ad_serve_log` hi serve ka authoritative record aur billing ka aadhar hai; koi trigger/function serve se event nahi banata (test se pakka).

**Dedupe.**
| Rule | Kaise | Violation |
|---|---|---|
| Har event ki apni unique id | `unique (event_id)` (DB default `gen_random_uuid()`) | 23505 |
| Ek serve = ek serve-event, ek impression, ek click (D3 = 1) | `unique (serve_id, event_type)` | 23505 |
| Bhejne wale ki id se replay | unique `(source, external_event_id)` jahan id ho | 23505 |

**Guard trigger.** `ad_events` append-only (UPDATE band), aur event apni serve se pehle ka nahi ho sakta (1 min clock-skew chhoot). CHECK: `occurred_at` future me (5 min se zyada) nahi.

**Privacy.** Columns sirf: `id, event_id, serve_id, publisher_id, campaign_id, creative_id, event_type, source, external_event_id, occurred_at, received_at`. Chatbot prompt, IP, user agent, user id, email, referrer, cookie: **kuch nahi**. (Static test aur verify SQL dono column list pakki karte hain.)

**Access.** RLS on, koi policy nahi, `public/anon/authenticated/service_role` sabse table + sequence ke grants hata hue (project ka wahi tareeka: `day-5-3`). Abhi koi function `ad_events` me likhta nahi, isliye table sirf owner (postgres) se chhua ja sakta hai.

**Retention.** `private.purge_old_ad_logs` ab pehle `ad_events` (90 din ke serve-cutoff se purani serves ke), phir `ad_serve_log` hatata hai (FK RESTRICT hai, isliye order zaroori). Purana kaam same: minimum 30 din, rate limits 1 din, retry keys 48 ghante, `campaign_spend_daily` **kabhi nahi chhuti**. Event kabhi apni serve se purana nahi hota, isliye events serve ke saath hi jate hain. pg_cron job (day-7-1) wahi function chalata hai, to naya job nahi chahiye.

---

## 4. Files changed

**Naye (new): 6**
1. `supabase/sql/day-12-1-serve-ref.sql`
2. `supabase/sql/day-12-2-ad-events.sql`
3. `supabase/sql/day-12-3-event-verify.sql`
4. `supabase/sql/day-12-4-event-tests.sql`
5. `tests/ads/day12-part2-event-db.test.ts`
6. `DAY12-PART2-EVENT-DB.md` (ye report)

**Updated: 4**
1. `tests/ads/day9-part6-final.test.ts`: "koi impression/click table nahi" ka check ab table ke **naam** par hai (pehle `create table ... impression` ke andar kahin bhi shabd aane par fail hota; `ad_events` ke type check me "impression" hone se galat fail hota).
2. `tests/ads/day10-part6-final.test.ts`: wahi badlav.
3. `tests/ads/day12-part1-architecture.test.ts`: "event/serve_ref SQL kahin nahi" ab "sirf ye 3 Day 12 files me hai, `record_ad_event` writer abhi nahi" ho gaya.
4. `supabase/SCHEMA-OVERVIEW.md`: Day 12 migrations jodi, purani line "impression/click ka koi table nahi" sahi ki.

Ye teen test badlav confirmed galat-fail the (naya table jaan-boojh kar aa raha hai), isliye bina puche theek kiye. Unke asli maqsad (alag impression/click tables nahi, Revive nahi, app code me tracking nahi) wahi rakhe.

---

## 5. Rollback

Migrations additive hain, par ek baar events likhne lagein to rollback me data jayega. **Rollback SQL abhi chalane ke liye file me nahi rakhi** (galti se chalne se bachne ke liye). Zaroorat pade to:

1. **Migration 2 undo** (events table me data jayega; pehle events chahiye to export karo): `drop table public.ad_events;` aur `drop function private.guard_ad_event();`. **Purge function wapas** `day-9-5-atomic-spend-idempotency.sql` ke `purge_old_ad_logs` block se dobara `create or replace` karo (nahi to function `ad_events` dhoondhega aur error dega).
2. **Migration 1 undo** (migration 2 undo ke BAAD hi): `alter table public.ad_serve_log drop constraint ad_serve_log_attribution_key, drop constraint ad_serve_log_serve_ref_required, drop constraint ad_serve_log_serve_ref_format;` phir `drop index public.ad_serve_log_serve_ref_key;` aur `alter table public.ad_serve_log drop column serve_ref;`.
3. Spend, serve log ki purani rows, API par asar nahi padta: unhe in migrations ne chhua hi nahi.

Aage ki baatein: `ad_serve_log_serve_ref_required` NOT VALID hai (purani rows NULL). Jab 90+ din baad purani rows purge ho jayein, tab `alter table public.ad_serve_log validate constraint ad_serve_log_serve_ref_required;` chala sakte ho.

Lock: migration 1 `ad_serve_log` par chhote waqt ke liye lock leta hai (constraint/index banate waqt). Kam traffic me chalao.

---

## 6. Tests: kya actually chala, kya NAHI

| Test | Result |
|---|---|
| `tests/ads/day12-part2-event-db.test.ts` (naya, static: migrations additive, constraints, privacy columns, purge order, billing untouched, API/code me `serve_ref` nahi, test/verify SQL ki shakl) | **17/17 PASS** (15 migration/SQL checks + 2 report checks) |
| `tests/ads/day12-part1-architecture.test.ts` (updated) | **9/9 PASS** |
| `day9-part6-final` ke 2 badle hue tests (Revive nahi; impression/click table naam) | **2/2 PASS** |
| `day10-part6-final` ke 2 badle hue tests (Revive/ad server nahi; impression/click/conversion table naam) | **2/2 PASS** |

**Kaise chalaye:** sandbox me `node_modules`/`tsc` aur network nahi hai, isliye `npm test` **NOT RUN**. Maine ye tests Node 22 ke `--experimental-strip-types` se ek chhote harness me chalaye (sirf file padhne wale static tests; `@/` imports wale baaki tests stub kiye gaye). Poora `npm test` aapko khud chalana hoga.

| Cheez | Status |
|---|---|
| `day-12-1`, `day-12-2` migrations kisi Postgres par | **NOT RUN** (sandbox me Postgres nahi; SQL syntax ko sirf padh kar aur static test se jaancha) |
| `day-12-3-event-verify.sql` | **NOT RUN** |
| `day-12-4-event-tests.sql` T1-T7 (duplicate, invalid reference, unauthorized, retention, billing unchanged) | **NOT RUN** (denim par aap chalayenge) |
| Poora `npm test`, `tsc`, build | **NOT RUN** |
| Supabase (denim ya asli) se koi connection | **NAHI kiya** |

Koi test "PASS" tab maano jab aap denim par chalakar result dekh lo.

---

## 7. Aapke liye steps (approval ke baad)

1. **denim (test)**: `day-12-1` -> `day-12-2` -> `day-12-3` (sab 23 checks `PASS` hone chahiye) -> `day-12-4` ke 7 blocks alag alag (har ek me status = PASS).
2. Result bhejo. Koi FAIL ho to main fix karunga.
3. Tab batao to **blisscco ad network (asli)** ke liye sirf `day-12-1`, `day-12-2`, `day-12-3` (aur kam traffic me).

## 8. Abhi ke baaki faisle / agla part

- **D2 ka code:** `record_ad_serve`/`find_idempotent_serve` se `serve_ref` wapas lana + opt-in header (approval chahiye: hot function badlega, spend/idempotency tests dobara chalenge).
- **Writer function** `record_ad_event` (sirf `service_role`, `on conflict do nothing`, D4 click ke liye impression pehle, D5 impression max delay). Is part me nahi.
- **D6 bot/fraud** aur **D8 impression par billing**: alag part, alag approval.
- **`serves_total` purge masla (D7, Part 1 sec 8.2):** abhi bhi khula hai. `creative_serve_daily` 90 din baad purge hoti hai to purani campaign ka "ads served" ghat jata hai. Ye is part me nahi badla (billing/reporting ke paas hai).
