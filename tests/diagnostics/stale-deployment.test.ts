import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STALE_DEPLOYMENT_MESSAGE, createActionGuard, isStaleDeploymentError, type GuardDiagDetails, type GuardState } from "@/lib/actions/guard";

// "Failed to find Server Action ... older or newer deployment" / UnrecognizedActionError: naya deploy, purana khula page.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const stale = () => Object.assign(new Error("Server Action was not found on the server."), { name: "UnrecognizedActionError" });

describe("stale deployment | detection", () => {
  it("recognises the Next.js error by name or message, nothing else", () => {
    assert.equal(isStaleDeploymentError(stale()), true);
    assert.equal(isStaleDeploymentError(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.')), true);
    assert.equal(isStaleDeploymentError(new Error("Failed to fetch")), false);
    assert.equal(isStaleDeploymentError(null), false);
    assert.equal(isStaleDeploymentError("UnrecognizedActionError"), false);
  });
});

describe("stale deployment | guarded buttons", () => {
  it("show a clear refresh message (not 'could not reach the server'), do not claim success, do not retry, and release the lock", async () => {
    const reports: GuardDiagDetails[] = [];
    let refreshes = 0;
    const g = createActionGuard<GuardState>({
      action: async () => {
        throw stale();
      },
      refresh: () => void (refreshes += 1),
      report: (_e, d) => void reports.push(d),
    });
    g.tryBegin();
    const r = await g.run({ status: "idle" }, new FormData());
    assert.deepEqual(r, { status: "error", message: STALE_DEPLOYMENT_MESSAGE });
    assert.equal(refreshes, 0);
    assert.equal(g.isBusy(), false);
    assert.equal(reports[0].outcome, "stale_deployment");
  });
});

describe("stale deployment | error screens", () => {
  it("every error screen that can receive it goes through handleBoundaryError (one auto reload, no loop)", () => {
    for (const f of ["app/error.tsx", "app/dashboard/error.tsx", "app/global-error.tsx", "app/dashboard/advertiser/campaigns/error.tsx", "app/dashboard/advertiser/creatives/error.tsx"]) {
      assert.match(read(f), /handleBoundaryError\(error, "/, f);
    }
    const g = read("lib/actions/guard.ts");
    assert.match(g, /nav\?\.type === "reload"/);
    assert.doesNotMatch(g, /localStorage|sessionStorage|document\.cookie/);
  });
  it("the two main screens offer a Refresh page button for this case", () => {
    for (const f of ["app/error.tsx", "app/dashboard/error.tsx"]) assert.match(read(f), /Refresh page/, f);
  });
});
