import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BillingModel, DAY_MS, HOLD_MS, usd, utcDay, type ModelCampaign } from "./event-billing-model";
import { acceptImpression, type ImpressionDeps, type RecordImpressionOutcome } from "../../lib/ads/impression";
import { acceptClick, type ClickDeps, type ClickServeRow, type RecordClickOutcome } from "../../lib/ads/click";
import { mintTrackingToken, readTrackingConfig, type TrackingConfig } from "../../lib/ads/tracking-token";
import { mintClickRef } from "../../lib/ads/click-ref";

// Phase 6 Day 2 Part 2: billing lifecycle (token -> event writer -> settlement).
// LIMIT (zaroori): yahan "writer" BillingModel hai (hath se likha aaina, tests/ads/event-billing-model.ts). Ye Postgres NAHI hai.
// Real PostgreSQL ka saboot sirf tests/integration/phase6-step4-part2-event-billing-db.test.ts (TEST database) deta hai.
// Token / click-ref / handler ka code (impression.ts, click.ts, tracking-token.ts, click-ref.ts) yahan ASLI hai.

const SECRET = "day2-part2-test-secret-".padEnd(48, "x");
const OTHER_SECRET = "another-test-secret-value-".padEnd(48, "y");
const PUB_UUID = "11111111-1111-4111-8111-111111111111";
const PUB2_UUID = "22222222-2222-4222-8222-222222222222";
const CREATIVE_UUID = "33333333-3333-4333-8333-333333333333";
const DEST = "https://example.com/landing";
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0); // 2026-11-12 12:00:00 UTC, poore second par

const cfg = (env: Record<string, string> = {}): TrackingConfig => {
  const c = readTrackingConfig({ AD_TRACKING_SECRET: SECRET, ...env });
  assert.ok(c);
  return c;
};

