import { serveChargeUnitsFromCpm } from "@/lib/ledger/decimal";

// Phase 6 Step 4 Part 2: event-billing ka MODEL (sirf tests ke liye). Ye supabase/sql/phase6-step4-part2-event-billing.sql ke
// record_ad_serve / record_ad_impression / record_ad_click / private.settle_event_billing ka hath se likha aaina hai.
// LIMIT: ye SQL khud nahi hai. Asli Postgres behaviour (locks, unique constraint, rollback) ka saboot sirf
// tests/integration/phase6-step4-part2-event-billing-db.test.ts deta hai (TEST database par, jab aap use chalayen).
// Paise ki ginti BigInt "units" me: 1 unit = $0.0001 (lib/ledger/decimal.ts jaisa). Float kahin nahi.

export const DAY_MS = 86_400_000;
export const HOLD_MS = 24 * 3_600_000; // reservation / event window = serve se 24 ghante
export const utcDay = (ms: number): number => Math.floor(ms / DAY_MS); // UTC din (session timezone ka koi asar nahi)

export type PricingModel = "cpm" | "cpc";
export type ModelPricing = { model: PricingModel | null; cpmUnits?: bigint; cpcUnits?: bigint };
export type ModelCampaign = { id: string; total: bigint; daily: bigint | null; pricing: ModelPricing; status: "active" | "paused" };
type Reservation = {
  serveId: number;
  campaignId: string;
  publisherId: string;
  model: PricingModel;
  amount: bigint;
  reserveDay: number;
  status: "held" | "settled" | "released";
  billedEvent: "impression" | "click" | null;
  expiresAtMs: number;
};
type Serve = { id: number; campaignId: string; publisherId: string; servedAtMs: number };

export type ServeResult = { outcome: "ok"; serveId: number } | { outcome: "rejected" };
export type EventResult = { outcome: "recorded" | "duplicate" | "rejected" | "not_counted" | "ineligible"; billed: boolean };

export class BillingModel {
  nowMs = Date.UTC(2026, 10, 10, 12, 0, 0);
  platformCpmUnits = 20_000n; // $2.00 CPM (ad_platform_settings default)
  ledgerEnabled = false; // ledger band (default)
  shareBps: number | null = null;
  /** true => settlement ke andar error aata hai (rollback test). */
  failSettlement = false;
  /** true => ledger likhte waqt error (rollback test; sirf tab chalta hai jab ledgerEnabled). */
  failLedger = false;

  campaigns = new Map<string, ModelCampaign>();
  publisherActive = new Map<string, boolean>();
  private serves = new Map<number, Serve>();
  private reservations = new Map<number, Reservation>();
  private events = new Set<string>(); // `${serveId}|${type}` : unique (serve_id, event_type)
  private spend = new Map<string, bigint>(); // `${campaignId}|${day}`
  ledger = new Map<string, bigint>(); // idempotency key -> amount
  private nextServeId = 1;

  addCampaign(c: ModelCampaign): void {
    this.campaigns.set(c.id, c);
  }

  /** Migration se pehle ki serve: reservation nahi (charge serve par ho chuka tha). */
  addLegacyServe(campaignId: string, publisherId: string): number {
    const id = this.nextServeId++;
    this.serves.set(id, { id, campaignId, publisherId, servedAtMs: this.nowMs });
    return id;
  }

