import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { acceptClick, type ClickDeps, type ClickServeRow, type RecordClickOutcome } from "@/lib/ads/click";
import { handleClickGet } from "@/lib/ads/click-handler";
import { mintClickRef } from "@/lib/ads/click-ref";
import { ADAPTER_TIMEOUT_MS, deliverClickToAdapter, noopAdProviderAdapter, type AdProviderAdapter, type AdProviderClickEvent } from "@/lib/ads/provider-adapter";
import { createIpGuard } from "@/lib/ads/ip-guard";
import type { TrackingConfig } from "@/lib/ads/tracking-token";

// Day 12 Prompt 5 Part 4: provider adapter boundary. Database NAKLI (chhota model); asli Supabase / koi external provider / network kabhi nahi chhuta.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const REF = `bsr_${"ab".repeat(20)}`;
const PUB = "00000000-0000-4000-8000-0000000000a1";
const CREATIVE = "00000000-0000-4000-8000-0000000000c1";
const DEST = "https://advertiser.example.com/landing?utm_source=blisscco";
const EVIL = "https://evil.example.net/phish";
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);

const config = (): TrackingConfig => ({ secrets: [SECRET], ttlSeconds: 3600 });
const makeRef = (): string => {
  const g = mintClickRef(config(), { serveRef: REF, publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, nowMs: NOW + 1000 });
  assert.ok(g);
  return g.ref;
};

/** record_ad_click ka chhota model: impression ke baad pehla click = recorded, uske baad duplicate. */
class Store {
  eligible = true;
  impression = true;
  clicks = 0;
  recordCalls = 0;
  lookupServe = async (): Promise<ClickServeRow> => ({ publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, destinationUrl: this.eligible ? DEST : null, eligible: this.eligible });
  record = async (): Promise<RecordClickOutcome> => {
    this.recordCalls += 1;
    if (!this.eligible) return { outcome: "ineligible" };
    if (!this.impression) return { outcome: "not_counted", destinationUrl: DEST };
    if (this.clicks > 0) return { outcome: "duplicate", destinationUrl: DEST };
    this.clicks += 1;
    return { outcome: "recorded", destinationUrl: DEST };
  };
}
const depsFor = (store: Store, over: Partial<ClickDeps> = {}): ClickDeps => ({ config: config(), nowMs: () => NOW + 1000, lookupServe: store.lookupServe, record: store.record, ...over });
const spy = (impl?: (e: AdProviderClickEvent) => Promise<void>) => {
  const events: AdProviderClickEvent[] = [];
  const adapter: AdProviderAdapter = { name: "spy", onClickRecorded: async (e) => { events.push(e); if (impl) await impl(e); } };
  return { adapter, events };
};
const redirectTo = (r: Awaited<ReturnType<typeof acceptClick>>) => (r.kind === "redirect" ? r.location : null);

describe("day 12 prompt 5 part 4 | deliverClickToAdapter", () => {
  const ev = { serveRef: REF, publisherId: PUB, creativeId: CREATIVE, occurredAtMs: NOW };

  it("no adapter / noop adapter / adapter without the method => skipped, nothing happens", async () => {
    assert.equal(await deliverClickToAdapter(undefined, ev), "skipped");
    assert.equal(await deliverClickToAdapter(null, ev), "skipped");
    assert.equal(await deliverClickToAdapter(noopAdProviderAdapter, ev), "skipped");
    assert.equal(await deliverClickToAdapter({ name: "empty" }, ev), "skipped");
  });

  it("delivers a frozen copy with ONLY the four internal fields (no extras leak through)", async () => {
    const { adapter, events } = spy();
    const dirty = { ...ev, destinationUrl: DEST, ref: "bc1.x.y", ip: "1.2.3.4", secret: SECRET };
    assert.equal(await deliverClickToAdapter(adapter, dirty), "delivered");
    assert.deepEqual(events, [ev]);
    assert.deepEqual(Object.keys(events[0]).sort(), ["creativeId", "occurredAtMs", "publisherId", "serveRef"]);
    assert.ok(Object.isFrozen(events[0]));
  });

  it("a throwing, rejecting, or synchronously-throwing adapter => failed, never throws", async () => {
    assert.equal(await deliverClickToAdapter({ name: "r", onClickRecorded: async () => { throw new Error("boom"); } }, ev), "failed");
    assert.equal(await deliverClickToAdapter({ name: "s", onClickRecorded: () => { throw new Error("boom"); } }, ev), "failed");
    assert.equal(await deliverClickToAdapter({ name: "p", onClickRecorded: () => Promise.reject(new Error("boom")) }, ev), "failed");
  });

  it("a hanging adapter => timeout; a late rejection afterwards does not become an unhandled rejection", async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const slow: AdProviderAdapter = { name: "slow", onClickRecorded: () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error("late")), 40)) };
      const started = Date.now();
      assert.equal(await deliverClickToAdapter(slow, ev, 10), "timeout");
      assert.ok(Date.now() - started < 35, "caller must not wait for the slow adapter");
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(ADAPTER_TIMEOUT_MS, 1000);
  });
});

