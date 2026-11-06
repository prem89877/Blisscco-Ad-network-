# Day 11 | Part 3 : Publisher context se relevant ad chunna (contextual input contract)

Status: koi SQL nahi badli, koi migration nahi, Supabase par kuch nahi chalaya gaya (na read, na write). Sirf TypeScript + tests + guide text.

## Pehle kya mila (code padh kar, andaza nahi)

- API sirf `topic` (strict slug `^[a-z0-9_]{1,50}$`) aur `exclude_ad_ids` leti hai. **Raw chatbot question accept hi nahi hota**: `question`, `prompt`, `context`, `messages`, `query`, `text`, `keywords`, `user_id` sab 400 `unknown_field`. Isliye kuch store/log hone ka sawal hi nahi.
- `topic` -> `resolveCategory` (exact slug ya code-side alias, substring nahi) -> loader -> selection -> `record_ad_serve`. Eligibility 3 jagah: DB loader, TypeScript, DB record.
- Context ka sirf ek hi signal tha: ek category. Isliye "relevance" ka sach me sirf ek hi tareeka tha.

## Kya badla

Naya optional field `fallback_topics` (max 2 slugs, wahi format jo `topic` ka hai):

```json
{ "topic": "gaming", "fallback_topics": ["technology", "fitness"] }
```

Rules (deterministic, explainable):
1. Pehle `topic`. Eligible ad mile toh wahi, fallbacks load bhi nahi hote.
2. Na mile (unsupported, koi eligible campaign nahi, ya DB ne record reject kiya) tabhi `fallback_topics[0]`, phir `[1]`. Order publisher ka diya hua hai.
3. `topic` sensitive ho (health, religion, politics, ...) => seedha no-fill. Us par fallback se bhi ad nahi.
4. Fallback entry sensitive/unsupported ho => chup-chaap skip. Duplicate (topic ke alias samet) hata diye jaate hain.
5. Ek request me kul record calls max 3 (pehle jaisa), ek hi ad charge hota hai.
6. Serve log me wahi canonical category jaati hai jo asal me serve hui. Response me kuch naya nahi (na category, na fallback ka zikr).

Purani requests bilkul pehle jaisi chalti hain: `fallback_topics` na ho toh parsed shape aur behaviour same (test se pakka kiya).

Galat `fallback_topics` (array nahi, 2 se zyada, free text, bada string, galat type) => 400 `invalid_topic`. Naya error reason nahi joda, taaki purane clients ka error handling na tute.

## Jo intact hai (test se)

Approved creative, active campaign/advertiser/profile, start/end date, total + daily budget, publisher authorization + rate limit, publisher ki exclude list, Idempotency-Key (dobara charge nahi): fallback category me bhi yehi sab lagte hain. Ek-ek rule ke liye alag test hai.

## Privacy

- Raw question text ab bhi accept nahi hota. Koi naya free-text field nahi.
- Topic/fallback strings kahin log nahi hote (test: marker string logs me nahi aati).
- Koi external service, paid AI, embedding nahi. Kisi bhi third party ko kuch nahi bheja jaata.

## Ek purana test badla (aapko batana zaroori)

`tests/ads/matching-requirements.test.ts` ka source-scan test "no fallback policy is present" `serve.ts` me "fallback" shabd milne par fail hota tha. Policy badli nahi, sirf explicit opt-in field aaya: isliye test ab bhi `category-matching.ts` aur `selection.ts` me koi fallback shabd nahi hone deta, aur `serve.ts` me sirf `fallbackTopics` (publisher ka field) allow karta hai; `default_category`, `any_category`, `related` abhi bhi mana hain. Behaviour wale R3 tests (bina fallback_topics ke gaming par unrelated category kabhi nahi) jaise the waise pass hote hain.

## Tests

- Naya: `tests/ads/day11-part3-context.test.ts` (72 tests): contract, edge cases (null, object, array, bahut lamba, `__proto__`, SQL/HTML strings, unicode, zero-width), order, sensitive, har eligibility rule fallback me, budget/record cap, outage (503), dono routes end to end (fake DB), logging, retry.
- Mutation check: sensitive-topic guard hata ke dekha, 3 tests fail hue (yaani tests asli me guard pakadte hain).
- Poora suite (compile + `node --test`): 1747 tests, 1746 pass, 1 fail. Wo 1 fail purana hai: publisher guide ka TypeScript example compile hona (`@types/node`/`next` install nahi). Apne laptop/CI par `npm install` ke baad dekho.
- NAHI chala: `next build`, `tsc --noEmit` (next types nahi), asli Supabase par DB tests (koi SQL badli hi nahi).

## Ab contextual matching sach me kya kar sakti hai

- Publisher ka bheja hua topic (ya uske 2 explicit backup topics) exact slug/alias se supported category me badalna, aur us category ke eligible campaigns me se rotation (kam serve hua pehle) + id tie-break se ek creative chunna.
- Sensitive context me ad nahi dena.

Kya NAHI kar sakti: page/question ka matlab samajhna, keyword ya semantic/embedding matching, user ya interest infer karna, related category apne aap chunna, bid/priority se ranking. Ye sab abhi nahi hai aur isko "AI matching" mat kehna.

## Future enhancements (abhi nahi bane)

- API me `Gaming` / `video games` jaisi untidy topic accept karna (Part 2 ka pending "haan"): 6-7 purane contract tests aur guide badlenge.
- Publisher ki apni allowed/blocked categories (`publishers.category` DB me hai par matching me use nahi hota).
- Campaign priority/bid, related-category map (jo hum explicitly maintain karein), keyword/page-level targeting (privacy review ke baad, aur sirf server-side).
- Fallback par alag reporting (kitni baar fallback se fill hua), taaki publisher ko dikhe.
