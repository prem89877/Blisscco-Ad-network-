# Day 12 | Part 1 : Event tracking architecture (impression / click / dedupe)

**Is part me koi SQL nahi chalaya, denim (test) ya asli Supabase se connect nahi kiya, koi migration repo me nahi joda.**
Sirf repo padha, 2 user-facing labels theek kiye, ye report likhi, aur ek reality-check test joda.
**Charge ka aadhar abhi bhi "serve" hai.** Impression par le jana is part me nahi hua (alag verified billing design chahiye).
**Revive Adserver integrated NAHI hai.** Repo me uska koi code, config, env var, table ya route nahi hai (neeche proof).

---

## 1. Actual flow (code se trace kiya)

`POST /api/ads/match` aur `POST /api/v1/ads/match` -> dono `lib/ads/match-handler.ts` -> `lib/ads/service.ts` -> `lib/ads/serve.ts` (`serveAd`).

| Kadam | Kahan | Database call |
|---|---|---|
| 0. IP guard, Bearer key format, JSON/size/idempotency header check | `match-handler.ts` | koi nahi |
| 1. Authorize (key hash -> publisher, rate limit) | `serve-db.ts` `authorizePublisher` | rpc `authorize_publisher_key` |
| 1b. Retry check (sirf `Idempotency-Key` ho toh) | `findIdempotentServe` | rpc `find_idempotent_serve` |
| 2. Topic -> canonical category plan (+ fallback topics) | `category-matching.ts` | koi nahi |
| 3. Candidates + eligibility + ranking | `candidate-loader.ts`, `selection.ts` | rpc `load_ad_candidates` (sirf read) |
| 4. Serve record (creative dobara verify, budget lock, spend, log, counter) | `recordServe` | rpc `record_ad_serve` (3-arg ya 4-arg), max 3 attempts |
| 5. Response: sirf 5 public fields | `contract.ts` `buildAdResponse` | koi nahi |

### Paanch alag cheezein (aaj kya hota hai)

| Stage | Matlab | Aaj repo me | Kaun dekhta hai | Kahan likha jaata hai |
|---|---|---|---|---|
| **Selected** | Selection layer ne eligible creative chuna | Hota hai, **koi record nahi**. Selection akeli kuch nahi likhti (test se pakka) | Sirf Blisscco server memory | Kahin nahi |
| **Serve recorded** | DB ne creative dobara verify kiya, budget gate paar kiya, **spend + log + counter ek transaction me** likhe | **Hota hai.** Yahi charge ka aadhar hai | Blisscco DB | `ad_serve_log`, `creative_serve_daily`, `campaign_spend_daily`, (retry key ho toh) `ad_serve_requests` |
| **Rendered** | Publisher ke chatbot ne ad ko screen par sach me banaya | **Blisscco ko pata nahi chalta.** Koi callback nahi | Sirf publisher | Kahin nahi |
| **Impression verified** | Blisscco ne verify kiya ki ek serve ka ad dikha | **Exist nahi karta** | - | - |
| **Click recorded** | Blisscco ne verify kiya ki ek serve ke ad par click hua | **Exist nahi karta.** `destination_url` seedha publisher ko jaata hai, Blisscco ke raste se nahi | - | - |

Seedhi baat: **serve != render != impression**. Ek 200 response ka matlab sirf "DB ne ek unit charge karke ad diya". Publisher use dikhaye bhi ya nahi, Blisscco ko nahi pata.

---

## 2. Kya sach me hai aur kya nahi (har cheez repo se check ki)

