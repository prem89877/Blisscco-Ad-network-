import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 2: website-wide button fix. Source (text) checks: UI sirf textual dekha ja sakta hai (sandbox me browser / DOM nahi).
// Asli click-through Preview par user karega. Ye tests wiring pakadte hain: koi button wapas seedha useActionState par na chala jaye,
// har form double-tap lock lagaye, slow-path parallel rahe, aur financial / ledger code untouched rahe.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const GUARDED_COMPONENTS = [
  "components/campaigns/RunStateButton.tsx",
  "components/campaigns/CampaignReviewButton.tsx",
  "components/campaigns/CreativeActionButton.tsx",
  "components/campaigns/CampaignForm.tsx",
  "components/campaigns/CreativeForm.tsx",
  "components/dashboard/PayoutRequestForm.tsx",
  "components/dashboard/PublisherKeyManager.tsx",
  "components/dashboard/AccountSetupForm.tsx",
  "components/admin/PayoutActionButton.tsx",
  "components/admin/AdminDecisionButton.tsx",
];

describe("phase 2 | every action button / form uses the shared guard", () => {
  for (const f of GUARDED_COMPONENTS) {
    it(`${f}: useGuardedAction, no raw useActionState, every <form action=...> has an onSubmit lock`, () => {
      const src = code(f);
      assert.match(src, /from "@\/lib\/actions\/use-guarded-action"/);
      assert.doesNotMatch(src, /\buseActionState\b/);
      const forms = [...src.matchAll(/<form\b[^>]*?>/gs)].map((m) => m[0]).filter((t) => /action=\{/.test(t));
      assert.ok(forms.length >= 1, "at least one action form");
      for (const t of forms) assert.match(t, /onSubmit=/, t.slice(0, 80));
    });
  }

  it("the hook is built on the shared guard, uses router.refresh only through it, and lets onSubmit stop a second tap", () => {
    const hook = code("lib/actions/use-guarded-action.ts");
    assert.match(hook, /^"use client";/);
    assert.match(hook, /createActionGuard/);
    assert.match(hook, /router\.refresh\(\)/);
    assert.match(hook, /preventDefault\(\)/);
    assert.match(hook, /tryBegin\(\)/);
  });

  it("CampaignForm still validates budgets in the browser first and only then takes the duplicate-tap lock", () => {
    const src = code("components/campaigns/CampaignForm.tsx");
    const validate = src.indexOf("budgetProblems(e.currentTarget)");
    const lock = src.indexOf("guardSubmit(e)");
    assert.ok(validate > 0 && lock > validate);
    assert.match(src, /readFormValues\(formData\)/, "typed values survive a timeout / network error");
  });

  it("admin decision button now shows the success message (before: only errors were shown)", () => {
    assert.match(code("components/admin/AdminDecisionButton.tsx"), /state\.status === "success"/);
  });
});

describe("phase 2 | guard module is UI-only and cannot touch money", () => {
  it("lib/actions/guard.ts imports nothing (no ledger, payout, supabase or next code)", () => {
    const src = code("lib/actions/guard.ts");
    assert.equal([...src.matchAll(/^import\s/gm)].length, 0);
    assert.doesNotMatch(src, /ledger|payout|supabase|rpc\(/i);
  });
  it("the hook imports only react, next/navigation and the guard", () => {
    const imports = [...code("lib/actions/use-guarded-action.ts").matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ["./guard", "next/navigation", "react"]);
  });
  it("financial RPC names and the payout revalidation are unchanged", () => {
    const p = code("app/dashboard/publisher/payout-actions.ts");
    assert.match(p, /rpc\("request_my_payout"/);
    assert.equal([...p.matchAll(/revalidatePath\(/g)].length, 1);
    const a = code("app/dashboard/admin/payout-actions.ts");
    for (const n of ["admin_mark_payout_paid", "admin_review_payout_request"]) assert.match(a, new RegExp(n));
  });
  it("payout request key stays a per-page-load uuid (database dedupes retries by it)", () => {
    assert.match(code("app/dashboard/publisher/payouts/page.tsx"), /crypto\.randomUUID\(\)/);
  });
});

describe("phase 2 | slow paths: independent reads run together (existing ownership checks kept)", () => {
  it("requireRole and the advertiser / publisher row load in one Promise.all in every action file", () => {
    for (const f of ["app/dashboard/advertiser/campaigns/actions.ts", "app/dashboard/advertiser/campaigns/creative-actions.ts"]) {
      assert.match(code(f), /Promise\.all\(\[requireRole\(\["advertiser"\]\), loadMyAdvertiser\(\)\]\)/, f);
    }
    assert.match(code("app/dashboard/publisher/actions.ts"), /Promise\.all\(\[requireRole\(\["publisher"\]\), loadMyPublisher\(\)\]\)/);
  });
  it("resume reads campaign, approved ads and spend together; the resume rules are still checked before the write", () => {
    const src = code("app/dashboard/advertiser/campaigns/actions.ts");
    assert.match(src, /Promise\.all\(\[\s*loadMyCampaign\(adv\.id, id\),\s*to === "active" \? getCreativeSummary\(id\)/);
    assert.ok(src.indexOf("checkResume(") < src.indexOf('.update({ status: to })'));
  });
  it("submit-for-review counts reviewable ads while it loads the campaign, and still checks before the write", () => {
    const src = code("app/dashboard/advertiser/campaigns/creative-actions.ts");
    assert.match(src, /action === "submit" \? countReviewableCreatives\(campaignId\)/);
    const check = src.indexOf("checkSubmitCampaign(");
    assert.ok(check > 0 && src.indexOf(".update({ status: rule.to })", check) > check);
  });
  it("every state-changing action still refreshes its pages (server-confirmed state shows without a reload)", () => {
    for (const [f, paths] of [
      ["app/dashboard/advertiser/campaigns/actions.ts", 4],
      ["app/dashboard/advertiser/campaigns/creative-actions.ts", 3],
      ["app/dashboard/publisher/actions.ts", 3],
      ["app/dashboard/admin/actions.ts", 1],
      ["app/dashboard/admin/payout-actions.ts", 1],
      ["app/dashboard/publisher/payout-actions.ts", 1],
    ] as const) {
      assert.ok([...code(f).matchAll(/revalidatePath\(/g)].length >= paths, f);
    }
  });
  it("the campaign detail page still checks ownership (loadMyCampaign + notFound) before the analytics call", () => {
    const src = code("app/dashboard/advertiser/campaigns/[id]/page.tsx");
    assert.ok(src.indexOf("loadMyCampaign(adv.id, id)") < src.indexOf("notFound()", src.indexOf("loadMyCampaign(adv.id, id)")));
    assert.ok(src.indexOf("if (!campaign) notFound()") < src.indexOf("loadCampaignPerformance("));
  });
});
