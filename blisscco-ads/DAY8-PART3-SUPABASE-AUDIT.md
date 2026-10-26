# Day 8 / Part 3: Supabase audit (static review)

**Ye kya hai:** `supabase/sql/` ki 28 files, Supabase client ka code aur tests padhkar likha gaya audit.
**Kya NAHI hai:** asli database par koi verification. Sandbox me Postgres/Supabase nahi tha, isliye maine **koi SQL execute nahi ki** aur koi SQL result nahi dekha.
Aapne bataya ki aapne day-7 ki SQL aur tests khud chala liye hain. Unke output maine nahi dekhe, isliye wo **user-reported** hain, mere verified nahi.
Label: **STATIC** = SQL text padha. **NOT RUN** = chala nahi. Koi SQL file ya database data badla nahi gaya.

## 1. Pehle: kaun si files hain

| File | Maujood? |
|---|---|
| `day-7-1-budget-keys-retention.sql` | Haan (399 lines) |
| `day-7-2-verify.sql` | Haan (54 lines, sirf SELECT) |
| `day-7-3-authz-gap-tests.sql` | Haan (228 lines) |
| `day-7-5-rate-limit-cleanup.sql` | Haan (99 lines) |
| `day-7-4-*.sql` | **Nahi hai.** Numbering me gap hai. Sirf confirm kar lo ki Part 4 me koi SQL tha hi nahi. |

## 2. Migration inventory (28 files)

**A. Migrations (database badalti hain), 17 files**

| # | File | Kya karti hai | Destructive? |
|---|---|---|---|
| 1 | `day-3-1-profile` | `profiles`, triggers, `handle_new_user` (auth.users par trigger) | Nahi |
| 2 | `day-3-2-advertiser-publisher` | `advertisers`, `publishers` + FK to profiles | Nahi |
| 3 | `day-3-3-campaign` | `campaigns` + indexes | Nahi |
| 4 | `day-3-4-ad-creative` | `ad_creatives` | Nahi |
| 5 | `day-3-5-security` | `private` schema, helper functions, guard triggers, 4 admin RPC, grants, RLS policies | **Grants reset karti hai** (`revoke all` phir naye grant) |
| 6 | `day-3-7-health-check` | `public.health_ping()` | Nahi |
| 7 | `day-4-1-campaign-guards` | `handle_new_user` badalti hai, advertisers backfill, `guard_campaign_changes` badalti hai | Insert hota hai (backfill), delete nahi |
| 8 | `day-4-3-campaign-description` | `campaigns.description`, grants, `guard_campaign_changes` dobara badalti hai | Nahi |
| 9 | `day-5-1-categories` | `ad_categories` + FK (`not valid`, phir validate) | Validate fail ho sakta hai agar purani campaign category list me nahi |
| 10 | `day-5-2-publisher-keys` | `publisher_api_keys` + 2 purane `private` functions | Nahi |
| 11 | `day-5-3-delivery-tables` | 5 tables (settings, serve log, 2 daily counters, rate limits) | Nahi |
| 12 | `day-5-4-match-function` | `match_contextual_ad` (purana, ab app use nahi karti) | Nahi |
| 13 | `day-5-6-load-candidates` | `load_ad_candidates` (read-only) | Nahi |
| 14 | `day-5-8-serve-functions` | `authorize_publisher_key`, `record_ad_serve` (purana version) | Nahi, par **7-1 ise override karti hai** |
| 15 | `day-5-11-creative-url-hardening` | URL check constraint (`not valid` + validate) | Validate fail ho sakta hai |
| 16 | `day-7-1-budget-keys-retention` | Key columns (label, expiry, hint), budget wali `record_ad_serve`, key self-service, spend function, purge function, pg_cron job | `private.purge_old_ad_logs` **purane logs delete karti hai** (>=30 din, default 90) |
| 17 | `day-7-5-rate-limit-cleanup` | `authorize_publisher_key` ka chhota optimization | Nahi |

**B. Test / verify / cleanup scripts, 11 files**
`day-3-6`, `day-4-2`, `day-4-4`, `day-4-5`, `day-5-5`, `day-5-7`, `day-5-9`, `day-6-1`, `day-7-3` ke zyadatar blocks `begin ... rollback` me hain. `day-7-2` sirf SELECT hai. `day-5-10-test-data-cleanup` **delete chalati hai** (naam se "TEST ..." advertisers/publishers par). Neeche S2 dekho.

## 3. Schema (STATIC)

**12 tables, sab par RLS enable** (SQL me 12 `enable row level security`): `profiles`, `advertisers`, `publishers`, `campaigns`, `ad_creatives`, `ad_categories`, `publisher_api_keys`, `ad_platform_settings`, `ad_serve_log`, `creative_serve_daily`, `campaign_spend_daily`, `api_rate_limits`.

