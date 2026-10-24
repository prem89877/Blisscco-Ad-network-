# Day 6 plan: serve counts, impressions aur kharch (SIRF PLAN: koi code/SQL nahi likha)

Tumhari approval ke baad hi implement hoga. Neeche 3 faisle hain; har ek me meri recommendation likhi hai.

## 0. Abhi ki sthiti

- `ad_serve_log` aur `creative_serve_daily` sirf `match_contextual_ad` likhta hai (serve = humne ad diya).
- `campaign_spend_daily` me koi nahi likhta, isliye kharch hamesha 0. Budget ka asli hisaab nahi hai.
- Selection layer (TypeScript) read-only hai aur route se jura nahi.
- Billing/advertiser se paisa lena is plan me NAHI hai. "Spend" sirf andar ka hisaab hai.

## 1. Faisla 1: selection kahan chalega (architecture)

**Path 1 (meri recommendation): SQL hi authority rahe.**
`match_contextual_ad` me `random()` hata kar wahi deterministic order SQL me lana (nayi migration; pehle SQL dikhaunga). Auth + rate limit + selection + serve record ek hi transaction me, jaise abhi hai. TypeScript module "tested spec" ki tarah rahega (ek test SQL aur TS ke rules ko compare kare, jaise taxonomy ka hai).
- Fayda: ek atomic jagah, race nahi, Day 5 ki security jaisi ki taisi.
- Nuksan: rules do jagah (SQL + TS); TS layer production me use nahi hogi.

**Path 2: TypeScript chune, database record kare.**
Route: auth + rate limit -> `loadAdCandidates` -> `selectAd` -> nayi `record_serve(...)` function jo ek hi transaction me creative ko dobara verify karke serve log likhe.
- Fayda: TS layer asli use me.
- Nuksan: select aur record ke beech race (do requests ek hi creative chunen; budget thoda paar ho sakta hai); SQL me phir bhi eligibility dobara likhni padegi; zyada functions.

## 2. Faisla 2: impression aur kharch kaise likhe jayein

Impression = publisher ne asli me ad dikhaya (serve se alag). Paisa impression par hi count hoga.

Zaroori hissa (teeno options me same):
- `ad_serve_log` me ek random `serve_token` (uuid) aur us waqt ki `unit_cost_usd`; serve ke jawab me publisher ko sirf ye token milta hai (guess hone wala bigint id nahi).
- Nayi `ad_impressions` table: `serve_id` PRIMARY KEY (ek serve = ek impression, duplicate report par kuch nahi badalta), `publisher_id`, `creative_id`, `campaign_id`, `cost_usd`, `recorded_at`.
- `record_impression(p_key_hash, p_token)` (security definer, sirf service_role): key verify, token usi publisher ka ho, token ek ghante (tay karna hai) se purana na ho, `insert ... on conflict do nothing`; sirf tab jab nayi row bani ho: `campaign_spend_daily` me kharch jodna (upsert). Sab ek transaction me.
- Route `POST /api/ads/impression` (publisher server se, API key ke saath).
- Clicks alag table `ad_clicks`, CPM model me kharch nahi badhata.

Budget policy (ek chuno):
- **A. Impression par kharch, serve par kuch nahi.** Sabse simple. Nuksan: serve aur impression ke beech ke "raaste me" ads budget paar karwa sakte hain (overshoot).
- **B. Serve par reserve, impression na aaye toh TTL ke baad wapas.** Sabse sakht, overshoot nahi. Nuksan: reservation table + cleanup job, zyada complex.
- **C (meri recommendation): hybrid.** Kharch impression par, par budget check me pichhle ~15 minute ke bina-impression wale serves ko "pending" gino. Overshoot chhota aur bounded, aur complexity kam.

## 3. Faisla 3: baaki chhoti baatein

- CPM abhi poore platform ke liye ek (`ad_platform_settings.cpm_usd`, default 2.00 USD). Campaign-wise CPM chahiye toh `campaigns` me column (migration).
- Currency USD hi (Day 3 ka niyam).
- Day: UTC (campaigns me timezone column nahi).

## 4. Order (approve hone par)

1. Migration: `serve_token`, `unit_cost_usd`, `ad_impressions`, aur kharch likhne ka function. SQL tests.
2. `record_impression` + SQL tests (duplicate, galat publisher, purana token, budget paar).
3. Route `/api/ads/impression` + TS tests.
4. Path 1/2 ke hisaab se selection ko route me lana; DB budget gate ab asli kharch par chalega. Tab TS me `spendTracking = "reliable"`.
5. Publisher dashboard me asli impression numbers (baad me).

Har kadam par pehle SQL/plan dikhaunga, phir file banaunga, aur jo chala/nahi chala wo sach-sach likhunga.

## 5. Tumhe batana hai

1. Path 1 ya Path 2?
2. Budget policy A, B ya C?
3. Token ki umar (default: 1 ghanta)?
4. CPM abhi poore platform ke liye ek hi rahe?
