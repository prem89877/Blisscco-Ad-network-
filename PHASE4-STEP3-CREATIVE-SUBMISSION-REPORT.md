# Phase 4 Step 3: Advertiser Creative Form and Submission Workflow

Date: 2026-11-06. Status: **CODE DONE, MOCKED TESTS PASS. TEST-database checks PENDING (manual).** Production not touched. No billing, no payout. Step 4 not started.

## 1. Files
New: `supabase/sql/phase4-step3-1-creative-submission.sql`, `app/dashboard/advertiser/creatives/{page,actions,loading,error}`, `components/campaigns/{CreativeSubmissionForm,CreativePreview,CreativeStatusBadge}.tsx`, `lib/campaigns/{creative-assets,creative-upload,creative-submission,creative-submission-queries}.ts`, `tests/campaigns/{step3-stubs,phase4-step3-assets-and-form,phase4-step3-submit-action,phase4-step3-contract}.ts`.
Modified: `app/dashboard/admin/page.tsx` (shows logo, image, brand, keywords, campaign category), `lib/dashboard-nav.ts` (+ "Ads" link), `tests/dashboard/nav-and-keys.test.ts` (advertiser nav list), `next.config.mjs` (server action body 5 MB), `tsconfig.test.json`, `supabase/MIGRATION-ORDER.md`.

## 2. Database changes (TEST only)
4 nullable columns on `ad_creatives` (brand_name, logo_path, banner_path, keywords); private bucket `creative-assets` (2 MB, png/jpeg/webp); 4 storage policies; column grants; `guard_creative_changes()` redefined (same rules + new columns count as content + path must belong to own advertiser/campaign). No new table. Old ads and the old form keep working.

## 3. Form
Page `/dashboard/advertiser/creatives`: campaign dropdown (own, open campaigns), category read-only from campaign, brand, logo, banner, headline, description, CTA (list), URL, keywords (optional, review only). Old form on campaign page unchanged.

## 4. Validation (mocked tests PASS)
Required fields, https-only URL (no userinfo, no localhost/IP), PNG/JPG/WebP only, logo 1 MB, banner 2 MB, real file bytes checked (renamed SVG/text rejected), no empty submit, clear errors, clear success/draft messages.

## 5. Approval workflow
New ad: insert as draft, then pending_review. Never approved by advertiser code. Admin review page uses the existing approve/reject function. Only approved ads are eligible (existing rule, tested). Publisher API unchanged (5 text fields); new columns do not reach it.

## 6. Security
Own session only (RLS + storage policies), no service-role key, no public URLs (signed URLs, 1 hour), ownership re-checked in action, page and SQL. Real RLS/storage behaviour is NOT proven by mocks: see section 8.

## 7. Tests
Mocked: 87 new tests pass. Full suite: 4847 pass, 1 fail. The 1 fail (`day 28 part 1 | publisher example files compile strictly`) also failed before my changes in the sandbox (no `next` types installed); expected to pass in CI.

## 8. Pending manual checks (TEST project only)
1. Run the SQL file; checks C1-C5 in its footer.
2. Real logo + banner upload; open both on advertiser page and admin page.
3. Upload rejects: GIF, SVG, over-size, renamed text file; bad URL.
4. Advertiser B cannot see/upload/open advertiser A's images or ads (page, direct storage URL).
5. New ad shows Pending; not served (`/api/v1/ads/match` no-fill).
6. Admin approve then serve; admin reject with reason shows on advertiser page; edit + resubmit works.
7. Approved ad edited later goes back to draft.

## 9. Blockers / decisions
- Images are NOT sent to publishers (API contract unchanged). If ads must show logo + image in the chatbot, that needs an API contract change and a delivery decision: needs your confirmation (not done in this step).
- Orphan image files are possible if cleanup fails (best-effort); harmless, private.
