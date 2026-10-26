import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCampaignForm } from "@/lib/campaigns/validation";
import { BELOW_SPEND_MESSAGE, isBelowSpend, remainingBudget } from "@/lib/campaigns/budget";
import { toAdvertiser } from "@/lib/campaigns/advertiser";
import { MAX_CAMPAIGN_DAYS, MIN_DAILY_BUDGET, MIN_TOTAL_BUDGET, START_MAX_DAYS_AHEAD } from "@/lib/campaigns/constants";
import { addDays } from "@/lib/campaigns/validation";
import { parseCreativeForm } from "@/lib/campaigns/creative-validation";
import type { FormValues } from "@/lib/campaigns/types";

const TODAY = "2026-10-26";
const good: FormValues = {
  name: "Diwali sale",
  description: "",
  category: "lifestyle",
  totalBudget: "500",
  dailyBudget: "50",
  startDate: TODAY,
  endDate: "2026-12-31",
};
const opts = { todayUtc: TODAY };
const read = (f: string) => readFileSync(f, "utf8");

function fieldError(over: Partial<FormValues>, field: keyof FormValues, o = opts) {
  const r = parseCampaignForm({ ...good, ...over }, o);
  return r.ok ? undefined : r.errors[field];
}

describe("day 9 part 1: campaign name", () => {
  it("collapses extra spaces, tabs and new lines into one space", () => {
    const r = parseCampaignForm({ ...good, name: "  Diwali \t  sale\n offer  " }, opts);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.name, "Diwali sale offer");
  });
  it("rejects hidden control characters (NUL, bell, escape, DEL)", () => {
    for (const bad of ["Diwali\u0000sale", "Diwali\u0007sale", "Diwali\u001bsale", "Diwali\u007fsale"]) {
      assert.ok(fieldError({ name: bad }, "name"), JSON.stringify(bad));
    }
  });
  it("length rules are checked after cleaning (spaces do not count twice)", () => {
    assert.ok(fieldError({ name: "a  " }, "name"), "too short after trim");
    assert.equal(fieldError({ name: "abc" }, "name"), undefined);
    assert.ok(fieldError({ name: "x".repeat(151) }, "name"));
  });
});

describe("day 9 part 1: category", () => {
  it("rejects empty and unknown categories on create", () => {
    assert.ok(fieldError({ category: "" }, "category"));
    assert.ok(fieldError({ category: "weapons" }, "category"));
    assert.ok(fieldError({ category: "Gaming" }, "category"), "case matters: slug only");
  });
  it("a locked category ignores the form value on edit", () => {
    const r = parseCampaignForm(
      { ...good, category: "gaming" },
      { ...opts, existing: { startDate: TODAY, category: "finance", categoryLocked: true } },
    );
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.category, "finance");
  });
});

describe("day 9 part 1: schedule limits", () => {
  it("start date can be at most START_MAX_DAYS_AHEAD days from today", () => {
    assert.equal(fieldError({ startDate: addDays(TODAY, START_MAX_DAYS_AHEAD), endDate: "" }, "startDate"), undefined);
    assert.ok(fieldError({ startDate: addDays(TODAY, START_MAX_DAYS_AHEAD + 1), endDate: "" }, "startDate"));
    assert.ok(fieldError({ startDate: "9999-12-31", endDate: "" }, "startDate"));
  });
  it("a campaign can run at most MAX_CAMPAIGN_DAYS days", () => {
    assert.equal(fieldError({ endDate: addDays(TODAY, MAX_CAMPAIGN_DAYS) }, "endDate"), undefined);
    assert.ok(fieldError({ endDate: addDays(TODAY, MAX_CAMPAIGN_DAYS + 1) }, "endDate"));
  });
  it("end before start and fake dates are still rejected", () => {
    assert.ok(fieldError({ endDate: "2026-10-01" }, "endDate"));
    assert.ok(fieldError({ startDate: "2026-02-30" }, "startDate"));
    assert.ok(fieldError({ startDate: "2026-13-01" }, "startDate"));
    assert.ok(fieldError({ startDate: "" }, "startDate"));
  });
  it("an old campaign with an old start date and long run can still be edited unchanged", () => {
    const existing = {
      startDate: "2026-01-01",
      category: "lifestyle",
      categoryLocked: false,
      totalBudget: 500,
      dailyBudget: 50,
      endDate: "2029-01-01",
    };
    const r = parseCampaignForm({ ...good, startDate: "2026-01-01", endDate: "2029-01-01", name: "Renamed only" }, { ...opts, existing });
    assert.ok(r.ok, "unchanged dates must not trip the new limits");
  });
});

