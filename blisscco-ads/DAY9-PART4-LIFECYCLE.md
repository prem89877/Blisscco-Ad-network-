# Day 9 / Part 4 : Campaign lifecycle (status, approval, admin controls, ad selection)

Status values **same** hain: `draft | pending_review | active | paused | completed | rejected | archived`
(creative: `draft | pending_review | approved | rejected | paused | archived`). Koi naya value nahi, koi RLS policy nahi badli, koi grant kam nahi hua.

## Pehle kya sahi tha (code padhkar dekha, badla nahi)
- Ad chunna: `load_ad_candidates` + TypeScript `candidateIneligibility` + `record_ad_serve` **teen jagah** dobara dekhte hain: creative `approved`, campaign `active`, advertiser + profile `active`, start/end date (UTC), total + daily budget. Paused / rejected / pending creative ko ad nahi milta.
- Advertiser khud `active` ya `approved` tak nahi pahunch sakta: DB trigger sirf `draft->pending_review`, `active<->paused` jaise badlav deta hai; review columns ka column-grant hi nahi.
- Admin functions (`admin_review_*`) ke andar `private.is_admin()`; server action `requireRole(["admin"])` se shuru hota hai; service-role key admin action me nahi.

## Jo gap mile aur theek kiye

| # | Gap | Fix |
|---|---|---|
| 1 | **Resume budget nahi dekhta tha.** Poora kharch ho chuka campaign resume ho kar "Active" dikhta, par serve kabhi nahi hota. | DB trigger + server action dono: budget bacha na ho toh resume roka (`resume_budget_exhausted`). |
| 2 | Resume me "aaj" = `current_date` (DB timezone). Serve code UTC use karta hai. | Ab UTC. |
| 3 | Admin **approve campaign** ended campaign ya budget-khatam campaign ko bhi `active` kar deta tha (jo kabhi serve nahi hota). | Approve par end_date, budget, advertiser/profile active check. |
| 4 | Admin approve me **self-approval** ka koi check nahi tha. | Admin apne hi account ka campaign/ad approve nahi kar sakta (`self_approval_blocked`). Abhi role-FK ki wajah se admin advertiser ban hi nahi sakta, ye extra deewar hai. |
| 5 | **Retry replay** (`replay_serve`) sirf "approved + active" dekhta tha. 48 ghante tak ended / suspended-advertiser campaign ka ad retry me mil sakta tha. | Replay me schedule + advertiser + profile bhi. (Budget jaan-boojh kar nahi: charge pehle ho chuka.) |
| 6 | `load_ad_candidates` budget-khatam campaigns ko bhi 200-row limit me bharta tha, sahi campaigns bahar ho sakte the. | Total budget khatam wale pehle hi bahar. |
| 7 | **UI label sach nahi bolta tha.** "Active — Approved and live" dikhta jabki ad nahi chal raha (ended, no approved ad, budget khatam, advertiser suspended). | Active campaign ke neeche ek line: "Eligible to show ads" ya "Not showing ads: <wajah>". Status badge DB value hi dikhata hai. |
| 8 | Admin page par "Approve campaign" button hamesha dikhta, chahe approve ho hi na sakta ho. | "Approved ads: N" dikhta hai; ad nahi / end date guzri ho toh button chhupta hai (Reject hamesha rehta hai). |
| 9 | Admin ke har DB error ka ek hi generic message. | Wajah ke hisaab se saaf message (raw DB text kabhi nahi). |

## Examples

**1. Resume with no budget**  
Campaign total $50, kharch $50, paused. Advertiser "Resume" dabata hai.  
Pehle: ho jata, "Active" dikhta, par koi ad nahi.  
Ab: `This campaign has no budget left. Raise the total budget before resuming.` Budget $80 karke resume karo => chalta hai. (Seedha API se bhi: trigger rokta hai; `status=active` + `total_budget=80` ek hi update me bhi chalta hai.)

