import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PILOT_COUNTED_STATUSES,
  PILOT_MAX_ADVERTISER_TOTAL,
  PILOT_MAX_CAMPAIGN_BUDGET,
} from "@/lib/campaigns/constants";
import { mapDbError } from "@/lib/campaigns/errors";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("phase 6 step 4 part 3: pilot limits DB guard static checks", () => {
  const sql = read("supabase/sql/phase6-step4-part3-pilot-limits-guard.sql");

  it("is forward-only, one transaction, no drop/delete/truncate/backfill", () => {
    assert.match(sql, /^\s*begin;/m);
    assert.match(sql, /^\s*commit;/m);
    assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema)\b/i);
    assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
    assert.doesNotMatch(sql, /\btruncate\b/i);
    assert.doesNotMatch(sql, /\bupdate\s+public\.campaigns\b/i);
  });

  it("takes advisory transaction lock serializing the advertiser before checking sums", () => {
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('blisscco:pilot_advertiser:'\s*\|\|\s*new\.advertiser_id::text,\s*0\)\)/);
  });

  it("has parity with constants in lib/campaigns/constants.ts", () => {
    assert.match(sql, new RegExp(`c_pilot_max_campaign_budget constant numeric := ${PILOT_MAX_CAMPAIGN_BUDGET};`));
    assert.match(sql, new RegExp(`c_pilot_max_advertiser_total constant numeric := ${PILOT_MAX_ADVERTISER_TOTAL};`));
    for (const status of PILOT_COUNTED_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
  });

  it("revokes EXECUTE on guard function from public, anon, authenticated, service_role", () => {
    assert.match(sql, /revoke all on function private\.guard_pilot_campaign_limits\(\) from public, anon, authenticated, service_role;/);
  });
});

describe("phase 6 step 4 part 3: G1 race demonstration (why the DB guard exists)", () => {
  it("demonstrates how read-then-write pilotTotalProblem in app code can race without DB lock", () => {
    let committedDbSum = 1500;
    const limit = 2000;

    const readA = committedDbSum;
    const readB = committedDbSum;

    const checkA = readA + 400 <= limit;
    const checkB = readB + 300 <= limit;
    assert.equal(checkA, true);
    assert.equal(checkB, true);

    committedDbSum = committedDbSum + 400 + 300;
    assert.equal(committedDbSum, 2200);
    assert.ok(committedDbSum > limit, "Demonstrates G1 race condition in app layer");
  });
});

describe("phase 6 step 4 part 3: friendly error mapping for pilot hints", () => {
  it("maps pilot_campaign_limit and pilot_advertiser_limit to friendly messages", () => {
    const msg1 = mapDbError({ code: "23514", hint: "pilot_campaign_limit" });
    assert.match(msg1, /\$1,000\.00/);

    const msg2 = mapDbError({ code: "23514", hint: "pilot_advertiser_limit" });
    assert.match(msg2, /\$2,000\.00/);
  });
});
