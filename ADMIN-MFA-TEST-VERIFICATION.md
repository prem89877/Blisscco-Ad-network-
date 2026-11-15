# Admin TOTP MFA: TEST project verification (Production deploy se pehle)

Production par kuch deploy nahi hua. Pehle TEST Supabase project + Preview par ye sab pass karo.

Pre-check: TEST project me Dashboard > Authentication > Providers > Phone/MFA: **TOTP enrolment enabled** (aur verify enabled).

1. `npm test` (naya `tests/auth/admin-mfa.test.ts` + purane sab pass).
2. Admin login (Preview/TEST) > Admin page > "Security: two-factor authentication".
3. Status "Disabled" > Enable > QR dikhe + manual key dikhe.
4. Galat code => error, setup screen bana rahe. Sahi code => Status "Enabled".
5. Logout/login dobara: admin login pehle jaisa chale (AAL2 force nahi hota).
6. Advertiser / publisher login: `/dashboard/admin/security` => `/dashboard` par redirect.
7. Logged-out: `/dashboard/admin/security` => `/login`.
8. Cancel dabao => adhura factor hat jaye; "Enable" dobara chale.
9. Admin ke saare purane kaam (review, emergency stop) normal.

Rollback: sirf is branch ke files hatao. Database/migration/RLS me koi badlav nahi.

Notes:
- Recovery codes NAHI: Supabase Auth MFA abhi support nahi karta.
- Login par MFA challenge (AAL2) abhi force nahi: lock-out se bachne ke liye. Alag step me.
- Disable/unenroll abhi nahi (verified factor hatane se pehle AAL2 flow chahiye).
