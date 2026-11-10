// Test helper (sirf tests ke liye): advertiser setup / advertiser country server actions ko BINA asli Next.js/Supabase ke chalane ke liye
// nakli modules. Ye file sabse PEHLE import honi chahiye (actions se pehle).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

type DbError = { code?: string; message?: string } | null;

export const advFake = {
  role: "advertiser",
  userId: "user-adv-1",
  roleCalls: [] as string[][],
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  insertError: null as DbError,
  updates: [] as { table: string; payload: Record<string, unknown>; filters: [string, unknown][] }[],
  updateError: null as DbError,
  /** update ... select("id") me kitni rows wapas aayen (0 = advertiser row nahi mili). */
  updateRows: 1,
  revalidated: [] as { path: string; type?: string }[],
  reset() {
    this.role = "advertiser";
    this.userId = "user-adv-1";
    this.roleCalls = [];
    this.inserts = [];
    this.insertError = null;
    this.updates = [];
    this.updateError = null;
    this.updateRows = 1;
    this.revalidated = [];
  },
};

const stubs: Record<string, unknown> = {
  "next/navigation": {
    redirect(url: string) {
      throw new Error(`REDIRECT:${url}`);
    },
  },
  "next/cache": {
    revalidatePath(path: string, type?: string) {
      advFake.revalidated.push({ path, type });
    },
  },
  "@/lib/auth/session": {
    async requireRole(allowed: string[]) {
      advFake.roleCalls.push(allowed);
      if (!allowed.includes(advFake.role)) throw new Error("REDIRECT:/dashboard");
      return { user: { id: advFake.userId }, role: advFake.role, status: "active" };
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        from(table: string) {
          return {
            insert(payload: Record<string, unknown>) {
              advFake.inserts.push({ table, payload });
              return Promise.resolve({ error: advFake.insertError });
            },
            update(payload: Record<string, unknown>) {
              const rec = { table, payload, filters: [] as [string, unknown][] };
              advFake.updates.push(rec);
              const result = () => ({ error: advFake.updateError });
              const builder = {
                eq(col: string, val: unknown) {
                  rec.filters.push([col, val]);
                  return builder;
                },
                select() {
                  return Promise.resolve({
                    data: advFake.updateError ? null : Array.from({ length: advFake.updateRows }, (_, i) => ({ id: `row-${i}` })),
                    error: advFake.updateError,
                  });
                },
                then(resolve: (v: { error: DbError }) => unknown, reject?: (e: unknown) => unknown) {
                  return Promise.resolve(result()).then(resolve, reject);
                },
              };
              return builder;
            },
          };
        },
      };
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
