# Day 5: campaign eligibility + creative SELECTION layer

Naya module: `lib/ads/selection.ts` (category-matching ke upar). Pehle section 1 aur 3 padho.

## 1. Kya chala aur kya NAHI (sach-sach)

Is sandbox me chala (asli result):
- Strict TypeScript check (nayi + purani matching files + tests): 0 errors.
- Matching tests: **219 tests, 219 passed, 0 failed** (151 purane category-matching + 68 naye selection).
- Naye tests 5 alag timezone par chalaye (UTC, New York, Kolkata, Kiritimati, Pago Pago): sab pass.
- Mutation check: jaan-boojh kar code todkar dekha (paused check hatana, end date ignore, start date ignore, incomplete creative ignore, budget hamesha skip, budget hamesha enforce, local-time din, `budgetEnforced` ka jhooth, no-fill me wajah leak). Har tod par test fail hua. (Local-time wala tod sirf tab pakda gaya jab test non-UTC timezone par chala, isliye upar 5 timezone ka run zaroori hai.)

NAHI chala:
- `tests/ads/request-and-route.test.ts` (29 purane tests) is sandbox me dobara nahi chalaye (wahan `@types/node` nahi hai). Is step me route/match.ts chhue nahi gaye, par poora `npm test` tumhe chalana hoga. Expected: `# pass 248` (180 + 68), `# fail 0`. Alag number aaye toh output bhejna.
- `npm install`, `next build`, Vercel deploy, asli Supabase, asli API call, mobile/browser test.
- Candidate loader (database se asli rows padhna) **likha hi nahi**, wajah section 3.

## 2. Schema jo maine dekha (koi SQL file nahi badli, koi migration nahi banayi)

Maine `campaigns`, `ad_creatives`, `advertisers`, `profiles`, `ad_categories`, `creative_serve_daily`, `campaign_spend_daily`, `ad_platform_settings` aur `match_contextual_ad` padha. Module sirf ye maujooda fields use karta hai:

| Zaroorat | Asli field |
|---|---|
| campaign active/paused | `campaigns.status` (`draft, pending_review, active, paused, completed, rejected, archived`); sirf `active` eligible |
| dates | `campaigns.start_date` (not null), `end_date` (null = open-ended), dono plain `date` |
| creative approval | `ad_creatives.status` (`draft, pending_review, approved, rejected, paused, archived`); sirf `approved` |
| creative poora | `headline` (1-90), `body` (1-300), `cta_text` (null ya 1-30), `destination_url` (https, max 2048) |
| advertiser | `advertisers.status = active` aur uska `profiles.status = active` |
| budget | `campaigns.total_budget` (poora budget, **remaining nahi**), `daily_budget` (optional), kharch `campaign_spend_daily.spent` |
| category | `campaigns.category` (FK -> `ad_categories.slug`) |

Jo fields **nahi** hain aur maine banaye nahi: campaign priority, weights, advertiser timezone, remaining-budget column, reservation table.

## 3. Missing schema / budget enforcement (migration se PEHLE, tumhari approval chahiye)

**(a) Loader ke liye database access nahi hai.**
`day-5-3-delivery-tables.sql` ne `creative_serve_daily` aur `campaign_spend_daily` se `service_role` ke bhi grant hata diye the (jaan-boojh kar, sirf `match_contextual_ad` inhe chhoo sakta hai). Isliye server ka loader inhe seedha nahi padh sakta.
Proposed migration (**abhi likhi nahi**): ek read-only `security definer` function `public.load_ad_candidates(p_category text, p_today date)`: `search_path = ''`, execute sirf `service_role`, sirf wahi columns lauta'e jo `AdCandidate` me hain (advertiser email/naam kuch nahi), max ~200 rows, koi write nahi. Approve karo toh pehle poora SQL dikhaunga, phir file banaunga.

**(b) Budget abhi sach me enforce nahi ho sakta.**
`campaign_spend_daily` me abhi koi likhta nahi (impression tracking Day 6), isliye kharch hamesha 0 hai. Iska matlab `total_budget` ka koi asli hisaab nahi. Isliye module me `spendTracking` ek **zaroori** setting hai (default nahi):
- `"unavailable"` (abhi sahi value): budget check bilkul nahi lagta, aur result me `budgetEnforced: false` aata hai. Hum ye daava nahi karte ki limit lag rahi hai.
- `"reliable"`: total aur daily limit ek impression ki keemat ke saath check hoti hai (`spentTotal + unitCost <= totalBudget`). Ise tabhi lagao jab Day 6 kharch asli impressions par likhne lage.

