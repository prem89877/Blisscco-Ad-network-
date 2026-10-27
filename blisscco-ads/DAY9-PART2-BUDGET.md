# Day 9 / Part 2 : Campaign budget validation

Currency: **USD, `numeric(12,2)`** (pehle jaisa, badla nahi). Kharch (spend) `numeric(12,4)` hi rehta hai.

## Niyam (frontend, server aur database ab ek jaise)

| Niyam | Frontend (form) | Server action | Database |
|---|---|---|---|
| Total budget number ho, 0 se zyada | Haan (blur/submit) | Haan | `total_budget > 0` (pehle se) |
| Max $10,000,000.00 | Haan | Haan | **NAYA** `campaigns_total_budget_max_check` |
| Daily <= Total, daily > 0 | Haan | Haan | `campaigns_daily_budget_check` (pehle se) |
| Sirf 2 decimal (3 decimal reject, round nahi) | Haan | Haan | `numeric(12,2)` |
| Min total $1.00 / daily $0.50 (sirf badli hui value par) | Haan | Haan | Nahi (jaan-boojh kar, purana campaign rename par na atke) |
| Total budget ab tak ke kharch se neeche nahi | Haan (hint) | Haan | **NAYA** trigger `campaigns_guard_budget` (race-safe) |
| Sirf apna advertiser badal sake | - | Haan (role + advertiser DB se, form se kabhi nahi) | RLS + guard (pehle se) |

Ek hi rule-file dono taraf: `lib/campaigns/budget-rules.ts`. Limits ek hi jagah: `constants.ts`.

## Float ki galti kaise hata di
Pehle text -> `Number("1.15")` -> `*100`. Float me `1.15 * 100 = 114.99999999999999`.
Ab `lib/campaigns/money.ts` text ko seedha **integer cents** banata hai: `"1.15"` -> `115`, `"2,500.50"` -> `250050`. Saare compare cents me hote hain.
Database ko jo number jata hai wo 2 decimal ka hi hota hai (`1.15` JSON me `1.15` hi jata hai).

## Example
- `500` total, `50` daily -> save.
- `0` total -> "Total budget must be more than 0."
- `100` total, `100.01` daily -> "Daily budget cannot be more than the total budget."
- `10000000.01` total -> "Total budget can be at most $10,000,000.00."
- `10.005` total -> "Enter a number like 2500 or 2500.50. No symbols, spaces or minus sign, and at most 2 decimals."
- Campaign ne $5.00 kharch kiya: total `4.99` -> roka; total `5.00` -> allowed.

## Files
Naya SQL: `supabase/sql/day-9-3-budget-rules.sql` (migration), `day-9-4-budget-tests.sql` (rollback-only test).
**Kuch production me apply NAHI hua** (Supabase tool ka approval nahi mila). Pehle 9-3 chalao, phir 9-4.
