import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  extractReviveCreative,
  parseReviveEnv,
} from "@/lib/ads/revive-adapter";
import { reviveFallbackEnabled, publicAdFromFallbackFill } from "@/lib/ads/fallback-provider";
import { MAX_DESTINATION_LENGTH } from "@/lib/ads/click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

// Day 23 Part 4: REVIVE-JSON-ENDPOINT-SETUP.md ko implementation se match karta hai. Koi network, DB, credential ya Revive server nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const GUIDE = readFileSync(path.join(ROOT, "REVIVE-JSON-ENDPOINT-SETUP.md"), "utf8");
const flat = GUIDE.replace(/\s+/g, " ");
const sectionOf = (from: string, to?: string): string => {
  const s = flat.indexOf(from);
  assert.ok(s >= 0, `missing heading: ${from}`);
  const e = to === undefined ? flat.length : flat.indexOf(to, s + from.length);
  assert.ok(e > s, `missing heading: ${to}`);
  return flat.slice(s, e);
};

describe("day 23 part 4 | request and response contract matches the code", () => {
  it("numbers in the guide equal the implementation constants", () => {
    assert.equal(REVIVE_MAX_BODY_BYTES, 65536);
    assert.match(flat, /65,536 bytes/);
    assert.equal(REVIVE_DEFAULT_TIMEOUT_MS, 800);
    assert.equal(REVIVE_MAX_TIMEOUT_MS, 3000);
    assert.match(flat, /800 ms by default, at most 3000 ms/);
    assert.match(flat, new RegExp(`max ${HEADLINE_MAX} characters`));
    assert.match(flat, new RegExp(`max ${BODY_MAX} characters`));
    assert.match(flat, new RegExp(`max ${CTA_MAX} characters`));
    assert.equal(MAX_DESTINATION_LENGTH, REVIVE_MAX_URL_LENGTH);
    assert.match(flat, new RegExp(`max ${MAX_DESTINATION_LENGTH} characters`));
  });

  it("states HTTPS GET, no redirects, JSON content type", () => {
    assert.match(flat, /HTTPS `GET`/);
    assert.match(flat, /No redirects are followed/);
    assert.match(flat, /Content-Type: application\/json/);
    for (const f of ["headline", "body", "cta_text", "destination_url"]) assert.match(flat, new RegExp(`\`${f}\``));
  });

  it("the adapter really sends GET with redirect:error, no credentials, and only an Accept header", async () => {
    let init: Record<string, unknown> | undefined;
    const adapter = createReviveAdapter(
      { enabled: true, deliveryUrl: "https://endpoint.example.com/ad" },
      {
        fetcher: async (_u, i) => {
          init = i as unknown as Record<string, unknown>;
          return { status: 200, headers: { get: () => "application/json" }, text: async () => "{}" };
        },
      },
    );
    await adapter.requestFill();
    assert.ok(init);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.deepEqual(Object.keys(init.headers as object), ["accept"]);
    assert.equal((init.headers as Record<string, string>).accept, "application/json");
  });

  it("an oversize body (65,537 bytes) is a no-fill; a normal body is a fill", async () => {
    const mk = (text: string) =>
      createReviveAdapter(
        { enabled: true, deliveryUrl: "https://endpoint.example.com/ad" },
        { fetcher: async () => ({ status: 200, headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "application/json" : null) }, text: async () => text }) },
      ).requestFill();
    const pad = (n: number) => JSON.stringify({ headline: "h", body: "x".repeat(n), destination_url: "https://example.com/a" });
    const base = pad(0).length;
    const big = await mk(pad(REVIVE_MAX_BODY_BYTES + 1 - base));
    assert.deepEqual({ ...big }, { status: "no-fill", reason: "too_large" });
    const ok = await mk(pad(10));
    assert.equal(ok.status, "fill");
  });

  it("a redirect (3xx) is a no-fill", async () => {
    const out = await createReviveAdapter(
      { enabled: true, deliveryUrl: "https://endpoint.example.com/ad" },
      { fetcher: async () => ({ status: 302, headers: { get: () => "application/json" }, text: async () => "{}" }) },
    ).requestFill();
    assert.deepEqual({ ...out }, { status: "no-fill", reason: "http_error" });
  });
});

