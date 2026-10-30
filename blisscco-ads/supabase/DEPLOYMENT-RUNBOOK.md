# Database deployment runbook (Day 14 Part 2)

Order: `MIGRATION-ORDER.md`. Koi SQL abhi tak kisi DB par chali nahi: har "PASS" tumhe khud dekhna hai.

## A. TEST (denim) only
1. Production ka backup/PITR hai, yeh jaanch pehle (production section).
2. Migrations order mein chalao. Har migration ke baad uska verify (R). **Required: har row `PASS` / `true`, koi FAIL nahi.** FAIL = ruko, aage mat badho.
3. Day 3-6 `SETUP` (TEST users + rows) ek baar, phir rollback-only tests (T) har block alag. Required: har row PASS. Error aaye toh pehle `rollback;`.
4. Aakhir mein `day-13-16` consistency: sab PASS.
5. Cleanup (`day-5-10`) sirf yahan.

## B. PRODUCTION (blisscco ad network)
- Sirf migrations (order mein) + R verify files. **Koi T file, SETUP ya cleanup nahi.**
- Production se pehle: denim par poori chain + sab verify PASS; `day-5-11` STEP 3 tabhi jab STEP 2 = 0 rows.
- Ek migration, phir uska verify PASS, tab agla. FAIL par ruko aur data haath se mat badlo (ledger append-only: reversal/adjustment).
- Low-traffic mein chalao (12-1 mein ad_serve_log par lock/index).
- Migrations ke baad: ledger **band** rehta hai (`ledger_enabled=false`), `publisher_share_bps` NULL, CPM aur serve-based billing unchanged. Inhe is runbook mein chhuna nahi hai.
- Aakhir mein day-13-16 (data consistency): PASS.
