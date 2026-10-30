import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashApiKey } from "@/lib/ads/api-key";
import { selectAd } from "@/lib/ads/selection";
import { serveAd, type RecordResult, type ReplayResult, type ServeDeps, type ServeResult } from "@/lib/ads/serve";
import { candidateIneligibility, selectEligibleCandidates, type AdCandidate, type CreativeDbStatus } from "@/lib/ads/category-matching";
import type { CampaignDbStatus } from "@/lib/campaigns/constants";
import type { MatchedAd, MatchRequest } from "@/lib/ads/types";

// Day 9 Part 5: concurrent spending, duplicate deductions, failed requests, exhausted budgets, schedule edges.
//
// KAISE: asli database yahan nahi hai, isliye ek chhota in-memory "ledger" banaya hai jo record_ad_serve ke SQL niyam
// (campaign row lock, total + daily check, idempotency key, rollback on failure) ki NAKAL karta hai. Asli serveAd + selectAd
// is par chalte hain. Ye TypeScript flow ko saabit karta hai; asli SQL ka concurrency test tests/integration/ me hai
// (alag TEST database chahiye, bina uske skip hota hai).
// Control test: bina lock wala ledger wahi load par overspend karta hai => ye tests race pakadne layak hain.

const NOW = new Date("2026-10-27T12:00:00Z");
const TODAY = "2026-10-27";
const UNIT_USD = 0.002;
const MICRO = 10_000; // 1 USD = 10_000 micro (4 decimals, jaise numeric(12,4))
const UNIT = Math.round(UNIT_USD * MICRO); // 20
const usd = (micro: number) => micro / MICRO;
const micros = (v: number) => Math.round(v * MICRO);

const KEY_A = `blc_live_${"a".repeat(64)}`;
const KEY_B = `blc_live_${"b".repeat(64)}`;
const HASH_A = hashApiKey(KEY_A);
const HASH_B = hashApiKey(KEY_B);
const PUBLISHERS: Record<string, string> = { [HASH_A]: "99999999-9999-4999-8999-99999999999a", [HASH_B]: "99999999-9999-4999-8999-99999999999b" };

const cid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const camp = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type LCampaign = {
  id: string;
  status: CampaignDbStatus;
  advertiserActive: boolean;
  startDate: string;
  endDate: string | null;
  totalMicro: number;
  dailyMicro: number | null;
  spentTotalMicro: number;
  spentTodayMicro: number;
};
type LCreative = { id: string; campaignId: string; status: CreativeDbStatus };

class Ledger {
  campaigns = new Map<string, LCampaign>();
  creatives = new Map<string, LCreative>();
  /** (publisher, idempotency key) -> creative that was charged */
  keys = new Map<string, string>();
  serveLog: { creativeId: string; publisher: string }[] = [];
  recordCalls = 0;
  /** true = campaign row lock (asli SQL jaisa). false = control test: koi lock nahi. */
  atomic = true;
  /** Itni baar record "transaction" beech me fail ho (rollback ke saath). */
  failNext = 0;
  /** Is hook ke through test selection aur record ke BEECH me state badal sakta hai. */
  beforeRecordHook: (() => void) | null = null;
  private locks = new Map<string, Promise<void>>();

  addCampaign(n: number, over: Partial<LCampaign> = {}, creativeStatus: CreativeDbStatus = "approved"): string {
    const c: LCampaign = {
      id: camp(n),
      status: "active",
      advertiserActive: true,
      startDate: "2026-10-01",
      endDate: null,
      totalMicro: micros(100),
      dailyMicro: null,
      spentTotalMicro: 0,
      spentTodayMicro: 0,
      ...over,
    };
    this.campaigns.set(c.id, c);
    this.creatives.set(cid(n), { id: cid(n), campaignId: c.id, status: creativeStatus });
    return cid(n);
  }

  spent(n: number): number {
    return usd(this.campaigns.get(camp(n))!.spentTotalMicro);
  }
  logRows(n?: number): number {
    return this.serveLog.filter((l) => n === undefined || l.creativeId === cid(n)).length;
  }

