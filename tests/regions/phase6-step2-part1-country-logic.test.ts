import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ISO_COUNTRY_CODES, REGION_IDS, regionForCountry } from "../../lib/regions/country-region";
import {
  COUNTRY_STATUS_LABELS,
  COUNTRY_VERIFICATION_STATUSES,
  countryOptions,
  effectiveCampaignRegions,
  isCountryReviewDecision,
  isPublisherEligibleForCampaignRegions,
  mapCountryError,
  parseCountrySubmission,
  publisherRegionalEligibility,
  toPublisherCountry,
} from "../../lib/regions/publisher-country";
import { parsePublisherSetup } from "../../lib/accounts/validation";
import {
  isRegionalEligibilityEnforced,
  parseCountryStateResult,
  regionalGateOutcome,
} from "../../lib/ads/regional-eligibility";

// Phase 6 Step 2 Part 1: pure tests. Koi database / network nahi.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const verified = (code: unknown) => ({ countryCode: code, status: "verified" });

describe("Part 1 task 1: country submission uses ISO alpha-2 from the central module", () => {
  it("accepts every official ISO code (trimmed, any case) and returns the central region", () => {
    for (const code of ISO_COUNTRY_CODES) {
      const r = parseCountrySubmission(` ${code.toLowerCase()} `);
      assert.ok(r.ok, code);
      if (r.ok) {
        assert.equal(r.countryCode, code);
        assert.equal(r.region, regionForCountry(code));
      }
    }
  });

  it("rejects bad format, non-ISO codes and non-strings", () => {
    for (const bad of ["", " ", "U", "USA", "U1", "1A", "U S", "XX", "UK", "EU", "ZZ", null, undefined, 5, {}, ["US"]]) {
      assert.equal(parseCountrySubmission(bad).ok, false, String(bad));
    }
  });

  it("dropdown options come from the central ISO list: 249 options, one per code, no extras", () => {
    const options = countryOptions();
    assert.equal(options.length, ISO_COUNTRY_CODES.length);
    assert.deepEqual(options.map((o) => o.value).sort(), [...ISO_COUNTRY_CODES].sort());
  });

  it("publisher setup parser is unchanged (country is checked in the server action, so the preview-route module graph stays the same)", () => {
    const none = parsePublisherSetup({ name: "Bot", websiteUrl: "", category: "" });
    assert.ok(none.ok);
    if (none.ok) assert.deepEqual(none.value, { name: "Bot", websiteUrl: null, category: null }); // purana shape bilkul same
    assert.ok(!/regions|publisher-country/.test(read("lib/accounts/validation.ts").replace(/^\s*\/\/.*$/gm, "")));
  });
});

describe("Part 1 task 2: workflow statuses", () => {
  it("exactly pending, verified, rejected with labels; decisions approve/reject only", () => {
    assert.deepEqual([...COUNTRY_VERIFICATION_STATUSES], ["pending", "verified", "rejected"]);
    assert.deepEqual(Object.keys(COUNTRY_STATUS_LABELS), ["pending", "verified", "rejected"]);
    assert.ok(isCountryReviewDecision("approve") && isCountryReviewDecision("reject"));
    for (const bad of ["verified", "rejected", "pending", "", null, 1]) assert.equal(isCountryReviewDecision(bad), false);
  });

  it("database row -> typed state; garbage never becomes verified", () => {
    assert.deepEqual(toPublisherCountry({ country_code: null, country_status: null }), { countryCode: null, status: null, submittedAt: null, reviewedAt: null });
    assert.equal(toPublisherCountry({ country_code: "IN", country_status: "verified" })?.status, "verified");
    for (const bad of [null, undefined, 5, "x", { country_code: "IN", country_status: "approved" }, { country_code: 7, country_status: "verified" }, { country_code: null, country_status: "verified" }]) {
      assert.equal(toPublisherCountry(bad), null, JSON.stringify(bad));
    }
  });
});

