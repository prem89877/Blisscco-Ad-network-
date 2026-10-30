// Test helper (sirf tests ke liye): campaign + creative + admin actions ko EK hi nakli (in-memory) database par chalane ke liye.
// Koi SQL nahi chalti, asli database/paise ko koi nahi chhoota. Ye file actions se PEHLE import honi chahiye.
// Model day-3-5 / day-9-7 SQL ke niyam dohrata hai (advertiser sirf allowed status badal sakta hai; 'active'/'approved' sirf admin rpc se).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type CampaignStatus = "draft" | "pending_review" | "active" | "paused" | "completed" | "rejected" | "archived";
export type CreativeStatus = "draft" | "pending_review" | "approved" | "rejected" | "paused" | "archived";

export type FakeCampaign = {
  id: string;
  advertiserId: string;
  name: string;
  description: string | null;
  category: string;
  status: CampaignStatus;
  totalBudget: number;
  dailyBudget: number | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};
export type FakeCreative = {
  id: string;
  campaignId: string;
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
  status: CreativeStatus;
  rejectionReason: string | null;
};
export type Write = { table: string; op: "insert" | "update"; payload: Record<string, unknown>; filters: [string, unknown][] };
export type Rpc = { name: string; args: Record<string, unknown> };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const fake = {
  me: { id: "adv-A", status: "active" } as { id: string; status: string } | null,
  /** advertiser ke profile ka status (profiles.status) */
  profileStatus: "active" as "active" | "suspended",
  roleFails: false,
  campaigns: [] as FakeCampaign[],
  creatives: [] as FakeCreative[],
  spent: 0,
  nextId: 1,
  writes: [] as Write[],
  rpcs: [] as Rpc[],
  revalidated: [] as string[],
  roleCalls: [] as string[][],
  /** Sirf admin session: false => admin_* rpc 42501 deta hai (private.is_admin()). */
  isAdmin: true,
  reset() {
    this.me = { id: "adv-A", status: "active" };
    this.profileStatus = "active";
    this.roleFails = false;
    this.campaigns = [];
    this.creatives = [];
    this.spent = 0;
    this.nextId = 1;
    this.writes = [];
    this.rpcs = [];
    this.revalidated = [];
    this.roleCalls = [];
    this.isAdmin = true;
  },
  newId() {
    return uuid(this.nextId++);
  },
};

const CAMPAIGN_ADV_MOVES = new Set([
  "draft>pending_review", "pending_review>draft", "rejected>draft", "active>paused", "paused>active",
  "draft>archived", "rejected>archived", "paused>archived", "completed>archived",
]);
const CREATIVE_ADV_MOVES = new Set([
  "draft>pending_review", "pending_review>draft", "rejected>draft",
  "draft>archived", "rejected>archived", "approved>archived", "paused>archived",
]);

type Err = { code: string; hint?: string };
const today = () => new Date().toISOString().slice(0, 10);