  private async lock(key: string): Promise<() => void> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(key, prev.then(() => next));
    await prev;
    return release;
  }

  /** Selection ke liye snapshot: jaan-boojh kar purani ho sakti hai (record tak badal sakti hai). */
  candidates(): AdCandidate[] {
    return [...this.creatives.values()].map((cr) => {
      const c = this.campaigns.get(cr.campaignId)!;
      const ad: MatchedAd = { id: cr.id, headline: `H ${cr.id.slice(-2)}`, body: "B", ctaText: null, destinationUrl: "https://example.com/x" };
      return {
        ad,
        creativeStatus: cr.status,
        campaignId: c.id,
        campaignStatus: c.status,
        category: "gaming",
        startDate: c.startDate,
        endDate: c.endDate,
        totalBudget: usd(c.totalMicro),
        dailyBudget: c.dailyMicro === null ? null : usd(c.dailyMicro),
        spentTotal: usd(c.spentTotalMicro),
        spentToday: usd(c.spentTodayMicro),
        advertiserStatus: c.advertiserActive ? "active" : "suspended",
        advertiserProfileStatus: "active",
        campaignServesToday: 0,
        creativeServesToday: 0,
      } satisfies AdCandidate;
    });
  }

  private adOf(creativeId: string): MatchedAd {
    return { id: creativeId, headline: `H ${creativeId.slice(-2)}`, body: "B", ctaText: null, destinationUrl: "https://example.com/x" };
  }

  lookup(keyHash: string, idem: string): ReplayResult {
    const pub = PUBLISHERS[keyHash];
    if (!pub) return { outcome: "unauthorized" };
    const charged = this.keys.get(`${pub}:${idem}`);
    return charged ? { outcome: "found", ad: this.adOf(charged) } : { outcome: "none" };
  }

  /** record_ad_serve(...) ki nakal. */
  async record(keyHash: string, creativeId: string, _category: string, idem?: string): Promise<RecordResult> {
    this.recordCalls += 1;
    const pub = PUBLISHERS[keyHash];
    if (!pub) return { outcome: "rejected" };

    const releases: (() => void)[] = [];
    try {
      if (idem !== undefined) releases.push(await this.lock(`key:${pub}:${idem}`)); // pg_advisory_xact_lock
      if (idem !== undefined) {
        const earlier = this.keys.get(`${pub}:${idem}`);
        if (earlier) return { outcome: "recorded", replayedAd: this.adOf(earlier) }; // dobara charge NAHI
      }

      const cr = this.creatives.get(creativeId);
      if (!cr) return { outcome: "rejected" };
      if (this.atomic) releases.push(await this.lock(`campaign:${cr.campaignId}`)); // select ... for update

      this.beforeRecordHook?.();
      await Promise.resolve(); // yahan doosri requests beech me ghus sakti hain (lock na ho toh race)

      const c = this.campaigns.get(cr.campaignId)!;
      if (cr.status !== "approved" || c.status !== "active" || !c.advertiserActive) return { outcome: "rejected" };
      if (c.startDate > TODAY || (c.endDate !== null && c.endDate < TODAY)) return { outcome: "rejected" };
      if (c.spentTotalMicro + UNIT > c.totalMicro) return { outcome: "rejected" };
      if (c.dailyMicro !== null && c.spentTodayMicro + UNIT > c.dailyMicro) return { outcome: "rejected" };

      await Promise.resolve(); // check aur write ke beech ek aur mauka (control test ke liye)

      // transaction: sab likho, fail hua toh sab wapas
      const before = { total: c.spentTotalMicro, today: c.spentTodayMicro, log: this.serveLog.length };
      c.spentTotalMicro += UNIT;
      c.spentTodayMicro += UNIT;
      this.serveLog.push({ creativeId, publisher: pub });
      if (this.failNext > 0) {
        this.failNext -= 1;
        c.spentTotalMicro = before.total;
        c.spentTodayMicro = before.today;
        this.serveLog.length = before.log;
        return { outcome: "error" };
      }
      if (idem !== undefined) this.keys.set(`${pub}:${idem}`, creativeId);
      return { outcome: "recorded" };
    } finally {
      for (const r of releases.reverse()) r();
    }
  }

  deps(): ServeDeps & { selectCalls: number } {
    const self = this;
    const deps = {
      selectCalls: 0,
      async authorize(keyHash: string) {
        const pub = PUBLISHERS[keyHash];
        return pub ? ({ outcome: "ok", publisher: { id: pub, status: "active" }, unitCostUsd: UNIT_USD } as const) : ({ outcome: "unauthorized" } as const);
      },
      async select(request: Parameters<ServeDeps["select"]>[0], unitCostUsd: number) {
        deps.selectCalls += 1;
        return selectAd(request, { loadCandidates: async () => self.candidates(), now: () => NOW, unitCostUsd, spendTracking: "reliable" });
      },
      record: (k: string, c: string, cat: Parameters<ServeDeps["record"]>[2], idem?: string) => self.record(k, c, cat, idem),
      lookupReplay: async (k: string, idem: string) => self.lookup(k, idem),
    };
    return deps;
  }
}

