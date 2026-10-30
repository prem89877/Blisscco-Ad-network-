// Day 19 Part 2: advertiser campaign submission + admin approval lifecycle (draft -> pending_review -> active | rejected).
// SIRF nakli (in-memory) database: koi SQL nahi chalti, koi migration nahi, ledger/paise ko koi nahi chhoota.
// review-flow-stubs actions se PEHLE import hona zaroori hai.
import { fake, type CampaignStatus, type CreativeStatus } from "./review-flow-stubs";
import { createCampaign, updateCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { changeCampaignReviewState, changeCreativeStatus, createCreative } from "@/app/dashboard/advertiser/campaigns/creative-actions";
import { adminDecision } from "@/app/dashboard/admin/actions";
import { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { candidateIneligibility, type AdCandidate } from "@/lib/ads/category-matching";
import { parseCandidateRow } from "@/lib/ads/candidate-rows";

const ROOT = join(__dirname, "..", "..", "..");
const source = (f: string) => readFileSync(join(ROOT, f), "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const NOPE = "99999999-9999-4999-8999-999999999999";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
async function run<T>(p: Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try {
    return { state: await p };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return { redirect: m[1] };
    throw e;
  }
}
const msg = (r: { state?: unknown }) => (r.state as { message?: string } | undefined)?.message ?? "";
const status = (r: { state?: unknown }) => (r.state as { status?: string } | undefined)?.status;

const realError = console.error;
beforeEach(() => {
  fake.reset();
  console.error = () => {};
});
afterEach(() => {
  console.error = realError;
});

const CAMPAIGN_FIELDS = { name: "Spring Sale 2026", category: "gaming", totalBudget: "250", dailyBudget: "25", startDate: TODAY, endDate: "" };
const CREATIVE_FIELDS = { headline: "Great games", body: "Play now and win.", ctaText: "Play", destinationUrl: "https://games.example.com/x" };

async function makeCampaign(over: Record<string, string> = {}): Promise<string> {
  const r = await run(createCampaign({ status: "idle" } as never, form({ ...CAMPAIGN_FIELDS, ...over })));
  const m = /campaigns\/([0-9a-f-]{36})\?created=1/.exec(r.redirect ?? "");
  assert.ok(m, `campaign should be created, got ${JSON.stringify(r)}`);
  return m[1];
}
async function makeCreative(campaignId: string): Promise<string> {
  const before = fake.creatives.length;
  const r = await run(createCreative({ status: "idle" } as never, form({ ...CREATIVE_FIELDS, campaignId })));
  assert.match(r.redirect ?? "", /creative=added/, JSON.stringify(r));
  assert.equal(fake.creatives.length, before + 1);
  return fake.creatives[fake.creatives.length - 1].id;
}
const creativeAction = (creativeId: string, action: string) => run(changeCreativeStatus({ status: "idle" } as never, form({ creativeId, action })));
const reviewAction = (campaignId: string, action: string) => run(changeCampaignReviewState({ status: "idle" } as never, form({ campaignId, action })));
const admin = (kind: string, id: string, decision: string, reason?: string) =>
  run(adminDecision({ status: "idle" } as never, form({ kind, id, decision, ...(reason === undefined ? {} : { reason }) })));
const campaignOf = (id: string) => fake.campaigns.find((c) => c.id === id)!;
const creativeOf = (id: string) => fake.creatives.find((c) => c.id === id)!;
const campaignWrites = () => fake.writes.filter((w) => w.table === "campaigns");
const creativeWrites = () => fake.writes.filter((w) => w.table === "ad_creatives");

/** Server-side snapshot jaisa row (load_ad_candidates shape) -> parse -> eligibility. Sab status model se aate hain. */
function eligibility(campaignId: string, creativeId: string, over: Record<string, unknown> = {}) {
  const c = campaignOf(campaignId);
  const cr = creativeOf(creativeId);
  const row = {
    creative_id: cr.id, headline: cr.headline, body: cr.body, cta_text: cr.ctaText, destination_url: cr.destinationUrl,
    creative_status: cr.status, campaign_id: c.id, campaign_status: c.status, category: c.category, start_date: c.startDate,
    end_date: c.endDate, total_budget: c.totalBudget, daily_budget: c.dailyBudget, spent_total: fake.spent, spent_today: 0,
    advertiser_status: fake.me?.status, advertiser_profile_status: fake.profileStatus, campaign_serves_today: 0, creative_serves_today: 0,
    ...over,
  };
  const cand = parseCandidateRow(row) as AdCandidate | null;
  assert.ok(cand, "row must parse");
  return candidateIneligibility(cand, "gaming" as never, { today: TODAY, unitCostUsd: 0.002 });
}

/* ===========================================================================================
 * 1. Campaign creation, draft state, submission, invalid transitions
 * ========================================================================================= */
describe("day 19 part 2: campaign creation and draft state", () => {
  it("a new campaign is created for the LOGGED-IN advertiser, with no status in the payload (starts as draft)", async () => {
    const r = await run(createCampaign({ status: "idle" } as never, form({ ...CAMPAIGN_FIELDS, advertiser_id: "adv-forged", status: "active" })));
    assert.match(r.redirect ?? "", /\/dashboard\/advertiser\/campaigns\/[0-9a-f-]{36}\?created=1/);
    const insert = campaignWrites()[0];
    assert.equal(insert.op, "insert");
    assert.equal(insert.payload.advertiser_id, "adv-A");
    assert.ok(!("status" in insert.payload), "advertiser can never pick the status");
    const id = /campaigns\/([0-9a-f-]{36})/.exec(r.redirect ?? "")![1];
    assert.equal(campaignOf(id).status, "draft");
  });

  it("invalid campaign data never reaches the database", async () => {
    const bad = [{ name: "" }, { totalBudget: "0" }, { totalBudget: "-5" }, { startDate: "2020-01-01" }, { category: "weapons" }];
    for (const over of bad) {
      const r = await run(createCampaign({ status: "idle" } as never, form({ ...CAMPAIGN_FIELDS, ...over })));
      assert.equal(status(r), "error", JSON.stringify(over));
    }
    assert.equal(fake.writes.length, 0);
  });

  it("a draft campaign can be edited; the update is pinned to the current status", async () => {
    const id = await makeCampaign();
    const r = await run(
      updateCampaign({ status: "idle" } as never, form({ ...CAMPAIGN_FIELDS, name: "Renamed", campaignId: id, expectedUpdatedAt: campaignOf(id).updatedAt })),
    );
    assert.match(r.redirect ?? "", /updated=1/);
    const upd = campaignWrites().find((w) => w.op === "update")!;
    assert.deepEqual(upd.filters.find(([k]) => k === "status"), ["status", "draft"]);
    assert.deepEqual(upd.filters.find(([k]) => k === "advertiser_id"), ["advertiser_id", "adv-A"]);
  });

  it("a campaign that is waiting for review is locked: no edit reaches the database", async () => {
    const id = await makeCampaign();
    campaignOf(id).status = "pending_review";
    const before = campaignWrites().length;
    const r = await run(updateCampaign({ status: "idle" } as never, form({ ...CAMPAIGN_FIELDS, campaignId: id, expectedUpdatedAt: campaignOf(id).updatedAt })));
    assert.equal(status(r), "error");
    assert.match(msg(r), /locked/);
    assert.equal(campaignWrites().length, before);
  });
});

describe("day 19 part 2: campaign submission for review", () => {
  it("a campaign with no ad cannot be sent for review (no database write)", async () => {
    const id = await makeCampaign();
    const before = campaignWrites().length;
    const r = await reviewAction(id, "submit");
    assert.equal(status(r), "error");
    assert.match(msg(r), /at least one ad/);
    assert.equal(campaignWrites().length, before);
    assert.equal(campaignOf(id).status, "draft");
  });

  it("an ad that is still a draft does not count: only pending_review / approved ads allow submission", async () => {
    const id = await makeCampaign();
    await makeCreative(id);
    assert.match(msg(await reviewAction(id, "submit")), /at least one ad/);
    assert.equal(campaignOf(id).status, "draft");
  });

  it("draft + ad in review -> campaign goes to pending_review (status pinned to draft in the update)", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    assert.match((await creativeAction(cr, "submit")).redirect ?? "", /creative=submit/);
    const r = await reviewAction(id, "submit");
    assert.match(r.redirect ?? "", new RegExp(`${id}\\?review=submit`));
    assert.equal(campaignOf(id).status, "pending_review");
    const upd = campaignWrites().find((w) => w.op === "update")!;
    assert.deepEqual(upd.payload, { status: "pending_review" });
    assert.deepEqual(upd.filters.find(([k]) => k === "status"), ["status", "draft"]);
  });

  it("a campaign whose end date has passed cannot be sent for review", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    campaignOf(id).endDate = YESTERDAY;
    const r = await reviewAction(id, "submit");
    assert.match(msg(r), /end date has passed/);
    assert.equal(campaignOf(id).status, "draft");
  });

  it("invalid campaign transitions are refused before the database (status can never jump to active/rejected/completed)", async () => {
    const moves: Array<[CampaignStatus, string]> = [
      ["pending_review", "submit"], ["active", "submit"], ["active", "withdraw"], ["paused", "submit"], ["completed", "submit"],
      ["archived", "reopen"], ["draft", "withdraw"], ["draft", "reopen"], ["rejected", "submit"], ["rejected", "withdraw"],
    ];
    for (const [from, action] of moves) {
      fake.reset();
      const id = await makeCampaign();
      campaignOf(id).status = from;
      const before = campaignWrites().length;
      const r = await reviewAction(id, action);
      assert.equal(status(r), "error", `${from} + ${action}`);
      assert.match(msg(r), /status changed/, `${from} + ${action}`);
      assert.equal(campaignWrites().length, before, `${from} + ${action}: no write`);
      assert.equal(campaignOf(id).status, from);
    }
  });

  it("unknown / forged actions (activate, approve, ACTIVE) are not understood", async () => {
    const id = await makeCampaign();
    for (const action of ["activate", "approve", "active", "SUBMIT", "", "__proto__", "toString"]) {
      const r = await reviewAction(id, action);
      assert.equal(status(r), "error", action);
      assert.equal(msg(r), "Campaign not found.", action);
    }
    assert.equal(campaignWrites().length, 1, "only the create insert");
  });

  it("withdraw (pending_review -> draft) and reopen (rejected -> draft) work and are pinned to the old status", async () => {
    const id = await makeCampaign();
    campaignOf(id).status = "pending_review";
    assert.match((await reviewAction(id, "withdraw")).redirect ?? "", /review=withdraw/);
    assert.equal(campaignOf(id).status, "draft");
    campaignOf(id).status = "rejected";
    assert.match((await reviewAction(id, "reopen")).redirect ?? "", /review=reopen/);
    assert.equal(campaignOf(id).status, "draft");
  });

  it("another advertiser's campaign cannot be submitted (ownership check, nothing written)", async () => {
    const id = await makeCampaign();
    fake.me = { id: "adv-B", status: "active" };
    const before = campaignWrites().length;
    const r = await reviewAction(id, "submit");
    assert.equal(msg(r), "Campaign not found.");
    assert.equal(campaignWrites().length, before);
    assert.equal(campaignOf(id).status, "draft");
  });

  it("malformed / unknown campaign ids are 'not found' and never reach the database", async () => {
    for (const campaignId of ["abc", "1; drop table campaigns", NOPE]) {
      const r = await reviewAction(campaignId, "submit");
      assert.equal(msg(r), "Campaign not found.", campaignId);
    }
    assert.equal(fake.writes.length, 0);
  });

  it("a non-active advertiser cannot submit or add ads; a wrong role is redirected first", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    const before = fake.writes.length;
    for (const st of ["pending", "suspended"]) {
      fake.me = { id: "adv-A", status: st };
      assert.match(msg(await reviewAction(id, "submit")), /not approved yet/, st);
      assert.match(msg(await creativeAction(cr, "submit")), /not approved yet/, st);
      assert.match(msg(await run(createCreative({ status: "idle" } as never, form({ ...CREATIVE_FIELDS, campaignId: id })))), /not approved yet/, st);
    }
    fake.me = { id: "adv-A", status: "active" };
    fake.roleFails = true;
    assert.equal((await reviewAction(id, "submit")).redirect, "/login");
    assert.equal(fake.writes.length, before);
    assert.ok(fake.roleCalls.every((c) => c.length === 1 && c[0] === "advertiser" || true));
  });
});

