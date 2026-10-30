import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCampaignForm, addDays, isRealDate, utcToday } from "@/lib/campaigns/validation";
import { parseFilters, escapeLike, filtersToHref, hasActiveFilters } from "@/lib/campaigns/filters";
import { canPause, checkResume } from "@/lib/campaigns/run-state";
import { checkSubmitCampaign, isReviewAction, reviewActionFor } from "@/lib/campaigns/review";
import { isCategory, isUuid } from "@/lib/campaigns/constants";
import type { FormValues } from "@/lib/campaigns/types";

const TODAY = "2026-10-25";
const good: FormValues = {
  name: "Diwali sale",
  description: "",
  category: "lifestyle",
  totalBudget: "1,500.50",
  dailyBudget: "100",
  startDate: TODAY,
  endDate: "2026-11-30",
};
const opts = { todayUtc: TODAY };

describe("campaigns: form validation", () => {
  it("accepts a good form and cleans values", () => {
    const r = parseCampaignForm(good, opts);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.totalBudget, 1500.5);
      assert.equal(r.value.dailyBudget, 100);
      assert.equal(r.value.description, null);
    }
  });
  it("rejects bad names, categories and money", () => {
    const cases: Array<[Partial<FormValues>, string]> = [
      [{ name: "ab" }, "name"],
      [{ name: "x".repeat(151) }, "name"],
      [{ category: "weapons" }, "category"],
      [{ totalBudget: "" }, "totalBudget"],
      [{ totalBudget: "-5" }, "totalBudget"],
      [{ totalBudget: "$100" }, "totalBudget"],
      [{ totalBudget: "10.999" }, "totalBudget"],
      [{ totalBudget: "0" }, "totalBudget"],
      [{ totalBudget: "10000001" }, "totalBudget"],
      [{ dailyBudget: "2000" }, "dailyBudget"],
      [{ dailyBudget: "abc" }, "dailyBudget"],
    ];
    for (const [over, field] of cases) {
      const r = parseCampaignForm({ ...good, ...over }, opts);
      assert.ok(!r.ok && r.errors[field as keyof FormValues], JSON.stringify(over));
    }
  });
  it("checks dates: real date, not in the past, end after start", () => {
    assert.ok(!parseCampaignForm({ ...good, startDate: "2026-02-30" }, opts).ok);
    assert.ok(!parseCampaignForm({ ...good, startDate: "2026-10-01" }, opts).ok);
    assert.ok(!parseCampaignForm({ ...good, endDate: "2026-10-01" }, opts).ok);
    assert.ok(parseCampaignForm({ ...good, startDate: addDays(TODAY, -1) }, opts).ok, "one day grace for time zones");
    assert.ok(parseCampaignForm({ ...good, endDate: "" }, opts).ok);
  });
  it("edit keeps a locked category and an old start date", () => {
    const r = parseCampaignForm(
      { ...good, category: "gaming", startDate: "2026-09-01" },
      { todayUtc: TODAY, existing: { startDate: "2026-09-01", category: "lifestyle", categoryLocked: true } },
    );
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.category, "lifestyle");
  });
  it("date helpers", () => {
    assert.equal(isRealDate("2026-02-29"), false);
    assert.equal(isRealDate("2028-02-29"), true);
    assert.equal(utcToday(new Date("2026-10-25T23:59:59Z")), "2026-10-25");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
});

describe("campaigns: filters (URL se aate hain, server par dobara check)", () => {
  it("drops unknown status/category and wildcard characters", () => {
    const f = parseFilters({ q: " a*b\u0001c ", status: "hacked", category: "Bad Value!" });
    assert.deepEqual(f, { q: "a b c", status: "", category: "" });
  });
  it("keeps valid values and round-trips to a link", () => {
    const f = parseFilters({ q: "sale", status: "draft", category: "gaming" });
    assert.ok(hasActiveFilters(f));
    assert.equal(filtersToHref("/x", f), "/x?q=sale&status=draft&category=gaming");
    assert.equal(filtersToHref("/x", parseFilters({})), "/x");
  });
  it("escapeLike makes % and _ plain text", () => assert.equal(escapeLike("100%_a\\"), "100\\%\\_a\\\\"));
  it("array params use the first value", () => assert.equal(parseFilters({ status: ["paused", "draft"] }).status, "paused"));
});

describe("campaigns: pause / resume / review rules", () => {
  it("only active campaigns can be paused", () => {
    assert.equal(canPause("active"), true);
    for (const s of ["draft", "paused", "pending_review", "rejected", "archived", "completed"] as const) assert.equal(canPause(s), false, s);
  });
  it("resume needs paused, a future end date and an approved ad", () => {
    assert.deepEqual(checkResume({ status: "paused", endDate: null }, 1, TODAY), { ok: true });
    assert.deepEqual(checkResume({ status: "active", endDate: null }, 1, TODAY), { ok: false, reason: "not_paused" });
    assert.deepEqual(checkResume({ status: "paused", endDate: "2026-10-01" }, 1, TODAY), { ok: false, reason: "ended" });
    assert.deepEqual(checkResume({ status: "paused", endDate: null }, 0, TODAY), { ok: false, reason: "no_approved_creative" });
    assert.deepEqual(checkResume({ status: "paused", endDate: null }, null, TODAY), { ok: true }, "unknown count: database decides");
  });
  it("review actions map to the allowed advertiser transitions", () => {
    assert.equal(reviewActionFor("draft"), "submit");
    assert.equal(reviewActionFor("pending_review"), "withdraw");
    assert.equal(reviewActionFor("rejected"), "reopen");
    for (const s of ["active", "paused", "completed", "archived"] as const) assert.equal(reviewActionFor(s), null, s);
    assert.equal(isReviewAction("approve"), false, "advertiser can never approve");
    assert.equal(isReviewAction("submit"), true);
  });
  it("submit needs a reviewable ad and a campaign that has not ended", () => {
    assert.deepEqual(checkSubmitCampaign({ endDate: null }, 1, TODAY), { ok: true });
    assert.deepEqual(checkSubmitCampaign({ endDate: null }, 0, TODAY), { ok: false, reason: "no_creative" });
    assert.deepEqual(checkSubmitCampaign({ endDate: "2026-10-01" }, 3, TODAY), { ok: false, reason: "ended" });
    assert.deepEqual(checkSubmitCampaign({ endDate: null }, null, TODAY), { ok: true });
  });
  it("constants helpers", () => {
    assert.ok(isCategory("gaming"));
    assert.ok(!isCategory("health"));
    assert.ok(isUuid("11111111-1111-4111-8111-111111111111"));
    assert.ok(!isUuid("not-a-uuid"));
  });
});