### Hai (file ke saath)
| Cheez | Proof |
|---|---|
| 2 match routes, ek shared handler | `app/api/ads/match/route.ts`, `app/api/v1/ads/match/route.ts`, `lib/ads/match-handler.ts` |
| RPCs: `authorize_publisher_key`, `record_ad_serve` (3 aur 4 args), `find_idempotent_serve`, `load_ad_candidates`, `get_my_campaign_spend` | `day-5-8`, `day-7-1`, `day-9-5`, `day-9-7` SQL |
| Tables: `ad_serve_log`, `creative_serve_daily`, `campaign_spend_daily`, `ad_serve_requests`, `api_rate_limits`, `ad_platform_settings` | `day-5-3`, `day-9-5` SQL |
| Sab tables par RLS on + sab roles (service_role bhi) se grant hata hua. Sirf `security definer` functions chhoo sakte hain | `day-5-3`, `day-9-5` SQL |
| Advertiser ko sirf apne campaign ka spend + `servesTotal` | `get_my_campaign_spend` -> `lib/campaigns/queries.ts` -> campaign detail page |
| Roz raat purge (90 din; retry keys 48 ghante) | `private.purge_old_ad_logs`, `cron.schedule` (agar pg_cron on ho) |

### NAHI hai (grep + test se pakka)
| Cheez | Result |
|---|---|
| Revive: koi code / SQL / env var / config | 0 matches (sirf docs aur "nahi hai" wale tests me naam aata hai) |
| Impression / click table, function, route, pixel, beacon, webhook | Koi nahi |
| Per-serve public reference (`serve_ref`) | Koi nahi. `ad_serve_log.id` ek `bigint identity` hai, API me kahin nahi jaata |
| `ad_serve_requests` me serve log se link | Nahi hai (sirf publisher, key, creative, campaign) |
| Publisher ya advertiser ke liye asli analytics | Nahi. `/dashboard/analytics` sirf "Not available yet" text hai. `AnalyticsView.tsx` demo data par hai aur **kahin mount nahi** (kisi page se import nahi hota). `lib/demo-data.ts` ke impressions/clicks nakli hain |
| Campaign/creative ka Revive me sync | Nahi |

---

## 3. Identifiers: aaj kya bahar jaata hai

| Identifier | Kaun dekh sakta hai | Kaisa hai | Event ke liye bharosemand? |
|---|---|---|---|
| `ad.id` (creative UUID) | Publisher (response me, `exclude_ad_ids` ke liye) | Public, guess/copy ho sakta hai, serve ka saboot nahi | **Nahi.** Isse event accept karna = koi bhi fake impression/click bhej sakta hai |
| `ad_serve_log.id` (bigint) | Sirf DB | Sequential, enumerate ho sakta hai | **Nahi bahar dena.** Bahar dene se doosre publisher ke serves ka andaza lagega |
| Campaign id, advertiser id, publisher id | Publisher ko kabhi nahi | UUID | Bahar nahi jaana chahiye |
| `Idempotency-Key` | Publisher (apni chuni hui) | 8-64 chars, publisher-scoped, 48 ghante | Retry-safety ke liye hai, event identity ke liye nahi |
| Publisher API key | Sirf publisher ka server | `blc_live_...`, DB me sirf hash | Browser me kabhi nahi jaani chahiye (guide yahi kehta hai) |

**Gap:** ek served ad ko publisher + campaign + creative + "ye wala serve" se jodne ka koi bahar-safe tareeka abhi nahi hai. Andar (DB me) `ad_serve_log` ek row me publisher, creative, campaign rakhta hai, bas uska koi opaque reference nahi.

---

## 4. Design: ek hi authoritative ingestion + dedupe path

### 4.1 `serve_ref` (naya opaque reference)
- **128-bit random** (16 bytes, base64url, prefix `bsr_`), `record_ad_serve` ke andar, usi transaction me banta hai.
- `ad_serve_log` me unique column (`serve_ref`). `ad_serve_requests` me bhi wahi `serve_ref` store hota hai.
- **Retry par wahi `serve_ref` wapas aata hai** (replay naya reference nahi banata). Isse "ek retried serve = do events" wala duplicate band hota hai.
- Publisher/campaign/creative **kabhi event ke saath caller se nahi liye jaate**: `serve_ref` se DB serve row dhoondta hai aur wahin se teeno nikalta hai. Isliye database IDs bahar nahi jaate aur caller galat attribution bhej nahi sakta.
- Random + DB lookup chuna hai (signed stateless token nahi) kyunki: revoke/expire ho sakta hai, "ek baar" gin sakte hain, aur secret rotate karne ka jhanjhat nahi.

