# Day 5: contextual ad matching engine (foundation)

Ye Day 5 ka guide hai. Pehle "Kya CHALA aur kya NAHI" padho (sach-sach).

## 1. Kya chala aur kya NAHI

Is environment me chala (asli result):
- Naye TypeScript files ka strict type-check (next/supabase ke chhote stubs ke saath): 0 errors.
- Request validation, API key helper aur database-jawab parser ke 38 logic tests: 38 passed, 0 failed
  (extra field `prompt`/`messages` reject, `__proto__` reject, galat topic, 21 exclude ids, galat key format,
  http/javascript URL reject, extra fields drop).

Tumne (user ne) Supabase me chalaya: `day-5-5-matching-tests.sql` ke M1 se M27, sab successfully (tumhari report; maine khud SQL nahi chalaya).

NAHI chala (environment me internet aur Postgres nahi):
- `npm install`, `next build`, asli API call asli key ke saath, browser/mobile test.
- Day 5 ki SQL files (day-5-1 se day-5-4) sandbox me nahi chali; unka asli saboot tumhara M1-M27 run hai.
- Koi error aaye toh SQL file ka naam + error text bhejna.

## 2. Ye kaise kaam karta hai

Publisher ka SERVER (browser nahi) bhejta hai:

    POST /api/ads/match
    Authorization: Bearer blc_live_...
    { "topic": "gaming", "exclude_ad_ids": ["<pichhle dikhaye ad ids, optional>"] }

Route: key ka format -> content-type -> body size (max 2 KB) -> strict JSON (sirf `topic` aur `exclude_ad_ids`)
-> key ka SHA-256 -> database function `match_contextual_ad` (ek call me auth + rate limit + matching).

Jawab:
- ad mila: `200 { fill: true, sponsored: true, ad: { id, headline, body, cta_text, destination_url } }`
- ad nahi: `200 { fill: false }` (topic list me nahi, koi eligible creative nahi, budget khatam, sab same jawab)
- galat/band key: `401 { error: "unauthorized" }`
- rate limit: `429 { error: "rate_limited" }` + `Retry-After: 60`
- body galat: `400`, bahut bada: `413`, content-type galat: `415`
- server problem: `503 { fill: false, error: "unavailable" }` (publisher ise "no ad" maane)

Publisher ko advertiser, campaign id, budget, status kuch nahi milta.

### Eligibility (database function me, sab ek saath)
- creative `approved`, campaign `active`, campaign.category = topic
- start_date <= aaj (UTC) aur end_date khali ya >= aaj
- advertiser `active` aur advertiser ka profile `active`
- budget: ab tak ka kharch + 1 impression ki keemat <= total_budget, aaj ka kharch + 1 impression <= daily_budget
- topic `ad_categories` me aur `is_active`

### Rotation
1. Publisher ke `exclude_ad_ids` hata kar dhoondo. 2. Kuch na mile (aur exclude list khali na ho) toh bina exclude ke
(alternative na ho tabhi repeat). Order: aaj sabse kam serve hua campaign -> sabse kam serve hua creative -> random.

### Privacy
- Free text accept nahi hota: sirf topic slug. Conversation/prompt hum tak aa hi nahi sakta.
- `ad_serve_log` me sirf publisher, creative, campaign, topic, time. IP, user id, prompt nahi.
- Taxonomy me sensitive categories (health, religion, politics, sexuality) nahi hain aur kabhi mat jodna.
  Topic list se bahar ho toh no-fill.
- Publisher ko apne user ka koi ID bhejna nahi padta; repeat rokne ke liye wo pichhle ad ids bhejta hai.

## 3. IMPORTANT: budget abhi sirf aadha kaam karta hai
- Budget gate `campaign_spend_daily` padhta hai. Usme kharch tab likha jayega jab impression record hogi (Day 6).
  Tab tak kharch hamesha 0 hai, isliye budget abhi kisi ad ko rokta nahi (sirf tab jab budget ek impression se bhi chhota ho).
