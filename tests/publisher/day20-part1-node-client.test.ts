import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import type { MatchNoFillResponse, MatchSuccessResponse as ContractSuccess } from "@/lib/ads/contract";
import type { MatchNoFillResponse as ExNoFill, MatchSuccessResponse as ExSuccess } from "../../examples/publisher-node/src/types";
import {
  BlissccoApiError,
  BlissccoClient,
  BlissccoConfigError,
  BlissccoNetworkError,
  BlissccoRequestError,
} from "../../examples/publisher-node/src/client";

// Day 20 Part 1: server-side Node client example. MOCKED fetch only: no network, no database, no production code touched.

const KEY = `blc_live_${"a".repeat(64)}`;
const BASE = "https://ads.example.com";
const URL_MATCH = "https://ads.example.com/api/v1/ads/match";
const IDEM = "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

// Compile-time check: example types must stay assignable to the real contract (and back for the main fields).
const _s: ContractSuccess = {} as ExSuccess;
const _n: MatchNoFillResponse = {} as ExNoFill;
void _s;
void _n;

const AD = { id: "11111111-1111-4111-8111-111111111111", headline: "Level up", body: "Gaming laptops", cta_text: "Shop now", destination_url: "https://example.com/g" };

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
let calls: Call[] = [];
let logged: string[] = [];
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}, raw = false): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as Call["init"] });
    return new Response(raw ? (body as string) : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
}
const make = (f: typeof fetch, extra: Record<string, unknown> = {}) => new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: f, retry: { maxRetries: 0 }, ...extra });

beforeEach(() => {
  calls = [];
  logged = [];
  for (const m of ["log", "error", "warn", "info"] as const) console[m] = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
});
afterEach(() => Object.assign(console, realConsole));

