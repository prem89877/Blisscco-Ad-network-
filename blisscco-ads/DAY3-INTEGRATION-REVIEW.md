# Day 3 Integration Review (Blisscco Online Ad Network)

Scope: sirf review + hardening. Campaign creation, ad matching, impression tracking, ad-serving API: NAHI banaye.

## A. Kya VERIFY hua aur kya nahi

| Cheez | Status |
|---|---|
| Code padha: auth, middleware, server actions, SQL parts 1-6 | Verified (padha) |
| Migrations me destructive statement (drop table/column, truncate, delete) | Verified: parts 1-5 me koi nahi. Sirf `auth.users -> profiles ON DELETE CASCADE` (design) |
| Browser/client component me server-only ya secret import | Verified: koi nahi (grep). `lib/supabase/admin.ts` kahin use nahi hota |
| Naye/badle TS files ka SYNTAX | Verified (TypeScript parser se) |
| `npm install`, type-check, `next build`, lint | NAHI chala: is environment me internet band hai, packages install nahi ho sakte. Vercel build hi asli check hai |
| SQL (parts 1-7) aur RLS tests | NAHI chala: Supabase tak access nahi. Tum SQL Editor me chalao |
| Login/signup/logout/session, mobile layout | NAHI chala: browser me tumhe test karna hai |

## B. Findings aur changes

Fix kiye (is zip me):
1. **Role/status server par check nahi hota tha.** Dashboard sirf "logged in?" dekhta tha. Ab `requireAccount()` (active profile) har dashboard page me, aur `requireRole()` advertiser/publisher pages me (admin dono dekh sakta hai). Role hamesha `profiles` table se (RLS ke saath), kabhi JWT/user_metadata se nahi. Fail-closed: profile na mile ya query fail ho => `/dashboard/account-status` (naya page; usme loop nahi).
   Kyun pages me bhi: Next.js me layout page badalne par dobara nahi chalta, isliye sirf layout par bharosa safe nahi.
2. **`env.ts` secret check:** purani `service_role` JWT key (eyJ...) public variable me jaati toh pakdi nahi jaati thi. Ab JWT payload decode karke role check hota hai.
3. **Health check:** pehle sirf Auth settings ping karta tha aur status/config details bahar deta tha. Ab database tak chhota round-trip (`public.health_ping()`), jawab sirf `{"status":"ok"}` ya `{"status":"unavailable"}` (503). Error/URL/keys kabhi nahi. Naya SQL: `day-3-7-health-check.sql`.
4. **SQL tests me publisher/role coverage nahi thi.** `day-3-6-security-test.sql` me Tests 15-21 aur Structure Checks S1-S6 jode (publisher isolation, role mixing, privilege escalation, anon, RLS on, FKs, indexes). Cleanup ab sirf exact TEST names delete karta hai.
5. `server-only` package `package.json` me add (admin.ts ke liye).

Dhyan do (badla NAHI, faisla tumhara):
- `NEXT_PUBLIC_SITE_URL` set nahi hoga toh verification email ka link request ke Host header se bantaa hai. Vercel me zaroor set karo.
- Active campaign ka budget/dates advertiser badal sakta hai (bina re-review). Payments aane se pehle yeh rule tay karna.
- Approved creative edit hone par draft ho jata hai, par campaign `active` rehta hai. Ad-serving stage me hamesha "campaign active AND approved creative" check karna.
- Supabase Dashboard se user delete tab fail hoga jab uske advertiser/publisher rows ho (ON DELETE RESTRICT). Ye jaan-boojh kar hai (data bachane ke liye).
- Health endpoint public hai aur har hit par ek chhota DB call karta hai. Zarurat padne par Vercel Firewall me rate limit lagao.
- `day-3-6-security-test.sql` poori ek saath RUN mat karo (cleanup delete karta hai). Block by block.

## C. DEPLOY ORDER (zaroori)
1. Supabase SQL Editor: `day-3-1` ... `day-3-5` (agar pehle nahi chalaye), phir `day-3-7-health-check.sql`.
2. Phir code push karo. (Naya code `profiles` table padhta hai: SQL pehle na chala toh dashboard `account-status` par atak jayega.)
3. Agar tumhare purane test users Part 1 trigger se PEHLE bane the, unki `profiles` row nahi hogi: unhe delete karke dobara signup karo.

