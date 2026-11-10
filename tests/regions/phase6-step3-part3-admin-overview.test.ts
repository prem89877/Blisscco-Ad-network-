import { overviewFake } from "./admin-overview-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ADMIN_COUNTRY_ROW_LIMIT, loadAdminCountryOverview } from "@/lib/regions/admin-country-queries";
import {
  classifyAdvertiserCountry,
  classifyPublisherCountry,
  describeAdvertiserCountry,
  describePublisherCountry,
  summarizeAdvertiserCountries,
  summarizePublisherCountries,
  toAdminAdvertiserRow,
  toAdminPublisherRow,
} from "@/lib/regions/admin-country-overview";
import { regionForCountry } from "@/lib/regions/country-region";

// Phase 6 Step 3 Part 3: Admin country overview (padhne wala). Nakli Supabase; asli database kabhi nahi.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

beforeEach(() => overviewFake.reset());

describe("advertiser country state (admin view)", () => {
  it("valid ISO code => valid + region from the central mapping; international examples", () => {
    for (const code of ["IN", "US", "GB", "DE", "BR", "JP", "AE", "NG", "AU"]) {
      const c = classifyAdvertiserCountry(code);
      assert.equal(c.state, "valid", code);
      assert.equal(c.countryCode, code);
      assert.equal(c.region, regionForCountry(code), code);
      assert.notEqual(c.region, null, code);
    }
  });

  it("null / undefined / blank => missing (old advertisers are not an error)", () => {
    for (const v of [null, undefined, "", "   "]) assert.equal(classifyAdvertiserCountry(v).state, "missing");
  });

  it("not an ISO code => invalid, NO region (never silent Rest of World)", () => {
    for (const bad of ["UK", "XX", "ZZ", "USA", "1A", "U", 5, {}]) {
      const c = classifyAdvertiserCountry(bad);
      assert.equal(c.state, "invalid", String(bad));
      assert.equal(c.region, null, String(bad));
    }
  });

  it("row mapping: legacy row without the column is missing + needs attention; wrong shape is skipped", () => {
    const legacy = toAdminAdvertiserRow({ id: "a1", company_name: "Glow", status: "active" });
    assert.equal(legacy?.state, "missing");
    assert.equal(legacy?.incompleteOrInvalid, true);
    assert.equal(legacy?.accountStatus, "active");
    assert.equal(toAdminAdvertiserRow({ id: "a1", status: "active" }), null);
    assert.equal(toAdminAdvertiserRow(null), null);
    const ok = toAdminAdvertiserRow({ id: "a2", company_name: "Rangoli", status: "pending", country_code: "IN" });
    assert.equal(ok?.incompleteOrInvalid, false);
    assert.equal(ok && describeAdvertiserCountry(ok), "India (IN) · South Asia");
  });
});

describe("publisher country state (admin view): pending, verified, rejected + incomplete / invalid", () => {
  const row = (code: unknown, status: unknown) => toAdminPublisherRow({ id: "p1", name: "Pub", status: "active", country_code: code, country_status: status });

  it("pending / verified / rejected with an ISO code keep their Step 2 status; ONLY verified is regional-eligible", () => {
    const pending = row("IN", "pending");
    const verified = row("IN", "verified");
    const rejected = row("IN", "rejected");
    assert.deepEqual([pending?.state, verified?.state, rejected?.state], ["pending", "verified", "rejected"]);
    assert.deepEqual([pending?.regionalEligible, verified?.regionalEligible, rejected?.regionalEligible], [false, true, false]);
    assert.equal(pending?.awaitingReview, true);
    assert.equal(verified?.awaitingReview, false);
    assert.equal(rejected?.awaitingReview, false);
    assert.equal(pending?.incompleteOrInvalid, false);
    assert.equal(verified?.region, "south_asia");
    assert.equal(verified && describePublisherCountry(verified), "India (IN) · South Asia · Verified");
  });

  it("legacy publisher (both null / columns absent) => missing, not eligible, needs attention", () => {
    for (const r of [row(null, null), toAdminPublisherRow({ id: "p1", name: "Pub", status: "active" })]) {
      assert.equal(r?.state, "missing");
      assert.equal(r?.regionalEligible, false);
      assert.equal(r?.incompleteOrInvalid, true);
      assert.equal(r && describePublisherCountry(r), "Country not submitted");
    }
  });

  it("only one of code / status set, or unknown status => incomplete (never verified)", () => {
    assert.equal(row("IN", null)?.state, "incomplete");
    assert.equal(row(null, "verified")?.state, "incomplete");
    assert.equal(row("IN", "approved")?.state, "incomplete");
    assert.equal(row("IN", "approved")?.regionalEligible, false);
    assert.equal(row(7, "pending")?.state, "incomplete");
  });

  it("non-ISO code => invalid_country whatever the status; verified + invalid code is NOT eligible and has NO region", () => {
    for (const status of ["pending", "verified", "rejected"]) {
      const r = row("UK", status);
      assert.equal(r?.state, "invalid_country", status);
      assert.equal(r?.regionalEligible, false, status);
      assert.equal(r?.region, null, status);
      assert.equal(r?.incompleteOrInvalid, true, status);
      assert.equal(r?.awaitingReview, false, status);
    }
  });

  it("classifyPublisherCountry is total: junk input never throws", () => {
    for (const [c, s] of [[undefined, undefined], [{}, []], ["", ""], ["IN", {}], [NaN, "pending"]] as [unknown, unknown][]) {
      assert.doesNotThrow(() => classifyPublisherCountry(c, s));
    }
  });
});

