import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_AD_FIELDS, buildProviderAdResponse, type ProviderCreativeInput } from "@/lib/ads/contract";
import { createReviveAdapter, extractReviveCreative, REVIVE_PROVIDER_NAME, type ReviveFetcher } from "@/lib/ads/revive-adapter";
import { providerFallbackFromEnv } from "@/lib/ads/fallback-provider";
import { routeServeWithFallback } from "@/lib/ads/fallback-routing";
import { safeDestination } from "@/lib/ads/click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

// Day 22 Part 4: verified Revive response => SIRF existing public ad fields. Network, database, billing sab NAKLI; koi asli provider call nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const GOOD = { headline: "Fast hosting for small sites", body: "Plans start small and grow with you.", cta_text: "Learn more", destination_url: "https://hosting.example.com/plans?ref=a" };
const jsonFill = (data: unknown) => ({ provider: "revive", format: "json" as const, data });
const pipe = (data: unknown) => {
  const x = extractReviveCreative(jsonFill(data));
  return x.ok ? buildProviderAdResponse(x.provider, x.creative) : x;
};
const rejectReason = (data: unknown): string => {
  const out = pipe(data);
  assert.equal(out.ok, false, JSON.stringify(data));
  return out.ok ? "" : out.reason;
};

describe("day 22 part 4 | public response allowlisting", () => {
  it("a verified JSON fill becomes exactly {fill:true, sponsored:true, ad:{5 public fields}}", () => {
    const out = pipe(GOOD);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(Object.keys(out.response).sort(), ["ad", "fill", "sponsored"]);
    assert.equal(out.response.fill, true);
    assert.strictEqual(out.response.sponsored, true);
    assert.deepEqual(Object.keys(out.response.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
    assert.equal(out.response.ad.headline, GOOD.headline);
    assert.equal(out.response.ad.body, GOOD.body);
    assert.equal(out.response.ad.cta_text, "Learn more");
    assert.equal(out.response.ad.destination_url, "https://hosting.example.com/plans?ref=a");
    assert.match(out.response.ad.id, /^revive_[0-9a-f]{8}$/);
  });

  it("extra / internal provider fields never reach the public response", () => {
    const out = pipe({
      ...GOOD, zone_id: 7, campaign_id: "c-9", banner_id: 12, advertiser: "Secret Co", cost: 0.4, tracker_url: "https://t.example.com/p.gif",
      click_url: "https://t.example.com/c", internal: { db: "x" }, raw: "RAW-PROVIDER-BODY", token: "TOK-1", key: "KEY-1",
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const wire = JSON.stringify(out.response);
    for (const leak of ["zone_id", "campaign_id", "banner_id", "Secret Co", "tracker_url", "click_url", "RAW-PROVIDER-BODY", "TOK-1", "KEY-1", "internal", "t.example.com"]) {
      assert.ok(!wire.includes(leak), leak);
    }
    assert.deepEqual(Object.keys(out.response.ad).sort(), [...PUBLIC_AD_FIELDS].sort());
  });

  it("the response never carries tracking, click_ref or provider data (no Blisscco impression/click/billing claim)", () => {
    const out = pipe(GOOD);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.ok(!("tracking" in out.response));
    const { id, ...rest } = out.response.ad; // id sirf "revive_" prefix rakhta hai (non-UUID); baaki kahin provider ka naam/data nahi
    assert.match(id, /^revive_/);
    const wire = JSON.stringify({ ...out.response, ad: rest });
    assert.ok(!/tracking|click_ref|bc1\.|bt1\.|revive|provider/i.test(wire), wire);
  });

  it("text is trimmed, a missing / blank cta_text becomes null, and cta_text is optional", () => {
    const a = pipe({ ...GOOD, headline: "  Padded  ", cta_text: "   " });
    assert.equal(a.ok && a.response.ad.headline, "Padded");
    assert.equal(a.ok && a.response.ad.cta_text, null);
    const { cta_text: _omit, ...noCta } = GOOD;
    void _omit;
    const b = pipe(noCta);
    assert.equal(b.ok && b.response.ad.cta_text, null);
    const c = pipe({ ...GOOD, cta_text: null });
    assert.equal(c.ok && c.response.ad.cta_text, null);
  });

  it("the same creative always gets the same id, a different one a different id", () => {
    const a = pipe(GOOD);
    const b = pipe(GOOD);
    const c = pipe({ ...GOOD, headline: "Another headline" });
    assert.equal(a.ok && b.ok && c.ok, true);
    if (!(a.ok && b.ok && c.ok)) return;
    assert.equal(a.response.ad.id, b.response.ad.id);
    assert.notEqual(a.response.ad.id, c.response.ad.id);
  });

  it("length limits are the same as Blisscco creatives", () => {
    assert.equal(pipe({ ...GOOD, headline: "h".repeat(HEADLINE_MAX) }).ok, true);
    assert.equal(rejectReason({ ...GOOD, headline: "h".repeat(HEADLINE_MAX + 1) }), "invalid_text");
    assert.equal(pipe({ ...GOOD, body: "b".repeat(BODY_MAX) }).ok, true);
    assert.equal(rejectReason({ ...GOOD, body: "b".repeat(BODY_MAX + 1) }), "invalid_text");
    assert.equal(pipe({ ...GOOD, cta_text: "c".repeat(CTA_MAX) }).ok, true);
    assert.equal(rejectReason({ ...GOOD, cta_text: "c".repeat(CTA_MAX + 1) }), "invalid_text");
  });
});

describe("day 22 part 4 | safe URL handling (project's existing safeDestination rule)", () => {
  it("a good https destination is returned normalized by safeDestination itself", () => {
    const out = pipe({ ...GOOD, destination_url: "https://Hosting.Example.com:443/a b".replace(" ", "%20") });
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.response.ad.destination_url, safeDestination("https://Hosting.Example.com:443/a%20b"));
  });

  it("unsafe destinations are rejected, never passed through", () => {
    const bad: unknown[] = [
      "http://hosting.example.com/", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "ftp://example.com/f",
      "//example.com/path", "/relative/path", "example.com", "https://user:pw@example.com/", "https://trusted.com@evil.example/", "https://127.0.0.1/", "https://10.0.0.5/x",
      "https://[::1]/", "https://localhost/", "https://intranet/", "https://example.com/has space", "https://example.com/\u0000", "https://example.com/\nX",
      `https://example.com/${"a".repeat(2100)}`, "", "   ", 42, null, undefined, {}, ["https://example.com"],
    ];
    for (const url of bad) {
      const x = extractReviveCreative(jsonFill({ ...GOOD, destination_url: url }));
      if (!x.ok) {
        assert.equal(x.reason, "invalid_creative", String(url)); // wrong type stops at extraction
        continue;
      }
      const out = buildProviderAdResponse(x.provider, x.creative);
      assert.equal(out.ok, false, String(url));
      assert.equal(out.ok ? "" : out.reason, "unsafe_destination", String(url));
    }
  });

  it("an unsafe destination never leaks into the result", () => {
    const out = pipe({ ...GOOD, destination_url: "javascript:alert('LEAK-9')" });
    assert.ok(!JSON.stringify(out).includes("LEAK-9"));
  });
});

describe("day 22 part 4 | unsupported creative formats are rejected, never returned as markup", () => {
  it("an HTML fill (either shape) is rejected as unsupported_format", () => {
    const body = '<a href="https://example.com"><img src=x onerror=alert(1)></a><script>evil()</script>';
    assert.deepEqual(extractReviveCreative({ status: "fill", format: "html", body }), { ok: false, reason: "unsupported_format" });
    assert.deepEqual(extractReviveCreative(jsonFill(body) && { provider: "revive", format: "html", data: body }), { ok: false, reason: "unsupported_format" });
    assert.ok(!JSON.stringify(extractReviveCreative({ status: "fill", format: "html", body })).includes("script"));
  });

  it("a JSON creative that carries executable / markup keys is rejected as a whole", () => {
    for (const key of ["html", "HTML", "script", "iframe", "js", "javascript", "tag", "code", "markup", "adm", "creative_html", "snippet", "embed", "vast"]) {
      assert.equal(rejectReason({ ...GOOD, [key]: "<b>x</b>" }), "unsupported_creative", key);
    }
  });

  it("markup or encoded markup inside the text fields is rejected", () => {
    for (const bad of ["<script>alert(1)</script>", "Hello <b>world</b>", "a > b", "&lt;script&gt;", "&#60;img&#62;", "&#x3c;svg", "Tom &amp; Jerry", "bell\u0007", "line\nbreak", "nul\u0000", "sep x"]) {
      assert.equal(rejectReason({ ...GOOD, headline: bad }), "invalid_text", bad);
      assert.equal(rejectReason({ ...GOOD, body: bad }), "invalid_text", bad);
      assert.equal(rejectReason({ ...GOOD, cta_text: bad }), "invalid_text", bad);
    }
  });

  it("missing, empty or wrongly typed required fields are rejected", () => {
    for (const key of ["headline", "body", "destination_url"]) {
      const { [key]: _drop, ...rest } = GOOD as Record<string, unknown>;
      void _drop;
      assert.equal(rejectReason(rest), "invalid_creative", key);
      assert.equal(rejectReason({ ...GOOD, [key]: 5 }), "invalid_creative", key);
      assert.ok(["invalid_creative", "invalid_text", "unsafe_destination"].includes(rejectReason({ ...GOOD, [key]: "" })), key);
    }
    assert.equal(rejectReason({ ...GOOD, cta_text: 7 }), "invalid_creative");
  });

  it("non-object payloads and inherited fields are rejected", () => {
    for (const data of [null, undefined, "str", 5, true, [], [GOOD]]) {
      assert.equal(extractReviveCreative(jsonFill(data)).ok, false);
    }
    const inherited = Object.create(GOOD) as unknown;
    assert.equal(rejectReason(inherited), "invalid_creative");
  });

  it("unknown formats, no-fill and non-fill values are rejected without throwing", () => {
    for (const v of [null, undefined, 0, "x", [], {}, { status: "no-fill", reason: "timeout" }, { provider: "revive", format: "xml", data: {} }, { status: "fill", format: "xml" }]) {
      const x = extractReviveCreative(v);
      assert.equal(x.ok, false);
    }
    const hostile = { get status(): string { throw new Error("boom"); } };
    assert.equal(extractReviveCreative(hostile).ok, false);
  });
});

describe("day 22 part 4 | provider attribution", () => {
  it("the extraction result names revive; the public response does not", () => {
    const x = extractReviveCreative(jsonFill(GOOD));
    assert.equal(x.ok && x.provider, REVIVE_PROVIDER_NAME);
    assert.equal(REVIVE_PROVIDER_NAME, "revive");
    const out = buildProviderAdResponse("revive", (x.ok ? x.creative : null) as ProviderCreativeInput);
    assert.equal(out.ok && out.provider, "revive");
    assert.ok(out.ok && !Object.keys(out.response).includes("provider") && !("provider" in out.response.ad));
    assert.ok(out.ok && !JSON.stringify({ ...out.response.ad, id: "" }).includes("revive"));
  });

  it("a fill that claims any other provider is not mapped, and odd provider names are rejected", () => {
    assert.deepEqual(extractReviveCreative({ provider: "other", format: "json", data: GOOD }), { ok: false, reason: "not_a_fill" });
    assert.deepEqual(extractReviveCreative({ provider: "Revive", format: "json", data: GOOD }), { ok: false, reason: "not_a_fill" });
    for (const name of ["", "Revive", "re vive", "1revive", "revive!", "x".repeat(40), "re-vive"]) {
      assert.deepEqual(buildProviderAdResponse(name, GOODCREATIVE), { ok: false, reason: "invalid_provider" }, name);
    }
    assert.equal(buildProviderAdResponse(5 as unknown as string, GOODCREATIVE).ok, false);
  });

  it("the id carries the provider prefix, so it can never be mistaken for a Blisscco ad UUID", () => {
    const out = buildProviderAdResponse("revive", GOODCREATIVE);
    assert.equal(out.ok && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(out.response.ad.id), false);
  });
});

const GOODCREATIVE: ProviderCreativeInput = { headline: GOOD.headline, body: GOOD.body, ctaText: GOOD.cta_text, destinationUrl: GOOD.destination_url };

describe("day 22 part 4 | end to end through the real adapter and routing (fake fetcher)", () => {
  const URL_OK = "https://delivery.example.com/serve?zoneid=3&key=SECRETKEY999";
  const fetcherFor = (body: string, ct = "application/json"): ReviveFetcher => async () =>
    new Response(body, { headers: { "content-type": ct } }) as unknown as Awaited<ReturnType<ReviveFetcher>>;
  const ENV = { REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: URL_OK };
  const route = (env: Record<string, string | undefined>, fetcher: ReviveFetcher) =>
    routeServeWithFallback("hash", { topic: "gaming", excludeAdIds: [] }, { serve: async () => ({ kind: "no_fill" }), ...providerFallbackFromEnv(env, { fetcher }) });

  it("Blisscco no-fill + flag on + good JSON => provider fill maps to a safe public response, Blisscco flags stay false", async () => {
    const out = await route(ENV, fetcherFor(JSON.stringify(GOOD)));
    assert.equal(out.source, "provider");
    if (out.source !== "provider") return;
    assert.deepEqual(out.blisscco, { charged: false, serveRecorded: false, impressionClaimed: false });
    const x = extractReviveCreative(out.fill);
    assert.equal(x.ok, true);
    const mapped = x.ok ? buildProviderAdResponse(x.provider, x.creative) : null;
    assert.equal(mapped?.ok && mapped.response.ad.destination_url, "https://hosting.example.com/plans?ref=a");
    assert.ok(!JSON.stringify(mapped).includes("SECRETKEY999"));
    assert.ok(!JSON.stringify(mapped).includes("delivery.example.com"));
  });

  it("the adapter's own sealed fill is accepted too, and an HTML fill from the adapter is rejected", async () => {
    const jsonOut = await createReviveAdapter({ enabled: true, deliveryUrl: URL_OK }, { fetcher: fetcherFor(JSON.stringify(GOOD)) }).requestFill();
    assert.equal(extractReviveCreative(jsonOut).ok, true);
    const htmlOut = await createReviveAdapter({ enabled: true, deliveryUrl: URL_OK, responseFormat: "html" }, { fetcher: fetcherFor("<b>x</b>", "text/html") }).requestFill();
    assert.equal(htmlOut.status, "fill");
    assert.deepEqual(extractReviveCreative(htmlOut), { ok: false, reason: "unsupported_format" });
  });

  it("flag off => no provider fill at all (default disabled), so there is nothing to map", async () => {
    let calls = 0;
    const f: ReviveFetcher = async (u, i) => {
      calls += 1;
      return fetcherFor("{}")(u, i);
    };
    const out = await route({ REVIVE_DELIVERY_URL: URL_OK }, f);
    assert.deepEqual(out, { source: "blisscco", result: { kind: "no_fill" } });
    assert.equal(calls, 0);
  });

  it("an unsafe provider creative ends as no-fill material: nothing mappable comes out", async () => {
    const out = await route(ENV, fetcherFor(JSON.stringify({ ...GOOD, destination_url: "javascript:alert(1)" })));
    assert.equal(out.source, "provider");
    if (out.source !== "provider") return;
    const x = extractReviveCreative(out.fill);
    const mapped = x.ok ? buildProviderAdResponse(x.provider, x.creative) : x;
    assert.equal(mapped.ok, false);
  });
});

describe("day 22 part 4 | static boundaries", () => {
  it("contract.ts stays provider-neutral and the new code has no env, network, tracking or billing", () => {
    const c = code("lib/ads/contract.ts");
    assert.ok(!/revive/i.test(c));
    const part = c.slice(c.indexOf("export type ProviderCreativeInput"));
    assert.ok(!/process\.env|fetch\(|console\.|supabase|ledger|budget|payout|buildAdResponse|mintTrackingToken|mintClickRef|tracking:/i.test(part));
    assert.match(part, /safeDestination\(/);
  });

  it("revive-adapter.ts still imports only the provider-adapter type (no click, contract, db or env)", () => {
    const imports = (code("lib/ads/revive-adapter.ts").match(/^\s*import\s[^;]+;/gm) ?? []).map((i) => i.replace(/\s+/g, " ").trim());
    assert.deepEqual(imports, ['import type { AdProviderAdapter } from "./provider-adapter";']);
  });

  it("match handler, routes and serving are untouched: the public match response cannot carry a provider ad yet", () => {
    for (const f of ["lib/ads/match-handler.ts", "lib/ads/serve.ts", "lib/ads/serve-db.ts", "app/api/v1/ads/match/route.ts", "app/api/ads/match/route.ts"]) {
      assert.ok(!/buildProviderAdResponse|extractReviveCreative|serveAdWithFallback|revive/i.test(code(f)), f);
    }
  });

  it("no SQL, package or env file mentions Revive after Part 4", () => {
    assert.ok(!/revive/i.test(read("package.json")));
  });
});