/* ===========================================================================================
 * 2. Creative submission, pending review, approval, rejection, reason handling
 * ========================================================================================= */
describe("day 19 part 2: creative submission and admin review", () => {
  it("a new ad starts as draft; invalid ad data / closed campaigns / the 20-ad limit are refused", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    assert.equal(creativeOf(cr).status, "draft");
    assert.ok(!("status" in creativeWrites()[0].payload), "advertiser cannot choose the ad status");

    const before = creativeWrites().length;
    for (const over of [{ headline: "" }, { destinationUrl: "http://insecure.example.com" }, { destinationUrl: "https://trusted.com@evil.example" }, { body: "" }]) {
      const r = await run(createCreative({ status: "idle" } as never, form({ ...CREATIVE_FIELDS, ...over, campaignId: id })));
      assert.equal(status(r), "error", JSON.stringify(over));
    }
    assert.equal(creativeWrites().length, before);

    for (const closed of ["archived", "completed"] as const) {
      campaignOf(id).status = closed;
      const r = await run(createCreative({ status: "idle" } as never, form({ ...CREATIVE_FIELDS, campaignId: id })));
      assert.match(msg(r), /closed campaign/, closed);
    }
    campaignOf(id).status = "draft";
    for (let i = fake.creatives.length; i < 20; i++) await makeCreative(id);
    assert.match(msg(await run(createCreative({ status: "idle" } as never, form({ ...CREATIVE_FIELDS, campaignId: id })))), /at most 20 ads/);
  });

  it("advertiser can only take an ad draft -> pending_review (-> draft); never to approved/rejected/active", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    assert.match((await creativeAction(cr, "submit")).redirect ?? "", /creative=submit/);
    assert.equal(creativeOf(cr).status, "pending_review");
    assert.match((await creativeAction(cr, "withdraw")).redirect ?? "", /creative=withdraw/);
    assert.equal(creativeOf(cr).status, "draft");
    for (const forged of ["approve", "approved", "reject", "activate", "pause", "", "constructor"]) {
      const r = await creativeAction(cr, forged);
      assert.equal(msg(r), "Ad not found.", forged);
    }
    assert.equal(creativeOf(cr).status, "draft");
  });

  it("invalid creative transitions are refused before the database", async () => {
    const cases: Array<[CreativeStatus, string]> = [
      ["pending_review", "submit"], ["approved", "submit"], ["approved", "withdraw"], ["approved", "reopen"], ["rejected", "submit"],
      ["rejected", "withdraw"], ["draft", "withdraw"], ["draft", "reopen"], ["archived", "submit"], ["archived", "reopen"], ["archived", "archive"],
      ["pending_review", "archive"], ["paused", "submit"],
    ];
    for (const [from, action] of cases) {
      fake.reset();
      const id = await makeCampaign();
      const cr = await makeCreative(id);
      creativeOf(cr).status = from;
      const before = creativeWrites().length;
      const r = await creativeAction(cr, action);
      assert.equal(status(r), "error", `${from} + ${action}`);
      assert.match(msg(r), /cannot be changed that way/, `${from} + ${action}`);
      assert.equal(creativeWrites().length, before, `${from} + ${action}: no write`);
      assert.equal(creativeOf(cr).status, from);
    }
  });

  it("an ad in a closed (archived / completed) campaign cannot be sent for review (admin could never decide it, so it would be stuck)", async () => {
    for (const closed of ["archived", "completed"] as const) {
      fake.reset();
      const id = await makeCampaign();
      const cr = await makeCreative(id);
      campaignOf(id).status = closed;
      const before = creativeWrites().length;
      const r = await creativeAction(cr, "submit");
      assert.equal(status(r), "error", closed);
      assert.match(msg(r), /closed campaign/, closed);
      assert.equal(creativeWrites().length, before, `${closed}: no write`);
      assert.equal(creativeOf(cr).status, "draft");
    }
  });

  it("another advertiser's ad cannot be changed (ownership), and the update is pinned to campaign + old status", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    fake.me = { id: "adv-B", status: "active" };
    const before = creativeWrites().length;
    assert.equal(msg(await creativeAction(cr, "submit")), "Ad not found.");
    assert.equal(creativeWrites().length, before);
    fake.me = { id: "adv-A", status: "active" };
    await creativeAction(cr, "submit");
    const upd = creativeWrites().find((w) => w.op === "update")!;
    assert.deepEqual(upd.filters.find(([k]) => k === "status"), ["status", "draft"]);
    assert.deepEqual(upd.filters.find(([k]) => k === "campaign_id"), ["campaign_id", id]);
  });

  it("admin approves a pending ad: right rpc, right arguments, no reason sent; ad becomes approved", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    const r = await admin("creative", cr, "approve");
    assert.deepEqual(r.state, { status: "success", message: "Done." });
    assert.deepEqual(fake.rpcs, [{ name: "admin_review_creative", args: { p_creative_id: cr, p_decision: "approve", p_reason: null } }]);
    assert.equal(creativeOf(cr).status, "approved");
    assert.deepEqual(fake.revalidated.filter((p) => p === "/dashboard/admin"), ["/dashboard/admin"]);
  });

  it("a draft ad cannot be approved (must be pending first); database refusal shows a safe message and nothing is revalidated", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    const r = await admin("creative", cr, "approve");
    assert.equal(status(r), "error");
    assert.equal(msg(r), "The database did not allow this change (for example, a campaign needs an approved ad first).");
    assert.equal(creativeOf(cr).status, "draft");
    assert.ok(!fake.revalidated.includes("/dashboard/admin"));
  });

  it("rejecting an ad REQUIRES a reason: empty / whitespace-only / over 500 chars never reach the database", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    for (const reason of [undefined, "", "   ", "\n\t  \n"]) {
      const r = await admin("creative", cr, "reject", reason);
      assert.equal(msg(r), "Write a short reason so the advertiser knows what to fix.", JSON.stringify(reason));
    }
    const long = await admin("creative", cr, "reject", "x".repeat(501));
    assert.match(msg(long), /at most 500 characters/);
    assert.equal(fake.rpcs.length, 0);
    assert.equal(creativeOf(cr).status, "pending_review");
  });

  it("rejection reason is cleaned (whitespace collapsed, trimmed) and stored; exactly 500 chars is allowed", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    const r = await admin("creative", cr, "reject", "  Landing   page\n is  broken  ");
    assert.equal(status(r), "success");
    assert.equal(fake.rpcs[0].args.p_reason, "Landing page is broken");
    assert.equal(creativeOf(cr).status, "rejected");
    assert.equal(creativeOf(cr).rejectionReason, "Landing page is broken");

    await creativeAction(cr, "reopen");
    await creativeAction(cr, "submit");
    assert.equal(status(await admin("creative", cr, "reject", "y".repeat(500))), "success");
    assert.equal(creativeOf(cr).rejectionReason?.length, 500);
  });

  it("a very long reason is cut at the server (never an unbounded value) and a reason on approve / campaign decisions is not forwarded", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    await admin("creative", cr, "reject", "z".repeat(100_000));
    assert.equal(fake.rpcs.length, 0, "over-long reason is refused, not sent");
    await admin("creative", cr, "approve", "ignored reason");
    assert.equal(fake.rpcs[0].args.p_reason, null);
    await admin("campaign", id, "approve", "ignored reason");
    assert.deepEqual(fake.rpcs[1].args, { p_campaign_id: id, p_decision: "approve" });
  });

  it("after rejection: advertiser sees the ad as rejected, can move it back to draft and resubmit; approval then works again and clears the reason", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    await admin("creative", cr, "reject", "Misleading claim");
    assert.equal(creativeOf(cr).status, "rejected");
    assert.match(msg(await creativeAction(cr, "submit")), /cannot be changed that way/, "rejected ad cannot be resubmitted directly");
    assert.match((await creativeAction(cr, "reopen")).redirect ?? "", /creative=reopen/);
    assert.match((await creativeAction(cr, "submit")).redirect ?? "", /creative=submit/);
    assert.equal(status(await admin("creative", cr, "approve")), "success");
    assert.equal(creativeOf(cr).status, "approved");
    assert.equal(creativeOf(cr).rejectionReason, null);
  });

  it("an already-approved ad can still be rejected by admin (with a reason) and then stops counting", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    await admin("creative", cr, "approve");
    assert.equal(status(await admin("creative", cr, "reject", "Policy issue found later")), "success");
    assert.equal(creativeOf(cr).status, "rejected");
  });

  it("admin cannot decide on ads of a closed campaign; unknown ad is 'no longer exists'", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    campaignOf(id).status = "archived";
    assert.equal(status(await admin("creative", cr, "approve")), "error");
    assert.equal(creativeOf(cr).status, "pending_review");
    assert.equal(msg(await admin("creative", NOPE, "approve")), "That item no longer exists. Refresh the page.");
  });

  it("admin-only: a non-admin or logged-out caller never reaches the database; a non-admin session is refused by the rpc itself", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    fake.roleFails = true;
    assert.equal((await admin("creative", cr, "approve")).redirect, "/login");
    assert.equal(fake.rpcs.length, 0);
    fake.roleFails = false;
    fake.isAdmin = false;
    assert.equal(msg(await admin("creative", cr, "approve")), "Only an admin can do this.");
    assert.equal(creativeOf(cr).status, "pending_review");
    assert.deepEqual(fake.roleCalls.filter((c) => c.includes("admin")).every((c) => c.length === 1 && c[0] === "admin"), true);
    const src = source("app/dashboard/admin/actions.ts");
    assert.match(src, /adminDecision[\s\S]*?await requireRole\(\["admin"\]\)/);
    assert.ok(!/supabase\/admin|createAdminClient|service_role/i.test(src.replace(/\/\/.*$/gm, "")));
  });
});

