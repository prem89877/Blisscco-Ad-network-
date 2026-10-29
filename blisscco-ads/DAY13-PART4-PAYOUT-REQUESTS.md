# Day 13 | Part 4 | Manual publisher payout-request workflow

**Status:** code + SQL likhe gaye, TypeScript tests chale (local: 2376 me se 2375 pass; 1 fail purana aur sandbox ka hai: `@types/node` install nahi, `publisher-examples` "compiles with no type errors"). **SQL kisi database par CHALAYI NAHI GAYI** (denim par bhi nahi, asli par bhi nahi). SQL ke asli behaviour ka saboot sirf `day-13-11` (rollback-only, sirf denim) chalne par milega. Next.js build / browser test bhi yahan nahi chala (node_modules nahi): TSX files sirf syntax-check hui hain.

## Repo audit (jo mila)
- Payout table / payout status / **minimum payout rule repo me koi nahi** -> maine koi minimum invent nahi kiya (sirf amount > 0 aur available ke andar).
- Status convention: `text + CHECK`, lowercase. Admin convention: security-definer function + `private.is_admin()`, user ke session se (service-role nahi). Wahi use kiya.
- `financial_ledger` me payout entry-type nahi hai; ledger ko **chhua nahi**. Hisab: `available = ledger_balance - (requested + approved) - paid`. Ledger balance gross rehta hai.

## Kya implemented hai
| Step | Kaise |
|---|---|
| Versioned migration | `day-13-9` (+ verify `day-13-10`, rollback-only tests `day-13-11`). Rerun-safe. |
| States | requested -> approved -> paid, ya rejected (requested / approved se). paid / rejected aakhri. DB guard trigger tay karta hai. |
| Apna hi balance | `request_my_payout(amount, request_key)`: publisher id parameter me nahi, `auth.uid()` se. Active profile + active publisher chahiye. |
| Minimum rule | Koi nahi (define nahi tha). |
| Duplicate / negative / zyada / concurrent | wahi `request_key` = duplicate (nayi row nahi), alag amount = conflict; ek publisher ka sirf ek khula request (partial unique index); amount > 0, 4 decimal se zyada refuse (round nahi), available se zyada refuse; publishers row par `FOR NO KEY UPDATE` lock balance padhne se PEHLE => do request ek balance do baar reserve nahi kar sakte (ledger likhne wale rukte nahi). |
| Publisher UI | `/dashboard/publisher/payouts`: 4 figures, request form (sirf amount), apni requests ki list. Publisher page par "Payouts" button. |
| Admin-only | `admin_review_payout_request`, `admin_mark_payout_paid`: pehle `private.is_admin()`, warna 42501. Server action bhi `requireRole(["admin"])`. Admin page par "Publisher payout requests" panel. Buttons chhupane par bharosa nahi. |
| Approve / paid par dobara jaanch | publisher abhi bhi active ho aur ledger request ko cover kare (request ke baad reversal / negative adjustment aa sakta hai) warna `not_eligible` / `insufficient`; admin reject kar sakta hai. |
| Audit | `publisher_payout_events` (append-only, UPDATE / DELETE / TRUNCATE band). Har status badlav trigger se likhta hai (actor row ke apne columns se): kaun, kab, kahan se kahan, reject ki wajah. |
| Paid != transfer | `paid` sirf record: `paid_by`, `paid_at`. Koi transfer, provider, ledger entry nahi. |
| Sensitive data | Koi bank / card / UPI / account column ya form field nahi. Paid par koi free text nahi; reject ki wajah ke paas "payment details mat likho" likha hai. |

## Jo ABHI MANUAL admin kaam hai
1. Payout request dekhna aur **Approve / Reject** karna (reject par wajah likhna).
2. **Asli paisa bhejna** Blisscco ke bahar (apne bank / UPI se) aur publisher se payment ka tareeka alag baat-cheet se tay karna (app me payment detail nahi li jaati).
3. Bhejne ke baad **"Mark as paid"** dabana.
4. Request galat ho ya balance gir jaye (reversal / negative adjustment) toh **Reject** karna.
5. Publisher ke paas cancel button nahi hai: galat request ho toh admin reject karega.

## Business faisle jo BAAKI hain (maine tay nahi kiye)
1. Minimum payout amount? 2. Kamai kitne din baad payout ke layak ho (hold period)? 3. Payout fee / currency conversion (INR)? 4. Publisher ka cancel button? 5. Paid ko ledger me alag `payout` entry-type se likhna (abhi alag table me; ledger gross hai)? 6. Approve karne wala aur paid mark karne wala alag admin ho (two-person rule)?

## Pehle se maujood cheez jo maine theek ki (bina approval ke)
- Earnings page ka "Payments are not tracked yet" ab galat tha -> "Payout requests are on the Payouts page". `UNSUPPORTED_BALANCES` ke `paid` ka label "Paid out" se "Earnings marked as paid" (key wahi; "paid out" ab payouts page par tracked hai).
- Do purane tests ki file-list filter tang ki (`day13-part1-ledger`: `/^day-13-\d-/`, `day13-part3-earnings`: `[7-8]`), kyunki naye `day-13-9/10/11` unhe tod rahe the. Koi assertion kamzor nahi hui.

## Files
**Naye (14):** `supabase/sql/day-13-9-payout-requests.sql`, `day-13-10-payout-requests-verify.sql`, `day-13-11-payout-requests-tests.sql`, `lib/payouts/rules.ts`, `lib/payouts/data.ts`, `app/dashboard/publisher/payout-actions.ts`, `app/dashboard/admin/payout-actions.ts`, `app/dashboard/publisher/payouts/page.tsx`, `components/dashboard/PayoutRequestForm.tsx`, `components/admin/PayoutActionButton.tsx`, `components/admin/PayoutRequestsPanel.tsx`, `tests/payouts/payout-stubs.ts`, `tests/payouts/day13-part4-payouts.test.ts`, is file.
**Badle (7):** `app/dashboard/admin/page.tsx` (panel), `app/dashboard/publisher/page.tsx` (Payouts button), `app/dashboard/publisher/earnings/page.tsx` (hint), `lib/ledger/earnings.ts` (label), `tsconfig.test.json`, `tests/ads/day13-part1-ledger.test.ts`, `tests/ledger/day13-part3-earnings.test.ts`.

## SQL chalane ka tareeka (tumhari approval ke baad)
1. **denim (test):** `day-13-9` -> `day-13-10` (sab PASS) -> `day-13-11` (sab PASS; ek ACTIVE admin profile chahiye; TEST Publisher C / D ki ledger khali). Phir file ke neeche wala 2-session concurrency check haath se.
2. **Asli (blisscco ad network):** sirf `day-13-9` + `day-13-10`. (`day-13-11` asli par NAHI.)
