// Test helper (sirf `npm test` ke liye). Compiled tests me:
//  - "@/..." alias ko .test-build folder par le jata hai
//  - "server-only" ko khali module banata hai
//  - "next/server" ka chhota stand-in (NextResponse.json)
//  - "@/lib/supabase/admin" ko nakli client se badalta hai (asli database kabhi nahi chhuta)
// Test nakli client globalThis.__TEST_SUPABASE__ me rakhta hai.
const Module = require("node:module");
const path = require("node:path");

const buildRoot = path.resolve(__dirname, "..", ".test-build");
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/server") {
    return { NextResponse: { json: (body, init) => Response.json(body, init) } };
  }
  if (request === "@/lib/supabase/admin") {
    return {
      createAdminClient() {
        const client = globalThis.__TEST_SUPABASE__;
        if (!client) throw new Error("test: nakli supabase client set nahi hai");
        return client;
      },
    };
  }
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalLoad.call(this, path.join(buildRoot, request.slice(2)), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
