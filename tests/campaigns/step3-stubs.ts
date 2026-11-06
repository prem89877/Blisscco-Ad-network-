// Test helper (sirf tests ke liye): Phase 4 Step 3 ke submitCreative action ko BINA asli Next.js / Supabase ke chalane ke liye.
// In-memory nakli database + storage, jo RLS aur trigger ke niyam NAKAL karta hai (asli RLS / trigger TEST database par
// manually check hone baaki hain; ye test unka saboot nahi hai). Ye file actions se PEHLE import honi chahiye.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export const ADV_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ADV_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CAMP_A = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
export const CAMP_A_CLOSED = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
export const CAMP_B = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";

export type FakeRow = Record<string, unknown> & { id: string; campaign_id: string; status: string };
type Campaign = { id: string; advertiserId: string; status: string; category: string; name: string };

export const fake = {
  me: { id: ADV_A, status: "active" } as { id: string; status: string } | null,
  roleFails: false,
  campaigns: [] as Campaign[],
  creatives: [] as FakeRow[],
  /** storage: path -> contentType */
  objects: new Map<string, string>(),
  uploads: [] as { path: string; contentType: string; size: number }[],
  removed: [] as string[],
  dbCalls: [] as { table: string; op: string; payload?: Record<string, unknown> }[],
  failUpload: false,
  failInsert: false,
  failSend: false,
  nextId: 1,
  reset() {
    this.me = { id: ADV_A, status: "active" };
    this.roleFails = false;
    this.campaigns = [
      { id: CAMP_A, advertiserId: ADV_A, status: "draft", category: "gaming", name: "Mine" },
      { id: CAMP_A_CLOSED, advertiserId: ADV_A, status: "archived", category: "gaming", name: "Closed" },
      { id: CAMP_B, advertiserId: ADV_B, status: "draft", category: "gaming", name: "Not mine" },
    ];
    this.creatives = [];
    this.objects = new Map();
    this.uploads = [];
    this.removed = [];
    this.dbCalls = [];
    this.failUpload = false;
    this.failInsert = false;
    this.failSend = false;
    this.nextId = 1;
  },
};