**Foreign keys:**
- `profiles.id` → `auth.users` (cascade).
- `advertisers` / `publishers` (profile_id, profile_role) → `profiles (id, role)` (restrict). Isse ek publisher ke naam par advertiser row ban hi nahi sakti.
- `campaigns.advertiser_id` → `advertisers` (restrict), `campaigns.category` / `publishers.category` → `ad_categories.slug` (restrict).
- `ad_creatives.campaign_id` → `campaigns` (restrict), `reviewed_by` → `profiles` (set null).
- `publisher_api_keys.publisher_id` → `publishers` (restrict).
- `ad_serve_log`, `creative_serve_daily`, `campaign_spend_daily` → publishers/creatives/campaigns (restrict).
- `api_rate_limits.key_id` → `publisher_api_keys` (cascade).

**Mukhya constraints:** budget `> 0`, daily `<= total`, end_date `>= start_date`, status ke CHECK har table par, URL sirf `https://` aur `@` (userinfo) nahi, key hash `^[0-9a-f]{64}$` unique, `(status='revoked') = (revoked_at is not null)`, platform settings single row, CPM `(0, 1000]`.
**Indexes:** har table par kaam ke indexes hain (campaigns active-match partial index, serve log 4 indexes, keys par publisher+status). Gap dekhne ke liye verify SQL ka block D5 chalao.

**Functions (public):** `authorize_publisher_key`, `record_ad_serve`, `load_ad_candidates`, `issue/list/revoke_publisher_key_for`, `get_my_campaign_spend`, `admin_set_advertiser_status`, `admin_set_publisher_status`, `admin_review_campaign`, `admin_review_creative`, `health_ping`, `handle_new_user`, `guard_profile_changes`, `set_updated_at`, `match_contextual_ad` (band).
**Functions (private):** `is_admin`, `is_active_profile`, `my_advertiser_id`, `my_active_advertiser_id`, `guard_campaign_changes`, `guard_creative_changes`, `purge_old_ad_logs`, `issue_publisher_key`, `revoke_publisher_key` (purane 2 band).

## 4. RLS aur data isolation (STATIC)

- **Advertiser A bnam B:** `campaigns` ki policies `private.my_advertiser_id()` se bandhi hain, aur `ad_creatives` ki policies campaign ke owner se. B ko A ka campaign/creative dikhna ya badalna policy se roka jaata hai.
- **Role se role:** publisher ko campaigns/creatives par koi policy match nahi hoti. Advertiser ko `publishers` / keys par koi haq nahi.
- **Role / status khud badalna:** `profiles` me sirf `display_name` update ka grant hai, aur trigger `guard_profile_changes` role/status badalne se rokta hai. `handle_new_user` signup metadata se sirf `advertiser`/`publisher` leta hai, `admin` kabhi nahi.
- **Admin:** sirf SELECT policies, aur likhna sirf 4 `SECURITY DEFINER` functions se, jo `private.is_admin()` dobara check karte hain.
- **Delivery tables aur keys:** anon/authenticated/service_role teeno se `revoke all`. Sirf `SECURITY DEFINER` functions chhoote hain, jinka execute sirf `service_role` ko hai.
- **Spend dekhna:** `get_my_campaign_spend` sirf owner ya admin ke liye row deta hai. Dusre ke campaign par **0 rows** aati hain (comment me "sab 0" likha hai). Ye app me kaise handle hota hai, ye verify nahi hua.

Ye sab **sirf SQL padhkar** hai. RLS asli me chal raha hai, ye `day-7-3` ke blocks aur verify SQL se **aapko** confirm karna hai.

## 5. Budget, keys aur rate limit (STATIC)

- **Budget:** `record_ad_serve` (day-7-1) campaign row par `for update` lock leta hai, total aur daily budget check karta hai, phir `campaign_spend_daily`, `ad_serve_log`, `creative_serve_daily` me likhta hai. Kharch **serve par** lagta hai, impression par nahi.
- **Keys:** sirf SHA-256 hash store hota hai, 5 active keys ki limit (publisher row par lock), expiry optional, `authorize_publisher_key` aur `record_ad_serve` dono expired/revoked key ko rokte hain. Keys seedha table se nahi, sirf service-role functions se.
- **Rate limit:** per-key per-minute counter (atomic upsert `api_rate_limits`), limit `ad_platform_settings.rate_limit_per_minute` (default 60). Purani rows ki safai ab sirf naya minute shuru hone par (7-5) aur roz raat purge job se.
- **Purge:** `private.purge_old_ad_logs` `ad_serve_log` aur `creative_serve_daily` ko 90 din (minimum 30) baad delete karti hai. `campaign_spend_daily` ko **nahi chhuti**, to total budget sahi rehta hai.

