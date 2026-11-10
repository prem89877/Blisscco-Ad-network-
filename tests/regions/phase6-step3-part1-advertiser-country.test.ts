import { advFake } from "./advertiser-country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setupAdvertiser } from "@/app/dashboard/account/actions";
import { updateAdvertiserCountry } from "@/app/dashboard/advertiser/country-actions";
import {
  advertiserCountryFromCode,
  advertiserRegion,
  mapAdvertiserCountryError,
  parseAdvertiserCountry,
  toAdvertiserCountry,
} from "@/lib/regions/advertiser-country";
import { ISO_COUNTRY_CODES, REGION_IDS, regionForCountry } from "@/lib/regions/country-region";
import { countryOptions } from "@/lib/regions/publisher-country";
import { initialRunState } from "@/lib/campaigns/types";

// Phase 6 Step 3 Part 1: international advertiser onboarding. Nakli Supabase; asli database kabhi nahi. SQL chalayi nahi jaati (sirf text check).
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

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
const setup = (fields: Record<string, string>) => run(setupAdvertiser({ status: "idle" }, form(fields)));
const update = (fields: Record<string, string>) => run(updateAdvertiserCountry(initialRunState, form(fields)));

let logged: unknown[][] = [];
beforeEach(() => {
  advFake.reset();
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
});

describe("task 2: country validation uses the central ISO mapping", () => {
  it("valid codes are trimmed, upper-cased and given a region from the central mapping", () => {
    const cases: Array<[string, string, string]> = [
      [" in ", "IN", "south_asia"],
      ["us", "US", "north_america"],
      ["GB", "GB", "uk"],
      ["de", "DE", "western_europe"],
      ["AU", "AU", "australia"],
      ["ae", "AE", "middle_east"],
      ["SG", "SG", "southeast_asia"],
      ["BR", "BR", "rest_of_world"],
    ];
    for (const [input, code, region] of cases) {
      const r = parseAdvertiserCountry(input);
      assert.equal(r.ok, true, input);
      if (r.ok) assert.deepEqual([r.countryCode, r.region], [code, region], input);
    }
  });

  it("invalid codes are rejected with a message and never get a region (no silent Rest of World)", () => {
    for (const bad of ["", "  ", "U", "USA", "U1", "1A", "UK", "XX", "ZZ", "A-", "İN", null, undefined, 5, {}, ["IN"]]) {
      const r = parseAdvertiserCountry(bad);
      assert.equal(r.ok, false, String(bad));
      if (!r.ok) assert.match(r.message, /country/i);
      assert.equal(advertiserRegion(bad), null, String(bad));
      assert.deepEqual(advertiserCountryFromCode(bad), { countryCode: null, region: null }, String(bad));
    }
  });

  it("every ISO code resolves to exactly the region of the central mapping, and it is one of the 8 known regions", () => {
    assert.ok(ISO_COUNTRY_CODES.length > 240);
    for (const code of ISO_COUNTRY_CODES) {
      const region = advertiserRegion(code);
      assert.equal(region, regionForCountry(code), code);
      assert.ok(region !== null && (REGION_IDS as readonly string[]).includes(region), code);
    }
  });

  it("the dropdown options are the central ISO list (same list publishers use)", () => {
    const options = countryOptions();
    assert.equal(options.length, ISO_COUNTRY_CODES.length);
    assert.deepEqual(options.map((o) => o.value).sort(), [...ISO_COUNTRY_CODES].sort());
  });
});

describe("task 3, 5: stored country <-> typed state; old advertisers keep working", () => {
  it("row with no country (every existing advertiser) is a valid 'no country' state, not an error", () => {
    assert.deepEqual(toAdvertiserCountry({ country_code: null }), { countryCode: null, region: null });
    assert.deepEqual(toAdvertiserCountry({}), { countryCode: null, region: null });
  });
  it("row with a country gets its region from the central mapping", () => {
    assert.deepEqual(toAdvertiserCountry({ country_code: "IN" }), { countryCode: "IN", region: "south_asia" });
    assert.deepEqual(toAdvertiserCountry({ country_code: "CA" }), { countryCode: "CA", region: "north_america" });
  });
  it("a stored code that is not ISO keeps the code but gets NO region; wrong shape => load fail (null)", () => {
    assert.deepEqual(toAdvertiserCountry({ country_code: "XX" }), { countryCode: "XX", region: null });
    assert.equal(toAdvertiserCountry({ country_code: 5 }), null);
    assert.equal(toAdvertiserCountry(null), null);
    assert.equal(toAdvertiserCountry("IN"), null);
  });
  it("database errors map to friendly messages, raw text never shown", () => {
    assert.match(mapAdvertiserCountryError({ code: "23514" }), /choose your country/i);
    assert.match(mapAdvertiserCountryError({ code: "42501" }), /not allowed/i);
    assert.match(mapAdvertiserCountryError({ code: "XX000" }), /could not save/i);
    assert.match(mapAdvertiserCountryError(null), /could not save/i);
  });
});

