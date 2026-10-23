# Day 3: Authentication setup (Supabase Auth + Next.js)

STATUS: code likha gaya hai, par abhi kisi asli environment me run/test NAHI hua.
"Login chalta hai" tab maano jab neeche ke Android tests tumhare Vercel deploy par pass ho jayein.

## 1. Supabase Dashboard settings
1. **Authentication > Sign In / Providers > Email**: Email provider ON. "Confirm email" ON rakhna (recommended).
   Password minimum length 8 kar do (app bhi 8 maangta hai).
2. **Authentication > URL Configuration**
   - Site URL: `https://TUMHARI-SITE.vercel.app`
   - Redirect URLs: `https://TUMHARI-SITE.vercel.app/**` add karo.
3. **Authentication > Email Templates > Confirm sign up**: link ko neeche wale se badlo
   (isse link kisi bhi browser ya Gmail app me khulne par chalta hai):
   ```html
   <h2>Confirm your email</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a></p>
   ```
4. Email bhejna: Supabase ka built-in email sender sirf testing ke liye hai (kam emails/ghanta aur
   aksar sirf tumhari team ke emails par jata hai). Asli users ke liye baad me Custom SMTP lagao
   (Authentication > Emails/SMTP). Abhi test ke liye apna khud ka email use karo.
5. (Optional, baad me) Authentication > Attack Protection: CAPTCHA aur leaked password protection.

## 2. Vercel
- Pehle jaise `NEXT_PUBLIC_SUPABASE_URL` aur `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` hi chahiye.
- Optional: `NEXT_PUBLIC_SITE_URL` = tumhari site ka URL.
- Koi naya package nahi. Secret/service_role key kahin nahi.
- Files GitHub par push karo, Vercel khud deploy karega.

## 3. Browser vs Server
| Code | Kahan chalta hai |
|---|---|
| `components/auth/*` (forms) | Browser (sirf form dikhana) |
| `app/auth/actions.ts` (signIn, signUp, signOut, resend) | Server (Server Actions) |
| `app/auth/confirm/route.ts` | Server (email link) |
| `middleware.ts`, `lib/supabase/middleware.ts` | Server/Edge (session refresh + redirect) |
| `lib/auth/session.ts`, `app/dashboard/layout.tsx` | Server (getUser() se verify) |

- Role/permission browser ki kisi value se nahi liya jata. Account type signup par sirf shuruaati choice hai;
  database sirf advertiser/publisher manta hai, admin kabhi nahi.
- Server par `getUser()` use hota hai (Supabase se token verify). `getSession()` server par trust nahi karte.
- Logout `scope: local`: sirf is device ka session band hota hai.
- Login ke baad redirect sirf `/dashboard...` par (open redirect band).
- Passwords/tokens log nahi hote; sirf error code.
- Important: Server Actions/route handlers me har protected kaam ke pehle `getCurrentUser()`/`requireUser()` khud bulao.
  Middleware akela kaafi nahi.

## 4. Android testing checklist (Vercel deploy par)
Test ke liye apna email use karo.
1. `/api/supabase-health` => `{"configured":true,"reachable":true,...}`
2. Private/incognito tab me `/dashboard` kholo => `/login?next=/dashboard` par pahunchna chahiye.
3. `/login?next=https://evil.com` kholo, login karo => `/dashboard` par hi aana chahiye (evil.com par nahi).
4. `/signup`: chhota password (3 akshar) => error dikhe. Alag passwords => "Passwords do not match".
5. Sahi email + password se signup:
   - Confirm email ON: "verification link bheja" message. Email me link kholo => `/dashboard` khulna chahiye.
   - Confirm email OFF: seedha `/dashboard`.
6. Verify se pehle login try karo => "email not verified" + "Resend verification email" button.
7. Galat password => "Incorrect email or password." (sahi email ho tab bhi wahi message).
8. Login ke baad `/login` ya `/signup` kholo => `/dashboard` par bhej dena chahiye.
9. Dashboard me "Log out" dabao => `/login` par "You have been logged out."; back dabane par dashboard nahi khulna chahiye.
10. Landing page `/` bina login ke pehle jaisa khulna chahiye; menu me "Log in" link.
11. Database check (SQL Editor) - naya user + profile bana?
    ```sql
    select u.email, u.email_confirmed_at is not null as verified, p.role, p.status
    from auth.users u left join public.profiles p on p.id = u.id
    order by u.created_at desc limit 5;
    ```
    Signup me "AI Publisher" chuna ho toh `role = publisher`, warna `advertiser`.

## 5. Dikkat aaye toh
- "Database error saving new user": signup ke profile trigger me dikkat; Part 1 SQL (`handle_new_user`) check karo, error text bhejo.
- Link "expired/invalid": email scanners kabhi link pehle khol dete hain. Login try karo, "Resend" se naya link lo.
- Link galat site par jaye: Site URL / Redirect URLs / `NEXT_PUBLIC_SITE_URL` check karo.
- Email aata hi nahi: built-in sender ki limit; apna email use karo ya Custom SMTP lagao.
- Build error aaye toh error text bhejo (yahan `tsc`/build nahi chala, sirf syntax check hua).
