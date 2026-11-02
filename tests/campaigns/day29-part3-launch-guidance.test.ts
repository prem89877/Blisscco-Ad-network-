import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CAMPAIGN_STATUSES,
  CATEGORY_EDITABLE_STATUSES,
  EDIT_LOCKED_STATUSES,
  MAX_BUDGET,
  MIN_DAILY_BUDGET,
  MIN_TOTAL_BUDGET,
  STATUS_HELP,
  type CampaignDbStatus,
} from "@/lib/campaigns/constants";
import { DELIVERY_MESSAGES, NOT_ACTIVE_MESSAGES, SERVING_MESSAGE, deliveryState, type DeliveryInput } from "@/lib/campaigns/delivery";
import { REVIEW_ACTIONS, checkSubmitCampaign, reviewActionFor } from "@/lib/campaigns/review";
import { canPause, checkResume } from "@/lib/campaigns/run-state";

// Day 29 Part 3: advertiser launch guidance. Delivery states and status rules run for real (pure modules: no database,
// no network, no secrets). The repo's test build does not compile .tsx, so page / component wording is checked from source,
// the same way the other dashboard tests do it.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");

const NEW_PAGE = "app/dashboard/advertiser/campaigns/new/page.tsx";
const DETAIL_PAGE = "app/dashboard/advertiser/campaigns/[id]/page.tsx";
const DEMO_FORM = "components/dashboard/CreateCampaignForm.tsx";
const NOTE = "components/campaigns/DeliveryNote.tsx";

const TODAY = "2026-11-02";
const base: DeliveryInput = {
  status: "active",
  startDate: "2026-10-01",
  endDate: null,
  totalBudget: 100,
  dailyBudget: 10,
  approvedCreatives: 1,
  spentTotal: 5,
  spentToday: 1,
  todayUtc: TODAY,
  advertiserActive: true,
};

// Words that would promise delivery. Guidance may say "does not guarantee", never "will be shown" and similar.
const PROMISE = /\b(ads?|campaigns?) will (be shown|show|serve|run|go live|start)|goes? live (immediately|instantly)|instantly|guaranteed (delivery|impressions|clicks)|you will (get|receive) (impressions|clicks)/i;