describe("task 1, 3: advertiser setup with a country", () => {
  it("valid country: insert is EXACTLY the old payload, country is saved after with one column update for the logged-in user", async () => {
    const r = await setup({ companyName: "Glow Parlour", websiteUrl: "https://glow.example.com", country: " in " });
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.deepEqual(advFake.inserts, [
      { table: "advertisers", payload: { profile_id: "user-adv-1", company_name: "Glow Parlour", website_url: "https://glow.example.com" } },
    ]);
    assert.deepEqual(advFake.updates, [{ table: "advertisers", payload: { country_code: "IN" }, filters: [["profile_id", "user-adv-1"]] }]);
  });

  it("no country chosen: no update at all and the insert is unchanged (existing registration flow)", async () => {
    const r = await setup({ companyName: "Glow", websiteUrl: "" });
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.deepEqual(advFake.inserts[0].payload, { profile_id: "user-adv-1", company_name: "Glow", website_url: null });
    assert.equal(advFake.updates.length, 0);
    const blank = await setup({ companyName: "Glow", websiteUrl: "", country: "   " });
    assert.equal(blank.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.equal(advFake.updates.length, 0);
  });

  it("invalid country stops before the database and is shown on the country field with the typed values kept", async () => {
    for (const bad of ["UK", "XX", "USA", "1A"]) {
      advFake.reset();
      const r = await setup({ companyName: "Glow", websiteUrl: "", country: bad });
      assert.equal(r.redirect, undefined, bad);
      assert.equal(r.state?.status, "error", bad);
      assert.ok(r.state?.fieldErrors?.country, bad);
      assert.equal(r.state?.values?.country, bad);
      assert.equal(r.state?.values?.companyName, "Glow");
      assert.equal(advFake.inserts.length, 0, bad);
      assert.equal(advFake.updates.length, 0, bad);
      assert.deepEqual(advFake.revalidated, [], bad);
    }
  });

  it("business-name error and country error are reported together", async () => {
    const r = await setup({ companyName: "  ", websiteUrl: "", country: "XX" });
    assert.ok(r.state?.fieldErrors?.companyName);
    assert.ok(r.state?.fieldErrors?.country);
    assert.equal(advFake.inserts.length, 0);
  });

  it("forged status / region / country_status / id fields are never forwarded", async () => {
    await setup({ companyName: "Glow", websiteUrl: "", country: "US", status: "active", region: "uk", country_status: "verified", id: "x", profile_id: "someone-else" });
    assert.deepEqual(Object.keys(advFake.inserts[0].payload).sort(), ["company_name", "profile_id", "website_url"]);
    assert.equal(advFake.inserts[0].payload.profile_id, "user-adv-1");
    assert.deepEqual(advFake.updates[0].payload, { country_code: "US" });
  });

  it("insert failure: nothing is updated, generic message, raw database text never reaches user or log", async () => {
    advFake.insertError = { code: "42501", message: "SECRET internal detail" };
    const r = await setup({ companyName: "Glow", websiteUrl: "", country: "IN" });
    assert.equal(r.state?.status, "error");
    assert.equal(r.state?.message, "We could not save your details. Please try again.");
    assert.equal(advFake.updates.length, 0);
    assert.ok(!JSON.stringify([r.state, logged]).includes("SECRET"));
  });

  it("duplicate setup (23505): treated as already done and the existing country is NOT overwritten", async () => {
    advFake.insertError = { code: "23505" };
    const r = await setup({ companyName: "Other", websiteUrl: "", country: "IN" });
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.equal(advFake.updates.length, 0);
    assert.equal(logged.length, 0);
  });

  it("country save fails (for example SQL not applied yet): the account is still created and the user still lands on campaigns", async () => {
    advFake.updateError = { code: "42703", message: "SECRET column country_code does not exist" };
    const r = await setup({ companyName: "Glow", websiteUrl: "", country: "IN" });
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.equal(advFake.inserts.length, 1);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], { code: "42703" });
    assert.ok(!JSON.stringify(logged).includes("SECRET"));
  });

  it("role check is kept (advertiser only)", async () => {
    advFake.role = "publisher";
    const r = await setup({ companyName: "Glow", websiteUrl: "", country: "IN" });
    assert.equal(r.redirect, "/dashboard");
    assert.deepEqual(advFake.roleCalls, [["advertiser"]]);
    assert.equal(advFake.inserts.length, 0);
  });
});

