// Day 26 Part 1: TEST-ONLY harness for the existing Revive adapter + fallback flow.
//
// What it is: a deterministic, in-memory stand-in for a Revive JSON endpoint. It answers with the Day 25 JSON contract
// ({ headline, body, cta_text, destination_url }) or with one of 6 failure shapes. Nothing here is a real ad or a real advertiser.
//
// Rules (enforced by tests/ads/day26-part1-provider-harness.test.ts):
//   1. No HTTP server, no socket, no external network. Every answer is a locally built Response.
//   2. Never reads environment variables or credentials. The only "env" is the frozen constant below, built right here.
//   3. Only HARNESS_DELIVERY_URL (a reserved, never-resolving ".invalid" host) is answered; any other URL is refused.
//   4. Never imported by production code, never sets a flag, never touches process-level state on its own.
//      Installing it as globalThis.fetch is an explicit, reversible call a test has to make.
import type { ReviveFetcher, ReviveFetchResponse } from "@/lib/ads/revive-adapter";

export const HARNESS_SCENARIOS = [
  "valid-fill",
  "no-fill",
  "timeout",
  "malformed-json",
  "unsafe-destination",
  "oversized-body",
  "provider-failure",
] as const;

export type HarnessScenario = (typeof HARNESS_SCENARIOS)[number];

/** ".invalid" is reserved (RFC 2606): it can never resolve, so even a leak could not reach a real host. */
export const HARNESS_DELIVERY_URL = "https://day26-harness.invalid/test-only/ad.json";
export const HARNESS_TIMEOUT_MS = 25;

/** Fixed, clearly fake creative that satisfies the Day 25 JSON contract. */
export const HARNESS_CREATIVE = Object.freeze({
  headline: "DAY26 TEST ONLY headline",
  body: "DAY26 TEST ONLY body. Not a real ad and not a real advertiser.",
  cta_text: "TEST ONLY",
  destination_url: "https://example.com/day26-test-only",
});

/** Appears only inside the provider-failure body. Tests prove it never reaches a result, a public response or a log. */
export const HARNESS_ERROR_MARKER = "DAY26-HARNESS-PROVIDER-ERROR-BODY";
export const HARNESS_UNSAFE_DESTINATION = "http://example.com/day26-test-only-insecure";

/** Config for createReviveAdapter(...). A plain constant, not read from anywhere. */
export const HARNESS_ADAPTER_CONFIG = Object.freeze({
  enabled: true,
  deliveryUrl: HARNESS_DELIVERY_URL,
  timeoutMs: HARNESS_TIMEOUT_MS,
  responseFormat: "json" as const,
});

/** Env-shaped record for providerFallbackFromEnv(env, deps). Built here, NOT read from process.env. */
export const HARNESS_FALLBACK_ENV: Readonly<Record<string, string | undefined>> = Object.freeze({
  REVIVE_FALLBACK_ENABLED: "true",
  REVIVE_DELIVERY_URL: HARNESS_DELIVERY_URL,
  REVIVE_TIMEOUT_MS: String(HARNESS_TIMEOUT_MS),
});

/** What the existing adapter is expected to do for each scenario. */
export const HARNESS_EXPECTED: Readonly<Record<HarnessScenario, Readonly<{ status: "fill" | "no-fill"; reason?: string }>>> = Object.freeze({
  "valid-fill": { status: "fill" },
  "no-fill": { status: "no-fill", reason: "empty_response" },
  timeout: { status: "no-fill", reason: "timeout" },
  "malformed-json": { status: "no-fill", reason: "bad_response" },
  "unsafe-destination": { status: "no-fill", reason: "bad_response" },
  "oversized-body": { status: "no-fill", reason: "too_large" },
  "provider-failure": { status: "no-fill", reason: "http_error" },
});

export type HarnessCall = Readonly<{
  method: string;
  redirect: string;
  credentials: string;
  cache: string;
  headerNames: readonly string[];
  accept: string | null;
}>;