## D. Testing checklist

### D1. Supabase SQL (SQL Editor) — pehle yeh
- [ ] Setup block ek baar (5 test users banane ke baad), phir Tests 1-21 ek-ek karke; expected result file ke comment me likha hai.
- [ ] S1: 5 tables, `rls_on = true`. S2: 0 rows.
- [ ] S3: `anon_any = false` aur `auth_delete_or_truncate = false` sab par.
- [ ] S4: anon ke liye sirf `public.health_ping()`.
- [ ] S5: foreign keys dekho (RESTRICT, reviewed_by SET NULL). S6: indexes dikhte hain.
- [ ] Advertiser isolation: Tests 1, 2, 7, 8. Publisher isolation: Tests 15, 16, 18. Privileged role: Tests 3, 5, 6, 12, 17, 20. Anon: Tests 10, 21. Role mixing: Test 19.
- [ ] Supabase > Advisors > Security: koi "RLS disabled" ya "exposed function" warning na ho.
- [ ] Aakhir me CLEANUP, phir 5 test users delete.

### D2. Deployed app (Android Chrome)
Env:
- [ ] `/api/supabase-health` => `{"status":"ok"}`.
- [ ] Vercel ke env me `SUPABASE_SECRET_KEY` / `sb_secret_` / `service_role` NAHI hai.
- [ ] Page source me (view-source) `sb_secret` search karo: 0 result.
Auth:
- [ ] Signup (advertiser), verification email, link kholo => `/dashboard`.
- [ ] Logout => `/login`; Back dabao => dashboard dobara login mang.
- [ ] Login => tab band karke dobara kholo: session bacha rehta hai.
- [ ] Galat password => "Incorrect email or password." (same message galat email par).
Protection:
- [ ] Incognito me `/dashboard`, `/dashboard/campaigns`, `/dashboard/advertiser` => `/login?next=...`.
- [ ] Logged in rehte `/login` => `/dashboard`.
- [ ] `/login?next=https://evil.com` aur `/login?next=//evil.com`, login karo => `/dashboard`.
- [ ] Publisher account se `/dashboard/advertiser` => `/dashboard` par laut aata hai (aur ulta).
- [ ] SQL Editor se us user ka `profiles.status = 'suspended'` karke dashboard kholo => "Account unavailable" page; wapas `active` karo.
Public landing page + mobile (360 px width):
- [ ] `/` bina login ke khulta hai, Hero/sections/Footer wahi hain, nav me "Log in" dikhta hai.
- [ ] `/`, `/login`, `/signup`, `/dashboard` par horizontal scroll nahi.
- [ ] Inputs 44 px ke aas-paas, keyboard khulne par button dikhta hai, Show/Hide password chalta hai.
- [ ] Dashboard bottom nav content ko nahi dhakta.

## E. GitHub me commit (Spck Editor, Android)
1. Zip kholo (Spck me ya Files app se) aur 16 files apne project me **usi path par** rakho (purani overwrite).
2. Spck > Git (branch icon) > changed files dikhengi > sab select (stage).
3. Commit message: `Day 3: server-side role checks, DB health check, security tests`
4. Commit > Push (origin/main). Agar `.env` jaisi koi file staged dikhe toh unstage karo (hum koi env file nahi bhej rahe).
Agar Spck me dikkat: GitHub app/website > repo > "Add file" > "Upload files" (folders ke saath).

## F. Vercel env + verify
1. Vercel > Project > Settings > Environment Variables (Production + Preview dono):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_...`
   - `NEXT_PUBLIC_SITE_URL` = tumhara live URL (bina last slash)
   - Secret key yahan NAHI.
2. Supabase > Authentication > URL Configuration: Site URL = live URL; Redirect URLs me `https://<live-url>/auth/confirm` add karo.
3. Env badalne ke baad Vercel > Deployments > latest > Redeploy (NEXT_PUBLIC values build time par bakne hoti hain).
4. Deployment "Ready" ho toh D2 checklist chalao. Build fail ho toh Vercel > Deployments > Build Logs ka error text bhejo.
