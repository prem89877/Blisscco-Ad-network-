# Day 12 | Prompt 5 | Part 4 : Provider adapter boundary (click)

**SQL: koi nahi, koi database/Supabase (denim ya asli) chhua nahi. Revive install/connect nahi, koi credential/env var nahi, ad-serving provider nahi badla.**
Match API response, serve/billing code, `click-db.ts`, click route, `service.ts` (production wiring): kuch nahi badla.

## Kya bana
`lib/ads/provider-adapter.ts` (pure: koi import/env/network/DB/log nahi):
- `AdProviderAdapter` interface: `name` + optional `onClickRecorded(event)`. Future provider ise implement karega.
- `AdProviderClickEvent`: sirf `serveRef, publisherId, creativeId, occurredAtMs` (Blisscco ke internal ids). Destination URL, signed ref, IP, user-agent, secret: nahi.
- `noopAdProviderAdapter` (default) aur `deliverClickToAdapter` (kabhi throw nahi karta; timeout 1000 ms; frozen copy; return value kabhi nahi padhta).

`lib/ads/click.ts`: `ClickDeps` me 3 optional fields (`adapter`, `adapterTimeoutMs`, `onAdapterOutcome`). Adapter tabhi sunta hai jab `record_ad_click` ne **"recorded"** diya (pehla click), DB write ke BAAD.

## Boundary ke niyam
1. Blisscco ka click (DB) source of truth; adapter sirf copy sunta hai.
2. Destination hamesha DB ke creative row se (`safeDestination` se jaanchi hui). Adapter kuch return kare, ignore.
3. Adapter fail / throw / hang => redirect aur click par koi asar nahi (hang par 1000 ms ke baad aage).
4. duplicate / not_counted / ineligible / invalid ref / config missing => adapter ko kuch nahi.
5. Abhi production me adapter attach NAHI hai (`service.ts` ne chhua nahi) => behaviour Part 3 jaisa hi.

## Tests
Naya: `tests/ads/day12-prompt5-part4-adapter.test.ts` (17 tests): adapter helper, acceptClick + adapter, HTTP route + adapter, static boundary.
Purane 2 tests (`day12-part1-architecture`, `day12-part2-event-db`) me `serve_ref` wali allowlist me sirf `lib/ads/provider-adapter.ts` joda (event me internal serve ref jaata hai). Koi assertion kamzor nahi kiya.
Naam jaan-boojh kar neutral ("provider") rakha, kyunki purane tests source me revive/adserver/openx naam mana karte hain.

## Baaki / manual
- Koi real provider implementation nahi; jab banega tab alag approval, alag file, aur service.ts me explicit attach.
- Adapter ka naya env var/credential abhi zaroori nahi.
- Click ref abhi publisher ko diya nahi jaata (Part 3 ka blocker waisa hi).