describe("successful fill", () => {
  it("returns the ad with the contract fields only", async () => {
    const c = make(mockFetch(200, { fill: true, sponsored: true, ad: { ...AD, advertiser_email: "x@y.com", spent_total: 5 }, secret_extra: 1 }));
    const r = await c.match({ topic: "gaming" }, { idempotencyKey: IDEM });
    assert.deepEqual(r, { idempotencyKey: IDEM, fill: true, sponsored: true, ad: AD });
  });

  it("returns tracking only when present and keeps click_ref", async () => {
    const tracking = { token: "bt1.p.s", expires_at: "2026-10-31T10:00:00.000Z", events: ["impression", "click", "serve"], click_ref: "bc1.a.b" };
    const r = await make(mockFetch(200, { fill: true, sponsored: true, ad: AD, tracking })).match({ topic: "gaming" }, { tracking: true });
    assert.ok(r.fill);
    assert.deepEqual(r.tracking, { token: "bt1.p.s", expires_at: tracking.expires_at, events: ["impression", "click"], click_ref: "bc1.a.b" });
  });

  it("sends exactly the request body and a generated Idempotency-Key when none is given", async () => {
    const req = { topic: "gaming", fallback_topics: ["tech"], exclude_ad_ids: [AD.id] };
    const r = await make(mockFetch(200, { fill: true, sponsored: true, ad: AD })).match(req);
    assert.deepEqual(JSON.parse(calls[0].init.body as string), req);
    assert.match(r.idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal(calls[0].init.headers["Idempotency-Key"], r.idempotencyKey);
  });
});

describe("no-fill", () => {
  it("resolves (does not throw) on fill:false", async () => {
    const r = await make(mockFetch(200, { fill: false })).match({ topic: "gaming" }, { idempotencyKey: IDEM });
    assert.deepEqual(r, { idempotencyKey: IDEM, fill: false });
  });

  it("treats a 200 with an unexpected body as invalid_response", async () => {
    for (const body of [{ fill: true }, { fill: true, sponsored: false, ad: AD }, { hello: 1 }, []]) {
      await assert.rejects(make(mockFetch(200, body)).match({ topic: "gaming" }), (e: unknown) => e instanceof BlissccoApiError && e.code === "invalid_response");
    }
    await assert.rejects(make(mockFetch(200, "not json", {}, true)).match({ topic: "gaming" }), (e: unknown) => e instanceof BlissccoApiError && e.code === "invalid_response");
  });
});

describe("malformed configuration", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["missing baseUrl", { baseUrl: "" }],
    ["non-string baseUrl", { baseUrl: 42 }],
    ["not a URL", { baseUrl: "ads.example.com" }],
    ["http on a public host", { baseUrl: "http://ads.example.com" }],
    ["ftp scheme", { baseUrl: "ftp://ads.example.com" }],
    ["credentials in URL", { baseUrl: "https://user:pw@ads.example.com" }],
    ["query string", { baseUrl: "https://ads.example.com?x=1" }],
    ["fragment", { baseUrl: "https://ads.example.com/#x" }],
    ["missing apiKey", { apiKey: "" }],
    ["undefined apiKey", { apiKey: undefined }],
    ["wrong apiKey prefix", { apiKey: `blc_test_${"a".repeat(64)}` }],
    ["short apiKey", { apiKey: "blc_live_abc" }],
    ["uppercase hex apiKey", { apiKey: `blc_live_${"A".repeat(64)}` }],
    ["bad timeout", { timeoutMs: 5 }],
    ["float timeout", { timeoutMs: 1000.5 }],
  ];
  for (const [name, patch] of bad) {
    it(`rejects: ${name}`, () => {
      assert.throws(() => new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: mockFetch(200, {}), ...patch } as never), BlissccoConfigError);
      assert.equal(calls.length, 0);
    });
  }

  it("allows http for localhost and normalizes trailing slashes", async () => {
    const c = new BlissccoClient({ baseUrl: "http://localhost:3000///", apiKey: KEY, fetch: mockFetch(200, { fill: false }) });
    await c.match({ topic: "gaming" });
    assert.equal(calls[0].url, "http://localhost:3000/api/v1/ads/match");
  });

  it("keeps a path prefix", async () => {
    await new BlissccoClient({ baseUrl: "https://ads.example.com/blisscco/", apiKey: KEY, fetch: mockFetch(200, { fill: false }) }).match({ topic: "gaming" });
    assert.equal(calls[0].url, "https://ads.example.com/blisscco/api/v1/ads/match");
  });

  it("fromEnv reads the documented env names (BLISSCCO_API_BASE_URL / BLISSCCO_PUBLISHER_API_KEY)", async () => {
    const c = BlissccoClient.fromEnv({ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_PUBLISHER_API_KEY: KEY });
    assert.ok(c instanceof BlissccoClient);
    // Prove the values really arrive: call through a client built from the same env with a mocked fetch.
    const realFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { fill: false });
    try {
      await BlissccoClient.fromEnv({ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_PUBLISHER_API_KEY: KEY }).match({ topic: "gaming" });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(calls[0].url, URL_MATCH);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  });

  it("fromEnv still accepts the older names (BLISSCCO_BASE_URL / BLISSCCO_API_KEY) as a fallback", () => {
    assert.ok(BlissccoClient.fromEnv({ BLISSCCO_BASE_URL: BASE, BLISSCCO_API_KEY: KEY }));
    assert.ok(BlissccoClient.fromEnv({ BLISSCCO_API_BASE_URL: BASE, BLISSCCO_API_KEY: KEY }));
    assert.ok(BlissccoClient.fromEnv({ BLISSCCO_BASE_URL: BASE, BLISSCCO_PUBLISHER_API_KEY: KEY }));
  });

  it("fromEnv fails with a safe BlissccoConfigError when a value is missing", () => {
    for (const env of [{}, { BLISSCCO_API_BASE_URL: BASE }, { BLISSCCO_PUBLISHER_API_KEY: KEY }, { BLISSCCO_BASE_URL: BASE }, { BLISSCCO_API_KEY: KEY }, { BLISSCCO_API_BASE_URL: "", BLISSCCO_PUBLISHER_API_KEY: KEY }]) {
      assert.throws(() => BlissccoClient.fromEnv(env), (e: unknown) => {
        assert.ok(e instanceof BlissccoConfigError);
        assert.ok(!(e as Error).message.includes(KEY));
        assert.ok(!(e as Error).message.includes(BASE));
        return true;
      });
    }
  });

  it("rejects bad request input before any network call", async () => {
    const c = make(mockFetch(200, { fill: false }));
    const cases: unknown[] = [
      { topic: "Gaming" },
      { topic: "" },
      { topic: "gaming", prompt: "hi" },
      { topic: "gaming", fallback_topics: ["a", "b", "c"] },
      { topic: "gaming", exclude_ad_ids: ["nope"] },
      { topic: "gaming", exclude_ad_ids: Array(21).fill(AD.id) },
      null,
    ];
    for (const req of cases) await assert.rejects(c.match(req as never), BlissccoRequestError);
    await assert.rejects(c.match({ topic: "gaming" }, { idempotencyKey: "short" }), BlissccoRequestError);
    assert.equal(calls.length, 0);
  });
});