class Chain {
  readonly m = new BillingModel();
  readonly serves = new Map<string, { serveId: number; publisherId: string; servedAtMs: number }>();
  impressionWrites = 0;
  clickWrites = 0;
  constructor(readonly config: TrackingConfig = cfg(), camp: Partial<ModelCampaign> = {}) {
    this.m.nowMs = T0;
    this.m.addCampaign({ id: "camp", total: usd("1.00"), daily: null, pricing: { model: "cpm", cpmUnits: usd("2.00") }, status: "active", ...camp });
    this.m.publisherActive.set(PUB_UUID, true);
    this.m.publisherActive.set(PUB2_UUID, true);
  }
  serve(publisherId = PUB_UUID): { serveId: number; ref: string; token: string; clickRef: string } {
    const r = this.m.serve("camp", publisherId);
    assert.equal(r.outcome, "ok");
    const serveId = r.outcome === "ok" ? r.serveId : -1;
    const ref = `bsr_${serveId.toString(16).padStart(40, "0")}`;
    this.serves.set(ref, { serveId, publisherId, servedAtMs: this.m.nowMs });
    const token = mintTrackingToken(this.config, { serveRef: ref, publisherId, servedAtMs: this.m.nowMs, nowMs: this.m.nowMs });
    const click = mintClickRef(this.config, { serveRef: ref, publisherId, creativeId: CREATIVE_UUID, servedAtMs: this.m.nowMs, nowMs: this.m.nowMs });
    assert.ok(token && click);
    return { serveId, ref, token: token.token, clickRef: click.ref };
  }
  impressionDeps(config: TrackingConfig | null = this.config): ImpressionDeps {
    return {
      config,
      nowMs: () => this.m.nowMs,
      lookupServe: async (ref) => {
        const s = this.serves.get(ref);
        return s ? { publisherId: s.publisherId, servedAtMs: s.servedAtMs } : null;
      },
      record: async (ref, publisherId): Promise<RecordImpressionOutcome> => {
        this.impressionWrites += 1;
        const s = this.serves.get(ref);
        if (!s) return "rejected";
        try {
          return this.m.impression(s.serveId, publisherId).outcome as RecordImpressionOutcome;
        } catch {
          return "error"; // settlement error => poora event rollback (model atomic)
        }
      },
    };
  }
  clickDeps(config: TrackingConfig | null = this.config): ClickDeps {
    return {
      config,
      nowMs: () => this.m.nowMs,
      lookupServe: async (ref): Promise<ClickServeRow | null> => {
        const s = this.serves.get(ref);
        return s ? { publisherId: s.publisherId, creativeId: CREATIVE_UUID, servedAtMs: s.servedAtMs, destinationUrl: DEST, eligible: true } : null;
      },
      record: async (ref, publisherId): Promise<RecordClickOutcome> => {
        this.clickWrites += 1;
        const s = this.serves.get(ref);
        if (!s) return { outcome: "rejected" };
        try {
          const r = this.m.click(s.serveId, publisherId);
          return r.outcome === "rejected" || r.outcome === "ineligible" ? { outcome: r.outcome } : { outcome: r.outcome, destinationUrl: DEST };
        } catch {
          return { outcome: "error" };
        }
      },
    };
  }
}

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("D. CPM chain: serve free, only the first valid impression settles", () => {
  it("serve charges nothing; impression charges once; 5 replays of the same token are duplicates and free", async () => {
    const c = new Chain();
    const s = c.serve();
    assert.equal(c.m.totalSpentAll(), 0n, "serve is free");
    assert.equal(c.m.heldTotal("camp"), 20n, "serve only reserves");
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "recorded" });
    assert.equal(c.m.totalSpentAll(), 20n);
    for (let i = 0; i < 5; i += 1) assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "duplicate" });
    assert.equal(c.m.totalSpentAll(), 20n, "replays never add a charge");
    assert.equal(c.m.eventCount("impression"), 1);
    assert.equal(c.m.reservationOf(s.serveId)?.status, "settled");
  });

  it("a click on a CPM serve is recorded but never charged (click ref chain)", async () => {
    const c = new Chain();
    const s = c.serve();
    await acceptImpression(s.token, "impression", c.impressionDeps());
    const r = await acceptClick(s.clickRef, c.clickDeps());
    assert.deepEqual(r, { kind: "redirect", location: DEST, counted: "recorded" });
    assert.equal(c.m.totalSpentAll(), 20n, "still only the impression charge");
  });
});

describe("D. CPC chain: serve and impression free, only the first valid click after an impression settles", () => {
  const cpc = { pricing: { model: "cpc" as const, cpcUnits: usd("0.0150") } };
  it("click before impression is not_counted (free); impression is free; first click charges once; replay is duplicate", async () => {
    const c = new Chain(cfg(), cpc);
    const s = c.serve();
    assert.equal(c.m.totalSpentAll(), 0n);
    assert.deepEqual(await acceptClick(s.clickRef, c.clickDeps()), { kind: "redirect", location: DEST, counted: "not_counted" });
    assert.equal(c.m.totalSpentAll(), 0n);
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "recorded" });
    assert.equal(c.m.totalSpentAll(), 0n, "impression on CPC is free");
    assert.deepEqual(await acceptClick(s.clickRef, c.clickDeps()), { kind: "redirect", location: DEST, counted: "recorded" });
    assert.equal(c.m.totalSpentAll(), 150n, "$0.0150 charged exactly once");
    for (let i = 0; i < 4; i += 1) assert.deepEqual(await acceptClick(s.clickRef, c.clickDeps()), { kind: "redirect", location: DEST, counted: "duplicate" });
    assert.equal(c.m.totalSpentAll(), 150n);
    assert.equal(c.m.reservationOf(s.serveId)?.billedEvent, "click");
  });
});

