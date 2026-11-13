import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createActionGuard, SLOW_ACTION_MS, type GuardDiagDetails, type GuardDiagEvent, type GuardState } from "@/lib/actions/guard";
import { buildDiagLine, cleanDiagId, cleanDiagPath, cleanDiagText, isDiagEvent, isDiagVerbose, slowThresholdMs } from "@/lib/diagnostics/log";
import { handleDiagPost, createDiagLimiter } from "@/lib/diagnostics/diag-handler";

// Diagnostics: slow button / error screen / middleware ki report Vercel logs me "[diag]" line banke aati hai.
// LIMIT: browser / Vercel yahan nahi chalta. Ye tests helper, guard ki reporting aur /api/diag route ka logic saabit karte hain.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const idle: GuardState = { status: "idle" };

describe("diagnostics | log helpers", () => {
  it("builds one safe key=value line starting with [diag]", () => {
    const line = buildDiagLine("action_slow", { path: "/dashboard", ms: 7200, label: "Resume campaign", empty: "", skip: undefined });
    assert.equal(line, '[diag] event=action_slow path=/dashboard ms=7200 label="Resume campaign"');
  });
  it("strips newlines / control characters (no log injection) and long values", () => {
    assert.equal(cleanDiagText("a\r\n[diag] event=fake\u0000b"), "a [diag] event=fake b");
    assert.ok(cleanDiagText("x".repeat(500), 50).length === 50);
    assert.ok(!buildDiagLine("action_failed", { errMsg: "boom\n[diag] event=fake" }).includes("\n"));
  });
  it("paths lose their query / hash and must be same-site paths", () => {
    assert.equal(cleanDiagPath("/dashboard/admin?token=abc#x"), "/dashboard/admin");
    assert.equal(cleanDiagPath("//evil.com/x"), "");
    assert.equal(cleanDiagPath("https://evil.com"), "");
  });
  it("ids accept only letters, digits, dash, underscore", () => {
    assert.equal(cleanDiagId("1234567890"), "1234567890");
    assert.equal(cleanDiagId("a b"), "");
    assert.equal(cleanDiagId("<script>"), "");
  });
  it("only known events are accepted; thresholds and verbose flag come from env with safe defaults", () => {
    assert.equal(isDiagEvent("action_slow"), true);
    assert.equal(isDiagEvent("anything"), false);
    assert.equal(slowThresholdMs({}), 3000);
    assert.equal(slowThresholdMs({ DIAG_SLOW_MS: "1500" }), 1500);
    assert.equal(slowThresholdMs({ DIAG_SLOW_MS: "abc" }), 3000);
    assert.equal(isDiagVerbose({}), false);
    assert.equal(isDiagVerbose({ DIAG_VERBOSE: "1" }), true);
  });
});

describe("diagnostics | action guard reports slow / timeout / failed buttons", () => {
  function make(action: (p: GuardState, f: FormData) => Promise<GuardState>, clock: { t: number }, timeoutMs = 20_000) {
    const reports: Array<[GuardDiagEvent, GuardDiagDetails]> = [];
    const g = createActionGuard<GuardState>({ action, timeoutMs, now: () => clock.t, report: (e, d) => void reports.push([e, d]) });
    return { g, reports };
  }

  it("a fast success reports nothing", async () => {
    const clock = { t: 0 };
    const { g, reports } = make(async () => ({ status: "success" }), clock);
    g.tryBegin();
    await g.run(idle, new FormData());
    assert.deepEqual(reports, []);
  });

  it("a slow success (>= 5s) reports action_slow with the elapsed ms and still returns the server result", async () => {
    const clock = { t: 1000 };
    const { g, reports } = make(async () => {
      clock.t += SLOW_ACTION_MS + 500;
      return { status: "success", message: "Done." };
    }, clock);
    g.tryBegin();
    const r = await g.run(idle, new FormData());
    assert.deepEqual(r, { status: "success", message: "Done." });
    assert.deepEqual(reports, [["action_slow", { ms: SLOW_ACTION_MS + 500, outcome: "success" }]]);
  });

  it("a slow redirect (Next.js control flow) is reported and still re-thrown", async () => {
    const clock = { t: 0 };
    const { g, reports } = make(async () => {
      clock.t += 6000;
      throw Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
    }, clock);
    g.tryBegin();
    await assert.rejects(g.run(idle, new FormData()));
    assert.deepEqual(reports, [["action_slow", { ms: 6000, outcome: "redirect" }]]);
  });

  it("a timeout reports action_timeout and the user still gets the same safe message", async () => {
    const clock = { t: 0 };
    const { g, reports } = make(() => new Promise<GuardState>(() => undefined), clock, 20);
    g.tryBegin();
    const r = await g.run(idle, new FormData());
    assert.equal(r.status, "error");
    assert.equal(reports.length, 1);
    assert.equal(reports[0][0], "action_timeout");
  });

  it("a network / unexpected failure reports action_failed with only the error name and message", async () => {
    const clock = { t: 0 };
    const { g, reports } = make(async () => {
      throw new TypeError("Failed to fetch");
    }, clock);
    g.tryBegin();
    const r = await g.run(idle, new FormData());
    assert.equal(r.status, "error");
    assert.deepEqual(reports, [["action_failed", { ms: 0, outcome: "network", errName: "TypeError", errMsg: "Failed to fetch" }]]);
  });

  it("a report callback that throws never changes the button result", async () => {
    const g = createActionGuard<GuardState>({
      action: async () => {
        throw new Error("x");
      },
      report: () => {
        throw new Error("report broke");
      },
    });
    g.tryBegin();
    assert.equal((await g.run(idle, new FormData())).status, "error");
    assert.equal(g.isBusy(), false);
  });
});

