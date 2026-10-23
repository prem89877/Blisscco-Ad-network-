# Day 3: Supabase connect (sirf connection, koi table/auth nahi)

## A. Supabase project banana (Android Chrome)
1. Chrome me supabase.com kholo > Sign in (GitHub se login sabse aasan).
2. Menu me "Desktop site" on kar lo, dashboard phone par aasan dikhta hai.
3. New project > Organization chuno > Name: `blisscco-ads`.
4. Database password strong rakho aur kahin safe save karo (ye app me nahi lagega).
5. Region apne users ke sabse paas wala chuno (India ke liye Mumbai agar dikhe).
6. Create project dabao, 1-2 minute ruko.

## B. URL aur publishable key kahan milegi
- Project > upar "Connect" button > App Frameworks > Next.js. Wahan dono values dikhti hain.
- Ya: Project Settings > API Keys.
  - Project URL: `https://xxxx.supabase.co`
  - **Publishable key**: `sb_publishable_...` (agar nahi dikhe toh "Create new API Keys" dabao)
  - **Secret key**: `sb_secret_...` (isse kabhi public mat karo)

## C. Environment variables
| Naam | Value | Public? |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Project URL | Haan |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | sb_publishable_... | Haan |
| SUPABASE_SECRET_KEY | sb_secret_... | NAHI, sirf server (abhi optional) |

## D. Vercel me daalna
1. Vercel > project > Settings > Environment Variables.
2. Upar ke teen (ya sirf pehle do) add karo, Production + Preview + Development teeno select.
3. Save > Deployments > latest > Redeploy (env change ke baad redeploy zaroori hai).

## E. Local (Android par)
Laptop/terminal nahi hai, isliye `.env.local` ki zarurat nahi. Vercel hi tumhara test environment hai. `.env.example` sirf naam yaad rakhne ke liye hai (isme asli key nahi).

## F. Secret ko GitHub se bachana
- `.gitignore` me `.env*.local` pehle se hai.
- Asli keys kisi file me mat likho, sirf Vercel me.
- Secret key ke naam me `NEXT_PUBLIC_` kabhi mat lagao.
- `lib/supabase/admin.ts` me `server-only` hai, client code me import karoge toh build fail hoga.
- Galti se key GitHub par chali jaye toh Supabase me turant naya key banao aur purani delete karo.

## G. Check kaise karein
Deploy ke baad `https://TUMHARI-SITE/api/supabase-health` kholo.
`{"configured":true,"reachable":true,...}` aaye toh connection sahi hai.

## H. Files
Naya: `.env.example`, `lib/supabase/{env,client,server,admin}.ts`, `app/api/supabase-health/route.ts`, `DAY3-SUPABASE-SETUP.md`
Badla: `package.json` (3 packages: @supabase/ssr, @supabase/supabase-js, server-only)
Koi purana page nahi chhua. Vercel build pe `npm install` khud chalega.

## I. SQL file naming (aage ke din ke liye)
Simple naam: `day-3-authentication.sql`, `day-3-profile.sql`. Abhi koi SQL nahi bana.
