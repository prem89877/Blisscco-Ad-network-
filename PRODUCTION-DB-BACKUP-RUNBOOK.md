# Production DB backup runbook

Status: script ready, **backup abhi TAKE NAHI KIYA GAYA**. Pehla backup aap apne machine se lete ho (neeche steps). Production credentials mere paas nahi hain, isliye ye main nahi chala sakta.

## 1. Pehla backup (manual, ~5 min)

1. Supabase Dashboard > Production project > **Connect** > **Session pooler** connection string copy karo (IPv4 pe chalta hai; Termux/ghar ka internet ke liye yahi chuno).
2. Terminal me (project root me):
   ```
   pkg install postgresql      # Termux. Ubuntu: apt install postgresql-client
   export SUPABASE_DB_URL='<yahan Session pooler connection string paste karo>'
   bash scripts/backup-production-db.sh --check    # sirf jaanch, backup nahi
   bash scripts/backup-production-db.sh            # asli backup
   ```
3. Script khud verify karta hai (`pg_restore --list`, `public.campaigns` maujood) aur `backups/blisscco-prod-<time>.dump` + `.sha256` banata hai. Verify fail ho toh file delete ho jati hai.
4. File ko project ke BAHAR safe jagah copy karo (encrypted drive / private storage). Git/chat me kabhi nahi (`backups/` aur `*.dump` .gitignore me hain).

## 2. Kya backup me hai / kya nahi

| Hai | Nahi hai |
| --- | --- |
| `public` (app tables, functions), `private` (guard functions), `auth` (users) | Storage ki asli image files (creative logo/banner). Unke liye Dashboard > Storage se alag copy lo. |
| Schema + data, custom format | Vercel env variables / secrets, Supabase project settings |

## 3. Dashboard ka built-in backup (alag se dekho)

Dashboard > Database > **Backups**. Paid plans par daily backups milte hain, PITR add-on hai; Free plan par nahi. Ye check karo ki Production kis plan par hai. Ye script uska badla nahi, uske upar ek extra copy hai.

## 4. Restore (sirf nayi/khali database me, kabhi Production ke upar seedha nahi)

```
pg_restore --no-owner --no-privileges --dbname "$TARGET_DB_URL" backups/<file>.dump
```
Pehle checksum: `sha256sum -c backups/<file>.dump.sha256`. Restore ka rehearsal ek test project par ek baar kar lo, tabhi backup "tested" maano.

## 5. Kab lena hai

- Har Production migration / deploy se **pehle**, aur pilot start (1 Dec 2026) se pehle ek baar.
- Pilot ke dauran har hafte (manual), jab tak automatic schedule nahi lagta.

## 6. Recovery limitations and pilot constraints (Phase 6 Step 5)

Explicit system limitations:
- **Free plan limitation:** Production Supabase project is on the Free tier, which provides zero automated daily project backups and NO point-in-time recovery (PITR).
- **Restore practice:** A full database restore has NEVER been practised or verified on any scratch or test project.
- **Append-only ledger risk:** A database restore rolls back state to a prior point in time. Any ledger entries, event billing records, budget reservations, or payout requests written after the backup timestamp are permanently lost and cannot be recreated automatically due to immutable sequence and idempotency constraints.
- **No rollback migrations:** The `supabase/sql/` directory contains forward-only, re-runnable SQL migrations. There are no down-migration or rollback scripts. Rollback is strictly "fix forward" or manual reversal using adjustment ledger functions.
- **Storage assets not in dump:** Creative assets (brand logos, banners) in the Supabase Storage bucket `creative-assets` are not captured in the PostgreSQL pg_dump dump file and require separate manual storage exports.
