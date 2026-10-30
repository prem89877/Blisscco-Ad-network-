// Test helper (sirf tests ke liye): publisher setup / key actions + versioned Ad API ko EK hi nakli (in-memory) database par chalane ke liye.
// Koi SQL nahi chalti, asli database ko koi nahi chhoota. Asli keys-db.ts / serve-db.ts / service.ts / match-handler.ts CHALTE hain;
// sirf unka database client (createAdminClient -> globalThis.__TEST_SUPABASE__) aur Next.js / login wale hisse nakli hain.
// Model day-5-2 / day-5-6 / day-7-1 / day-9-5 / day-10-2 SQL ke niyam dohrata hai. Ye file actions se PEHLE import honi chahiye.
import { createHash } from "node:crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type KeyRow = {
  id: string; publisherId: string; hash: string; prefix: string; hint: string; label: string | null;
  status: "active" | "revoked"; createdAt: string; lastUsedAt: string | null; expiresAt: string | null;
};
export type Pub = { id: string; profileId: string; status: "pending" | "active" | "suspended"; name: string; websiteUrl: string | null; category: string | null };
export type Camp = {
  id: string; status: string; category: string; startDate: string; endDate: string | null; totalBudget: number; dailyBudget: number | null;
  spentTotal: number; spentToday: number;
};
export type Creative = { id: string; campaignId: string; status: string; headline: string; body: string; ctaText: string | null; destinationUrl: string };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export const db = {
  userId: "user-pub-1",
  roleFails: false,
  publisher: null as Pub | null,
  profileStatus: "active" as "active" | "suspended",
  keys: [] as KeyRow[],
  campaigns: [] as Camp[],
  creatives: [] as Creative[],
  advertiserStatus: "active" as "pending" | "active" | "suspended",
  advertiserProfileStatus: "active" as "active" | "suspended",
  rateLimit: 60,
  hits: new Map<string, number>(),
  cpm: 2,
  issueDailyLimit: false,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcFail: null as { name: string; error: { code?: string; message?: string; hint?: string } } | null,
  serves: [] as { creativeId: string; publisherId: string }[],
  replays: new Map<string, string>(),
  revalidated: [] as string[],
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  next: 1,
  reset() {
    this.userId = "user-pub-1";
    this.roleFails = false;
    this.publisher = null;
    this.profileStatus = "active";
    this.keys = [];
    this.campaigns = [];
    this.creatives = [];
    this.advertiserStatus = "active";
    this.advertiserProfileStatus = "active";
    this.rateLimit = 60;
    this.hits = new Map();
    this.cpm = 2;
    this.issueDailyLimit = false;
    this.rpcCalls = [];
    this.rpcFail = null;
    this.serves = [];
    this.replays = new Map();
    this.revalidated = [];
    this.inserts = [];
    this.next = 1;
  },
  id() {
    return uuid(this.next++);
  },
};

const now = () => new Date();
const unit = () => Math.max(Math.round((db.cpm / 1000) * 10_000) / 10_000, 0.0001);

function usableKey(hash: string): KeyRow | null {
  const k = db.keys.find((x) => x.hash === hash);
  if (!k || k.status !== "active") return null;
  if (k.expiresAt !== null && new Date(k.expiresAt).getTime() <= now().getTime()) return null;
  if (!db.publisher || db.publisher.id !== k.publisherId) return null;
  if (db.publisher.status !== "active" || db.profileStatus !== "active") return null;
  return k;
}

/** record_ad_serve: creative DOBARA verify karta hai (status + dates + budget) aur tabhi kharch likhta hai. */
function eligibleInDb(cr: Creative): Camp | null {
  const c = db.campaigns.find((x) => x.id === cr.campaignId);
  if (!c) return null;
  const today = now().toISOString().slice(0, 10);
  if (cr.status !== "approved" || c.status !== "active") return null;
  if (db.advertiserStatus !== "active" || db.advertiserProfileStatus !== "active") return null;
  if (c.startDate > today || (c.endDate !== null && c.endDate < today)) return null;
  const u = unit();
  if (c.spentTotal + u > c.totalBudget + 1e-9) return null;
  if (c.dailyBudget !== null && c.spentToday + u > c.dailyBudget + 1e-9) return null;
  return c;
}

type Reply = { data: unknown; error: { code?: string; message?: string; hint?: string } | null };

