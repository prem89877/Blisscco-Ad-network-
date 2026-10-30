# Custom domain (Vercel) + Google login (Supabase) — Android steps

`yourdomain.com` ki jagah apna asli domain, `<project-ref>` ki jagah apna Supabase project ref likhna.
Order follow karo: A -> B -> C -> D -> E -> F.

## A. Vercel me domain add karna
WARNING: Agar ye domain abhi kisi aur site par chal raha hai, DNS badalte hi wo site Vercel par aa jayegi (purani site band ho jayegi).
1. Vercel > apna project > Settings > Domains > Add > `yourdomain.com` likho > Add.
   Vercel `www.yourdomain.com` bhi add karne ko bolega (recommended). Ek ko primary rakho, dusre se redirect.
2. Domain ke registrar (GoDaddy/Namecheap/Hostinger etc.) > DNS settings me:
   - Type **A**, Name `@`, Value `76.76.21.21`
   - Type **CNAME**, Name `www`, Value: **jo Vercel ke domain card me dikhe** (aam taur par `cname.vercel-dns.com`; Vercel kabhi project-specific value deta hai, wahi use karo)
   - Purane A/AAAA/CNAME records jo us domain ko kisi aur host par bhejte hain, hata do (AAAA SSL atka sakta hai).
3. Vercel me status "Valid Configuration" hone tak ruko (minutes se kuch ghante). SSL Vercel khud banata hai.
4. Agar domain pehle kisi dusre Vercel project/account me tha, Vercel TXT record verify karne ko bol sakta hai: jo value dikhe wo DNS me daalo.

## B. Vercel env update
1. Settings > Environment Variables > `NEXT_PUBLIC_SITE_URL` = `https://yourdomain.com` (primary wala, bina last slash).
2. Deployments > latest > Redeploy. (NEXT_PUBLIC values build time par bakti hain.)

## C. Supabase URL Configuration
Supabase > Authentication > URL Configuration:
- Site URL = `https://yourdomain.com`
- Redirect URLs me add karo: `https://yourdomain.com/auth/confirm` (www use karte ho toh `https://www.yourdomain.com/auth/confirm` bhi). Testing ke liye `https://<project>.vercel.app/auth/confirm` rehne do.
- Save.

## D. Google Cloud Console
1. console.cloud.google.com > project banao/chuno > **Google Auth Platform**.
2. **Branding**: App name (Blisscco), support email, Authorized domains me `yourdomain.com` (aur `supabase.co`). Logo abhi mat daalo (logo dene par extra verification lagti hai).
3. **Audience**: User type **External**. Phir **Publish app** (Production) karo, warna sirf "Test users" login kar paayenge. Sirf email/profile/openid scopes use hote hain, inme Google review nahi lagta.
4. **Clients > Create client** > Application type **Web application**.
   - **Authorized redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback` (exact; Supabase ke Google provider page par bhi yahi dikhta hai, wahan se copy karo).
   - Authorized JavaScript origins: is flow me zaroori nahi.
5. Create > **Client ID** aur **Client secret** copy karo.

## E. Supabase me Google ON
Supabase > Authentication > Sign In / Providers (Providers) > **Google** > Enable > Client ID + Client secret paste > Save.
Secret sirf yahin jata hai. Vercel, GitHub, code ya chat me kabhi nahi.

## F. Code push + test
1. Zip ki 6 files project me usi path par rakho, commit + push (Spck).
2. Test (Android Chrome, naya incognito tab):
   - [ ] `https://yourdomain.com` khulta hai (lock icon, SSL ok); landing page wahi hai.
   - [ ] `/login` aur `/signup` par "Continue with Google" dikhta hai.
   - [ ] Click > Google account chuno > wapas `https://yourdomain.com/dashboard` (vercel.app par nahi).
   - [ ] Supabase > Authentication > Users me naya user (provider: google). `profiles` me role = advertiser.
   - [ ] Logout, phir dobara Google login: chalta hai.
   - [ ] Email+password login ab bhi chalta hai.
Note: Google se signup karne wale sab advertiser bante hain. Publisher banna ho toh email signup me "AI Publisher" chuno. (Role koi user khud nahi badal sakta.)
Note: vercel.app par bani purani sessions custom domain par nahi chalengi; ek baar dobara login karna hoga.

## Agar error aaye
| Error | Matlab |
|---|---|
| Google: `redirect_uri_mismatch` | Google client ka Authorized redirect URI Supabase ke callback URL se exact match nahi karta |
| Google: "Access blocked" / "app in testing" | Audience me app Publish karo, ya Test users me apna email daalo |
| `/login?error=confirm_failed` | Supabase Redirect URLs me `https://yourdomain.com/auth/confirm` missing, ya Site URL galat |
| Login ke baad vercel.app par pahunch gaya | `NEXT_PUBLIC_SITE_URL` set nahi/purana, ya Redeploy nahi hua |
| `/login?error=oauth_failed` | Supabase me Google provider ON nahi, ya Client ID/secret galat. Vercel Logs me `[auth] google oauth start failed` dekho |
