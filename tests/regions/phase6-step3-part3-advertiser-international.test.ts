import { advFake } from "./advertiser-country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupAdvertiser } from "@/app/dashboard/account/actions";
import { updateAdvertiserCountry } from "@/app/dashboard/advertiser/country-actions";
import { advertiserCountryFromCode, advertiserRegion, toAdvertiserCountry } from "@/lib/regions/advertiser-country";
import { ISO_COUNTRY_CODES, REGION_IDS, regionForCountry } from "@/lib/regions/country-region";
import { countryOptions } from "@/lib/regions/publisher-country";
import { initialRunState } from "@/lib/campaigns/types";

// Phase 6 Step 3 Part 3: international advertiser onboarding cross-check (Part 1 ke detailed tests ke upar). Nakli Supabase; asli database kabhi nahi.
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
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
const update = (country: string) => run(updateAdvertiserCountry(initialRunState, form({ country })));
const setup = (fields: Record<string, string>) => run(setupAdvertiser({ status: "idle" }, form({ companyName: "Glow", websiteUrl: "", ...fields })));

beforeEach(() => {
  advFake.reset();
  console.error = () => {};
});

describe("international advertiser country selection", () => {
  it("the dropdown lists every ISO code once (international, not a short list), values are the codes", () => {
    const opts = countryOptions();
    assert.equal(opts.length, ISO_COUNTRY_CODES.length);
    assert.deepEqual(opts.map((o) => o.value).sort(), [...ISO_COUNTRY_CODES].sort());
    for (const code of ["IN", "US", "GB", "DE", "BR", "JP", "AE", "NG", "AU"]) assert.ok(opts.some((o) => o.value === code), code);
  });

  it("every ISO code is saved by ONE column update for the logged-in advertiser (nothing else, no region)", async () => {
    for (const code of ISO_COUNTRY_CODES) {
      advFake.reset();
      const r = await update(` ${code.toLowerCase()} `);
      assert.equal(r.state?.status, "success", code);
      assert.deepEqual(advFake.updates, [{ table: "advertisers", payload: { country_code: code }, filters: [["profile_id", "user-adv-1"]] }], code);
    }
  });
});

describe("valid and invalid country codes", () => {
  it("invalid codes are refused with a message and nothing is saved", async () => {
    for (const bad of ["UK", "XX", "ZZ", "USA", "1A", "U", "", "India", "I N"]) {
      advFake.reset();
      const r = await update(bad);
      assert.equal(r.state?.status, "error", JSON.stringify(bad));
      assert.equal(advFake.updates.length, 0, JSON.stringify(bad));
    }
  });
});

describe("advertiser country-to-region resolution", () => {
  it("region comes only from the central mapping; every ISO code resolves to one of the known regions", () => {
    for (const code of ISO_COUNTRY_CODES) {
      const region = advertiserRegion(code);
      assert.equal(region, regionForCountry(code), code);
      assert.ok(region !== null && (REGION_IDS as readonly string[]).includes(region), code);
    }
    assert.equal(advertiserRegion("IN"), "south_asia");
    assert.equal(advertiserRegion("US"), "north_america");
    assert.equal(advertiserRegion("GB"), "uk");
  });

  it("invalid / missing => no region (never silent Rest of World)", () => {
    for (const v of ["UK", "XX", "", null, undefined, 5]) {
      assert.equal(advertiserRegion(v), null, String(v));
      assert.equal(advertiserCountryFromCode(v).region, null, String(v));
    }
  });
});

describe("existing advertisers and historical records", () => {
  it("old advertiser row (no / null country) reads as 'not chosen', not as an error", () => {
    assert.deepEqual(toAdvertiserCountry({ id: "a1" }), { countryCode: null, region: null });
    assert.deepEqual(toAdvertiserCountry({ country_code: null }), { countryCode: null, region: null });
  });

  it("signup without a country is exactly the old flow: same insert payload, no update", async () => {
    const r = await setup({});
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.deepEqual(advFake.inserts, [{ table: "advertisers", payload: { profile_id: "user-adv-1", company_name: "Glow", website_url: null } }]);
    assert.equal(advFake.updates.length, 0);
  });

  it("signup with a country: insert stays the old payload, country follows as a separate update", async () => {
    const r = await setup({ country: "BR" });
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.deepEqual(Object.keys(advFake.inserts[0].payload).sort(), ["company_name", "profile_id", "website_url"]);
    assert.deepEqual(advFake.updates.map((u) => u.payload), [{ country_code: "BR" }]);
  });

  it("a failed country save (e.g. SQL not applied) does not break signup", async () => {
    advFake.updateError = { code: "42703" };
    const r = await setup({ country: "IN" });
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
  });
});

describe("only an advertiser can change an advertiser country", () => {
  it("publisher / admin roles are stopped before the database", async () => {
    for (const role of ["publisher", "admin"]) {
      advFake.reset();
      advFake.role = role;
      const r = await update("IN");
      assert.equal(r.redirect, "/dashboard", role);
      assert.equal(advFake.updates.length, 0, role);
    }
  });
});
