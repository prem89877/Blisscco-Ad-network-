// Day 27 Part 4: DAY27-REAL-REVIVE-VERIFICATION.md ko asli adapter, contract aur preview route se milata hai.
// Sirf file padhta hai + nakli fetcher. Koi real network, Revive server, DB, credential ya URL nahi. Koi flag chalu nahi hota.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  REVIVE_DEFAULT_TIMEOUT_MS,
  REVIVE_ENV_FLAG,
  REVIVE_ENV_FORMAT,
  REVIVE_ENV_TIMEOUT,
  REVIVE_ENV_URL,
  REVIVE_MAX_BODY_BYTES,
  REVIVE_MAX_TIMEOUT_MS,
  REVIVE_MAX_URL_LENGTH,
  createReviveAdapter,
  parseReviveConfig,
  type ReviveFetcher,
  type ReviveFillResult,
} from "@/lib/ads/revive-adapter";
import { JSON_ENDPOINT_ALLOWED_FIELDS, JSON_ENDPOINT_EXECUTABLE_KEYS, JSON_ENDPOINT_MAX_BYTES, validateJsonEndpointText } from "@/lib/ads/revive-json-endpoint-contract";
import { PREVIEW_ENV_FLAG, handlePreviewGet } from "@/lib/ads/revive-json-preview";
import { buildProviderAdResponse } from "@/lib/ads/contract";
import { MAX_DESTINATION_LENGTH, safeDestination } from "@/lib/ads/click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const FILE = "DAY27-REAL-REVIVE-VERIFICATION.md";
const doc = () => read(FILE);
const flat = () => doc().replace(/\s+/g, " ");
const GOOD = { headline: "Sample headline", body: "Sample body text.", cta_text: "Learn more", destination_url: "https://example.com/landing" };
const DELIVERY = "https://delivery.example.com/serve";

type Res = Awaited<ReturnType<ReviveFetcher>>;
const jsonResponse = (body: string, status = 200, ct: string | null = "application/json") => {
  const headers: Record<string, string> = {};
  if (ct !== null) headers["content-type"] = ct;
  const real = new Response(body, { status: 200, headers });
  Object.defineProperty(real, "status", { value: status });
  return real as unknown as Res;
};
const reasonOf = (r: ReviveFillResult) => (r.status === "no-fill" ? r.reason : "fill");
const run = (fetcher: ReviveFetcher, over: Record<string, unknown> = {}) =>
  createReviveAdapter({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 200, ...over }, { fetcher }).requestFill();

