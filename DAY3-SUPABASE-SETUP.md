# Day 3: Supabase integration (auth / DB queries abhi nahi)

## Packages
`@supabase/supabase-js` + `@supabase/ssr` (package.json me already add). Vercel build par `npm install` khud chalega. Terminal ho toh:
`npm install @supabase/supabase-js @supabase/ssr`

## Browser vs Server
| File | Kahan chalta hai | Use |
|---|---|---|
| lib/supabase/client.ts | Browser (client components, "use client") | createClient() |
| lib/supabase/server.ts | Server (server components, route handlers, server actions) | await createClient() |
| lib/supabase/env.ts | Dono | env check + errors |
| app/api/supabase-health/route.ts | Server | optional config check |

- Dono clients sirf PUBLISHABLE key use karte hain. Secret key is stage me kahin use nahi hoti.
- Browser client library khud ek hi instance reuse karti hai, extra client mat banao.
- Naya client har request par server.ts se hi lo (server par share/global mat karo).

## Android setup
1. Supabase > Project > "Connect" (ya Settings > API Keys) se Project URL aur sb_publishable_ key copy karo.
2. Vercel > project > Settings > Environment Variables:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   Production + Preview + Development select karke Save.
3. Deployments > Redeploy (env change ke baad zaroori).
4. Missing/galat value hogi toh Supabase use karte hi clear error aayega.
5. Secret key (sb_secret_ / service_role) GitHub me kabhi nahi, aur `NEXT_PUBLIC_` ke saath kabhi nahi. (Update, Day 14: ad API ke liye `SUPABASE_SECRET_KEY` ab Vercel me SIRF server variable ke roop me chahiye: poori list `DAY14-PART3-PRODUCTION-ENV.md` me.)

## Optional check
`/api/supabase-health` kholo: `{"status":"ok"}` matlab database tak request gayi (pehle `supabase/sql/day-3-7-health-check.sql` chalao). `{"status":"unavailable"}` (HTTP 503) matlab env ya SQL check karo; kaaran sirf Vercel logs me dikhta hai.
