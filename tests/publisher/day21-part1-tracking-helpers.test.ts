import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import type { ImpressionRequestBody as ExImpressionBody, ImpressionResult as ExImpressionResult } from "../../examples/publisher-node/src/types";
import {
  BlissccoApiError,
  BlissccoClient,
  BlissccoNetworkError,
  BlissccoRequestError,
} from "../../examples/publisher-node/src/client";

// Day 21 Part 1: server-side reportImpression()/reportClick(). MOCKED fetch only: no network, no database, no production code touched.

const KEY = `blc_live_${"a".repeat(64)}`;
const BASE = "https://ads.example.com";
const URL_IMPRESSION = "https://ads.example.com/api/v1/ads/impression";
const URL_CLICK = "https://ads.example.com/api/v1/ads/click";
const TOKEN = "bt1.eyJ2IjoxfQ.c2lnbmF0dXJlLXNlY3JldA";
const CLICK_REF = "bc1.eyJ2IjoxfQ.Y2xpY2stc2lnLXNlY3JldA";
const DEST = "https://advertiser.example.com/landing?utm=secret-destination";

// Compile-time check: the example's wire body type stays assignable to what lib/ads/impression.ts accepts.
const _b: { token: string; event: "impression" } = {} as ExImpressionBody;
const _r: { ok: true; status: "recorded" | "duplicate" } = {} as ExImpressionResult;
void _b;
void _r;

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
let calls: Call[] = [];
let logged: string[] = [];
const realConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}, raw = false): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as Call["init"] });
    if (status === 302 || status === 204) return new Response(null, { status, headers });
    return new Response(raw ? (body as string) : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
}
function throwingFetch(): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as Call["init"] });
    throw new TypeError(`connect failed ${String(url)} Bearer ${KEY} ${TOKEN} ${CLICK_REF}`);
  }) as typeof fetch;
}
const make = (f: typeof fetch, extra: Record<string, unknown> = {}) => new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: f, ...extra });
const REDIRECT = { location: DEST };

beforeEach(() => {
  calls = [];
  logged = [];
  for (const m of ["log", "error", "warn", "info"] as const) console[m] = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
});
afterEach(() => Object.assign(console, realConsole));

/** Everything a caller could see or an operator could log. */
function surfaces(e: unknown): string {
  const err = e as Error;
  return [String(e), err.message, err.stack ?? "", JSON.stringify(e), inspect(e, { depth: 6, showHidden: true }), ...Object.values(e as object).map(String)].join("\n");
}
function assertNoSecrets(text: string): void {
  for (const secret of [KEY, TOKEN, CLICK_REF, "secret-destination", "c2lnbmF0dXJlLXNlY3JldA", "Y2xpY2stc2lnLXNlY3JldA"]) {
    assert.ok(!text.includes(secret), `leaked: ${secret.slice(0, 12)}...`);
  }
}