**2. Active par sach label**  
Campaign `Active`, end date kal thi => badge **Active**, neeche: `Not showing ads: the end date has passed.`  
Admin ne uska aakhri ad reject kiya => `Not showing ads: no ad is approved right now.` (campaign status khud nahi badalta.)

**3. Admin approve**  
Campaign pending, ads approved 0 => admin page par "Approved ads: 0" + `Approve at least one of this campaign's ads first.`, sirf Reject button. API se seedha bulao toh DB: `22023 approve_needs_creative`.

**4. Retry**  
Publisher ne `Idempotency-Key: abc12345` se ad liya (charge hua). Raat ko campaign ki end date nikal gayi. Retry => pehle wahi ad milta, ab `{"fill":false}`.

## Files (19)
**Naye (9):** `supabase/sql/day-9-7-lifecycle-guards.sql` (migration), `supabase/sql/day-9-8-lifecycle-tests.sql` (rollback-only), `lib/campaigns/delivery.ts`, `components/campaigns/DeliveryNote.tsx`, `tests/campaigns/day9-part4-lifecycle.test.ts`, `tests/campaigns/day9-part4-admin.test.ts`, `tests/campaigns/admin-stubs.ts`, `tests/ads/day9-part4-serving.test.ts`, ye doc.
**Badle (10):** `lib/campaigns/run-state.ts`, `constants.ts`, `errors.ts`, `lib/admin/decisions.ts`, `app/dashboard/admin/actions.ts`, `app/dashboard/admin/page.tsx`, `app/dashboard/advertiser/campaigns/actions.ts`, `.../campaigns/page.tsx`, `.../campaigns/[id]/page.tsx`, `tests/campaigns/action-stubs.ts`.

## Tests
`npm test`: **1207 pass, 0 fail** (pehle 1093; 114 naye). Nakli database, asli kabhi nahi chhuta.
Naye tests: har galat row (22 type: paused/draft/pending/rejected/completed/archived campaign, draft/pending/rejected/paused/archived creative, ended, not started, total/daily budget khatam, suspended advertiser/profile, galat category) **alag se** dono routes par => `{"fill":false}` aur `record_ad_serve` kabhi nahi bulaya jata. Resume ke saare transitions, admin-only (non-admin ke liye DB tak koi call nahi), SQL migration ki static jaanch (transition list same, RLS/grant weak nahi, naya status nahi).

## Deploy order
1. **TEST** Supabase me `day-9-7-lifecycle-guards.sql` chalao, neeche ke 4 "Check" queries dekho.
2. `day-9-8-lifecycle-tests.sql` chalao. `ERROR P0001 DAY9_LIFECYCLE_RESULTS [...]` aana SAHI hai; har item me `"pass": true` dekho.
3. Sab theek ho tabhi asli project par 9-7. Phir code push (code SQL se pehle bhi nahi todta, bas DB wali naye rules tab tak nahi lagenge).

## Honest limits
1. **SQL maine chalayi nahi** (yahan database nahi hai). Tests TypeScript ke chale; SQL ki sirf text-jaanch hui. Pehle TEST project par chalao.
2. Admin self-approval asli me test nahi ho sakta (admin advertiser ban nahi sakta); sirf function me check hone ki jaanch hai.
3. Active campaign ka aakhri approved ad reject/pause ho jaye toh campaign status `active` hi rehta hai (auto-pause nahi, taaki status achanak na badle). Wo serve nahi karta aur UI saaf bolta hai. Resume ke liye approved ad phir bhi zaroori.
4. Purana `match_contextual_ad` (day-5-4) DB me abhi bhi hai: budget nahi dekhta. App code use nahi karta, sirf `service_role` chala sakta hai. Maine nahi chheda; chaho toh alag migration me hata dein.
5. "Daily budget used" label sirf aaj ke liye sach hai (UTC midnight par reset).
6. Is sandbox me `@types/node` nahi tha, isliye `npm run lint` (tsc) poora nahi chala; apne PC par `npm test` aur `npm run lint` ek baar chalao.
