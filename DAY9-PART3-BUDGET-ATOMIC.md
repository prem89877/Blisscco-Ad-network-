# Day 9 / Part 3 : Spend limits + retry-safe (duplicate-charge se bachav)

## Pehle kya sahi tha (maine audit kiya, badla nahi)
`record_ad_serve` (day-7-1 SQL) pehle se:
- campaign row par **lock** leta hai (`for update of c`), isliye do request ek saath budget paar nahi kar sakti
- **total** aur **daily** dono limit check karta hai, phir hi spend likhta hai
- spend + serve log + daily counter **ek hi transaction** me likhta hai. Beech me error aaye toh sab wapas (rollback) => failed request par kharch nahi
- budget khatam => `rejected` => publisher ko `{"fill": false}` (200), ad nahi

## Jo gap mila aur theek kiya

| # | Gap (confirmed code padhkar) | Fix |
|---|---|---|
| 1 | **Retry par double charge.** Publisher ki request timeout hui, usne dobara bheji => 2 serve, 2 baar paisa. Koi retry-key hi nahi thi. | Optional header `Idempotency-Key`. Wahi key dobara => **dobara charge nahi**, wahi ad wapas. |
| 2 | **Retry aur budget khatam.** Pehli request se budget poora ho gaya, retry aaya => selection "no-fill" deta, jabki pehli baar charge ho chuka tha. | Retry check **selection se pehle** (`find_idempotent_serve`). Budget khatam ho tab bhi wahi ad milta hai. |
| 3 | **Same key, do request ek saath.** | Database me advisory lock: ek hi baar charge, doosri ko pehle wala ad (`replayed`). |
| 4 | Limit ki sirf ek hi deewar (function ke andar ka check). Koi aur code spend likhe toh limit paar ho sakti thi. | `campaign_spend_daily` par trigger `campaign_spend_guard_limits`: total/daily paar karne wali spend likhi hi nahi ja sakti (error `23514`). |
| 5 | Purani retry-keys jama hoti rehti. | `purge_old_ad_logs` ab 48 ghante purani keys hatata hai. |

## API contract (kuch nahi toota)
- Request body, response body, status codes, headers: **same**.
- `Idempotency-Key` **optional** hai. Header na bheja => bilkul pehle jaisa (purana 3-arg `record_ad_serve`, wahi rpc args).
- Header bheja par galat shape => `400 {"error":"invalid_request","reason":"invalid_idempotency_key"}` (chup-chaap ignore nahi, warna publisher sochega retry safe hai).
- Key rule: 8 se 64 characters, sirf `A-Z a-z 0-9 _ -` (UUID chalta hai).

### Example 1 : timeout ke baad retry
```
Request 1:  POST /api/v1/ads/match   Idempotency-Key: 7b0e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b   {"topic":"gaming"}
            -> 200 ad X   (0.002 USD charge hua)       [publisher tak jawab pahunch nahi paya]
Request 2:  (wahi key, wahi body)
            -> 200 ad X   (DOBARA charge NAHI hua)
Request 3:  naya key  -> naya ad (naya charge)
```

### Example 2 : budget khatam
Campaign total budget `0.01`, kharch `0.008`. Ek serve (0.002) bacha.
- Key `aaaaaaaa1` => ok (budget poora). Key `bbbbbbbb2` => no-fill. Key `aaaaaaaa1` retry => **ok, wahi ad** (no-fill nahi).

### Example 3 : failed request
Campaign paused ho gaya: `record_ad_serve` => `rejected`. Kharch 0, serve log 0, **key save nahi hoti**. Campaign wapas active hua aur wahi key dobara aayi => normal serve (key jali nahi).

## Jo abhi bhi sach hai (honest limits)
1. **Header ke bina retry-safety nahi.** Agar record database me ho gaya par jawab network me kho gaya, aur publisher ne `Idempotency-Key` nahi bheja, toh serve charge ho chuka hai par publisher ko 503 mila. Isliye publisher guide me `Idempotency-Key` bhejna batao (publisher server har request ke liye ek naya UUID bheje, retry me wahi).
2. Charge abhi bhi **serve** par lagta hai (impression tracking alag feature hai; Day 8 audit ka faisla). Billing/payout ke liye mat use karna.
3. Selection ke baad budget race me khatam ho jaye toh us request ko no-fill milta hai (agla campaign try nahi hota). Overspend nahi hota, bas ek fill miss hota hai.
4. Retry-key 48 ghante tak yaad rehti hai. Uske baad wahi key naya serve maani jayegi.
5. Retry me agar creative ab approved/campaign active nahi, toh no-fill milta hai par pehla charge wapas nahi aata.
6. Exhausted campaign ka status apne aap `completed` nahi hota (status badalna advertiser ko dikhne wala badlav hai; abhi sirf serve rukta hai).

## Files
Naye: `supabase/sql/day-9-5-atomic-spend-idempotency.sql` (migration), `supabase/sql/day-9-6-atomic-spend-tests.sql` (rollback-only tests, T1 se T9), `tests/ads/day9-part3-budget.test.ts`, ye doc.
Badle: `lib/ads/types.ts`, `validation.ts`, `contract.ts`, `match-handler.ts`, `serve.ts`, `serve-db.ts`, `service.ts`.

## Deploy ka sahi order (Android par bhi ho jayega)
1. **Pehle** Supabase (TEST project) SQL Editor me `day-9-5-atomic-spend-idempotency.sql` chalao. Phir uske neeche likhe 5 "Check" queries.
2. `day-9-6-atomic-spend-tests.sql` ke T1..T8 ek ek karke chalao, expected result dekho. T9 (2 tab) manual.
3. Sab theek ho tabhi asli project par 9-5 chalao.
4. **Uske baad** GitHub me code commit karo (Vercel deploy). Code 9-5 se pehle deploy hua aur publisher ne `Idempotency-Key` bheja => 503 (charge nahi hota). Bina header ke requests par koi asar nahi.