describe("D. tampered, foreign, expired and mis-typed tokens never reach the writer and never charge", () => {
  it("impression: tampered signature / payload / expiry / wrong secret / other publisher / unknown serve => unauthorized, 0 writes, 0 spend", async () => {
    const c = new Chain();
    const s = c.serve();
    const [h, p, sig] = s.token.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
    const longer = b64u(JSON.stringify({ ...payload, exp: Number(payload.exp) + 86_000 })); // expiry badhai, signature purana
    const otherPub = b64u(JSON.stringify({ ...payload, p: "0".repeat(32) }));
    const foreign = mintTrackingToken(cfg({ AD_TRACKING_SECRET: OTHER_SECRET }), { serveRef: Object.keys(Object.fromEntries(c.serves))[0], publisherId: PUB_UUID, servedAtMs: T0, nowMs: T0 });
    const unknownRef = `bsr_${"f".repeat(40)}`;
    const unknown = mintTrackingToken(c.config, { serveRef: unknownRef, publisherId: PUB_UUID, servedAtMs: T0, nowMs: T0 });
    // doosre publisher ke naam ka (sahi signature) token, par serve PUB ki: publisher_mismatch
    const wrongPub = mintTrackingToken(c.config, { serveRef: Object.keys(Object.fromEntries(c.serves))[0], publisherId: PUB2_UUID, servedAtMs: T0, nowMs: T0 });
    const bad = [
      `${h}.${p}.${sig.slice(0, -2)}${sig.endsWith("A") ? "BB" : "AA"}`,
      `${h}.${longer}.${sig}`,
      `${h}.${otherPub}.${sig}`,
      foreign?.token ?? "x",
      unknown?.token ?? "x",
      wrongPub?.token ?? "x",
      "garbage",
      "",
    ];
    for (const t of bad) assert.deepEqual(await acceptImpression(t, "impression", c.impressionDeps()), { kind: "unauthorized" }, t.slice(0, 24));
    assert.equal(c.impressionWrites, 0, "no tampered token reaches the writer");
    assert.equal(c.m.totalSpentAll(), 0n);
    assert.equal(c.m.eventCount(), 0);
    assert.equal(c.m.reservationOf(s.serveId)?.status, "held");
  });

  it("event type: a click ref is not an impression token and an impression token is not a click ref; 'click'/'serve' event names are refused", async () => {
    const c = new Chain();
    const s = c.serve();
    assert.deepEqual(await acceptImpression(s.clickRef, "impression", c.impressionDeps()), { kind: "unauthorized" });
    assert.deepEqual(await acceptImpression(s.token, "click", c.impressionDeps()), { kind: "unauthorized" });
    assert.deepEqual(await acceptImpression(s.token, "serve", c.impressionDeps()), { kind: "unauthorized" });
    const r = await acceptClick(s.token, c.clickDeps());
    assert.equal(r.kind, "invalid");
    assert.equal(c.impressionWrites + c.clickWrites, 0);
    assert.equal(c.m.totalSpentAll(), 0n);
  });

  it("click: tampered / foreign-secret / other-creative refs => invalid, 0 writes, 0 spend", async () => {
    const c = new Chain(cfg(), { pricing: { model: "cpc", cpcUnits: usd("0.0150") } });
    const s = c.serve();
    await acceptImpression(s.token, "impression", c.impressionDeps());
    const [h, p, sig] = s.clickRef.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
    const otherCreative = b64u(JSON.stringify({ ...payload, c: "0".repeat(32) }));
    const ref0 = Object.keys(Object.fromEntries(c.serves))[0];
    const foreign = mintClickRef(cfg({ AD_TRACKING_SECRET: OTHER_SECRET }), { serveRef: ref0, publisherId: PUB_UUID, creativeId: CREATIVE_UUID, servedAtMs: T0, nowMs: T0 });
    for (const bad of [`${h}.${p}.${sig.slice(0, -2)}${sig.endsWith("A") ? "BB" : "AA"}`, `${h}.${otherCreative}.${sig}`, foreign?.ref ?? "x", "garbage"]) {
      assert.equal((await acceptClick(bad, c.clickDeps())).kind, "invalid", bad.slice(0, 24));
    }
    assert.equal(c.clickWrites, 0);
    assert.equal(c.m.totalSpentAll(), 0n);
  });

  it("no tracking secret configured => unavailable, never a charge", async () => {
    const c = new Chain();
    const s = c.serve();
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps(null)), { kind: "unavailable" });
    assert.equal((await acceptClick(s.clickRef, c.clickDeps(null))).kind, "unavailable");
    assert.equal(c.m.totalSpentAll(), 0n);
  });

  it("token lifetime: default 1h token is dead at exactly +1h (no charge); the 24h reservation is then released unused", async () => {
    const c = new Chain();
    const s = c.serve();
    c.m.nowMs = T0 + 3_600_000 - 1;
    const alive = await acceptImpression(s.token, "impression", c.impressionDeps());
    assert.deepEqual(alive, { kind: "recorded" }, "1 ms before token expiry is still valid");
    const d = new Chain();
    const s2 = d.serve();
    d.m.nowMs = T0 + 3_600_000;
    assert.deepEqual(await acceptImpression(s2.token, "impression", d.impressionDeps()), { kind: "unauthorized" });
    assert.equal(d.impressionWrites, 0);
    assert.equal(d.m.totalSpentAll(), 0n);
    d.m.nowMs = T0 + HOLD_MS;
    assert.equal(d.m.releaseExpired(), 1);
    assert.equal(d.m.reservationOf(s2.serveId)?.status, "released");
    assert.equal(d.m.totalSpentAll(), 0n);
  });
});

