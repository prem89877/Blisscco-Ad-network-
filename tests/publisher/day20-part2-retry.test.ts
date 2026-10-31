import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  BlissccoApiError,
  BlissccoClient,
  BlissccoConfigError,
  BlissccoNetworkError,
  BlissccoRetryExhaustedError,
} from "../../examples/publisher-node/src/client";
import type { RetryConfig } from "../../examples/publisher-node/src/types";

// Day 20 Part 2: bounded safe retry. MOCKED fetch + fake sleep (no real waiting): no network, no database, no production code touched.

const KEY = `blc_live_${"a".repeat(64)}`;
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const AD = { id: "11111111-1111-4111-8111-111111111111", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };
const OK = { fill: true, sponsored: true, ad: AD };

type Step = { status: number; body: unknown; headers?: Record<string, string> } | "network";
type Call = { headers: Record<string, string>; body: string };
let calls: Call[] = [];
let sleeps: number[] = [];

/** Replies with `steps` in order; the last step repeats if the client keeps calling. */
function script(...steps: Step[]): typeof fetch {
  let i = 0;
  return (async (_url: unknown, init: RequestInit) => {
    calls.push({ headers: init.headers as Record<string, string>, body: init.body as string });
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step === "network") throw new TypeError(`connect failed, Bearer ${KEY}`);
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { "content-type": "application/json", ...(step.headers ?? {}) } });
  }) as typeof fetch;
}

const sleep = async (ms: number) => void sleeps.push(ms);
const make = (f: typeof fetch, retry?: RetryConfig) =>
  new BlissccoClient({ baseUrl: "https://ads.example.com", apiKey: KEY, fetch: f, sleep, random: () => 1, ...(retry ? { retry } : {}) });
const req = { topic: "gaming" };
const S503: Step = { status: 503, body: { fill: false, error: "unavailable" } };
const S429 = (retryAfter?: string): Step => ({ status: 429, body: { error: "rate_limited" }, ...(retryAfter ? { headers: { "retry-after": retryAfter } } : {}) });

beforeEach(() => {
  calls = [];
  sleeps = [];
});

describe("retry limits", () => {
  it("default is 1 try + 2 retries, then BlissccoRetryExhaustedError", async () => {
    await assert.rejects(make(script(S503)).match(req, { idempotencyKey: IDEM }), (e: unknown) => {
      assert.ok(e instanceof BlissccoRetryExhaustedError);
      assert.equal(e.attempts, 3);
      return true;
    });
    assert.equal(calls.length, 3);
    assert.equal(sleeps.length, 2);
  });

  it("honours maxRetries (1 retry => 2 calls) and never loops forever", async () => {
    await assert.rejects(make(script(S503), { maxRetries: 1 }).match(req), BlissccoRetryExhaustedError);
    assert.equal(calls.length, 2);
    await assert.rejects(make(script(S503), { maxRetries: 5, baseDelayMs: 0, maxDelayMs: 0 }).match(req), BlissccoRetryExhaustedError);
    assert.equal(calls.length, 2 + 6);
  });

  it("maxRetries 0 disables retries and keeps the plain Part 1 errors", async () => {
    await assert.rejects(make(script(S503), { maxRetries: 0 }).match(req), (e: unknown) => e instanceof BlissccoApiError && e.status === 503 && e.code === "unavailable");
    await assert.rejects(make(script("network"), { maxRetries: 0 }).match(req), BlissccoNetworkError);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, []);
  });

  it("rejects bad retry config", () => {
    for (const retry of [{ maxRetries: 6 }, { maxRetries: -1 }, { maxRetries: 1.5 }, { baseDelayMs: -1 }, { baseDelayMs: 500, maxDelayMs: 100 }, { maxDelayMs: 60_001 }]) {
      assert.throws(() => make(script(S503), retry), BlissccoConfigError);
    }
  });

  it("backoff doubles, is capped by maxDelayMs and jitter stays within 50-100%", async () => {
    await assert.rejects(make(script(S503), { maxRetries: 4, baseDelayMs: 100, maxDelayMs: 300 }).match(req), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [100, 200, 300, 300]); // random() = 1 => full delay
    sleeps = [];
    const lowJitter = new BlissccoClient({ baseUrl: "https://ads.example.com", apiKey: KEY, fetch: script(S503), sleep, random: () => 0, retry: { baseDelayMs: 100 } });
    await assert.rejects(lowJitter.match(req), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [50, 100]);
  });
});

