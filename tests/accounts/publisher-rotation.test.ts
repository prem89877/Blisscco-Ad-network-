import { fake, type FakeKey, type FakePublisher } from "./publisher-stubs"; // sabse pehle: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createKey, revokeKey, rotateKey } from "@/app/dashboard/publisher/actions";
import { issueFailMessage, issueFailReason, parseKeyLabel } from "@/lib/publisher/keys";

const root = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

const OLD = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const idle = { status: "idle" } as const;
const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
const pub = (over: Partial<FakePublisher> = {}): FakePublisher => ({ id: "pub-A", status: "active", name: "Bot", websiteUrl: null, category: null, ...over });
const key = (over: Partial<FakeKey> = {}): FakeKey => ({
  id: OLD,
  label: "Production",
  prefix: "blc_live_abcd",
  hint: "1234",
  status: "active",
  createdAt: "2026-10-01T00:00:00Z",
  lastUsedAt: null,
  expiresAt: future,
  ...over,
});

describe("key rotation action", () => {
  beforeEach(() => {
    fake.reset();
    fake.load = { publisher: pub(), failed: false };
    fake.keys = [key()];
  });

  it("creates a new key with the old name; the old key is NOT revoked (no downtime)", async () => {
    const r = await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" }));
    assert.equal(r.status, "success");
    assert.match(r.newKey ?? "", /^blc_live_[0-9a-f]{64}$/);
    assert.match(r.message ?? "", /revoke the old key/i);
    assert.deepEqual(fake.issued, [{ publisherId: "pub-A", label: "Production", expiry: "90" }]);
    assert.equal(fake.revoked.length, 0);
  });

  it("uses the publisher id from the login even if the form tries another one", async () => {
    await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "30", publisherId: "pub-B", publisher_id: "pub-B" }));
    assert.equal(fake.issued[0].publisherId, "pub-A");
  });

  it("a key that is not in MY list (someone else's, or unknown) cannot be rotated", async () => {
    const r = await rotateKey(idle, form({ rotateKeyId: OTHER, expiry: "90" }));
    assert.equal(r.status, "error");
    assert.equal(fake.issued.length, 0);
  });

  it("revoked and expired keys cannot be rotated", async () => {
    fake.keys = [key({ status: "revoked" })];
    assert.equal((await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" }))).status, "error");
    fake.keys = [key({ expiresAt: past })];
    assert.equal((await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" }))).status, "error");
    assert.equal(fake.issued.length, 0);
  });

  it("bad key id, bad expiry, key list failure and wrong role stop before issuing", async () => {
    assert.equal((await rotateKey(idle, form({ rotateKeyId: "nope", expiry: "90" }))).status, "error");
    assert.equal((await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "7" }))).status, "error");
    fake.keys = null;
    assert.match((await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" }))).message ?? "", /could not check your keys/i);
    fake.keys = [key()];
    fake.roleFails = true;
    await assert.rejects(rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" })), /REDIRECT:\/login/);
    assert.equal(fake.issued.length, 0);
  });

  it("limit and daily-limit give different messages", async () => {
    fake.issueResult = { ok: false, reason: "limit" };
    assert.match((await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" }))).message ?? "", /5 active keys/);
    fake.issueResult = { ok: false, reason: "daily" };
    assert.match((await rotateKey(idle, form({ rotateKeyId: OLD, expiry: "90" }))).message ?? "", /too many keys today/i);
    assert.match((await createKey(idle, form({ label: "", expiry: "90" }))).message ?? "", /too many keys today/i);
  });

  it("revoke still scopes to the logged-in publisher only", async () => {
    await revokeKey(idle, form({ keyId: OLD, publisherId: "pub-B" }));
    assert.deepEqual(fake.revoked, [{ publisherId: "pub-A", keyId: OLD }]);
  });
});

describe("key errors and labels", () => {
  it("issueFailReason: hints decide; without a hint 22023 stays 'limit' (works before the migration)", () => {
    assert.equal(issueFailReason({ code: "22023", hint: "key_limit" }), "limit");
    assert.equal(issueFailReason({ code: "22023", hint: "key_daily_limit" }), "daily");
    assert.equal(issueFailReason({ code: "22023", hint: "invalid_expiry" }), "error");
    assert.equal(issueFailReason({ code: "22023", hint: "invalid_key_data" }), "error");
    assert.equal(issueFailReason({ code: "22023" }), "limit");
    assert.equal(issueFailReason({ code: "P0002" }), "error");
    assert.equal(issueFailReason(null), "error");
    assert.match(issueFailMessage("daily"), /tomorrow/);
  });

  it("labels: hidden and control characters are rejected, normal text and Hindi pass", () => {
    for (const bad of ["a\u200bb", "x\u202ey", "\u0007bell"]) assert.equal(parseKeyLabel(bad).ok, false, JSON.stringify(bad));
    for (const good of ["Production server", "प्रोडक्शन सर्वर", ""]) assert.equal(parseKeyLabel(good).ok, true, good);
  });
});

describe("key manager UI and page: source checks", () => {
  const ui = read("components/dashboard/PublisherKeyManager.tsx");
  const page = read("app/dashboard/publisher/page.tsx");

  it("secret is shown once with a hide button and is never put in storage or the URL", () => {
    assert.match(ui, /I have saved it, hide/);
    assert.equal(/localStorage|sessionStorage|document\.cookie|history\.(push|replace)State|router\.(push|replace)/.test(ui), false);
  });
  it("rotation goes through the shared action, and suspended publishers get a revoke-only panel", () => {
    assert.match(ui, /rotateKeyId/);
    assert.match(page, /canCreate=\{false\}/);
    assert.match(page, /pub\.status === "suspended"/);
  });
  it("migration day-10-2 changes only issue_publisher_key_for, keeps service_role-only and never touches data", () => {
    const sql = read("supabase/sql/day-10-2-key-limits.sql");
    assert.match(sql, /create or replace function public\.issue_publisher_key_for/);
    assert.match(sql, /grant execute on function public\.issue_publisher_key_for\(uuid, text, text, text, text, timestamptz\) to service_role/);
    assert.match(sql, /revoke all on function public\.issue_publisher_key_for\(uuid, text, text, text, text, timestamptz\) from public, anon, authenticated/);
    assert.equal(/\b(drop table|truncate|delete from|update public\.|alter table|drop function)\b/i.test(sql.replace(/^--.*$/gm, "")), false);
    assert.match(sql, /pr\.status = 'active'/);
  });
});