describe("day 9 part 1: minimum budgets", () => {
  it("total budget below the minimum is rejected, the minimum itself is fine", () => {
    assert.ok(fieldError({ totalBudget: "0.99", dailyBudget: "" }, "totalBudget"));
    assert.equal(fieldError({ totalBudget: MIN_TOTAL_BUDGET.toFixed(2), dailyBudget: "" }, "totalBudget"), undefined);
  });
  it("daily budget below the minimum is rejected, the minimum itself is fine", () => {
    assert.ok(fieldError({ dailyBudget: "0.49" }, "dailyBudget"));
    assert.equal(fieldError({ dailyBudget: MIN_DAILY_BUDGET.toFixed(2) }, "dailyBudget"), undefined);
    assert.equal(fieldError({ dailyBudget: "" }, "dailyBudget"), undefined, "daily is optional");
  });
  it("daily above total is still rejected", () => {
    assert.ok(fieldError({ totalBudget: "10", dailyBudget: "20" }, "dailyBudget"));
  });
  it("an old campaign with a legacy tiny budget is not forced to raise it when the budget is unchanged", () => {
    const existing = { startDate: TODAY, category: "lifestyle", categoryLocked: false, totalBudget: 0.5, dailyBudget: 0.25, endDate: null };
    const r = parseCampaignForm({ ...good, totalBudget: "0.50", dailyBudget: "0.25", endDate: "" }, { ...opts, existing });
    assert.ok(r.ok);
    // ... but changing it to another tiny value is rejected
    const r2 = parseCampaignForm({ ...good, totalBudget: "0.60", dailyBudget: "", endDate: "" }, { ...opts, existing });
    assert.ok(!r2.ok && r2.errors.totalBudget);
  });
});

describe("day 9 part 1: budget vs spend (pure rules)", () => {
  it("a total below what is already spent is blocked, equal or above is fine", () => {
    assert.equal(isBelowSpend(10, 10.0001), true);
    assert.equal(isBelowSpend(10, 10), false);
    assert.equal(isBelowSpend(10.0001, 10), false);
    assert.equal(isBelowSpend(1, 0), false);
  });
  it("float noise does not block a valid edit", () => {
    assert.equal(isBelowSpend(0.3, 0.1 + 0.2), false);
  });
  it("remaining budget is never negative and keeps 4 decimals", () => {
    assert.equal(remainingBudget(100, 25.5), 74.5);
    assert.equal(remainingBudget(100, 100), 0);
    assert.equal(remainingBudget(100, 120), 0);
    assert.equal(remainingBudget(1, 0.0023), 0.9977);
  });
  it("the message names the spent amount", () => {
    assert.match(BELOW_SPEND_MESSAGE("$5.0000"), /\$5\.0000/);
  });
});

describe("day 9 part 1: advertiser row parsing", () => {
  const row = { id: "11111111-1111-4111-8111-111111111111", status: "active", company_name: "Acme" };
  it("parses a good row", () => {
    assert.deepEqual(toAdvertiser(row), { id: row.id, status: "active", companyName: "Acme" });
  });
  it("rejects bad shapes and unknown statuses (never crashes)", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { ...row, status: "ACTIVE" }, { ...row, status: "banned" }, { ...row, id: 5 }, { ...row, company_name: null }]) {
      assert.equal(toAdvertiser(bad), null, JSON.stringify(bad));
    }
  });
});

describe("day 9 part 1: ad (creative) URL checks", () => {
  const ok = { headline: "Learn fast", body: "Great course", ctaText: "Join", destinationUrl: "https://example.com/offer?a=1" };
  it("accepts a normal https URL", () => {
    assert.ok(parseCreativeForm(ok).ok);
  });
  it("rejects http, userinfo, IPs, localhost, spaces and javascript", () => {
    for (const bad of [
      "http://example.com",
      "https://trusted.com@evil.example/x",
      "https://user:pw@example.com",
      "https://127.0.0.1/",
      "https://localhost/",
      "https://example/",
      "https://exa mple.com",
      "javascript:alert(1)",
      "https://example.com\\@evil.com",
      "",
    ]) {
      const r = parseCreativeForm({ ...ok, destinationUrl: bad });
      assert.ok(!r.ok && r.errors.destinationUrl, bad);
    }
  });
});