describe("day 23 part 4 | plain-text creative rules", () => {
  const good = { headline: "Sample headline", body: "Sample body text.", cta_text: "Learn more", destination_url: "https://example.com/a" };
  const fill = (data: unknown) => ({ provider: "revive", format: "json", data });

  it("plain text is mapped; markup, entities and control characters are rejected", () => {
    assert.ok(publicAdFromFallbackFill(fill(good)));
    for (const bad of ["<b>x</b>", "a > b", "fish &amp; chips", "line\nbreak"]) {
      assert.equal(publicAdFromFallbackFill(fill({ ...good, headline: bad })), null, bad);
    }
    assert.match(flat, /No `<` or `>`, no HTML entities/);
  });

  it("executable-markup keys reject the whole creative; the guide names them", () => {
    for (const key of ["html", "script", "iframe", "adm"]) {
      assert.equal(extractReviveCreative(fill({ ...good, [key]: "x" })).ok, false, key);
      assert.match(flat, new RegExp(`\`${key}\``));
    }
  });

  it("html format is never turned into an ad", () => {
    assert.equal(extractReviveCreative({ provider: "revive", format: "html", data: "<p>x</p>" }).ok, false);
    assert.match(flat, /never turned into an ad/);
  });

  it("only the four documented fields reach the public ad", () => {
    const out = publicAdFromFallbackFill(fill({ ...good, extra: "ignored", price: 5 }));
    assert.ok(out && out.fill === true);
    assert.deepEqual(Object.keys(out.ad).sort(), ["body", "cta_text", "destination_url", "headline", "id"]);
  });
});