describe("task 1, 3, 5: existing advertiser chooses / changes country", () => {
  it("valid country: ONE update of country_code only, filtered by the logged-in profile", async () => {
    const r = await update({ country: " sg " });
    assert.equal(r.state?.status, "success");
    assert.deepEqual(advFake.updates, [{ table: "advertisers", payload: { country_code: "SG" }, filters: [["profile_id", "user-adv-1"]] }]);
    assert.deepEqual(advFake.roleCalls, [["advertiser"]]);
    assert.deepEqual(advFake.revalidated, [{ path: "/dashboard/advertiser/campaigns", type: undefined }]);
    assert.equal(advFake.inserts.length, 0);
  });

  it("status / profile_id / id / region / company fields in the form are ignored", async () => {
    await update({ country: "IN", status: "active", profile_id: "someone-else", id: "x", region: "uk", company_name: "Hacked" });
    assert.equal(advFake.updates.length, 1);
    assert.deepEqual(advFake.updates[0].payload, { country_code: "IN" });
    assert.deepEqual(advFake.updates[0].filters, [["profile_id", "user-adv-1"]]);
  });

  it("invalid country: error message and the database is never touched", async () => {
    for (const bad of ["", "UK", "XX", "USA", "  "]) {
      const r = await update({ country: bad });
      assert.equal(r.state?.status, "error", bad);
      assert.ok(r.state?.message, bad);
    }
    assert.equal((await update({})).state?.status, "error"); // key hi nahi
    assert.equal(advFake.updates.length, 0);
    assert.deepEqual(advFake.revalidated, []);
  });

  it("a publisher or admin cannot use the advertiser action (stops at the role check, before the database)", async () => {
    for (const role of ["publisher", "admin"]) {
      advFake.reset();
      advFake.role = role;
      const r = await update({ country: "IN" });
      assert.equal(r.redirect, "/dashboard", role);
      assert.equal(advFake.updates.length, 0, role);
    }
  });

  it("no advertiser row yet: asks to set up the business first (nothing else is created)", async () => {
    advFake.updateRows = 0;
    const r = await update({ country: "IN" });
    assert.equal(r.state?.status, "error");
    assert.match(r.state?.message ?? "", /set up your business/i);
    assert.equal(advFake.inserts.length, 0);
    assert.deepEqual(advFake.revalidated, []);
  });

  it("database failure: friendly message, only the error code is logged", async () => {
    for (const [code, expect] of [["23514", /choose your country/i], ["42501", /not allowed/i], ["XX000", /could not save/i]] as const) {
      advFake.reset();
      logged = [];
      advFake.updateError = { code, message: "SECRET internal detail" };
      const r = await update({ country: "IN" });
      assert.equal(r.state?.status, "error", code);
      assert.match(r.state?.message ?? "", expect, code);
      assert.ok(!JSON.stringify([r.state, logged]).includes("SECRET"), code);
      assert.deepEqual(advFake.revalidated, [], code);
    }
  });
});

