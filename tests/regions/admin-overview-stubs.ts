// Test helper (sirf tests ke liye): Admin country overview loader ko BINA asli Supabase ke chalane ke liye nakli "@/lib/supabase/server".
// Ye file sabse PEHLE import honi chahiye (loader se pehle). Nakli client sirf SELECT chain jaanta hai: koi insert / update / rpc nahi,
// isliye loader ne kuch likhne ki koshish ki toh test turant fail hoga.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

type Rows = Record<string, unknown>[];
type Reply = { data: Rows | null; error: { code?: string } | null };

export type SelectCall = { table: string; columns: string; orderBy: string | null; ascending: boolean | null; limit: number | null };

export const overviewFake = {
  /** table -> jawab. Na ho toh khali list. */
  replies: {} as Record<string, Reply>,
  calls: [] as SelectCall[],
  createClientThrows: false,
  reset() {
    this.replies = {};
    this.calls = [];
    this.createClientThrows = false;
  },
};

const stubs: Record<string, unknown> = {
  "@/lib/supabase/server": {
    async createClient() {
      if (overviewFake.createClientThrows) throw new Error("no client");
      return {
        from(table: string) {
          return {
            select(columns: string) {
              const call: SelectCall = { table, columns, orderBy: null, ascending: null, limit: null };
              overviewFake.calls.push(call);
              const builder = {
                order(col: string, opts: { ascending: boolean }) {
                  call.orderBy = col;
                  call.ascending = opts.ascending;
                  return builder;
                },
                limit(n: number) {
                  call.limit = n;
                  return Promise.resolve(overviewFake.replies[table] ?? { data: [], error: null });
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
