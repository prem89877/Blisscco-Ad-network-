// Test helper (sirf tests ke liye): payout server actions ko BINA asli Next.js / Supabase ke chalane ke liye nakli modules.
// Ye file sabse PEHLE import honi chahiye (actions se pehle), tabhi nakli modules lagte hain.
//
// Nakli database "role ka asli behaviour" nahi jaanta: wo sirf bataata hai ki action ne KYA bheja. Asli database ke niyam
// (is_admin, lock, unique index, guard trigger) SQL file me hain aur day-13-11 (rollback-only, denim par) se jaanche jaate hain.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type RpcCall = { name: string; args: Record<string, unknown> };
export type FakeRole = "publisher" | "admin" | "advertiser" | null;

export const payoutFake = {
  /** Kaun logged-in hai (null = login nahi). requireRole isi se allow / redirect (throw) karta hai. */
  role: "publisher" as FakeRole,
  /** requireRole ko kaun si roles ki list mili. */
  roleCalls: [] as string[][],
  rpcCalls: [] as RpcCall[],
  /** Har rpc ka jawab (database ka jsonb). */
  rpcData: null as unknown,
  /** Har rpc is error ke saath fail ho (null = success). */
  rpcError: null as { code?: string } | null,
  revalidated: [] as string[],
  /** createClient() kitni baar bulaya gaya (login session wala client). */
  clientsCreated: 0,
  reset() {
    this.role = "publisher";
    this.roleCalls = [];
    this.rpcCalls = [];
    this.rpcData = null;
    this.rpcError = null;
    this.revalidated = [];
    this.clientsCreated = 0;
  },
};

const stubs: Record<string, unknown> = {
  "next/cache": {
    revalidatePath(p: string) {
      payoutFake.revalidated.push(p);
    },
  },
  "@/lib/auth/session": {
    async requireRole(allowed: string[]) {
      payoutFake.roleCalls.push(allowed);
      if (payoutFake.role === null || !allowed.includes(payoutFake.role)) throw new Error("REDIRECT:/dashboard");
      return { role: payoutFake.role };
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      payoutFake.clientsCreated += 1;
      return {
        async rpc(name: string, args: Record<string, unknown>) {
          payoutFake.rpcCalls.push({ name, args });
          return { data: payoutFake.rpcData, error: payoutFake.rpcError };
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