Asli enforcement ke liye ye chahiye (Day 6 ka faisla, billing nahi): impression par atomic aur duplicate-proof kharch likhna; ye tay karna ki serve par paisa roka jaye (reservation) ya impression par katein (serve aur impression ke beech thoda overshoot ho sakta hai); CPM ka asli source.

**(c) Rotation tabhi hoga jab serve counts record hon.**
Ye layer koi counter update nahi karti (tumhari shart). Serve counts abhi sirf `match_contextual_ad` likhta hai. Agar sirf ye module route me laga diya, toh har baar wahi top creative niklega. Isliye module abhi route se **jura nahi hai**; `/api/ads/match` ab bhi DB function par chalta hai (atomic auth + rate limit + serve log). Ye bhi dhyan rahe: DB function rotation me `random()` use karta hai, ye module deterministic order.

**(d) Timezone.**
`start_date`/`end_date` plain `date` hain, advertiser ya campaign ka timezone column nahi. Isliye poore platform ke liye **UTC din** (DB function ke `v_today` jaisa, aur day-4-1 ka `current_date` bhi Supabase me UTC hai). Advertiser ke local din chahiye toh naya column + faisla chahiye. Abhi nahi banaya.

**(e) "Incomplete creative".**
Database ke CHECK constraints adhoore creative pehle hi rokte hain. Phir bhi module snapshot par bharosa nahi karta: khali headline/body, bada text, http/javascript URL wale creative `creative_incomplete` se hat jaate hain.

## 4. Selection strategy (documented + tested)

1. Signal: publisher `active` ho; category exact slug/alias ho (sensitive/unsupported/free text par database tak jaate hi nahi).
2. Eligibility: creative `approved` + complete; campaign `active`; advertiser aur profile `active`; `start_date <= aaj(UTC) <= end_date`; category barabar; budget (sirf `spendTracking = "reliable"` par).
3. Order: aaj sabse kam serve hua campaign -> sabse kam serve hua creative -> campaign id (a-z) -> creative id (a-z). Random nahi.
4. Publisher ki `excludeCreativeIds` chhod kar; alternative na ho tabhi repeat (`repeat: true`).
5. Kuch bhi na mile ya kuch bhi galat ho (loader error, galat clock, galat context) => safe no-fill. Kabhi throw nahi.

## 5. Kaise use karna hai (loader banne ke baad)

    const outcome = await selectAd(
      { publisher: { id, status }, category: body.topic, excludeCreativeIds: body.exclude_ad_ids },
      { loadCandidates, now: () => new Date(), unitCostUsd: cpmUsd / 1000, spendTracking: "unavailable" },
    );
    return NextResponse.json(toPublicResponse(outcome)); // sirf {fill:false} ya {fill:true, sponsored:true, ad:{5 fields}}

`outcome.reason` sirf server log ke liye hai, publisher ko kabhi mat bhejna.

## 6. Privacy aur safety (tests me check)

- Publisher ko sirf 5 ad fields milte hain. Campaign id, budget, kharch, advertiser, status kabhi nahi. Har tarah ka no-fill bilkul `{"fill":false}`.
- Loader ko sirf category aur date milti hai (publisher, key, exclude list nahi).
- Module me database, network, env, service-role key, clock, random, insert/update, impression/click/billing kuch nahi: ek test source padhkar check karta hai.
- Service-role key sirf server-only `lib/supabase/admin.ts` me hai; ye module use hi nahi karta.

## 7. Tests chalana

    npm install
    npm test

Android par terminal nahi, isliye laptop, GitHub Codespaces ya CI. Tests asli Supabase ko nahi chhute.

## 8. Files

Naye: `lib/ads/selection.ts`, `tests/ads/selection.test.ts`, `DAY5-SELECTION-LAYER.md`.
Badli: `lib/ads/category-matching.ts` (sirf: `creative_incomplete` reason aur optional `budgetCheck: "enforce" | "skip"`; purana behavior default me waisa hi).

## 9. Agla kadam (tum batao)

(a) Section 3(a) ki loader migration approve karo (pehle SQL dikhaunga), phir server-only loader likhunga. (b) Pehle serve counts + spend ka plan (Day 6) tay karo, phir module route se jodo. (c) Ruk jao.
