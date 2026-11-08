import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import {
  describeStopEnv,
  isEmergencyStopEnforced,
  parseAdminSafetyState,
  parseStopState,
  validateStopRequest,
  type StopState,
} from "@/lib/ads/emergency-stop";

// Phase 5 Step 4: emergency stop of all ad serving. Bina asli database / network ke: nakli supabase client, nakli stop reader.
// Billing / ledger / payout code ko ye test chhuta nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const KEY = "blc_live_" + "0123456789abcdef".repeat(4);

function request(): Request {
  return new Request("https://example.test/api/v1/ads/match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ topic: "gaming" }),
  });
}

/** Nakli database: sirf rpc ke naam note karta hai; authorize hamesha "unauthorized" deta hai (koi ad / serve nahi banta). */
function installFakeDb(): { rpcCalls: string[] } {
  const rpcCalls: string[] = [];
  (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
    async rpc(fn: string) {
      rpcCalls.push(fn);
      return { data: { outcome: "unauthorized" }, error: null };
    },
  };
  return { rpcCalls };
}

const handle = (stopCheck: (() => Promise<StopState>) | null | undefined) =>
  handleMatchPost(request(), { ipGuard: createIpGuard(), metricSink: null, ...(stopCheck === undefined ? {} : { stopCheck }) });

afterEach(() => {
  delete (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__;
});

describe("phase 5 step 4: emergency stop flag helpers", () => {
  it("enforcement needs the exact value 1 (default off)", () => {
    assert.equal(isEmergencyStopEnforced({}), false);
    for (const v of ["", "0", "true", "yes", " 1", "1 "]) assert.equal(isEmergencyStopEnforced({ EMERGENCY_STOP_ENFORCED: v }), false, v);
    assert.equal(isEmergencyStopEnforced({ EMERGENCY_STOP_ENFORCED: "1" }), true);
  });

  it("describeStopEnv reports presence and length, never the value", () => {
    const d = describeStopEnv({ EMERGENCY_STOP_ENFORCED: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "953bb3d1c751", VERCEL_URL: "x.vercel.app" });
    assert.deepEqual(d, { present: true, length: 1, equalsOne: true, similarKeys: ['"EMERGENCY_STOP_ENFORCED"'], vercelEnv: "preview", commit: "953bb3d", deployment: "x.vercel.app" });
    const missing = describeStopEnv({ "EMERGENCY_STOP_ENFORCED ": "1" });
    assert.equal(missing.present, false);
    assert.deepEqual(missing.similarKeys, ['"EMERGENCY_STOP_ENFORCED "']);
    assert.equal(describeStopEnv({ EMERGENCY_STOP_ENFORCED: "secret-value" }).equalsOne, false);
    assert.ok(!JSON.stringify(describeStopEnv({ EMERGENCY_STOP_ENFORCED: "secret-value" })).includes("secret-value"));
  });

  it("parseStopState: only one row with a real boolean is trusted", () => {
    assert.equal(parseStopState([{ ad_serving_stopped: true }]), "stopped");
    assert.equal(parseStopState([{ ad_serving_stopped: false }]), "running");
    assert.equal(parseStopState({ ad_serving_stopped: true }), "stopped");
    for (const bad of [null, undefined, [], [{}], [{ ad_serving_stopped: "true" }], [{ ad_serving_stopped: 1 }], [{ ad_serving_stopped: false }, { ad_serving_stopped: false }], "x", 7]) {
      assert.equal(parseStopState(bad), "error", JSON.stringify(bad));
    }
  });

  it("validateStopRequest: action and a 3..200 character reason are required", () => {
    assert.deepEqual(validateStopRequest("stop", "  Suspected  key leak "), { ok: true, stopped: true, reason: "Suspected key leak" });
    assert.deepEqual(validateStopRequest("resume", "Checked and safe"), { ok: true, stopped: false, reason: "Checked and safe" });
    for (const [a, r] of [["pause", "reason here"], [null, "reason here"], ["stop", ""], ["stop", "ab"], ["stop", 5], ["stop", "x".repeat(201)]] as const) {
      assert.equal(validateStopRequest(a, r).ok, false, `${String(a)} / ${String(r)}`);
    }
    assert.equal(validateStopRequest("stop", "x".repeat(200)).ok, true);
  });

  it("parseAdminSafetyState keeps only well-formed rows", () => {
    const row = {
      ad_serving_stopped: true,
      reason: "Test stop",
      changed_at: "2026-11-08T10:00:00Z",
      recent_actions: [{ action: "ad_serving_stopped", reason: "Test stop", at: "2026-11-08T10:00:00Z" }, { action: "other", reason: "x", at: "y" }, 5],
    };
    const view = parseAdminSafetyState([row]);
    assert.deepEqual(view, { stopped: true, reason: "Test stop", changedAt: "2026-11-08T10:00:00Z", recent: [{ action: "ad_serving_stopped", reason: "Test stop", at: "2026-11-08T10:00:00Z" }] });
    assert.equal(parseAdminSafetyState([]), null);
    assert.equal(parseAdminSafetyState([{ reason: "x" }]), null);
  });
});

describe("phase 5 step 4: match endpoint and the emergency stop", () => {
  it("stopped: no ad, no database call for authorize / candidates / serve record, answer is a plain no-fill", async () => {
    const { rpcCalls } = installFakeDb();
    const res = await handle(async () => "stopped");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fill: false });
    assert.deepEqual(rpcCalls, []);
  });

  it("running: the normal flow continues (authorize is reached)", async () => {
    const { rpcCalls } = installFakeDb();
    const res = await handle(async () => "running");
    assert.equal(res.status, 401);
    assert.deepEqual(rpcCalls, ["authorize_publisher_key"]);
  });

  it("flag unreadable: fail closed with 503, nothing else runs", async () => {
    const { rpcCalls } = installFakeDb();
    const res = await handle(async () => "error");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { fill: false, error: "unavailable" });
    assert.deepEqual(rpcCalls, []);
  });

  it("reader that throws: still a clean 503 JSON (never a crash page)", async () => {
    installFakeDb();
    const res = await handle(async () => {
      throw new Error("boom");
    });
    assert.equal(res.status, 503);
  });

  it("stopCheck null: switch is not read at all", async () => {
    const { rpcCalls } = installFakeDb();
    const res = await handle(null);
    assert.equal(res.status, 401);
    assert.deepEqual(rpcCalls, ["authorize_publisher_key"]);
  });

  it("default (no env flag): the switch is not read, so existing behaviour is unchanged", async () => {
    const saved = process.env.EMERGENCY_STOP_ENFORCED;
    delete process.env.EMERGENCY_STOP_ENFORCED;
    try {
      const { rpcCalls } = installFakeDb();
      const res = await handle(undefined);
      assert.equal(res.status, 401);
      assert.deepEqual(rpcCalls, ["authorize_publisher_key"]);
    } finally {
      if (saved !== undefined) process.env.EMERGENCY_STOP_ENFORCED = saved;
    }
  });

  it("env flag 1 with the default reader: stopped state in the database stops serving", async () => {
    const saved = process.env.EMERGENCY_STOP_ENFORCED;
    process.env.EMERGENCY_STOP_ENFORCED = "1";
    const rpcCalls: string[] = [];
    (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
      async rpc(fn: string) {
        rpcCalls.push(fn);
        return { data: [{ ad_serving_stopped: true }], error: null };
      },
    };
    try {
      const res = await handle(undefined);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { fill: false });
      assert.deepEqual(rpcCalls, ["get_ad_serving_state"]);
    } finally {
      if (saved === undefined) delete process.env.EMERGENCY_STOP_ENFORCED;
      else process.env.EMERGENCY_STOP_ENFORCED = saved;
    }
  });

  it("env flag 1 and the database read fails: 503, logs only a static label and the error code", async () => {
    const saved = process.env.EMERGENCY_STOP_ENFORCED;
    process.env.EMERGENCY_STOP_ENFORCED = "1";
    (globalThis as { __TEST_SUPABASE__?: unknown }).__TEST_SUPABASE__ = {
      async rpc() {
        return { data: null, error: { code: "57014", message: "SECRET-DETAIL" } };
      },
    };
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const res = await handle(undefined);
      assert.equal(res.status, 503);
      assert.ok(!(await res.text()).includes("SECRET-DETAIL"));
    } finally {
      console.error = original;
      if (saved === undefined) delete process.env.EMERGENCY_STOP_ENFORCED;
      else process.env.EMERGENCY_STOP_ENFORCED = saved;
    }
    assert.ok(!JSON.stringify(logged).includes("SECRET-DETAIL"));
    assert.ok(JSON.stringify(logged).includes("57014"));
  });
});

