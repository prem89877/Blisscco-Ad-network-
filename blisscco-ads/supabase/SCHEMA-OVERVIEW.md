# Blisscco: database schema overview (core entities)

Ye file sirf EXPLAIN karti hai. Maine koi SQL nahi chalaya aur koi SQL file nahi badli.

## 0. Pehle ye jaano

Jo schema tum maang rahe ho (profiles, advertisers, publishers, campaigns, ad_creatives) project me **pehle se bana hua hai** (Day 3, Day 4) aur tum use Supabase me chala chuke ho. Isliye maine naya "initial migration" nahi likha: wo purani files se takrata, aur `create table if not exists` purane tables ko badalta nahi. Neeche purani files ko tumhari har requirement se milaya hai.

Security policies (RLS, grants, guard triggers) bhi pehle se `day-3-5-security.sql` me hain aur chali hui hain. Is step me unhe chhua nahi gaya.

## 1. Migration ka order (jo files pehle se hain)

| # | File | Kya banata hai |
|---|---|---|
| 1 | `day-3-1-profile.sql` | `set_updated_at()`, `profiles`, role/status guard trigger, signup trigger |
| 2 | `day-3-2-advertiser-publisher.sql` | `advertisers`, `publishers` |
| 3 | `day-3-3-campaign.sql` | `campaigns` |
| 4 | `day-3-4-ad-creative.sql` | `ad_creatives` |
| 5 | `day-3-5-security.sql` | RLS, column-level grants, guard triggers, admin functions |
| 6 | `day-4-1-campaign-guards.sql` | advertiser signup par auto-active, campaign guards |
| 7 | `day-4-3-campaign-description.sql` | `campaigns.description` |
| 8 | `day-5-1` se `day-5-4` | `ad_categories` (FK), publisher API keys, delivery tables, match function |

Test files (`day-3-6`, `day-4-2`, `day-4-4`, `day-4-5`, `day-5-5`) schema nahi badalte, sirf jaanchte hain.

## 2. Tables, maqsad aur relationships

    auth.users (Supabase)
        | 1:1  (ON DELETE CASCADE)
    profiles (id = auth.users.id, role, status)
        | 1:0..1  (composite FK (id, role), RESTRICT)
        +--> advertisers --1:N--> campaigns --1:N--> ad_creatives
        +--> publishers   (campaigns.category, publishers.category --> ad_categories.slug)

- **profiles**: har login user ki ek row: role (`advertiser | publisher | admin`) aur status (`active | suspended`). Email yahan copy nahi hoti (auth.users me hai). Sirf `display_name` aur role/status hain.
- **advertisers**: advertiser ka business account (company_name, https website_url, status `pending | active | suspended`). Ek profile = ek advertiser (`UNIQUE(profile_id)`). Composite FK `(profile_id, profile_role) -> profiles(id, role)` se sirf `role='advertiser'` wala profile hi advertiser ban sakta hai.
- **publishers**: AI chatbot publisher ka account (name, https website_url, optional category, status). Same pattern, `role='publisher'`. Chatbot prompts/conversations ke liye koi column hi nahi hai.
- **campaigns**: advertiser ke campaigns: name, optional description, category, status (`draft | pending_review | active | paused | completed | rejected | archived`), budget, schedule (start_date, end_date). `advertiser_id -> advertisers`.
- **ad_creatives**: campaign se jude ad text (headline, body, cta_text), https destination_url, review status (`draft | pending_review | approved | rejected | paused | archived`), rejection_reason, reviewed_by/at. `campaign_id -> campaigns`.

Day 5 ke extra tables (core 5 ke upar): `ad_categories` (controlled taxonomy), `publisher_api_keys` (sirf hash), `ad_platform_settings`, `ad_serve_log`, `creative_serve_daily`, `campaign_spend_daily`, `api_rate_limits`.

## 3. Requirement checklist (purani files se)

