// Test helper (sirf tests ke liye): admin server action ko BINA asli Next.js/Supabase ke chalane ke liye nakli modules.
// Ye file sabse PEHLE import honi chahiye (action se pehle).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type RpcCall = { name: string; args: Record<string, unknown> };

export const adminFake = {
  /** requireRole ko kaun si roles ki list mili (server par role check hua ya nahi). */
  roleCalls: [] as string[][],
  /** true => login/role galat: requireRole redirect (throw) karta hai, database tak koi nahi pahunchta. */
  roleFails: false,
  rpcCalls: [] as RpcCall[],
  /** Har rpc is error ke saath fail ho (null = success). */
  rpcError: null as { code?: string; hint?: string } | null,
  revalidated: [] as string[],
  reset() {
    this.roleCalls = [];
    this.roleFails = false;
    this.rpcCalls = [];
    this.rpcError = null;
    this.revalidated = [];
  },
};

const stubs: Record<string, unknown> = {
  "next/cache": {
    revalidatePath(p: string) {
      adminFake.revalidated.push(p);
    },
  },
  "@/lib/auth/session": {
    async requireRole(allowed: string[]) {
      adminFake.roleCalls.push(allowed);
      if (adminFake.roleFails || !allowed.includes("admin")) throw new Error("REDIRECT:/dashboard");
      return {};
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        async rpc(name: string, args: Record<string, unknown>) {
          adminFake.rpcCalls.push({ name, args });
          return { data: null, error: adminFake.rpcError };
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
