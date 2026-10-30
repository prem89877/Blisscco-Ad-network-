import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FAILURE_LIMIT, MAX_TRACKED_IPS, clientIpFromHeaders, createIpGuard } from "@/lib/ads/ip-guard";
import { handleMatchPost } from "@/lib/ads/match-handler";

const ROOT = path.join(__dirname, "..", "..", "..");
const sql = readFileSync(path.join(ROOT, "supabase/sql/day-7-1-budget-keys-retention.sql"), "utf8").replace(/--.*$/gm, "");

describe("day 7: IP guard (galat key ki roktham)", () => {
  it("blocks only after the limit, only inside the window", () => {
    const g = createIpGuard(3, 1000);
    for (let i = 0; i < 2; i++) g.recordFailure("1.2.3.4", 0);
    assert.equal(g.isBlocked("1.2.3.4", 10), false);
    g.recordFailure("1.2.3.4", 20);
    assert.equal(g.isBlocked("1.2.3.4", 30), true);
    assert.equal(g.isBlocked("5.6.7.8", 30), false, "other IPs are unaffected");
    assert.equal(g.isBlocked("1.2.3.4", 1500), false, "window passed");
  });
  it("no IP => guard is skipped (never blocks everyone together)", () => {
    const g = createIpGuard(1, 1000);
    g.recordFailure(null, 0);
    g.recordFailure(null, 0);
    assert.equal(g.isBlocked(null, 0), false);
  });
  it("memory is capped", () => {
    const g = createIpGuard(5, 60_000);
    for (let i = 0; i < MAX_TRACKED_IPS + 50; i++) g.recordFailure(`10.0.${Math.floor(i / 250)}.${i % 250}`, i);
    assert.ok(MAX_TRACKED_IPS > 0);
    assert.doesNotThrow(() => g.isBlocked("10.0.0.1", 1));
  });
  it("reads the first forwarded IP and ignores junk", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    assert.equal(clientIpFromHeaders(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })), "9.9.9.9");
    assert.equal(clientIpFromHeaders(h({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
    assert.equal(clientIpFromHeaders(h({ "x-forwarded-for": "<script>" })), null);
    assert.equal(clientIpFromHeaders(h({})), null);
    assert.ok(FAILURE_LIMIT >= 5);
  });
  it("the match route answers 429 without touching the database once an IP is blocked", async () => {
    const guard = createIpGuard(2, 60_000);
    const post = () =>
      handleMatchPost(
        new Request("http://x/api/v1/ads/match", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
          body: '{"topic":"gaming"}',
        }),
        { ipGuard: guard },
      );
    assert.equal((await post()).status, 401);
    assert.equal((await post()).status, 401);
    const blocked = await post();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.deepEqual(await blocked.json(), { error: "rate_limited" });
  });
});

describe("day 7: SQL migration (static check; real proof = running it on Supabase)", () => {
  const body = /create or replace function public\.record_ad_serve[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? "";
  it("record_ad_serve locks the campaign, checks both budgets, and writes spend", () => {
    assert.ok(body.length > 500);
    assert.match(body, /for update of c/);
    assert.match(body, /v_spent_total \+ v_unit > v_total/);
    assert.match(body, /v_daily is not null and v_spent_today \+ v_unit > v_daily/);
    assert.match(body, /insert into public\.campaign_spend_daily/);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
  });
  it("record_ad_serve keeps re-checking key, publisher, profile and expiry", () => {
    for (const re of [/k\.key_hash = p_key_hash/, /k\.status\s*=\s*'active'/, /k\.expires_at is null or k\.expires_at > now\(\)/, /p\.status\s*=\s*'active'/, /pr\.status\s*=\s*'active'/]) {
      assert.match(body, re);
    }
    assert.ok(!/p_publisher_id/.test(body), "publisher id never comes from a parameter");
  });
  it("key functions are service_role only; spend function is authenticated only", () => {
    for (const fn of ["issue_publisher_key_for(uuid, text, text, text, text, timestamptz)", "list_publisher_keys_for(uuid)", "revoke_publisher_key_for(uuid, uuid)"]) {
      const esc = fn.replace(/[()]/g, "\\$&");
      assert.match(sql, new RegExp(`revoke all on function public\\.${esc}\\s+from public, anon, authenticated;`));
      assert.match(sql, new RegExp(`grant execute on function public\\.${esc}\\s+to service_role;`));
    }
    assert.match(sql, /grant execute on function public\.get_my_campaign_spend\(uuid\) to authenticated;/);
    assert.ok(!/grant execute[^;]*to (anon|public)\b/i.test(sql));
  });
  it("old matching function is switched off and the purge never touches spend", () => {
    assert.match(sql, /revoke all on function public\.match_contextual_ad\(text, text, uuid\[\]\) from public, anon, authenticated, service_role;/);
    const purge = /function private\.purge_old_ad_logs[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? "";
    assert.ok(purge.length > 100);
    assert.ok(!/delete from public\.campaign_spend_daily/.test(purge));
    assert.match(purge, /greatest\(coalesce\(p_keep_days, 90\), 30\)/);
  });
  it("the migration commits and never stores a raw key", () => {
    assert.match(sql, /\bbegin;/);
    assert.match(sql, /\bcommit;/);
    assert.ok(!/key_plain|raw_key/i.test(sql));
  });
});

describe("day 7: secrets and logging", () => {
  const keysDb = readFileSync(path.join(ROOT, "lib/publisher/keys-db.ts"), "utf8");
  it("key module is server-only and logs only error codes", () => {
    assert.match(keysDb, /^import "server-only";/m);
    for (const line of keysDb.split("\n").filter((l) => /console\./.test(l))) {
      assert.ok(!/\bkey\b|parts|hash/i.test(line.replace(/"\[publisher\/keys\][^"]*"/, "")), line);
    }
  });
  it("the admin client has a database time-out", () => {
    assert.match(readFileSync(path.join(ROOT, "lib/supabase/admin.ts"), "utf8"), /AbortSignal\.timeout/);
  });
  it("both ad routes declare maxDuration", () => {
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) {
      assert.match(readFileSync(path.join(ROOT, f), "utf8"), /export const maxDuration = \d+;/);
    }
  });
});