function builder(table: string, op: "select" | "insert" | "update", payload: Record<string, unknown>, opts?: { count?: string; head?: boolean }) {
  const filters: [string, unknown][] = [];
  const negFilters: [string, unknown][] = [];
  const inFilters: [string, unknown[]][] = [];
  const write: Write | null = op === "select" ? null : { table, op, payload, filters };
  if (write) fake.writes.push(write);

  const rows = (): Array<Record<string, unknown>> => {
    const src = table === "campaigns" ? fake.campaigns : table === "ad_creatives" ? fake.creatives : [];
    const mapped = src.map((r): Record<string, unknown> => {
      const c = r as unknown as Record<string, unknown>;
      return table === "campaigns"
        ? { ...c, advertiser_id: c.advertiserId, updated_at: c.updatedAt }
        : { ...c, campaign_id: c.campaignId };
    });
    return mapped.filter(
      (r) =>
        filters.every(([k, v]) => r[k] === v) &&
        negFilters.every(([k, v]) => r[k] !== v) &&
        inFilters.every(([k, vs]) => vs.includes(r[k])),
    );
  };

  const ownsCampaign = (campaignId: string) => fake.campaigns.some((c) => c.id === campaignId && c.advertiserId === fake.me?.id);

  const run = (): { data: unknown; error: Err | null; count?: number } => {
    if (op === "select") {
      const found = rows().filter((r) => (table === "ad_creatives" ? ownsCampaign(String(r.campaign_id)) : r.advertiser_id === fake.me?.id));
      return { data: opts?.head ? null : found, error: null, count: found.length };
    }
    if (op === "insert") {
      if (table === "campaigns") {
        const id = fake.newId();
        fake.campaigns.push({
          id, advertiserId: String(payload.advertiser_id), name: String(payload.name), description: (payload.description as string | null) ?? null,
          category: String(payload.category), status: "draft", totalBudget: Number(payload.total_budget),
          dailyBudget: payload.daily_budget === null ? null : Number(payload.daily_budget), startDate: String(payload.start_date),
          endDate: (payload.end_date as string | null) ?? null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
        });
        return { data: { id }, error: null };
      }
      if (!ownsCampaign(String(payload.campaign_id))) return { data: null, error: { code: "42501" } };
      const id = fake.newId();
      fake.creatives.push({
        id, campaignId: String(payload.campaign_id), headline: String(payload.headline), body: String(payload.body),
        ctaText: (payload.cta_text as string | null) ?? null, destinationUrl: String(payload.destination_url), status: "draft", rejectionReason: null,
      });
      return { data: { id }, error: null };
    }
    // update: RLS (apne advertiser ki rows) + trigger (allowed status badlav). Admin rpc alag hai.
    const hit = rows().filter((r) => (table === "campaigns" ? r.advertiser_id === fake.me?.id : ownsCampaign(String(r.campaign_id))));
    for (const r of hit) {
      const to = payload.status as string | undefined;
      if (to && to !== r.status) {
        const moves = table === "campaigns" ? CAMPAIGN_ADV_MOVES : CREATIVE_ADV_MOVES;
        if (!moves.has(`${r.status}>${to}`)) return { data: null, error: { code: "42501" } };
      }
    }
    for (const r of hit) {
      const target = (table === "campaigns" ? fake.campaigns : fake.creatives).find((x) => x.id === r.id)! as Record<string, unknown>;
      if (payload.status) target.status = payload.status;
    }
    return { data: hit.map((r) => ({ id: r.id })), error: null };
  };

  const b = {
    select(_cols?: string, o?: { count?: string; head?: boolean }) {
      if (o) opts = o;
      return b;
    },
    eq(col: string, val: unknown) {
      filters.push([col, val]);
      return b;
    },
    neq(col: string, val: unknown) {
      negFilters.push([col, val]);
      return b;
    },
    in(col: string, vals: unknown[]) {
      inFilters.push([col, vals]);
      return b;
    },
    maybeSingle() {
      const r = run();
      return Promise.resolve({ data: (r.data as unknown[])[0] ?? null, error: r.error });
    },
    single() {
      const r = run();
      return Promise.resolve(r.error ? { data: null, error: r.error } : { data: r.data, error: null });
    },
    then(resolve: (v: unknown) => unknown) {
      return resolve(run());
    },
  };
  return b;
}