## 6. Security findings

**High**

- **S1. "Dobara chalane par safe hai" har file ke liye sach nahi.** Kuch files purani SQL se naye function ko overwrite kar deti hain:
  - `day-3-5-security.sql` dobara chalne par `guard_campaign_changes` purane version par chali jaati hai (50 campaign limit, resume check, description lock gayab) aur `revoke all ... campaigns` ke baad `description` ke grants wapas nahi aate.
  - `day-4-1` ko `day-4-3` ke baad chalane par description lock hat jaata hai.
  - `day-5-8` ko `day-7-1` ke baad chalane par `record_ad_serve` bina budget check ke aur `authorize_publisher_key` bina expiry check ke ho jaate hain.
  - Evidence: `day-3-5-security.sql` (guard + grants block), `day-4-1`, `day-4-3`, `day-5-8` vs `day-7-1`. Verify SQL ka block C3 aisi regression pakad leta hai.

**Medium**

- **S2. Asli-jaise email addresses SQL test files me hard-coded hain** (5 alag addresses, 100+ baar, `day-3-6`, `4-2`, `4-4`, `4-5`, `6-1`, `7-3` aadi). `day-7-3` ka SETUP block (rollback ke bahar) un emails ke advertiser rows ka `company_name` aur `status` badalta hai. Agar kisi asli account par chal gaya to naam badal jayega. Repo public ho to emails bahar jaate hain. Fix: placeholders, aur har destructive block ke upar "TEST PROJECT ONLY" guard (approval chahiye).
- **S3. User delete nahi ho sakta.** `advertisers` / `publishers` → `profiles` aur sab delivery tables `on delete restrict` hain, to Dashboard se auth user delete karne par error aayega jab uski advertiser/publisher row ho. Account-deletion ka koi raasta nahi hai. Privacy ke liye baad me plan chahiye.
- **S4. Active/paused campaign ka budget, dates, name, description dobara review ke bina badal sakta hai.** Lock sirf `pending_review`/`completed`/`archived` par hai (`day-4-3`, guard). Category locked hai. Ye Part 1 ka point #10 hai, aapka faisla chahiye.
- **S5. Advertiser approval admin ke bina hi `active` ho jaata hai.** `day-4-1` ka `handle_new_user` signup par advertiser row seedha `'active'` banata hai (file me likha hai "aapka faisla"). `DAY7-FIXES.md` me likha hai "admin approve". App me "Set up your business" form (`app/dashboard/advertiser/campaigns/page.tsx`) sirf tab dikhta hai jab advertiser row hi na ho, to ab wo sirf fallback hai. Ads phir bhi admin ke creative aur campaign approval ke bina live nahi jaate. Confirm karo ki ye jaan-boojh kar hai.
- **S6. Impressions/clicks ki table hi nahi hai.** Charge serve par hai (Part 1 / 2 ka point).
- **S7. Throughput ka unverified risk.** `record_ad_serve` har campaign par row lock leta hai, aur har request par `api_rate_limits` ki ek row upsert hoti hai. Zyada traffic par ye line me khade ho sakte hain. Load par test nahi hua.

**Low**

- **S8.** `day-7-2-verify.sql` ke check 5 me comment "6 tables" kehta hai par 11 list hain, aur `ad_categories` chhooti hui hai. Policies, triggers aur `private` schema ka koi check nahi. Check 6 (`cron.job`) pg_cron na hone par error dega. Naya verify file `day-8-1-readonly-verify.sql` ye gap bharti hai.
- **S9.** Purane comments galat hain: `day-5-3` ("abhi koi spend nahi likhta"), `day-5-6`, `day-5-8` ("budget check nahi hai"). Ye 7-1 se pehle ki baatein hain.
- **S10.** Dead/legacy: `lib/ads/match.ts` (sirf `tests/ads/request-and-route.test.ts` use karta hai) `match_contextual_ad` ko rpc se bulata hai, jiska execute 7-1 ne hata diya. `private.issue_publisher_key` / `revoke_publisher_key` bhi band hain. Safe hai, par confusing.
- **S11.** Purge `creative_serve_daily` 90 din baad delete karti hai, aur `get_my_campaign_spend` ka `serves_total` isi table se aata hai. Lifetime serves purane campaigns ke liye ghat jayenge. Spend sahi rahega.
- **S12.** `authorize_publisher_key` `unit_cost = cpm/1000` (unrounded) deta hai, jabki `record_ad_serve` 4 decimal round karta hai. Default CPM par farak nahi, par CPM jaise `2.0001` par thoda mismatch.
- **S13.** 50-campaign limit `count` phir `insert` hai (race-safe nahi). Do ek saath requests se thoda upar ja sakta hai.
- **S14.** `health_ping()` anon ko execute deta hai (sirf `true` lautata hai, jaan-boojh kar). Spam ho sakta hai, koi data nahi.