  // ---------- helpers (SQL ke same formulas) ----------
  reservationAmount(c: ModelCampaign): bigint | null {
    if (c.pricing.model === "cpc") return c.pricing.cpcUnits ?? null;
    const cpm = c.pricing.model === "cpm" && c.pricing.cpmUnits !== undefined ? c.pricing.cpmUnits : this.platformCpmUnits;
    return serveChargeUnitsFromCpm(cpm); // greatest(round(cpm / 1000, 4), 0.0001)
  }
  spentTotal(campaignId: string): bigint {
    let t = 0n;
    for (const [k, v] of this.spend) if (k.startsWith(`${campaignId}|`)) t += v;
    return t;
  }
  spentOn(campaignId: string, day: number): bigint {
    return this.spend.get(`${campaignId}|${day}`) ?? 0n;
  }
  private live(r: Reservation): boolean {
    return r.status === "held" && r.expiresAtMs > this.nowMs;
  }
  heldTotal(campaignId: string): bigint {
    let t = 0n;
    for (const r of this.reservations.values()) if (r.campaignId === campaignId && this.live(r)) t += r.amount;
    return t;
  }
  heldOn(campaignId: string, day: number): bigint {
    let t = 0n;
    for (const r of this.reservations.values()) if (r.campaignId === campaignId && r.reserveDay === day && this.live(r)) t += r.amount;
    return t;
  }
  reservationOf(serveId: number): Readonly<Reservation> | undefined {
    return this.reservations.get(serveId);
  }
  eventCount(type?: "impression" | "click"): number {
    let n = 0;
    for (const k of this.events) if (!type || k.endsWith(`|${type}`)) n += 1;
    return n;
  }
  totalSpentAll(): bigint {
    let t = 0n;
    for (const v of this.spend.values()) t += v;
    return t;
  }
  releaseExpired(): number {
    let n = 0;
    for (const r of this.reservations.values()) if (r.status === "held" && r.expiresAtMs <= this.nowMs) (r.status = "released"), (n += 1);
    return n;
  }

  /** Poori operation ek transaction: error aaye toh sab pehle jaisa (SQL function ka statement-level rollback). */
  private atomic<T>(fn: () => T): T {
    const snap = {
      serves: new Map([...this.serves].map(([k, v]) => [k, { ...v }] as const)),
      reservations: new Map([...this.reservations].map(([k, v]) => [k, { ...v }] as const)),
      events: new Set(this.events),
      spend: new Map(this.spend),
      ledger: new Map(this.ledger),
      next: this.nextServeId,
    };
    try {
      return fn();
    } catch (e) {
      this.serves = snap.serves;
      this.reservations = snap.reservations;
      this.events = snap.events;
      this.spend = snap.spend;
      this.ledger = snap.ledger;
      this.nextServeId = snap.next;
      throw e;
    }
  }

  // ---------- record_ad_serve: sirf BUDGET RESERVE, paisa nahi katta ----------
  serve(campaignId: string, publisherId: string): ServeResult {
    return this.atomic(() => {
      const c = this.campaigns.get(campaignId);
      const today = utcDay(this.nowMs);
      if (!c || c.status !== "active" || this.publisherActive.get(publisherId) === false) return { outcome: "rejected" } as const;
      const amount = this.reservationAmount(c);
      if (amount === null || amount <= 0n) return { outcome: "rejected" } as const;
      this.releaseExpiredFor(campaignId);
      if (this.spentTotal(campaignId) + this.heldTotal(campaignId) + amount > c.total) return { outcome: "rejected" } as const;
      if (c.daily !== null && this.spentOn(campaignId, today) + this.heldOn(campaignId, today) + amount > c.daily) return { outcome: "rejected" } as const;
      const id = this.nextServeId++;
      this.serves.set(id, { id, campaignId, publisherId, servedAtMs: this.nowMs });
      this.reservations.set(id, {
        serveId: id,
        campaignId,
        publisherId,
        model: c.pricing.model === "cpc" ? "cpc" : "cpm",
        amount,
        reserveDay: today,
        status: "held",
        billedEvent: null,
        expiresAtMs: this.nowMs + HOLD_MS,
      });
      // NOTE: spend map yahan kabhi nahi badalta (serve par charge nahi).
      return { outcome: "ok", serveId: id } as const;
    });
  }
  private releaseExpiredFor(campaignId: string): void {
    for (const r of this.reservations.values()) if (r.campaignId === campaignId && r.status === "held" && r.expiresAtMs <= this.nowMs) r.status = "released";
  }

