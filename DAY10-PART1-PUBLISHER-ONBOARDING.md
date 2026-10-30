# Day 10 | Part 1: publisher registration, onboarding aur access

Maine koi SQL kisi database par **nahi chalayi**. Ek migration file banayi hai, wo tumhari approval ke baad hi chalegi.

## Jo mila aur kya badla

| # | Gap (code padhkar) | Fix |
|---|---|---|
| 1 | `getMyPublisher()` database error par `null` deta tha. Asli publisher ko "Set up your platform" form dikh jata tha. Dobara submit karne par "saved" jaisa dikhta, jabki kuch save nahi hua. | `loadMyPublisher()` (advertiser ke `loadMyAdvertiser` jaisa): error alag (`failed`). Publisher page error boundary (Try again) dikhata hai, Overview page error notice, key actions "could not check your account". `getMyPublisher()` purane callers ke liye bacha hai. |
| 2 | Publisher save ke baad page par uski saved details (naam, website, topic) aur status kahin nahi dikhta tha. | Publisher page par "Your platform" panel: naam, website, topic, status badge (Approved / Waiting for approval / Suspended). Plain text, link nahi. |
| 3 | `setupPublisher` me har database error ek hi message. Pehle se registered (23505) par bhi "Your details are saved" banner, jabki nayi details save nahi hui thi. | Error mapping (`mapPublisherSetupError`): category problem => category field par error, permission, check, baaki => safe message (raw database text kabhi nahi). 23505 => banner ke bina publisher page. |
| 4 | Naam me chhupe characters (zero-width space, soft hyphen, text-direction override) chalte the: naam dikhne me khali ya admin ko dhokha dene wala ban sakta tha. | Publisher aur advertiser naam dono me reject. Hindi/Persian ke asli ZWJ/ZWNJ allowed hain. |
| 5 | DB: `issue_publisher_key_for` sirf publisher status dekhta tha, profile status nahi. | Migration A (neeche). |
| 6 | DB: suspended publisher API se apni details badal sakta tha. | Migration B (neeche). |

## Jo pehle se theek tha (bina badle jaanch kar)

- `profile_id` hamesha login se (`account.user.id`); form ke `profile_id`, `status`, `role` ignore hote hain. Naya publisher hamesha `pending`; status insert me bheja hi nahi jata, aur column grant bhi nahi hai.
- Key banana / dekhna / band karna: `publisher_id` login se, har DB function me `publisher_id` ka filter, aur sirf `service_role` chala sakta hai. Doosre publisher ki key chhune ka rasta nahi mila.
- RLS: publisher sirf apni row padh / badal sakta hai; admin ko select; DELETE kisi ko nahi. Role composite FK se bandha hai.
- `requireRole(["publisher"])` har action aur page par; admin / advertiser publisher page par redirect.
- Suspended / pending publisher ke liye keys na ban sakti hain, na serve hoti hain (`authorize_publisher_key` publisher aur profile dono ka status dekhta hai).

## Safe deployment

1. Code: normal deploy (Vercel). Naya env variable nahi.
2. Migration (optional, defense in depth): `supabase/sql/day-10-1-publisher-hardening.sql`. **Approval ke baad**, pehle TEST project par, phir asli par. Rerun-safe, koi data / table / column nahi badalta, grants same. File ke neeche 4 read-only checks hain. Day 9 ka order (9-3 -> 9-5 -> 9-7) pehle poora hona chahiye.
3. Rollback: migration A ko `day-7-1` ke `issue_publisher_key_for` se dobara chalao (profile join hat jata hai). B ke liye `day-3-5` ki `publishers_update_own` policy dobara banao.

## Tests (actual result)

`npm test` ka compile + run (offline, nakli Supabase): **1365 pass, 0 fail** (pehle 1340; 25 naye). Naye tests: `tests/accounts/publisher-onboarding.test.ts` (setup action, key actions ownership, status, error mapping, hidden characters, source checks). Ek purana test (`tests/auth/route-protection.test.ts`) naya function naam `loadMyPublisher()` dhoondhne ke liye update hua.

**Nahi chala:** `next build`, `npm run lint` (`tsc --noEmit`), `next lint`, browser / mobile check, integration tests (`test:integration`), migration ka koi SQL. Is machine par `node_modules` nahi the aur network band tha, isliye type-check sirf aanshik ho saka (sirf missing-library errors aaye, kuch aur nahi). Apne project me `npm run lint` aur `npm run build` zaroor chalao.

## Jo jaan-boojh kar nahi badla

- Google se signup hamesha advertiser banata hai (UI me likha hua hai). Publisher banna sirf email signup se. Isse badalne ke liye database trigger / role flow badalna padega.
- Publisher ke liye details edit form nahi hai (database allow karta hai). Approval ke baad naam badalne par dobara review chahiye ya nahi, ye tumhara faisla hai.