describe("day 27 part 4 | the guide exists, is documentation only and claims no live Revive integration", () => {
  it("exists and says documentation only, nothing enabled, flag stays off", () => {
    assert.ok(existsSync(path.join(ROOT, FILE)));
    assert.match(doc(), /Status: \*\*documentation only\.\*\*/);
    assert.match(doc(), /does \*\*not\*\* authorise enabling anything/);
    assert.match(doc(), /`REVIVE_FALLBACK_ENABLED` stays unset \(off\)/);
    assert.match(flat(), /It does not claim a live Revive integration\. None exists\./);
  });

  it("never claims a live, verified, complete, supported or production-ready Revive integration", () => {
    assert.doesNotMatch(doc(), /Revive (is|has been) (verified|confirmed) (to|as)/i);
    assert.doesNotMatch(doc(), /live (revive )?integration (is|has been|was) (complete|done|enabled|verified)/i);
    assert.doesNotMatch(doc(), /production[- ]ready|fully compatible|officially supported|natively supported/i);
    assert.doesNotMatch(doc(), /(verified|confirmed|tested) (against|with) (a )?(real|live) revive/i);
  });

  it("says plainly that a native Revive JSON endpoint is not confirmed, and every positive claim line is a negation or rule", () => {
    assert.match(doc(), /\*\*It is not confirmed that Revive supplies the JSON endpoint Blisscco needs\.\*\*/);
    assert.match(flat(), /No Revive documentation, no captured Revive response and no live Revive instance has been checked in this repository/);
    const lines = doc().split("\n").filter((l) => /Revive (natively )?(supplies|provides|returns|generates) (this|the|a) JSON/i.test(l));
    for (const l of lines) assert.match(l, /not confirmed|Do not write/i, l);
    assert.match(doc(), /Do not write "Revive provides a JSON endpoint"/);
  });

  it("requires provider evidence before any compatibility claim and warns against writing an adapter first", () => {
    assert.match(doc(), /Evidence required before any claim of compatibility/);
    assert.match(doc(), /provider's own documentation/);
    assert.match(doc(), /sample response saved with all credentials/);
    assert.match(flat(), /Blisscco has no adapter for Revive's native output, and none should be written before it has been verified/);
  });

  it("links only to docs and a script that exist", () => {
    for (const f of ["REVIVE-JSON-ENDPOINT-SETUP.md", "DAY24-JSON-PREVIEW-SETUP.md", "DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md", "scripts/revive-json-preview-check.mjs"]) {
      assert.ok(doc().includes(f), f);
      assert.ok(existsSync(path.join(ROOT, f)), f);
    }
  });

  it("the earlier guides are still documentation only and say Revive support is unconfirmed", () => {
    assert.match(read("REVIVE-JSON-ENDPOINT-SETUP.md"), /does not verify that Revive natively provides this JSON endpoint/);
    assert.match(read("DAY25-REVIVE-ENDPOINT-COMPATIBILITY.md"), /Status: \*\*documentation only\.\*\*/);
  });
});

describe("day 27 part 4 | every required check area is present in the gate table", () => {
  const rows = () => doc().split("\n").filter((l) => /^\| [1-8] \|/.test(l));

  it("has the eight gate rows: HTTPS, JSON fields, size, content type, redirect, timeout, destination, attribution", () => {
    assert.equal(rows().length, 8);
    const names = rows().map((r) => r.split("|")[2].trim());
    assert.deepEqual(names, ["HTTPS", "JSON response fields", "Response size", "Content type", "Redirect rejection", "Timeout", "Safe destination", "Provider attribution"]);
  });

  it("has a detail section for each area", () => {
    for (const h of ["### 1.1 HTTPS", "### 1.2 JSON response fields", "### 1.3 Response size", "### 1.4 Content type", "### 1.5 Redirect rejection", "### 1.6 Timeout", "### 1.7 Safe destination", "### 1.8 Provider attribution"]) {
      assert.ok(doc().includes(h), h);
    }
  });
});

describe("day 27 part 4 | numbers in the guide equal the implementation", () => {
  it("size, timeout, URL and text limits", () => {
    assert.equal(REVIVE_MAX_BODY_BYTES, 65536);
    assert.equal(JSON_ENDPOINT_MAX_BYTES, 65536);
    assert.match(doc(), /65,536 bytes/);
    assert.equal(REVIVE_DEFAULT_TIMEOUT_MS, 800);
    assert.match(doc(), /800 ms by default/);
    assert.equal(REVIVE_MAX_TIMEOUT_MS, 3000);
    assert.match(doc(), /at most 3000 ms/);
    assert.equal(REVIVE_MAX_URL_LENGTH, 2048);
    assert.equal(MAX_DESTINATION_LENGTH, 2048);
    assert.match(doc(), /at most 2048 characters/);
    assert.equal(HEADLINE_MAX, 90);
    assert.equal(BODY_MAX, 300);
    assert.equal(CTA_MAX, 30);
    assert.match(doc(), /`headline` \(1 to 90 characters\), `body` \(1 to 300\), `cta_text` \(1 to 30 or `null`\)/);
  });

  it("the four fields and every executable key in the guide equal the contract", () => {
    assert.deepEqual([...JSON_ENDPOINT_ALLOWED_FIELDS].sort(), ["body", "cta_text", "destination_url", "headline"]);
    assert.match(doc(), /Read: `headline`, `body`, `cta_text`, `destination_url`/);
    const line = doc().match(/Any of these keys rejects the whole creative:[^\n]*/);
    assert.ok(line);
    const listed = [...line[0].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, [...JSON_ENDPOINT_EXECUTABLE_KEYS].sort());
  });

  it("environment variable names in the guide are the ones the adapter reads", () => {
    assert.equal(REVIVE_ENV_FLAG, "REVIVE_FALLBACK_ENABLED");
    assert.equal(REVIVE_ENV_URL, "REVIVE_DELIVERY_URL");
    assert.equal(REVIVE_ENV_TIMEOUT, "REVIVE_TIMEOUT_MS");
    assert.equal(REVIVE_ENV_FORMAT, "REVIVE_RESPONSE_FORMAT");
    for (const n of [REVIVE_ENV_FLAG, REVIVE_ENV_URL, REVIVE_ENV_TIMEOUT, REVIVE_ENV_FORMAT]) assert.ok(doc().includes(`\`${n}\``), n);
    assert.match(doc(), /\| `REVIVE_FALLBACK_ENABLED` \| exactly `true` \|/);
  });
});

describe("day 27 part 4 | documented behavior is what the code does (mocked fetcher, no network)", () => {
  it("HTTPS: http, credentials, fragment, over-long and padded URLs are rejected", () => {
    for (const bad of ["http://delivery.example.com/x", "https://u:p@delivery.example.com/x", "https://delivery.example.com/x#f", `https://delivery.example.com/${"a".repeat(2050)}`, ` ${DELIVERY}`, `${DELIVERY} `]) {
      assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: bad }).ok, false, bad.slice(0, 40));
    }
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY }).ok, true);
  });

  it("request shape: GET, only the Accept header, no cookies or credentials, redirect refused", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await run((async (_u, init) => { seen.push(init as unknown as Record<string, unknown>); return jsonResponse(JSON.stringify(GOOD)); }) as ReviveFetcher);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "GET");
    assert.equal(seen[0].redirect, "error");
    assert.equal(seen[0].credentials, "omit");
    assert.deepEqual(Object.keys(seen[0].headers as object), ["accept"]);
    assert.match(doc(), /`GET` and only `Accept: application\/json`/);
    assert.match(doc(), /Blisscco sends \*\*no\*\* `Authorization` header and \*\*no\*\* cookies/);
  });

  it("content type: JSON fills; html, plain text, latin1 and a missing header are no-fill", async () => {
    assert.equal(reasonOf(await run(async () => jsonResponse(JSON.stringify(GOOD)))), "fill");
    assert.equal(reasonOf(await run(async () => jsonResponse(JSON.stringify(GOOD), 200, "application/json; charset=utf-8"))), "fill");
    for (const ct of ["text/html", "text/plain", "application/json; charset=latin1", null]) {
      assert.equal(reasonOf(await run(async () => jsonResponse(JSON.stringify(GOOD), 200, ct))), "bad_content_type", String(ct));
    }
    assert.equal(reasonOf(await run(async () => jsonResponse("[]"))), "bad_response");
    assert.equal(reasonOf(await run(async () => jsonResponse("  "))), "empty_response");
  });

  it("a stock HTML/JavaScript tag is never turned into an ad", async () => {
    const tag = '<script type="text/javascript" src="https://delivery.example.com/ajs.php?zoneid=1"></script>';
    assert.equal(reasonOf(await run(async () => jsonResponse(tag, 200, "text/html"))), "bad_content_type");
    assert.equal(reasonOf(await run(async () => jsonResponse(tag, 200, "application/json"))), "bad_response");
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, responseFormat: "json" }).ok, true);
    assert.match(doc(), /rejected on purpose/);
  });

  it("redirects: every 3xx is no-fill and is never followed", async () => {
    for (const status of [301, 302, 307, 308]) {
      let calls = 0;
      const out = await run(async () => { calls += 1; return jsonResponse(JSON.stringify(GOOD), status); });
      assert.equal(reasonOf(out), "http_error", String(status));
      assert.equal(calls, 1);
    }
    assert.match(doc(), /any `3xx` is a no-fill and is never followed/);
  });

  it("timeout: a hanging endpoint is a no-fill; 1..3000 accepted, 0 and 3001 rejected", async () => {
    assert.equal(reasonOf(await run(() => new Promise<Res>(() => undefined), { timeoutMs: 20 })), "timeout");
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 3000 }).ok, true);
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 3001 }).ok, false);
    assert.equal(parseReviveConfig({ enabled: true, deliveryUrl: DELIVERY, timeoutMs: 0 }).ok, false);
  });

  it("size: a body over 65,536 bytes is no-fill", async () => {
    const over = JSON.stringify({ ...GOOD, headline: "h".repeat(REVIVE_MAX_BODY_BYTES) });
    assert.equal(reasonOf(await run(async () => jsonResponse(over))), "too_large");
    assert.equal(validateJsonEndpointText("x".repeat(REVIVE_MAX_BODY_BYTES + 1)).ok, false);
  });

  it("fields: markup, entities, control characters, bad lengths, a missing field and every executable key fail; null cta_text passes", () => {
    const ok = (o: unknown) => validateJsonEndpointText(JSON.stringify(o)).ok;
    assert.equal(ok(GOOD), true);
    assert.equal(ok({ ...GOOD, cta_text: null }), true);
    assert.equal(ok({ ...GOOD, headline: "<b>x</b>" }), false);
    assert.equal(ok({ ...GOOD, body: "a &amp; b" }), false);
    assert.equal(ok({ ...GOOD, body: "bad\u0007text" }), false);
    assert.equal(ok({ ...GOOD, headline: "h".repeat(HEADLINE_MAX + 1) }), false);
    assert.equal(ok({ ...GOOD, body: "b".repeat(BODY_MAX + 1) }), false);
    assert.equal(ok({ ...GOOD, cta_text: "c".repeat(CTA_MAX + 1) }), false);
    assert.equal(ok({ headline: GOOD.headline, destination_url: GOOD.destination_url }), false);
    for (const key of JSON_ENDPOINT_EXECUTABLE_KEYS) assert.equal(ok({ ...GOOD, [key]: "x" }), false, key);
  });

  it("safe destination: only absolute https without credentials, spaces or excess length", () => {
    assert.equal(safeDestination("https://example.com/landing"), "https://example.com/landing");
    for (const bad of ["http://example.com/x", "javascript:alert(1)", "data:text/html,x", "/relative", "https://u:p@example.com/x", "https://example.com/a b", `https://example.com/${"a".repeat(2048)}`]) {
      assert.equal(safeDestination(bad), null, bad.slice(0, 40));
    }
    assert.match(doc(), /`http:`, `javascript:`, `data:` and relative paths all fail/);
  });
});

