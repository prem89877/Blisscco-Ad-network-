import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ActionTimeoutError,
  DEFAULT_ACTION_TIMEOUT_MS,
  FAILURE_MESSAGE,
  TIMEOUT_MESSAGE,
  createActionGuard,
  isNextControlFlowError,
  type GuardState,
} from "@/lib/actions/guard";

// Phase 2: website-wide "button stuck in pending / needs reload" fix. Ye shared guard (lib/actions/guard.ts) ka behaviour hai.
// LIMIT: React / Next.js client yahan nahi chalta (sandbox me DOM nahi). Ye tests guard ka logic nakli actions par saabit karte hain;
// asli Preview par button ka behaviour user ko dekhna hai (report me "manual Preview verification").

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idle: GuardState = { status: "idle" };
const form = () => new FormData();

describe("phase 2 | action guard | success: server-confirmed result is shown, loading clears", () => {
  it("returns exactly what the server action returned and releases the lock", async () => {
    let refreshes = 0;
    const g = createActionGuard<GuardState>({ action: async () => ({ status: "success", message: "Done." }), refresh: () => void (refreshes += 1) });
    assert.equal(g.tryBegin(), true);
    const r = await g.run(idle, form());
    assert.deepEqual(r, { status: "success", message: "Done." });
    assert.equal(g.isBusy(), false, "loading (lock) must clear after success");
    // Server action revalidatePath() already refreshed the page: no extra refresh = no repeated API call.
    assert.equal(refreshes, 0);
  });

  it("a server-reported error is passed through untouched (no fake success, no rewrite)", async () => {
    const g = createActionGuard<GuardState>({ action: async () => ({ status: "error", message: "That is more than your available earnings." }) });
    const r = await g.run(idle, form());
    assert.deepEqual(r, { status: "error", message: "That is more than your available earnings." });
    assert.equal(g.isBusy(), false);
  });

  it("when the server redirects, Next.js navigates and the action gives back nothing: the previous state is kept (UI does not break)", async () => {
    const g = createActionGuard<GuardState>({ action: (async () => undefined) as unknown as (p: GuardState, f: FormData) => Promise<GuardState> });
    const prev: GuardState = { status: "error", message: "old" };
    assert.deepEqual(await g.run(prev, form()), prev);
    assert.equal(g.isBusy(), false);
  });

  it("a real Next.js redirect()/notFound() error is re-thrown, never swallowed as a failure", async () => {
    for (const digest of ["NEXT_REDIRECT;replace;/dashboard;307;", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
      const g = createActionGuard<GuardState>({
        action: async () => {
          throw Object.assign(new Error("control flow"), { digest });
        },
      });
      await assert.rejects(g.run(idle, form()), (e: unknown) => isNextControlFlowError(e));
      assert.equal(g.isBusy(), false, digest);
    }
    assert.equal(isNextControlFlowError(new Error("plain")), false);
    assert.equal(isNextControlFlowError(null), false);
  });
});

describe("phase 2 | action guard | failed request: loading clears and the error is displayed", () => {
  it("a thrown network error becomes an error state, loading clears, and the page state is re-read once", async () => {
    let refreshes = 0;
    let calls = 0;
    const g = createActionGuard<GuardState>({
      action: async () => {
        calls += 1;
        throw new TypeError("fetch failed");
      },
      refresh: () => void (refreshes += 1),
    });
    const r = await g.run(idle, form());
    assert.equal(r.status, "error");
    assert.equal(r.message, FAILURE_MESSAGE);
    assert.equal(g.isBusy(), false);
    assert.equal(refreshes, 1, "server may have completed: show the real state without a manual reload");
    assert.equal(calls, 1, "a failed (financial) action is never retried blindly");
  });

  it("the failure message tells the user to check status before trying again (no blind retry)", () => {
    assert.match(FAILURE_MESSAGE, /check/i);
    assert.match(TIMEOUT_MESSAGE, /before trying again/i);
  });

  it("a failing refresh does not hide the error state", async () => {
    const g = createActionGuard<GuardState>({
      action: async () => {
        throw new Error("boom");
      },
      refresh: () => {
        throw new Error("refresh broke");
      },
    });
    assert.equal((await g.run(idle, form())).status, "error");
  });

  it("a custom errorState keeps what the user typed (form inputs are reset by React after an action)", async () => {
    type S = GuardState & { values?: { name: string } };
    const g = createActionGuard<S>({
      action: async () => {
        throw new Error("boom");
      },
      errorState: (prev, message, fd) => ({ ...prev, status: "error", message, values: { name: String(fd.get("name")) } }),
    });
    const fd = form();
    fd.set("name", "My campaign");
    const r = await g.run({ status: "idle" }, fd);
    assert.deepEqual(r.values, { name: "My campaign" });
    assert.equal(r.status, "error");
  });
});

describe("phase 2 | action guard | slow request", () => {
  it("a slow but within-limit request shows the real server result (no early / fake success)", async () => {
    const g = createActionGuard<GuardState>({
      timeoutMs: 400,
      action: async () => {
        await sleep(60);
        return { status: "success", message: "Confirmed by server." };
      },
    });
    assert.equal(g.tryBegin(), true);
    const pending = g.run(idle, form());
    await sleep(10);
    assert.equal(g.isBusy(), true, "loading stays on while the server is still working");
    assert.deepEqual(await pending, { status: "success", message: "Confirmed by server." });
    assert.equal(g.isBusy(), false);
  });

  it("past the time limit: loading clears, a clear message shows, the page state is re-read, success is NOT claimed", async () => {
    let refreshes = 0;
    const g = createActionGuard<GuardState>({
      timeoutMs: 40,
      refresh: () => void (refreshes += 1),
      action: async () => {
        await sleep(300);
        return { status: "success", message: "too late" };
      },
    });
    assert.equal(g.tryBegin(), true);
    const r = await g.run(idle, form());
    assert.equal(r.status, "error");
    assert.equal(r.message, TIMEOUT_MESSAGE);
    assert.equal(g.isBusy(), false, "loading must not stay stuck");
    assert.equal(refreshes, 1);
    await sleep(320); // the slow server answer arriving later must not break anything
  });

  it("default limit is a real, finite number", () => {
    assert.ok(Number.isFinite(DEFAULT_ACTION_TIMEOUT_MS) && DEFAULT_ACTION_TIMEOUT_MS >= 10_000 && DEFAULT_ACTION_TIMEOUT_MS <= 60_000);
    assert.ok(new ActionTimeoutError() instanceof Error);
  });
});

describe("phase 2 | action guard | multiple rapid taps: duplicate mutation is prevented", () => {
  it("ten taps in the same instant start the action exactly once", async () => {
    let mutations = 0;
    const g = createActionGuard<GuardState>({
      action: async () => {
        mutations += 1;
        await sleep(30);
        return { status: "success" };
      },
    });
    const taps = Array.from({ length: 10 }, () => g.tryBegin());
    assert.deepEqual(taps, [true, ...Array(9).fill(false)]);
    // Only the tap that won the lock reaches the action (the form's onSubmit does preventDefault for the rest).
    await Promise.all(taps.map((won) => (won ? g.run(idle, form()) : Promise.resolve(idle))));
    assert.equal(mutations, 1);
  });

  it("after the first action settles the button works again (lock is not permanent)", async () => {
    const g = createActionGuard<GuardState>({ action: async () => ({ status: "success" }) });
    assert.equal(g.tryBegin(), true);
    await g.run(idle, form());
    assert.equal(g.tryBegin(), true);
  });

  it("a lock taken by a submit that never reached the action expires by itself (never stuck forever)", () => {
    let t = 1_000;
    const g = createActionGuard<GuardState>({ action: async () => idle, timeoutMs: 5_000, now: () => t });
    assert.equal(g.tryBegin(), true);
    t += 5_500;
    assert.equal(g.isBusy(), true);
    t += 600;
    assert.equal(g.isBusy(), false);
    assert.equal(g.tryBegin(), true);
  });
});
