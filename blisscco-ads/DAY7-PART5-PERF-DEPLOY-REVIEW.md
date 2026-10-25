# Day 7 / Part 5: Performance + Deployment-Safety Review (simple bhasha me)

Is review me kuch naya feature nahi bana. Sirf audit me jo mila, wahi theek kiya.

## Audit ka nateeja

| Cheez | Nateeja | Kya kiya |
|---|---|---|
| Personalized ad API ka cache | Pehle se theek: `force-dynamic` + `Cache-Control: no-store` har jawab me | Upar se `Vary: Authorization` bhi lagaya (agar beech ka koi proxy galti se cache kare, toh ek publisher ka jawab doosre ko nahi jayega) |
| Request body size / validation | Pehle se theek: 2 KB limit (header + stream dono), sirf `application/json`, sirf 2 fields, topic/ids ka strict format | Kuch nahi badla |
| Extra database kaam | Har ad request me 3 rpc: authorize, candidates, record. Teeno zaroori hain. Lekin (1) har rpc par naya Supabase client ban raha tha, (2) authorize me har request par purani rate-limit rows ka `delete` chalta tha | (1) Client ab ek instance me ek baar banta hai. (2) `day-7-5` SQL: delete sirf naye minute ki pehli request par |
| Duplicate matching logic | `lib/ads/match.ts` (purana single-call bridge) ab production me use nahi hota (database function ka execute pehle hi band hai). Sirf tests use karte hain | Hataya NAHI (tests tootte). Chaaho toh baad me alag step me hata sakte hain |
| Error handling | Database ke errors me sirf error code log hota hai, key/topic/body kabhi nahi | Handler ke andar koi bhi anjaani galti ho toh ab saaf JSON `503 {fill:false,error:"unavailable"}` milta hai (pehle Next.js ka default 500) |
| Missing env | `SUPABASE_SECRET_KEY` na ho toh pehle sirf 503 aata tha, logs me wajah nahi dikhti thi | Ab Vercel logs me variable ka NAAM likha aata hai (value kabhi nahi) |
| Secrets client bundle me | Koi nahi mila. Secret key sirf `lib/supabase/admin.ts` me (server-only). `next.config.mjs` me `env` block nahi. Publishable key me secret daalne par app khud error deta hai | Test jode taaki aage koi galti kare toh pakdi jaye |
| GitHub me secret | `.gitignore` sirf `.env*.local` rok raha tha. Matlab `.env` ya `.env.production` commit ho sakti thi | `.gitignore` theek kiya: `.env`, `.env.*` band, `.env.example` allowed |
| TypeScript / build | `strict: true` hai. ESLint build ko rokta nahi (alag chalta hai) | Kuch nahi badla (neeche "jo main check nahi kar paya" dekho) |
| Dependencies | Koi bekaar package nahi mila. `eslint@8` purana (deprecated) hai | Abhi nahi badla: upgrade alag, sambhal ke karna hoga |

## Rate limit: sach kya hai (zaroor padho)

1. **Per-key limit (60 request/minute)** Postgres me hota hai (ek atomic counter, `api_rate_limits`). Saare Vercel instances ek hi database dekhte hain, isliye ye **sab instances ke beech sahi chalta hai**. Ye hamara asli rate limit hai.
2. **IP par galat-key guard** (`lib/ads/ip-guard.ts`) **server ki memory me** rehta hai. Vercel serverless me har instance ki memory alag hai, naya instance shuru hote hi count zero, aur instance band hote hi count gayab. Isliye ye **poori tarah bharosemand NAHI hai**. Ye sirf "pehli chhoti deewar" hai: kam galat keys par database tak jaane se pehle roke. Ek hamlavar ko ye pakka nahi rokega.
3. Galat keys ki spam ko sach me rokne ke liye **Vercel Firewall rate-limit rule** lagao (neeche). Wo Vercel ke edge par hota hai, instances par nirbhar nahi.
4. IP `x-forwarded-for` ke pehle hisse se aata hai. Vercel par ye Vercel khud set karta hai. Agar kabhi Vercel ke bahar deploy karo toh ye header koi bhi jhootha bhej sakta hai, tab ye guard bekaar hoga.

## Vercel me kya karna hai

**Settings > Environment Variables** (asli values yahan daalo, GitHub me kabhi nahi):

| Naam | Public? | Kahan lagao | Note |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Haan (browser me jaata hai, theek) | Production, Preview, Development | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Haan (theek) | Production, Preview, Development | Sirf `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **NAHI. Kabhi `NEXT_PUBLIC_` mat lagana** | Production (aur chaaho toh Preview) | `sb_secret_...`. "Sensitive" option ON karo. Preview ke liye alag TEST Supabase project ki key behtar hai |
| `NEXT_PUBLIC_SITE_URL` | Haan, optional | Production | Tumhari site ka URL |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Haan, optional | Production | Privacy page par dikhta hai |

Zaroori baatein:
- `NEXT_PUBLIC_...` values build ke time code me ghus jaati hain. Inhe badalne ke baad **Redeploy** karo.
- Agar kabhi secret key galti se GitHub/chat me chali jaaye: Supabase me turant **rotate** karo, phir Vercel me nayi daalo.
- Logs me `[config] missing server env: SUPABASE_SECRET_KEY` dikhe toh matlab variable Vercel me nahi hai (ya galat environment me hai).

**Vercel Firewall rule** (2 minute): Project > Firewall > Add Rule. Path `/api/v1/ads/match` aur `/api/ads/match`, rate limit jaise 60 request/minute per IP, action Deny.

**Region (speed):** Vercel > Settings > Functions > Function Region ko apne Supabase project ke region ke paas rakho. Har ad request me 3 database calls hoti hain, isliye doori ka asar teen guna padta hai.

**Supabase SQL (optional, performance):** `supabase/sql/day-7-5-rate-limit-cleanup.sql` pehle TEST project par chalao, phir `day-7-2-verify.sql` dobara chalake dekho. Dobara chalana safe hai. Isko na chalao toh bhi sab kuch pehle jaisa kaam karega.

## Jo main check nahi kar paya (honest)

- Yahan internet band hai, isliye `npm install`, `next build` aur poora `tsc --noEmit` main nahi chala paya. Maine sirf project ka test suite chalaya (972 tests pass). **Deploy se pehle GitHub CI (type check + build) green hona chahiye.**
- `package-lock.json` abhi repo me nahi hai (versions `^` se float karte hain). CI se banne wali `package-lock` file download karke repo me daal do, phir CI me `npm install` ki jagah `npm ci` use kar sakte ho.
- SQL (`day-7-5`) main asli Supabase par nahi chala paya, sirf code ki tarah check kiya.

## Chhoti baat jo jaan-boojh kar chhodi
`lib/ads/serve.ts` ka `catch` ab bhi chupchaap `unavailable` deta hai, kyunki is file me logging manana hai (purane tests se bandhi). Asli database errors apni jagah (`serve-db.ts`, `candidate-loader.ts`) code ke saath log hote hain.
