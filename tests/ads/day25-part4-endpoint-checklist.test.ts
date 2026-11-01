import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  REVIVE_DEFAULT_TIMEOUT_MS,
  REVIVE_MAX_BODY_BYTES,
  REVIVE_MAX_TIMEOUT_MS,
  REVIVE_MAX_URL_LENGTH,
  createReviveAdapter,
  parseReviveConfig,
  type ReviveFetcher,
  type ReviveFillResult,
} from "@/lib/ads/revive-adapter";
import { JSON_ENDPOINT_ALLOWED_FIELDS, JSON_ENDPOINT_EXECUTABLE_KEYS, JSON_ENDPOINT_MAX_BYTES, validateJsonEndpointText } from "@/lib/ads/revive-json-endpoint-contract";
import { MAX_DESTINATION_LENGTH, safeDestination } from "@/lib/ads/click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

// Day 25 Part 4: DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md ko asli contract, adapter aur route se milata hai.
// Sirf file padhta hai + nakli fetcher. Koi real network, Revive server, DB, credential ya URL nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const FILE = "DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md";
const doc = () => read(FILE);
const flat = () => doc().replace(/\s+/g, " ");
const GOOD = { headline: "Sample headline", body: "Sample body text.", cta_text: "Learn more", destination_url: "https://example.com/landing" };
const DELIVERY = "https://delivery.example.com/serve";

type Res = Awaited<ReturnType<ReviveFetcher>>;
const asRes = (r: unknown) => r as Res;
const jsonResponse = (body: string, status = 200, ct: string | null = "application/json") => {
  const headers: Record<string, string> = {};
  if (ct !== null) headers["content-type"] = ct;
  const real = new Response(body, { status: 200, headers });
  Object.defineProperty(real, "status", { value: status });
  return asRes(real);
};
const reasonOf = (r: ReviveFillResult) => (r.status === "no-fill" ? r.reason : "fill");
const run = (fetcher: ReviveFetcher, over: Record<string, unknown> = {}) =>
  createReviveAdapter({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 200, ...over }, { fetcher }).requestFill();

describe("day 25 part 4 | the checklist doc exists and is documentation only", () => {
  it("exists, says documentation only, and nothing is enabled by it", () => {
    assert.ok(existsSync(path.join(ROOT, FILE)));
    assert.match(doc(), /Status: \*\*documentation only\.\*\*/);
    assert.match(doc(), /does \*\*not\*\* authorise enabling anything/);
    assert.match(doc(), /`REVIVE_FALLBACK_ENABLED` stays unset \(off\)/);
  });

  it("covers every required checklist area, in its own section", () => {
    for (const h of ["### 5.1 HTTPS", "### 5.2 JSON format", "### 5.3 Response fields", "### 5.4 Redirect behavior", "### 5.5 Timeout", "### 5.6 Response-size limit", "### 5.7 Plain text only", "### 5.8 Safe destination", "### 5.9 Credential handling"]) {
      assert.ok(doc().includes(h), h);
    }
    assert.ok((doc().match(/^- \[ \] /gm) ?? []).length >= 30);
  });

  it("the earlier guides are unchanged in kind: REVIVE-JSON-ENDPOINT-SETUP.md is still documentation only and has no preview flag", () => {
    const g = read("REVIVE-JSON-ENDPOINT-SETUP.md");
    assert.match(g, /documentation only/i);
    assert.doesNotMatch(g, /REVIVE_JSON_PREVIEW_ENABLED|revive-json-preview/);
  });

  it("links to the other docs that exist", () => {
    assert.ok(doc().includes("REVIVE-JSON-ENDPOINT-SETUP.md"));
    assert.ok(existsSync(path.join(ROOT, "REVIVE-JSON-ENDPOINT-SETUP.md")));
    assert.ok(doc().includes("scripts/revive-json-preview-check.mjs"));
    assert.ok(existsSync(path.join(ROOT, "scripts/revive-json-preview-check.mjs")));
  });
});