describe("summary counts", () => {
  it("counts every publisher / advertiser state exactly once", () => {
    const pubs = [
      ["IN", "verified"], ["US", "verified"], ["DE", "pending"], ["BR", "rejected"], [null, null], [null, null], ["IN", null], ["UK", "pending"],
    ].map(([c, s], i) => toAdminPublisherRow({ id: `p${i}`, name: "P", status: "active", country_code: c, country_status: s }));
    const s = summarizePublisherCountries(pubs.filter((p): p is NonNullable<typeof p> => p !== null));
    assert.deepEqual(s, { total: 8, missing: 2, incomplete: 1, invalidCountry: 1, pending: 1, verified: 2, rejected: 1 });

    const advs = [["IN"], ["US"], [null], ["XX"], ["GB"]].map(([c], i) => toAdminAdvertiserRow({ id: `a${i}`, company_name: "A", status: "active", country_code: c }));
    assert.deepEqual(summarizeAdvertiserCountries(advs.filter((a): a is NonNullable<typeof a> => a !== null)), { total: 5, valid: 3, missing: 1, invalid: 1 });
  });
});

describe("loader: read-only, independent failures, existing rows stay compatible", () => {
  it("runs only SELECTs on publishers + advertisers, newest first, with a row limit; maps legacy and new rows together", async () => {
    overviewFake.replies.publishers = {
      error: null,
      data: [
        { id: "p1", name: "New", status: "active", country_code: "DE", country_status: "pending" },
        { id: "p2", name: "Old", status: "active", country_code: null, country_status: null },
      ],
    };
    overviewFake.replies.advertisers = {
      error: null,
      data: [
        { id: "a1", company_name: "New", status: "active", country_code: "BR" },
        { id: "a2", company_name: "Old", status: "pending", country_code: null },
      ],
    };
    const o = await loadAdminCountryOverview();
    assert.deepEqual(overviewFake.calls.map((c) => c.table).sort(), ["advertisers", "publishers"]);
    for (const c of overviewFake.calls) {
      assert.equal(c.orderBy, "created_at");
      assert.equal(c.ascending, false);
      assert.equal(c.limit, ADMIN_COUNTRY_ROW_LIMIT);
    }
    assert.deepEqual(o.publishers?.map((p) => p.state), ["pending", "missing"]);
    assert.deepEqual(o.advertisers?.map((a) => a.state), ["valid", "missing"]);
    assert.equal(o.advertisers?.[0].region, regionForCountry("BR"));
    assert.equal(o.publishersTruncated, false);
    assert.equal(o.advertisersTruncated, false);
  });

  it("selects no personal columns (no email / profile_id / keys)", async () => {
    await loadAdminCountryOverview();
    for (const c of overviewFake.calls) assert.doesNotMatch(c.columns, /email|profile_id|api_key|key_hash|payout|balance/i, c.table);
  });

  it("advertisers column missing (SQL not applied) => only advertisers null; publishers still load", async () => {
    overviewFake.replies.publishers = { error: null, data: [{ id: "p1", name: "P", status: "active", country_code: null, country_status: null }] };
    overviewFake.replies.advertisers = { data: null, error: { code: "42703" } };
    const o = await loadAdminCountryOverview();
    assert.equal(o.advertisers, null);
    assert.equal(o.publishers?.length, 1);
  });

  it("publishers error => only publishers null; client creation failure => both null, no throw", async () => {
    overviewFake.replies.publishers = { data: null, error: { code: "42703" } };
    const a = await loadAdminCountryOverview();
    assert.equal(a.publishers, null);
    assert.deepEqual(a.advertisers, []);
    overviewFake.reset();
    overviewFake.createClientThrows = true;
    const b = await loadAdminCountryOverview();
    assert.equal(b.publishers, null);
    assert.equal(b.advertisers, null);
  });

  it("rows with a broken shape are skipped; hitting the limit sets the truncated flag", async () => {
    overviewFake.replies.publishers = {
      error: null,
      data: [...Array.from({ length: ADMIN_COUNTRY_ROW_LIMIT - 1 }, (_, i) => ({ id: `p${i}`, name: "P", status: "active", country_code: "IN", country_status: "verified" })), { id: 5 }],
    };
    const o = await loadAdminCountryOverview();
    assert.equal(o.publishers?.length, ADMIN_COUNTRY_ROW_LIMIT - 1);
    assert.equal(o.publishersTruncated, true);
  });
});

