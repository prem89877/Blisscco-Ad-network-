import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MAX_UNITS } from "@/lib/ledger/decimal";
import { isValidShareBps, splitCharge } from "@/lib/ledger/revenue-share";
import { reconcileSplit } from "@/lib/ledger/reconciliation";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (name === "node_modules" || name === ".next" || name === ".test-build" || name === ".git") continue;
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}

describe("phase 6 step 4 part 3: 90/10 revenue share reference vectors", () => {
  const vectors: Array<[bigint, bigint, bigint, string]> = [
    [1n, 0n, 1n, "$0.0001 -> pub 0, plat 1"],
    [2n, 1n, 1n, "$0.0002 -> pub 1, plat 1"],
    [3n, 2n, 1n, "$0.0003 -> pub 2, plat 1"],
    [10n, 9n, 1n, "$0.0010 -> pub 9, plat 1"],
    [20n, 18n, 2n, "$0.0020 (default CPM $2) -> pub 18, plat 2"],
    [19n, 17n, 2n, "$0.0019 -> pub 17, plat 2"],
    [10_000n, 9_000n, 1_000n, "$1.0000 -> pub 0.9000, plat 0.1000"],
    [1_234n, 1_110n, 124n, "$0.1234 CPC click -> pub 0.1110, plat 0.0124"],
  ];

  for (const [charge, expectedPub, expectedPlat, label] of vectors) {
    it(`splits correctly for vector: ${label}`, () => {
      const split = splitCharge(charge, 9000);
      assert.equal(split.publisherUnits, expectedPub, `publisher units for ${label}`);
      assert.equal(split.platformUnits, expectedPlat, `platform units for ${label}`);
      assert.equal(split.publisherUnits + split.platformUnits, charge);

      const rec = reconcileSplit(charge, 9000);
      assert.equal(rec.balanced, true);
      assert.equal(rec.publisherUnits, expectedPub);
      assert.equal(rec.platformUnits, expectedPlat);
    });
  }

  it("handles MAX_UNITS without overflow or precision loss", () => {
    const split = splitCharge(MAX_UNITS, 9000);
    assert.equal(split.publisherUnits + split.platformUnits, MAX_UNITS);
    assert.ok(split.publisherUnits > 0n);
    assert.ok(split.platformUnits > 0n);
  });
});

describe("phase 6 step 4 part 3: property loop over charge & bps", () => {
  it("never loses or creates money across 5000 amounts and boundary bps", () => {
    const bpsList = [0, 1, 5000, 9000, 9999, 10_000];
    for (let c = 1n; c <= 5000n; c++) {
      for (const bps of bpsList) {
        const { publisherUnits: p, platformUnits: q } = splitCharge(c, bps);
        assert.equal(p + q, c);
        assert.ok(p >= 0n);
        assert.ok(q >= 0n);
        assert.ok(p <= c);
        assert.ok(p * 10_000n <= c * BigInt(bps));
        assert.ok(c * BigInt(bps) < (p + 1n) * 10_000n);
      }
    }
  });
});

describe("phase 6 step 4 part 3: input validation and math parity", () => {
  it("rejects invalid shareBps and invalid charges", () => {
    for (const badBps of [-1, 10001, NaN, Infinity, 9000.5, "9000", null, undefined]) {
      assert.equal(isValidShareBps(badBps), false);
      assert.throws(() => splitCharge(20n, badBps as number), RangeError);
    }
    for (const badCharge of [0n, -1n, -100n, MAX_UNITS + 1n]) {
      assert.throws(() => splitCharge(badCharge, 9000), RangeError);
    }
  });

  it("TS truncation math exactly matches SQL trunc expression in private.ledger_record_event", () => {
    const sql = read("supabase/sql/phase6-step4-part2-event-billing.sql");
    assert.match(sql, /v_pub_amt\s*:=\s*trunc\(\(\p_amount\s*\*\s*v_bps\)\s*\/\s*10000,\s*4\)/);
    assert.match(sql, /v_plat_amt\s*:=\s*p_amount\s*-\s*v_pub_amt/);
  });
});

describe("phase 6 step 4 part 3: static guards across codebase", () => {
  it("runtime code in lib/ and app/ never hardcodes '9000' as a revenue share literal", () => {
    const codeFiles = walk("lib", [".ts"]).concat(walk("app", [".ts", ".tsx"]));
    for (const f of codeFiles) {
      if (f.includes("test")) continue;
      const content = read(f);
      const stripped = content.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      assert.doesNotMatch(stripped, /\b9000\b/, `Hardcoded 9000 literal found in runtime file: ${f}`);
    }
  });

  it("ledger_settings schema has no default for publisher_share_bps", () => {
    const sql = read("supabase/sql/day-13-4-ledger-service.sql");
    assert.match(sql, /publisher_share_bps\s+integer,/);
    assert.doesNotMatch(sql, /publisher_share_bps\s+integer\s+default/i);
  });

  it("no client component imports revenue-share or reconciliation", () => {
    const clientFiles = walk("components", [".tsx", ".ts"]).concat(walk("app", [".tsx", ".ts"]));
    for (const f of clientFiles) {
      const content = read(f);
      if (/^["']use client["']/m.test(content)) {
        assert.doesNotMatch(content, /lib\/ledger\/revenue-share/, f);
        assert.doesNotMatch(content, /lib\/ledger\/reconciliation/, f);
      }
    }
  });

  it("the test config script modifies only publisher_share_bps and never sets ledger_enabled to true", () => {
    const cfg = read("supabase/sql/phase6-step4-part3-test-revenue-share-config.sql");
    assert.doesNotMatch(cfg, /ledger_enabled\s*=\s*true/i);
    assert.match(cfg, /update\s+public\.ledger_settings\s+set\s+publisher_share_bps\s*=\s*9000/i);
  });
});