| Requirement | Kahan / kaise |
|---|---|
| UUID primary keys | Sab tables: `uuid primary key default gen_random_uuid()`; `profiles.id = auth.users.id` |
| created_at / updated_at | Core 5 tables me dono, `set_updated_at()` trigger se |
| Foreign keys, constraints, indexes | FKs upar ke diagram me; CHECKs (length, https URL, slug format, dates, budget); indexes: `advertisers_status_idx`, `publishers_status_idx`, `campaigns_advertiser_status_idx`, `campaigns_active_match_idx` (partial, status='active'), `ad_creatives_campaign_status_idx`, `ad_creatives_reviewed_by_idx` |
| Paise ke liye numeric + currency | `total_budget`, `daily_budget` = `numeric(12,2)` (float kabhi nahi). **Assumption: poore platform ke liye sirf USD** (`currency_code` column hai, CHECK sirf `'USD'`). Kharch `numeric(12,4)`, CPM `numeric(8,4)` |
| Constrained status/role | `text` + `CHECK (... in (...))` (enum se badalna aasan) |
| Important records accidentally delete na hon | Neeche delete table |
| Raw chatbot prompts / extra personal info nahi | Koi prompt/conversation column nahi; email profiles me nahi; serve log me sirf publisher, creative, campaign, topic, time (IP/user id nahi) |
| Card details nahi | Koi card/bank column nahi; payment provider ka reference baad me |
| Koi khud ko privileged role na de sake | `guard_profile_changes()` (API se role/status/id badalna ya admin insert = reject); `handle_new_user()` sirf `advertiser`/`publisher` maanta hai, baaki sab `advertiser`; column-level grants me role/status/review columns nahi; approvals sirf admin functions se |

## 4. Delete behavior

| Relationship | Behavior | Matlab |
|---|---|---|
| auth.users -> profiles | CASCADE | User hatne par profile jati hai, **par** neeche ki RESTRICT chain business records wale user ko hatne se rok deti hai |
| profiles -> advertisers / publishers | RESTRICT | Business account wala profile delete nahi hota; `status='suspended'` use karo |
| advertisers -> campaigns | RESTRICT | Campaign wale advertiser ko delete nahi kar sakte |
| campaigns -> ad_creatives | RESTRICT | Creatives wala campaign delete nahi hota; `status='archived'` use karo |
| ad_creatives.reviewed_by -> profiles | SET NULL | Reviewer hatne par creative nahi udta |
| campaigns/publishers.category -> ad_categories | RESTRICT | Use ho rahi category hat nahi sakti |

App ke users ko kisi table par DELETE ka grant hi nahi hai (archive status use hota hai).

## 5. Choti baatein jo sach-sach batani hain

- `day-3-2` ka comment kehta hai naya advertiser `pending` se shuru hota hai; `day-4-1` ke baad signup par advertiser row **auto-active** banti hai (tumhara Day 4 faisla). Dono files ek saath padho toh ye hi sahi hai.
- `publishers.category` ka comment ab bhi "beauty" example deta hai; `beauty` ab legacy/inactive hai (day-5-1). Sirf comment purana hai, behavior sahi hai.
- Ye dono baatein sirf comments ki hain; koi SQL badalne ki zaroorat nahi.

## 6. Status (verified vs nahi)

- Maine koi SQL **nahi chalaya**.
- **Tested (tumhari report):** tumne Supabase me ye SQL tests chalaye, sab successfully: `day-3-6-security-test.sql`, `day-4-2-campaign-tests.sql`, `day-4-4-edit-tests.sql`, `day-4-5-runstate-tests.sql`, `day-5-5-matching-tests.sql` (M1 se M27).
- Pending: `day-3-7-health-check.sql` aur app/browser/mobile tests ka result mujhe nahi pata.

## 7. Approval

Security policies ka agla kaam tumhari approval par. Batao: (a) mojooda day-3-5 policies ka review/audit, (b) kuch naya jodna, ya (c) ruk jana.
