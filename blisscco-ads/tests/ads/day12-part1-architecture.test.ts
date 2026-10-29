import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PUBLIC_AD_FIELDS, buildAdResponse } from "@/lib/ads/contract";

// Day 12 / Part 1: architecture report ka reality check. Sirf static (koi database, network ya SQL nahi).
// Maqsad: report jo kehti hai ("ye exist nahi karta", "contract nahi badla", "charge serve par hai") wo repo se sach rahe,
// aur koi naya tracking code/SQL chup-chaap na aa jaye jabki design abhi sirf proposal hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const SKIP = new Set(["node_modules", ".next", ".test-build", ".git"]);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (SKIP.has(name)) continue;
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}

const report = read("DAY12-PART1-ARCHITECTURE.md");
const sql = walk("supabase/sql", [".sql"]).filter((f) => !/-tests?\.sql$/.test(f));
const sqlText = sql.map((f) => read(f)).join("\n");
const code = ["app", "lib", "components"].flatMap((d) => walk(d, [".ts", ".tsx"])).filter((f) => f !== "lib/demo-data.ts");

describe("Day 12 part 1: report states the facts the repo proves", () => {
  it("report has every required section", () => {
    for (const heading of [
      /Actual flow/,
      /Kya sach me hai aur kya nahi/,
      /Identifiers/,
      /authoritative ingestion/,
      /Duplicate-event risk register/,
      /Trust boundaries/,
      /Required migrations/,
      /Baaki faisle/,
    ]) {
      assert.match(report, heading);
    }
  });

  it("report does not claim Revive is integrated and keeps billing on serve", () => {
    assert.match(report, /Revive Adserver integrated NAHI hai/);
    assert.match(report, /Charge ka aadhar abhi bhi "serve" hai/);
    assert.match(report, /Billing migration is list me nahi hai/);
    assert.doesNotMatch(report, /Revive (is|hai) integrated(?! NAHI)/i);
  });

  it("report says migrations were proposed only; Day 12 part 2 later added exactly the two DB-foundation migrations, nothing else", () => {
    assert.match(report, /PROPOSED, abhi koi nahi chali/);
    // Part 2 ne sirf 2 migration files + 1 read-only verify file joddi (ad_events + serve_ref). Writer function (record_ad_event) abhi bhi nahi hai.
    const withEventSql = sql.filter((f) => /ad_events|serve_ref/i.test(read(f))).map((f) => f.replace(/\\/g, "/")).sort();
    // Part 3 ne 2 aur files joddi (serve_ref ko record/retry se wapas laana + uski read-only jaanch). Writer ab bhi nahi.
    assert.deepEqual(withEventSql, [
      "supabase/sql/day-12-1-serve-ref.sql",
      // Day 12 prompt 5 part 3: click ka doosra writer + uski read-only jaanch (sort order: 12-10 aur 12-11, 12-2 se pehle).
      "supabase/sql/day-12-10-record-ad-click.sql",
      "supabase/sql/day-12-11-click-verify.sql",
      // Day 12 prompt 6 part 2: analytics ke liye read-only functions (ad_events par koi grant nahi, isliye ye zaroori hain). Sirf padhte hain.
      "supabase/sql/day-12-12-campaign-analytics.sql",
      "supabase/sql/day-12-2-ad-events.sql",
      "supabase/sql/day-12-3-event-verify.sql",
      "supabase/sql/day-12-5-serve-ref-return.sql",
      "supabase/sql/day-12-6-serve-ref-return-verify.sql",
      // Part 4: impression ka eklauta writer + uski read-only jaanch.
      "supabase/sql/day-12-7-record-ad-impression.sql",
      "supabase/sql/day-12-8-impression-verify.sql",
    ]);
    assert.equal(/record_ad_event/i.test(sqlText), false, "a record_ad_event writer slipped into supabase/sql");
  });
});

