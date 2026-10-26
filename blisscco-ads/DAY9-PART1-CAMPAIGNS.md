# Day 9 / Part 1 : Campaign management fixes

Koi SQL/migration nahi, koi production data nahi badla, koi secret nahi chhua. RLS aur authorization kamzor nahi hui.

## Kya mila aur kya theek hua

| # | Bug / kami | Fix | Kahan |
|---|---|---|---|
| 1 | Database error ko "advertiser nahi hai" maan liya jata tha: list par galat "Set up your business" form, detail/edit par "not found", new par "log out karo" | `loadMyAdvertiser()` ab `failed` alag deta hai. Pages error boundary (Try again) dikhate hain, actions "Something went wrong" | `lib/campaigns/queries.ts`, `lib/campaigns/advertiser.ts` (new), 4 pages, 2 action files |
| 2 | Row mili par shape galat ho to "campaign not found" dikhta tha | Ab "load fail" (error boundary) | `loadMyCampaign` |
| 3 | Campaign ka naam: control characters (NUL, bell...) chalte the, kai spaces/newline waise hi save | Whitespace ek space me, control characters reject | `lib/campaigns/validation.ts` |
| 4 | Schedule: start date saal 9999 tak, campaign ki lambai ki koi seema nahi | Start <= aaj+365 din, campaign <= 730 din. Jo date badli nahi, us par naya niyam nahi (purana campaign atakta nahi) | `validation.ts`, `constants.ts` |
| 5 | Bahut chhota budget (jaise $0.001 daily) kabhi serve nahi hota par "Active" dikhta tha | Min total $1.00, min daily $0.50 (sirf jab value badli ho). Badalna ho to `constants.ts` me 2 numbers | `constants.ts`, `validation.ts`, `CampaignForm.tsx` hints |
| 6 | Active/paused campaign ka total budget ab tak ke kharch se neeche kiya ja sakta tha | Edit par kharch padhkar rokta hai. Active/paused me kharch na padh paye to edit rukta hai (fail-closed) | `actions.ts`, `lib/campaigns/budget.ts` (new) |
| 7 | Detail page 3 queries ek ke baad ek chalata tha | `Promise.all` (page tezi se khulta hai) | `[id]/page.tsx` |
| 8 | Purani URL `?created=1` reload par "Campaign created" dikhta rehta tha | Sirf jab campaign abhi bhi draft ho | `[id]/page.tsx` |
| 9 | Advertiser ko pata nahi chalta kitna budget bacha | "Budget left" row, edit form me "Already spent" hint | `[id]/page.tsx`, `edit/page.tsx`, `CampaignForm.tsx` |

## Jo pehle se theek tha (check kiya, badla nahi)
Har query me `advertiser_id` filter, ownership RLS ke upar bhi, optimistic lock (`expectedUpdatedAt`), status guard, creative URL check (https, userinfo/IP/localhost reject), loading/error/not-found screens, empty states (no campaigns / no match).
"Related API routes": campaigns ke liye koi API route hai hi nahi; sab server actions hain.

## Baaki / jaan-boojh kar nahi kiya
- Kharch padhne aur save karne ke beech ek serve aa sakta hai. Poori race-safe rok ke liye DB trigger chahiye (`day-9-1` migration, **alag approval**). Abhi app-level check hai.
- Charge ab bhi "serve" par hai (impression/click tracking alag approval).
- Campaign status `completed` ab bhi kahin auto set nahi hota.

## Test
`npm test` jaisa chalaya: **1003 tests, 1003 pass, 0 fail** (pehle 972; naye 31 `tests/campaigns/day9-part1.test.ts`).
`tsc` poora, ESLint, `next build`, browser aur live Supabase **NOT RUN** (internet band, node_modules nahi). UI files ka sirf syntax check hua.
