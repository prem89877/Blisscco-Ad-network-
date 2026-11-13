import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDiagLimiter, handleDiagPost, DIAG_PER_USER_PER_MINUTE, DIAG_PER_INSTANCE_PER_MINUTE } from "@/lib/diagnostics/diag-handler";

// Phase 6 Day 3 Part 2, F2: /api/diag login + rate limit. Logic tests (handler, injected login). Browser / Vercel yahan nahi chalta.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const GOOD = JSON.stringify({ event: "action_slow", path: "/dashboard", ms: 6000, outcome: "success" });

function req(body: string = GOOD, headers: Record<string, string> = {}) {
  return new Request("https://blisscco.test/api/diag", { method: "POST", body, headers: { host: "blisscco.test", ...headers } });
}

describe("F2 /api/diag | authentication", () => {
  it("no login (null) => 401, nothing logged, no-store", async () => {
    const lines: string[] = [];
    const res = await handleDiagPost(req(), { getUserId: async () => null, log: (l) => lines.push(l), limiter: createDiagLimiter() });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(lines, []);
  });
  it("login check that throws or returns empty string => 401, nothing logged", async () => {
    for (const getUserId of [async () => { throw new Error("boom"); }, async () => ""]) {
      const lines: string[] = [];
      const res = await handleDiagPost(req(), { getUserId, log: (l) => lines.push(l), limiter: createDiagLimiter() });
      assert.equal(res.status, 401);
      assert.deepEqual(lines, []);
    }
  });
  it("logged-in user: good report still becomes exactly one [diag] line, answer empty 204 (legit diagnostics keep working)", async () => {
    const lines: string[] = [];
    const res = await handleDiagPost(req(GOOD, { "x-vercel-id": "bom1::abc-1" }), { getUserId: async () => "u1", log: (l) => lines.push(l), limiter: createDiagLimiter() });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[diag\] event=action_slow source=browser path=\/dashboard outcome=success ms=6000 vercelId=abc-1$/);
  });
  it("user id never reaches the log line or the response", async () => {
    const lines: string[] = [];
    const res = await handleDiagPost(req(), { getUserId: async () => "secret-user-id-123", log: (l) => lines.push(l), limiter: createDiagLimiter() });
    assert.ok(!lines.join("").includes("secret-user-id-123"));
    assert.ok(!(await res.text()).includes("secret-user-id-123"));
  });
  it("cross-site is refused quietly even when logged in (Origin and Sec-Fetch-Site)", async () => {
    for (const h of [{ origin: "https://evil.com" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      const lines: string[] = [];
      const res = await handleDiagPost(req(GOOD, h), { getUserId: async () => "u1", log: (l) => lines.push(l), limiter: createDiagLimiter() });
      assert.equal(res.status, 204);
      assert.deepEqual(lines, []);
    }
    const ok: string[] = [];
    await handleDiagPost(req(GOOD, { "sec-fetch-site": "same-origin" }), { getUserId: async () => "u1", log: (l) => ok.push(l), limiter: createDiagLimiter() });
    assert.equal(ok.length, 1);
  });
  it("existing quiet rules kept for logged-in users: bad JSON, unknown event, huge body => 204, nothing logged", async () => {
    for (const body of ["not json", JSON.stringify({ event: "hack" }), JSON.stringify({ event: "action_slow", pad: "x".repeat(5000) })]) {
      const lines: string[] = [];
      const res = await handleDiagPost(req(body), { getUserId: async () => "u1", log: (l) => lines.push(l), limiter: createDiagLimiter() });
      assert.equal(res.status, 204);
      assert.deepEqual(lines, []);
    }
  });
});

describe("F2 /api/diag | 401 for every logged-out request (Preview 204 follow-up)", () => {
  it("logged out => 401 even with a foreign Origin, Sec-Fetch-Site cross-site, or a valid-looking body (never 204)", async () => {
    for (const h of [{}, { origin: "https://evil.com" }, { "sec-fetch-site": "cross-site" }, { origin: "https://blisscco.test" }] as Record<string, string>[]) {
      const lines: string[] = [];
      const res = await handleDiagPost(req(GOOD, h), { getUserId: async () => null, log: (l) => lines.push(l), limiter: createDiagLimiter() });
      assert.equal(res.status, 401);
      assert.deepEqual(lines, []);
    }
  });
  it("logged out and rate-limit state: 401 requests do not use up a logged-in user's budget", async () => {
    const limiter = createDiagLimiter(2, 100);
    for (let i = 0; i < 20; i++) await handleDiagPost(req(), { getUserId: async () => null, log: () => undefined, limiter, now: () => 1 });
    assert.equal((await handleDiagPost(req(), { getUserId: async () => "u1", log: () => undefined, limiter, now: () => 1 })).status, 204);
  });
});

describe("F2 /api/diag | rate limiting (per-instance memory, Day 2 style)", () => {
  it("one user: first 30 in a minute pass, 31st => 429 with Retry-After 60, nothing logged for it", async () => {
    const limiter = createDiagLimiter();
    const lines: string[] = [];
    const deps = { getUserId: async () => "u1", log: (l: string) => lines.push(l), limiter, now: () => 1_000_000 };
    for (let i = 0; i < DIAG_PER_USER_PER_MINUTE; i++) assert.equal((await handleDiagPost(req(), deps)).status, 204);
    const res = await handleDiagPost(req(), deps);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.equal(lines.length, DIAG_PER_USER_PER_MINUTE);
  });
  it("another user is not blocked by the first user's limit", async () => {
    const limiter = createDiagLimiter();
    const now = () => 5_000_000;
    for (let i = 0; i < DIAG_PER_USER_PER_MINUTE + 1; i++) await handleDiagPost(req(), { getUserId: async () => "u1", log: () => undefined, limiter, now });
    assert.equal((await handleDiagPost(req(), { getUserId: async () => "u2", log: () => undefined, limiter, now })).status, 204);
  });
  it("window resets after 60 s", async () => {
    const limiter = createDiagLimiter(2, 100);
    let t = 10_000_000;
    const deps = { getUserId: async () => "u1", log: () => undefined, limiter, now: () => t };
    await handleDiagPost(req(), deps);
    await handleDiagPost(req(), deps);
    assert.equal((await handleDiagPost(req(), deps)).status, 429);
    t += 60_001;
    assert.equal((await handleDiagPost(req(), deps)).status, 204);
  });
  it("instance-wide cap holds across many users", () => {
    const limiter = createDiagLimiter(30, DIAG_PER_INSTANCE_PER_MINUTE);
    let allowed = 0;
    for (let i = 0; i < DIAG_PER_INSTANCE_PER_MINUTE + 50; i++) if (limiter.allow(`user-${i}`, 20_000_000)) allowed += 1;
    assert.equal(allowed, DIAG_PER_INSTANCE_PER_MINUTE);
  });
  it("tracked users stay bounded (no memory growth from many ids)", () => {
    const limiter = createDiagLimiter(30, 1_000_000);
    for (let i = 0; i < 5000; i++) limiter.allow(`u-${i}`, 30_000_000);
    assert.equal(limiter.allow("u-new", 30_000_000), true);
  });
});

describe("F2 /api/diag | wiring (source check)", () => {
  it("route uses the verified login (getClaims) and the handler; no Redis / shared storage", () => {
    const r = read("app/api/diag/route.ts");
    assert.match(r, /handleDiagPost\(request, \{ getUserId \}\)/);
    assert.match(r, /getClaims\(\)/);
    assert.doesNotMatch(r + read("lib/diagnostics/diag-handler.ts"), /from ["'](@upstash|@vercel\/kv|redis|ioredis)/);
  });
  it("the browser beacon still posts to /api/diag (sender unchanged)", () => {
    assert.match(read("lib/actions/guard.ts"), /fetch\("\/api\/diag"/);
  });
});