describe("migration (static checks; never run anywhere)", () => {
  const FILE = "supabase/sql/phase6-step3-1-advertiser-country.sql";
  const sql = read(FILE);
  const code = sql.replace(/^\s*--.*$/gm, "");

  it("adds exactly one nullable column to advertisers, additive only", () => {
    assert.equal((code.match(/add column if not exists/g) ?? []).length, 1);
    assert.match(code, /alter table public\.advertisers add column if not exists country_code text;/);
    assert.ok(!/not null/i.test(code.split("add column")[1].split(";")[0]));
    assert.ok(!/drop table|drop column|truncate|delete from|update public\.advertisers\s+set/i.test(code));
  });

  it("shape check is two capital letters (null allowed); SQL has no ISO list and no region mapping", () => {
    assert.match(code, /country_code is null or country_code ~ '\^\[A-Z\]\{2\}\$'/);
    assert.ok(!/'(US|GB|IN|DE|FR|AU)'\s*,\s*'[A-Z]{2}'/.test(code));
    assert.ok(!/north_america|western_europe|southeast_asia|rest_of_world|south_asia|middle_east/.test(code));
  });

  it("only UPDATE on country_code is granted to authenticated: no INSERT grant, no status / profile grant, no anon / public", () => {
    const grants = code.match(/grant[^;]*;/gi) ?? [];
    assert.deepEqual(grants.map((g) => g.replace(/\s+/g, " ")), ["grant update (country_code) on public.advertisers to authenticated;"]);
    assert.ok(!/revoke|create policy|drop policy|create trigger|create or replace function/i.test(code));
  });

  it("runs in one transaction and does not touch payments, billing, pricing, campaigns or publishers", () => {
    assert.match(code, /^\s*begin;/m);
    assert.match(code, /^\s*commit;/m);
    assert.ok(!/ledger|payout|payment|cpm|cpc|currency|campaigns|publishers/i.test(code));
    assert.match(sql, /PRODUCTION PAR ABHI NAHI/);
    assert.match(sql, /kisi database par chalayi NAHI gayi/);
  });

  it("is listed in MIGRATION-ORDER as TEST-first and not applied on Production, after row 43", () => {
    const order = read("supabase/MIGRATION-ORDER.md");
    assert.match(order, /\| 44 \| phase6-step3-1 .*TEST first/);
    assert.match(order, /\| 44 \| phase6-step3-1 .*NOT applied on Production/);
    assert.ok(order.indexOf("| 44 |") > order.indexOf("| 43 |"));
    assert.ok(order.indexOf("| 44 |") < order.indexOf("| end |"));
  });
});

describe("no duplicate country mapping; pricing, payments, auth untouched", () => {
  const newFiles = [
    "lib/regions/advertiser-country.ts",
    "lib/advertiser/country-queries.ts",
    "app/dashboard/advertiser/country-actions.ts",
    "components/dashboard/AdvertiserCountryForm.tsx",
  ];

  it("new modules define no country or region lists of their own and import the central mapping", () => {
    assert.match(read("lib/regions/advertiser-country.ts"), /from "\.\/country-region"/);
    assert.match(read("lib/regions/advertiser-country.ts"), /from "\.\/publisher-country"/);
    for (const f of [...newFiles, "app/dashboard/account/actions.ts", "components/dashboard/AccountSetupForm.tsx"]) {
      const src = read(f);
      assert.ok(!/NAMED_REGION_COUNTRIES|COUNTRY_TO_REGION|ISO_COUNTRY_CODES\s*[:=]/.test(src), f);
      assert.ok(!/\[(\s*"[A-Z]{2}"\s*,){3,}/.test(src), f);
    }
    assert.ok(!/(north_america|western_europe|southeast_asia)/.test(read("lib/regions/advertiser-country.ts").replace(/^\s*\/\/.*$/gm, "")));
  });

  it("new code never mentions pricing, billing, payments, ledger or payouts", () => {
    for (const f of newFiles) {
      const code = read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      assert.ok(!/cpm|cpc|ledger|payout|payment|stripe|razorpay|usd|currency/i.test(code), f);
    }
  });

  it("the advertiser country is never written by the ad-serving side and the central mapping file is unchanged in shape", () => {
    for (const f of ["lib/ads/serve.ts", "lib/ads/service.ts"]) assert.ok(!/country_code|advertiser-country/.test(read(f)), f);
    assert.match(read("lib/regions/country-region.ts"), /export const REGION_IDS = \[/);
    assert.equal((read("lib/regions/country-region.ts").match(/^  "[a-z_]+",$/gm) ?? []).length, 8);
  });

  it("campaign targeting inputs are still valid: an advertiser region is always usable as a campaign target region", () => {
    for (const code of ["US", "GB", "IN", "AE", "SG", "AU", "FR", "BR"]) {
      const region = advertiserRegion(code);
      assert.ok(region && (REGION_IDS as readonly string[]).includes(region), code);
    }
  });
});