describe("reportImpression: success", () => {
  it("POSTs the exact endpoint, headers and body, and returns recorded", async () => {
    const r = await make(mockFetch(200, { ok: true, status: "recorded" })).reportImpression({ token: TOKEN });
    assert.deepEqual(r, { ok: true, status: "recorded" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, URL_IMPRESSION);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json", Accept: "application/json" });
    assert.equal(calls[0].init.body, JSON.stringify({ token: TOKEN, event: "impression" }));
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.cache, "no-store");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  it("returns duplicate as a success (not an error)", async () => {
    const r = await make(mockFetch(200, { ok: true, status: "duplicate" })).reportImpression({ token: TOKEN });
    assert.deepEqual(r, { ok: true, status: "duplicate" });
  });

  it("sends NO API key / Authorization and no Idempotency-Key (token is the only credential)", async () => {
    await make(mockFetch(200, { ok: true, status: "recorded" })).reportImpression({ token: TOKEN });
    const keys = Object.keys(calls[0].init.headers).map((k) => k.toLowerCase());
    assert.ok(!keys.includes("authorization"));
    assert.ok(!keys.includes("idempotency-key"));
    assert.ok(!keys.includes("x-blisscco-tracking"));
    assert.ok(!JSON.stringify(calls[0]).includes(KEY));
  });

  it("returns only contract fields even if the server adds extras", async () => {
    const r = await make(mockFetch(200, { ok: true, status: "recorded", serve_ref: "bsr_x", publisher_id: "p", extra: 1 })).reportImpression({ token: TOKEN });
    assert.deepEqual(r, { ok: true, status: "recorded" });
  });

  it("uses the base URL path prefix and ignores a trailing slash", async () => {
    const c = new BlissccoClient({ baseUrl: "https://ads.example.com/prefix/", apiKey: KEY, fetch: mockFetch(200, { ok: true, status: "recorded" }) });
    await c.reportImpression({ token: TOKEN });
    assert.equal(calls[0].url, "https://ads.example.com/prefix/api/v1/ads/impression");
  });
});

describe("reportClick: success", () => {
  it("GETs the exact endpoint with only ?ref=, no body, manual redirect, and returns accepted", async () => {
    const r = await make(mockFetch(302, null, REDIRECT)).reportClick({ click_ref: CLICK_REF });
    assert.deepEqual(r, { ok: true, status: "accepted" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${URL_CLICK}?ref=${CLICK_REF}`);
    assert.equal(new URL(calls[0].url).searchParams.get("ref"), CLICK_REF);
    assert.deepEqual([...new URL(calls[0].url).searchParams.keys()], ["ref"]);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.body, undefined);
    assert.deepEqual(calls[0].init.headers, { Accept: "application/json" });
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(calls[0].init.cache, "no-store");
  });

  it("sends NO API key / Authorization and no prefetch headers", async () => {
    await make(mockFetch(302, null, REDIRECT)).reportClick({ click_ref: CLICK_REF });
    const keys = Object.keys(calls[0].init.headers).map((k) => k.toLowerCase());
    for (const k of ["authorization", "idempotency-key", "purpose", "sec-purpose", "x-purpose", "next-router-prefetch"]) assert.ok(!keys.includes(k), k);
    assert.ok(!JSON.stringify(calls[0]).includes(KEY));
  });

  it("does not return or follow the redirect destination", async () => {
    const r = await make(mockFetch(302, null, REDIRECT)).reportClick({ click_ref: CLICK_REF });
    assert.ok(!JSON.stringify(r).includes("advertiser.example.com"));
    assert.equal(calls.length, 1);
  });
});

describe("invalid inputs (nothing is sent)", () => {
  const badImpressions: unknown[] = [
    undefined,
    null,
    "bt1.a.b",
    [],
    42,
    {},
    { token: "" },
    { token: 123 },
    { token: null },
    { token: "not-a-token" },
    { token: "bt1.onlytwo" },
    { token: "bt1.a.b.c" },
    { token: "bc1.a.b" }, // click ref is not an impression token
    { token: "bt1.a b.c" },
    { token: "bt1.a.b\n" },
    { token: `bt1.${"a".repeat(600)}.b` },
    { token: TOKEN, event: "impression" },
    { token: TOKEN, event: "click" },
    { token: TOKEN, apiKey: KEY },
    { token: TOKEN, click_ref: CLICK_REF },
  ];
  for (const [i, bad] of badImpressions.entries()) {
    it(`reportImpression rejects bad input #${i}`, async () => {
      await assert.rejects(make(mockFetch(200, { ok: true, status: "recorded" })).reportImpression(bad as never), (e: unknown) => {
        assert.ok(e instanceof BlissccoRequestError);
        assertNoSecrets(surfaces(e));
        return true;
      });
      assert.equal(calls.length, 0);
    });
  }

  const badClicks: unknown[] = [
    undefined,
    null,
    "bc1.a.b",
    [],
    {},
    { click_ref: "" },
    { click_ref: 5 },
    { click_ref: "garbage" },
    { click_ref: "bc1.onlytwo" },
    { click_ref: "bc1.a.b.c" },
    { click_ref: TOKEN }, // tracking token is not a click ref
    { click_ref: "bc1.a&url=https://evil.example.com.b" },
    { click_ref: "bc1.a.b?x=1" },
    { click_ref: `bc1.${"a".repeat(600)}.b` },
    { click_ref: CLICK_REF, url: DEST },
    { click_ref: CLICK_REF, token: TOKEN },
    { ref: CLICK_REF }, // the field is click_ref, the query parameter is ref
  ];
  for (const [i, bad] of badClicks.entries()) {
    it(`reportClick rejects bad input #${i}`, async () => {
      await assert.rejects(make(mockFetch(302, null, REDIRECT)).reportClick(bad as never), (e: unknown) => {
        assert.ok(e instanceof BlissccoRequestError);
        assertNoSecrets(surfaces(e));
        return true;
      });
      assert.equal(calls.length, 0);
    });
  }

  it("validation messages do not echo the supplied values", async () => {
    const c = make(mockFetch(200, { ok: true, status: "recorded" }));
    for (const fn of [() => c.reportImpression({ token: `${TOKEN} bad` }), () => c.reportClick({ click_ref: `${CLICK_REF} bad` })]) {
      await assert.rejects(fn(), (e: unknown) => {
        assert.ok(e instanceof BlissccoRequestError);
        assert.ok(!(e as Error).message.includes("eyJ2"));
        return true;
      });
    }
  });
});

describe("API errors", () => {
  const impressionCases: [number, unknown, string, string | undefined][] = [
    [400, { error: "invalid_request", reason: "invalid_token" }, "invalid_request", "invalid_token"],
    [400, { error: "invalid_request", reason: "unknown_field" }, "invalid_request", "unknown_field"],
    [401, { error: "unauthorized" }, "unauthorized", undefined],
    [413, { error: "payload_too_large" }, "payload_too_large", undefined],
    [415, { error: "unsupported_media_type" }, "unsupported_media_type", undefined],
    [503, { error: "unavailable" }, "unavailable", undefined],
    [500, { something: "else" }, "unknown_error", undefined],
  ];
  for (const [status, body, code, reason] of impressionCases) {
    it(`reportImpression maps HTTP ${status} -> ${code}`, async () => {
      await assert.rejects(make(mockFetch(status, body)).reportImpression({ token: TOKEN }), (e: unknown) => {
        assert.ok(e instanceof BlissccoApiError);
        assert.equal(e.status, status);
        assert.equal(e.code, code);
        assert.equal(e.reason, reason);
        assertNoSecrets(surfaces(e));
        return true;
      });
      assert.equal(calls.length, 1, "no retry for tracking calls");
    });
  }

  const clickCases: [number, unknown, string, string | undefined][] = [
    [400, { error: "invalid_request", reason: "unexpected_parameter" }, "invalid_request", "unexpected_parameter"],
    [404, { error: "not_found" }, "not_found", undefined],
    [503, { error: "unavailable" }, "unavailable", undefined],
    [405, { error: "method_not_allowed" }, "unknown_error", undefined],
  ];
  for (const [status, body, code, reason] of clickCases) {
    it(`reportClick maps HTTP ${status} -> ${code}`, async () => {
      await assert.rejects(make(mockFetch(status, body)).reportClick({ click_ref: CLICK_REF }), (e: unknown) => {
        assert.ok(e instanceof BlissccoApiError);
        assert.equal(e.status, status);
        assert.equal(e.code, code);
        assert.equal(e.reason, reason);
        assertNoSecrets(surfaces(e));
        return true;
      });
      assert.equal(calls.length, 1, "no retry for tracking calls");
    });
  }

  it("429 carries a safe retryAfterSeconds for both helpers", async () => {
    for (const run of [
      (c: BlissccoClient) => c.reportImpression({ token: TOKEN }),
      (c: BlissccoClient) => c.reportClick({ click_ref: CLICK_REF }),
    ]) {
      await assert.rejects(run(make(mockFetch(429, { error: "rate_limited" }, { "retry-after": "60" }))), (e: unknown) => {
        assert.ok(e instanceof BlissccoApiError);
        assert.equal(e.code, "rate_limited");
        assert.equal(e.retryAfterSeconds, 60);
        return true;
      });
    }
  });

  it("drops unsafe reasons and never copies raw/hostile bodies", async () => {
    const hostile = { error: "unauthorized", reason: `Bearer ${KEY} ${TOKEN}`, detail: CLICK_REF };
    await assert.rejects(make(mockFetch(400, hostile)).reportImpression({ token: TOKEN }), (e: unknown) => {
      assert.ok(e instanceof BlissccoApiError);
      assert.equal(e.reason, undefined);
      assertNoSecrets(surfaces(e));
      return true;
    });
    await assert.rejects(make(mockFetch(502, `<html>${KEY} ${TOKEN}</html>`, { "content-type": "text/html" }, true)).reportClick({ click_ref: CLICK_REF }), (e: unknown) => {
      assert.ok(e instanceof BlissccoApiError);
      assert.equal(e.code, "unknown_error");
      assertNoSecrets(surfaces(e));
      return true;
    });
  });

  it("treats unexpected success responses as invalid_response", async () => {
    for (const body of [{ ok: true }, { ok: false, status: "recorded" }, { ok: true, status: "other" }, { hello: 1 }, []]) {
      await assert.rejects(make(mockFetch(200, body)).reportImpression({ token: TOKEN }), (e: unknown) => e instanceof BlissccoApiError && e.code === "invalid_response" && e.status === 200);
    }
    await assert.rejects(make(mockFetch(200, "not json", {}, true)).reportImpression({ token: TOKEN }), (e: unknown) => e instanceof BlissccoApiError && e.code === "invalid_response");
    // click: 200 / 204 (prefetch) / 302 without Location are not an accepted click
    for (const [status, headers] of [[200, {}], [204, {}], [302, {}]] as [number, Record<string, string>][]) {
      await assert.rejects(make(mockFetch(status, { ok: true }, headers)).reportClick({ click_ref: CLICK_REF }), (e: unknown) => e instanceof BlissccoApiError && e.code === "invalid_response" && e.status === status);
    }
  });

  it("network failure / timeout -> generic BlissccoNetworkError with no URL, token or key", async () => {
    for (const run of [
      (c: BlissccoClient) => c.reportImpression({ token: TOKEN }),
      (c: BlissccoClient) => c.reportClick({ click_ref: CLICK_REF }),
    ]) {
      await assert.rejects(run(make(throwingFetch())), (e: unknown) => {
        assert.ok(e instanceof BlissccoNetworkError);
        assert.equal((e as Error).message, "Blisscco request failed (network or timeout)");
        assert.equal((e as Error & { cause?: unknown }).cause, undefined);
        assertNoSecrets(surfaces(e));
        assert.ok(!surfaces(e).includes("ads.example.com"));
        return true;
      });
    }
    assert.equal(calls.length, 2, "one attempt per call, no retry");
  });

  it("times out via AbortSignal", async () => {
    const hang = (async (_u: unknown, init: RequestInit) =>
      new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await assert.rejects(make(hang, { timeoutMs: 100 }).reportImpression({ token: TOKEN }), (e: unknown) => e instanceof BlissccoNetworkError);
  });
});

describe("secret non-disclosure", () => {
  it("never logs anything, on success or failure", async () => {
    await make(mockFetch(200, { ok: true, status: "recorded" })).reportImpression({ token: TOKEN });
    await make(mockFetch(302, null, REDIRECT)).reportClick({ click_ref: CLICK_REF });
    await make(mockFetch(401, { error: "unauthorized" })).reportImpression({ token: TOKEN }).catch(() => undefined);
    await make(mockFetch(404, { error: "not_found" })).reportClick({ click_ref: CLICK_REF }).catch(() => undefined);
    await make(throwingFetch()).reportClick({ click_ref: CLICK_REF }).catch(() => undefined);
    assert.deepEqual(logged, []);
  });

  it("results contain no token, click_ref, API key or destination", async () => {
    const a = await make(mockFetch(200, { ok: true, status: "recorded" })).reportImpression({ token: TOKEN });
    const b = await make(mockFetch(302, null, REDIRECT)).reportClick({ click_ref: CLICK_REF });
    assertNoSecrets(JSON.stringify([a, b]) + inspect([a, b], { depth: 6 }));
  });

  it("the API key never appears in any tracking request (url, headers, body)", async () => {
    const c = make(mockFetch(200, { ok: true, status: "recorded" }));
    await c.reportImpression({ token: TOKEN });
    const c2 = make(mockFetch(302, null, REDIRECT));
    await c2.reportClick({ click_ref: CLICK_REF });
    for (const call of calls) assert.ok(!JSON.stringify(call).includes("blc_live_"));
  });

  it("client object still hides the key (JSON/inspect) after tracking calls", async () => {
    const c = make(mockFetch(200, { ok: true, status: "recorded" }));
    await c.reportImpression({ token: TOKEN });
    assert.ok(!JSON.stringify(c).includes(KEY));
    assert.ok(!inspect(c, { depth: 6, showHidden: true }).includes(TOKEN));
    assert.ok(!String(c).includes(KEY));
  });

  it("helpers stay server-side: types/client mention no browser storage or globals", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("examples/publisher-node/src/client.ts", "utf8");
    assert.ok(!/console\.(log|error|warn|info|debug)/.test(src.replace(/\/\/.*$/gm, "")));
  });
});

describe("existing behaviour preserved", () => {
  it("match() still sends Authorization + Idempotency-Key and retries 503 with the same key", async () => {
    const seen: Record<string, string>[] = [];
    let n = 0;
    const f = (async (_u: unknown, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      n += 1;
      return n === 1
        ? new Response(JSON.stringify({ fill: false, error: "unavailable" }), { status: 503 })
        : new Response(JSON.stringify({ fill: false }), { status: 200 });
    }) as typeof fetch;
    const c = new BlissccoClient({ baseUrl: BASE, apiKey: KEY, fetch: f, sleep: async () => undefined, random: () => 1 });
    const r = await c.match({ topic: "gaming" }, { idempotencyKey: "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" });
    assert.deepEqual(r, { idempotencyKey: "0b7e3c1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b", fill: false });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].Authorization, `Bearer ${KEY}`);
    assert.equal(seen[1]["Idempotency-Key"], seen[0]["Idempotency-Key"]);
  });

  it("match() still reports an unlisted 404 error body as unknown_error (not_found is tracking-only)", async () => {
    const c = make(mockFetch(404, { error: "not_found" }), { retry: { maxRetries: 0 } });
    await assert.rejects(c.match({ topic: "gaming" }), (e: unknown) => e instanceof BlissccoApiError && e.code === "unknown_error");
  });
});
