# PHASE 6 — DAY 2 — PART 1: Pending Decisions (decide later)

Status: **PENDING** (owner decision). Nothing below is applied. Related report: `PHASE6-DAY2-PART1-MATCHING-GEO-REPORT.md`. CI #125 was green on 2026-11-12.

## 1. Reserved-budget SQL fix (load_ad_candidates)

| Item | Detail |
|---|---|
| Decision needed | Yes / No |
| Problem | `load_ad_candidates` counts only settled spend, not live reservations. If 3 or more fully reserved campaigns rank first, all 3 record attempts are rejected and the request ends in no-fill, though another campaign has budget. |
| Impact | Low. Budget is never overspent; only a fill is lost. |
| Proposed fix | One new SQL file that re-creates only `load_ad_candidates` and also excludes campaigns whose settled spend plus live holds already reach `total_budget` (and `daily_budget` for today). `record_ad_serve` and all budget guards stay unchanged. |
| How to apply | TEST DB first, manually. Never Production without separate approval. |
| Current owner decision | Not now. Revisit after Day 2. |
| Test evidence | `tests/ads/phase6-day2-part1-matching-geo.test.ts`, section C. The "REPRODUCED" test documents today's behaviour and must be updated when the fix is applied. |

## 2. All-regions rule confirmation

| Item | Detail |
|---|---|
| Decision needed | Rule is correct / change it |
| Prompt wording | Only all-regions campaigns may qualify when country verification is unavailable. |
| Actual code | No "all-regions" campaign type exists. Empty targeting means Rest of World only. With `REGIONAL_ELIGIBILITY_ENFORCED=1` and an unverified, missing or invalid country, every campaign gets no-fill. With the flag off there is no regional filter (old behaviour). |
| Risk of current rule | None for safety (stricter than the prompt). Possible lost fills for unverified publishers. |
| If owner wants the prompt rule | Needs a new explicit all-regions selection (new DB column or value, targeting UI, tests). Do not use an empty list for it. |
| Current owner decision | Pending. No code changed. |
