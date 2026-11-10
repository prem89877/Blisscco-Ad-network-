// Test helper (sirf tests ke liye): publisher country / account setup / admin country server actions ko BINA asli Next.js/Supabase ke
// chalane ke liye nakli modules. Ye file sabse PEHLE import honi chahiye (actions se pehle).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type RpcCall = { name: string; args: Record<string, unknown> };
type DbError = { code?: string; hint?: string; message?: string } | null;

export const countryFake = {
  /** Login ka role (requireRole sirf tab pass karta hai jab ye allowed list me ho). */
  role: "publisher",
  userId: "user-A",
  roleCalls: [] as string[][],
  rpcCalls: [] as RpcCall[],
  /** Har rpc is error ke saath fail ho (null = success). */
  rpcError: null as DbError,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  insertError: null as DbError,
  revalidated: [] as string[],
  reset() {
    this.role = "publisher";
    this.userId = "user-A";
    this.roleCalls = [];
    this.rpcCalls = [];
    this.rpcError = null;
    this.inserts = [];
    this.insertError = null;
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
    revalidatePath(p: string) {
      countryFake.revalidated.push(p);
    },
  },
  "@/lib/auth/session": {
    async requireRole(allowed: string[]) {
      countryFake.roleCalls.push(allowed);
      if (!allowed.includes(countryFake.role)) throw new Error("REDIRECT:/dashboard");
      return { user: { id: countryFake.userId }, role: countryFake.role, status: "active" };
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        from(table: string) {
          return {
            insert(payload: Record<string, unknown>) {
              countryFake.inserts.push({ table, payload });
              return Promise.resolve({ error: countryFake.insertError });
            },
          };
        },
        async rpc(name: string, args: Record<string, unknown>) {
          countryFake.rpcCalls.push({ name, args });
          return { data: null, error: countryFake.rpcError };
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
