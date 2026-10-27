// Test helper (sirf tests ke liye): campaign server actions ko BINA asli Next.js/Supabase ke chalane ke liye nakli modules.
// Ye file sabse PEHLE import honi chahiye (actions se pehle), tabhi nakli modules lagte hain.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type FakeCampaign = {
  id: string;
  advertiserId: string;
  name: string;
  description: string | null;
  category: string;
  status: "draft" | "pending_review" | "active" | "paused" | "completed" | "rejected" | "archived";
  totalBudget: number;
  dailyBudget: number | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DbCall = { table: string; op: "update" | "insert"; payload: Record<string, unknown>; filters: [string, unknown][] };

export const fake = {
  /** Kaun login hai (advertiser id) aur uska status. null = advertiser row nahi. */
  me: { id: "adv-A", status: "active" } as { id: string; status: string } | null,
  /** requireRole fail kare (login/role galat) toh true. */
  roleFails: false,
  /** Database me maujood campaigns. loadMyCampaign sirf wahi deta hai jiska advertiserId match kare (RLS jaisa). */
  campaigns: [] as FakeCampaign[],
  /** Kharch: null = padh nahi paya. */
  spend: { spentTotal: 0, spentToday: 0, servesTotal: 0 } as { spentTotal: number; spentToday: number; servesTotal: number } | null,
  /** Database update/insert par ye error laut aaye (trigger/CHECK jaisa). */
  dbError: null as { code: string; hint?: string } | null,
  calls: [] as DbCall[],
  reset() {
    this.me = { id: "adv-A", status: "active" };
    this.roleFails = false;
    this.campaigns = [];
    this.spend = { spentTotal: 0, spentToday: 0, servesTotal: 0 };
    this.dbError = null;
    this.calls = [];
  },
};

function builder(table: string, op: "update" | "insert", payload: Record<string, unknown>) {
  const call: DbCall = { table, op, payload, filters: [] };
  fake.calls.push(call);
  const b = {
    eq(col: string, val: unknown) {
      call.filters.push([col, val]);
      return b;
    },
    select() {
      return b;
    },
    single() {
      return Promise.resolve(fake.dbError ? { data: null, error: fake.dbError } : { data: { id: "00000000-0000-4000-8000-000000000001" }, error: null });
    },
    then(resolve: (v: unknown) => unknown) {
      // update(...).eq(...).select(...): RLS jaisa — sirf apne advertiser ki row badalti hai.
      if (fake.dbError) return resolve({ data: null, error: fake.dbError });
      const adv = call.filters.find(([c]) => c === "advertiser_id")?.[1];
      const id = call.filters.find(([c]) => c === "id")?.[1];
      const row = fake.campaigns.find((c) => c.id === id && c.advertiserId === adv && adv === fake.me?.id);
      return resolve({ data: row ? [{ id: row.id }] : [], error: null });
    },
  };
  return b;
}

const stubs: Record<string, unknown> = {
  "next/navigation": {
    redirect(url: string) {
      throw new Error(`REDIRECT:${url}`);
    },
  },
  "next/cache": { revalidatePath() {} },
  "@/lib/auth/session": {
    async requireRole() {
      if (fake.roleFails) throw new Error("REDIRECT:/login");
      return {};
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        from(table: string) {
          return {
            insert: (payload: Record<string, unknown>) => builder(table, "insert", payload),
            update: (payload: Record<string, unknown>) => builder(table, "update", payload),
          };
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
      return fake.spend;
    },
    async getCreativeSummary() {
      return { total: 1, approved: 1 };
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