describe("Day 12 part 1: nothing the report calls missing has appeared", () => {
  // Day 12 part 3 ne serve_ref ko (sirf token banane ke liye) in files me aane diya. Koi aur file serve_ref nahi chhuti.
  const SERVE_REF_FILES = [
    "lib/ads/serve.ts", "lib/ads/serve-db.ts", "lib/ads/service.ts", "lib/ads/types.ts", "lib/ads/tracking-token.ts",
    // Day 12 part 4: impression layer (token se serve_ref padhta hai)
    "lib/ads/impression.ts", "lib/ads/impression-db.ts", "lib/ads/impression-handler.ts",
    // Day 12 prompt 5 part 2: click reference helper (pure; route/redirect/writer nahi)
    "lib/ads/click-ref.ts",
    // Day 12 prompt 5 part 3: click redirect (ref se serve_ref padhta hai)
    "lib/ads/click.ts", "lib/ads/click-db.ts",
    // Day 12 prompt 5 part 4: provider adapter boundary (event me Blisscco ka internal serve ref jaata hai; provider code nahi)
    "lib/ads/provider-adapter.ts",
  ];
  it("no event ingestion code, route, pixel or beacon exists yet; serve_ref appears only in the token-issuing files", () => {
    for (const f of code) {
      const src = read(f);
      assert.equal(/record_ad_event|recordAdEvent|sendBeacon|tracking pixel/i.test(src), false, f);
      if (!SERVE_REF_FILES.includes(f.replace(/\\/g, "/"))) assert.equal(/serve_ref|serveRef/i.test(src), false, `${f}: serve_ref outside the token-issuing files`);
      // Part 3: sirf EK file ka naam allowed hai (token banane/jaanchne ka pure module). Koi route/pixel/beacon/impression/click file nahi.
      if (!["lib/ads/tracking-token.ts", "lib/ads/impression.ts", "lib/ads/impression-db.ts", "lib/ads/impression-handler.ts", "app/api/v1/ads/impression/route.ts", "lib/ads/click-ref.ts", "lib/ads/click.ts", "lib/ads/click-db.ts", "lib/ads/click-handler.ts", "app/api/v1/ads/click/route.ts"].includes(f.replace(/\\/g, "/"))) assert.doesNotMatch(f, /track|pixel|beacon|impression|click/i, `file name: ${f}`);
    }
    const apiRoutes = walk("app/api", [".ts"]).map((f) => f.replace(/\\/g, "/")).sort();
    assert.deepEqual(apiRoutes, [
      "app/api/ads/match/route.ts",
      "app/api/supabase-health/route.ts",
      "app/api/v1/ads/click/route.ts", // Day 12 prompt 5 part 3
      "app/api/v1/ads/impression/route.ts",
      "app/api/v1/ads/match/route.ts",
    ]);
  });

  it("serve log has no public reference: ad_serve_log keeps a bigint identity id and no serve_ref column", () => {
    const delivery = read("supabase/sql/day-5-3-delivery-tables.sql");
    assert.match(delivery, /id\s+bigint generated always as identity primary key/);
    assert.equal(/serve_ref/i.test(read("supabase/sql/day-9-5-atomic-spend-idempotency.sql")), false);
  });

  it("the public match response keeps exactly the 5 ad fields (no serve reference leaked into the contract)", () => {
    assert.deepEqual([...PUBLIC_AD_FIELDS], ["id", "headline", "body", "cta_text", "destination_url"]);
    const res = buildAdResponse({ id: "11111111-1111-4111-8111-111111111111", headline: "h", body: "b", ctaText: null, destinationUrl: "https://example.com" });
    assert.deepEqual(Object.keys(res).sort(), ["ad", "fill", "sponsored"]);
    assert.deepEqual(Object.keys(res.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
  });

  it("charge is still written only by record_ad_serve at serve time (basis not moved to impression)", () => {
    const record = read("supabase/sql/day-7-1-budget-keys-retention.sql");
    assert.match(record, /insert into public\.campaign_spend_daily/);
    assert.match(record, /insert into public\.ad_serve_log/);
    assert.match(read("lib/ads/service.ts"), /spendTracking: "reliable"/);
  });
});

describe("Day 12 part 1: user-facing wording does not call a serve a view", () => {
  const norm = (f: string) => read(f).replace(/\s+/g, " ");

  it("advertiser campaign page says Ads served, not Ads shown, and still says not tracked yet", () => {
    const page = norm("app/dashboard/advertiser/campaigns/[id]/page.tsx");
    assert.match(page, /label="Ads served"/);
    assert.doesNotMatch(page, /label="Ads shown"/);
    assert.match(page, /Not tracked yet/);
  });

  it("analytics page says ads served and still says impressions and clicks are not tracked yet", () => {
    const page = norm("app/dashboard/analytics/page.tsx");
    assert.match(page, /number of ads served/);
    assert.doesNotMatch(page, /number of ads shown/);
    assert.match(page, /not tracked yet/);
  });
});