const owns = (campaignId: string): boolean => {
  const c = fake.campaigns.find((x) => x.id === campaignId);
  return !!c && !!fake.me && c.advertiserId === fake.me.id;
};
const uuidFor = (n: number) => `c0c0c0c0-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Database trigger (day-3-5 + phase4-step3-1) ka chhota nakli: sirf wahi niyam jo yahan test hote hain.
const ALLOWED = [
  "draft>pending_review", "pending_review>draft", "rejected>draft", "approved>paused", "paused>approved",
  "draft>archived", "rejected>archived", "approved>archived", "paused>archived",
];
const CONTENT = ["headline", "body", "cta_text", "destination_url", "brand_name", "logo_path", "banner_path", "keywords"];

function pathOwned(path: unknown, row: Record<string, unknown>): boolean {
  if (path === null || path === undefined) return true;
  const camp = fake.campaigns.find((c) => c.id === row.campaign_id);
  const [a, c] = String(path).split("/");
  return !!camp && a === camp.advertiserId && c === row.campaign_id;
}

type Filter = [string, "eq" | "neq" | "in", unknown];

function builder(table: string, op: "select" | "insert" | "update" | "delete", payload?: Record<string, unknown>) {
  const filters: Filter[] = [];
  let head = false;
  let wantRows = false;
  const matches = (row: Record<string, unknown>) =>
    filters.every(([col, kind, val]) =>
      kind === "eq" ? row[col] === val : kind === "neq" ? row[col] !== val : Array.isArray(val) && val.includes(row[col]),
    );
  const run = (): { data: unknown; error: unknown; count?: number } => {
    fake.dbCalls.push({ table, op, payload });
    if (table !== "ad_creatives") return { data: [], error: null };
    // RLS (select/update): sirf apne campaign ke creatives dikhte hain
    const visible = fake.creatives.filter((r) => owns(r.campaign_id));
    if (op === "select") {
      const rows = visible.filter(matches);
      return head ? { data: null, error: null, count: rows.length } : { data: rows, error: null };
    }
    if (op === "insert") {
      if (fake.failInsert) return { data: null, error: { code: "XX000" } };
      const p = payload ?? {};
      const camp = fake.campaigns.find((c) => c.id === p.campaign_id);
      if (!camp || !fake.me || camp.advertiserId !== fake.me.id || ["archived", "completed"].includes(camp.status) || fake.me.status !== "active") {
        return { data: null, error: { code: "42501" } }; // RLS with check
      }
      if (!pathOwned(p.logo_path, p) || !pathOwned(p.banner_path, p)) return { data: null, error: { code: "42501" } };
      const row = { status: "draft", rejection_reason: null, reviewed_by: null, reviewed_at: null, ...p, id: uuidFor(fake.nextId++) } as unknown as FakeRow;
      fake.creatives.push(row);
      return { data: [{ id: row.id }], error: null };
    }
    if (op === "update") {
      const rows = visible.filter(matches);
      const p = payload ?? {};
      if (p.status === "pending_review" && fake.failSend) return { data: null, error: { code: "XX000" } };
      for (const row of rows) {
        const contentChanged = CONTENT.some((k) => k in p && p[k] !== row[k]);
        if (contentChanged) {
          if (row.status === "pending_review" || row.status === "archived") return { data: null, error: { code: "42501" } };
          if (!pathOwned(p.logo_path, row) || !pathOwned(p.banner_path, row)) return { data: null, error: { code: "42501" } };
          Object.assign(row, p);
          if (row.status !== "draft") Object.assign(row, { status: "draft", rejection_reason: null, reviewed_by: null, reviewed_at: null });
          continue;
        }
        if (typeof p.status === "string" && p.status !== row.status) {
          if (!ALLOWED.includes(`${row.status}>${p.status}`)) return { data: null, error: { code: "42501" } };
          row.status = p.status;
        }
      }
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    return { data: null, error: null };
  };
  const b = {
    eq(c: string, v: unknown) { filters.push([c, "eq", v]); return b; },
    neq(c: string, v: unknown) { filters.push([c, "neq", v]); return b; },
    in(c: string, v: unknown[]) { filters.push([c, "in", v]); return b; },
    select(_cols?: string, opts?: { head?: boolean }) { if (opts?.head) head = true; wantRows = true; return b; },
    order() { return b; },
    limit() { return b; },
    maybeSingle() {
      const r = run() as { data: unknown[] | null; error: unknown };
      return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error });
    },
    single() {
      const r = run() as { data: unknown[] | null; error: unknown };
      return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error });
    },
    then(resolve: (v: unknown) => unknown) {
      void wantRows;
      return resolve(run());
    },
  };
  return b;
}

const storage = {
  from(_bucket: string) {
    return {
      async upload(path: string, body: Uint8Array, opts: { contentType: string }) {
        if (fake.failUpload) return { data: null, error: { message: "boom" } };
        // storage policy: advertiser folder + apne campaign
        const [adv, camp] = path.split("/");
        const c = fake.campaigns.find((x) => x.id === camp);
        if (!fake.me || fake.me.status !== "active" || adv !== fake.me.id || !c || c.advertiserId !== fake.me.id || ["archived", "completed"].includes(c.status)) {
          return { data: null, error: { message: "new row violates row-level security policy" } };
        }
        fake.objects.set(path, opts.contentType);
        fake.uploads.push({ path, contentType: opts.contentType, size: body.length });
        return { data: { path }, error: null };
      },
      async remove(paths: string[]) {
        for (const p of paths) {
          fake.objects.delete(p);
          fake.removed.push(p);
        }
        return { data: [], error: null };
      },
    };
  },
};

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
        storage,
        from(table: string) {
          return {
            select: (cols?: string, opts?: { head?: boolean }) => builder(table, "select").select(cols, opts),
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
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