describe("HTTP errors", () => {
  const table: Array<[number, unknown, string, string | undefined]> = [
    [400, { error: "invalid_request", reason: "invalid_topic" }, "invalid_request", "invalid_topic"],
    [401, { error: "unauthorized" }, "unauthorized", undefined],
    [413, { error: "payload_too_large" }, "payload_too_large", undefined],
    [415, { error: "unsupported_media_type" }, "unsupported_media_type", undefined],
    [429, { error: "rate_limited" }, "rate_limited", undefined],
    [503, { fill: false, error: "unavailable" }, "unavailable", undefined],
  ];
  for (const [status, body, code, reason] of table) {
    it(`maps ${status} to ${code}`, async () => {
      await assert.rejects(make(mockFetch(status, body)).match({ topic: "gaming" }), (e: unknown) => {
        assert.ok(e instanceof BlissccoApiError);
        assert.equal(e.status, status);
        assert.equal(e.code, code);
        assert.equal(e.reason, reason);
        return true;
      });
    });
  }

  it("exposes Retry-After on 429", async () => {
    await assert.rejects(make(mockFetch(429, { error: "rate_limited" }, { "retry-after": "60" })).match({ topic: "gaming" }), (e: unknown) => e instanceof BlissccoApiError && e.retryAfterSeconds === 60);
  });

  it("unknown or non-JSON error bodies become unknown_error", async () => {
    await assert.rejects(make(mockFetch(500, "<html>boom</html>", {}, true)).match({ topic: "gaming" }), (e: unknown) => e instanceof BlissccoApiError && e.status === 500 && e.code === "unknown_error");
    await assert.rejects(make(mockFetch(502, { error: "db_exploded: password=x" })).match({ topic: "gaming" }), (e: unknown) => e instanceof BlissccoApiError && e.code === "unknown_error");
  });

  it("network failure and timeout become BlissccoNetworkError", async () => {
    const boom = (async () => { throw new TypeError(`fetch failed for Bearer ${KEY}`); }) as typeof fetch;
    await assert.rejects(make(boom).match({ topic: "gaming" }), BlissccoNetworkError);
    const hang = ((_u: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
    await assert.rejects(make(hang, { timeoutMs: 100 }).match({ topic: "gaming" }), BlissccoNetworkError);
  });
});

describe("request headers", () => {
  it("sends POST with Bearer auth, JSON content type and Idempotency-Key", async () => {
    await make(mockFetch(200, { fill: false })).match({ topic: "gaming" }, { idempotencyKey: IDEM });
    const { url, init } = calls[0];
    assert.equal(url, URL_MATCH);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.headers["Idempotency-Key"], IDEM);
    assert.equal(init.headers["X-Blisscco-Tracking"], undefined);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal);
  });

  it("sends X-Blisscco-Tracking: 1 only when tracking is true", async () => {
    const c = make(mockFetch(200, { fill: false }));
    await c.match({ topic: "gaming" }, { tracking: true });
    await c.match({ topic: "gaming" }, { tracking: false });
    assert.equal(calls[0].init.headers["X-Blisscco-Tracking"], "1");
    assert.equal(calls[1].init.headers["X-Blisscco-Tracking"], undefined);
  });

  it("uses a new Idempotency-Key per call by default, the given one on retry", async () => {
    const c = make(mockFetch(200, { fill: false }));
    await c.match({ topic: "gaming" });
    await c.match({ topic: "gaming" });
    await c.match({ topic: "gaming" }, { idempotencyKey: IDEM });
    await c.match({ topic: "gaming" }, { idempotencyKey: IDEM });
    assert.notEqual(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
    assert.equal(calls[2].init.headers["Idempotency-Key"], calls[3].init.headers["Idempotency-Key"]);
  });
});

describe("secret non-disclosure", () => {
  const SECRETS = [KEY, "a".repeat(64)];
  const leaks = (text: string) => SECRETS.some((s) => text.includes(s));

  it("does not show the key via JSON, inspect, String or own properties", () => {
    const c = make(mockFetch(200, {}));
    for (const text of [JSON.stringify(c), inspect(c, { depth: 5, showHidden: true }), String(c), JSON.stringify(Object.getOwnPropertyNames(c))]) assert.equal(leaks(text), false);
  });

  it("config errors never contain the supplied key or URL password", () => {
    const attempts: Array<Record<string, unknown>> = [
      { apiKey: `blc_live_${"b".repeat(10)}` },
      { apiKey: `wrong_${"c".repeat(64)}` },
      { baseUrl: "http://user:s3cretpw@ads.example.com" },
      { baseUrl: "https://user:s3cretpw@ads.example.com" },
    ];
    for (const patch of attempts) {
      try {
        new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: mockFetch(200, {}), ...patch } as never);
        assert.fail("should throw");
      } catch (e) {
        const text = `${(e as Error).name} ${(e as Error).message} ${(e as Error).stack?.split("\n")[0]}`;
        assert.equal(leaks(text), false);
        assert.equal(text.includes("s3cretpw"), false);
        for (const v of Object.values(patch)) assert.equal(text.includes(String(v)), false);
      }
    }
  });

  it("API and network errors never contain the key, even if the server echoes it", async () => {
    const echo = mockFetch(401, { error: "unauthorized", reason: KEY, detail: `Bearer ${KEY}` });
    const boom = (async () => { throw new Error(`failed Authorization: Bearer ${KEY}`); }) as typeof fetch;
    for (const f of [echo, boom, mockFetch(500, `oops ${KEY}`, {}, true)]) {
      try {
        await make(f).match({ topic: "gaming" });
        assert.fail("should throw");
      } catch (e) {
        const err = e as Error & { cause?: unknown };
        assert.equal(leaks(`${err.name} ${err.message} ${err.stack ?? ""} ${JSON.stringify(err)} ${inspect(err, { depth: 5 })}`), false);
        assert.equal(err.cause, undefined);
      }
    }
  });

  it("results never contain the key, and nothing is logged", async () => {
    const r = await make(mockFetch(200, { fill: true, sponsored: true, ad: AD, token: KEY })).match({ topic: "gaming" });
    assert.equal(leaks(JSON.stringify(r)), false);
    await make(mockFetch(200, { fill: false })).match({ topic: "gaming" }).catch(() => {});
    await make(mockFetch(401, { error: "unauthorized" })).match({ topic: "gaming" }).catch(() => {});
    assert.deepEqual(logged, []);
  });

  it("key is sent only in the Authorization header, never in URL or body", async () => {
    await make(mockFetch(200, { fill: false })).match({ topic: "gaming" });
    const { url, init } = calls[0];
    assert.equal(leaks(url), false);
    assert.equal(leaks(String(init.body)), false);
    for (const [k, v] of Object.entries(init.headers)) assert.equal(leaks(v), k === "Authorization");
  });
});