function rpc(name: string, args: Record<string, unknown>): Reply {
  db.rpcCalls.push({ name, args });
  if (db.rpcFail && db.rpcFail.name === name) return { data: null, error: db.rpcFail.error };
  switch (name) {
    case "issue_publisher_key_for": {
      const pid = String(args.p_publisher_id);
      const active = db.keys.filter((k) => k.publisherId === pid && k.status === "active" && (k.expiresAt === null || new Date(k.expiresAt) > now()));
      if (active.length >= 5) return { data: null, error: { code: "22023", hint: "key_limit" } };
      if (db.issueDailyLimit) return { data: null, error: { code: "22023", hint: "key_daily_limit" } };
      if (typeof args.p_key_hash !== "string" || !/^[0-9a-f]{64}$/.test(args.p_key_hash)) return { data: null, error: { code: "22023", hint: "invalid_key_data" } };
      db.keys.push({
        id: db.id(), publisherId: pid, hash: args.p_key_hash, prefix: String(args.p_key_prefix), hint: String(args.p_key_hint),
        label: (args.p_label as string | null) ?? null, status: "active", createdAt: now().toISOString(), lastUsedAt: null,
        expiresAt: (args.p_expires_at as string | null) ?? null,
      });
      return { data: null, error: null };
    }
    case "list_publisher_keys_for":
      return {
        data: db.keys.filter((k) => k.publisherId === args.p_publisher_id).map((k) => ({
          id: k.id, label: k.label, key_prefix: k.prefix, key_hint: k.hint, status: k.status,
          created_at: k.createdAt, last_used_at: k.lastUsedAt, expires_at: k.expiresAt,
        })),
        error: null,
      };
    case "revoke_publisher_key_for": {
      const k = db.keys.find((x) => x.id === args.p_key_id && x.publisherId === args.p_publisher_id && x.status === "active");
      if (!k) return { data: false, error: null };
      k.status = "revoked";
      return { data: true, error: null };
    }
    case "authorize_publisher_key": {
      const hash = String(args.p_key_hash);
      if (!/^[0-9a-f]{64}$/.test(hash)) return { data: { outcome: "unauthorized" }, error: null };
      const k = usableKey(hash);
      if (!k) return { data: { outcome: "unauthorized" }, error: null };
      const hits = (db.hits.get(k.id) ?? 0) + 1;
      db.hits.set(k.id, hits);
      if (hits > db.rateLimit) return { data: { outcome: "rate_limited" }, error: null };
      return { data: { outcome: "ok", publisher_id: k.publisherId, publisher_status: "active", unit_cost_usd: db.cpm / 1000 }, error: null };
    }
    case "load_ad_candidates": {
      const rows = db.creatives
        .map((cr) => ({ cr, c: db.campaigns.find((x) => x.id === cr.campaignId)! }))
        .filter(({ c }) => c.category === args.p_category)
        .map(({ cr, c }) => ({
          creative_id: cr.id, headline: cr.headline, body: cr.body, cta_text: cr.ctaText, destination_url: cr.destinationUrl,
          creative_status: cr.status, campaign_id: c.id, campaign_status: c.status, category: c.category, start_date: c.startDate,
          end_date: c.endDate, total_budget: c.totalBudget, daily_budget: c.dailyBudget, spent_total: c.spentTotal, spent_today: c.spentToday,
          advertiser_status: db.advertiserStatus, advertiser_profile_status: db.advertiserProfileStatus,
          campaign_serves_today: 0, creative_serves_today: 0,
        }));
      return { data: rows, error: null };
    }
    case "record_ad_serve": {
      const k = usableKey(String(args.p_key_hash));
      if (!k) return { data: { outcome: "unauthorized" }, error: null };
      const idem = typeof args.p_idempotency_key === "string" ? `${k.publisherId}:${args.p_idempotency_key}` : null;
      if (idem && db.replays.has(idem)) {
        const cr = db.creatives.find((x) => x.id === db.replays.get(idem))!;
        return { data: { outcome: "ok", replayed: true, ad: { id: cr.id, headline: cr.headline, body: cr.body, cta_text: cr.ctaText, destination_url: cr.destinationUrl } }, error: null };
      }
      const cr = db.creatives.find((x) => x.id === args.p_creative_id);
      const c = cr ? eligibleInDb(cr) : null;
      if (!cr || !c) return { data: { outcome: "rejected" }, error: null };
      c.spentTotal = Math.round((c.spentTotal + unit()) * 1e6) / 1e6;
      c.spentToday = Math.round((c.spentToday + unit()) * 1e6) / 1e6;
      db.serves.push({ creativeId: cr.id, publisherId: k.publisherId });
      if (idem) db.replays.set(idem, cr.id);
      return { data: { outcome: "ok" }, error: null };
    }
    case "find_idempotent_serve":
      return { data: { outcome: "none" }, error: null };
    case "admin_set_publisher_status": {
      if (db.publisher && db.publisher.id === args.p_publisher_id && ["pending", "active", "suspended"].includes(String(args.p_status))) {
        db.publisher.status = args.p_status as Pub["status"];
        return { data: null, error: null };
      }
      return { data: null, error: { code: "P0002" } };
    }
    default:
      throw new Error(`test: unexpected rpc ${name}`);
  }
}

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
export function installDb(): void {
  globals.__TEST_SUPABASE__ = { rpc: async (name: string, args: Record<string, unknown>) => rpc(name, args) };
}

export const hashOf = sha;

const stubs: Record<string, unknown> = {
  "next/navigation": {
    redirect(url: string) {
      throw new Error(`REDIRECT:${url}`);
    },
  },
  "next/cache": {
    revalidatePath(p: string) {
      db.revalidated.push(p);
    },
  },
  "@/lib/auth/session": {
    async requireRole() {
      if (db.roleFails) throw new Error("REDIRECT:/login");
      return { user: { id: db.userId }, role: "publisher", status: "active" };
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        from(table: string) {
          return {
            insert(payload: Record<string, unknown>) {
              db.inserts.push({ table, payload });
              if (table === "publishers") {
                if (db.publisher) return Promise.resolve({ error: { code: "23505" } });
                // status kabhi payload me nahi: database default 'pending'
                db.publisher = {
                  id: db.id(), profileId: String(payload.profile_id), status: "pending", name: String(payload.name),
                  websiteUrl: (payload.website_url as string | null) ?? null, category: (payload.category as string | null) ?? null,
                };
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        async rpc(name: string, args: Record<string, unknown>) {
          return rpc(name, args);
        },
      };
    },
  },
  "@/lib/publisher/queries": {
    async loadMyPublisher() {
      const p = db.publisher;
      return { publisher: p ? { id: p.id, status: p.status, name: p.name, websiteUrl: p.websiteUrl, category: p.category } : null, failed: false };
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