### 4.2 Event authentication (kaun kya bhej sakta hai)
| Sender | Kaise authenticate | Kya bhej sakta hai |
|---|---|---|
| Publisher ka **server** | Wahi Bearer key (pehle se hai) + `serve_ref` | `impression`, `click` (apni hi serves ke liye; serve ka publisher key ke publisher se match hona zaroori) |
| **Browser** (chatbot UI) | Publisher key nahi. Choti umr ka **signed event token** (HMAC: `serve_ref + event_type + expiry`), Blisscco server banata hai | Sirf token wala ek `event_type` |
| **Revive** (agar chuna gaya) | **Blisscco ke endpoint par** server-to-server, HMAC signature + timestamp (replay window ~5 min), alag secret per source | `impression` / `click` jinke saath Blisscco ka `serve_ref` ho |
| Click (user) | Blisscco redirect endpoint: `serve_ref` se `destination_url` **DB se** nikalta hai. URL query se kabhi nahi (open redirect nahi) | `click` |

Revive (ya koi bhi source) **seedha Blisscco DB nahi likhta**. Sab ek hi Blisscco server function se guzarte hain.

### 4.3 Single writer + dedupe
Ek hi database function (proposed naam `record_ad_event`, `security definer`, sirf `service_role` execute), **sab sources ke liye ek jaisi**:

1. `serve_ref` se serve row dhoondo. Nahi mili / purge ho chuki / window se bahar => `rejected` (kuch nahi likhta).
2. Publisher match: token/key ka publisher == serve ka publisher.
3. Time rules: `occurred_at >= served_at`, future me nahi (thoda clock skew), impression ke liye max delay (decision: 1 ya 24 ghante).
4. `insert ... on conflict do nothing`. Teen unique rules:
   - **Ek serve = ek verified impression** (`unique (serve_id) where event_type='impression' and status='verified'`).
   - **Ek serve = ek verified click** (same pattern; policy decision neeche).
   - **`unique (source, external_event_id)`** jahan external id ho: Revive ka wahi event dobara aaye toh no-op.
5. Return: `recorded` | `duplicate` | `rejected`. `duplicate` publisher ko error nahi, success jaisa (idempotent).

**Dedupe ka asli niyam:** gin-ti ki pehchaan **Blisscco ka `serve_ref` + event type** hai. Revive ya kisi aur ki apni id sirf `external_event_id` (replay rokne ke liye) hai, ginti ki pehchaan nahi. Agar Revive aur Blisscco beacon dono chalein, tab bhi **ek serve ka ek hi verified impression** ban sakta hai (doosra `duplicate`). Revive ke apne totals Blisscco ke totals me **kabhi jode nahi jaate**; sirf reconciliation (milaan) ke liye dekhe jaate hain.

### 4.4 Revive ko lekar sachchai
- Blisscco ka API **text ad** deta hai jo publisher khud render karta hai. Revive Adserver mool roop se banner/zone delivery tool hai. Dono ek hi serve ko "apna" na maanein, isliye upar ka design kehta hai: **serve Blisscco ka, event ka single path Blisscco ka, Revive sirf ek possible event source.**
- Revive ke events me Blisscco ka `serve_ref` kaise jayega (custom parameter / zone setup / forwarding), aur Revive ka kaun sa feature kitna kaam karta hai: **ye maine verify nahi kiya**. Build se pehle Revive docs/version se verify karna hoga. Jab tak verify na ho, Revive ko "chosen" mat maano.
- **Revive event bina `serve_ref` ke aaye => reject.** Blisscco use kabhi apne aap serve se jodta nahi (guess/attribution = fraud ka darwaza).
- Blisscco -> Revive campaign/creative sync abhi exist nahi karta aur is part me banaya nahi.

---

## 5. Duplicate-event risk register

