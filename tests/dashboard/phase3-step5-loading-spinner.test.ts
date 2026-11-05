import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 3 Step 5: loading spinner + faster-feeling buttons. Source (text) checks, kyunki sandbox me browser / DOM nahi.
// Asli check Preview par user karega (spinner sirf asli loading par dikhe, buttons turant react karein).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const LOADING_PAGES = [
  "app/dashboard/loading.tsx",
  "app/dashboard/advertiser/campaigns/loading.tsx",
  "app/dashboard/analytics/loading.tsx",
];
const PENDING_BUTTONS = [
  "components/auth/SubmitButton.tsx",
  "components/auth/LogoutButton.tsx",
  "components/admin/AdminDecisionButton.tsx",
  "components/admin/PayoutActionButton.tsx",
  "components/campaigns/CreativeActionButton.tsx",
  "components/campaigns/CampaignReviewButton.tsx",
  "components/campaigns/RunStateButton.tsx",
  "components/dashboard/PublisherKeyManager.tsx",
];

describe("phase 3 step 5 | Spinner component", () => {
  const src = code("components/ui/Spinner.tsx");
  it("is a server-safe SVG: no client directive, no hooks, no data access", () => {
    assert.doesNotMatch(src, /"use client"|use(State|Effect|Ref)|supabase|fetch\(/);
    assert.match(src, /<svg/);
    assert.match(src, /aria-hidden="true"/);
  });
  it("has a delayed variant so a fast load never shows it", () => {
    assert.match(src, /bliss-spinner-delayed/);
    const css = read("app/globals.css");
    assert.match(css, /\.bliss-spinner-delayed\s*\{[^}]*opacity:\s*0/);
    assert.match(css, /bliss-reveal 0s linear 250ms/);
  });
  it("reduced-motion users get a slower spin, not a frozen or removed indicator", () => {
    const css = read("app/globals.css");
    assert.match(css, /prefers-reduced-motion[\s\S]*\.bliss-spinner/);
  });
});

describe("phase 3 step 5 | page loading", () => {
  for (const f of LOADING_PAGES) {
    it(`${f}: delayed spinner added, skeleton and accessibility kept, still a server component`, () => {
      const src = read(f);
      const c = code(f);
      assert.match(c, /<Spinner size="lg" delayed \/>/);
      assert.match(src, /role="status"/);
      assert.match(src, /aria-busy="true"/);
      assert.match(src, /animate-pulse/);
      assert.match(src, /sr-only/);
      assert.doesNotMatch(c, /"use client"|supabase|fetch\(|use(State|Effect)/);
    });
  }
});

describe("phase 3 step 5 | buttons", () => {
  for (const f of PENDING_BUTTONS) {
    it(`${f}: spinner only inside the pending branch, still disabled while pending`, () => {
      const c = code(f);
      assert.match(c, /pending \? <><Spinner size="sm"/);
      assert.match(c, /disabled=\{pending\}/);
      // spinner nie pending ke bahar nahi: har <Spinner size="sm"> pending branch me hai
      const total = (c.match(/<Spinner size="sm"/g) ?? []).length;
      const inPending = (c.match(/pending \? <><Spinner size="sm"/g) ?? []).length;
      assert.equal(total, inPending);
    });
  }
  it("global css: no tap delay and a press feedback on enabled buttons only", () => {
    const css = read("app/globals.css");
    assert.match(css, /touch-action:\s*manipulation/);
    assert.match(css, /button:not\(:disabled\):active/);
  });
  it("guard timeout and action guard logic are unchanged", () => {
    assert.match(read("lib/actions/guard.ts"), /DEFAULT_ACTION_TIMEOUT_MS = 20_000/);
  });
});
