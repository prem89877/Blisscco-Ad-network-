// Day 10 Part 5: STATEFUL nakli database (sirf tests ke liye). Asli Supabase / production kabhi nahi chhuta.
//
// Ye `authorize_publisher_key`, `load_ad_candidates`, `record_ad_serve` (3 aur 4 args) aur `find_idempotent_serve` ke
// SQL ka behaviour NODE me dohrata hai (day-7-5, day-9-5, day-5-6 ki SQL files padhkar), taaki poora route -> handler ->
// serve -> selection -> record raasta ek ke baad ek requests par (state ke saath) test ho sake:
//   - key active / revoked / expired, publisher pending / active / suspended, publisher ka profile suspended
//   - har key ka alag rate limit (1 minute ki window, default 60)
//   - Idempotency-Key (publisher_id, key) par bandhi hai: doosre publisher ko kabhi nahi dikhti
//   - serve log / spend har publisher ke naam par
// LIMIT: ye SQL ka MODEL hai, SQL khud nahi. SQL ka asli test tests/integration/day10-part5-db.test.ts hai (TEST database chahiye).
// Saari keys / ids nakli hain (blc_live_<hex>); koi asli credential nahi.

import { createHash } from "node:crypto";

export type PublisherStatus = "pending" | "active" | "suspended";
export type ProfileStatus = "active" | "suspended";

export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const makeKey = (ch: string): string => `blc_live_${ch.repeat(64)}`;

type Publisher = { id: string; status: PublisherStatus; profileStatus: ProfileStatus };
type KeyRow = { id: string; publisherId: string; hash: string; status: "active" | "revoked"; expiresAtMs: number | null };
type Creative = {
  id: string;
  campaignId: string;
  advertiserId: string;
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
  status: "draft" | "pending_review" | "approved" | "rejected" | "paused" | "archived";
};
type Campaign = {
  id: string;
  advertiserId: string;
  category: string;
  status: string;
  totalBudget: number;
  dailyBudget: number | null;
  startDate: string;
  endDate: string | null;
};
type Advertiser = { id: string; status: "pending" | "active" | "suspended"; profileStatus: ProfileStatus };

export type ServeLogRow = {
  publisherId: string;
  creativeId: string;
  campaignId: string;
  topic: string;
  /** day-12-1 default jaisa: "bsr_" + 40 hex (yahan deterministic, taaki test repeatable rahe). */
  serveRef: string;
  servedAtMs: number;
};
export type RpcCall = { name: string; args: Record<string, unknown> };

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const ok = (data: unknown): Reply => ({ data, error: null });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

