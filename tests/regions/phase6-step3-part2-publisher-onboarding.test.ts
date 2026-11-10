import { countryFake } from "./country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { submitPublisherCountry } from "@/app/dashboard/publisher/country-actions";
import { initialRunState } from "@/lib/campaigns/types";
import { ISO_COUNTRY_CODES, REGION_IDS, regionForCountry, type RegionId } from "@/lib/regions/country-region";
import { isPublisherEligibleForCampaignRegions, publisherRegionalEligibility, toPublisherCountry } from "@/lib/regions/publisher-country";

// Phase 6 Step 3 Part 2: international publisher onboarding. Step 2 ka maujooda verification workflow REUSE hota hai (koi doosra workflow nahi).
// Nakli Supabase; asli database kabhi nahi.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const settle = <T,>(p: Promise<T>) =>
  p.then(
    (r) => ({ threw: false as const, r }),
    (e: Error) => ({ threw: true as const, message: e.message }),
  );
const base = { name: "Chat Bot", websiteUrl: "https://bot.example.com", category: "" };
const setup = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...fields })) f.set(k, v);
  return settle(setupPublisher({ status: "idle" }, f));
};
const resubmit = (country: string) => {
  const f = new FormData();
  f.set("country", country);
  return settle(submitPublisherCountry(initialRunState, f));
};

beforeEach(() => {
  countryFake.reset();
  console.error = () => {};
});

describe("task 1: publisher picks a country at registration (ISO alpha-2, central list)", () => {
  it("every officially assigned ISO code is accepted at setup and goes ONLY through submit_publisher_country (never into the insert)", async () => {
    for (const code of ISO_COUNTRY_CODES) {
      countryFake.reset();
      const out = await setup({ country: code.toLowerCase() });
      assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard/publisher?setup=1" }, code);
      assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: code } }], code);
      assert.deepEqual(Object.keys(countryFake.inserts[0].payload).sort(), ["category", "name", "profile_id", "website_url"], code);
    }
  });

  it("invalid codes are rejected before the database: no insert, no rpc, no silent region", async () => {
    for (const bad of ["UK", "XX", "ZZ", "USA", "U", "1A", "Germany", "A B"]) {
      countryFake.reset();
      const out = await setup({ country: bad });
      assert.equal(out.threw, false, bad);
      if (!out.threw) assert.ok((out.r as { fieldErrors?: Record<string, string> }).fieldErrors?.country, bad);
      assert.equal(countryFake.inserts.length, 0, bad);
      assert.equal(countryFake.rpcCalls.length, 0, bad);
    }
  });

  it("country stays optional: no country => same flow as before (existing registration is not blocked)", async () => {
    const out = await setup({});
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard/publisher?setup=1" });
    assert.equal(countryFake.rpcCalls.length, 0);
  });

  it("forged status / verified / admin fields at setup are never forwarded", async () => {
    await setup({ country: "IN", status: "active", country_status: "verified", verified: "true", country_reviewed_by: "x" });
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "IN" } }]);
    assert.ok(!("status" in countryFake.inserts[0].payload));
  });
});