const req = (idem?: string): MatchRequest => ({ topic: "gaming", excludeAdIds: [], ...(idem ? { idempotencyKey: idem } : {}) });
const served = (rs: ServeResult[]) => rs.filter((r) => r.kind === "ad");

// ---------------------------------------------------------------------------
// 1. Concurrent spending
// ---------------------------------------------------------------------------
describe("day 9 part 5: concurrent spending never overspends", () => {
  it("20 simultaneous requests, total budget for exactly 5 serves => exactly 5 ads, 15 no-fill, spend == total", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 5 * UNIT });
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 20 }, () => serveAd(HASH_A, req(), deps)));
    assert.equal(served(rs).length, 5);
    assert.equal(rs.filter((r) => r.kind === "no_fill").length, 15);
    assert.equal(l.spent(1), 0.01);
    assert.equal(l.logRows(1), 5);
    assert.ok(rs.every((r) => r.kind === "ad" || r.kind === "no_fill"), "no 503/unavailable under load");
  });

  it("daily budget is enforced under load too (daily for 3 serves, total for 50)", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 50 * UNIT, dailyMicro: 3 * UNIT });
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 12 }, () => serveAd(HASH_A, req(), deps)));
    assert.equal(served(rs).length, 3);
    assert.equal(l.campaigns.get(camp(1))!.spentTodayMicro, 3 * UNIT);
  });

  it("whichever of total/daily is smaller wins", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 2 * UNIT, dailyMicro: 9 * UNIT });
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 10 }, () => serveAd(HASH_A, req(), deps)));
    assert.equal(served(rs).length, 2);
  });

  it("two publishers hammering the same campaign share ONE budget", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 7 * UNIT });
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => serveAd(i % 2 ? HASH_A : HASH_B, req(), deps)));
    assert.equal(served(rs).length, 7);
    assert.equal(l.logRows(), 7);
    assert.ok(l.campaigns.get(camp(1))!.spentTotalMicro <= l.campaigns.get(camp(1))!.totalMicro);
  });

  it("separate campaigns each respect their OWN budget under the same load; once the snapshot refreshes the other campaign serves too", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 3 * UNIT });
    l.addCampaign(2, { totalMicro: 4 * UNIT });
    const deps = l.deps();
    const burst = await Promise.all(Array.from({ length: 40 }, () => serveAd(HASH_A, req(), deps)));
    assert.equal(l.campaigns.get(camp(1))!.spentTotalMicro <= 3 * UNIT, true);
    assert.equal(l.campaigns.get(camp(2))!.spentTotalMicro <= 4 * UNIT, true);
    assert.equal(served(burst).length, l.logRows(), "every delivered ad was charged exactly once, nothing charged without an ad");
    // NOTE (known, documented): in ONE burst every request reads the same stale snapshot and picks the same top campaign, so the
    // losers get no-fill instead of a retry on campaign 2. That costs fill rate, never money. Fresh requests then use campaign 2:
    for (let i = 0; i < 20; i++) await serveAd(HASH_A, req(), deps);
    assert.equal(l.logRows(1), 3);
    assert.equal(l.logRows(2), 4);
    assert.equal(l.spent(1), 0.006);
    assert.equal(l.spent(2), 0.008);
  });

  it("an exhausted campaign is skipped and the other eligible campaign keeps serving", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 100 * UNIT, spentTotalMicro: 100 * UNIT }); // khatam
    l.addCampaign(2, { totalMicro: 4 * UNIT });
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 10 }, () => serveAd(HASH_A, req(), deps)));
    assert.equal(l.logRows(1), 0);
    assert.equal(l.logRows(2), 4);
    assert.equal(served(rs).length, 4);
  });

  it("exact fit: spent + one unit == total is served once, then nothing", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 100 * UNIT, spentTotalMicro: 99 * UNIT });
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 5 }, () => serveAd(HASH_A, req(), deps)));
    assert.equal(served(rs).length, 1);
    assert.equal(l.campaigns.get(camp(1))!.spentTotalMicro, 100 * UNIT);
  });

  it("one micro-dollar short of a full unit is NOT served", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 100 * UNIT, spentTotalMicro: 100 * UNIT - UNIT + 1 });
    const rs = await Promise.all(Array.from({ length: 3 }, () => serveAd(HASH_A, req(), l.deps())));
    assert.equal(served(rs).length, 0);
    assert.equal(l.logRows(), 0);
  });

  it("CONTROL: the same load against a ledger WITHOUT the row lock overspends (so these tests do catch races)", async () => {
    const l = new Ledger();
    l.atomic = false;
    l.addCampaign(1, { totalMicro: 5 * UNIT });
    const deps = l.deps();
    await Promise.all(Array.from({ length: 20 }, () => serveAd(HASH_A, req(), deps)));
    assert.ok(l.campaigns.get(camp(1))!.spentTotalMicro > 5 * UNIT, "without a lock the budget is blown");
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicate deductions (idempotency)
// ---------------------------------------------------------------------------
describe("day 9 part 5: duplicate deductions", () => {
  it("the SAME Idempotency-Key sent 10 times at once is charged exactly once and every caller gets the same ad", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    l.addCampaign(2);
    const deps = l.deps();
    const rs = await Promise.all(Array.from({ length: 10 }, () => serveAd(HASH_A, req("retry-key-0001"), deps)));
    assert.equal(l.logRows(), 1);
    assert.equal(l.campaigns.get(camp(1))!.spentTotalMicro + l.campaigns.get(camp(2))!.spentTotalMicro, UNIT);
    const ids = new Set(rs.map((r) => (r.kind === "ad" ? r.ad.id : r.kind)));
    assert.equal(ids.size, 1);
    assert.equal(rs.every((r) => r.kind === "ad"), true);
  });

  it("sequential retry of a charged key: same ad, no second charge, selection is never run again", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    const first = await serveAd(HASH_A, req("retry-key-0002"), deps);
    const selectsAfterFirst = deps.selectCalls;
    const second = await serveAd(HASH_A, req("retry-key-0002"), deps);
    assert.deepEqual(second, first);
    assert.equal(deps.selectCalls, selectsAfterFirst);
    assert.equal(l.logRows(), 1);
    assert.equal(l.spent(1), usd(UNIT));
  });

  it("retry after the budget ran out still returns the paid ad (not a no-fill) and charges nothing more", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: UNIT });
    const deps = l.deps();
    const first = await serveAd(HASH_A, req("retry-key-0003"), deps);
    assert.equal(first.kind, "ad");
    assert.equal((await serveAd(HASH_A, req(), deps)).kind, "no_fill");
    const retry = await serveAd(HASH_A, req("retry-key-0003"), deps);
    assert.deepEqual(retry, first);
    assert.equal(l.logRows(), 1);
  });

  it("different keys are different charges; no key at all is a charge per request", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    await serveAd(HASH_A, req("retry-key-1111"), deps);
    await serveAd(HASH_A, req("retry-key-2222"), deps);
    await serveAd(HASH_A, req(), deps);
    await serveAd(HASH_A, req(), deps);
    assert.equal(l.logRows(), 4);
  });

  it("the same key string from two different publishers is two independent charges (key is scoped per publisher)", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    await Promise.all([serveAd(HASH_A, req("shared-key-001"), deps), serveAd(HASH_B, req("shared-key-001"), deps)]);
    assert.equal(l.logRows(), 2);
  });

  it("serveAd calls record at most once per request, and never when nothing is selected", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 3 * UNIT });
    const deps = l.deps();
    await Promise.all(Array.from({ length: 10 }, () => serveAd(HASH_A, req(), deps)));
    // record sirf unhi requests ke liye bula jinhe selection ne ad diya (stale snapshot ki wajah se 3 se zyada ho sakte hain, 10 se zyada nahi)
    assert.ok(l.recordCalls <= 10);
    assert.equal(l.logRows(), 3);
    const before = l.recordCalls;
    await serveAd(HASH_A, req(), deps); // ab selection khud no-fill dega (spend ab 3 units hai)
    assert.equal(l.recordCalls, before, "exhausted campaign => record is not even attempted");
  });
});

