# Day 14 Part 3: production environment + security safeguards

Koi asli secret is repo me nahi. Billing / payout / ledger settings is part me nahi chhue gaye.

## Vercel me ye variables haath se set karne hain (Settings > Environment Variables)

| Variable | Zaroori? | Public? | Environment | Note |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Haan** | Haan | Production, Preview | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Haan** | Haan | Production, Preview | Sirf `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **Haan** | **NAHI** (bina `NEXT_PUBLIC_`) | Production (Preview ke liye alag TEST project ki key) | `sb_secret_...`, "Sensitive" ON |
| `AD_TRACKING_SECRET` | Optional | **NAHI** | Production | 32+ random characters (64 hex behtar), "Sensitive" ON |
| `AD_TRACKING_SECRET_PREVIOUS` | Optional | **NAHI** | Production | Sirf secret rotate karte waqt |
| `AD_TRACKING_TTL_SECONDS` | Optional | Nahi (secret nahi) | Production | 60..86400, default 3600 |
| `NEXT_PUBLIC_SITE_URL` | Optional | Haan | Production | Khali ho toh request host / Vercel production URL |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional | Haan | Production | `/privacy`, `/terms` par dikhta hai |

Vercel khud `VERCEL_PROJECT_PRODUCTION_URL` deta hai: haath se set nahi karna. Publisher ke `BLISSCCO_PUBLISHER_API_KEY` / `BLISSCCO_API_BASE_URL` publisher ke apne server ke hain, Blisscco ke Vercel me nahi.

Random secret banane ke liye (apne computer par, output kisi ko mat bhejo):
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Env change ke baad **Redeploy** zaroori hai.

## Kya hota hai jab config kam ya galat ho

| Sthiti | Natija |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` missing ya galat | `/dashboard` band (login par `?error=config`), server-side error me variable ka NAAM; Vercel log: `[config] public supabase env unusable` (ek baar per instance) |
| `SUPABASE_SECRET_KEY` missing | Ad API 503 `unavailable` (publisher ko koi detail nahi); key manager / ledger bhi fail (generic error). Vercel log: `[config] missing server env: <NAAM>` |
| `SUPABASE_SECRET_KEY` me publishable/anon key ya placeholder, ya URL ka format galat | Wahi 503, log: `[config] invalid server env: <wajah>` (value kabhi nahi) |
| `AD_TRACKING_SECRET` missing / 32 se kam / placeholder / `sb_secret_`, `blc_live_`, JWT jaisa | Tracking band: **ad matching pehle jaisi chalti hai**, jawab me `tracking` nahi; impression/click endpoints 503 `unavailable`. Log (ek baar per instance): `[ads/serve] tracking token off` (set nahi) ya `[ads/serve] tracking secret rejected` (set hai par code ne reject kiya) |
| Koi `NEXT_PUBLIC_` variable ka naam secret jaisa (SECRET, SERVICE_ROLE, PRIVATE, PASSWORD, TOKEN, SIGNING, API_KEY) ya value `sb_secret_` / `blc_live_` / service_role JWT | **Build ruk jata hai** (`config/public-env-guard.mjs`), error me sirf variable ka naam |

## Safeguards (confirmed + is part me joda gaya)

- Secret key sirf `lib/supabase/admin.ts` me padhi jaati hai (`server-only`); signing secret sirf `lib/ads/service.ts` me. Client components in modules ko import nahi karte (tests se bandha hua).
- Naya: admin client galat key (publishable/anon/placeholder) ya galat URL par pehle hi saaf error deta hai, warna RLS har call ko chup-chaap rok deta.
- Naya: build-time guard (upar table ki aakhri row).
- Naya: tracking band hone ka reason log me (alag static label: "token off" = set nahi, "secret rejected" = set par reject; secret ka koi hissa nahi); middleware config chhootne par ek baar naam log karta hai.
- Logs / API jawab: sirf error code ya static label. Secret, key, hash, token kabhi nahi. `/api/supabase-health` sirf `ok` / `unavailable`.
- Publisher keys DB me SHA-256 hash; auth, RLS, role checks, billing/payout unchanged.
- `.gitignore`: `.env`, `.env.*` (sirf `.env.example` committed), `.vercel`, ab `*.pem`, `*.log`, `.supabase`, `supabase/.temp` bhi.

## Deploy ke baad check
1. `/api/supabase-health` => `{"status":"ok"}`.
2. Vercel logs me `[config]` ya `tracking token off` line na ho (tracking jaan-boojh kar band ho toh `tracking token off` normal hai).
3. Ek test publisher key se `/api/v1/ads/match` => 200; `X-Blisscco-Tracking: 1` ke saath `tracking` tabhi aata hai jab `AD_TRACKING_SECRET` set ho.