describe("identical idempotency key", () => {
  it("reuses the SAME key, body and headers on every retry (given key)", async () => {
    await assert.rejects(make(script(S503, S429(), "network", S503)).match({ topic: "gaming", fallback_topics: ["tech"] }, { idempotencyKey: IDEM, tracking: true }), BlissccoRetryExhaustedError);
    assert.ok(calls.length >= 3);
    for (const c of calls) {
      assert.equal(c.headers["Idempotency-Key"], IDEM);
      assert.deepEqual(c, calls[0]);
    }
  });

  it("generates ONE key per placement (not per attempt), new key for the next placement", async () => {
    const c = make(script(S503, S503, { status: 200, body: OK }, { status: 200, body: OK }));
    const first = await c.match(req);
    const second = await c.match(req);
    assert.equal(calls.length, 4);
    const keys = calls.map((x) => x.headers["Idempotency-Key"]);
    assert.equal(new Set(keys.slice(0, 3)).size, 1);
    assert.equal(first.idempotencyKey, keys[0]);
    assert.notEqual(keys[3], keys[0]);
    assert.equal(second.idempotencyKey, keys[3]);
  });
});

describe("429 and Retry-After", () => {
  it("waits exactly Retry-After seconds, then succeeds", async () => {
    const r = await make(script(S429("2"), { status: 200, body: OK })).match(req);
    assert.deepEqual(sleeps, [2000]);
    assert.ok(r.fill);
    assert.equal(calls.length, 2);
  });

  it("honours Retry-After on 503 too, and Retry-After: 0 retries immediately", async () => {
    await make(script({ ...S503, headers: { "retry-after": "1" } }, { status: 200, body: OK })).match(req);
    await make(script(S429("0"), { status: 200, body: OK })).match(req);
    assert.deepEqual(sleeps, [1000, 0]);
  });

  it("accepts a future HTTP-date Retry-After", async () => {
    const realNow = Date.now;
    Date.now = () => Date.UTC(2026, 9, 31, 10, 0, 0);
    try {
      await make(script(S429("Sat, 31 Oct 2026 10:00:03 GMT"), { status: 200, body: OK })).match(req);
    } finally {
      Date.now = realNow;
    }
    assert.deepEqual(sleeps, [3000]);
  });

  it("ignores invalid Retry-After values and uses normal backoff", async () => {
    for (const bad of ["abc", "-5", "1.5", "99999999", "", "Mon, 01 Jan 1990 00:00:00 GMT"]) {
      sleeps = [];
      await make(script(S429(bad), { status: 200, body: OK }), { baseDelayMs: 200 }).match(req);
      assert.deepEqual(sleeps, [200], `Retry-After "${bad}"`);
    }
  });

  it("stops (no sleeping, no more calls) when Retry-After is longer than maxDelayMs", async () => {
    await assert.rejects(make(script(S429("60"), { status: 200, body: OK })).match(req), (e: unknown) => {
      assert.ok(e instanceof BlissccoRetryExhaustedError);
      assert.equal(e.attempts, 1);
      assert.equal(e.lastStatus, 429);
      assert.equal(e.lastCode, "rate_limited");
      return true;
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });
});

describe("503 and network recovery", () => {
  it("recovers from 503 to a fill", async () => {
    const r = await make(script(S503, { status: 200, body: OK })).match(req, { idempotencyKey: IDEM });
    assert.deepEqual(r, { idempotencyKey: IDEM, ...OK });
    assert.equal(calls.length, 2);
  });

  it("recovers from 503 to a no-fill (no-fill is a normal result, never retried)", async () => {
    const r = await make(script(S503, { status: 200, body: { fill: false } })).match(req, { idempotencyKey: IDEM });
    assert.deepEqual(r, { idempotencyKey: IDEM, fill: false });
    assert.equal(calls.length, 2);
    calls = [];
    await make(script({ status: 200, body: { fill: false } })).match(req);
    assert.equal(calls.length, 1);
  });

  it("retries network failures and recovers", async () => {
    const r = await make(script("network", "network", { status: 200, body: OK })).match(req);
    assert.ok(r.fill);
    assert.equal(calls.length, 3);
  });

  it("retries a timeout", async () => {
    let n = 0;
    const f = ((_u: unknown, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: init.body as string });
      if (n++ === 0) return new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      return Promise.resolve(new Response(JSON.stringify(OK), { status: 200 }));
    }) as typeof fetch;
    const r = await new BlissccoClient({ baseUrl: "https://ads.example.com", apiKey: KEY, fetch: f, sleep, timeoutMs: 100 }).match(req);
    assert.ok(r.fill);
    assert.equal(calls.length, 2);
  });

  it("network failure that never recovers => exhausted error with network_error", async () => {
    await assert.rejects(make(script("network")).match(req, { idempotencyKey: IDEM }), (e: unknown) => {
      assert.ok(e instanceof BlissccoRetryExhaustedError);
      assert.equal(e.lastCode, "network_error");
      assert.equal(e.lastStatus, undefined);
      assert.equal(e.attempts, 3);
      return true;
    });
  });
});