describe("Part 1 task 4: only a verified, valid country gets regional eligibility", () => {
  it("verified + valid => eligible with the central region, for every ISO code", () => {
    for (const code of ISO_COUNTRY_CODES) {
      const r = publisherRegionalEligibility(verified(code));
      assert.deepEqual(r, { eligible: true, countryCode: code, region: regionForCountry(code) }, code);
    }
  });

  it("pending, rejected, missing and invalid are never eligible (no silent Rest of World)", () => {
    assert.deepEqual(publisherRegionalEligibility({ countryCode: "IN", status: "pending" }), { eligible: false, reason: "pending" });
    assert.deepEqual(publisherRegionalEligibility({ countryCode: "IN", status: "rejected" }), { eligible: false, reason: "rejected" });
    assert.deepEqual(publisherRegionalEligibility({ countryCode: null, status: "pending" }), { eligible: false, reason: "pending" });
    for (const missing of [null, undefined, 5, "IN", {}, { countryCode: null, status: null }, { countryCode: "IN", status: null }, { countryCode: "IN", status: "approved" }, { countryCode: null, status: "verified" }, { countryCode: "IN" }]) {
      assert.deepEqual(publisherRegionalEligibility(missing), { eligible: false, reason: "missing" }, JSON.stringify(missing));
    }
    for (const invalid of ["XX", "UK", "ZZ", "USA", "", " ", "in ", 5, {}, ["IN"]]) {
      const r = publisherRegionalEligibility(verified(invalid));
      // "in " trim ke baad theek hai (central resolver trim karta hai); baaki sab invalid
      if (invalid === "in ") assert.equal(r.eligible, true);
      else assert.deepEqual(r, { eligible: false, reason: "invalid_country" }, JSON.stringify(invalid));
    }
  });

  it("campaign with no region selected is eligible only in Rest of World", () => {
    for (const none of [undefined, null, []]) assert.deepEqual(effectiveCampaignRegions(none), ["rest_of_world"]);
    const row = verified("BR"); // Brazil = rest_of_world
    const us = verified("US");
    for (const none of [undefined, null, []]) {
      assert.equal(isPublisherEligibleForCampaignRegions(row, none), true);
      assert.equal(isPublisherEligibleForCampaignRegions(us, none), false);
      assert.equal(isPublisherEligibleForCampaignRegions(verified("IN"), none), false);
    }
  });

  it("selected regions: match only the publisher's central region; unknown ids fail closed", () => {
    assert.equal(isPublisherEligibleForCampaignRegions(verified("US"), ["north_america"]), true);
    assert.equal(isPublisherEligibleForCampaignRegions(verified("US"), ["uk", "south_asia"]), false);
    assert.equal(isPublisherEligibleForCampaignRegions(verified("GB"), ["uk"]), true);
    assert.equal(isPublisherEligibleForCampaignRegions(verified("US"), ["asia", "", null, 3]), false);
    assert.deepEqual(effectiveCampaignRegions(["asia", "", null, 3]), []);
    assert.deepEqual(effectiveCampaignRegions(["uk", "bogus"]), ["uk"]);
    for (const r of REGION_IDS) assert.ok(effectiveCampaignRegions([r]).length === 1);
  });

  it("no regional eligibility for pending / rejected / missing / invalid, whatever the campaign targets", () => {
    const all = [...REGION_IDS];
    for (const info of [
      { countryCode: "US", status: "pending" },
      { countryCode: "US", status: "rejected" },
      { countryCode: null, status: null },
      null,
      undefined,
      verified("XX"),
      verified("UK"),
    ]) {
      assert.equal(isPublisherEligibleForCampaignRegions(info, all), false, JSON.stringify(info));
      assert.equal(isPublisherEligibleForCampaignRegions(info, undefined), false, JSON.stringify(info));
      assert.equal(isPublisherEligibleForCampaignRegions(info, []), false, JSON.stringify(info));
    }
  });
});

