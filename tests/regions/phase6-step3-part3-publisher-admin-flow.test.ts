import { countryFake } from "./country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { submitPublisherCountry } from "@/app/dashboard/publisher/country-actions";
import { adminReviewPublisherCountry } from "@/app/dashboard/admin/country-actions";
import { initialRunState } from "@/lib/campaigns/types";
import { regionForCountry } from "@/lib/regions/country-region";
import { publisherRegionalEligibility, toPublisherCountry } from "@/lib/regions/publisher-country";

// Phase 6 Step 3 Part 3: international publisher registration + admin verification states + admin access control.
// Part 2 ke detailed tests ke upar ek chhota cross-check; Step 2 ka maujooda workflow hi chalta hai. Nakli Supabase; asli database kabhi nahi.
const PUB_ID = "22222222-2222-4222-8222-222222222222";

const settle = <T,>(p: Promise<T>) =>
  p.then(
    (r) => ({ threw: false as const, r }),
    (e: Error) => ({ threw: true as const, message: e.message }),
  );
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const setup = (fields: Record<string, string>) =>
  settle(setupPublisher({ status: "idle" }, form({ name: "Chat Bot", websiteUrl: "https://bot.example.com", category: "", ...fields })));
const resubmit = (country: string) => settle(submitPublisherCountry(initialRunState, form({ country })));
const review = (fields: Record<string, string>) => settle(adminReviewPublisherCountry(initialRunState, form(fields)));

beforeEach(() => {
  countryFake.reset();
  console.error = () => {};
});

describe("international publisher registration", () => {
  it("publishers from every kind of region register; the country goes only through submit_publisher_country (pending)", async () => {
    const samples = ["IN", "US", "GB", "DE", "BR", "JP", "AE", "NG", "AU", "SG"];
    for (const code of samples) {
      countryFake.reset();
      const out = await setup({ country: ` ${code.toLowerCase()} ` });
      assert.equal(out.threw && out.message, "REDIRECT:/dashboard/publisher?setup=1", code);
      assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: code } }], code);
      assert.ok(regionForCountry(code) !== null, code);
    }
  });

  it("invalid country codes are refused with a field error, nothing is saved", async () => {
    for (const bad of ["UK", "XX", "USA", "1A", "India"]) {
      countryFake.reset();
      const out = await setup({ country: bad });
      assert.equal(out.threw, false, bad);
      assert.equal(countryFake.inserts.length + countryFake.rpcCalls.length, 0, bad);
    }
  });

  it("rejected publisher can resubmit a corrected country (same RPC, same rules)", async () => {
    const out = await resubmit(" de ");
    assert.equal(out.threw, false);
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "DE" } }]);
  });
});