describe("day 23 part 4 | stock Revive tag vs. JSON endpoint, no unverified claim", () => {
  it("explains the difference and says Revive's native JSON endpoint is not verified", () => {
    const t = sectionOf("## 3.", "## 4.");
    assert.match(t, /HTML and\/or JavaScript/);
    assert.match(t, /rejected on purpose/);
    assert.match(t, /This repository does not verify that Revive natively provides this JSON endpoint/);
    assert.match(t, /no adapter for Revive's native response format/);
  });

  it("never claims Revive natively provides the JSON endpoint", () => {
    const withoutNegations = flat.replace(/This repository does not verify that Revive natively provides this JSON endpoint/g, "");
    assert.doesNotMatch(withoutNegations, /Revive (natively|already|automatically|out of the box)[^.]*(provides?|returns?|supports?|offers?)[^.]*JSON/i);
    assert.doesNotMatch(flat, /Revive (has|offers|provides) a (built-in|native) JSON/i);
  });

  it("no native-format adapter exists in the code", () => {
    const src = readFileSync(path.join(ROOT, "lib/ads/revive-adapter.ts"), "utf8");
    assert.doesNotMatch(src, /invocation|delivery\/(ajs|afr|avw)|adserver\.php/i);
  });
});

describe("day 23 part 4 | environment variables", () => {
  it("lists exactly the four variable names the code reads, server-side only", () => {
    const names = [REVIVE_ENV_FLAG, REVIVE_ENV_URL, REVIVE_ENV_TIMEOUT, REVIVE_ENV_FORMAT];
    assert.deepEqual(names, ["REVIVE_FALLBACK_ENABLED", "REVIVE_DELIVERY_URL", "REVIVE_TIMEOUT_MS", "REVIVE_RESPONSE_FORMAT"]);
    for (const n of names) assert.match(flat, new RegExp(`\`${n}\``));
    const found = new Set(GUIDE.match(/\bREVIVE_[A-Z_]+\b/g));
    assert.deepEqual([...found].sort(), [...names].sort());
    assert.doesNotMatch(GUIDE, /NEXT_PUBLIC_REVIVE/);
    assert.match(flat, /Never use a `NEXT_PUBLIC_` prefix/);
  });

  it("safe defaults are true in the code: unset => disabled, json, 800 ms", () => {
    assert.equal(reviveFallbackEnabled({}), false);
    assert.deepEqual(parseReviveEnv({}), { ok: false, reason: "disabled" });
    assert.deepEqual(parseReviveEnv({ REVIVE_FALLBACK_ENABLED: "false", REVIVE_DELIVERY_URL: "https://endpoint.example.com/ad" }), { ok: false, reason: "disabled" });
    const r = parseReviveEnv({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: "https://endpoint.example.com/ad" });
    assert.ok(r.ok);
    assert.equal(r.config.responseFormat, "json");
    assert.equal(r.config.timeoutMs, 800);
    assert.deepEqual(parseReviveEnv({ REVIVE_FALLBACK_ENABLED: "true", REVIVE_DELIVERY_URL: "https://x.example.com", REVIVE_TIMEOUT_MS: "3001" }), { ok: false, reason: "invalid_config" });
  });

  it("states that the flag stays false until a real endpoint is verified", () => {
    assert.match(flat, /`REVIVE_FALLBACK_ENABLED` stays false \(or unset\) until a real endpoint has been verified/);
    assert.match(flat, /Blisscco's Revive fallback stays \*\*off\*\*/);
  });

  it("contains no real URL values, credentials or secrets", () => {
    const urls = GUIDE.match(/https?:\/\/[^\s)"'`]+/g) ?? [];
    for (const u of urls) {
      const h = new URL(u);
      assert.match(h.hostname, /^(www\.)?example\.(com|org|net)$/, u);
      assert.equal(h.search, "", u);
      assert.equal(h.username + h.password, "", u);
    }
    assert.doesNotMatch(GUIDE, /blc_live_[0-9a-f]{8}/i);
    assert.doesNotMatch(GUIDE, /\b(token|key|secret|password)\s*=\s*[A-Za-z0-9]{6,}/i);
    assert.doesNotMatch(GUIDE, /REVIVE_[A-Z_]+\s*=\s*\S/);
    assert.doesNotMatch(GUIDE, /\b(select|insert|update|delete)\b[^.\n]*\b(from|into|set)\b/i);
  });
});

describe("day 23 part 4 | no tracking, billing or earnings promise", () => {
  const t = sectionOf("## 5.", "## 6.");

  it("says provider ads are not billing events and have no tracking", () => {
    assert.match(t, /not a Blisscco advertiser impression or billing event/);
    assert.match(t, /No Blisscco advertiser is charged/);
    assert.match(t, /no `tracking` object and no `click_ref`/);
    assert.match(t, /does not provide tracking or reporting for Revive ads/);
    assert.match(t, /does not record publisher earnings/);
  });

  it("has no sentence promising tracking, reporting, billing or earnings", () => {
    assert.doesNotMatch(flat, /Revive[^.]*\b(impressions? (are|is) (counted|reported|tracked)|earn(ings)? (are|will be)|will be (tracked|reported|paid|billed|credited))/i);
    assert.doesNotMatch(flat, /\b(reporting|analytics|dashboard|payouts?) (is|are) available for Revive/i);
    assert.doesNotMatch(flat, /publishers? (will|can) earn[^.]*Revive/i);
    assert.doesNotMatch(flat, /Revive[^.]*(counts? toward|credited to) (publisher|earnings|balance)/i);
  });

  it("a mapped Revive ad has no tracking key in the public response", () => {
    const out = publicAdFromFallbackFill({ provider: "revive", format: "json", data: { headline: "h", body: "b", destination_url: "https://example.com/a" } });
    assert.ok(out);
    assert.equal("tracking" in out, false);
    assert.equal("click_ref" in out.ad, false);
    assert.equal(out.sponsored, true);
  });
});

describe("day 23 part 4 | scope", () => {
  it("guide contains no SQL, migration or secret instructions", () => {
    assert.doesNotMatch(GUIDE, /\bcreate table\b|\balter table\b|\bmigration\b/i);
  });
});