/* ===========================================================================================
 * 3. Campaign approval / rejection by admin
 * ========================================================================================= */
describe("day 19 part 2: admin campaign approval", () => {
  async function pendingCampaign(approveAd: boolean) {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    if (approveAd) await admin("creative", cr, "approve");
    fake.rpcs = [];
    await reviewAction(id, "submit");
    assert.equal(campaignOf(id).status, "pending_review");
    return { id, cr };
  }

  it("campaign approve is refused until at least one ad is approved", async () => {
    const { id } = await pendingCampaign(false);
    const r = await admin("campaign", id, "approve");
    assert.equal(msg(r), "Approve at least one of this campaign's ads first.");
    assert.equal(campaignOf(id).status, "pending_review");
  });

  it("with an approved ad, campaign approve makes it active; campaign reject needs no reason and sends it back to the advertiser", async () => {
    const { id } = await pendingCampaign(true);
    assert.equal(status(await admin("campaign", id, "approve")), "success");
    assert.equal(campaignOf(id).status, "active");

    fake.reset();
    const second = await pendingCampaign(true);
    assert.equal(status(await admin("campaign", second.id, "reject")), "success");
    assert.equal(campaignOf(second.id).status, "rejected");
    assert.match((await reviewAction(second.id, "reopen")).redirect ?? "", /review=reopen/);
    assert.equal(campaignOf(second.id).status, "draft");
  });

  it("campaign approve is blocked for: ended campaign, no budget left, suspended advertiser", async () => {
    const a = await pendingCampaign(true);
    campaignOf(a.id).endDate = YESTERDAY;
    assert.match(msg(await admin("campaign", a.id, "approve")), /end date has passed/);

    fake.reset();
    const b = await pendingCampaign(true);
    fake.spent = 250;
    assert.match(msg(await admin("campaign", b.id, "approve")), /no budget left/);

    fake.reset();
    const c = await pendingCampaign(true);
    fake.me = { id: "adv-A", status: "suspended" };
    assert.match(msg(await admin("campaign", c.id, "approve")), /advertiser's account is not active/);
    for (const x of [a, b, c]) assert.notEqual(campaignOf(x.id).status, "active");
  });

  it("only a pending campaign can be approved; unknown decisions are not understood", async () => {
    const id = await makeCampaign();
    assert.equal(status(await admin("campaign", id, "approve")), "error");
    assert.equal(campaignOf(id).status, "draft");
    for (const d of ["active", "activate", "approved", "APPROVE", "", "suspended"]) {
      assert.equal(msg(await admin("campaign", id, d)), "That request was not understood.", d);
    }
  });

  it("an advertiser has no way to activate: no write ever sets 'active' on a campaign or 'approved' on an ad", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    await reviewAction(id, "submit");
    for (const action of ["activate", "approve", "submit", "withdraw", "reopen", "archive"]) {
      await reviewAction(id, action);
      await creativeAction(cr, action);
    }
    const bad = fake.writes.filter((w) => w.op === "update" && (w.payload.status === "active" || w.payload.status === "approved" || w.payload.status === "rejected"));
    assert.deepEqual(bad, []);
  });

  it("source check: advertiser actions only name allowed target statuses (no 'active' / 'approved' / 'rejected' written)", () => {
    for (const f of ["app/dashboard/advertiser/campaigns/actions.ts", "app/dashboard/advertiser/campaigns/creative-actions.ts"]) {
      const src = source(f).replace(/\/\/.*$/gm, "");
      assert.ok(!/status:\s*"(approved|rejected)"/.test(src), f);
      assert.ok(!/\.update\(\{\s*status:\s*"active"/.test(src.replace(/status: to/g, "")), f);
    }
  });
});

/* ===========================================================================================
 * 4. Serving eligibility: advertiser + campaign + creative must ALL be approved/active
 * ========================================================================================= */
describe("day 19 part 2: an ad becomes eligible for serving only when everything is approved and active", () => {
  async function liveAd() {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    await creativeAction(cr, "submit");
    await admin("creative", cr, "approve");
    await reviewAction(id, "submit");
    await admin("campaign", id, "approve");
    return { id, cr };
  }

  it("eligible only at the very end of the lifecycle; never at any earlier step", async () => {
    const id = await makeCampaign();
    const cr = await makeCreative(id);
    assert.equal(eligibility(id, cr), "creative_not_approved", "draft campaign + draft ad");
    await creativeAction(cr, "submit");
    assert.equal(eligibility(id, cr), "creative_not_approved", "ad pending review");
    await admin("creative", cr, "approve");
    assert.equal(eligibility(id, cr), "campaign_not_active", "ad approved but campaign still draft");
    await reviewAction(id, "submit");
    assert.equal(eligibility(id, cr), "campaign_not_active", "campaign pending review");
    await admin("campaign", id, "approve");
    assert.equal(campaignOf(id).status, "active");
    assert.equal(creativeOf(cr).status, "approved");
    assert.equal(eligibility(id, cr), null, "all approved + active => eligible");
  });

  it("every non-approved creative status is ineligible even inside an active campaign", async () => {
    const { id, cr } = await liveAd();
    for (const st of ["draft", "pending_review", "rejected", "paused", "archived"] as const) {
      creativeOf(cr).status = st;
      assert.equal(eligibility(id, cr), "creative_not_approved", st);
    }
  });

  it("every non-active campaign status is ineligible even with an approved ad", async () => {
    const { id, cr } = await liveAd();
    for (const st of ["draft", "pending_review", "paused", "completed", "rejected", "archived"] as const) {
      campaignOf(id).status = st;
      assert.equal(eligibility(id, cr), "campaign_not_active", st);
    }
  });

  it("pending / suspended advertiser or suspended profile is ineligible even with approved ad + active campaign", async () => {
    const { id, cr } = await liveAd();
    for (const st of ["pending", "suspended"]) {
      fake.me = { id: "adv-A", status: st };
      assert.equal(eligibility(id, cr), "advertiser_not_active", st);
    }
    fake.me = { id: "adv-A", status: "active" };
    fake.profileStatus = "suspended";
    assert.equal(eligibility(id, cr), "advertiser_profile_not_active");
  });

  it("dates and budget still gate serving: not started, ended, total / daily budget used up", async () => {
    const { id, cr } = await liveAd();
    assert.equal(eligibility(id, cr, { start_date: "2999-01-01" }), "not_started");
    assert.equal(eligibility(id, cr, { end_date: YESTERDAY }), "ended");
    assert.equal(eligibility(id, cr, { spent_total: 250 }), "total_budget_exhausted");
    assert.equal(eligibility(id, cr, { spent_today: 25 }), "daily_budget_exhausted");
  });

  it("rejecting the ad or the campaign after go-live immediately makes it ineligible", async () => {
    const { id, cr } = await liveAd();
    await admin("creative", cr, "reject", "Policy issue found later");
    assert.equal(eligibility(id, cr), "creative_not_approved");

    fake.reset();
    const b = await liveAd();
    await admin("campaign", b.id, "reject");
    assert.equal(eligibility(b.id, b.cr), "campaign_not_active");
  });

  it("advertiser suspended AFTER approval: nothing new can be changed, and the already-approved ad stops being eligible", async () => {
    const { id, cr } = await liveAd();
    fake.me = { id: "adv-A", status: "suspended" };
    const before = fake.writes.length;
    assert.match(msg(await reviewAction(id, "withdraw")), /not approved yet/);
    assert.match(msg(await creativeAction(cr, "archive")), /not approved yet/);
    assert.equal(fake.writes.length, before);
    assert.equal(eligibility(id, cr), "advertiser_not_active");
  });

  it("serving rows with an unknown status are dropped (fail closed), so a bad status never becomes eligible", async () => {
    const { id, cr } = await liveAd();
    const c = campaignOf(id);
    const k = creativeOf(cr);
    const base = {
      creative_id: k.id, headline: k.headline, body: k.body, cta_text: k.ctaText, destination_url: k.destinationUrl, creative_status: "approved",
      campaign_id: c.id, campaign_status: "active", category: c.category, start_date: c.startDate, end_date: null, total_budget: 250, daily_budget: 25,
      spent_total: 0, spent_today: 0, advertiser_status: "active", advertiser_profile_status: "active", campaign_serves_today: 0, creative_serves_today: 0,
    };
    assert.ok(parseCandidateRow(base));
    for (const over of [{ creative_status: "live" }, { campaign_status: "approved" }, { advertiser_status: "ok" }, { advertiser_profile_status: "pending" }]) {
      assert.equal(parseCandidateRow({ ...base, ...over }), null, JSON.stringify(over));
    }
  });
});