describe("diagnostics | /api/diag route", () => {
  // F2: route logic ab handleDiagPost me hai; login inject hota hai. Console capture purani tarah.
  const post = (body: unknown, headers: Record<string, string> = {}, userId: string | null = "user-1") =>
    handleDiagPost(
      new Request("https://blisscco.test/api/diag", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { host: "blisscco.test", ...headers } }),
      { getUserId: async () => userId, limiter: createDiagLimiter() },
    );

  async function captured(run: () => Promise<Response>) {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const res = await run();
      return { res, lines };
    } finally {
      console.error = original;
    }
  }

  it("a good report becomes one [diag] line and the answer is an empty 204", async () => {
    const { res, lines } = await captured(() =>
      post({ event: "action_slow", path: "/dashboard/admin?secret=1", ms: 7300, label: "Approve", outcome: "success" }, { "x-vercel-id": "bom1::iad1::abcde-123" }),
    );
    assert.equal(res.status, 204);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[diag\] event=action_slow source=browser path=\/dashboard\/admin label=Approve outcome=success ms=7300 vercelId=abcde-123$/);
  });

  it("unknown events, bad JSON, huge bodies and other-site origins write nothing", async () => {
    for (const run of [
      () => post({ event: "hack", path: "/x" }),
      () => post("not json"),
      () => post({ event: "action_slow", pad: "x".repeat(5000) }),
      () => post({ event: "action_slow", path: "/x" }, { origin: "https://evil.com" }),
    ]) {
      const { res, lines } = await captured(run);
      assert.equal(res.status, 204);
      assert.deepEqual(lines, []);
    }
  });
});

describe("diagnostics | wiring", () => {
  it("both error screens (dashboard + home) report to /api/diag and still show no raw error", () => {
    for (const f of ["app/error.tsx", "app/dashboard/error.tsx", "app/global-error.tsx", "app/dashboard/advertiser/campaigns/error.tsx", "app/dashboard/advertiser/creatives/error.tsx"]) {
      assert.match(read(f), /handleBoundaryError\(error, "/, f);
      assert.doesNotMatch(read(f), /error\.message|error\.stack/, f);
    }
    for (const f of ["app/dashboard/analytics/error.tsx"]) {
      assert.match(read(f), /sendDiagReport\("error_boundary"/, f);
      assert.doesNotMatch(read(f), /error\.message|error\.stack/, f);
    }
  });
  it("the route is not behind the middleware and is not an open relay (fixed event list, same-site only)", () => {
    assert.doesNotMatch(read("middleware.ts"), /\/api/);
    assert.match(read("lib/diagnostics/diag-handler.ts"), /isDiagEvent\(/);
    assert.match(read("lib/diagnostics/diag-handler.ts"), /sameSite\(request\)/);
  });
  it("middleware, dashboard layout and instrumentation log slow / failed requests", () => {
    assert.match(read("lib/supabase/middleware.ts"), /logIfSlow\("middleware_session_check"/);
    assert.match(read("app/dashboard/layout.tsx"), /logIfSlow\("dashboard_layout_auth"/);
    assert.match(read("instrumentation.ts"), /export async function onRequestError/);
  });
  it("diagnostics never log secrets: no env values, cookies, authorization or form data", () => {
    for (const f of ["lib/diagnostics/log.ts", "lib/diagnostics/diag-handler.ts", "app/api/diag/route.ts", "instrumentation.ts"]) {
      assert.doesNotMatch(read(f), /cookie|authorization|formData|SECRET|service_role/i, f);
    }
  });
});