describe("day 9 part 1: ownership and error handling (source checks)", () => {
  const queries = read("lib/campaigns/queries.ts");
  const actions = read("app/dashboard/advertiser/campaigns/actions.ts");
  const creativeActions = read("app/dashboard/advertiser/campaigns/creative-actions.ts");

  it("every campaigns query in queries.ts is filtered by the advertiser", () => {
    const list = queries.slice(queries.indexOf("export async function listMyCampaigns"), queries.indexOf("export type LoadCampaignResult"));
    assert.match(list, /\.eq\("advertiser_id", advertiserId\)/);
    const load = queries.slice(queries.indexOf("export async function loadMyCampaign"), queries.indexOf("export async function getCreativeSummary"));
    assert.match(load, /\.eq\("advertiser_id", advertiserId\)/);
  });

  it("the advertiser id never comes from form data or the URL", () => {
    for (const src of [actions, creativeActions]) {
      assert.equal(/formData\.get\("advertiserId"\)|formData\.get\("advertiser_id"\)/.test(src), false);
    }
    assert.match(actions, /advertiser_id: adv\.id/);
    assert.match(actions, /\.eq\("advertiser_id", adv\.id\)/);
  });

  it("every server action checks the role and loads the advertiser with failure handling", () => {
    for (const src of [actions, creativeActions]) {
      assert.match(src, /requireRole\(\["advertiser"\]\)/);
      assert.match(src, /loadMyAdvertiser\(\)/);
      assert.match(src, /if \(failed\)/);
    }
  });

  it("a database error is no longer treated as 'no advertiser' on the campaign pages", () => {
    for (const f of [
      "app/dashboard/advertiser/campaigns/page.tsx",
      "app/dashboard/advertiser/campaigns/new/page.tsx",
      "app/dashboard/advertiser/campaigns/[id]/page.tsx",
      "app/dashboard/advertiser/campaigns/[id]/edit/page.tsx",
    ]) {
      const src = read(f);
      assert.match(src, /loadMyAdvertiser\(\)/, f);
      assert.equal(/getMyAdvertiser/.test(src), false, f);
      assert.match(src, /throw new Error\("Advertiser could not be loaded"\)/, f);
    }
  });

  it("a malformed campaign row is a load failure, not 'not found'", () => {
    assert.match(queries, /campaign \? \{ campaign, failed: false \} : \{ campaign: null, failed: true \}/);
  });

  it("edit checks the spend before lowering the budget and fails closed on active/paused", () => {
    assert.match(actions, /isBelowSpend\(v\.totalBudget, spend\.spentTotal\)/);
    assert.match(actions, /spend === null && \(current\.status === "active" \|\| current\.status === "paused"\)/);
  });

  it("edit keeps the optimistic lock and status guard", () => {
    assert.match(actions, /expectedUpdatedAt/);
    assert.match(actions, /\.eq\("updated_at", current\.updatedAt\)/);
    assert.match(actions, /\.eq\("status", current\.status\)/);
  });

  it("the detail page loads independent data in parallel and gates the 'created' notice on draft", () => {
    const detail = read("app/dashboard/advertiser/campaigns/[id]/page.tsx");
    assert.match(detail, /Promise\.all\(\[/);
    assert.match(detail, /sp\.created === "1" && campaign\.status === "draft"/);
    assert.match(detail, /Budget left/);
  });

  it("no secrets or service-role client in the campaign code", () => {
    for (const src of [queries, actions, creativeActions]) {
      assert.equal(/createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/.test(src), false);
    }
  });

  it("loading, error and not-found screens exist and do not leak raw error messages", () => {
    const err = read("app/dashboard/advertiser/campaigns/error.tsx");
    assert.equal(/error\.message/.test(err), false);
    assert.ok(read("app/dashboard/advertiser/campaigns/loading.tsx").includes('role="status"'));
    assert.ok(read("app/dashboard/advertiser/campaigns/not-found.tsx").includes("Campaign not found"));
  });
});