- "Serve" aur "impression" alag cheezein hain: serve = humne ad diya, impression = publisher ne dikhaya. Paisa impression par katega.
- CPM: poore platform ke liye ek fixed `cpm_usd` (default 2.00 USD per 1000 impressions) table `ad_platform_settings` me.
  Ye ASSUMPTION hai. Badalna ho: `update public.ad_platform_settings set cpm_usd = 3.00;`
- Currency abhi USD hi hai (Day 3 ka niyam).

## 4. DEPLOY ORDER (ek baar, sahi order me)
1. Supabase SQL Editor me, ek-ek karke (har file ek baar):
   `day-5-1-categories.sql`, `day-5-2-publisher-keys.sql`, `day-5-3-delivery-tables.sql`, `day-5-4-match-function.sql`
   - day-5-1 ke baad check queries chalao (file ke neeche likhi): dono 0 rows aani chahiye.
     Agar rows aayein, unki category theek karo; file ke aakhri 2 `validate constraint` statements dobara chalao.
2. Vercel > Settings > Environment Variables: `SUPABASE_SECRET_KEY` = Supabase ki secret key (sb_secret_...).
   BINA `NEXT_PUBLIC_` ke. Ye key RLS bypass karti hai: kabhi GitHub/chat me mat daalo.
3. Code push karo, Vercel Ready hone do.
4. Tests chalao (section 6).

## 5. Publisher API key banana (abhi SQL se)
Supabase SQL Editor me:

    select id, name, status from public.publishers;
    update public.publishers set status = 'active' where id = 'PUBLISHER-UUID';
    select private.issue_publisher_key('PUBLISHER-UUID');

Result me `blc_live_...` text aata hai. Wo EK baar dikhta hai (database me sirf hash hai). Turant copy karo.
Leak ho jaye toh: `select private.revoke_publisher_key('KEY-ROW-ID');`
(`select id, key_prefix, status, last_used_at from public.publisher_api_keys;` se row id milti hai.)
Ek publisher ke max 5 active keys.

## 6. Testing
SQL: `day-5-5-matching-tests.sql` (27 tests, M1 se M27, expected har block ke upar). Pehle day-3-6 ka SETUP block chala hona chahiye.
Har block ALAG se chalao; sab begin...rollback me hain.

API (key ke saath, kisi REST client app ya curl se):

    curl -i -X POST https://YOUR-SITE.vercel.app/api/ads/match \
      -H "Authorization: Bearer blc_live_..." -H "Content-Type: application/json" \
      -d '{"topic":"gaming"}'

Pehle ek test campaign active karo (approved creative + SQL se `status='active'`, category `gaming`).
- [ ] Sahi key + gaming => 200 fill true. Doosri baar `exclude_ad_ids` me wo id bhejo => doosra creative (agar hai).
- [ ] Bina key / galat key => 401. Revoked key => 401.
- [ ] `{"topic":"gaming","prompt":"hello"}` => 400 unknown_field.
- [ ] `{"topic":"health"}` => 200 fill false.
- [ ] Browser se GET => 405. Response me advertiser/budget ka kuch nahi.
- [ ] Limit paar (60/minute default) => 429.

## 7. Is stage me kya nahi hai (jaan-boojh kar)
- Impression/click tracking aur asli kharch (Day 6). Publisher dashboard me key banane ka UI (abhi SQL).
- Publisher ka apna "ye topics ad-free rakho" setting. Retention/cleanup `ad_serve_log` ki (table badhegi; baad me purani rows hatane ka job).
- Purane demo dashboard par "Ad serving is not live yet" wale text abhi waise hi hain.

## 8. Files
Naye: `supabase/sql/day-5-1-categories.sql`, `day-5-2-publisher-keys.sql`, `day-5-3-delivery-tables.sql`,
`day-5-4-match-function.sql`, `day-5-5-matching-tests.sql`, `lib/ads/types.ts`, `lib/ads/validation.ts`,
`lib/ads/api-key.ts`, `lib/ads/match.ts`, `app/api/ads/match/route.ts`, `DAY5-MATCHING-SETUP.md`.
Badli: `lib/campaigns/constants.ts` (lifestyle + note), `.env.example` (SUPABASE_SECRET_KEY), `lib/supabase/admin.ts` (sirf comment).
