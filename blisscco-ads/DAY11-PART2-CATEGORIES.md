# Day 11 | Part 2 : Category matching ka consistency review

Status: audit + tests + ek policy comment. **Production code ka behaviour nahi badla. Koi SQL/migration nahi, Supabase par kuch nahi chalaya.**

## Kya mila (confirmed)

Category ka ek hi source of truth hai: `lib/campaigns/constants.ts` (CATEGORY_OPTIONS) = SQL `ad_categories` (day-5-1). Teeno jagah wahi slug chalte hain:
- Advertiser campaign: form sirf wahi slug leta hai; DB me FK + slug CHECK.
- Creative: apni category nahi hoti, campaign ki category hi lagti hai (isliye creative aur campaign alag ho hi nahi sakte).
- Publisher request: slug -> `resolveCategory` -> loader (`c.category = p_category`) -> `record_ad_serve` (dobara exact). Substring/ILIKE kahin nahi.

Eligibility (approved creative, active campaign/advertiser/profile, schedule, Day 9 budget) pehle jaisi 3 jagah lagti hai.

## Normalization kahan hoti hai (jaan-boojh kar do layer)

- **Public API** (`validation.ts`): sirf `^[a-z0-9_]{1,50}$`. `"Gaming"`, `"video games"`, `"gaming\n"` => 400 `invalid_topic`. Ye Day 6/10 ka tested contract hai, isliye nahi badla.
- **Matcher** (`resolveCategory`): casing, spaces, hyphen, extra/stray underscore, fullwidth letters, alias sab saaf karta hai.
  API se jo slug-shape guzre (jaise `video__games`, `_gaming`, `gaming_`, `games`) wo canonical `gaming` ban kar loader aur record tak jaate hain.

Agar aap chahte ho ki API bhi `"Gaming"` / `"video games"` accept kare, toh ye ek chhota change hai (`validation.ts` me `normalizeCategoryToken` lagana) par 6-7 purane contract tests aur publisher guide badlenge. Aapke "haan" par karunga.

## Aliases / parent-child / substring ki policy (ab likhi aur test ki)

- Alias: exact many-to-one (`tech` -> technology, `games` -> gaming ...).
- Parent-child: NAHI. technology aur developer_tools alag.
- Substring/prefix: NAHI. `game`, `gaming_pro`, `gamings`, `my_gaming_app` => unsupported => no-fill.
- Policy `lib/ads/taxonomy.ts` ke upar comment me likhi hai.

## Tests (naya: `tests/ads/day11-part2-categories.test.ts`, 22 tests)

- Har slug ko campaign form, publisher setup, list filter, API body aur matcher: sab ek hi slug maante hain; label ("Developer tools") bhi usi slug par aata hai.
- `beauty` (legacy): naye campaign/publisher ke liye band, match nahi hota, par purana campaign edit ho sakta hai. Sensitive terms har jagah refuse.
- Har alias apne hi slug par jaata hai (upper/space/hyphen roop me bhi).
- Slug/alias ka koi substring ya "slug + kuch aur" match nahi hota. (Check kiya: matching ko jaan-boojh kar fuzzy karke dekha, test fail hua.)
- Demo dashboard (`lib/types.ts`, `lib/demo-data.ts`) ki saari categories asli taxonomy me aati hain (doosri taxonomy nahi).
- End to end: untidy par API-valid topics canonical `gaming` par load/record; unknown/legacy/sensitive/wordy topics => no-fill (load/record nahi); sirf eligible campaign serve hota hai (paused, unapproved, future/ended, suspended advertiser, total/daily budget khatam, galat-category rows sab bahar).

## Baaki limitations

- Demo UI ki alag display-name list (`lib/types.ts` CAMPAIGN_CATEGORIES, `components/Sections.tsx`) abhi bhi alag likhi hai; ab test unhe asli taxonomy se bandhta hai, par UI ko code-generate nahi kiya.
- `publishers.category` DB me hai par matching me use nahi hota (publisher ki koi allow/block list nahi bani; invent nahi ki).
- Purana `match.ts` + `match_contextual_ad` production flow me nahi hai; hataya nahi.