| # | Risk | Aaj | Roka kaise (design) |
|---|---|---|---|
| R1 | Publisher bina `Idempotency-Key` ke retry kare => 2 serves, 2 charges | **Haqeeqat aaj.** Guide me likha hai | Billing impression par jaane se pehle bhi key zaroori; docs me already warning |
| R2 | Ek hi creative `exclude_ad_ids` na bhejne ya soft exclude se dobara serve ho | Haqeeqat aaj | Har serve ka alag `serve_ref`; impression verified hone se serve != impression alag dikhega |
| R3 | Browser beacon do baar (reload, double render, network retry) | N/A | `unique(serve_id)` impression par; doosra = `duplicate` |
| R4 | Revive + Blisscco beacon dono ginein | N/A | Ek hi `record_ad_event`; pehchaan `serve_ref`, Revive ki id sirf replay guard |
| R5 | Revive webhook replay | N/A | Signature + timestamp window + `unique(source, external_event_id)` |
| R6 | Idempotent retry naya `serve_ref` bana de | N/A | `serve_ref` `ad_serve_requests` me store, replay me wahi wapas |
| R7 | Link preview bots / prefetch / scanner click gin lein | N/A | Click sirf redirect GET par, token ek-baar, impression ke baad hi click valid (decision), bot UA + rate limit |
| R8 | Public creative id se fake impression/click | N/A | Creative id event ke liye accept nahi; sirf `serve_ref` |
| R9 | Ek publisher doosre ka `serve_ref` use kare | N/A | Publisher match check (4.3 step 2) |
| R10 | Purge: `ad_serve_log` 90 din, `ad_serve_requests` 48 ghante | **Haqeeqat aaj** | Event window retention se chhoti; events table ki apni retention aur billing-window decision |
| R11 | `serve_ref` guess/enumerate | N/A | 128-bit random, sequential id kabhi bahar nahi |
| R12 | Clock skew / future timestamp | N/A | Server `received_at` ko hi bharosa; client `occurred_at` sirf check ke liye, limit ke andar |
| R13 | Bot/automated traffic | Koi filter nahi | Ye Part 1 me design nahi; rate limit + UA/ASN rules alag part (decision) |

---

## 6. Trust boundaries

| Boundary | Trusted? | Niyam |
|---|---|---|
| Publisher ka browser | **Nahi** | API key kabhi nahi; sirf short-lived signed event token; token ek `serve_ref` + ek event type tak seemit |
| Publisher ka server | Authenticated, par ginti ka malik nahi | Apni hi serves ke events; baaki sab verify |
| Revive (agar aaya) | **Nahi** (alag system, alag operator) | HMAC + timestamp; `serve_ref` zaroori; Blisscco endpoint ke raste se hi; seedha DB nahi |
| Blisscco Next.js server | Trusted | Service-role key sirf `createAdminClient()` me (pehle se) |
| Postgres `security definer` functions | Trusted, **atomic** | Spend/budget/event likhne ka ek hi tareeka; tables par direct grant nahi |
| Advertiser dashboard | Authenticated | Sirf apne campaign ke aggregates (function `get_my_*` jaisa) |

---

## 7. Required migrations (PROPOSED, abhi koi nahi chali, koi `supabase/sql` me nahi joda)

> Existing tests jaan-boojh kar `supabase/sql` me impression/click table aur "revive" shabd rokte hain. Jab aap approval doge, tab ye tests bhi saath me jaan-boojh kar update honge. Pehle **denim (test)** par, phir asli par.

| # | Migration | Kya | Risk |
|---|---|---|---|
| M1 | `serve_ref` | `ad_serve_log.serve_ref` (unique, not null for naye rows), `ad_serve_requests.serve_ref`. `record_ad_serve` (3 aur 4 args) `serve_ref` banaye aur jsonb result me `serve_ref` key jode. Purani rows ke liye nullable/backfill decision | Medium: hot function badalta hai. Spend/idempotency tests dobara chalane honge |
| M2 | `ad_events` table | RLS on, saare roles se revoke, FK `serve_id`, unique rules (4.3), status/source CHECKs | Low |
| M3 | `record_ad_event` | Single writer function, `service_role` only, `on conflict do nothing` | Medium (security-sensitive) |
| M4 | Event aggregates | `get_my_campaign_events` jaisa read function (advertiser/publisher), sirf verified rows | Low |
| M5 | Retention | Event window < serve log retention; events ki retention; `creative_serve_daily` purge ka masla (neeche 8.2) | Medium |
| M6 | Comment cleanup | `campaign_spend_daily` ka stale comment (neeche 8.1) | Low |