/** Admin rpc: day-3-5 / day-9-7 SQL ke niyam (sirf jo test ko chahiye). Error = { code, hint }. */
function adminRpc(name: string, args: Record<string, unknown>): Err | null {
  if (!fake.isAdmin) return { code: "42501" };
  if (name === "admin_review_creative") {
    const cr = fake.creatives.find((c) => c.id === args.p_creative_id);
    if (!cr) return { code: "P0002" };
    const camp = fake.campaigns.find((c) => c.id === cr.campaignId)!;
    if (camp.status === "archived" || camp.status === "completed") return { code: "22023" };
    if (args.p_decision === "approve") {
      if (cr.status !== "pending_review") return { code: "22023" };
      if (fake.me?.status !== "active" || fake.profileStatus !== "active") return { code: "22023", hint: "advertiser_not_active" };
      cr.status = "approved";
      cr.rejectionReason = null;
      return null;
    }
    if (args.p_decision === "reject") {
      const reason = typeof args.p_reason === "string" ? args.p_reason.trim() : "";
      if (reason.length === 0 || reason.length > 500) return { code: "22023" };
      if (!["pending_review", "approved", "paused"].includes(cr.status)) return { code: "22023" };
      cr.status = "rejected";
      cr.rejectionReason = reason;
      return null;
    }
    return { code: "22023" };
  }
  if (name === "admin_review_campaign") {
    const camp = fake.campaigns.find((c) => c.id === args.p_campaign_id);
    if (!camp) return { code: "P0002" };
    if (args.p_decision === "approve") {
      if (camp.status !== "pending_review") return { code: "22023" };
      if (fake.me?.status !== "active" || fake.profileStatus !== "active") return { code: "22023", hint: "advertiser_not_active" };
      if (!fake.creatives.some((c) => c.campaignId === camp.id && c.status === "approved")) return { code: "22023", hint: "approve_needs_creative" };
      if (camp.endDate !== null && camp.endDate < today()) return { code: "22023", hint: "approve_campaign_ended" };
      if (camp.totalBudget - fake.spent < 0.002) return { code: "22023", hint: "approve_needs_budget" };
      camp.status = "active";
      return null;
    }
    if (args.p_decision === "reject") {
      if (!["pending_review", "active", "paused"].includes(camp.status)) return { code: "22023" };
      camp.status = "rejected";
      return null;
    }
    return { code: "22023" };
  }
  return null;
}

const stubs: Record<string, unknown> = {
  "next/navigation": {
    redirect(url: string) {
      throw new Error(`REDIRECT:${url}`);
    },
  },
  "next/cache": {
    revalidatePath(p: string) {
      fake.revalidated.push(p);
    },
  },
  "@/lib/auth/session": {
    async requireRole(allowed: string[]) {
      fake.roleCalls.push(allowed);
      if (fake.roleFails) throw new Error("REDIRECT:/login");
      return {};
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        from(table: string) {
          return {
            select: (cols?: string, o?: { count?: string; head?: boolean }) => builder(table, "select", {}, o).select(cols, o),
            insert: (payload: Record<string, unknown>) => builder(table, "insert", payload),
            update: (payload: Record<string, unknown>) => builder(table, "update", payload),
          };
        },
        async rpc(name: string, args: Record<string, unknown>) {
          fake.rpcs.push({ name, args });
          return { data: null, error: adminRpc(name, args) };
        },
      };
    },
  },
  "@/lib/campaigns/queries": {
    async loadMyAdvertiser() {
      if (!fake.me) return { advertiser: null, failed: false };
      return { advertiser: { id: fake.me.id, status: fake.me.status, companyName: "Test Co" }, failed: false };
    },
    async loadMyCampaign(advertiserId: string, campaignId: string) {
      const c = fake.campaigns.find((x) => x.id === campaignId && x.advertiserId === advertiserId);
      return { campaign: c ?? null, failed: false };
    },
    async getCampaignSpend() {
      return { spentTotal: fake.spent, spentToday: 0, servesTotal: 0 };
    },
    async getCreativeSummary(campaignId: string) {
      const all = fake.creatives.filter((c) => c.campaignId === campaignId);
      return { total: all.length, approved: all.filter((c) => c.status === "approved").length };
    },
    async countReviewableCreatives(campaignId: string) {
      return fake.creatives.filter((c) => c.campaignId === campaignId && (c.status === "pending_review" || c.status === "approved")).length;
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