let counter = 0;
/** Deterministic, valid UUID v4-jaisa id (random nahi: test repeatable rahe). */
export function uuid(prefix: string): string {
  counter += 1;
  const hex = (prefix + counter.toString(16)).replace(/[^0-9a-f]/g, "0").padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

export class FakeAdDb {
  constructor() {
    counter = 0; // har naye nakli database par ids same order me bante hain (do run ki tulna ke liye)
  }
  readonly unitCostUsd = 0.002; // CPM 2 / 1000 (day-7-5 ka default)
  rateLimitPerMinute = 60;
  /** Test clock (ms). Rate-limit window = nuhi minute; expiry isi se check hoti hai. */
  nowMs = Date.UTC(2026, 9, 27, 10, 0, 30);
  calls: RpcCall[] = [];
  serveLog: ServeLogRow[] = [];
  /** (campaign_id) -> kul kharch (USD) */
  spend = new Map<string, number>();
  /** (publisher_id|idempotency_key) -> creative id + serve row ka index (ad_serve_requests table jaisa; serveIndex = serve_id) */
  private serveRequests = new Map<string, { creativeId: string; serveIndex: number | null }>();
  /** Test knob: serve ke samay (ms). null = abhi (asli clock). Purani serve / expiry tests ke liye. */
  serveTimeMs: number | null = null;
  /** Test knob: true => day-12-5 SQL se pehle jaisa behaviour (record/replay me serve_ref + served_at nahi). */
  legacyNoServeRef = false;
  private rateHits = new Map<string, number>(); // `${keyId}|${minute}` -> hits
  private publishers = new Map<string, Publisher>();
  private keys: KeyRow[] = [];
  private advertisers = new Map<string, Advertiser>();
  private campaigns = new Map<string, Campaign>();
  private creatives = new Map<string, Creative>();
  /** Test ke liye: kisi rpc ko zabardasti fail karao (outage nakal). */
  failRpc: Record<string, Reply | undefined> = {};

  get today(): string {
    return new Date(this.nowMs).toISOString().slice(0, 10);
  }

  // ----- setup helpers -----
  addPublisher(status: PublisherStatus = "active", profileStatus: ProfileStatus = "active"): Publisher {
    const p: Publisher = { id: uuid("a"), status, profileStatus };
    this.publishers.set(p.id, p);
    return p;
  }
  addKey(publisherId: string, key: string, opts: { status?: "active" | "revoked"; expiresInMs?: number | null } = {}): KeyRow {
    const row: KeyRow = {
      id: uuid("b"),
      publisherId,
      hash: sha256(key),
      status: opts.status ?? "active",
      expiresAtMs: opts.expiresInMs === undefined || opts.expiresInMs === null ? null : this.nowMs + opts.expiresInMs,
    };
    this.keys.push(row);
    return row;
  }
  setPublisherStatus(id: string, status: PublisherStatus): void {
    const p = this.publishers.get(id);
    if (!p) throw new Error("test: unknown publisher");
    p.status = status;
  }
  setProfileStatus(id: string, status: ProfileStatus): void {
    const p = this.publishers.get(id);
    if (!p) throw new Error("test: unknown publisher");
    p.profileStatus = status;
  }
  revokeKey(key: string): void {
    const row = this.keys.find((k) => k.hash === sha256(key));
    if (!row) throw new Error("test: unknown key");
    row.status = "revoked";
  }
  addAdvertiser(status: Advertiser["status"] = "active", profileStatus: ProfileStatus = "active"): Advertiser {
    const a: Advertiser = { id: uuid("c"), status, profileStatus };
    this.advertisers.set(a.id, a);
    return a;
  }
  /** Ek campaign + ek creative. Default: approved + active + gaming + budget 10 USD. */
  addAd(
    advertiserId: string,
    opts: {
      category?: string;
      headline?: string;
      creativeStatus?: Creative["status"];
      campaignStatus?: string;
      totalBudget?: number;
      dailyBudget?: number | null;
      endDate?: string | null;
      startDate?: string;
    } = {},
  ): { campaignId: string; creativeId: string } {
    const campaign: Campaign = {
      id: uuid("d"),
      advertiserId,
      category: opts.category ?? "gaming",
      status: opts.campaignStatus ?? "active",
      totalBudget: opts.totalBudget ?? 10,
      dailyBudget: opts.dailyBudget === undefined ? null : opts.dailyBudget,
      startDate: opts.startDate ?? "2020-01-01",
      endDate: opts.endDate === undefined ? null : opts.endDate,
    };
    this.campaigns.set(campaign.id, campaign);
    const creative: Creative = {
      id: uuid("e"),
      campaignId: campaign.id,
      advertiserId,
      headline: opts.headline ?? `Headline ${counter}`,
      body: "Body text",
      ctaText: "Shop now",
      destinationUrl: "https://example.com/landing",
      status: opts.creativeStatus ?? "approved",
    };
    this.creatives.set(creative.id, creative);
    return { campaignId: campaign.id, creativeId: creative.id };
  }
  setCreativeStatus(creativeId: string, status: Creative["status"]): void {
    const c = this.creatives.get(creativeId);
    if (!c) throw new Error("test: unknown creative");
    c.status = status;
  }
  setCampaignStatus(campaignId: string, status: string): void {
    const c = this.campaigns.get(campaignId);
    if (!c) throw new Error("test: unknown campaign");
    c.status = status;
  }
  allPublisherIds(): string[] {
    return [...this.publishers.keys()];
  }
  advanceMinutes(n: number): void {
    this.nowMs += n * 60_000;
  }
  rpcCount(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }
  spendOf(campaignId: string): number {
    return Math.round((this.spend.get(campaignId) ?? 0) * 1e6) / 1e6;
  }
  servesFor(publisherId: string): ServeLogRow[] {
    return this.serveLog.filter((s) => s.publisherId === publisherId);
  }

  // ----- supabase-js jaisa client (createAdminClient ki jagah) -----
  client() {
    return {
      rpc: async (name: string, args: Record<string, unknown> = {}): Promise<Reply> => {
        this.calls.push({ name, args });
        const forced = this.failRpc[name];
        if (forced) return forced;
        switch (name) {
          case "authorize_publisher_key":
            return ok(this.authorize(String(args.p_key_hash)));
          case "load_ad_candidates":
            return ok(this.loadCandidates(String(args.p_category), String(args.p_today)));
          case "record_ad_serve":
            return ok(this.recordServe(args));
          case "find_idempotent_serve":
            return ok(this.findIdempotent(String(args.p_key_hash), args.p_idempotency_key));
          default:
            throw new Error(`test: unexpected rpc ${name}`);
        }
      },
    };
  }

  // ----- SQL ke models -----
  private resolveKey(hash: string): { key: KeyRow; publisher: Publisher } | null {
    if (!HASH_RE.test(hash)) return null;
    const key = this.keys.find((k) => k.hash === hash);
    if (!key || key.status !== "active") return null;
    if (key.expiresAtMs !== null && key.expiresAtMs <= this.nowMs) return null;
    const publisher = this.publishers.get(key.publisherId);
    if (!publisher || publisher.status !== "active" || publisher.profileStatus !== "active") return null;
    return { key, publisher };
  }

  private authorize(hash: string): Record<string, unknown> {
    const found = this.resolveKey(hash);
    if (!found) return { outcome: "unauthorized" };
    const minute = Math.floor(this.nowMs / 60_000);
    const slot = `${found.key.id}|${minute}`;
    const hits = (this.rateHits.get(slot) ?? 0) + 1;
    this.rateHits.set(slot, hits);
    if (hits > this.rateLimitPerMinute) return { outcome: "rate_limited" };
    return { outcome: "ok", publisher_id: found.publisher.id, publisher_status: "active", unit_cost_usd: this.unitCostUsd };
  }

  private spentToday = new Map<string, number>(); // `${campaign}|${day}`
  private serveCountToday = new Map<string, number>(); // creative id -> serves

  private loadCandidates(category: string, today: string): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const cr of this.creatives.values()) {
      const camp = this.campaigns.get(cr.campaignId);
      const adv = this.advertisers.get(cr.advertiserId);
      if (!camp || !adv) continue;
      // day-5-6 ka coarse filter
      if (cr.status !== "approved" || camp.status !== "active" || camp.category !== category) continue;
      if (adv.status !== "active" || adv.profileStatus !== "active") continue;
      if (camp.startDate > today || (camp.endDate !== null && camp.endDate < today)) continue;
      rows.push({
        creative_id: cr.id,
        headline: cr.headline,
        body: cr.body,
        cta_text: cr.ctaText,
        destination_url: cr.destinationUrl,
        creative_status: cr.status,
        campaign_id: camp.id,
        campaign_status: camp.status,
        category: camp.category,
        start_date: camp.startDate,
        end_date: camp.endDate,
        total_budget: camp.totalBudget,
        daily_budget: camp.dailyBudget,
        spent_total: this.spend.get(camp.id) ?? 0,
        spent_today: this.spentToday.get(`${camp.id}|${this.today}`) ?? 0,
        advertiser_status: adv.status,
        advertiser_profile_status: adv.profileStatus,
        campaign_serves_today: 0,
        creative_serves_today: this.serveCountToday.get(cr.id) ?? 0,
      });
    }
    return rows;
  }

  private replayFor(publisherId: string, idem: string): Record<string, unknown> | null {
    const linked = this.serveRequests.get(`${publisherId}|${idem}`);
    if (!linked) return null;
    const creativeId = linked.creativeId;
    const cr = this.creatives.get(creativeId);
    const camp = cr ? this.campaigns.get(cr.campaignId) : undefined;
    if (!cr || !camp || cr.status !== "approved" || camp.status !== "active") return { outcome: "rejected", replayed: true };
    const row = linked.serveIndex === null || this.legacyNoServeRef ? undefined : this.serveLog[linked.serveIndex];
    return {
      outcome: "ok",
      replayed: true,
      ...(row ? { serve_ref: row.serveRef, served_at: new Date(row.servedAtMs).toISOString() } : {}),
      ad: { id: cr.id, headline: cr.headline, body: cr.body, cta_text: cr.ctaText, destination_url: cr.destinationUrl },
    };
  }

  private findIdempotent(hash: string, idem: unknown): Record<string, unknown> {
    const found = this.resolveKey(hash);
    if (!found) return { outcome: "unauthorized" };
    if (typeof idem !== "string" || !IDEM_RE.test(idem)) return { outcome: "none" };
    const replay = this.replayFor(found.publisher.id, idem);
    if (!replay) return { outcome: "none" };
    return replay.outcome === "ok"
      ? { outcome: "found", ad: replay.ad, serve_ref: replay.serve_ref ?? null, served_at: replay.served_at ?? null }
      : { outcome: "rejected" };
  }

  private recordServe(args: Record<string, unknown>): Record<string, unknown> {
    const hash = String(args.p_key_hash);
    const creativeId = String(args.p_creative_id);
    const topic = String(args.p_topic);
    const hasIdem = "p_idempotency_key" in args;
    const idem = args.p_idempotency_key;

    const found = this.resolveKey(hash);
    if (!found) return { outcome: "unauthorized" };
    if (hasIdem && (typeof idem !== "string" || !IDEM_RE.test(idem))) return { outcome: "rejected" };
    if (hasIdem) {
      const replay = this.replayFor(found.publisher.id, String(idem));
      if (replay) return replay;
    }

    const cr = UUID_RE.test(creativeId) ? this.creatives.get(creativeId) : undefined;
    const camp = cr ? this.campaigns.get(cr.campaignId) : undefined;
    const adv = cr ? this.advertisers.get(cr.advertiserId) : undefined;
    if (!cr || !camp || !adv) return { outcome: "rejected" };
    if (cr.status !== "approved" || camp.status !== "active" || camp.category !== topic) return { outcome: "rejected" };
    if (adv.status !== "active" || adv.profileStatus !== "active") return { outcome: "rejected" };
    if (camp.startDate > this.today || (camp.endDate !== null && camp.endDate < this.today)) return { outcome: "rejected" };

    const unit = this.unitCostUsd;
    const total = this.spend.get(camp.id) ?? 0;
    const dayKey = `${camp.id}|${this.today}`;
    const day = this.spentToday.get(dayKey) ?? 0;
    if (total + unit > camp.totalBudget + 1e-9) return { outcome: "rejected" };
    if (camp.dailyBudget !== null && day + unit > camp.dailyBudget + 1e-9) return { outcome: "rejected" };

    this.spend.set(camp.id, total + unit);
    this.spentToday.set(dayKey, day + unit);
    this.serveCountToday.set(cr.id, (this.serveCountToday.get(cr.id) ?? 0) + 1);
    const serveIndex = this.serveLog.length;
    const servedAtMs = this.serveTimeMs ?? Date.now();
    const serveRef = `bsr_${sha256(`serve-${serveIndex}-${found.publisher.id}`).slice(0, 40)}`;
    this.serveLog.push({ publisherId: found.publisher.id, creativeId: cr.id, campaignId: camp.id, topic, serveRef, servedAtMs });
    if (hasIdem) this.serveRequests.set(`${found.publisher.id}|${String(idem)}`, { creativeId: cr.id, serveIndex });
    if (this.legacyNoServeRef) return { outcome: "ok" };
    return { outcome: "ok", serve_ref: serveRef, served_at: new Date(servedAtMs).toISOString() };
  }
}