  // ---------- private.settle_event_billing ----------
  private settle(serveId: number, type: "impression" | "click"): boolean {
    const r = this.reservations.get(serveId);
    if (!r) return false; // legacy serve
    if ((r.model === "cpm" && type !== "impression") || (r.model === "cpc" && type !== "click")) return false;
    if (r.status !== "held") return false;
    if (r.expiresAtMs <= this.nowMs) {
      r.status = "released";
      return false;
    }
    if (this.publisherActive.get(r.publisherId) === false) return false;
    r.status = "settled";
    r.billedEvent = type;
    const key = `${r.campaignId}|${r.reserveDay}`; // reserve_day (serve ka UTC din), event ka din nahi
    this.spend.set(key, (this.spend.get(key) ?? 0n) + r.amount);
    if (this.failSettlement) throw new Error("settlement failed");
    this.writeLedger(serveId, r);
    return true;
  }
  private writeLedger(serveId: number, r: Reservation): void {
    if (!this.ledgerEnabled) return;
    if (this.failLedger) throw new Error("ledger failed");
    const ref = `serve:${serveId}`;
    this.ledgerAppend(`${ref}:advertiser_charge`, r.amount);
    if (this.shareBps !== null) {
      const pub = (r.amount * BigInt(this.shareBps)) / 10_000n; // trunc
      if (pub > 0n) this.ledgerAppend(`${ref}:publisher_earning`, pub);
      if (r.amount - pub > 0n) this.ledgerAppend(`${ref}:platform_revenue`, r.amount - pub);
    }
  }
  private ledgerAppend(key: string, amount: bigint): void {
    const prev = this.ledger.get(key);
    if (prev !== undefined) {
      if (prev !== amount) throw new Error("ledger idempotency conflict");
      return;
    }
    this.ledger.set(key, amount);
  }

  // ---------- record_ad_impression ----------
  impression(serveId: number, publisherId: string): EventResult {
    return this.atomic(() => {
      const s = this.serves.get(serveId);
      if (!s || s.publisherId !== publisherId) return { outcome: "rejected", billed: false } as const;
      if (this.nowMs >= s.servedAtMs + HOLD_MS) return { outcome: "rejected", billed: false } as const;
      const key = `${serveId}|impression`;
      if (this.events.has(key)) return { outcome: "duplicate", billed: false } as const;
      this.events.add(key);
      return { outcome: "recorded", billed: this.settle(serveId, "impression") } as const;
    });
  }

  // ---------- record_ad_click ----------
  click(serveId: number, publisherId: string, claimedCampaignOk = true): EventResult {
    return this.atomic(() => {
      const s = this.serves.get(serveId);
      if (!s || s.publisherId !== publisherId || !claimedCampaignOk) return { outcome: "rejected", billed: false } as const;
      if (this.nowMs >= s.servedAtMs + HOLD_MS) return { outcome: "rejected", billed: false } as const;
      const c = this.campaigns.get(s.campaignId);
      if (!c || c.status !== "active") return { outcome: "ineligible", billed: false } as const; // click_target
      if (!this.events.has(`${serveId}|impression`)) return { outcome: "not_counted", billed: false } as const; // D4
      const key = `${serveId}|click`;
      if (this.events.has(key)) return { outcome: "duplicate", billed: false } as const;
      this.events.add(key);
      return { outcome: "recorded", billed: this.settle(serveId, "click") } as const;
    });
  }

  /** Budget ka asli niyam: kisi bhi waqt kharch + zinda holds total / daily se upar nahi. */
  assertBudgetInvariant(): void {
    const today = utcDay(this.nowMs);
    for (const c of this.campaigns.values()) {
      const total = this.spentTotal(c.id) + this.heldTotal(c.id);
      if (total > c.total) throw new Error(`total budget broken for ${c.id}`);
      if (c.daily !== null) {
        for (let d = today - 2; d <= today; d += 1) {
          // purane din ki holds expire ho chuki ho sakti hain; sirf "aaj" jaanchna kaafi hai par pichle dinon ka settled bhi limit ke andar hona chahiye
          if (this.spentOn(c.id, d) + this.heldOn(c.id, d) > c.daily) throw new Error(`daily budget broken for ${c.id} day ${d}`);
        }
      }
    }
  }
}

export const usd = (dollars: string): bigint => {
  const [w, f = ""] = dollars.split(".");
  return BigInt(w) * 10_000n + BigInt((f + "0000").slice(0, 4));
};
