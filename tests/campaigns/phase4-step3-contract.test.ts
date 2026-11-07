import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { navForRole } from "@/lib/dashboard-nav";
import { candidateIneligibility, toPublicAd, type AdCandidate } from "@/lib/ads/category-matching";
import { parseCandidateRow } from "@/lib/ads/candidate-rows";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
// Comments hata kar sirf code dekhte hain (comments me "approved" jaise shabd aa sakte hain).
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sqlCode = (src: string) => src.replace(/--.*$/gm, "");

const SQL = "supabase/sql/phase4-step3-1-creative-submission.sql";
const NEW_FILES = [
  "app/dashboard/advertiser/creatives/actions.ts",
  "app/dashboard/advertiser/creatives/page.tsx",
  "components/campaigns/CreativeSubmissionForm.tsx",
  "components/campaigns/CreativePreview.tsx",
  "components/campaigns/CreativeStatusBadge.tsx",
  "lib/campaigns/creative-assets.ts",
  "lib/campaigns/creative-upload.ts",
  "lib/campaigns/creative-submission.ts",
  "lib/campaigns/creative-submission-queries.ts",
];

describe("phase 4 step 3 | SQL file is safe and minimal", () => {
  const sql = sqlCode(read(SQL));
  it("adds only the four nullable columns (no new table)", () => {
    for (const col of ["brand_name", "logo_path", "banner_path", "keywords"]) assert.match(sql, new RegExp(`add column if not exists ${col}\\s+text`));
    assert.doesNotMatch(sql, /create table/i);
    const addColumn = sql.split(";").filter((st) => /add column/i.test(st)).join(";");
    assert.doesNotMatch(addColumn, /\bnot null\b/i, "new columns must stay nullable so old ads and the old form keep working");
  });
  it("is non-destructive", () => {
    assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|alter table [^;]* drop column)\b/i);
    assert.doesNotMatch(sql, /\bdisable row level security\b/i);
  });
  it("bucket is private, 4 MB, images only", () => {
    assert.match(sql, /'creative-assets', 'creative-assets', false, 4194304/);
    assert.match(sql, /array\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
    assert.doesNotMatch(sql, /public\s*=\s*true/i);
    assert.doesNotMatch(sql, /svg/i);
  });
  it("no anon access, no open policies, no service role", () => {
    assert.doesNotMatch(sql, /\bto anon\b/i);
    assert.doesNotMatch(sql, /\bto public\b/i);
    assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
    assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
    assert.doesNotMatch(sql, /service_role/i);
  });
  it("storage policies: own-folder insert/select/delete + admin select, all limited to this bucket", () => {
    for (const name of ["creative_assets_insert_own", "creative_assets_select_own", "creative_assets_select_admin", "creative_assets_delete_own"]) {
      assert.match(sql, new RegExp(`create policy ${name} on storage\\.objects`));
    }
    const policies = sql.split("create policy").slice(1);
    assert.equal(policies.length, 4);
    for (const p of policies) {
      assert.match(p, /to authenticated/);
      assert.match(p, /bucket_id = 'creative-assets'/);
    }
    const insert = policies.find((p) => p.includes("creative_assets_insert_own")) ?? "";
    assert.match(insert, /my_active_advertiser_id/);
    assert.match(insert, /archived', 'completed'/);
    assert.doesNotMatch(sql, /for update to authenticated/i, "no update policy on storage objects");
  });
  it("review columns never become writable by the advertiser", () => {
    const grants = sql.split(";").filter((s) => /grant (insert|update)/i.test(s)).join(";");
    assert.doesNotMatch(grants, /rejection_reason|reviewed_by|reviewed_at/);
    assert.match(grants, /grant insert \(campaign_id, headline, body, cta_text, destination_url, brand_name, logo_path, banner_path, keywords\)/);
  });
  it("does not touch approval, serving, ledger or existing RLS policies", () => {
    assert.doesNotMatch(sql, /admin_review_creative|admin_review_campaign|match_contextual_ad|record_ad_|ledger|payout/i);
    assert.doesNotMatch(sql, /create policy \w+ on public\./i);
    assert.doesNotMatch(sql, /alter policy|drop policy if exists (?!creative_assets_)/i);
  });
  it("guard trigger keeps every original status rule and adds the new columns", () => {
    const pairs = (src: string) => {
      const fn = src.slice(src.indexOf("function private.guard_creative_changes"));
      const end = fn.indexOf("$$;");
      return [...fn.slice(0, end).matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    };
    const original = pairs(read("supabase/sql/day-3-5-security.sql"));
    const updated = pairs(read(SQL));
    assert.ok(original.length >= 9);
    assert.deepEqual(updated, original);
    const fnNew = read(SQL);
    for (const msg of [
      "New creatives must start as draft without review data",
      "Withdraw to draft before editing a creative under review",
      "Archived creative is read-only",
      "Review fields cannot be changed",
      "id and campaign cannot be changed",
    ]) {
      assert.ok(fnNew.includes(msg), msg);
    }
    assert.match(fnNew, /new\.banner_path,\s*new\.keywords\)/);
    assert.match(fnNew, /Image path does not belong to this advertiser and campaign/);
  });
  it("is listed in the migration order and has TEST-only warning", () => {
    assert.match(read("supabase/MIGRATION-ORDER.md"), /phase4-step3-1/);
    assert.match(read(SQL), /TEST PROJECT PAR HI CHALAO/);
  });
});