describe("permanent errors are never retried", () => {
  const cases: Array<[number, unknown, string]> = [
    [400, { error: "invalid_request", reason: "invalid_topic" }, "invalid_request"],
    [401, { error: "unauthorized" }, "unauthorized"],
    [413, { error: "payload_too_large" }, "payload_too_large"],
    [415, { error: "unsupported_media_type" }, "unsupported_media_type"],
    [500, "boom", "unknown_error"],
    [404, { error: "x" }, "unknown_error"],
  ];
  for (const [status, body, code] of cases) {
    it(`HTTP ${status}: exactly 1 call, no sleep, BlissccoApiError`, async () => {
      await assert.rejects(make(script({ status, body })).match(req), (e: unknown) => e instanceof BlissccoApiError && !(e instanceof BlissccoRetryExhaustedError) && e.status === status && e.code === code);
      assert.equal(calls.length, 1);
      assert.deepEqual(sleeps, []);
    });
  }

  it("a 200 with an unexpected body is not retried", async () => {
    await assert.rejects(make(script({ status: 200, body: { hello: 1 } })).match(req), (e: unknown) => e instanceof BlissccoApiError && e.code === "invalid_response");
    assert.equal(calls.length, 1);
  });

  it("503 followed by a permanent 401 stops at the 401", async () => {
    await assert.rejects(make(script(S503, { status: 401, body: { error: "unauthorized" } })).match(req), (e: unknown) => e instanceof BlissccoApiError && e.status === 401);
    assert.equal(calls.length, 2);
  });

  it("invalid input never reaches the network", async () => {
    await assert.rejects(make(script(S503)).match({ topic: "BAD" }));
    assert.equal(calls.length, 0);
  });
});

describe("exhausted retries", () => {
  it("is a clear typed error with safeNoFill, attempts, last status and the placement key", async () => {
    await assert.rejects(make(script(S429())).match(req, { idempotencyKey: IDEM }), (e: unknown) => {
      assert.ok(e instanceof BlissccoRetryExhaustedError);
      assert.ok(e instanceof Error);
      assert.equal(e.name, "BlissccoRetryExhaustedError");
      assert.equal(e.safeNoFill, true);
      assert.equal(e.attempts, 3);
      assert.equal(e.lastStatus, 429);
      assert.equal(e.lastCode, "rate_limited");
      assert.equal(e.idempotencyKey, IDEM);
      assert.match(e.message, /3 attempt/);
      return true;
    });
  });

  it("never leaks the key (even when fetch errors and responses echo it)", async () => {
    for (const f of [script("network"), script({ status: 503, body: { error: "unavailable", reason: KEY } })]) {
      try {
        await make(f).match(req);
        assert.fail("should throw");
      } catch (e) {
        const err = e as Error & { cause?: unknown };
        assert.equal(`${err.message} ${err.stack} ${JSON.stringify(err)} ${inspect(err, { depth: 5 })}`.includes("a".repeat(64)), false);
        assert.equal(err.cause, undefined);
      }
    }
  });
});