## 7. Sahi migration order (fresh test database)

`3-1 → 3-2 → 3-3 → 3-4 → 3-5 → 3-7 → 4-1 → 4-3 → 5-1 → 5-2 → 5-3 → 5-4 (optional) → 5-6 → 5-8 → 5-11 → 7-1 → 7-5`

Tests inke baad: `3-6` (3-5 ke baad), `4-2/4-4/4-5` (4-3 ke baad), `5-5` (5-4 ke baad), `5-7` (5-6 ke baad), `5-9` (5-8 ke baad), `6-1`, `7-3` (7-1 ke baad).

**Dhyan:**
- `5-9` aur `6-1` 7-1 se pehle ke functions ke hisaab se likhe gaye the. 7-1 ke baad kuch expected result alag aa sakta hai, wo kharab nahi hota, par dekh lo.
- **Kabhi dobara mat chalao (S1):** `3-5`, `4-1`, `5-8` jab baad ki files chal chuki hon.
- `5-4` app ke liye zaroori nahi, sirf `5-5` test aur 7-1 ka `to_regprocedure` check isse jude hain.

## 8. Safe test-database verification procedure

1. **Naya alag Supabase TEST project** banao (production nahi, production ke credentials kahin mat daalo). Backup/PITR production par alag se on rakho.
2. Upar ke order me migrations chalao, **har file ke baad error dekho**, aur agli file se pehle ruko.
3. `supabase/sql/day-8-1-readonly-verify.sql` ke blocks ek-ek karke chalao. Har block ke upar "Expect" likha hai. **Result ka screenshot bhejo** (isme koi password ya key nahi aati).
4. Isolation test: `day-7-3` ke blocks, **pehle emails apne test users ke se badlo** (S2). Har block alag chalao. Blocks `begin ... rollback` me hain.
5. Budget aur rate-limit: `day-5-9` aur `day-6-1` ke blocks (7-1 ke baad result dhyan se padho), phir `day-7-3` ke blocks.
6. Test data hatana ho to `day-5-10` ka BLOCK 1 (sirf dekhta hai) pehle chalao, aur counts sahi lagen tabhi BLOCK 3. Test users ko Dashboard > Authentication se hatao.
7. App ko test project se jodo (Vercel Preview par alag env), ek poora flow chalao (signup → admin approve → campaign + ad → key → `POST /api/v1/ads/match`).

Ye procedure me kisi bhi step ko main **PASS** tab nahi likhunga jab tak aap uska result na dikhayein.

## 9. Supabase Dashboard me haath se confirm karo

- **Settings > API > Exposed schemas:** sirf `public`. `private` **exposed nahi** hona chahiye.
- **Authentication > Providers/URL Configuration:** Email confirmation on, Site URL aur Redirect URLs sahi, Google provider ke redirect URLs.
- **Database > Extensions:** `pg_cron` on hai? (verify block F1/F2).
- **Database > Backups:** Production par backup/PITR on hai.
- **Advisors (Security + Performance):** run karo aur "RLS disabled" / "function search_path" / "unindexed foreign key" wali warnings dekho.
- **Database > Roles / API keys:** `SUPABASE_SECRET_KEY` sirf Vercel me hai; publishable key browser me; legacy `service_role` JWT kahin `NEXT_PUBLIC_` me nahi.
- **Table Editor > `profiles`:** kitne `admin` hain (verify block E2 me gina jaayega).
- **Database > Triggers:** `on_auth_user_created` `auth.users` par hai (verify block D1).
- **Naye tables ke default grants:** future me banne wali tables par Supabase default grants anon/authenticated ko de sakta hai. Har nayi table ke baad `revoke` aur RLS zaroor.

## 10. Jo main approval ke baad kar sakta hoon (abhi kuch nahi badla)

1. SQL test files me emails placeholders se badalna aur har SETUP/cleanup ke upar "TEST PROJECT ONLY" guard.
2. Un files ke header me "DOBARA MAT CHALAO" warning (`3-5`, `4-1`, `5-8`) aur purane galat comments theek karna.
3. `day-7-2-verify.sql` ki chhoti kamiyan (comment "6 tables", `ad_categories`).
4. Purane band functions ko baad me drop karne ki alag migration (pehle test par).
5. Active campaign ke edit lock par aapka faisla (S4).
