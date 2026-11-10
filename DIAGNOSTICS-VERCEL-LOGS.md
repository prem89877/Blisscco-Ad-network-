# Diagnostics: slow button / error screen ke liye Vercel logs

Vercel > Project > Logs me search box me `[diag]` likho. Har line `[diag] event=... key=value` hoti hai.

| event | kab aata hai | kahan se |
|---|---|---|
| `action_slow` | button ka server action 5s+ laga (kaam ho bhi gaya ho). `label` = dabaye gaye button ka text, `ms` = kitna laga, `outcome` = success / error / redirect | browser (`source=browser`) |
| `action_timeout` | button 20s tak jawab nahi aaya (user ko "taking longer than expected" dikha) | browser |
| `action_failed` | network / unexpected error (`errName`, `errMsg`) | browser |
| `error_boundary` + `source=browser` | user ko "Something went wrong" screen (Try again / Home page) dikhi. `boundary` = app / dashboard / global / campaigns / creatives / analytics | browser |
| `error_boundary` + `source=server` | server par page / action toota. `digest` wahi hai jo browser line me hai: dono ko `digest` se jodo | server (`instrumentation.ts`) |
| `request_slow` | middleware session check ya dashboard layout ka auth 3s+ laga (`label=middleware_session_check` / `dashboard_layout_auth`) | server |
| `request_trace` | sirf `DIAG_VERBOSE=1` par: har /dashboard, /login, /signup request. `conditional=true` = browser ne if-none-match bheja (304 ka sambhaw), `rsc` / `prefetch` bhi dikhta hai | middleware |

Browser lines me `vercelId` hota hai: Vercel Logs me wahi id se poori request (status code 304 / 500 / 504 samet) milti hai.

## Env (optional, Vercel > Settings > Environment Variables)
- `DIAG_SLOW_MS` (default 3000): server ki slow-line ki limit.
- `DIAG_VERBOSE=1`: har dashboard request ki line. Jaanch ke baad hata do (logs bhar jaate hain).

## Safety
Sirf event ka naam, path (bina query), ms, digest, error ka naam aur chhota msg log hota hai. Koi cookie, token, form value, email ya key nahi. `/api/diag` sirf same-site, 2 KB body, fixed event list, ek instance par 60 line / minute; jawab hamesha khali 204.
