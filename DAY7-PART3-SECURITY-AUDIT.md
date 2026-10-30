# Day 7 Part 3: Security audit (simple bhasha me)

## Sabse pehle: kya chala, kya NAHI chala
| Cheez | Haal |
|---|---|
| `npm test` jaisa suite (code + SQL files ki static jaanch) | **Chala: 953 pass, 0 fail** (855 purane + 98 naye) |
| Naye tests sach me kaam karte hain ya nahi | **Chala:** 10 jaanbujh kar toote hue code par check kiya, 10 ke 10 pakde gaye, phir code wapas theek kiya |
| Asli Supabase par do accounts (A aur B) ke tests | **NAHI chala.** Mere paas Supabase nahi tha. Tests file ban gayi hai: `supabase/sql/day-7-3-authz-gap-tests.sql`. Tum chalao. |
| Next.js build / `tsc --noEmit` poora project | **NAHI chala.** `node_modules` aur internet nahi tha. |
| Browser me login / redirect ka live test | **NAHI chala.** |

Isliye **"security verified" nahi keh raha.** Jo hua wo: poora code aur SQL padha, aur jo check ho sakta tha wo test kiya.

## Teen cheezein jo mujhe asli me mili (sab padhne par)
1. **Email link ka host (fix kiya).** `getSiteUrl` header jaisa aaya waisa le leta tha. Agar `NEXT_PUBLIC_SITE_URL` set na ho, to koi bahari vyakti header badal kar verification email ka link apni site par mod sakta tha. Ab sirf saaf hostname maana jata hai, aur asli site par hamesha `https`. Supabase ki "Redirect URLs" list pehle se dusri deewar hai.
2. **Purane tests me kamzori (fix kiya).** Pehle test sirf dekhta tha ki file me `requireRole(` kahin likha hai. Ab har action me ye bhi dekha jata hai ki login check database call se PEHLE aata hai.
3. **SQL tests me jagah khali thi (file di).** Purane tests me ye nahi tha: B ko A ka creative dikhna, B ka A ka creative/campaign badalna, B ka A ka paused campaign resume karna, B ka A ka kharch dekhna, anon ka kharch function chalana, aur "kisko kis column par haq hai" ki poori list.

## Tumhari list ke hisaab se
| Zaroorat | Kya mila | Kaise pata chala |
|---|---|---|
| Login ke bina dashboard nahi | Middleware + layout + har page + har action me login check | Code padha + test (static) |
| Advertiser sirf apne campaigns | RLS + code me `advertiser_id` filter | SQL padha + purane SQL tests jo tumne chalaye the. **Naye gap tests abhi baaki.** |
| A, B ka campaign nahi dekh/badal sakta | Same | Same |
| Khud ko admin nahi bana sakta | Column grant + trigger + signup sirf advertiser/publisher | SQL padha + test (static). Day-3-6 TEST 3, 20 tumne chalaye the |
| Publisher key browser/log me nahi | Key sirf hash me DB me. Plain key sirf banate waqt ek baar owner ko dikhti hai (jaisa socha tha). Koi log nahi | Code padha + test (static) |
| Service-role key sirf server par | 5 server-only files hi use karti hain. Client file me import nahi | Test (static) |
| Create/edit/pause/resume server par check | Role, ownership, status, stale-time, aur DB trigger | Code padha + test (static) |
| Unsafe redirect nahi | `safeNextPath` sab jagah. 24 galat inputs se test | Test (chala) |
| Sensitive error nahi | DB error sirf fixed message me badalta hai | Test (static) |

## Migration chahiye?
**Nahi.** Mujhe aisa gap nahi mila jo naye SQL se hi theek hota. RLS band nahi kiya, koi khuli policy nahi banayi, purani migration nahi badli. Isliye deployment order me SQL kuch nahi.

## Deploy order
1. Code push karo (`lib/auth/site-url.ts` + `lib/auth/site-url-parse.ts`).
2. `NEXT_PUBLIC_SITE_URL` Vercel me set karo (agar nahi hai). Ye sabse safe hai.
3. Test project par `day-7-3-authz-gap-tests.sql` ke blocks ek-ek karke chalao aur "Expect" se milao.

## Jo mai verify nahi kar saka (tumhe dekhna hai)
- **Supabase Dashboard:** Authentication > URL Configuration me sirf tumhari site ke URLs hon. Email confirmation ON ho.
- **Next.js version:** `package.json` me `^15.1.0` hai aur `package-lock.json` nahi hai. Meri jaankari me middleware wali bada bug (CVE-2025-29927) 15.2.3 se pehle ke versions me tha. Jab lockfile bane to dekh lena ki `next` 15.2.3 ya usse upar hai. Is app me middleware ke alawa layout, page aur action me bhi login check hai, isliye asar kam hota, par phir bhi dekh lo.
- **Vercel Firewall rate-limit** (DAY7-FIXES.md me bataya tha) abhi lagana baaki hai.
- **CSP header** nahi hai. Ye jaanbujh kar nahi lagaya: bina build chalaye lagane se site toot sakti hai.

## Design note (bug nahi)
Advertiser apne **active** campaign ka budget, dates aur naam admin review ke bina badal sakta hai (category lock hai). Publisher ko campaign ka naam/description kabhi nahi jata. Agar tum chaho ki budget badalne par bhi review ho, to ye alag feature hai.

## Purani file
`lib/ads/match.ts` ab sirf ek test me use hota hai. Isme service-role client hai aur wo purana DB function bulata hai jise Day 7 me band kar diya tha. Abhi chhua nahi. Baad me hata dena.