**Billing migration is list me nahi hai.** Wo alag verified design maangta hai (impression par charge, budget reservation, refund/void, publisher payout).

---

## 8. Is part me mile asli issues

### 8.1 Fix ho gaye (safe, confirmed)
1. **Advertiser campaign page par "Ads shown" galat label tha.** Wo `servesTotal` dikhata hai (ad chatbot ko diya gaya), "dikha" nahi. Ab "Ads served" + chhota explanation. Impression ke bare me koi naya claim nahi.
2. **`/dashboard/analytics` ka text** "number of ads shown" kehta tha. Ab "ads served (handed to a chatbot, not necessarily seen by a person)".
3. Dono jagah purane tests ke zaroori phrases ("Not tracked yet", "not tracked yet") waise hi hain.

### 8.2 Mile par SQL chahiye (approval ke baad)
1. **Latent bug:** `get_my_campaign_spend.serves_total` `creative_serve_daily` ka sum hai, aur `purge_old_ad_logs` use 90 din baad delete karti hai (cron on ho toh roz). `campaign_spend_daily` kabhi delete nahi hoti. Matlab 90+ din purane campaign par **spend poora dikhega par "ads served" ghat jayega**. Label me abhi warning laga di; asli fix (lifetime counter ya purge band) migration M5 me.
2. **Stale DB comment:** `day-5-3` ka `comment on table campaign_spend_daily` kehta hai "Abhi koi likhta nahi (impression tracking Day 6)". Galat hai: `record_ad_serve` har serve par likhta hai. Applied migration file badli nahi; fix M6 me.
3. `day-5-8` ke comment me `spendTracking = "unavailable"` likha hai; code me ab `"reliable"` hai. Sirf comment, behaviour sahi.

---

## 9. Implementation order (har step ke baad aapki approval)

1. **Aap decide karo** (neeche section 10).
2. M1 + M2 + M3 ka SQL likhna (draft sirf), aapko dikhana, **denim par** chalana (aapki approval se), rollback-only tests.
3. `lib/ads` me `recordEvent` (pure + db split, `serve.ts` jaisa), tests: dup, replay, wrong publisher, expired, retry same `serve_ref`.
4. Event endpoint(s) + signed token + click redirect (alag routes, v1 match contract nahi chhute).
5. Revive: pehle Revive docs verify, phir forwarder + HMAC verify (agar chuna gaya).
6. Advertiser/publisher dashboard par asli verified numbers, demo data hatao.
7. Billing design alag document, alag approval, tab hi charge ka aadhar badlega.

---

## 10. Baaki faisle (aapke)

| # | Faisla | Meri raay |
|---|---|---|
| D1 | Revive sach me use hoga ya Blisscco ka apna beacon/redirect? | Pehle Blisscco-native (text ad ke liye seedha), Revive baad me source ke roop me |
| D2 | `serve_ref` publisher ko kaise mile? (a) v1 success me naya optional field (b) opt-in request header (c) naya `/v2` | (b) ya (c). (a) existing contract ki "exact keys" test aur docs todega |
| D3 | Ek serve par kitne verified clicks ginein (1 ya zyada)? | 1 |
| D4 | Click ke liye impression pehle zaroori? | Haan |
| D5 | Impression ki max delay (serve ke baad) | 1-24 ghante, aap choose |
| D6 | Bot/fraud rules ka scope | Alag part |
| D7 | `serves_total` purge masla: lifetime counter ya purge band? | Lifetime counter (M5) |
| D8 | Billing impression par kab aur kaise | Alag design |

---

## 11. Is part me kya badla

| File | Kya |
|---|---|
| `app/dashboard/advertiser/campaigns/[id]/page.tsx` | "Ads shown" -> "Ads served" + explanation |
| `app/dashboard/analytics/page.tsx` | "ads shown" -> "ads served ..." |
| `DAY12-PART1-ARCHITECTURE.md` | Ye report (naya) |
| `tests/ads/day12-part1-architecture.test.ts` | Reality-check test (naya) |

API contract, publisher auth, eligibility, atomic budget, idempotency: **koi code nahi badla**.
