# Day 11 | Part 1 : Contextual ad matching ka review + fixes

Status: 2 confirmed gaps fix hue (sirf TypeScript). **Koi SQL nahi badli, koi SQL chalane ki zaroorat nahi.**
Supabase par kuch nahi chalaya gaya (na read, na write).

## Request ka asli raasta (ek request kaise chalti hai)

1. `POST /api/v1/ads/match` (ya purana `/api/ads/match`) -> dono `lib/ads/match-handler.ts` chalate hain.
2. Handler: IP guard -> key ka format -> content-type/size -> body check (`validation.ts`) -> `Idempotency-Key` check.
3. `serve.ts` (`serveAd`): key se publisher authorize (`authorize_publisher_key`) -> retry check -> topic ko category me badalna
   (`resolveCategory`) -> selection -> record -> jawab.
4. Selection (`selection.ts` + `category-matching.ts`): `load_ad_candidates` (DB, max 200 rows) -> TypeScript me dobara eligibility
   -> order -> ek ad.
5. Record (`record_ad_serve`, DB): creative dobara verify + campaign lock + budget check + spend + serve log. Yahi aakhri faisla hai.
6. Publisher ko sirf 5 public fields milte hain (id, headline, body, ctaText, destinationUrl).

## Kaun se rules sach me lagte hain

| Rule | Sthiti |
|---|---|
| Topic = exact category slug ya code-side alias (substring kabhi nahi) | Lagta hai |
| Sensitive topics (health, religion, politics ...) aur purani `beauty` | Lagta hai, no-fill |
| Creative approved, campaign active, advertiser + profile active | Lagta hai (DB loader, TypeScript, aur record: 3 jagah) |
| Start/end date (UTC din) | Lagta hai |
| Total + daily budget | Lagta hai (TypeScript pre-filter, DB final) |
| Publisher ki exclude list (repeat tabhi jab alternative na ho) | Lagta hai |
| Rotation: kam serve hua campaign/creative pehle | Lagta hai (random nahi) |
| Publisher active + key valid + rate limit | Lagta hai |
| Retry-safety (`Idempotency-Key`) | Lagta hai |

## Jo rules NAHI hain (jaan-boojh kar ya abhi nahi bane)

- Keyword / page-content targeting, geo, language, device: nahi hain. Privacy rule: publisher sirf ek chhota topic slug bhejta hai.
- Related-category fallback (jaise technology <-> developer_tools): nahi hai. Test is baat ko pakadta hai ("no fallback policy").
- Campaign ka priority / weight / bid: database me hai hi nahi, isliye ordering sirf serve-count + id.
- Publisher ki apni allowed/blocked categories: nahi hain.
- Publisher ko apne hi advertiser ka ad dikhne se rokna: nahi hai (nayi rule hogi, alag approval).
- Purana `lib/ads/match.ts` + SQL `match_contextual_ad`: ab production flow me use nahi hota (sirf ek test use karta hai). Hataya nahi.

## Fix 1 : DB ne ad reject kiya toh seedha no-fill (Day 8 audit F3)

Pehle: selection ne sabse achha ad chuna, DB ne record karte waqt reject kiya (budget khatam, ya usi pal pause hua), toh
publisher ko `{fill:false}` mil jata tha, bhale doosra eligible ad maujood ho.

Ab: selection agle 2 eligible ads bhi sath me deta hai (`nextAds`). DB reject kare toh `serve.ts` agla try karta hai.
- Kul record calls max 3. Pehle success par ruk jata hai (sirf EK ad charge hota hai).
- Reject par DB kuch nahi likhta (na spend, na retry-key), isliye agla try safe hai.
- Error (503) par turant ruk jata hai, andaza nahi lagata.
- `Idempotency-Key` har try ke saath jati hai.
- Response ka shape, status codes, headers: koi badlav nahi.
- Example: ad A ka campaign budget usi pal khatam, ad B theek => pehle `{fill:false}`, ab B ka ad.

## Fix 2 : Unit cost DB ke charge jaisa (Day 8 audit F4)

`authorize_publisher_key` `cpm/1000` bina round deta hai, jabki `record_ad_serve` `greatest(round(cpm/1000, 4), 0.0001)` charge karta hai.
Ab TypeScript wahi round lagata hai (`chargedUnitCostUsd`).
- Example: CPM 2.5444 => DB 0.0025 charge karta hai. Campaign me 0.0025 bacha ho toh pehle TypeScript use bekaar reject kar deta tha
  (aakhri serve nahi hota tha). Ab hota hai.
- Overspend ka khatra nahi badla: authority DB hi hai, aur budget check wahi hai.
- Default CPM 2.0000 par koi farak nahi.

## Tests

Naya: `tests/ads/day11-part1-matching.test.ts` (17 tests).
Poora `npm test` jaisa suite (compile + `node --test`): 1649 tests, 1648 pass, 1 fail.
Wo 1 fail (publisher guide ka TypeScript example compile hona) is machine par `@types/node`/`next` install na hone se hai;
original zip par bhi wahi test fail hota hai. Apne laptop/CI par `npm install` ke baad dekho.

## Baaki limitations

- `record` ke "rejected" me wajah nahi aati (budget / paused / key revoke sab "rejected"), isliye key revoke hone par bhi 2 extra bekaar calls ho sakte hain (sirf tab).
- Retry-key wahi par alag topic bheja jaye toh purana ad hi milta hai (publisher guide: har placement par naya key).
- `load_ad_candidates` abhi bhi har row par subqueries chalata hai (Day 8 F5): hazaron creatives par naap kar dekhna baaki.