describe("task 2: Step 2 workflow is reused (pending -> verified / rejected); only verified counts", () => {
  const row = (code: string | null, status: string | null) => ({ country_code: code, country_status: status });

  it("submitted => pending => NOT eligible; rejected => NOT eligible; missing => NOT eligible", () => {
    const pending = toPublisherCountry(row("IN", "pending"));
    const rejected = toPublisherCountry(row("IN", "rejected"));
    const missing = toPublisherCountry(row(null, null));
    assert.deepEqual(publisherRegionalEligibility(pending), { eligible: false, reason: "pending" });
    assert.deepEqual(publisherRegionalEligibility(rejected), { eligible: false, reason: "rejected" });
    assert.deepEqual(publisherRegionalEligibility(missing), { eligible: false, reason: "missing" });
    assert.deepEqual(publisherRegionalEligibility(null), { eligible: false, reason: "missing" });
    assert.deepEqual(publisherRegionalEligibility(undefined), { eligible: false, reason: "missing" });
  });

  it("verified with a valid ISO country => eligible with the region from the central mapping", () => {
    const e = publisherRegionalEligibility(toPublisherCountry(row("IN", "verified")));
    assert.deepEqual(e, { eligible: true, countryCode: "IN", region: "south_asia" });
  });

  it("verified but invalid / non-ISO code => invalid_country, never Rest of World", () => {
    for (const bad of ["XX", "UK", "ZZ", "USA", "I", ""]) {
      const e = publisherRegionalEligibility({ countryCode: bad, status: "verified" });
      assert.deepEqual(e, { eligible: false, reason: "invalid_country" }, bad);
    }
  });

  it("a wrong row shape is a load failure (null), never 'verified'", () => {
    assert.equal(toPublisherCountry({ country_code: "IN", country_status: "approved" }), null);
    assert.equal(toPublisherCountry({ country_code: 5, country_status: "verified" }), null);
    assert.equal(toPublisherCountry(null), null);
  });

  it("no second approval workflow: Step 3 adds no SQL, no admin action and no publisher status of its own", () => {
    const sqlFiles = readdirSync(path.join(ROOT, "supabase", "sql"));
    assert.deepEqual(sqlFiles.filter((f) => /^phase6-step3-2/.test(f)), []);
    const adminFiles = readdirSync(path.join(ROOT, "app", "dashboard", "admin"));
    assert.deepEqual(adminFiles.filter((f) => /country/.test(f)), ["country-actions.ts"]);
    const page = strip(read("app/dashboard/page.tsx"));
    assert.ok(!/admin_review_publisher_country|country_status\s*[:=]|\.update\(|\.rpc\(/.test(page.replace(/pendingCount[\s\S]*?\n}\n/, "")));
  });
});

describe("task 3: publisher sees status and can correct a rejected country (existing authorization rules)", () => {
  it("re-submission after a rejection goes through submit_publisher_country with ONLY the normalized code", async () => {
    const out = await resubmit(" gb ");
    assert.equal(out.threw, false);
    assert.deepEqual(countryFake.rpcCalls, [{ name: "submit_publisher_country", args: { p_country_code: "GB" } }]);
    assert.deepEqual(countryFake.roleCalls, [["publisher"]]);
    assert.equal(countryFake.inserts.length, 0);
  });

  it("invalid re-submission is stopped before the database; a non-publisher stops at the role check", async () => {
    for (const bad of ["", "UK", "XX"]) assert.equal((await resubmit(bad)).threw === false && countryFake.rpcCalls.length === 0, true, bad);
    countryFake.role = "advertiser";
    const out = await resubmit("IN");
    assert.deepEqual(out, { threw: true, message: "REDIRECT:/dashboard" });
    assert.equal(countryFake.rpcCalls.length, 0);
  });

  it("publisher page shows country + status and a rejection / pending hint, with the resubmit button for rejected", () => {
    const page = read("app/dashboard/publisher/page.tsx");
    assert.match(page, /COUNTRY_STATUS_LABELS\[country\.status\]/);
    assert.match(page, /Submit a different country/);
    assert.match(page, /Your country was not accepted\. Choose the correct country and submit it again/);
    assert.match(page, /Our team is checking your country/);
  });
});

describe("task 4: verified countries resolve into the existing eight regions", () => {
  it("every ISO country, once verified, is eligible in exactly the region of the central mapping, and it is one of the 8 regions", () => {
    const seen = new Set<RegionId>();
    for (const code of ISO_COUNTRY_CODES) {
      const e = publisherRegionalEligibility({ countryCode: code, status: "verified" });
      assert.equal(e.eligible, true, code);
      if (e.eligible) {
        assert.equal(e.region, regionForCountry(code), code);
        assert.ok((REGION_IDS as readonly string[]).includes(e.region), code);
        seen.add(e.region);
      }
    }
    assert.deepEqual([...seen].sort(), [...REGION_IDS].sort());
    assert.equal(REGION_IDS.length, 8);
  });

  it("same country, other status => never eligible for any campaign target (No Fill rules unchanged)", () => {
    for (const status of ["pending", "rejected", null, undefined, "approved", ""]) {
      for (const regions of [null, [], ["south_asia"], ["rest_of_world"], [...REGION_IDS]]) {
        assert.equal(isPublisherEligibleForCampaignRegions({ countryCode: "IN", status }, regions), false, `${status}/${JSON.stringify(regions)}`);
      }
    }
    assert.equal(isPublisherEligibleForCampaignRegions({ countryCode: "IN", status: "verified" }, ["south_asia"]), true);
    assert.equal(isPublisherEligibleForCampaignRegions({ countryCode: "IN", status: "verified" }, ["north_america"]), false);
    assert.equal(isPublisherEligibleForCampaignRegions({ countryCode: "IN", status: "verified" }, null), false); // null = sirf Rest of World
    assert.equal(isPublisherEligibleForCampaignRegions({ countryCode: "BR", status: "verified" }, null), true);
  });
});

describe("task 5 + new-login country option: existing publishers and first login", () => {
  it("an existing publisher (all country columns null) is a normal 'no country' state, not an error and not re-registration", () => {
    assert.deepEqual(toPublisherCountry({ country_code: null, country_status: null }), { countryCode: null, status: null, submittedAt: null, reviewedAt: null });
  });

  it("overview (the page every login lands on) shows the country option for a NEW advertiser and a NEW publisher, with the real setup forms", () => {
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /!adv && !advertiserFailed[\s\S]*?<AdvertiserSetupForm countryOptions=\{countryOptions\(\)\}/);
    assert.match(page, /!pub && \([\s\S]*?<PublisherSetupForm countryOptions=\{countryOptions\(\)\}/);
  });

  it("overview asks existing accounts without a country to choose one (advertiser) / submit one (publisher; rejected too)", () => {
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /advCountry\.countryCode === null[\s\S]*?<AdvertiserCountryForm/);
    assert.match(page, /pubCountry\.status === null \|\| pubCountry\.status === "rejected"/);
    assert.match(page, /<PublisherCountryForm[\s\S]*?Submit a different country/);
  });

  it("the prompts never appear when the load failed or the account is suspended (no wrong form, no nagging)", () => {
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /adv && adv\.status !== "suspended" \? await loadMyAdvertiserCountry\(\) : null/);
    assert.match(page, /pub && pub\.status !== "suspended" \? await loadMyPublisherCountry\(\) : null/);
    assert.match(page, /advCountry !== null && advCountry\.countryCode === null/);
    assert.match(page, /pubCountry !== null && \(/);
  });

  it("new code in this part never mentions pricing, billing, payouts or the ledger, and defines no country / region list", () => {
    const page = strip(read("app/dashboard/page.tsx"));
    assert.ok(!/cpm|cpc|ledger|payout|payment|usd|currency/i.test(page));
    assert.ok(!/NAMED_REGION_COUNTRIES|COUNTRY_TO_REGION|ISO_COUNTRY_CODES\s*[:=]/.test(page));
    assert.ok(!/\[(\s*"[A-Z]{2}"\s*,){3,}/.test(page));
  });
});