describe("day 29 part 3: delivery states are explained without promising delivery", () => {
  it("every campaign that is not active is not eligible, with its own message", () => {
    for (const s of CAMPAIGN_STATUSES.filter((x) => x !== "active")) {
      const d = deliveryState({ ...base, status: s });
      assert.equal(d.serving, false, s);
      assert.equal(d.reason, "campaign_not_active", s);
      assert.equal(d.message, NOT_ACTIVE_MESSAGES[s as Exclude<CampaignDbStatus, "active">], s);
    }
  });

  it("each blocker makes an active campaign not eligible", () => {
    const cases: [Partial<DeliveryInput>, keyof typeof DELIVERY_MESSAGES][] = [
      [{ advertiserActive: false }, "advertiser_not_active"],
      [{ endDate: "2026-11-01" }, "ended"],
      [{ startDate: "2026-11-03" }, "not_started"],
      [{ approvedCreatives: 0 }, "no_approved_creative"],
      [{ spentTotal: 100 }, "total_budget_used"],
      [{ spentToday: 10 }, "daily_budget_used"],
    ];
    for (const [over, reason] of cases) {
      const d = deliveryState({ ...base, ...over });
      assert.equal(d.serving, false, reason);
      assert.equal(d.reason, reason, reason);
      assert.equal(d.message, DELIVERY_MESSAGES[reason], reason);
    }
  });

  it("only an active, in-schedule campaign with an approved ad and budget left is eligible", () => {
    const d = deliveryState(base);
    assert.equal(d.serving, true);
    assert.equal(d.reason, null);
    assert.equal(d.message, SERVING_MESSAGE);
    assert.match(d.message, /^Eligible/);
  });

  it("no state message promises that ads will be shown", () => {
    for (const m of [...Object.values(NOT_ACTIVE_MESSAGES), ...Object.values(DELIVERY_MESSAGES), SERVING_MESSAGE]) {
      assert.doesNotMatch(m, PROMISE, m);
    }
    for (const m of Object.values(NOT_ACTIVE_MESSAGES)) assert.match(m, /^Not showing ads/, m);
  });

  it("DeliveryNote has help text for every delivery state and shows it only in the full (not compact) view", () => {
    const src = read(NOTE);
    for (const key of ["serving", ...Object.keys(DELIVERY_MESSAGES), "campaign_not_active"]) {
      assert.match(src, new RegExp(`\\b${key}:\\s*\\n?\\s*"`), `help for ${key}`);
    }
    assert.match(src, /!compact && helpKey \? DELIVERY_HELP\[helpKey\] : null/);
    assert.match(src, /\{state\.message\}/);
    assert.match(src, /data-delivery=\{state\.serving \? "serving" : state\.reason \?\? "blocked"\}/);
    assert.match(src, /does not guarantee ads/);
    assert.match(src, /Only active campaigns can show ads/);
    assert.doesNotMatch(code(src), PROMISE);
  });

  it("DeliveryNote only displays: no database, action, fetch or status writes", () => {
    const src = code(read(NOTE));
    assert.doesNotMatch(src, /supabase|@\/app\/|actions|fetch\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(|useState|useEffect/);
    assert.match(src, /import type \{ DeliveryReason, DeliveryState \} from "@\/lib\/campaigns\/delivery"/);
  });
});

describe("day 29 part 3: new campaign page guidance", () => {
  const src = read(NEW_PAGE);

  it("covers category, ad content, destination URL, budget and status", () => {
    for (const title of ["Category", "Ad content", "Destination URL", "Budget", "Status"]) {
      assert.match(src, new RegExp(`title: "${title}"`), title);
    }
    assert.match(src, /secure https link/);
    assert.match(src, /draft or rejected/);
    assert.match(src, /Sponsored label/);
    assert.match(src, /not live/);
    assert.match(src, /after our team approves it and at least one ad/);
    assert.match(src, /Approval does not guarantee that ads are shown/);
  });

  it("budget numbers come from the real constants, not typed copies", () => {
    assert.match(src, /MIN_TOTAL_BUDGET\.toFixed\(2\)/);
    assert.match(src, /MIN_DAILY_BUDGET\.toFixed\(2\)/);
    assert.match(src, /cannot be lowered below what is already spent/);
    assert.equal(MIN_TOTAL_BUDGET, 1);
    assert.equal(MIN_DAILY_BUDGET, 0.5);
  });

  it("does not promise delivery and keeps the existing route behavior", () => {
    assert.doesNotMatch(code(src), PROMISE);
    assert.match(src, /requireRole\(\["advertiser"\]\)/);
    assert.match(src, /loadMyAdvertiser\(\)/);
    assert.match(src, /throw new Error\("Advertiser could not be loaded"\)/);
    assert.match(src, /New campaigns start as drafts\. A draft is saved but not live\./);
    assert.match(src, /adv && adv\.status !== "active"/);
    assert.match(src, /action=\{createCampaign\}/);
    assert.match(src, /minStartDate=\{minStartDateForNew\(utcToday\(\)\)\}/);
    // Guidance sits inside the "advertiser is active" branch, so an inactive advertiser still only sees the notice.
    assert.ok(src.indexOf('adv.status === "active"') < src.indexOf("launch-guidance-title"));
  });
});

describe("day 29 part 3: demo create form guidance (validation unchanged)", () => {
  const src = read(DEMO_FORM);

  it("explains category, budget, ad content, destination URL and status in short text", () => {
    assert.match(src, /id="cc-category-hint"/);
    assert.match(src, /cc-category-error cc-category-hint/);
    assert.match(src, /MIN_TOTAL_BUDGET\.toFixed\(2\)/);
    assert.match(src, /Ad content and the destination URL are not part of this form/);
    assert.match(src, /secure https link/);
    assert.match(src, /starts as a draft and can show ads only after review and approval/);
    assert.match(src, /never reviewed or live/);
    assert.doesNotMatch(code(src), PROMISE);
  });

  it("still a local demo: nothing is saved or sent, and the demo warning stays", () => {
    assert.match(src, /It is not saved and no ads are delivered\./);
    assert.doesNotMatch(code(src), /fetch\(|supabase|actions|createCampaign|\.from\(|\.insert\(|\.rpc\(/);
  });

  it("existing field checks are untouched", () => {
    assert.match(src, /const MAX_BUDGET = 1_000_000;/);
    assert.match(src, /Enter a campaign name\./);
    assert.match(src, /Use at least 3 characters\./);
    assert.match(src, /Use 60 characters or fewer\./);
    assert.match(src, /Choose a category\./);
    assert.match(src, /Enter a budget\./);
    assert.match(src, /Budget must be more than 0\./);
    assert.match(src, /Demo budgets can be up to 1,000,000\./);
    assert.match(src, /onCreate\(value\)/);
  });
});

describe("day 29 part 3: campaign detail page shows status and next step only", () => {
  const src = read(DETAIL_PAGE);
  const body = code(src);

  it("has a next step for every existing campaign status", () => {
    assert.match(src, /function nextStep\(c: NextStepInput\)/);
    for (const s of CAMPAIGN_STATUSES) assert.match(src, new RegExp(`case "${s}":`), s);
    assert.match(src, /\{STATUS_HELP\[campaign\.status\]\}/);
    assert.match(src, /data-next-step/);
    assert.match(src, /Next step:/);
    assert.doesNotMatch(body, PROMISE);
  });

  it("next step points to existing sections and never starts a transition", () => {
    assert.match(src, /Review section below/);
    assert.doesNotMatch(body, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(|createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/);
    assert.doesNotMatch(body, /status:\s*"(draft|pending_review|active|paused|completed|rejected|archived)"/);
    assert.doesNotMatch(body, /from "\.\.\/actions"|from "\.\.\/creative-actions"/);
  });

  it("buttons and checks that decide what the advertiser can do are unchanged", () => {
    assert.match(src, /const showEdit = canChange && !locked;/);
    assert.match(src, /const showPause = canChange && canPause\(campaign\.status\);/);
    assert.match(src, /const showResume = canChange && campaign\.status === "paused" && resumeCheck\.ok;/);
    assert.match(src, /checkResume\(campaign, creatives \? creatives\.approved : null, today, spend \? spend\.spentTotal : null\)/);
    assert.match(src, /const reviewAction = canChange \? reviewActionFor\(campaign\.status\) : null;/);
    assert.match(src, /const submitCheck = checkSubmitCampaign\(campaign, reviewable, today\);/);
    assert.match(src, /const showReview = reviewAction !== null && \(reviewAction !== "submit" \|\| submitCheck\.ok\);/);
    assert.match(src, /deliveryState\(/);
    assert.match(src, /<DeliveryNote state=\{delivery\} \/>/);
    assert.match(src, /advertiserActive: adv\.status === "active"/);
    assert.match(src, /if \(!campaign\) notFound\(\)/);
    assert.match(src, /label="Budget left"|<Row label="Budget left">/);
    assert.match(src, /<CampaignPerformancePanel performance=\{performance\} \/>/);
  });
});

describe("day 29 part 3: campaign rules and status transitions are not bypassed", () => {
  it("advertiser review transitions are exactly the three existing ones", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(REVIEW_ACTIONS).map(([k, v]) => [k, [v.from, v.to]])),
      { submit: ["draft", "pending_review"], withdraw: ["pending_review", "draft"], reopen: ["rejected", "draft"] },
    );
    const withAction = CAMPAIGN_STATUSES.filter((s) => reviewActionFor(s) !== null);
    assert.deepEqual([...withAction], ["draft", "pending_review", "rejected"]);
    // Nobody reaches "active" from the advertiser side: approval stays with the admin.
    assert.ok(Object.values(REVIEW_ACTIONS).every((a) => a.to !== "active"));
  });

  it("submit, pause and resume checks still block what they blocked before", () => {
    assert.deepEqual(checkSubmitCampaign({ endDate: "2026-11-01" }, 1, TODAY), { ok: false, reason: "ended" });
    assert.deepEqual(checkSubmitCampaign({ endDate: null }, 0, TODAY), { ok: false, reason: "no_creative" });
    assert.deepEqual(checkSubmitCampaign({ endDate: null }, 1, TODAY), { ok: true });
    assert.equal(canPause("active"), true);
    for (const s of CAMPAIGN_STATUSES.filter((x) => x !== "active")) assert.equal(canPause(s), false, s);
    const paused = { status: "paused" as const, endDate: null, totalBudget: 100 };
    assert.deepEqual(checkResume({ ...paused, status: "active" }, 1, TODAY, 0), { ok: false, reason: "not_paused" });
    assert.deepEqual(checkResume({ ...paused, endDate: "2026-11-01" }, 1, TODAY, 0), { ok: false, reason: "ended" });
    assert.deepEqual(checkResume(paused, 0, TODAY, 0), { ok: false, reason: "no_approved_creative" });
    assert.deepEqual(checkResume(paused, 1, TODAY, 100), { ok: false, reason: "budget_used" });
    assert.deepEqual(checkResume(paused, 1, TODAY, 5), { ok: true });
  });

  it("budget limits, edit locks and category rules keep their values", () => {
    assert.equal(MIN_TOTAL_BUDGET, 1);
    assert.equal(MIN_DAILY_BUDGET, 0.5);
    assert.equal(MAX_BUDGET, 10_000_000);
    assert.deepEqual([...EDIT_LOCKED_STATUSES], ["pending_review", "completed", "archived"]);
    assert.deepEqual([...CATEGORY_EDITABLE_STATUSES], ["draft", "rejected"]);
    assert.deepEqual([...CAMPAIGN_STATUSES], ["draft", "pending_review", "active", "paused", "completed", "rejected", "archived"]);
  });

  it("status help text still ties 'active' to an approved ad, dates and budget", () => {
    assert.match(STATUS_HELP.active, /approved ad/);
    assert.match(STATUS_HELP.active, /budget/);
    assert.match(STATUS_HELP.draft, /Not live yet/);
  });

  it("this part changes no rule file, SQL or migration (guidance files only touch UI text)", () => {
    for (const f of [NEW_PAGE, DETAIL_PAGE, DEMO_FORM, NOTE]) {
      assert.doesNotMatch(code(read(f)), /create table|alter table|create or replace function|record_ad_serve|ad_ledger|payout/i, f);
    }
  });
});
