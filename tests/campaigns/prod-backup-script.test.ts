// Production DB backup script: sirf text/source checks (database kabhi nahi chhuta, pg_dump nahi chalta).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("production DB backup script", () => {
  const sh = read("scripts/backup-production-db.sh");
  it("fails fast and never stores a connection string", () => {
    assert.match(sh, /^set -euo pipefail$/m);
    assert.match(sh, /: "\$\{SUPABASE_DB_URL:\?/);
    assert.ok(!/postgres(ql)?:\/\/[^\s$'"]*:[^\s$'"@]+@[a-z0-9.-]+/i.test(sh.replace(/<[^>]*>/g, "")), "no real credentials in the file");
    assert.ok(!/echo[^\n]*\$SUPABASE_DB_URL/.test(sh), "the URL is never printed");
  });
  it("is read-only: only pg_dump / psql show, no write SQL", () => {
    assert.match(sh, /pg_dump "\$SUPABASE_DB_URL" --format=custom/);
    assert.ok(!/\b(insert|update|delete|drop|truncate|alter|create)\s+(into|table|from|schema)?/i.test(sh.split("\n").filter((l) => /psql/.test(l)).join("\n")), "psql only runs 'show server_version_num'");
  });
  it("verifies the dump and deletes a broken one", () => {
    assert.match(sh, /pg_restore --list/);
    assert.match(sh, /TABLE public campaigns/);
    assert.match(sh, /rm -f "\$FILE"/);
    assert.match(sh, /sha256sum/);
  });
  it("backups are git-ignored and the script is checked in CI", () => {
    const ig = read(".gitignore");
    assert.match(ig, /^backups\/$/m);
    assert.match(ig, /^\*\.dump$/m);
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /bash -n scripts\/backup-production-db\.sh/);
  });
});
