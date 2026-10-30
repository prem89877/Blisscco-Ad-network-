// Test helper (sirf tests ke liye): publisher / account server actions ko BINA asli Next.js/Supabase ke chalane ke liye nakli modules.
// Ye file sabse PEHLE import honi chahiye (actions se pehle), tabhi nakli modules lagte hain.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

export type FakePublisher = {
  id: string;
  status: "pending" | "active" | "suspended";
  name: string;
  websiteUrl: string | null;
  category: string | null;
};

export type FakeKey = {
  id: string;
  label: string | null;
  prefix: string;
  hint: string | null;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export const fake = {
  /** listPublisherKeys ka nateeja (null = database error). */
  keys: [] as FakeKey[] | null,
  /** Kaun login hai (auth user id). */
  userId: "user-A",
  /** requireRole fail kare (login/role galat) toh true. */
  roleFails: false,
  /** loadMyPublisher ka nateeja. */
  load: { publisher: null, failed: false } as { publisher: FakePublisher | null; failed: boolean },
  /** publishers insert par ye error laut aaye (RLS / CHECK / unique jaisa). */
  dbError: null as { code: string; message?: string } | null,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  revalidated: [] as string[],
  issued: [] as { publisherId: string; label: string | null; expiry: string }[],
  revoked: [] as { publisherId: string; keyId: string }[],
  issueResult: { ok: true, key: "blc_live_" + "ab".repeat(32) } as { ok: true; key: string } | { ok: false; reason: "limit" | "daily" | "error" },
  revokeResult: true,
  reset() {
    this.userId = "user-A";
    this.keys = [];
    this.roleFails = false;
    this.load = { publisher: null, failed: false };
    this.dbError = null;
    this.inserts = [];
    this.revalidated = [];
    this.issued = [];
    this.revoked = [];
    this.issueResult = { ok: true, key: "blc_live_" + "ab".repeat(32) };
    this.revokeResult = true;
  },
};

const stubs: Record<string, unknown> = {
  "next/navigation": {
    redirect(url: string) {
      throw new Error(`REDIRECT:${url}`);
    },
  },
  "next/cache": {
    revalidatePath(path: string) {
      fake.revalidated.push(path);
    },
  },
  "@/lib/auth/session": {
    async requireRole() {
      if (fake.roleFails) throw new Error("REDIRECT:/login");
      return { user: { id: fake.userId }, role: "publisher", status: "active" };
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      return {
        from(table: string) {
          return {
            insert(payload: Record<string, unknown>) {
              fake.inserts.push({ table, payload });
              return Promise.resolve({ error: fake.dbError });
            },
          };
        },
      };
    },
  },
  "@/lib/publisher/queries": {
    async loadMyPublisher() {
      return fake.load;
    },
  },
  "@/lib/publisher/keys-db": {
    async issuePublisherKey(publisherId: string, label: string | null, expiry: string) {
      fake.issued.push({ publisherId, label, expiry });
      return fake.issueResult;
    },
    async listPublisherKeys() {
      return fake.keys;
    },
    async revokePublisherKey(publisherId: string, keyId: string) {
      fake.revoked.push({ publisherId, keyId });
      return fake.revokeResult;
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};
