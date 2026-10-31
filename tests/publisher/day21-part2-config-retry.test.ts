import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { BlissccoClient, BlissccoConfigError, BlissccoRetryExhaustedError } from "../../examples/publisher-node/src/client";

// Day 21 Part 2: focused regression tests for fromEnv() names and the default retry delay.
// MOCKED fetch + fake sleep only: no network, no database, no production code touched. Secrets are never printed.

const KEY = `blc_live_${"b".repeat(64)}`;
const OLD_KEY = `blc_live_${"c".repeat(64)}`;
const BASE = "https://ads.example.com";
const OLD_BASE = "https://old.example.com";
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const AD = { id: "11111111-1111-4111-8111-111111111111", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };

type Seen = { url: string; headers: Record<string, string>; body: string };

function recorder(status = 200, body: unknown = { fill: false }) {
  const seen: Seen[] = [];
  const f = (async (url: unknown, init: RequestInit) => {
    seen.push({ url: String(url), headers: init.headers as Record<string, string>, body: init.body as string });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, f };
}

/** Builds a client from env and routes its (global) fetch to the recorder. */
async function viaEnv(env: Record<string, string | undefined>, f: typeof fetch): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    await BlissccoClient.fromEnv(env).match({ topic: "gaming" });
  } finally {
    globalThis.fetch = real;
  }
}

describe("fromEnv: documented names", () => {
  it("uses BLISSCCO_API_BASE_URL and BLISSCCO_PUBLISHER_API_KEY", async () => {
    const { seen, f } = recorder();
    await viaEnv({ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_PUBLISHER_API_KEY: KEY }, f);
    assert.equal(seen[0].url, `${BASE}/api/v1/ads/match`);
    assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  });

  it("the Next.js example and the client now agree on the names", () => {
    const client = readFileSync("examples/publisher-node/src/client.ts", "utf8");
    const route = readFileSync("examples/publisher-nextjs/app/api/blisscco-ad/route.ts", "utf8");
    for (const name of ["BLISSCCO_API_BASE_URL", "BLISSCCO_PUBLISHER_API_KEY"]) {
      assert.ok(client.includes(name), name);
      assert.ok(route.includes(`process.env.${name}`), name);
    }
  });
});

describe("fromEnv: older names as a fallback", () => {
  it("works with only the older names", async () => {
    const { seen, f } = recorder();
    await viaEnv({ BLISSCCO_BASE_URL: OLD_BASE, BLISSCCO_API_KEY: OLD_KEY }, f);
    assert.equal(seen[0].url, `${OLD_BASE}/api/v1/ads/match`);
    assert.equal(seen[0].headers.Authorization, `Bearer ${OLD_KEY}`);
  });

  it("the documented name wins when both are set", async () => {
    const { seen, f } = recorder();
    await viaEnv({ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_BASE_URL: OLD_BASE, BLISSCCO_PUBLISHER_API_KEY: KEY, BLISSCCO_API_KEY: OLD_KEY }, f);
    assert.equal(seen[0].url, `${BASE}/api/v1/ads/match`);
    assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  });

  it("an empty documented value falls back to the older name; names mix per value", async () => {
    const { seen, f } = recorder();
    await viaEnv({ BLISSCCO_API_BASE_URL: "", BLISSCCO_BASE_URL: OLD_BASE, BLISSCCO_PUBLISHER_API_KEY: KEY }, f);
    assert.equal(seen[0].url, `${OLD_BASE}/api/v1/ads/match`);
    assert.equal(seen[0].headers.Authorization, `Bearer ${KEY}`);
  });
});

describe("fromEnv: safe errors", () => {
  it("missing values -> BlissccoConfigError that names the variables only", () => {
    const cases: [Record<string, string | undefined>, string[]][] = [
      [{}, ["BLISSCCO_API_BASE_URL", "BLISSCCO_PUBLISHER_API_KEY"]],
      [{ BLISSCCO_PUBLISHER_API_KEY: KEY }, ["BLISSCCO_API_BASE_URL"]],
      [{ BLISSCCO_API_BASE_URL: BASE }, ["BLISSCCO_PUBLISHER_API_KEY"]],
      [{ BLISSCCO_API_BASE_URL: "", BLISSCCO_PUBLISHER_API_KEY: "" }, ["BLISSCCO_API_BASE_URL", "BLISSCCO_PUBLISHER_API_KEY"]],
    ];
    for (const [env, names] of cases) {
      assert.throws(() => BlissccoClient.fromEnv(env), (e: unknown) => {
        assert.ok(e instanceof BlissccoConfigError);
        const m = (e as Error).message;
        for (const n of names) assert.ok(m.includes(n), n);
        assert.ok(!m.includes(KEY) && !m.includes(BASE));
        return true;
      });
    }
  });

  it("a present but malformed value never appears in the error", () => {
    const badKey = "blc_live_NOT-A-VALID-KEY-SECRET-VALUE";
    const badBase = "ftp://user:pass-secret@ads.example.com";
    for (const env of [{ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_PUBLISHER_API_KEY: badKey }, { BLISSCCO_API_BASE_URL: badBase, BLISSCCO_PUBLISHER_API_KEY: KEY }]) {
      assert.throws(() => BlissccoClient.fromEnv(env), (e: unknown) => {
        assert.ok(e instanceof BlissccoConfigError);
        const text = `${String(e)}\n${(e as Error).stack ?? ""}\n${inspect(e, { depth: 5 })}`;
        for (const secret of [badKey, "pass-secret", KEY]) assert.ok(!text.includes(secret));
        return true;
      });
    }
  });

  it("the client built from env hides the key from JSON / inspect / String", () => {
    const c = BlissccoClient.fromEnv({ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_PUBLISHER_API_KEY: KEY });
    for (const text of [JSON.stringify(c), inspect(c, { depth: 5, showHidden: true }), String(c)]) assert.ok(!text.includes(KEY));
  });
});

