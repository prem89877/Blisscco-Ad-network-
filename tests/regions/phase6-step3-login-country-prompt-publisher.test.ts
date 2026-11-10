import { countryFake } from "./country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { submitPublisherCountry } from "@/app/dashboard/publisher/country-actions";
import { initialRunState } from "@/lib/campaigns/types";

// Login country screen: publisher side of the "continue" flag. Nakli Supabase; asli database kabhi nahi.
const run = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return submitPublisherCountry(initialRunState, f).then(
    (r) => ({ threw: false as const, r }),
    (e: Error) => ({ threw: true as const, message: e.message }),
  );
};

beforeEach(() => {
  countryFake.reset();
  console.error = () => {};
});

describe("publisher country on the login screen", () => {
  it("with the continue flag: country goes through submit_publisher_country (pending) and the user lands on the dashboard", async () => {
    const out = await run({ country: "gb", continue: "dashboard" });
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard" });
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "GB" } }]);
    assert.equal(countryFake.inserts.length, 0);
  });

  it("the flag never changes what is sent to the database (no status / verified forwarded)", async () => {
    await run({ country: "IN", continue: "dashboard", status: "verified", country_status: "verified" });
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "IN" } }]);
  });

  it("invalid country or a failed save with the flag: no redirect, error shown", async () => {
    const bad = await run({ country: "XX", continue: "dashboard" });
    assert.equal(bad.threw, false);
    assert.equal(countryFake.rpcCalls.length, 0);
    countryFake.rpcError = { code: "XX000" };
    const failed = await run({ country: "IN", continue: "dashboard" });
    assert.equal(failed.threw, false);
    if (!failed.threw) assert.equal((failed.r as { status: string }).status, "error");
  });

  it("without the flag the old behavior stays: success message, no redirect", async () => {
    const out = await run({ country: "IN" });
    assert.equal(out.threw, false);
    if (!out.threw) assert.equal((out.r as { status: string }).status, "success");
  });
});
