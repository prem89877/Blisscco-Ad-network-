import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ISO_COUNTRY_CODES,
  NAMED_REGION_COUNTRIES,
  REGION_IDS,
  REGION_LABELS,
  countriesInRegion,
  isCountryInTargetRegions,
  isRegionId,
  isSupportedCountryCode,
  normalizeCountryCode,
  regionForCountry,
  resolveCountry,
} from "../../lib/regions/country-region";

// Phase 6 Step 1: country -> region mapping. Pure tests, koi database/network nahi.

describe("Phase 6 Step 1: regions", () => {
  it("has exactly the 8 owner-defined regions with labels", () => {
    assert.deepEqual([...REGION_IDS], [
      "north_america", "uk", "western_europe", "australia",
      "middle_east", "south_asia", "southeast_asia", "rest_of_world",
    ]);
    assert.deepEqual(Object.values(REGION_LABELS), [
      "North America", "UK", "Western Europe", "Australia",
      "Middle East", "South Asia", "Southeast Asia", "Rest of World",
    ]);
  });

  it("isRegionId accepts only the 8 ids", () => {
    for (const id of REGION_IDS) assert.ok(isRegionId(id));
    for (const bad of ["", "asia", "NORTH_AMERICA", null, 5, undefined]) assert.equal(isRegionId(bad), false);
  });
});

describe("Phase 6 Step 1: mapping integrity", () => {
  it("ISO list has 249 unique, well-formed codes", () => {
    assert.equal(ISO_COUNTRY_CODES.length, 249);
    assert.equal(new Set(ISO_COUNTRY_CODES).size, 249);
    for (const c of ISO_COUNTRY_CODES) assert.match(c, /^[A-Z]{2}$/);
  });

  it("named regions have no duplicate assignments and only ISO codes", () => {
    const seen = new Set<string>();
    for (const list of Object.values(NAMED_REGION_COUNTRIES)) {
      for (const c of list) {
        assert.ok(ISO_COUNTRY_CODES.includes(c), `${c} not ISO`);
        assert.ok(!seen.has(c), `${c} assigned twice`);
        seen.add(c);
      }
    }
  });

  it("every supported country maps to exactly one region, and regions partition the ISO list", () => {
    let total = 0;
    for (const region of REGION_IDS) total += countriesInRegion(region).length;
    assert.equal(total, ISO_COUNTRY_CODES.length);
    for (const c of ISO_COUNTRY_CODES) {
      const hits = REGION_IDS.filter((r) => countriesInRegion(r).includes(c));
      assert.equal(hits.length, 1, c);
      assert.equal(regionForCountry(c), hits[0]);
    }
  });

  it("every region has at least one country", () => {
    for (const r of REGION_IDS) assert.ok(countriesInRegion(r).length > 0, r);
  });
});

describe("Phase 6 Step 1: valid country mapping", () => {
  it("matches the owner-approved assignments exactly", () => {
    assert.deepEqual(NAMED_REGION_COUNTRIES, {
      north_america: ["US", "CA", "MX"],
      uk: ["GB"],
      western_europe: ["DE", "FR", "NL", "BE", "AT", "CH", "IE", "ES", "PT", "IT", "LU", "GR", "CY"],
      australia: ["AU", "NZ"],
      middle_east: ["AE", "SA", "QA", "KW", "BH", "OM", "TR", "EG", "IR", "SY", "JO", "IQ", "LB", "IL"],
      south_asia: ["IN", "PK", "BD", "LK", "NP", "BT", "MV", "AF"],
      southeast_asia: ["SG", "MY", "ID", "TH", "PH", "VN", "KH", "LA", "MM", "BN", "TL"],
    });
  });

  it("maps every approved country to its region", () => {
    for (const region of Object.keys(NAMED_REGION_COUNTRIES) as Array<keyof typeof NAMED_REGION_COUNTRIES>) {
      for (const c of NAMED_REGION_COUNTRIES[region]) assert.equal(regionForCountry(c), region, c);
    }
    assert.equal(regionForCountry("MX"), "north_america");
    assert.equal(regionForCountry("NZ"), "australia");
    assert.equal(regionForCountry("TR"), "middle_east");
  });

  it("maps all remaining valid countries to rest_of_world", () => {
    for (const c of ["BR", "JP", "ZA", "CN", "RU", "DK", "SE", "NO", "YE", "PS", "AD", "GG", "AR"]) {
      assert.equal(regionForCountry(c), "rest_of_world", c);
    }
    const named = new Set(Object.values(NAMED_REGION_COUNTRIES).flat());
    assert.deepEqual(countriesInRegion("rest_of_world"), ISO_COUNTRY_CODES.filter((c) => !named.has(c)));
  });

  it("normalizes case and surrounding whitespace", () => {
    assert.equal(normalizeCountryCode(" us "), "US");
    assert.equal(regionForCountry("gb"), "uk");
    assert.deepEqual(resolveCountry(" in\n"), { ok: true, countryCode: "IN", region: "south_asia" });
  });
});

describe("Phase 6 Step 1: invalid and unsupported codes", () => {
  it("invalid format returns no region", () => {
    for (const bad of ["", " ", "U", "USA", "U1", "1A", "U-", "U S", null, undefined, 12, {}, ["US"], true]) {
      const r = resolveCountry(bad);
      assert.deepEqual(r, { ok: false, reason: "invalid_format" }, String(bad));
      assert.equal(regionForCountry(bad), null);
      assert.equal(isSupportedCountryCode(bad), false);
    }
  });

  it("well-formed but non-ISO codes are unsupported, never rest_of_world", () => {
    for (const bad of ["XX", "ZZ", "AA", "QQ", "UK", "EU", "AN", "YU"]) {
      assert.deepEqual(resolveCountry(bad), { ok: false, reason: "unsupported_country" }, bad);
      assert.equal(regionForCountry(bad), null, bad);
      assert.equal(isSupportedCountryCode(bad), false);
    }
  });
});

describe("Phase 6 Step 1: advertiser / publisher consistency", () => {
  it("same country gives the same region for targeting and publisher identification", () => {
    for (const c of ISO_COUNTRY_CODES) {
      const publisherRegion = regionForCountry(c);
      assert.ok(publisherRegion);
      assert.ok(isCountryInTargetRegions(c, [publisherRegion]), c);
      for (const other of REGION_IDS.filter((r) => r !== publisherRegion)) {
        assert.equal(isCountryInTargetRegions(c, [other]), false, `${c} vs ${other}`);
      }
    }
  });

  it("invalid/unsupported countries and bad targets get no eligibility", () => {
    const all = [...REGION_IDS];
    for (const bad of ["XX", "USA", "", null, undefined]) assert.equal(isCountryInTargetRegions(bad, all), false);
    assert.equal(isCountryInTargetRegions("US", []), false);
    assert.equal(isCountryInTargetRegions("US", ["asia", "", null, 3]), false);
    assert.equal(isCountryInTargetRegions("US", ["asia", "north_america"]), true);
  });
});
