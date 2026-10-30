# Day 10 | Part 2: publisher API key manager

Koi SQL kisi database par **nahi chalayi**. Ek migration file hai (`day-10-2-key-limits.sql`), approval ke baad hi chalegi.

## Asli files (jaanch ke baad confirm)

`components/dashboard/PublisherKeyManager.tsx`, `lib/publisher/keys.ts` (pure helpers), `lib/publisher/keys-db.ts` (database, server-only), `lib/ads/api-key.ts` (Bearer padhna + hash), `app/dashboard/publisher/actions.ts`, `supabase/sql/day-5-2`, `day-7-1`, `day-10-1`.

## Pehle se theek tha (bina badle jaanch kar)

- **Generation:** `randomBytes(32)` (Node crypto, 256 bit) => `blc_live_` + 64 hex. `Math.random` kahin nahi.
- **Storage:** database me sirf SHA-256 hash (UNIQUE, 64-hex CHECK), prefix aur last 4. Table par kisi ko grant nahi, RLS on. Lamba random secret hai, isliye salt / bcrypt ki zaroorat nahi (rainbow table / brute force ka matlab nahi). **Hash scheme nahi badla**, isliye saari maujooda keys (SQL se bani purani bhi) pehle jaisi chalti rehti hain.
- **Verification:** header format pehle jaanchta hai (galat => database tak nahi jaata), phir hash se `authorize_publisher_key`: key active + expire nahi + publisher active + profile active. Invalid, revoked, expired, suspended: sab ek jaisa 401 (koi andaaza nahi lagta).
- **Association:** `publisher_id` hamesha login se; har DB function me `publisher_id` ka filter; sirf `service_role` bula sakta hai. Doosre ki key revoke karne par wahi "could not be revoked" message (pata nahi chalta ki key hai ya nahi).
- **One-time secret:** plain key sirf banate waqt ke jawab me, kahin store / log nahi. Logs me sirf static label + error code. Service-role key sirf `createAdminClient()` me, koi `NEXT_PUBLIC` nahi.

## Jo gap mile aur fix kiye

| # | Gap | Fix |
|---|---|---|
| 1 | Suspended / pending publisher apni leaked key revoke nahi kar sakta tha (sab actions "active" maangte the). Reinstate hone par wo key dobara chalti. | Revoke ab har status me chalta hai (login + apni key zaroori). Naya banana / rotate sirf approved publisher. Suspended publisher ko apni active keys ka "revoke only" panel dikhta hai. |
| 2 | Rotation nahi thi. | `rotateKey`: nayi key (wahi naam, naya expiry), **purani chalti rehti hai** jab tak tum revoke na karo (server badalte waqt downtime nahi). Purani key publisher ki apni list me honi chahiye, aur active + expire na hui ho. UI me har key par "Rotate". |
| 3 | Secret screen par tab tak rehta tha jab tak page na chhode. | "I have saved it, hide" button, `autoComplete="off"`, `translate="no"`. Secret kabhi storage / URL / cookie me nahi (test se pinned). |
| 4 | Har 22023 error "You already have 5 active keys" dikhata tha (galat expiry / data par bhi). | `issueFailReason`: hint se `limit` / `daily` / `error`. Hint na ho (migration se pehle) toh purana behaviour: deploy ka order koi bhi. |
| 5 | Banao-revoke-banao ka loop table bhar sakta tha. | Migration `day-10-2`: 24 ghante me max 20 nayi keys. |
| 6 | Key ke naam (label) me chhupe characters chalte the. | Reject (Part 1 wale helper se). |

## Compatibility / maujooda keys

Koi table, column, data ya hash nahi badla. Revoke / authorize / list functions nahi chhue. Migration sirf `issue_publisher_key_for` ko `create or replace` karti hai (Part 1 ka profile check bacha rehta hai, grants same: service_role only).

## Baaki configuration steps (tumhare liye)

1. Code deploy (Vercel).
2. **Migration ki approval do**, phir `day-10-2-key-limits.sql` pehle test project par, phir asli par (file ke neeche 3 read-only checks).
3. Vercel par `SUPABASE_SECRET_KEY` (is project ka asli naam, `lib/supabase/admin.ts`) sirf server env me ho, `NEXT_PUBLIC_` ke saath nahi. `NEXT_PUBLIC_SUPABASE_URL` public rehta hai, wo theek hai. Ek baar dekh lo.
4. Deploy ke baad: ek purani key se `/api/v1/ads/match` ek baar chalao (ab bhi 200 / no-fill aana chahiye), phir dashboard se Rotate -> naya key chalao -> purani Revoke -> purani se 401 aana chahiye.
5. Agar kabhi key leak ho: Revoke turant, phir Rotate.

## Tests (actual result)

Compile + `npm test` (offline, nakli Supabase): **1386 pass, 0 fail** (Part 1 ke baad 1365). Naye: `publisher-keys-db.test.ts` (asli `keys-db.ts` nakli client ke saath: 256-bit key, sirf hash jata hai, 200 keys me koi repeat nahi, Bearer -> hash match, logs me key nahi, galat format reject), `publisher-rotation.test.ts` (rotation ownership, expired / revoked, limit messages, source checks), aur `publisher-onboarding.test.ts` me revoke ka naya rule. Do purane tests ke gate-naam regex me `requireOwnPublisher` / `listPublisherKeys` jode.

**Nahi chala:** `next build`, `npm run lint`, `next lint`, browser / mobile check, integration tests (`test:integration`), migration ka SQL. Is machine par `node_modules` nahi the: type-check sirf aanshik (sirf missing-library errors). Apne project me `npm run lint` aur `npm run build` chalao.

## Jaan-boojh kar nahi badla

- Hash scheme (SHA-256) aur key format, taaki maujooda keys na toote.
- Rotate me purani key apne aap revoke nahi hoti (downtime se bachne ke liye). Ye tumhari marzi ke hisaab se badla ja sakta hai.