describe("default retry delay and bounds", () => {
  const OK503 = { fill: false, error: "unavailable" };

  async function run(random: () => number, retry?: Record<string, number>, status = 503) {
    const sleeps: number[] = [];
    const seen: Seen[] = [];
    const f = (async (url: unknown, init: RequestInit) => {
      seen.push({ url: String(url), headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(JSON.stringify(OK503), { status });
    }) as typeof fetch;
    const c = new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: f, sleep: async (ms) => void sleeps.push(ms), random, ...(retry ? { retry } : {}) });
    const outcome = await c.match({ topic: "gaming" }, { idempotencyKey: IDEM }).then(() => "ok", (e: unknown) => e);
    return { sleeps, seen, outcome };
  }

  it("source default is 2 retries, 2000 ms base, 5000 ms cap", () => {
    assert.match(readFileSync("examples/publisher-node/src/client.ts", "utf8"), /DEFAULT_RETRY = \{ maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 5000 \} as const/);
  });

  it("lowest jitter: first wait is exactly the guide minimum (1000 ms), never lower", async () => {
    const { sleeps } = await run(() => 0);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.ok(Math.min(...sleeps) >= 1000);
  });

  it("highest jitter stays within the cap", async () => {
    const { sleeps } = await run(() => 1);
    assert.deepEqual(sleeps, [2000, 4000]);
    assert.ok(Math.max(...sleeps) <= 5000);
  });

  it("random jitter always lands in [1000, 5000] for the default config", async () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.999, 1]) {
      const { sleeps } = await run(() => r);
      for (const ms of sleeps) assert.ok(ms >= 1000 && ms <= 5000, `random ${r} -> ${ms}`);
    }
  });

  it("retry count is bounded: 3 calls, then BlissccoRetryExhaustedError with safeNoFill", async () => {
    const { seen, outcome } = await run(() => 1);
    assert.equal(seen.length, 3);
    assert.ok(outcome instanceof BlissccoRetryExhaustedError);
    assert.equal(outcome.attempts, 3);
    assert.equal(outcome.lastStatus, 503);
    assert.equal(outcome.safeNoFill, true);
  });

  it("even maxRetries 5 with the default delay is bounded by the cap (max 5 waits of <= 5000 ms)", async () => {
    const { sleeps, seen } = await run(() => 1, { maxRetries: 5 });
    assert.equal(seen.length, 6);
    assert.deepEqual(sleeps, [2000, 4000, 5000, 5000, 5000]);
  });

  it("maxRetries 0 still disables retries and never sleeps", async () => {
    const { sleeps, seen, outcome } = await run(() => 1, { maxRetries: 0 });
    assert.equal(seen.length, 1);
    assert.deepEqual(sleeps, []);
    assert.ok(!(outcome instanceof BlissccoRetryExhaustedError));
  });

  it("idempotency key, body and headers are identical on every retry", async () => {
    const { seen } = await run(() => 0);
    assert.equal(seen.length, 3);
    for (const s of seen) {
      assert.equal(s.headers["Idempotency-Key"], IDEM);
      assert.deepEqual(s, seen[0]);
    }
    assert.equal(seen[0].body, JSON.stringify({ topic: "gaming" }));
  });

  it("no secret in the exhausted error", async () => {
    const { outcome } = await run(() => 0);
    const text = `${String(outcome)}\n${(outcome as Error).stack ?? ""}\n${JSON.stringify(outcome)}\n${inspect(outcome, { depth: 5 })}`;
    assert.ok(!text.includes(KEY));
  });

  it("a successful retry returns the ad with the same key", async () => {
    let n = 0;
    const keys: string[] = [];
    const sleeps: number[] = [];
    const f = (async (_u: unknown, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)["Idempotency-Key"]);
      return n++ === 0 ? new Response(JSON.stringify(OK503), { status: 503 }) : new Response(JSON.stringify({ fill: true, sponsored: true, ad: AD }), { status: 200 });
    }) as typeof fetch;
    const c = new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: f, sleep: async (ms) => void sleeps.push(ms), random: () => 0 });
    const r = await c.match({ topic: "gaming" });
    assert.ok(r.fill);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(r.idempotencyKey, keys[0]);
  });
});