describe("D. 24-hour boundary and reservation lifecycle (held -> settled | released)", () => {
  const maxTtl = { AD_TRACKING_TTL_SECONDS: "86400" };

  it("model/DB window: 24h - 1 ms bills, exactly 24h and later are rejected and free (impression)", () => {
    for (const [offset, expected] of [[HOLD_MS - 1, "recorded"], [HOLD_MS, "rejected"], [HOLD_MS + 1, "rejected"]] as const) {
      const c = new Chain();
      const s = c.serve();
      c.m.nowMs = T0 + offset;
      const r = c.m.impression(s.serveId, PUB_UUID);
      assert.equal(r.outcome, expected, `offset ${offset}`);
      assert.equal(r.billed, expected === "recorded");
      assert.equal(c.m.totalSpentAll(), expected === "recorded" ? 20n : 0n);
    }
  });

  it("CPC click window: 24h - 1 ms bills, exactly 24h is rejected and free", () => {
    for (const [offset, billed] of [[HOLD_MS - 1, true], [HOLD_MS, false]] as const) {
      const c = new Chain(cfg(), { pricing: { model: "cpc", cpcUnits: usd("0.0150") } });
      const s = c.serve();
      c.m.impression(s.serveId, PUB_UUID);
      c.m.nowMs = T0 + offset;
      const r = c.m.click(s.serveId, PUB_UUID);
      assert.equal(r.billed, billed, `offset ${offset}`);
      assert.equal(c.m.totalSpentAll(), billed ? 150n : 0n);
    }
  });

  it("token with the maximum 24h lifetime: valid at +24h - 1 ms (billed), dead at +24h (nothing written)", async () => {
    const a = new Chain(cfg(maxTtl));
    const sa = a.serve();
    a.m.nowMs = T0 + HOLD_MS - 1;
    assert.deepEqual(await acceptImpression(sa.token, "impression", a.impressionDeps()), { kind: "recorded" });
    assert.equal(a.m.totalSpentAll(), 20n);
    const b = new Chain(cfg(maxTtl));
    const sb = b.serve();
    b.m.nowMs = T0 + HOLD_MS;
    assert.deepEqual(await acceptImpression(sb.token, "impression", b.impressionDeps()), { kind: "unauthorized" });
    assert.equal(b.impressionWrites, 0);
    assert.equal(b.m.totalSpentAll(), 0n);
  });

  it("a rejected late event leaves the hold alone; release then frees it; a settled hold is never released", () => {
    const c = new Chain();
    const used = c.serve();
    const unused = c.serve();
    assert.equal(c.m.heldTotal("camp"), 40n);
    c.m.impression(used.serveId, PUB_UUID);
    assert.equal(c.m.heldTotal("camp"), 20n);
    c.m.nowMs = T0 + HOLD_MS;
    assert.equal(c.m.impression(unused.serveId, PUB_UUID).outcome, "rejected");
    assert.equal(c.m.reservationOf(unused.serveId)?.status, "held", "rejection itself does not charge or settle");
    assert.equal(c.m.heldTotal("camp"), 0n, "expired hold no longer counts");
    assert.equal(c.m.releaseExpired(), 1, "only the unused hold is released");
    assert.equal(c.m.releaseExpired(), 0, "release is idempotent");
    assert.equal(c.m.reservationOf(used.serveId)?.status, "settled");
    assert.equal(c.m.reservationOf(unused.serveId)?.status, "released");
    assert.equal(c.m.totalSpentAll(), 20n, "spend == settled reservations only");
    assert.equal(c.m.impression(unused.serveId, PUB_UUID).billed, false, "released hold can never be charged later");
    c.m.assertBudgetInvariant();
  });

  it("released budget is reusable: a budget for exactly one serve serves again after the first hold expires unused", () => {
    const c = new Chain(cfg(), { total: usd("0.0020") });
    assert.equal(c.m.serve("camp", PUB_UUID).outcome, "ok");
    assert.equal(c.m.serve("camp", PUB_UUID).outcome, "rejected", "first hold fills the budget");
    c.m.nowMs = T0 + HOLD_MS - 1;
    assert.equal(c.m.serve("camp", PUB_UUID).outcome, "rejected", "still live 1 ms before expiry");
    c.m.nowMs = T0 + HOLD_MS;
    assert.equal(c.m.serve("camp", PUB_UUID).outcome, "ok", "hold expired at exactly 24h");
  });

  it("UTC accounting: a serve at 00:00:00.000 UTC belongs to the new UTC day; 23:59:59.999 to the old one; spend lands on the serve's day", () => {
    const midnight = Date.UTC(2026, 10, 13, 0, 0, 0);
    assert.equal(utcDay(midnight), utcDay(midnight - 1) + 1);
    assert.equal(midnight % DAY_MS, 0);
    const c = new Chain();
    c.m.nowMs = midnight - 1;
    const s = c.serve();
    c.m.nowMs = midnight + 5;
    c.m.impression(s.serveId, PUB_UUID);
    assert.equal(c.m.spentOn("camp", utcDay(midnight - 1)), 20n, "booked on the serve's UTC day");
    assert.equal(c.m.spentOn("camp", utcDay(midnight)), 0n, "not on the event's day");
  });

  it("retry: a failed settlement writes nothing (503), the same token is then billed exactly once", async () => {
    const c = new Chain();
    const s = c.serve();
    c.m.failSettlement = true;
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "unavailable" });
    assert.equal(c.m.eventCount(), 0, "event rolled back with the failed settlement");
    assert.equal(c.m.totalSpentAll(), 0n);
    assert.equal(c.m.reservationOf(s.serveId)?.status, "held");
    c.m.failSettlement = false;
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "recorded" });
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "duplicate" });
    assert.equal(c.m.totalSpentAll(), 20n);
  });

  it("an inactive publisher's valid event is recorded but never charged, and cannot be charged later (duplicate)", async () => {
    const c = new Chain();
    const s = c.serve();
    c.m.publisherActive.set(PUB_UUID, false);
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "recorded" });
    assert.equal(c.m.totalSpentAll(), 0n);
    c.m.publisherActive.set(PUB_UUID, true);
    assert.deepEqual(await acceptImpression(s.token, "impression", c.impressionDeps()), { kind: "duplicate" });
    assert.equal(c.m.totalSpentAll(), 0n);
  });
});