describe("Part 1: serving gate helpers", () => {
  it("flag is on only for the exact value 1", () => {
    assert.equal(isRegionalEligibilityEnforced({ REGIONAL_ELIGIBILITY_ENFORCED: "1" }), true);
    for (const v of [undefined, "", "0", "true", "yes", " 1", "1 ", "01"]) {
      assert.equal(isRegionalEligibilityEnforced({ REGIONAL_ELIGIBILITY_ENFORCED: v }), false, String(v));
    }
    assert.equal(isRegionalEligibilityEnforced({}), false);
  });

  it("database state -> gate outcome: only verified + valid is eligible, unreadable is error (fail closed)", () => {
    const gate = (d: unknown) => regionalGateOutcome(parseCountryStateResult(d));
    assert.equal(gate({ country_status: "verified", country_code: "IN" }), "eligible");
    assert.equal(gate([{ country_status: "verified", country_code: "US" }]), "eligible");
    assert.equal(gate({ country_status: "pending", country_code: null }), "ineligible");
    assert.equal(gate({ country_status: "rejected", country_code: null }), "ineligible");
    assert.equal(gate({ country_status: null, country_code: null }), "ineligible");
    assert.equal(gate({ country_status: "verified", country_code: "XX" }), "ineligible");
    assert.equal(gate({ country_status: "verified", country_code: null }), "ineligible");
    for (const bad of [null, undefined, "x", 5, [], [{}, {}], { country_status: "approved", country_code: "IN" }, { country_code: "IN" }, { country_status: "verified", country_code: 5 }]) {
      assert.equal(gate(bad), "error", JSON.stringify(bad));
    }
    assert.equal(regionalGateOutcome(null), "error");
  });
});

describe("Part 1: error messages never leak raw database text", () => {
  it("maps hints and codes to fixed messages", () => {
    assert.match(mapCountryError({ hint: "self_approval_blocked" }), /own account/);
    assert.match(mapCountryError({ hint: "country_changed" }), /changed the country/);
    assert.match(mapCountryError({ code: "42501" }), /not allowed/);
    assert.match(mapCountryError({ code: "P0002" }), /set up your platform/i);
    assert.match(mapCountryError({ code: "XXXXX", hint: "sql: relation x does not exist" }), /could not save/i);
    assert.match(mapCountryError(null), /could not save/i);
  });
});

describe("Part 1: no duplicate country mapping, nothing else touched", () => {
  const newFiles = [
    "lib/regions/publisher-country.ts",
    "lib/ads/regional-eligibility.ts",
    "lib/ads/publisher-country-db.ts",
    "lib/publisher/country-queries.ts",
    "app/dashboard/publisher/country-actions.ts",
    "app/dashboard/admin/country-actions.ts",
    "components/admin/PublisherCountryPanel.tsx",
    "components/admin/PublisherCountryReviewButton.tsx",
    "components/dashboard/PublisherCountryForm.tsx",
  ];

  it("new modules import the central mapping and define no country or region lists of their own", () => {
    assert.match(read("lib/regions/publisher-country.ts"), /from "\.\/country-region"/);
    for (const f of newFiles) {
      const src = read(f);
      assert.ok(!/NAMED_REGION_COUNTRIES|COUNTRY_TO_REGION|ISO_COUNTRY_CODES\s*[:=]/.test(src), f);
      // koi hand-likhi country code list nahi (teen+ quoted 2-letter codes ek array me)
      assert.ok(!/\[(\s*"[A-Z]{2}"\s*,){3,}/.test(src), f);
    }
    assert.ok(!/(north_america|western_europe|southeast_asia)/.test(read("lib/regions/publisher-country.ts").replace(/^\s*\/\/.*$/gm, "")));
  });

  it("the central mapping file itself is unchanged by this part", () => {
    const src = read("lib/regions/country-region.ts");
    assert.equal((src.match(/north_america: \["US", "CA", "MX"\]/g) ?? []).length, 1);
    assert.equal(/country_status|publisher/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), false);
  });

  it("pricing, payments, ledger and payout code do not mention countries", () => {
    for (const dir of ["lib/payments", "lib/payouts", "lib/ledger"]) {
      for (const f of ["cashfree.ts", "razorpay.ts", "money.ts", "payments-db.ts", "rules.ts", "settlements.ts", "revenue-share.ts", "ledger-db.ts"]) {
        let src: string;
        try {
          src = read(`${dir}/${f}`);
        } catch {
          continue;
        }
        assert.equal(/country_code|country_status|publisher-country|regional-eligibility/.test(src), false, `${dir}/${f}`);
      }
    }
  });

  it("no NEXT_PUBLIC variable and no service-role key in the new browser-facing files", () => {
    for (const f of ["components/admin/PublisherCountryReviewButton.tsx", "components/dashboard/PublisherCountryForm.tsx"]) {
      const src = read(f);
      assert.ok(!/NEXT_PUBLIC_|SERVICE_ROLE|SUPABASE_SECRET|createAdminClient/.test(src), f);
    }
  });
});