describe("day 12 prompt 5 part 4 | acceptClick keeps Blisscco's own click and destination independent", () => {
  it("no adapter configured (current production wiring): behaviour identical to Part 3", async () => {
    const store = new Store();
    assert.deepEqual(await acceptClick(makeRef(), depsFor(store)), { kind: "redirect", location: new URL(DEST).href, counted: "recorded" });
    assert.equal(store.clicks, 1);
  });

  it("adapter hears exactly one event, only for the first (recorded) click, after the DB write", async () => {
    const store = new Store();
    const { adapter, events } = spy(async () => { assert.equal(store.clicks, 1, "DB click must already exist when adapter is told"); });
    const ref = makeRef();
    const first = await acceptClick(ref, depsFor(store, { adapter }));
    assert.equal(redirectTo(first), new URL(DEST).href);
    assert.deepEqual(events, [{ serveRef: REF, publisherId: PUB, creativeId: CREATIVE, occurredAtMs: NOW + 1000 }]);
    for (let i = 0; i < 3; i += 1) await acceptClick(ref, depsFor(store, { adapter })); // duplicates
    assert.equal(events.length, 1);
    assert.equal(store.clicks, 1);
  });

  it("adapter is NOT told about not_counted, ineligible, invalid ref, unknown serve, or missing config", async () => {
    const { adapter, events } = spy();
    const noImp = new Store(); noImp.impression = false;
    assert.equal((await acceptClick(makeRef(), depsFor(noImp, { adapter }))).kind, "redirect");
    const inel = new Store(); inel.eligible = false;
    assert.equal((await acceptClick(makeRef(), depsFor(inel, { adapter }))).kind, "unavailable_target");
    assert.equal((await acceptClick("bc1.bad.ref", depsFor(new Store(), { adapter }))).kind, "invalid");
    assert.equal((await acceptClick(makeRef(), depsFor(new Store(), { adapter, lookupServe: async () => null }))).kind, "invalid");
    assert.equal((await acceptClick(makeRef(), depsFor(new Store(), { adapter, config: null }))).kind, "unavailable");
    assert.equal(events.length, 0);
  });

  it("adapter failure or hang does not change the redirect or the recorded click", async () => {
    for (const bad of [
      { name: "throws", onClickRecorded: async () => { throw new Error("boom"); } },
      { name: "hangs", onClickRecorded: () => new Promise<void>(() => undefined) },
    ] as AdProviderAdapter[]) {
      const store = new Store();
      const seen: string[] = [];
      const r = await acceptClick(makeRef(), depsFor(store, { adapter: bad, adapterTimeoutMs: 10, onAdapterOutcome: (d) => seen.push(d) }));
      assert.deepEqual(r, { kind: "redirect", location: new URL(DEST).href, counted: "recorded" }, bad.name);
      assert.equal(store.clicks, 1, bad.name);
      assert.deepEqual(seen, [bad.name === "throws" ? "failed" : "timeout"]);
    }
  });

  it("a throwing outcome observer cannot break the click", async () => {
    const store = new Store();
    const { adapter } = spy();
    const r = await acceptClick(makeRef(), depsFor(store, { adapter, onAdapterOutcome: () => { throw new Error("observer"); } }));
    assert.equal(r.kind, "redirect");
    assert.equal(store.clicks, 1);
  });

  it("adapter can never change the destination: returned URLs are ignored, redirect is the DB destination", async () => {
    const store = new Store();
    const sneaky = { name: "sneaky", onClickRecorded: async () => EVIL } as unknown as AdProviderAdapter;
    assert.equal(redirectTo(await acceptClick(makeRef(), depsFor(store, { adapter: sneaky }))), new URL(DEST).href);
    // event bhi frozen: adapter shared data badal nahi sakta
    const mutator: AdProviderAdapter = { name: "mut", onClickRecorded: async (e) => { try { (e as { creativeId: string }).creativeId = "x"; } catch { /* strict mode me TypeError, theek */ } } };
    const store2 = new Store();
    assert.equal(redirectTo(await acceptClick(makeRef(), depsFor(store2, { adapter: mutator }))), new URL(DEST).href);
    assert.equal(store2.recordCalls, 1);
  });

  it("DB-level eligibility/destination checks still run BEFORE the adapter hears anything (disallowed destination => no click, no adapter event)", async () => {
    const { adapter, events } = spy();
    for (const bad of ["http://advertiser.example.com/", "https://user:pw@advertiser.example.com/", "https://127.0.0.1/", "javascript:alert(1)", null]) {
      const store = new Store();
      store.lookupServe = async () => ({ publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, destinationUrl: bad, eligible: true });
      assert.equal((await acceptClick(makeRef(), depsFor(store, { adapter }))).kind, "unavailable_target", String(bad));
      assert.equal(store.recordCalls, 0);
    }
    assert.equal(events.length, 0);
  });
});

