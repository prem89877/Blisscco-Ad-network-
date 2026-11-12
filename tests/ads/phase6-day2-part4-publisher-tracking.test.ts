import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleImpressionPost, REQUESTS_PER_MINUTE_PER_IP as IMP_LIMIT } from "../../lib/ads/impression-handler";
import { handleClickGet, REQUESTS_PER_MINUTE_PER_IP as CLICK_LIMIT } from "../../lib/ads/click-handler";
import type { ClickResult } from "../../lib/ads/click";
import type { ImpressionResult } from "../../lib/ads/impression";

// Phase 6 Day 2 Part 4: gap tests only (existing tests/ads + tests/publisher already cover auth, shape, dedupe, expiry, SDK retry).
// Scope: REAL handlers with the REAL default per-IP guards (existing tests inject tiny guards) and fake accept functions. NOT PostgreSQL.
// These tests DOCUMENT current behaviour (A: shared-IP cap). They do not change any limit.

const impReq = (ip: string) =>
  new Request("https://blisscco.test/api/v1/ads/impression", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ token: "bt1.a.b", event: "impression" }),
  });
const clickReq = (ip: string, qs = "ref=bc1.a.b", headers: Record<string, string> = {}) =>
  new Request(`https://blisscco.test/api/v1/ads/click?${qs}`, { method: "GET", headers: { "x-forwarded-for": ip, ...headers } });

describe("phase 6 day 2 part 4 | publisher tracking gaps (real handlers, default guards)", () => {
  it("A1 impression: default cap is 300/min per IP; the 301st is 429 + Retry-After 60 and never reaches accept (a busy publisher proxy on ONE IP loses impressions; example does not retry)", async () => {
    let calls = 0;
    const accept = async (): Promise<ImpressionResult> => { calls += 1; return { kind: "recorded" }; };
    const codes = new Set<number>();
    for (let i = 0; i < IMP_LIMIT; i += 1) codes.add((await handleImpressionPost(impReq("198.51.100.201"), { accept })).status);
    assert.deepEqual([...codes], [200]);
    const over = await handleImpressionPost(impReq("198.51.100.201"), { accept });
    assert.equal(over.status, 429);
    assert.equal(over.headers.get("retry-after"), "60");
    assert.equal(over.headers.get("cache-control"), "no-store");
    assert.deepEqual(await over.json(), { error: "rate_limited" });
    assert.equal(calls, IMP_LIMIT);
    assert.equal((await handleImpressionPost(impReq("198.51.100.202"), { accept })).status, 200, "another IP unaffected");
  });

  it("A2 click: default cap is 300/min per IP; the 301st is 429 + Retry-After 60 and never reaches accept", async () => {
    let calls = 0;
    const accept = async (): Promise<ClickResult> => { calls += 1; return { kind: "redirect", location: "https://example.com/p", counted: "recorded" }; };
    for (let i = 0; i < CLICK_LIMIT; i += 1) assert.equal((await handleClickGet(clickReq("198.51.100.211"), { accept })).status, 302);
    const over = await handleClickGet(clickReq("198.51.100.211"), { accept });
    assert.equal(over.status, 429);
    assert.equal(over.headers.get("retry-after"), "60");
    assert.equal(calls, CLICK_LIMIT);
  });

  it("B1 click: destination comes only from accept(); url/redirect/to/dest query params are refused (400) before any lookup; 302 carries no-referrer + no-store", async () => {
    let calls = 0;
    const accept = async (): Promise<ClickResult> => { calls += 1; return { kind: "redirect", location: "https://approved.example/landing", counted: "recorded" }; };
    for (const extra of ["url=https://evil.example", "redirect=https://evil.example", "to=//evil.example", "destination_url=https://evil.example"]) {
      const r = await handleClickGet(clickReq("198.51.100.221", `ref=bc1.a.b&${extra}`), { accept });
      assert.equal(r.status, 400, extra);
      assert.equal(r.headers.get("location"), null);
    }
    assert.equal(calls, 0);
    const ok = await handleClickGet(clickReq("198.51.100.222"), { accept });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "https://approved.example/landing");
    assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
    assert.equal(ok.headers.get("cache-control"), "no-store");
  });

  it("B2 click: prefetch/prerender is 204, not counted, no redirect; an invalid ref and an unavailable creative look the same (404)", async () => {
    let calls = 0;
    const accept = async (): Promise<ClickResult> => { calls += 1; return { kind: "invalid", reason: "expired" }; };
    const pre = await handleClickGet(clickReq("198.51.100.231", "ref=bc1.a.b", { "sec-purpose": "prefetch" }), { accept });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("location"), null);
    assert.equal(calls, 0);
    const a = await handleClickGet(clickReq("198.51.100.232"), { accept });
    const b = await handleClickGet(clickReq("198.51.100.233"), { accept: async () => ({ kind: "unavailable_target" }) });
    assert.equal(a.status, 404);
    assert.equal(b.status, 404);
    assert.deepEqual(await a.json(), await b.json());
  });

  it("C1 impression: 429 (back off), 401 (token refused), 503 (retry later) are three distinct generic answers; a crash leaks nothing", async () => {
    const mk = (r: ImpressionResult | "throw") => async (): Promise<ImpressionResult> => { if (r === "throw") throw new Error("db password hunter2"); return r; };
    const u = await handleImpressionPost(impReq("198.51.100.241"), { accept: mk({ kind: "unauthorized" }) });
    const s = await handleImpressionPost(impReq("198.51.100.242"), { accept: mk({ kind: "unavailable" }) });
    const t = await handleImpressionPost(impReq("198.51.100.243"), { accept: mk("throw") });
    assert.deepEqual([u.status, s.status, t.status], [401, 503, 503]);
    assert.deepEqual(await s.json(), { error: "unavailable" });
    const body = await t.text();
    assert.equal(body.includes("hunter2"), false);
    assert.deepEqual(JSON.parse(body), { error: "unavailable" });
  });
});
