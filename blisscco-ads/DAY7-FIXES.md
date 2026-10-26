# Day 7: Week 1 ke sab fixes (simple bhasha me)

> **OWNER NOTE:** Deployment se pehle impressions aur clicks ki ginti (tracking) aur baaki related cheezein (etc.) ka kaam/review kiya jayega. Uske bina deploy/billing nahi.

Ye file batati hai ki Day 7 review me jo problems mili thi wo kaise theek hui, kya tumhe khud karna hai, aur kya baaki hai.

## Pehle ye 3 kaam karo (is order me)
1. **Supabase SQL Editor** me `supabase/sql/day-7-1-budget-keys-retention.sql` chalao (pehle test project par, phir asli par). Dobara chalane par safe hai.
2. Phir `supabase/sql/day-7-2-verify.sql` chalao aur har check ke neeche likhe "Expect" se milao.
3. Pehla **admin** banao (sirf SQL se hota hai, app se nahi). Pehle us email se signup karo, phir:
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'TUMHARI-EMAIL');`
   Admin ke liye bilkul nayi email use karo (jis email se advertiser ya publisher ka record ban chuka ho, use admin mat banao).

## Ab poora kaam kaise chalta hai
- **Advertiser:** signup, business ka naam save, admin approve, campaign banao, ad (creative) banao, "Send for review", admin ad approve kare, phir campaign review ke liye bhejo, admin campaign approve kare. Tab ad dikhna shuru.
- **Publisher:** signup, platform ka naam save, admin approve, dashboard me "Create new key" (key sirf ek baar dikhti hai, copy kar lo), apne server se API call.
- **Admin:** Dashboard me "Admin" page: naye accounts, ads aur campaigns approve/reject.

## Kya theek hua

### Critical
| Problem | Ab kya hai |
|---|---|
| Budget kabhi rukta nahi tha | Har ad dikhne par uski keemat (CPM / 1000) kharch me judti hai. Total ya daily budget paar hote hi ad band. Advertiser apne campaign page par kharch dekh sakta hai. |
| Advertiser ad nahi bana sakta tha | Campaign page par "Add an ad", "Send for review", "Take back", "Archive" |
| Approve karne ka screen nahi tha | `/dashboard/admin` |
| Advertiser/publisher ki row hi nahi banti thi (naya mila) | Pehli baar login par "Set up your business / platform" form |
| Campaign ko review ke liye bhejne ka button nahi tha (naya mila) | Campaign page par "Send for review" |
| SQL tests asli DB par nahi chale | Ye main yahan se nahi chala sakta. `day-7-2-verify.sql` tum chalao. |
| package-lock.json nahi | Main bina internet ke bana nahi sakta. GitHub par push karoge toh CI khud banake "Artifacts" me `package-lock` naam se dega: use download karke repo me daal do. |
| Galat key ki spam | Code me ek IP se 1 minute me 20 galat key ke baad 429. Ye sirf pehli deewar hai. **Vercel Firewall me rate-limit rule abhi bhi lagao** (neeche). |

### High
| Problem | Ab kya hai |
|---|---|
| Database band hone par "koi ad nahi" (200) aata tha | Ab 503 aata hai |
| Publisher key nahi bana sakta tha | Publisher page par banao, 5 tak, expiry (30/90/365 din ya kabhi nahi), revoke |
| Dashboard ke numbers nakli the | Nakli pages hata diye. Overview aur Admin asli hain. Analytics page ab saaf bolta hai "abhi nahi" |
| Landing par Sign up nahi tha | Nav, Get started aur Advertiser pilot me Sign up |
| Impressions/clicks | **Abhi nahi.** Ye alag feature hai (naye endpoints chahiye). Charge abhi "serve" par lagta hai. Billing/payout ke liye mat use karna. |
| Purana match function | Database me band (execute hata diya). Purana route `/api/ads/match` rakha hai: wo v1 wala hi code chalata hai, to alag khatra nahi. |
| Timeout nahi | Database call 8 second, route 15 second |

### Low
Role ke hisaab se sidebar, India time ka saaf note (din 5:30 AM IST par badalta hai), 404 aur error pages, social preview image + sitemap + robots, ESLint (`npm run lint:eslint`), roz raat ki safai (`private.purge_old_ad_logs`, pg_cron ON ho tab khud), security headers.

## Vercel Firewall rule (haath se, 2 minute)
Vercel project, Firewall, Add Rule, path `/api/v1/ads/match` aur `/api/ads/match` par rate limit (jaise 60 request/minute per IP), action "Deny".

## Purani files jo ab kaam ki nahi (chaho toh baad me hata sakte ho)
`DAY2-*.md`, `DAY3-*.md`, `DAY4-*.md`, `DAY5-*.md` purani history hain. Asli guide: `SETUP.md`, `DAY6-API-V1.md` aur ye file.

## Tests
`npm test` me ab 972 tests hain (Day 7 ke end tak; pehle 598). Naye: login ke niyam, route ki security, campaign/ad ke form, admin ke faisle, publisher key, landing page ke links, IP guard, SQL migration ki static jaanch.
