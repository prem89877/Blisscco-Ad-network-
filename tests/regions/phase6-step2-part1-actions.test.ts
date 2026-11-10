import { countryFake } from "./country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { submitPublisherCountry } from "@/app/dashboard/publisher/country-actions";
import { adminReviewPublisherCountry } from "@/app/dashboard/admin/country-actions";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { initialRunState } from "@/lib/campaigns/types";

// Phase 6 Step 2 Part 1: server actions. Nakli Supabase; asli database kabhi nahi.
const PUB_ID = "22222222-2222-4222-8222-222222222222";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const settle = <T,>(p: Promise<T>) =>
  p.then(
    (r) => ({ threw: false as const, r }),
    (e: Error) => ({ threw: true as const, message: e.message }),
  );
const submit = (fields: Record<string, string>) => settle(submitPublisherCountry(initialRunState, form(fields)));
const review = (fields: Record<string, string>) => settle(adminReviewPublisherCountry(initialRunState, form(fields)));
const setup = (fields: Record<string, string>) => settle(setupPublisher({ status: "idle" }, form(fields)));

beforeEach(() => {
  countryFake.reset();
  console.error = () => {}; // test output saaf rakhne ke liye
});

describe("publisher submits a country (task 1, 2)", () => {
  it("valid country goes to submit_publisher_country with ONLY the normalized code", async () => {
    const out = await submit({ country: " in " });
    assert.equal(out.threw, false);
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "IN" } }]);
    assert.deepEqual(countryFake.roleCalls, [["publisher"]]);
    assert.deepEqual(countryFake.revalidated, ["/dashboard/publisher"]);
    assert.equal(countryFake.inserts.length, 0); // table me seedha kuch nahi likha
  });

  it("publisher cannot approve their own country: status / verified / admin / publisher id fields are never forwarded", async () => {
    await submit({
      country: "IN",
      status: "verified",
      country_status: "verified",
      country_reviewed_by: PUB_ID,
      verified: "true",
      publisher_id: PUB_ID,
      role: "admin",
    });
    assert.equal(countryFake.rpcCalls.length, 1);
    assert.deepEqual(countryFake.rpcCalls[0].args, { p_country_code: "IN" });
    assert.equal(countryFake.inserts.length, 0);
  });

  it("a publisher can never reach the admin review: admin action needs the admin role and stops before the database", async () => {
    countryFake.role = "publisher";
    const out = await review({ id: PUB_ID, decision: "approve", expectedCountry: "IN" });
    assert.equal(out.threw, true);
    assert.deepEqual(countryFake.roleCalls, [["admin"]]);
    assert.equal(countryFake.rpcCalls.length, 0);
    assert.equal(countryFake.revalidated.length, 0);
  });

  it("non-publisher roles cannot submit (requireRole fails first, no database call)", async () => {
    for (const role of ["advertiser", "admin"]) {
      countryFake.reset();
      countryFake.role = role;
      const out = await submit({ country: "IN" });
      assert.equal(out.threw, true, role);
      assert.equal(countryFake.rpcCalls.length, 0, role);
    }
  });

  it("invalid / missing / non-ISO country never reaches the database", async () => {
    for (const bad of ["", "XX", "UK", "India", "1", "I N"]) {
      countryFake.reset();
      const out = await submit({ country: bad });
      assert.equal(out.threw, false);
      assert.equal(out.threw === false && out.r.status, "error", bad);
      assert.equal(countryFake.rpcCalls.length, 0, bad);
    }
    countryFake.reset();
    const none = await settle(submitPublisherCountry(initialRunState, new FormData()));
    assert.equal(none.threw === false && none.r.status, "error");
    assert.equal(countryFake.rpcCalls.length, 0);
  });

  it("database errors become fixed messages (no raw text) and nothing is revalidated", async () => {
    countryFake.rpcError = { code: "XX000", hint: "boom", message: "relation public.publishers secret detail" };
    const out = await submit({ country: "IN" });
    assert.equal(out.threw, false);
    if (!out.threw) {
      assert.equal(out.r.status, "error");
      assert.ok(!/secret|relation|boom/.test(out.r.message ?? ""));
    }
    assert.equal(countryFake.revalidated.length, 0);
    countryFake.rpcError = { code: "42501", hint: "publisher_suspended" };
    const sus = await submit({ country: "IN" });
    assert.match(sus.threw ? "" : (sus.r.message ?? ""), /suspended/);
  });
});