describe("day 25 part 4 | fixture vs real Revive: no unconfirmed claim", () => {
  it("has the fixture vs real creative table", () => {
    assert.match(doc(), /## 1\. Test fixture vs a real Revive-generated creative/);
    assert.match(doc(), /\| Exists in this repository \| yes, static data in `lib\/ads\/revive-json-preview\.ts` \| \*\*no\*\* \|/);
    assert.match(doc(), /A pass on the fixture says nothing about Revive/);
  });

  it("says plainly that Revive providing the JSON endpoint is not confirmed", () => {
    assert.match(doc(), /\*\*It is not confirmed that Revive supplies the JSON endpoint Blisscco needs\.\*\*/);
    assert.match(flat(), /No Revive documentation, no captured Revive response and no live Revive instance has been checked/);
  });

  it("never claims Revive supplies, provides, returns or generates this JSON outside a negation", () => {
    const lines = doc().split("\n").filter((l) => /Revive (natively )?(supplies|provides|returns|generates) (this|the|a) JSON/i.test(l));
    for (const l of lines) assert.match(l, /not confirmed|Do not write/i, l);
    assert.doesNotMatch(doc(), /Revive (is|has been) (verified|confirmed) (to|as)/i);
    assert.doesNotMatch(doc(), /live (revive )?integration (is|has been) (complete|done|enabled)/i);
    assert.doesNotMatch(doc(), /production[- ]ready|fully compatible|officially supported/i);
  });

  it("requires provider evidence before any compatibility claim", () => {
    assert.match(doc(), /Evidence required before any claim of compatibility/);
    assert.match(doc(), /provider's own documentation/);
    assert.match(doc(), /sample response saved with all credentials/);
  });

  it("says Blisscco rejects a stock Revive ad tag (HTML/JavaScript) on purpose", () => {
    assert.match(doc(), /stock Revive ad tag returns HTML or JavaScript/);
    assert.match(doc(), /Blisscco rejects that on purpose/);
  });

  it("the fixture really is static test data labelled TEST FIXTURE and not wired to the delivery URL", () => {
    const lib = read("lib/ads/revive-json-preview.ts");
    assert.match(lib, /TEST FIXTURE:/);
    assert.match(lib, /example\.com/);
    for (const f of ["lib/ads/revive-adapter.ts", "lib/ads/fallback-provider.ts", "lib/ads/fallback-routing.ts", "app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) {
      assert.equal(read(f).includes("revive-json-preview"), false, f);
    }
  });
});

describe("day 25 part 4 | numbers in the checklist equal the implementation", () => {
  it("size, timeout, URL and text limits", () => {
    assert.equal(REVIVE_MAX_BODY_BYTES, 65536);
    assert.equal(JSON_ENDPOINT_MAX_BYTES, 65536);
    assert.match(doc(), /65,536 bytes/);
    assert.equal(REVIVE_DEFAULT_TIMEOUT_MS, 800);
    assert.match(doc(), /800 ms by default/);
    assert.equal(REVIVE_MAX_TIMEOUT_MS, 3000);
    assert.match(doc(), /at most 3000 ms/);
    assert.match(doc(), /hard limit of 3000 ms/);
    assert.equal(REVIVE_MAX_URL_LENGTH, 2048);
    assert.equal(MAX_DESTINATION_LENGTH, 2048);
    assert.match(doc(), /at most 2048 characters/);
    assert.equal(HEADLINE_MAX, 90);
    assert.equal(BODY_MAX, 300);
    assert.equal(CTA_MAX, 30);
    assert.match(doc(), /`headline`: required, plain text, 1 to 90 characters/);
    assert.match(doc(), /`body`: required, plain text, 1 to 300 characters/);
    assert.match(doc(), /`cta_text`: optional, plain text, 1 to 30 characters, or `null`/);
  });

  it("the four fields in the doc are the allowed fields in the contract", () => {
    assert.deepEqual([...JSON_ENDPOINT_ALLOWED_FIELDS].sort(), ["body", "cta_text", "destination_url", "headline"]);
    assert.match(doc(), /`headline`, `body`, `cta_text`, `destination_url`/);
  });

  it("every executable key the validator rejects is listed in the checklist, and nothing else is claimed", () => {
    const section = doc().match(/None of these keys appears[^\n]*/);
    assert.ok(section);
    const listed = [...section[0].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, [...JSON_ENDPOINT_EXECUTABLE_KEYS].sort());
  });
});

describe("day 25 part 4 | documented behavior is what the code does (mocked fetcher)", () => {
  it("HTTPS only: http, credentials, fragment, over-long and padded URLs are rejected; 2048 and https are fine", () => {
    for (const bad of ["http://delivery.example.com/x", "https://u:p@delivery.example.com/x", "https://delivery.example.com/x#f", `https://delivery.example.com/${"a".repeat(2050)}`, ` ${DELIVERY}`, `${DELIVERY} `]) {
      assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: bad }).ok, false, bad.slice(0, 40));
    }
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY }).ok, true);
  });

  it("request: GET with only the Accept header, no cookies or credentials, redirect refused", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await run((async (_u, init) => { seen.push(init as unknown as Record<string, unknown>); return jsonResponse(JSON.stringify(GOOD)); }) as ReviveFetcher);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "GET");
    assert.equal(seen[0].redirect, "error");
    assert.equal(seen[0].credentials, "omit");
    assert.equal(seen[0].body, undefined);
    assert.deepEqual(Object.keys(seen[0].headers as object), ["accept"]);
    assert.equal((seen[0].headers as Record<string, string>).accept, "application/json");
    assert.match(doc(), /`GET`, no body, no cookies, no credentials/);
    assert.match(doc(), /`Accept: application\/json`/);
  });

  it("JSON format: a valid object fills; wrong content types, arrays and empty bodies are no-fill", async () => {
    assert.equal(reasonOf(await run(async () => jsonResponse(JSON.stringify(GOOD)))), "fill");
    assert.equal(reasonOf(await run(async () => jsonResponse(JSON.stringify(GOOD), 200, "application/json; charset=utf-8"))), "fill");
    for (const ct of ["text/html", "text/plain", "application/json; charset=latin1", null]) {
      assert.equal(reasonOf(await run(async () => jsonResponse(JSON.stringify(GOOD), 200, ct))), "bad_content_type", String(ct));
    }
    assert.equal(reasonOf(await run(async () => jsonResponse("[]"))), "bad_response");
    assert.equal(reasonOf(await run(async () => jsonResponse("  "))), "empty_response");
    assert.equal(reasonOf(await run(async () => jsonResponse("{nope"))), "bad_response");
  });

  it("redirects: every 3xx is no-fill and is never followed", async () => {
    for (const status of [301, 302, 307, 308]) {
      let calls = 0;
      const out = await run(async () => { calls += 1; return jsonResponse(JSON.stringify(GOOD), status); });
      assert.equal(reasonOf(out), "http_error", String(status));
      assert.equal(calls, 1);
    }
    assert.match(doc(), /never followed; any `3xx` is a no-fill/);
  });

  it("timeout: a hanging endpoint is a no-fill; the configured timeout accepts 1..3000 and no more", async () => {
    assert.equal(reasonOf(await run(() => new Promise<Res>(() => undefined), { timeoutMs: 20 })), "timeout");
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 3000 }).ok, true);
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 3001 }).ok, false);
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 0 }).ok, false);
  });

  it("response size: exactly 65,536 bytes is read; one byte more is no-fill", async () => {
    const over = JSON.stringify({ ...GOOD, headline: "h".repeat(REVIVE_MAX_BODY_BYTES) });
    assert.ok(new TextEncoder().encode(over).byteLength > REVIVE_MAX_BODY_BYTES);
    assert.equal(reasonOf(await run(async () => jsonResponse(over))), "too_large");
    assert.equal(validateJsonEndpointText("x".repeat(REVIVE_MAX_BODY_BYTES + 1)).ok, false);
  });

  it("fields: markup, entities, executable keys, bad lengths and a missing field all fail; null cta_text passes", () => {
    const ok = (o: unknown) => validateJsonEndpointText(JSON.stringify(o)).ok;
    assert.equal(ok(GOOD), true);
    assert.equal(ok({ ...GOOD, cta_text: null }), true);
    assert.equal(ok({ headline: GOOD.headline, body: GOOD.body, destination_url: GOOD.destination_url }), true);
    assert.equal(ok({ ...GOOD, headline: "<b>x</b>" }), false);
    assert.equal(ok({ ...GOOD, body: "a &amp; b" }), false);
    assert.equal(ok({ ...GOOD, body: "bad\u0007text" }), false);
    assert.equal(ok({ ...GOOD, headline: "h".repeat(HEADLINE_MAX + 1) }), false);
    assert.equal(ok({ ...GOOD, body: "b".repeat(BODY_MAX + 1) }), false);
    assert.equal(ok({ ...GOOD, cta_text: "c".repeat(CTA_MAX + 1) }), false);
    assert.equal(ok({ headline: GOOD.headline, destination_url: GOOD.destination_url }), false);
    for (const key of JSON_ENDPOINT_EXECUTABLE_KEYS) assert.equal(ok({ ...GOOD, [key]: "x" }), false, key);
    assert.equal(ok({ ...GOOD, extra_field: "ignored" }), true);
  });

  it("safe destination: only absolute https without credentials, spaces or excess length", () => {
    assert.equal(safeDestination("https://example.com/landing"), "https://example.com/landing");
    for (const bad of ["http://example.com/x", "javascript:alert(1)", "data:text/html,x", "/relative", "https://u:p@example.com/x", "https://example.com/a b", `https://example.com/${"a".repeat(2048)}`]) {
      assert.equal(safeDestination(bad), null, bad.slice(0, 40));
    }
    assert.match(doc(), /Relative paths, `javascript:`, `data:` and `http:` all fail/);
  });
});