export type ProviderHarness = {
  readonly scenario: HarnessScenario;
  /** For createReviveAdapter(..., { fetcher }) and providerFallbackFromEnv(env, { fetcher }). */
  readonly fetcher: ReviveFetcher;
  /** fetch-compatible, for tests that go through the production route (which uses globalThis.fetch). */
  readonly fetch: typeof fetch;
  /** One entry per request for HARNESS_DELIVERY_URL. Never stores a URL or a body. */
  readonly calls: HarnessCall[];
  /** Requests for any other URL. They are refused with a fixed error. */
  unexpectedCalls: number;
  /** True once the adapter aborted the request signal (timeout / reject paths). */
  abortObserved: boolean;
  /** Explicit opt-in for route-level tests: replaces globalThis.fetch and returns a restore function. */
  installAsGlobalFetch(): () => void;
};

const enc = new TextEncoder();
const jsonHeaders = { "content-type": "application/json" };

function bodyFor(scenario: HarnessScenario): { status: number; headers: Record<string, string>; body: string } | "hang" {
  switch (scenario) {
    case "valid-fill":
      return { status: 200, headers: jsonHeaders, body: JSON.stringify(HARNESS_CREATIVE) };
    case "no-fill":
      return { status: 200, headers: jsonHeaders, body: "" };
    case "timeout":
      return "hang";
    case "malformed-json":
      return { status: 200, headers: jsonHeaders, body: '{"headline": "DAY26 TEST ONLY", "body": ' };
    case "unsafe-destination":
      return { status: 200, headers: jsonHeaders, body: JSON.stringify({ ...HARNESS_CREATIVE, destination_url: HARNESS_UNSAFE_DESTINATION }) };
    case "oversized-body": {
      // Valid JSON shape, but > 65,536 UTF-8 bytes: the adapter must cut it off.
      const big = JSON.stringify({ ...HARNESS_CREATIVE, body: "X".repeat(70000) });
      return { status: 200, headers: jsonHeaders, body: big };
    }
    case "provider-failure":
      return { status: 500, headers: { "content-type": "text/plain" }, body: `${HARNESS_ERROR_MARKER} internal error` };
  }
}

export function createProviderHarness(scenario: HarnessScenario): ProviderHarness {
  const calls: HarnessCall[] = [];

  async function respond(url: string, init: { method?: string; redirect?: string; credentials?: string; cache?: string; headers?: unknown; signal?: AbortSignal | null } | undefined): Promise<Response> {
    if (url !== HARNESS_DELIVERY_URL) {
      harness.unexpectedCalls += 1;
      throw new Error("day26 harness: only the test-only delivery URL is served");
    }
    const headerObj = (init?.headers ?? {}) as Record<string, string>;
    calls.push(
      Object.freeze({
        method: String(init?.method ?? ""),
        redirect: String(init?.redirect ?? ""),
        credentials: String(init?.credentials ?? ""),
        cache: String(init?.cache ?? ""),
        headerNames: Object.freeze(Object.keys(headerObj).map((k) => k.toLowerCase())),
        accept: headerObj.accept ?? null,
      }),
    );
    const plan = bodyFor(scenario);
    if (plan === "hang") {
      const signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          harness.abortObserved = true;
          reject(new Error("day26 harness: aborted"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    // Streamed bytes (like a real network body) so the adapter's bounded reader is exercised.
    const bytes = enc.encode(plan.body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.byteLength > 0) controller.enqueue(bytes);
        controller.close();
      },
    });
    return new Response(stream, { status: plan.status, headers: plan.headers });
  }

  const fetcher = (async (url, init) => (await respond(url, init)) as unknown as ReviveFetchResponse) as ReviveFetcher;

  const harnessFetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as { url?: unknown } | null)?.url ?? "");
    return respond(url, init);
  }) as typeof fetch;

  const harness: ProviderHarness = {
    scenario,
    fetcher,
    fetch: harnessFetch,
    calls,
    unexpectedCalls: 0,
    abortObserved: false,
    installAsGlobalFetch() {
      const previous = globalThis.fetch;
      globalThis.fetch = harnessFetch;
      return () => {
        globalThis.fetch = previous;
      };
    },
  };
  return harness;
}