describe("phase 5 step 4: emergency stop source rules", () => {
  it("the SQL is append-only for the audit log, admin-only for the switch, and never touches money", () => {
    const sql = read("supabase/sql/phase5-step4-1-emergency-stop.sql");
    assert.match(sql, /create or replace function public\.admin_set_ad_serving_stopped\(p_stopped boolean, p_reason text\)/);
    assert.match(sql, /if not \(select private\.is_admin\(\)\) then/);
    assert.match(sql, /grant execute on function public\.admin_set_ad_serving_stopped\(boolean, text\) to authenticated;/);
    assert.match(sql, /grant execute on function public\.get_ad_serving_state\(\) to service_role;/);
    assert.match(sql, /before update or delete on public\.safety_audit_log/);
    assert.match(sql, /before truncate on public\.safety_audit_log/);
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(code, /financial_ledger|ledger_|payout|campaign_spend_daily|record_ad_serve|refund|total_budget|daily_budget/i);
    assert.doesNotMatch(code, /\bdelete\s+from\b|\bdrop\s+table\b/i);
  });

  it("the admin action checks the role first, uses the admin's own session, and has no service-role client", () => {
    const src = read("app/dashboard/admin/safety-actions.ts");
    assert.match(src, /^"use server";/);
    assert.ok(src.indexOf("requireRole([\"admin\"])") > -1 && src.indexOf("requireRole([\"admin\"])") < src.indexOf(".rpc("));
    assert.ok(!/createAdminClient|SUPABASE_SECRET/.test(src));
    assert.match(src, /admin_set_ad_serving_stopped/);
  });

  it("no code path resumes automatically: the only caller of the switch is the admin button", () => {
    const users = ["lib/ads/match-handler.ts", "lib/ads/emergency-stop-db.ts", "lib/ads/service.ts"];
    for (const f of users) assert.ok(!/admin_set_ad_serving_stopped/.test(read(f)), f);
    assert.ok(!/\.rpc\("admin_set_ad_serving_stopped"/.test(read("app/dashboard/admin/page.tsx")));
  });

  it("the reader only reads: one rpc, no billing or ledger words", () => {
    const src = read("lib/ads/emergency-stop-db.ts");
    assert.equal((src.match(/\.rpc\(/g) ?? []).length, 1);
    assert.match(src, /\.rpc\("get_ad_serving_state"\)/);
    assert.doesNotMatch(src, /ledger|payout|refund|record_ad_serve/i);
  });

  it("the admin panel mentions no secret names and nothing about refunds being automatic", () => {
    const src = read("components/admin/EmergencyStopPanel.tsx");
    assert.ok(!/SUPABASE_SECRET_KEY|sb_secret_|service_role/.test(src));
    assert.match(src, /Nothing is refunded or paid out by this switch/);
  });
});