describe("day 12 prompt 5 part 4 | click route (HTTP) with an adapter attached", () => {
  const req = (qs: string) => new Request(`https://blisscco.online/api/v1/ads/click${qs}`, { method: "GET" });
  const guards = () => ({ requestGuard: createIpGuard(300), failureGuard: createIpGuard(30) });

  it("302 goes to the DB destination, safe headers intact, adapter told once; the route itself has no adapter knowledge", async () => {
    const store = new Store();
    const { adapter, events } = spy();
    const res = await handleClickGet(req(`?ref=${makeRef()}`), { accept: (ref) => acceptClick(ref, depsFor(store, { adapter })), ...guards() });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), new URL(DEST).href);
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(events.length, 1);
  });

  it("a failing adapter still yields 302, never a 5xx; a destination query parameter is still a 400 and adapter hears nothing", async () => {
    const store = new Store();
    const bad: AdProviderAdapter = { name: "bad", onClickRecorded: async () => { throw new Error("boom"); } };
    const ok = await handleClickGet(req(`?ref=${makeRef()}`), { accept: (ref) => acceptClick(ref, depsFor(store, { adapter: bad })), ...guards() });
    assert.equal(ok.status, 302);
    const { adapter, events } = spy();
    const res = await handleClickGet(req(`?ref=${makeRef()}&url=${encodeURIComponent(EVIL)}`), { accept: (ref) => acceptClick(ref, depsFor(new Store(), { adapter })), ...guards() });
    assert.equal(res.status, 400);
    assert.equal(events.length, 0);
  });
});

describe("day 12 prompt 5 part 4 | static boundary (no provider, no credentials, no wiring)", () => {
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );

  it("the adapter module is pure and provider-free (no imports, env, network, DB, logging, provider names)", () => {
    const a = code("lib/ads/provider-adapter.ts");
    assert.ok(!/^\s*import\s/m.test(a), "adapter module must import nothing");
    assert.ok(!/process\.env|fetch\(|XMLHttpRequest|server-only|createAdminClient|console\.|revive|openx|http:\/\/|https:\/\//i.test(a));
  });

  it("only click.ts imports the adapter; service.ts (production wiring) does not attach one yet", () => {
    const users = ["app", "lib", "components"].flatMap(walk).filter((f) => /provider-adapter/.test(code(f)));
    assert.deepEqual(users.sort(), ["lib/ads/click.ts"]);
    assert.ok(!/adapter/i.test(code("lib/ads/service.ts")));
    assert.ok(!/adapter/i.test(code("lib/ads/click-handler.ts")));
    assert.ok(!/adapter/i.test(code("app/api/v1/ads/click/route.ts")));
  });

  it("no Revive code/env/credentials anywhere in app, lib, components, package.json or env example files", () => {
    for (const f of ["app", "lib", "components"].flatMap(walk)) {
      if (f === "lib/ads/provider-adapter.ts") continue;
      assert.ok(!/revive|REVIVE_|openx/i.test(code(f)), f);
    }
    assert.ok(!/revive/i.test(read("package.json")));
  });

  it("the match response and serve code are untouched by the adapter", () => {
    for (const f of ["lib/ads/contract.ts", "lib/ads/serve.ts", "lib/ads/match-handler.ts", "lib/ads/serve-db.ts", "lib/ads/click-db.ts"]) {
      assert.ok(!/provider-adapter|AdProviderAdapter/.test(read(f)), f);
    }
  });
});