describe("authorization and read-only guarantees (source level)", () => {
  const page = read("app/dashboard/admin/page.tsx");

  it("admin page checks the admin role BEFORE the country overview is loaded", () => {
    const body = page.slice(page.indexOf("export default async function AdminPage"));
    const role = body.indexOf('requireRole(["admin"])');
    const load = body.indexOf("loadAdminCountryOverview()");
    assert.ok(role >= 0 && load > role, "requireRole(admin) must come first");
  });

  it("overview loader and panel only read: no server action, rpc, insert, update, delete, form or button", () => {
    for (const f of ["lib/regions/admin-country-queries.ts", "components/admin/CountryOverviewPanel.tsx", "lib/regions/admin-country-overview.ts"]) {
      const src = strip(read(f));
      assert.doesNotMatch(src, /"use server"|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|<form|<button|<Button|ReviewButton|DecisionButton/, f);
    }
  });

  it("country approve / reject stays ONLY in the existing Step 2 panel + action (no second workflow)", () => {
    assert.match(read("components/admin/PublisherCountryPanel.tsx"), /PublisherCountryReviewButton/);
    assert.match(read("app/dashboard/admin/country-actions.ts"), /requireRole\(\["admin"\]\)/);
    assert.match(page, /<PublisherCountryPanel \/>/);
    const users = ["app", "components", "lib"]
      .flatMap((d) => (readdirSync(path.join(ROOT, d), { recursive: true }) as string[]).map((p) => `${d}/${p}`))
      .filter((p: string) => /\.tsx?$/.test(p))
      .filter((p: string) => strip(read(p)).includes("admin_review_publisher_country"));
    assert.deepEqual(users, ["app/dashboard/admin/country-actions.ts"]);
  });

  it("no new advertiser approval policy: no advertiser country status / review code was added", () => {
    const src = strip(read("lib/regions/admin-country-overview.ts") + read("components/admin/CountryOverviewPanel.tsx"));
    assert.doesNotMatch(src, /admin_review_advertiser|advertiser_country_status|country_status.*advertis/i);
    assert.match(read("components/admin/CountryOverviewPanel.tsx"), /needs no approval/);
  });

  it("no new SQL in Part 3: the only Phase 6 Step 3 SQL is Part 1's advertiser column", () => {
    const sql = readdirSync(path.join(ROOT, "supabase", "sql")).filter((f: string) => f.startsWith("phase6-step3"));
    assert.deepEqual(sql, ["phase6-step3-1-advertiser-country.sql"]);
  });

  it("new Part 3 files do not touch money: no payment / payout / ledger / price / currency code", () => {
    for (const f of ["lib/regions/admin-country-overview.ts", "lib/regions/admin-country-queries.ts", "components/admin/CountryOverviewPanel.tsx"]) {
      const src = strip(read(f));
      assert.doesNotMatch(src, /@\/lib\/(payments|payouts|ledger)|currency|\busd\b|\binr\b|\bcpm\b|\bcpc\b|razorpay|stripe/i, f);
    }
  });
});