// ---------------------------------------------------------------------------
// 3. Failed requests
// ---------------------------------------------------------------------------
describe("day 9 part 5: failed requests are never charged", () => {
  it("record fails mid-transaction: no ad, no spend, no log row (rolled back)", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    l.failNext = 1;
    const r = await serveAd(HASH_A, req(), l.deps());
    assert.deepEqual(r, { kind: "unavailable" });
    assert.equal(l.spent(1), 0);
    assert.equal(l.logRows(), 0);
  });

  it("a failed keyed request does not burn the key: the retry is served and charged exactly once", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    l.failNext = 1;
    assert.deepEqual(await serveAd(HASH_A, req("retry-key-fail1"), deps), { kind: "unavailable" });
    assert.equal(l.keys.size, 0);
    const retry = await serveAd(HASH_A, req("retry-key-fail1"), deps);
    assert.equal(retry.kind, "ad");
    assert.equal(l.logRows(), 1);
    assert.equal(l.spent(1), usd(UNIT));
  });

  it("failures mixed into a concurrent burst: only successful records cost money", async () => {
    const l = new Ledger();
    l.addCampaign(1, { totalMicro: 100 * UNIT });
    l.failNext = 4;
    const rs = await Promise.all(Array.from({ length: 10 }, () => serveAd(HASH_A, req(), l.deps())));
    assert.equal(rs.filter((r) => r.kind === "unavailable").length, 4);
    assert.equal(served(rs).length, 6);
    assert.equal(l.logRows(), 6);
    assert.equal(l.campaigns.get(camp(1))!.spentTotalMicro, 6 * UNIT);
  });

  it("a record call that THROWS gives 'unavailable' and no ad", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    deps.record = async () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await serveAd(HASH_A, req(), deps), { kind: "unavailable" });
    assert.equal(l.logRows(), 0);
  });

  it("unauthorized / rate limited / failed authorize stop before selection and record", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    const bad = hashApiKey(`blc_live_${"d".repeat(64)}`);
    assert.deepEqual(await serveAd(bad, req(), deps), { kind: "unauthorized" });
    deps.authorize = async () => ({ outcome: "rate_limited" });
    assert.deepEqual(await serveAd(HASH_A, req(), deps), { kind: "rate_limited" });
    deps.authorize = async () => ({ outcome: "error" });
    assert.deepEqual(await serveAd(HASH_A, req(), deps), { kind: "unavailable" });
    assert.equal(l.recordCalls, 0);
    assert.equal(deps.selectCalls, 0);
  });

  it("candidate loading failure is 'unavailable' (503), not a silent no-fill, and nothing is recorded", async () => {
    const l = new Ledger();
    l.addCampaign(1);
    const deps = l.deps();
    deps.select = async (request, unitCostUsd) =>
      selectAd(request, { loadCandidates: async () => { throw new Error("db down"); }, now: () => NOW, unitCostUsd, spendTracking: "reliable" });
    assert.deepEqual(await serveAd(HASH_A, req(), deps), { kind: "unavailable" });
    assert.equal(l.recordCalls, 0);
  });
});