describe("publisher country states: pending, verified, rejected", () => {
  beforeEach(() => {
    countryFake.role = "admin"; // review actions sirf admin role se chalti hain
  });
  const state = (code: string | null, status: string | null) =>
    publisherRegionalEligibility(toPublisherCountry({ country_code: code, country_status: status }));

  it("only verified + ISO-valid gets a region; pending / rejected / missing / invalid do not", () => {
    assert.deepEqual(state("IN", "verified"), { eligible: true, countryCode: "IN", region: "south_asia" });
    assert.deepEqual(state("IN", "pending"), { eligible: false, reason: "pending" });
    assert.deepEqual(state("IN", "rejected"), { eligible: false, reason: "rejected" });
    assert.deepEqual(state(null, null), { eligible: false, reason: "missing" });
    assert.deepEqual(state("UK", "verified"), { eligible: false, reason: "invalid_country" });
  });

  it("admin approve -> RPC approve with the code the admin saw; admin reject -> RPC reject; admin id is never taken from the form", async () => {
    const a = await review({ id: PUB_ID, decision: "approve", expectedCountry: "in", reviewer: "x", country_reviewed_by: "x" });
    assert.equal(a.threw, false);
    const r = await review({ id: PUB_ID, decision: "reject", expectedCountry: "IN" });
    assert.equal(r.threw, false);
    assert.deepEqual(countryFake.rpcCalls, [
      { name: "admin_review_publisher_country", args: { p_publisher_id: PUB_ID, p_decision: "approve", p_expected_country: "IN" } },
      { name: "admin_review_publisher_country", args: { p_publisher_id: PUB_ID, p_decision: "reject", p_expected_country: "IN" } },
    ]);
  });

  it("an invalid country cannot be approved (no RPC) but CAN be rejected", async () => {
    const approve = await review({ id: PUB_ID, decision: "approve", expectedCountry: "UK" });
    assert.equal(approve.threw === false && approve.r.status, "error");
    assert.equal(countryFake.rpcCalls.length, 0);
    const reject = await review({ id: PUB_ID, decision: "reject", expectedCountry: "UK" });
    assert.equal(reject.threw === false && reject.r.status, "success");
    assert.equal(countryFake.rpcCalls.length, 1);
  });

  it("a country changed after the admin opened the page is refused with a friendly message (no raw database text)", async () => {
    countryFake.rpcError = { code: "P0001", hint: "country_changed", message: "raw db text" };
    const out = await review({ id: PUB_ID, decision: "approve", expectedCountry: "IN" });
    assert.equal(out.threw, false);
    if (!out.threw) {
      assert.equal(out.r.status, "error");
      assert.match(out.r.message ?? "", /changed the country/i);
      assert.doesNotMatch(out.r.message ?? "", /raw db text/);
    }
  });
});

describe("existing accounts and historical records stay compatible", () => {
  it("publisher without country columns / values is 'missing' (No Fill as before), never an error and never verified", () => {
    assert.deepEqual(toPublisherCountry({ country_code: null, country_status: null }), { countryCode: null, status: null, submittedAt: null, reviewedAt: null });
    assert.deepEqual(publisherRegionalEligibility(toPublisherCountry({ country_code: null, country_status: null })), { eligible: false, reason: "missing" });
    assert.deepEqual(publisherRegionalEligibility(null), { eligible: false, reason: "missing" });
  });

  it("registration without a country works exactly as before (no RPC)", async () => {
    const out = await setup({});
    assert.equal(out.threw && out.message, "REDIRECT:/dashboard/publisher?setup=1");
    assert.equal(countryFake.rpcCalls.length, 0);
    assert.deepEqual(Object.keys(countryFake.inserts[0].payload).sort(), ["category", "name", "profile_id", "website_url"]);
  });
});

describe("unauthorized users cannot use Admin verification controls", () => {
  it("advertiser, publisher and any unknown role are stopped at the admin role check: no RPC, no revalidate", async () => {
    for (const role of ["advertiser", "publisher", "visitor", ""]) {
      countryFake.reset();
      countryFake.role = role;
      for (const decision of ["approve", "reject"]) {
        const out = await review({ id: PUB_ID, decision, expectedCountry: "IN" });
        assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard" }, `${role}/${decision}`);
      }
      assert.deepEqual(countryFake.roleCalls, [["admin"], ["admin"]], role);
      assert.equal(countryFake.rpcCalls.length, 0, role);
      assert.deepEqual(countryFake.revalidated, [], role);
    }
  });

  it("the publisher's own action can only submit a country: forged decision / status fields never reach an admin RPC", async () => {
    await settle(
      submitPublisherCountry(
        initialRunState,
        form({ country: "IN", decision: "approve", status: "verified", country_status: "verified", id: PUB_ID, role: "admin" }),
      ),
    );
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "IN" } }]);
  });

  it("admin role passes the check and reaches the database function (which checks is_admin again)", async () => {
    countryFake.role = "admin";
    const out = await review({ id: PUB_ID, decision: "approve", expectedCountry: "IN" });
    assert.equal(out.threw, false);
    assert.equal(countryFake.rpcCalls[0]?.name, "admin_review_publisher_country");
  });
});