describe("default retry delay follows the publisher guide (1 second or more)", () => {
  const fresh = (f: typeof fetch, random: () => number, retry?: RetryConfig) =>
    new BlissccoClient({ baseUrl: "https://ads.example.com", apiKey: KEY, fetch: f, sleep, random, ...(retry ? { retry } : {}) });

  it("with default config every jittered wait is at least 1000 ms, even with the lowest jitter", async () => {
    await assert.rejects(fresh(script(S503), () => 0).match(req, { idempotencyKey: IDEM }), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [1000, 2000]); // 50% of 2000 and 50% of 4000
    assert.ok(sleeps.every((ms) => ms >= 1000));
  });

  it("with default config the highest jitter gives 2000 ms then 4000 ms, below the 5000 ms cap", async () => {
    await assert.rejects(fresh(script(S503), () => 1).match(req, { idempotencyKey: IDEM }), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [2000, 4000]);
  });

  it("stays bounded: default is 2 retries (3 calls) and total waiting is at most 6000 ms", async () => {
    await assert.rejects(fresh(script(S503), () => 1).match(req), (e: unknown) => e instanceof BlissccoRetryExhaustedError && e.attempts === 3);
    assert.equal(calls.length, 3);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 6000);
    assert.ok(sleeps.every((ms) => ms <= 5000));
  });

  it("network errors use the same default delays", async () => {
    await assert.rejects(fresh(script("network"), () => 0).match(req), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("the cap still wins over a large backoff, and an explicit smaller baseDelayMs is honoured", async () => {
    await assert.rejects(fresh(script(S503), () => 1, { maxRetries: 4 }).match(req), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [2000, 4000, 5000, 5000]); // 2000, 4000, 8000->5000, 16000->5000
    sleeps = [];
    await assert.rejects(fresh(script(S503), () => 1, { baseDelayMs: 100 }).match(req), BlissccoRetryExhaustedError);
    assert.deepEqual(sleeps, [100, 200]);
  });

  it("default delays do not change the idempotency key, body or headers across retries", async () => {
    await assert.rejects(fresh(script(S503), () => 0).match({ topic: "gaming" }, { idempotencyKey: IDEM, tracking: true }), BlissccoRetryExhaustedError);
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.headers["Idempotency-Key"], IDEM);
      assert.deepEqual(c, calls[0]);
    }
  });

  it("a generated key is created once per placement and reused by the retries", async () => {
    const r = await fresh(script(S503, S503, { status: 200, body: OK }), () => 0).match(req);
    const keys = calls.map((c) => c.headers["Idempotency-Key"]);
    assert.equal(new Set(keys).size, 1);
    assert.equal(r.idempotencyKey, keys[0]);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("Retry-After rules are unchanged (exact wait; longer than the cap stops at once)", async () => {
    await fresh(script(S429("3"), { status: 200, body: OK }), () => 0).match(req);
    assert.deepEqual(sleeps, [3000]);
    sleeps = [];
    calls = [];
    await assert.rejects(fresh(script(S429("60")), () => 0).match(req), (e: unknown) => e instanceof BlissccoRetryExhaustedError && e.attempts === 1);
    assert.deepEqual(sleeps, []);
    assert.equal(calls.length, 1);
  });

  it("the secret key never appears in the retry error", async () => {
    await assert.rejects(fresh(script("network"), () => 0).match(req), (e: unknown) => {
      const text = [String(e), (e as Error).stack ?? "", JSON.stringify(e)].join("\n");
      assert.ok(!text.includes(KEY));
      return true;
    });
  });
});