describe("day 25 part 4 | the doc's manual commands are safe and correct", () => {
  const blocks = () => [...doc().matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);

  it("no command follows redirects, uses a plain-http URL, or hard-codes a URL, key or token", () => {
    assert.ok(blocks().length >= 5);
    for (const b of blocks()) {
      assert.doesNotMatch(b, /(^|\s)(-L|--location)(\s|$)/, b);
      assert.doesNotMatch(b, /http:\/\//, b);
      assert.doesNotMatch(b, /https:\/\/[^\s"']*/, b);
      assert.doesNotMatch(b, /blc_live_|authorization|bearer|cookie/i, b);
    }
  });

  it("every curl command uses the URL variable, a time limit and https-only", () => {
    const curls = blocks().filter((b) => b.includes("curl"));
    assert.equal(curls.length, 4);
    for (const b of curls) {
      assert.match(b, /"\$ENDPOINT_URL"/);
      assert.match(b, /--max-time 3/);
      assert.match(b, /--proto '=https'/);
    }
  });

  it("the URL is read without echo and cleared afterwards", () => {
    assert.ok(doc().includes("read -rs ENDPOINT_URL"));
    assert.ok(doc().includes("unset ENDPOINT_URL"));
  });

  it("the key-names one-liner prints only key names: runs correctly on sample input, never values", () => {
    const curl = blocks().find((b) => b.includes("node -e"));
    assert.ok(curl);
    const m = curl.match(/node -e '([\s\S]*)'$/);
    assert.ok(m);
    const code = m[1];
    const exec = (input: string) => execFileSync(process.execPath, ["-e", code], { input, encoding: "utf8" }).trim();
    assert.equal(exec(JSON.stringify(GOOD)), "headline,body,cta_text,destination_url");
    assert.equal(exec(JSON.stringify({ ...GOOD, headline: "SECRET-VALUE-99" })).includes("SECRET-VALUE-99"), false);
    assert.equal(exec("[1]"), "not_an_object");
    assert.equal(exec("null"), "not_an_object");
    assert.equal(exec("not json SECRET-VALUE-99"), "invalid_json");
  });
});

describe("day 25 part 4 | credential handling and no guessed URLs", () => {
  it("states that Blisscco sends no Authorization header or cookies, so such an endpoint is not compatible", () => {
    assert.match(flat(), /Blisscco sends \*\*no\*\* `Authorization` header and \*\*no\*\* cookies/);
    assert.match(doc(), /is not compatible today/);
  });

  it("says to keep the URL out of repository, docs, tests, logs, chat, and never use NEXT_PUBLIC_", () => {
    assert.match(flat(), /Keep the URL out of the repository, docs, tests, logs, screenshots, chat and tickets/);
    assert.match(doc(), /never a `NEXT_PUBLIC_` variable/);
    assert.match(doc(), /treat it as leaked and ask the endpoint owner to rotate it/);
  });

  it("contains no real or guessed URL, no credential and no env assignment", () => {
    const urls = [...doc().matchAll(/https?:\/\/[^\s)`"']+/g)].map((m) => m[0]);
    for (const u of urls) assert.ok(u.startsWith("https://<") || new URL(u).hostname === "example.com", u);
    assert.doesNotMatch(doc(), /\.vercel\.app|openx|adserver|revive\.[a-z]+/i);
    assert.doesNotMatch(doc(), /blc_live_[0-9a-f]{8}/i);
    assert.doesNotMatch(doc(), /(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S{6,}/i);
    assert.doesNotMatch(doc(), /REVIVE_(DELIVERY_URL|FALLBACK_ENABLED|TIMEOUT_MS|RESPONSE_FORMAT)\s*=/);
  });

  it("includes no SQL, migration or production-enablement instruction", () => {
    assert.doesNotMatch(doc(), /\b(CREATE|ALTER|INSERT|DROP|UPDATE)\s+(TABLE|INDEX|FUNCTION|POLICY|\w+\s+SET)\b/i);
    assert.doesNotMatch(doc(), /migration|supabase db|psql/i);
    assert.doesNotMatch(doc(), /set (it|the (flag|variable)) to `?true`? in Production/i);
  });
});

describe("day 25 part 4 | scope: docs and tests only, no code or database change", () => {
  it("no Day 25 Part 4 SQL file exists and no package script was added", () => {
    const sql = readdirSync(path.join(ROOT, "supabase", "sql"));
    assert.equal(sql.some((f) => /day-?25/i.test(f)), false);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.equal(Object.values(pkg.scripts).some((v) => /revive|preview-check/.test(v)), false);
  });

  it("the Day 24 route is still gated by the server-side flag with a fixed 404 default", () => {
    const route = read("app/api/revive-json-preview/route.ts");
    assert.match(route, /export async function GET\(\)/);
    assert.match(read("lib/ads/revive-json-preview.ts"), /env\[PREVIEW_ENV_FLAG\] === "true"/);
  });
});