describe("day 27 part 4 | provider attribution described in the guide is what the response builder produces", () => {
  const built = () => buildProviderAdResponse("revive", { headline: GOOD.headline, body: GOOD.body, ctaText: GOOD.cta_text, destinationUrl: GOOD.destination_url });

  it("sponsored:true, an id of the form revive_ + 8 hex that is not a UUID, no tracking, no click_ref, no provider field", () => {
    const out = built();
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const r = out.response as unknown as Record<string, unknown>;
    assert.equal(r.fill, true);
    assert.equal(r.sponsored, true);
    const ad = r.ad as Record<string, unknown>;
    assert.match(String(ad.id), /^revive_[0-9a-f]{8}$/);
    assert.doesNotMatch(String(ad.id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    for (const k of ["tracking", "click_ref", "provider"]) {
      assert.equal(k in r, false, k);
      assert.equal(k in ad, false, k);
    }
  });

  it("the guide states the same attribution rules", () => {
    assert.match(doc(), /`sponsored: true`/);
    assert.match(doc(), /`revive_` plus 8 hex characters/);
    assert.match(flat(), /no `tracking` and no `click_ref`/);
    assert.match(flat(), /The public match response carries no `provider` field/);
    assert.match(flat(), /records no impression, click, billing, ledger entry or publisher earning/);
  });
});

describe("day 27 part 4 | Preview-only test steps match the preview route and the flags", () => {
  it("the guide keeps the fallback flag and the preview-route flag separate, and the preview flag name is real", () => {
    assert.equal(PREVIEW_ENV_FLAG, "REVIVE_JSON_PREVIEW_ENABLED");
    assert.ok(doc().includes("`REVIVE_JSON_PREVIEW_ENABLED` is a separate flag"));
    assert.match(flat(), /never turns on `REVIVE_FALLBACK_ENABLED`/);
  });

  it("the preview route still answers a fixed 404 with the flag unset (it does not touch the fallback flag)", async () => {
    const res = await handlePreviewGet({ env: {} });
    assert.equal(res.status, 404);
    assert.equal(await res.text(), '{"error":"not_found"}');
    const enabled = await handlePreviewGet({ env: { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: DELIVERY } });
    assert.equal(enabled.status, 404);
  });

  it("the guide says fixture checks prove nothing about Revive and the script cannot target an external endpoint", () => {
    assert.match(flat(), /check the Blisscco \*\*test fixture\*\* only\. A pass there says nothing about Revive/);
    assert.match(flat(), /cannot be pointed at an external endpoint/);
    const script = read("scripts/revive-json-preview-check.mjs");
    assert.match(script, /\/api\/revive-json-preview/);
  });

  it("tells the reader to use Preview only, server-side variables, never NEXT_PUBLIC_, and to clean up", () => {
    assert.match(flat(), /\*\*server-side\*\* variables, \*\*Preview only\*\*/);
    assert.match(doc(), /Leave Production and Development unticked/);
    assert.match(doc(), /Never use a `NEXT_PUBLIC_` prefix/);
    assert.match(doc(), /Delete `REVIVE_FALLBACK_ENABLED` and `REVIVE_DELIVERY_URL`/);
    assert.match(doc(), /Check Production separately\. It must still answer `\{"fill":false\}`/);
    assert.match(doc(), /Production configuration is never touched/);
  });

  it("never puts a NEXT_PUBLIC_ Revive variable in the app or the guide's instructions", () => {
    for (const f of ["lib/ads/revive-adapter.ts", "lib/ads/fallback-provider.ts", "lib/ads/revive-json-preview.ts", "app/api/revive-json-preview/route.ts"]) {
      assert.doesNotMatch(read(f), /NEXT_PUBLIC_REVIVE/, f);
    }
    assert.doesNotMatch(doc(), /NEXT_PUBLIC_REVIVE/);
  });
});

describe("day 27 part 4 | the guide leaks nothing and guesses nothing", () => {
  it("contains no real or guessed URL: only example.com or <placeholder> hosts", () => {
    const urls = [...doc().matchAll(/https?:\/\/[^\s)`"']+/g)].map((m) => m[0]);
    for (const u of urls) assert.ok(u.startsWith("https://<") || new URL(u).hostname === "example.com", u);
    assert.doesNotMatch(doc(), /\.vercel\.app|openx|adserver|revive\.[a-z]+|github\.io/i);
  });

  it("contains no credential, no key value and no env assignment", () => {
    assert.doesNotMatch(doc(), /blc_live_[0-9a-f]{8}/i);
    assert.doesNotMatch(doc(), /(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S{6,}/i);
    assert.doesNotMatch(doc(), /REVIVE_(DELIVERY_URL|FALLBACK_ENABLED|TIMEOUT_MS|RESPONSE_FORMAT|JSON_PREVIEW_ENABLED)\s*=/);
    assert.doesNotMatch(doc(), /\bexport\s+REVIVE_/);
  });

  it("shell blocks read the URL without echo, clear it, and never follow redirects or hard-code a URL", () => {
    const blocks = [...doc().matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    assert.ok(blocks.length >= 1);
    for (const b of blocks) {
      assert.doesNotMatch(b, /(^|\s)(-L|--location)(\s|$)/, b);
      assert.doesNotMatch(b, /https?:\/\//, b);
    }
    assert.ok(doc().includes("read -rs ENDPOINT_URL"));
    assert.ok(doc().includes("unset ENDPOINT_URL"));
  });

  it("includes no SQL, schema change or Production enablement instruction", () => {
    assert.doesNotMatch(doc(), /\b(CREATE|ALTER|INSERT|DROP|UPDATE)\s+(TABLE|INDEX|FUNCTION|POLICY|\w+\s+SET)\b/i);
    assert.doesNotMatch(doc(), /migration|supabase db|psql/i);
    assert.doesNotMatch(doc(), /(set|enable|turn on) (it|the (flag|variable)|`?REVIVE_FALLBACK_ENABLED`?)[^.\n]{0,30}in Production/i);
    assert.doesNotMatch(doc(), /--prod/);
  });
});

describe("day 27 part 4 | scope: docs and tests only, no code or database change", () => {
  it("no Day 27 SQL file exists and no package script was added", () => {
    const sql = readdirSync(path.join(ROOT, "supabase", "sql"));
    assert.equal(sql.some((f) => /day-?27/i.test(f)), false);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.equal(Object.values(pkg.scripts).some((v) => /revive|preview-check/.test(v)), false);
  });

  it("the fixture route is still not wired into the adapter, fallback or match routes", () => {
    for (const f of ["lib/ads/revive-adapter.ts", "lib/ads/fallback-provider.ts", "lib/ads/fallback-routing.ts", "app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts"]) {
      assert.equal(read(f).includes("revive-json-preview"), false, f);
    }
  });
});
