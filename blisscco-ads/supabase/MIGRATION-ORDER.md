# Blisscco: exact SQL migration order (Day 14 Part 2)

Koi SQL kisi database par chalayi nahi gayi. Order file-headers + asli object dependencies (create/reference scan) se nikala hai.
**R** = read-only verify (production par bhi chal sakta hai). **T** = TEST DATABASE ONLY (denim), production par KABHI nahi.

| # | Migration (`supabase/sql/`) | Zaroori pehle | Verify (R) | Tests (T) |
|---|---|---|---|---|
| 1-5 | day-3-1, 3-2, 3-3, 3-4, 3-5 | order mein | day-8-1 | day-3-6 (SETUP rows persist) |
| 6 | day-3-7 health-check | 3-1..3-5 | - | - |
| 7-8 | day-4-1, day-4-3 | Day 3 | day-8-1 | day-4-2, 4-4, 4-5 |
| 9-12 | day-5-1, 5-2, 5-3, 5-4 | 4-1, 4-3 | day-8-1 | day-5-5 |
| 13-14 | day-5-6, day-5-8 | 5-1..5-4 | day-8-1 | day-5-7, 5-9, 6-1 |
| 15 | day-5-11 (3 steps: constraint, check rows, validate) | 3-4 | STEP 2 query = 0 rows | - |
| 16 | day-7-1 | 5-1..5-11 | day-7-2 | day-7-3 |
| 17 | day-7-5 (header "optional", par day-8-1 expect karta hai: required maano) | 7-1 | day-7-2, day-8-1 C3 | - |
| 18 | day-9-3 | Day 3, 7 | - | day-9-2, 9-4 |
| 19 | day-9-5 | 5-3, 5-8, 7-1, 9-3 | - | day-9-6 |
| 20 | day-9-7 | 3-5, 4-1, 4-3, 5-6, 7-1, 9-3, 9-5 | - | day-9-8 |
| 21-22 | day-10-1, day-10-2 | 3-5, 5-2, 7-1 | - | (TS/integration only) |
| 23 | day-12-1 | 5-3, 9-5 | day-12-3 | day-12-4 |
| 24 | day-12-2 | 12-1, 5-3, 9-5 | day-12-3 | day-12-4 |
| 25 | day-12-5 | 5-8, 7-1, 9-5, 9-7, 12-1 | day-12-6 | - |
| 26 | day-12-7 | 12-1, 12-2, 12-5 | day-12-8 | day-12-9 |
| 27 | day-12-10 | 12-1, 12-2, 12-5, 12-7 | day-12-11 | - |
| 28 | day-12-12 | 12-2, 3-5 | **day-12-14 (new)** | day-12-13 |
| 29 | day-13-1 | 3-1, 3-2, 3-3 | day-13-2 | day-13-3 |
| 30 | day-13-4 | 13-1, 12-5, 5-3 | day-13-5 | day-13-6 |
| 31 | day-13-7 | 13-1, 13-4 | **day-13-17 (new)** | day-13-8 |
| 32 | day-13-9 | 13-1, 3-5 | day-13-10 | day-13-11 |
| 33 | day-13-12 | 13-1, 13-4, 13-9, 5-3 | day-13-13 | day-13-14 |
| 34 | day-13-15 | 13-4, 13-9 | **day-13-18 (new)** | - |
| end | - | - | day-13-16 (data consistency) | - |

TEST-only extra: `day-5-10-test-data-cleanup.sql` (commit karke TEST rows delete karta hai).

## Rerun rule
Har migration rerun-safe hai, par **purani function-redefining migration baad mein dobara chalane se naya version hat jata hai**
(13-4 ke baad 13-15 ka lock; 7-1 ke baad 7-5; 12-5/9-5/7-1 ke baad 13-4 ki ledger line). Dobara chalani ho toh us point se poori chain chalao,
phir verify (13-5, 13-18, day-8-1 C3 ye regression pakadte hain).

## Verify gaps (repo mein read-only verify nahi hai)
Day 4, Day 5 (5-11 ke STEP 2 ke alawa), Day 9, Day 10: sirf rollback tests ya day-8-1. Production par inka alag verify pending hai.