describe("admin approves / rejects (task 2, 3)", () => {
  beforeEach(() => {
    countryFake.role = "admin";
  });

  it("first thing is requireRole(['admin']); a non-admin never reaches the database", async () => {
    countryFake.role = "advertiser";
    const out = await review({ id: PUB_ID, decision: "approve", expectedCountry: "IN" });
    assert.equal(out.threw, true);
    assert.deepEqual(countryFake.roleCalls, [["admin"]]);
    assert.equal(countryFake.rpcCalls.length, 0);
  });

  it("approve / reject call admin_review_publisher_country with exactly id, decision and the country the admin saw", async () => {
    for (const decision of ["approve", "reject"]) {
      countryFake.reset();
      countryFake.role = "admin";
      const out = await review({ id: PUB_ID, decision, expectedCountry: "in" });
      assert.deepEqual(out, { threw: false, r: { status: "success", message: "Done." } });
      assert.deepEqual(countryFake.rpcCalls, [
        { name: "admin_review_publisher_country", args: { p_publisher_id: PUB_ID, p_decision: decision, p_expected_country: "IN" } },
      ]);
      assert.deepEqual(countryFake.revalidated, ["/dashboard/admin"]);
    }
  });

  it("no caller-supplied reviewer / status / timestamp is trusted or forwarded", async () => {
    await review({
      id: PUB_ID,
      decision: "approve",
      expectedCountry: "IN",
      reviewed_by: PUB_ID,
      country_reviewed_by: PUB_ID,
      country_status: "verified",
      reviewed_at: "2020-01-01",
      status: "verified",
    });
    assert.equal(countryFake.rpcCalls.length, 1);
    assert.deepEqual(Object.keys(countryFake.rpcCalls[0].args).sort(), ["p_decision", "p_expected_country", "p_publisher_id"]);
  });

  it("bad input is rejected before the database: bad uuid, bad decision (incl. 'verified'), missing country", async () => {
    const cases = [
      { id: "not-a-uuid", decision: "approve", expectedCountry: "IN" },
      { id: PUB_ID, decision: "verified", expectedCountry: "IN" },
      { id: PUB_ID, decision: "rejected", expectedCountry: "IN" },
      { id: PUB_ID, decision: "", expectedCountry: "IN" },
      { id: PUB_ID, decision: "approve" },
    ];
    for (const c of cases) {
      countryFake.reset();
      countryFake.role = "admin";
      const out = await review(c as Record<string, string>);
      assert.equal(out.threw === false && out.r.status, "error", JSON.stringify(c));
      assert.equal(countryFake.rpcCalls.length, 0, JSON.stringify(c));
    }
  });

  it("a non-ISO country cannot be approved, but can be rejected", async () => {
    const approve = await review({ id: PUB_ID, decision: "approve", expectedCountry: "XX" });
    assert.equal(approve.threw === false && approve.r.status, "error");
    assert.equal(countryFake.rpcCalls.length, 0);
    const reject = await review({ id: PUB_ID, decision: "reject", expectedCountry: "XX" });
    assert.equal(reject.threw === false && reject.r.status, "success");
    assert.equal(countryFake.rpcCalls[0].args.p_expected_country, "XX");
  });

  it("database refusals (self approval, stale country, not admin) show fixed messages only", async () => {
    const expect: [{ code?: string; hint?: string }, RegExp][] = [
      [{ code: "42501", hint: "self_approval_blocked" }, /own account/],
      [{ code: "22023", hint: "country_changed" }, /changed the country/],
      [{ code: "22023", hint: "country_not_pending" }, /waiting for verification/],
      [{ code: "42501" }, /not allowed/],
    ];
    for (const [error, re] of expect) {
      countryFake.reset();
      countryFake.role = "admin";
      countryFake.rpcError = error;
      const out = await review({ id: PUB_ID, decision: "approve", expectedCountry: "IN" });
      assert.equal(out.threw, false);
      if (!out.threw) {
        assert.equal(out.r.status, "error");
        assert.match(out.r.message ?? "", re);
      }
      assert.equal(countryFake.revalidated.length, 0);
    }
  });
});

describe("country during registration (task 1)", () => {
  const base = { name: "My Bot", websiteUrl: "", category: "" };

  it("country is NOT inserted into the table; it goes through submit_publisher_country after the insert", async () => {
    const out = await setup({ ...base, country: "gb" });
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard/publisher?setup=1" });
    assert.equal(countryFake.inserts.length, 1);
    assert.deepEqual(Object.keys(countryFake.inserts[0].payload).sort(), ["category", "name", "profile_id", "website_url"]);
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "GB" } }]);
  });

  it("no country => no rpc, same behaviour as before", async () => {
    const out = await setup(base);
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard/publisher?setup=1" });
    assert.equal(countryFake.rpcCalls.length, 0);
  });

  it("invalid country => field error, nothing inserted, no rpc", async () => {
    for (const bad of ["XX", "UK", "Germany"]) {
      countryFake.reset();
      const out = await setup({ ...base, country: bad });
      assert.equal(out.threw, false);
      if (!out.threw) {
        const r = out.r as { status: string; fieldErrors?: Record<string, string> };
        assert.equal(r.status, "error");
        assert.ok(r.fieldErrors?.country, bad);
      }
      assert.equal(countryFake.inserts.length, 0, bad);
      assert.equal(countryFake.rpcCalls.length, 0, bad);
    }
  });

  it("if the country rpc fails the account is still created (publisher can submit the country later)", async () => {
    countryFake.rpcError = { code: "XX000" };
    const out = await setup({ ...base, country: "IN" });
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard/publisher?setup=1" });
    assert.equal(countryFake.inserts.length, 1);
  });

  it("if the account insert fails the country is not submitted", async () => {
    countryFake.insertError = { code: "23514" };
    const out = await setup({ ...base, country: "IN" });
    assert.equal(out.threw, false);
    assert.equal(countryFake.rpcCalls.length, 0);
  });

  it("a duplicate setup (23505) redirects without touching the existing country", async () => {
    countryFake.insertError = { code: "23505" };
    const out = await setup({ ...base, country: "IN" });
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard/publisher" });
    assert.equal(countryFake.rpcCalls.length, 0);
  });
});