// ---------------------------------------------------------------------------
// 4. State changes between selection and record (paused / rejected / unapproved / ended / suspended)
// ---------------------------------------------------------------------------
describe("day 9 part 5: campaign changes between selection and charge", () => {
  const cases: [string, (l: Ledger) => void][] = [
    ["campaign paused", (l) => (l.campaigns.get(camp(1))!.status = "paused")],
    ["campaign rejected", (l) => (l.campaigns.get(camp(1))!.status = "rejected")],
    ["campaign sent back to pending review", (l) => (l.campaigns.get(camp(1))!.status = "pending_review")],
    ["campaign completed", (l) => (l.campaigns.get(camp(1))!.status = "completed")],
    ["campaign archived", (l) => (l.campaigns.get(camp(1))!.status = "archived")],
    ["creative rejected", (l) => (l.creatives.get(cid(1))!.status = "rejected")],
    ["creative paused", (l) => (l.creatives.get(cid(1))!.status = "paused")],
    ["creative back to pending review", (l) => (l.creatives.get(cid(1))!.status = "pending_review")],
    ["end date passes", (l) => (l.campaigns.get(camp(1))!.endDate = "2026-10-26")],
    ["advertiser suspended", (l) => (l.campaigns.get(camp(1))!.advertiserActive = false)],
    ["another request used up the last budget", (l) => (l.campaigns.get(camp(1))!.spentTotalMicro = l.campaigns.get(camp(1))!.totalMicro)],
  ];
  for (const [label, mutate] of cases) {
    it(`${label}: the ad is NOT delivered and NOT charged`, async () => {
      const l = new Ledger();
      l.addCampaign(1);
      l.beforeRecordHook = () => mutate(l);
      const r = await serveAd(HASH_A, req(), l.deps());
      assert.deepEqual(r, { kind: "no_fill" });
      assert.equal(l.logRows(), 0);
      assert.equal(l.campaigns.get(camp(1))!.spentTodayMicro, 0);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Eligibility: advertiser / approval / schedule boundaries (pure)
// ---------------------------------------------------------------------------
describe("day 9 part 5: eligibility matrix", () => {
  const base = (): AdCandidate => {
    const l = new Ledger();
    l.addCampaign(1);
    return l.candidates()[0];
  };
  const ctx = { today: TODAY, unitCostUsd: UNIT_USD };

  it("baseline candidate is eligible", () => {
    assert.equal(candidateIneligibility(base(), "gaming", ctx), null);
  });

  it("every non-approved creative status is rejected", () => {
    for (const s of ["draft", "pending_review", "rejected", "paused", "archived"] as const) {
      assert.equal(candidateIneligibility({ ...base(), creativeStatus: s }, "gaming", ctx), "creative_not_approved", s);
    }
  });

  it("every non-active campaign status is rejected", () => {
    for (const s of ["draft", "pending_review", "paused", "completed", "rejected", "archived"] as const) {
      assert.equal(candidateIneligibility({ ...base(), campaignStatus: s }, "gaming", ctx), "campaign_not_active", s);
    }
  });

  it("advertiser or its profile not active => never served", () => {
    for (const s of ["pending", "suspended"] as const) {
      assert.equal(candidateIneligibility({ ...base(), advertiserStatus: s }, "gaming", ctx), "advertiser_not_active", s);
    }
    assert.equal(candidateIneligibility({ ...base(), advertiserProfileStatus: "suspended" }, "gaming", ctx), "advertiser_profile_not_active");
  });

  it("schedule: starts today OK, starts tomorrow no; ends today OK, ended yesterday no", () => {
    assert.equal(candidateIneligibility({ ...base(), startDate: TODAY }, "gaming", ctx), null);
    assert.equal(candidateIneligibility({ ...base(), startDate: "2026-10-28" }, "gaming", ctx), "not_started");
    assert.equal(candidateIneligibility({ ...base(), endDate: TODAY }, "gaming", ctx), null);
    assert.equal(candidateIneligibility({ ...base(), endDate: "2026-10-26" }, "gaming", ctx), "ended");
  });

  it("schedule: dates compare as dates across month/year ends and leap day", () => {
    const c = (start: string, end: string | null) => ({ ...base(), startDate: start, endDate: end });
    assert.equal(candidateIneligibility(c("2026-12-31", null), "gaming", { ...ctx, today: "2027-01-01" }), null);
    assert.equal(candidateIneligibility(c("2026-01-01", "2026-12-31"), "gaming", { ...ctx, today: "2027-01-01" }), "ended");
    assert.equal(candidateIneligibility(c("2028-02-29", null), "gaming", { ...ctx, today: "2028-02-28" }), "not_started");
    assert.equal(candidateIneligibility(c("2028-02-29", "2028-02-29"), "gaming", { ...ctx, today: "2028-02-29" }), null);
    assert.equal(candidateIneligibility(c("2028-02-29", "2028-02-29"), "gaming", { ...ctx, today: "2028-03-01" }), "ended");
  });

  it("budget: float noise (0.1 + 0.2 style spend) does not flip the exact-fit answer", () => {
    const b = { ...base(), totalBudget: 0.5, spentTotal: 0.1 + 0.2 + 0.198 }; // 0.498 + 0.002 == 0.5
    assert.equal(candidateIneligibility(b, "gaming", ctx), null);
    assert.equal(candidateIneligibility({ ...b, spentTotal: 0.4985 }, "gaming", ctx), "total_budget_exhausted");
  });

  it("budget: total exhausted is reported before daily; daily null means no daily limit; spent over total is exhausted", () => {
    assert.equal(candidateIneligibility({ ...base(), totalBudget: 1, spentTotal: 1, dailyBudget: 0.5, spentToday: 0.5 }, "gaming", ctx), "total_budget_exhausted");
    assert.equal(candidateIneligibility({ ...base(), dailyBudget: null, spentToday: 99 }, "gaming", ctx), null);
    assert.equal(candidateIneligibility({ ...base(), totalBudget: 1, spentTotal: 5 }, "gaming", ctx), "total_budget_exhausted");
    assert.equal(candidateIneligibility({ ...base(), dailyBudget: 1, spentToday: 1 }, "gaming", ctx), "daily_budget_exhausted");
  });

  it("budget: 'skip' mode (no reliable spend data) ignores budgets but never the lifecycle/schedule rules", () => {
    const skip = { ...ctx, budgetCheck: "skip" as const };
    assert.equal(candidateIneligibility({ ...base(), totalBudget: 1, spentTotal: 99 }, "gaming", skip), null);
    assert.equal(candidateIneligibility({ ...base(), campaignStatus: "paused", totalBudget: 1, spentTotal: 99 }, "gaming", skip), "campaign_not_active");
    assert.equal(candidateIneligibility({ ...base(), endDate: "2026-10-26" }, "gaming", skip), "ended");
  });

  it("duplicate rows for the same creative collapse to one candidate; the same creative can't win twice", () => {
    const a = base();
    const list = selectEligibleCandidates([a, { ...a }, { ...a, ad: { ...a.ad, id: a.ad.id.toUpperCase() } }], "gaming", ctx);
    assert.equal(list.length, 1);
  });
});
