import { adminFake } from "./admin-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { adminDecision } from "@/app/dashboard/admin/actions";
import { CAMPAIGN_APPROVE_BLOCK_MESSAGES, REJECT_REASON_MAX, campaignApproveBlock, mapAdminError } from "@/lib/admin/decisions";
import { initialRunState } from "@/lib/campaigns/types";

// Day 9 Part 4: admin-only operations are enforced on the SERVER (role check first, then the database function re-checks).
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const ID = "22222222-2222-4222-8222-222222222222";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const run = (fields: Record<string, string>) =>
  adminDecision(initialRunState, form(fields)).then(
    (r) => ({ threw: false as const, r }),
    (e: Error) => ({ threw: true as const, message: e.message }),
  );

describe("day 9 part 4: adminDecision is admin-only on the server", () => {
  beforeEach(() => {
    adminFake.reset();
    // console.error ko chup karte hain taaki test output saaf rahe
    console.error = () => {};
  });

  it("the very first thing it does is requireRole(['admin']); a non-admin never reaches the database", async () => {
    adminFake.roleFails = true;
    const out = await run({ kind: "campaign", id: ID, decision: "approve" });
    assert.equal(out.threw, true);
    assert.deepEqual(adminFake.roleCalls, [["admin"]]);
    assert.equal(adminFake.rpcCalls.length, 0);
    assert.equal(adminFake.revalidated.length, 0);
  });

  it("no caller-supplied role/admin/reviewer field is ever trusted or forwarded", async () => {
    await run({ kind: "creative", id: ID, decision: "approve", role: "admin", is_admin: "true", reviewed_by: ID, status: "approved" });
    assert.equal(adminFake.rpcCalls.length, 1);
    assert.deepEqual(adminFake.rpcCalls[0], {
      name: "admin_review_creative",
      args: { p_creative_id: ID, p_decision: "approve", p_reason: null },
    });
  });

  it("campaign approve/reject go to admin_review_campaign with only the id and decision", async () => {
    for (const decision of ["approve", "reject"]) {
      adminFake.reset();
      const out = await run({ kind: "campaign", id: ID, decision });
      assert.deepEqual(out, { threw: false, r: { status: "success", message: "Done." } });
      assert.deepEqual(adminFake.rpcCalls, [{ name: "admin_review_campaign", args: { p_campaign_id: ID, p_decision: decision } }]);
      assert.deepEqual(adminFake.revalidated, ["/dashboard/admin"]);
    }
  });

  it("creative reject needs a reason (and a bounded one) before any database call", async () => {
    const none = await run({ kind: "creative", id: ID, decision: "reject", reason: "   " });
    assert.equal(none.threw, false);
    if (!none.threw) assert.equal(none.r.status, "error");
    const long = await run({ kind: "creative", id: ID, decision: "reject", reason: "x".repeat(REJECT_REASON_MAX + 1) });
    if (!long.threw) assert.equal(long.r.status, "error");
    assert.equal(adminFake.rpcCalls.length, 0);
    const ok = await run({ kind: "creative", id: ID, decision: "reject", reason: "  Misleading   claim  " });
    assert.equal(ok.threw, false);
    assert.deepEqual(adminFake.rpcCalls[0].args, { p_creative_id: ID, p_decision: "reject", p_reason: "Misleading claim" });
  });

  it("garbage input is refused without a database call", async () => {
    const bad: Record<string, string>[] = [
      { kind: "campaign", id: "not-a-uuid", decision: "approve" },
      { kind: "billing", id: ID, decision: "approve" },
      { kind: "campaign", id: ID, decision: "active" },
      { kind: "campaign", id: ID, decision: "" },
      { id: ID, decision: "approve" },
      { kind: "advertiser", id: ID, decision: "approve" },
    ];
    for (const fields of bad) {
      const out = await run(fields);
      assert.equal(out.threw, false, JSON.stringify(fields));
      if (!out.threw) assert.equal(out.r.status, "error", JSON.stringify(fields));
    }
    assert.equal(adminFake.rpcCalls.length, 0);
  });

  it("database refusals become specific, safe messages (no raw database text)", async () => {
    const cases: [{ code: string; hint?: string }, RegExp][] = [
      [{ code: "42501", hint: "self_approval_blocked" }, /your own account/],
      [{ code: "42501" }, /Only an admin/],
      [{ code: "22023", hint: "approve_needs_creative" }, /Approve at least one/],
      [{ code: "22023", hint: "approve_campaign_ended" }, /end date has passed/],
      [{ code: "22023", hint: "approve_needs_budget" }, /no budget left/],
      [{ code: "22023", hint: "advertiser_not_active" }, /not active/],
      [{ code: "22023" }, /did not allow/],
      [{ code: "P0002" }, /no longer exists/],
      [{ code: "XX000" }, /Something went wrong/],
    ];
    for (const [error, re] of cases) {
      adminFake.reset();
      adminFake.rpcError = error;
      const out = await run({ kind: "campaign", id: ID, decision: "approve" });
      assert.equal(out.threw, false);
      if (!out.threw) {
        assert.equal(out.r.status, "error");
        assert.match(out.r.message ?? "", re);
      }
      assert.equal(adminFake.revalidated.length, 0, "no revalidate on failure");
    }
  });

  it("the server action never uses the service-role client", () => {
    const s = read("app/dashboard/admin/actions.ts");
    assert.equal(/createAdminClient|service_role|SERVICE_ROLE/.test(s), false);
    assert.match(s, /await requireRole\(\["admin"\]\);/);
    assert.ok(s.indexOf("requireRole") < s.indexOf("formData.get"), "role check before reading input");
  });

  it("admin page and layout nav use the admin role only", () => {
    assert.match(read("app/dashboard/admin/page.tsx"), /await requireRole\(\["admin"\]\);/);
  });
});

describe("day 9 part 4: admin helpers (pure)", () => {
  it("campaignApproveBlock", () => {
    const today = "2026-10-27";
    assert.equal(campaignApproveBlock({ endDate: null }, 1, today), null);
    assert.equal(campaignApproveBlock({ endDate: today }, 1, today), null);
    assert.equal(campaignApproveBlock({ endDate: "2026-10-26" }, 1, today), "ended");
    assert.equal(campaignApproveBlock({ endDate: null }, 0, today), "no_approved_ad");
    assert.equal(campaignApproveBlock({ endDate: null }, null, today), null, "unknown count: database decides");
    assert.equal(campaignApproveBlock({ endDate: "2026-10-26" }, 0, today), "ended", "ended is reported first");
    assert.ok(CAMPAIGN_APPROVE_BLOCK_MESSAGES.ended.length > 10 && CAMPAIGN_APPROVE_BLOCK_MESSAGES.no_approved_ad.length > 10);
  });

  it("mapAdminError ignores unknown hints and null errors", () => {
    assert.match(mapAdminError(null), /Something went wrong/);
    assert.match(mapAdminError({ code: "42501", hint: "toString" }), /Only an admin/, "prototype keys are not hints");
    assert.match(mapAdminError({ code: "22023", hint: "made_up" }), /did not allow/);
  });
});
