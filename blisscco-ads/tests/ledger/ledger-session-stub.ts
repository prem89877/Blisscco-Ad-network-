// Test helper (sirf tests ke liye): ledger service ke "login session" ka nakli roop, BINA asli Next.js / Supabase ke.
// Ye file ledger-db se PEHLE import honi chahiye (side-effect import), tabhi nakli session lagta hai.
// Default: ek ACTIVE ADMIN logged-in hai (id = 11111111-1111-4111-8111-111111111111, jo service tests ka ADMIN hai).
// Nakli session "role ka asli behaviour" nahi jaanta: wo sirf wahi lautata hai jo test ne set kiya. Asli role / status database se aata hai (lib/auth/session.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export const DEFAULT_ADMIN_ID = "11111111-1111-4111-8111-111111111111";

export type FakeAccount = { user: { id: string }; role: "advertiser" | "publisher" | "admin"; status: "active" | "suspended" } | null;

export const ledgerSession = {
  account: { user: { id: DEFAULT_ADMIN_ID }, role: "admin", status: "active" } as FakeAccount,
  /** true => getCurrentAccount error phekta hai (database / network dikkat). */
  throws: false,
  calls: 0,
  reset() {
    this.account = { user: { id: DEFAULT_ADMIN_ID }, role: "admin", status: "active" };
    this.throws = false;
    this.calls = 0;
  },
};

const stubs: Record<string, unknown> = {
  "@/lib/auth/session": {
    async getCurrentAccount() {
      ledgerSession.calls += 1;
      if (ledgerSession.throws) throw new Error("session lookup failed");
      return ledgerSession.account;
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
