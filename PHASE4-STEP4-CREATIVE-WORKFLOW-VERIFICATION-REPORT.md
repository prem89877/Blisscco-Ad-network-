# Phase 4 - Step 4: Advertiser Creative Workflow and Rich Ad Delivery Verification

Date: 2026-11-07. Scope: TEST / Preview only. Production untouched. No billing, no payout. Step 5 not started.
Evidence rule: "User-confirmed" = owner's word only, no screenshot or query output. It is NOT independent proof.
No code, SQL, RLS or storage policy was changed in this step. Only reports were updated (append-only).

## 1. Previously completed checks (not repeated)
From PHASE4-STEP3B-RICH-AD-DELIVERY-REPORT.md: Step 3B SQL on TEST (R1-R5); old creative returns exactly 5 fields; new rich creative returns brand_name, logo_url, image_url next to the 5 fields; logo and image URLs open in browser; wrong kind => 404; archived creative image => 404; flag OFF match response = 5 fields; square banner rejected in real form; CI green; Preview build works.

## 2. Newly checked (User-confirmed, word only)
| Task | Check | Status |
| --- | --- | --- |
| 2a | Valid logo and banner upload | User-confirmed |
| 2b | GIF, SVG, renamed text file and files over 3 MB rejected | User-confirmed. Note: limits are logo 2 MB, banner 4 MB; which field the 3 MB test used was not stated |
| 2c | Invalid destination URL | User-confirmed (clarified): http rejected, https accepted. Earlier "only http" was a typo |
| 2d | Images show on advertiser and admin dashboards | User-confirmed |
| 2 | Too-small / too-big logo, wrong-size banner (dimension rule) | Banner: already verified in Step 3B (square). Logo dimension rejection on Preview: User-confirmed on 2026-11-07 |
| 3a | Advertiser A cannot see Advertiser B creatives | User-confirmed (dashboard). Direct storage URL / image of B not explicitly stated |
| 3b | Pending, rejected, archived assets => 404 | User-confirmed |
| 3c | Only admin can approve / reject | User-confirmed |
| 3d | No private paths, secrets or service-role key reach client | User-confirmed |
| 4a | Lifecycle: draft, pending, admin approval, eligible for delivery | User-confirmed (items a-d below mapped by owner's letters, not itemised) |
| 4b | Edit and resubmit rejected creative | User-confirmed |
| 4c | Editing an approved creative returns it to a safe status | User-confirmed |
| 4d | Ineligible creatives are not served | User-confirmed |
| 5 | Flag OFF asset URL `/api/v1/ads/asset/<id>?kind=image` => 404 (was NOT VERIFIED in Step 3B) | User-confirmed (owner says done manually; no screenshot) |
| 5 | Publisher example: Sponsored label, logo, brand, banner, CTA; text-only fallback | User-confirmed |
| 5 | `npm ci && npm test` (Termux) | User-confirmed (no output pasted; counts not recorded) |

## 3. TEST database SQL status
Owner pasted real query output from the TEST project (2026-11-07):
- C1: 4 columns (banner_path, brand_name, keywords, logo_path), all is_nullable = YES. PASS.
- C2: bucket creative-assets, public = false, file_size_limit = 4194304, mime png/jpeg/webp. PASS. This also confirms phase4-step3c-1 took effect (owner reported it ran successfully).
- C3: 4 policies (delete_own, insert_own, select_admin, select_own), all roles {authenticated}. PASS.
- C4: has_assets = true, has_ownership = true (guard_creative_changes is the new version). PASS.
- C5: 0 rows (rejection_reason, reviewed_by, reviewed_at not writable by authenticated). PASS.
Re-running phase4-step3-1 failed with 23514 on ad_creatives_logo_path_check. The file runs in one transaction, so it rolled back and nothing changed. The state above shows the Step 3 objects are already applied. A rerun is NOT needed. Cause of the rerun error is not yet explained: owner's diagnostic query (rows violating the path pattern) was reported only as "success", with no row output. Open until the result of that query and of `select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('ad_creatives_logo_path_check','ad_creatives_banner_path_check')` are shown. No constraint, RLS or storage policy was weakened.
Follow-up (2026-11-07): owner pasted constraint definitions and the only two rows with image paths (archived d4517c21, approved c3fc9b66). Both rows match the required path format; no violating row exists. The pasted definition displayed a doubled backslash before the extension group, most likely a copy-paste/display artefact and the probable cause of the original 23514 (not proven). Fix: regex `\.` replaced by `[.]` in the SQL file (same strictness). Owner then ran the FIXED phase4-step3-1 SQL on TEST: **passed without error (User-confirmed, no output pasted)**. The post-run `pg_get_constraintdef` / `convalidated` check was not pasted.

## 4. Upload and security results
See table above (all User-confirmed except 2c open).

## 5. Lifecycle results
See 4a-4d. Admin rejection with reason and the advertiser seeing it: covered by owner's 4 answers but not itemised; confirm if you want it listed separately.

## 6. Rich ad delivery results
Only Step 3B results stand. Flag OFF asset URL 404, publisher example render and text-only fallback: User-confirmed (word only, 2026-11-07). Step 3B results above stand.

## 7. Failed checks and remaining blockers
No failed check and no blocking item. Notes:
1. 23514 on the first rerun: probable cause is a mangled backslash in the pasted SQL (not proven). Fixed file ran clean on TEST (User-confirmed).
2. Post-fix constraint definition check (`[.](png|jpg|webp)$`, convalidated = true) not pasted; optional.
3. Everything except Task 1 C1-C5 and the Step 3B items is User-confirmed by word only (no screenshots or outputs).
4. Admin rejection reason / advertiser notification were covered under owner's 4a-4c, not itemised.

## 8. Files changed
This report (new); supabase/sql/phase4-step3-1-creative-submission.sql (2 regex lines + comment); PHASE4-STEP3-CREATIVE-SUBMISSION-REPORT.md and PHASE4-STEP3B-RICH-AD-DELIVERY-REPORT.md (appended / status lines only).

## 9. Manual checks needing owner confirmation
Optional: paste the post-fix constraint check; confirm you accept word-only evidence for items marked User-confirmed.

## 10. Ready for next phase?
**YES, subject to your confirmation.** No failed checks. Task 1 C1-C5 pass with real output; fixed SQL ran clean on TEST (User-confirmed); all other checks User-confirmed (word only). Production untouched. Step 5 not started; waiting for your explicit confirmation.

## 11. Post-Step-4 UX fix (2026-11-07) - added after the verification above
Problem reported by owner: after any validation error in the creative form (wrong image format, bad https URL), both images, the button text and the URL were cleared and had to be filled again. Cause: React 19 resets a `<form action={...}>` after the action finishes; file inputs cannot be refilled. Fix: the form now builds the FormData itself on submit (no reset) via `onSubmitKeepFields` in `lib/actions/use-guarded-action.ts`; double-tap lock unchanged; button shows pending from the hook. No API, DB, RLS, storage or server-action change. Status: CODE DONE, source-check tests added; NOT run (no node_modules in sandbox). Preview check PENDING owner confirmation: submit with a bad URL and a good image pair, confirm images, button text and URL stay filled.
Files: lib/actions/use-guarded-action.ts, components/campaigns/CreativeSubmissionForm.tsx, tests/campaigns/phase4-step3-contract.test.ts.
