import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { TEST_DB_CONFIRM_VALUE, checkTestDatabase, type GuardEnv } from "./test-db-guard";

// Day 9 Part 5: test-database guard. Ye tests hamesha chalte hain (koi database nahi chahiye).
// Integration test file (day9-part5-db.test.ts) isi guard par tika hai, isliye guard ka galat chalna = production ka khatra.

const TEST_REF = "tstproj1234abcd";
const PROD_REF = "prodproj9876wxyz";
const good = (): GuardEnv => ({
  TEST_DATABASE_URL: `postgresql://postgres:pw@db.${TEST_REF}.supabase.co:5432/postgres`,
  TEST_DB_CONFIRM: TEST_DB_CONFIRM_VALUE,
  TEST_SUPABASE_PROJECT_REF: TEST_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
});

describe("day 9 part 5: test database guard", () => {
  it("accepts a clearly separate test project", () => {
    assert.deepEqual(checkTestDatabase(good()), { ok: true, url: good().TEST_DATABASE_URL });
  });

  it("refuses when anything is missing", () => {
    for (const k of ["TEST_DATABASE_URL", "TEST_DB_CONFIRM", "TEST_SUPABASE_PROJECT_REF"]) {
      const env = good();
      delete env[k];
      assert.equal(checkTestDatabase(env).ok, false, k);
    }
    assert.equal(checkTestDatabase({ ...good(), TEST_DB_CONFIRM: "yes" }).ok, false);
    assert.equal(checkTestDatabase({ ...good(), TEST_DATABASE_URL: "  " }).ok, false);
  });

  it("refuses a non-postgres URL", () => {
    assert.equal(checkTestDatabase({ ...good(), TEST_DATABASE_URL: `https://db.${TEST_REF}.supabase.co` }).ok, false);
  });

  it("refuses when the test URL points at the production project (same ref)", () => {
    const env = { ...good(), TEST_SUPABASE_PROJECT_REF: PROD_REF, TEST_DATABASE_URL: `postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres` };
    assert.equal(checkTestDatabase(env).ok, false);
  });

  it("refuses when the URL contains the production ref even if the declared test ref is different", () => {
    const env = { ...good(), TEST_DATABASE_URL: `postgresql://postgres.${PROD_REF}:pw@pooler.example.com:6543/postgres?x=${TEST_REF}` };
    assert.equal(checkTestDatabase(env).ok, false);
  });

  it("refuses when it equals the app's own DATABASE_URL", () => {
    const env = { ...good(), DATABASE_URL: good().TEST_DATABASE_URL };
    assert.equal(checkTestDatabase(env).ok, false);
  });

  it("refuses in production environments", () => {
    assert.equal(checkTestDatabase({ ...good(), NODE_ENV: "production" }).ok, false);
    assert.equal(checkTestDatabase({ ...good(), VERCEL_ENV: "production" }).ok, false);
  });

  it("the failure reason never echoes the database URL or password", () => {
    const r = checkTestDatabase({ ...good(), TEST_DB_CONFIRM: "no" });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes("pw@"), false);
  });
});

describe("day 9 part 5: integration test files are safe by construction (static check)", () => {
  const dir = path.join(__dirname, "..", "..", "..", "tests", "integration");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f.endsWith(".test.ts") && f !== "day9-part5-guard.test.ts");

  it("there is at least one DB integration test and it goes through the guard", () => {
    assert.ok(files.length >= 1);
    for (const f of files) assert.match(readFileSync(path.join(dir, f), "utf8"), /checkTestDatabase\(/, f);
  });

  it("DB integration tests never use the production env/keys or the app's admin client", () => {
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      for (const banned of ["SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE", "@/lib/supabase", "process.env.DATABASE_URL"]) {
        assert.equal(src.includes(banned), false, `${f} must not reference ${banned}`);
      }
    }
  });

  it("DB integration tests only delete rows they created (tagged), never whole tables", () => {
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      assert.equal(/\btruncate\b/i.test(src), false, `${f} must not truncate`);
      for (const m of src.matchAll(/delete\s+from\s+[\w.]+(?<rest>[^`"']*)/gi)) {
        assert.match(m.groups?.rest ?? "", /where/i, `${f}: every delete needs a where clause`);
      }
    }
  });
});
