# Phase 6 Step 1: Regional Expansion Foundation and Country Mapping

Status: **implemented, verification pending.** Step 2 is not started.

## Comparison with the existing repository

The repository was checked for existing country, region and regional CPM/CPC definitions before implementing. None exist: pricing is a single CPM from `ad_platform_settings`, and campaign targeting is category-based. **No conflicting assignments were found**, and no pricing behavior was changed. Phase 5 regional pricing values were not present in the uploaded repository, so they could not be compared or preserved beyond leaving all pricing code untouched.

## Regions (exactly eight, owner-approved initial mapping)

| Region id | Label | Countries (ISO 3166-1 alpha-2) |
|---|---|---|
| `north_america` | North America | US, CA, MX |
| `uk` | UK | GB |
| `western_europe` | Western Europe | DE, FR, NL, BE, AT, CH, IE, ES, PT, IT, LU, GR, CY |
| `australia` | Australia | AU, NZ |
| `middle_east` | Middle East | AE, SA, QA, KW, BH, OM, TR, EG, IR, SY, JO, IQ, LB, IL |
| `south_asia` | South Asia | IN, PK, BD, LK, NP, BT, MV, AF |
| `southeast_asia` | Southeast Asia | SG, MY, ID, TH, PH, VN, KH, LA, MM, BN, TL |
| `rest_of_world` | Rest of World | all remaining valid ISO codes (derived, never listed by hand) |

No sanctions or restricted-country policy was added.

## Rules

- One central module: `lib/regions/country-region.ts`. Advertiser targeting and publisher country identification must both use it.
- Supported = any officially assigned ISO code (249). Each maps to exactly one region. Rest of World is the ISO list minus the seven named regions, so there are no gaps or duplicates. The module throws at load if a duplicate or non-ISO code is listed.
- Invalid format (not two letters) returns `invalid_format`. Well-formed but not ISO (for example `XX`, `UK`) returns `unsupported_country`. Neither gets a region, so there is no silent fallback to Rest of World and no campaign eligibility.
- Input is trimmed and upper-cased.

## Not changed

Database and SQL, pricing (CPM/CPC) and bidding, advertiser billing, publisher payouts, ledger, UI, workflows, Production. The mapping is not wired into serving or matching yet, because the repository has no country field on campaigns or publishers. Wiring it in needs a decision on where each country comes from.

## Tests

`tests/regions/phase6-step1-country-region.test.ts` (14 tests): region set, ISO list integrity, no duplicate assignments, partition of all 249 codes, exact owner-approved mapping, Rest of World, normalization, invalid and unsupported codes, advertiser/publisher consistency.

## Verification pending

- Full `npm test`, type check, ESLint and build: **not run, pending**.
- CI result on GitHub: **pending**.
- Manual verification: **not completed**.