describe("phase 4 step 3 | no secrets, no auto-approval in new code", () => {
  for (const f of NEW_FILES) {
    it(`${f}: no service-role / admin client / secrets`, () => {
      assert.ok(existsSync(path.join(ROOT, f)), f);
      const src = code(read(f));
      assert.doesNotMatch(src, /@\/lib\/supabase\/admin/);
      assert.doesNotMatch(src, /service_role|SUPABASE_SECRET|SERVICE_ROLE|process\.env/i);
    });
  }
  it("submit action never sets approved/active or review fields", () => {
    const src = code(read("app/dashboard/advertiser/creatives/actions.ts"));
    assert.doesNotMatch(src, /["']approved["']/);
    assert.doesNotMatch(src, /["']active["']\s*[,}]\s*$/m);
    assert.doesNotMatch(src, /reviewed_by|reviewed_at|rejection_reason\s*:/);
    assert.match(src, /status:\s*"pending_review"/);
    assert.doesNotMatch(src, /\.rpc\(/, "advertiser action must not call admin functions");
  });
  it("client form imports no server-only module", () => {
    const src = code(read("components/campaigns/CreativeSubmissionForm.tsx"));
    assert.match(src, /^"use client"/);
    assert.doesNotMatch(src, /@\/lib\/supabase|next\/headers|server-only|creative-submission-queries/);
  });
  it("preview does not make the unreviewed destination clickable", () => {
    assert.doesNotMatch(code(read("components/campaigns/CreativePreview.tsx")), /<a\b|href=/);
  });
  it("images come only from signed URLs of the private bucket (no public URL)", () => {
    for (const f of NEW_FILES.concat(["app/dashboard/admin/page.tsx"])) {
      assert.doesNotMatch(code(read(f)), /getPublicUrl/);
    }
    assert.match(code(read("lib/campaigns/creative-submission-queries.ts")), /createSignedUrls/);
  });
  it("next.config: bigger server-action body for uploads, still no env block", () => {
    const cfg = read("next.config.mjs");
    assert.match(cfg, /bodySizeLimit:\s*"8mb"/);
    assert.doesNotMatch(code(cfg), /\benv\s*:/);
  });
});

describe("phase 4 step 3 | existing flows are preserved", () => {
  it("old creative form action keeps its text fields; it only gained optional logo / ad image (no brand name or keywords)", () => {
    const src = read("app/dashboard/advertiser/campaigns/creative-actions.ts");
    assert.match(src, /export async function createCreative/);
    assert.doesNotMatch(src, /brand_name|keywords/);
  });
  it("campaign page still has the old 'Add an ad' form", () => {
    assert.match(read("app/dashboard/advertiser/campaigns/[id]/page.tsx"), /<CreativeForm\b/);
  });
  it("admin review uses the existing approve / reject function and shows the images", () => {
    const src = read("app/dashboard/admin/page.tsx");
    assert.match(src, /kind="creative" id=\{c\.id\} decision="approve"/);
    assert.match(src, /kind="creative" id=\{c\.id\} decision="reject"/);
    assert.match(src, /<CreativePreview/);
    assert.match(src, /not used for matching/);
    assert.match(read("app/dashboard/admin/actions.ts"), /admin_review_creative/);
  });
  it("only advertisers see the Ads link", () => {
    assert.ok(navForRole("advertiser").some((i) => i.href === "/dashboard/advertiser/creatives"));
    assert.ok(!navForRole("publisher").some((i) => i.href === "/dashboard/advertiser/creatives"));
    assert.ok(!navForRole("admin").some((i) => i.href === "/dashboard/advertiser/creatives"));
  });
  it("the ad page is protected by the advertiser role and shows only own campaigns", () => {
    const src = code(read("app/dashboard/advertiser/creatives/page.tsx"));
    assert.match(src, /requireRole\(\["advertiser"\]\)/);
    assert.match(src, /listMyCampaigns\(adv\.id\)/);
    assert.match(src, /listCreativesForCampaigns\(campaigns\.map/);
  });
});

function candidate(over: Partial<AdCandidate> = {}): AdCandidate {
  return {
    ad: { id: "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1", headline: "H", body: "B", ctaText: "Learn more", destinationUrl: "https://example.com" },
    creativeStatus: "approved",
    campaignId: "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2",
    campaignStatus: "active",
    category: "gaming",
    startDate: "2026-10-01",
    endDate: null,
    totalBudget: 100,
    dailyBudget: null,
    spentTotal: 0,
    spentToday: 0,
    advertiserStatus: "active",
    advertiserProfileStatus: "active",
    campaignServesToday: 0,
    creativeServesToday: 0,
    ...over,
  };
}
const CTX = { today: "2026-10-24", unitCostUsd: 0.002 };

describe("phase 4 step 3 | only approved creatives are eligible; delivery contract unchanged", () => {
  it("newly submitted (pending_review), draft, rejected, paused and archived ads are never eligible", () => {
    for (const s of ["draft", "pending_review", "rejected", "paused", "archived"] as const) {
      assert.equal(candidateIneligibility(candidate({ creativeStatus: s }), "gaming", CTX), "creative_not_approved", s);
    }
  });
  it("an approved ad is eligible only under the existing campaign rules", () => {
    assert.equal(candidateIneligibility(candidate(), "gaming", CTX), null);
    assert.equal(candidateIneligibility(candidate({ campaignStatus: "paused" }), "gaming", CTX), "campaign_not_active");
    assert.equal(candidateIneligibility(candidate({ advertiserStatus: "suspended" }), "gaming", CTX), "advertiser_not_active");
    assert.equal(candidateIneligibility(candidate(), "finance", CTX), "category_mismatch");
  });
  it("matching still uses the CAMPAIGN category (exact), not creative keywords", () => {
    const src = code(read("lib/ads/category-matching.ts"));
    assert.doesNotMatch(src, /keywords|brand_name/);
  });
  it("new creative columns never reach the publisher response (still exactly 5 fields)", () => {
    const row = {
      creative_id: "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1", headline: "H", body: "B", cta_text: "Learn more", destination_url: "https://example.com",
      campaign_id: "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2", category: "gaming", start_date: "2026-10-01", end_date: null, total_budget: 100, daily_budget: null,
      spent_total: 0, spent_today: 0, creative_status: "approved", campaign_status: "active", advertiser_status: "active",
      advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
      brand_name: "Secret brand", logo_path: "a/b/logo.png", banner_path: "a/b/banner.png", keywords: "x, y",
    };
    const parsed = parseCandidateRow(row);
    assert.ok(parsed);
    if (parsed) {
      assert.deepEqual(Object.keys(toPublicAd(parsed)).sort(), ["body", "ctaText", "destinationUrl", "headline", "id"]);
      assert.ok(!JSON.stringify(parsed).includes("Secret brand"));
      assert.ok(!JSON.stringify(parsed).includes("logo.png"));
    }
  });
  it("the match functions in SQL select explicit columns only (new columns are not exposed)", () => {
    const sql = sqlCode(read("supabase/sql/day-5-8-serve-functions.sql"));
    assert.doesNotMatch(sql, /brand_name|logo_path|banner_path|keywords/);
  });
});
