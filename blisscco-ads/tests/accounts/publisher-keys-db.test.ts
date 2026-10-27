import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { issuePublisherKey, revokePublisherKey } from "@/lib/publisher/keys-db";
import { hashApiKey, readBearerKey } from "@/lib/ads/api-key";

// Asli keys-db.ts, nakli admin client ke saath (register.cjs). Database kabhi nahi chhuta.
type Call = { fn: string; args: Record<string, unknown> };
let calls: Call[] = [];
let rpcResult: { data?: unknown; error?: { code?: string; hint?: string; message?: string } | null } = { data: "id", error: null };
let throwOnRpc = false;
let logged: unknown[][] = [];
const realError = console.error;

beforeEach(() => {
  calls = [];
  rpcResult = { data: "id", error: null };
  throwOnRpc = false;
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
    async rpc(fn: string, args: Record<string, unknown>) {
      if (throwOnRpc) throw new Error("boom with " + JSON.stringify(args));
      calls.push({ fn, args });
      return rpcResult;
    },
  };
});
afterEach(() => {
  console.error = realError;
});

describe("issuePublisherKey: generation and storage", () => {
  it("makes a 256-bit random key; the database only gets its SHA-256 hash, prefix and last 4", async () => {
    const r = await issuePublisherKey("pub-A", "Prod", "90");
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.match(r.key, /^blc_live_[0-9a-f]{64}$/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "issue_publisher_key_for");
    const a = calls[0].args;
    assert.equal(a.p_publisher_id, "pub-A");
    assert.equal(a.p_key_hash, createHash("sha256").update(r.key).digest("hex"));
    assert.equal(a.p_key_hash, hashApiKey(r.key));
    assert.equal(a.p_key_prefix, r.key.slice(0, 13));
    assert.equal(a.p_key_hint, r.key.slice(-4));
    assert.equal(a.p_label, "Prod");
    // plain key database ko kisi bhi argument me nahi jaati
    assert.equal(JSON.stringify(a).includes(r.key), false);
    assert.equal(JSON.stringify(a).includes(r.key.slice(9)), false);
  });

  it("the stored hash verifies the key the way the API does (Bearer header -> hash)", async () => {
    const r = await issuePublisherKey("pub-A", null, "never");
    assert.ok(r.ok);
    if (!r.ok) return;
    const fromHeader = readBearerKey(`Bearer ${r.key}`);
    assert.equal(fromHeader, r.key);
    assert.equal(hashApiKey(fromHeader as string), calls[0].args.p_key_hash);
    assert.equal(calls[0].args.p_expires_at, null);
  });

  it("every call makes a different key (200 keys, no repeats) and expiry is in the future", async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = await issuePublisherKey("pub-A", null, "30");
      assert.ok(r.ok);
      if (r.ok) keys.add(r.key);
    }
    assert.equal(keys.size, 200);
    const exp = new Date(String(calls[0].args.p_expires_at)).getTime();
    assert.ok(exp > Date.now() + 29 * 24 * 3600 * 1000 && exp < Date.now() + 31 * 24 * 3600 * 1000);
  });

  it("failures map to safe reasons and log only a static label plus the error code", async () => {
    const cases: [typeof rpcResult["error"], string][] = [
      [{ code: "22023", hint: "key_limit", message: "limit secret-detail" }, "limit"],
      [{ code: "22023", hint: "key_daily_limit" }, "daily"],
      [{ code: "22023", hint: "invalid_expiry" }, "error"],
      [{ code: "P0002", message: "Publisher not found or not active" }, "error"],
    ];
    for (const [error, reason] of cases) {
      logged = [];
      rpcResult = { data: null, error };
      const r = await issuePublisherKey("pub-A", null, "90");
      assert.deepEqual(r, { ok: false, reason });
      const text = JSON.stringify(logged);
      assert.equal(/blc_live_|secret-detail|pub-A|[0-9a-f]{64}/.test(text), false);
    }
  });

  it("an unexpected exception returns an error and logs nothing sensitive", async () => {
    throwOnRpc = true;
    const r = await issuePublisherKey("pub-A", null, "90");
    assert.deepEqual(r, { ok: false, reason: "error" });
    assert.equal(/blc_live_|pub-A|boom|[0-9a-f]{64}/.test(JSON.stringify(logged)), false);
  });
});

describe("revokePublisherKey and bad keys", () => {
  it("revoke sends the publisher id and the key id (never a key or hash) and reports found / not found", async () => {
    rpcResult = { data: true, error: null };
    assert.equal(await revokePublisherKey("pub-A", "key-1"), true);
    assert.deepEqual(calls[0], { fn: "revoke_publisher_key_for", args: { p_publisher_id: "pub-A", p_key_id: "key-1" } });
    rpcResult = { data: false, error: null };
    assert.equal(await revokePublisherKey("pub-A", "key-1"), false);
    rpcResult = { data: null, error: { code: "XX000", message: "x" } };
    assert.equal(await revokePublisherKey("pub-A", "key-1"), false);
    assert.equal(/key-1|pub-A/.test(JSON.stringify(logged)), false);
  });

  it("malformed keys never reach the database: wrong prefix, case, length, junk, extra values", () => {
    const good = "blc_live_" + "ab".repeat(32);
    assert.equal(readBearerKey(`Bearer ${good}`), good);
    for (const bad of [
      null,
      "",
      `Bearer ${good.toUpperCase()}`,
      `Bearer ${good}0`,
      `Bearer ${good.slice(0, -1)}`,
      `Bearer blc_test_${"ab".repeat(32)}`,
      `Bearer ${good} extra`,
      `Basic ${good}`,
      good,
      `Bearer ${good}, Bearer ${good}`,
    ]) {
      assert.equal(readBearerKey(bad), null, String(bad));
    }
  });
});
