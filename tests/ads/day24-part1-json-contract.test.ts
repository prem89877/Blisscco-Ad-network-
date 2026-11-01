import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  JSON_ENDPOINT_ALLOWED_FIELDS,
  JSON_ENDPOINT_MAX_BYTES,
  JSON_ENDPOINT_EXECUTABLE_KEYS,
  JSON_ENDPOINT_REASONS,
  validateJsonEndpointPayload,
  validateJsonEndpointText,
} from "@/lib/ads/revive-json-endpoint-contract";
import { extractReviveCreative, REVIVE_MAX_BODY_BYTES } from "@/lib/ads/revive-adapter";
import { buildProviderAdResponse } from "@/lib/ads/contract";
import { MAX_DESTINATION_LENGTH } from "@/lib/ads/click";
import { BODY_MAX, CTA_MAX, HEADLINE_MAX } from "@/lib/campaigns/creative-validation";

// Day 24 Part 1: strict JSON endpoint contract validator. Pure: koi network, DB, env, credential ya Revive server nahi.

const ROOT = path.join(__dirname, "..", "..", "..");
const MODULE = "lib/ads/revive-json-endpoint-contract.ts";
const good = { headline: "Sample headline", body: "Sample body text.", cta_text: "Learn more", destination_url: "https://example.com/landing" };
const SECRET = "SECRETVALUE9911";
const enc = (s: string) => new TextEncoder().encode(s);

const ok = (r: ReturnType<typeof validateJsonEndpointPayload>) => {
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  return r.creative;
};
const reason = (r: ReturnType<typeof validateJsonEndpointPayload>) => {
  assert.equal(r.ok, false);
  assert.ok(!r.ok);
  return r.reason;
};
const withField = (over: Record<string, unknown>) => ({ ...good, ...over });
const without = (k: string) => {
  const o: Record<string, unknown> = { ...good };
  delete o[k];
  return o;
};

describe("day 24 part 1 | valid payloads", () => {
  it("accepts all four fields and returns the normalized creative", () => {
    assert.deepEqual({ ...ok(validateJsonEndpointPayload(good)) }, {
      headline: "Sample headline",
      body: "Sample body text.",
      ctaText: "Learn more",
      destinationUrl: "https://example.com/landing",
    });
  });

  it("cta_text is optional: omitted, null, empty and whitespace all become null", () => {
    assert.equal(ok(validateJsonEndpointPayload(without("cta_text"))).ctaText, null);
    assert.equal(ok(validateJsonEndpointPayload(withField({ cta_text: null }))).ctaText, null);
    assert.equal(ok(validateJsonEndpointPayload(withField({ cta_text: "" }))).ctaText, null);
    assert.equal(ok(validateJsonEndpointPayload(withField({ cta_text: "   " }))).ctaText, null);
  });

  it("trims text and accepts the exact maximum lengths", () => {
    const c = ok(validateJsonEndpointPayload(withField({ headline: `  ${"h".repeat(HEADLINE_MAX)}  `, body: "b".repeat(BODY_MAX), cta_text: "c".repeat(CTA_MAX) })));
    assert.equal(c.headline.length, HEADLINE_MAX);
    assert.equal(c.body.length, BODY_MAX);
    assert.equal(c.ctaText?.length, CTA_MAX);
  });

  it("accepts non-ASCII plain text", () => {
    const c = ok(validateJsonEndpointPayload(withField({ headline: "Café – नमस्ते 你好", body: "Plain text ✓" })));
    assert.equal(c.headline, "Café – नमस्ते 你好");
  });

  it("works from JSON text and from UTF-8 bytes, with identical results", () => {
    const text = JSON.stringify(good);
    const a = ok(validateJsonEndpointText(text));
    const b = ok(validateJsonEndpointText(enc(text)));
    const c = ok(validateJsonEndpointPayload(JSON.parse(text)));
    assert.deepEqual({ ...a }, { ...b });
    assert.deepEqual({ ...a }, { ...c });
  });

  it("the result is frozen and holds only the four creative values", () => {
    const r = validateJsonEndpointPayload(good);
    assert.ok(Object.isFrozen(r));
    assert.ok(r.ok && Object.isFrozen(r.creative));
    assert.deepEqual(Object.keys(r), ["ok", "creative"]);
    assert.deepEqual(Object.keys(ok(r)).sort(), ["body", "ctaText", "destinationUrl", "headline"]);
  });

  it("unknown non-executable fields are ignored and dropped from the result (matches the guide)", () => {
    const c = ok(validateJsonEndpointPayload(withField({ price: 5, advertiser: "x", nested: { a: 1 } })));
    assert.deepEqual(Object.keys(c).sort(), ["body", "ctaText", "destinationUrl", "headline"]);
    assert.ok(!JSON.stringify(c).includes("advertiser"));
  });

  it("strictFields rejects any field outside the four allowed ones", () => {
    assert.deepEqual([...JSON_ENDPOINT_ALLOWED_FIELDS], ["headline", "body", "cta_text", "destination_url"]);
    assert.equal(reason(validateJsonEndpointPayload(withField({ price: 5 }), { strictFields: true })), "unknown_field");
    assert.equal(ok(validateJsonEndpointPayload(good, { strictFields: true })).headline, "Sample headline");
  });
});

describe("day 24 part 1 | missing and wrongly typed fields", () => {
  it("each required field missing, null or undefined => missing_field", () => {
    for (const k of ["headline", "body", "destination_url"]) {
      assert.equal(reason(validateJsonEndpointPayload(without(k))), "missing_field", k);
      assert.equal(reason(validateJsonEndpointPayload(withField({ [k]: null }))), "missing_field", k);
      assert.equal(reason(validateJsonEndpointPayload(withField({ [k]: undefined }))), "missing_field", k);
    }
  });

  it("empty, whitespace-only and non-string required text is rejected with the field's own code", () => {
    for (const bad of ["", "   ", 5, true, ["a"], { a: 1 }]) {
      assert.equal(reason(validateJsonEndpointPayload(withField({ headline: bad }))), "invalid_headline");
      assert.equal(reason(validateJsonEndpointPayload(withField({ body: bad }))), "invalid_body");
    }
    for (const bad of [5, true, ["a"], { a: 1 }]) assert.equal(reason(validateJsonEndpointPayload(withField({ cta_text: bad }))), "invalid_cta_text");
  });

  it("text over the limit by one character is rejected", () => {
    assert.equal(reason(validateJsonEndpointPayload(withField({ headline: "h".repeat(HEADLINE_MAX + 1) }))), "invalid_headline");
    assert.equal(reason(validateJsonEndpointPayload(withField({ body: "b".repeat(BODY_MAX + 1) }))), "invalid_body");
    assert.equal(reason(validateJsonEndpointPayload(withField({ cta_text: "c".repeat(CTA_MAX + 1) }))), "invalid_cta_text");
  });

  it("not an object: array, null, string, number, boolean, undefined", () => {
    for (const v of [[], [good], null, "x", 5, true, undefined]) assert.equal(reason(validateJsonEndpointPayload(v)), "not_an_object");
    for (const t of ["[]", "null", '"x"', "5", "true"]) assert.equal(reason(validateJsonEndpointText(t)), "not_an_object", t);
  });

  it("invalid JSON text, empty text and non text/bytes input", () => {
    for (const t of ["", "   ", "{", "{'a':1}", `{"headline":}`, "\uFEFF" + JSON.stringify(good)]) assert.equal(reason(validateJsonEndpointText(t)), "invalid_json", JSON.stringify(t));
    for (const v of [undefined, null, 5, {}, [], true]) assert.equal(reason(validateJsonEndpointText(v)), "invalid_input");
  });
});

describe("day 24 part 1 | size and UTF-8", () => {
  it("the limit is 65,536 bytes and equals the adapter's", () => {
    assert.equal(JSON_ENDPOINT_MAX_BYTES, 65536);
    assert.equal(JSON_ENDPOINT_MAX_BYTES, REVIVE_MAX_BODY_BYTES);
  });

  const padded = (bytes: number) => {
    const base = JSON.stringify({ ...good, pad: "" });
    return JSON.stringify({ ...good, pad: "x".repeat(bytes - enc(base).byteLength) });
  };

  it("a body of exactly 65,536 bytes passes; 65,537 bytes is too_large (text and bytes)", () => {
    const exact = padded(65536);
    assert.equal(enc(exact).byteLength, 65536);
    assert.equal(ok(validateJsonEndpointText(exact)).headline, "Sample headline");
    assert.equal(ok(validateJsonEndpointText(enc(exact))).headline, "Sample headline");
    const over = padded(65537);
    assert.equal(enc(over).byteLength, 65537);
    assert.equal(reason(validateJsonEndpointText(over)), "too_large");
    assert.equal(reason(validateJsonEndpointText(enc(over))), "too_large");
  });

  it("the limit is in bytes, not characters: multi-byte text under 65,536 characters can still be too large", () => {
    const text = JSON.stringify({ ...good, pad: "€".repeat(21846) }); // 3 bytes each
    assert.ok(text.length < 65536 && enc(text).byteLength > 65536);
    assert.equal(reason(validateJsonEndpointText(text)), "too_large");
  });

  it("an oversized parsed object is too_large too", () => {
    assert.equal(reason(validateJsonEndpointPayload(withField({ pad: "x".repeat(70000) }))), "too_large");
  });

  it("invalid UTF-8 bytes and lone surrogates are rejected", () => {
    const bad = new Uint8Array([...enc('{"headline":"'), 0xff, 0xfe, ...enc('"}')]);
    assert.equal(reason(validateJsonEndpointText(bad)), "invalid_utf8");
    assert.equal(reason(validateJsonEndpointText('{"headline":"\uD800"}')), "invalid_utf8");
  });
});

describe("day 24 part 1 | destination", () => {
  it("only plain https URLs are accepted; the result holds the normalized href", () => {
    assert.equal(ok(validateJsonEndpointPayload(withField({ destination_url: "https://example.com" }))).destinationUrl, "https://example.com/");
    assert.equal(ok(validateJsonEndpointPayload(withField({ destination_url: "https://example.com/a?x=1" }))).destinationUrl, "https://example.com/a?x=1");
  });

  it("http, javascript, data, file, ftp, relative, protocol-relative, empty and non-string are rejected", () => {
    for (const u of ["http://example.com/a", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://example.com/a", "/relative", "//example.com/a", "example.com", "", "   ", "https://", "https:///a"]) {
      assert.equal(reason(validateJsonEndpointPayload(withField({ destination_url: u }))), "invalid_destination", u);
    }
    for (const u of [5, true, ["https://example.com"], { u: "https://example.com" }]) assert.equal(reason(validateJsonEndpointPayload(withField({ destination_url: u }))), "invalid_destination");
  });

  it("credentials, whitespace/control characters and over-length URLs are rejected", () => {
    for (const u of ["https://user:pass@example.com/a", "https://user@example.com/a", "https://example.com/a b", "https://example.com/a\nb", "https://example.com/a\u0000"]) {
      assert.equal(reason(validateJsonEndpointPayload(withField({ destination_url: u }))), "invalid_destination", JSON.stringify(u));
    }
    const long = `https://example.com/${"a".repeat(MAX_DESTINATION_LENGTH)}`;
    assert.equal(reason(validateJsonEndpointPayload(withField({ destination_url: long }))), "invalid_destination");
  });
});

describe("day 24 part 1 | markup, entities and control characters", () => {
  const fields = ["headline", "body", "cta_text"] as const;
  const codeOf = { headline: "invalid_headline", body: "invalid_body", cta_text: "invalid_cta_text" } as const;

  it("angle brackets, HTML and script-like text are rejected in every text field", () => {
    for (const f of fields) {
      for (const t of ["<b>x</b>", "a < b", "a > b", "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<!-- c -->", "x</div>"]) {
        assert.equal(reason(validateJsonEndpointPayload(withField({ [f]: t }))), codeOf[f], `${f}: ${t}`);
      }
    }
  });

  it("HTML entities (named, decimal, hex) are rejected", () => {
    for (const f of fields) for (const t of ["fish &amp; chips", "&lt;b&gt;", "&#60;b&#62;", "&#x3c;b&#x3e;"]) assert.equal(reason(validateJsonEndpointPayload(withField({ [f]: t }))), codeOf[f], t);
  });

  it("control characters (NUL, tab, newline, DEL, C1, line/paragraph separators) are rejected", () => {
    for (const f of fields) for (const t of ["a\u0000b", "a\tb", "a\nb", "a\rb", "a\u007fb", "a\u0085b", "a\u2028b", "a\u2029b"]) assert.equal(reason(validateJsonEndpointPayload(withField({ [f]: t }))), codeOf[f], JSON.stringify(t));
  });

  it("a plain ampersand and ordinary punctuation are fine", () => {
    assert.equal(ok(validateJsonEndpointPayload(withField({ headline: "Q&A: 50% off, today!" }))).headline, "Q&A: 50% off, today!");
  });
});

describe("day 24 part 1 | executable fields", () => {
  it("every executable key rejects the whole payload, in any letter case", () => {
    assert.ok(JSON_ENDPOINT_EXECUTABLE_KEYS.size >= 15);
    for (const key of JSON_ENDPOINT_EXECUTABLE_KEYS) {
      for (const k of [key, key.toUpperCase(), key[0].toUpperCase() + key.slice(1)]) {
        assert.equal(reason(validateJsonEndpointPayload(withField({ [k]: "x" }))), "executable_field", k);
        assert.equal(reason(validateJsonEndpointText(JSON.stringify(withField({ [k]: "x" })))), "executable_field", k);
      }
    }
  });

  it("an executable key is rejected even when its value is empty or null", () => {
    for (const v of ["", null, 0, false, {}, []]) assert.equal(reason(validateJsonEndpointPayload(withField({ html: v }))), "executable_field");
  });

  it("executable keys are caught before field checks, so one fixed code comes back", () => {
    assert.equal(reason(validateJsonEndpointPayload({ script: "x" })), "executable_field");
  });

  it("the key list matches what the existing adapter rejects (no drift)", () => {
    for (const key of JSON_ENDPOINT_EXECUTABLE_KEYS) {
      assert.equal(extractReviveCreative({ provider: "revive", format: "json", data: withField({ [key]: "x" }) }).ok, false, key);
    }
    for (const key of ["price", "advertiser", "id", "extra"]) {
      assert.equal(extractReviveCreative({ provider: "revive", format: "json", data: withField({ [key]: "x" }) }).ok, true, key);
      assert.equal(validateJsonEndpointPayload(withField({ [key]: "x" })).ok, true, key);
    }
  });
});

describe("day 24 part 1 | compatible with the existing creative path", () => {
  const cases: Record<string, unknown>[] = [
    good,
    without("cta_text"),
    withField({ cta_text: null }),
    withField({ cta_text: "  " }),
    withField({ headline: "<b>x</b>" }),
    withField({ body: "a &amp; b" }),
    withField({ body: "a\nb" }),
    withField({ headline: "h".repeat(HEADLINE_MAX + 1) }),
    withField({ cta_text: "c".repeat(CTA_MAX + 1) }),
    withField({ destination_url: "http://example.com" }),
    withField({ destination_url: "https://u:p@example.com" }),
    withField({ html: "<p>x</p>" }),
    withField({ extra: 1 }),
    without("headline"),
    without("destination_url"),
  ];

  it("accepts and rejects exactly like extractReviveCreative + buildProviderAdResponse, with the same values", () => {
    for (const data of cases) {
      const mine = validateJsonEndpointPayload(data);
      const ex = extractReviveCreative({ provider: "revive", format: "json", data });
      const built = ex.ok ? buildProviderAdResponse(ex.provider, ex.creative) : null;
      assert.equal(mine.ok, built !== null && built.ok, JSON.stringify(data));
      if (mine.ok && built !== null && built.ok) {
        assert.equal(mine.creative.headline, built.response.ad.headline);
        assert.equal(mine.creative.body, built.response.ad.body);
        assert.equal(mine.creative.ctaText, built.response.ad.cta_text);
        assert.equal(mine.creative.destinationUrl, built.response.ad.destination_url);
      }
    }
  });

  it("a valid result can be fed straight into buildProviderAdResponse", () => {
    const r = validateJsonEndpointPayload(good);
    assert.ok(r.ok);
    const built = buildProviderAdResponse("revive", r.creative);
    assert.ok(built.ok);
    assert.equal("tracking" in built.response, false);
  });
});

describe("day 24 part 1 | secret-safe errors", () => {
  const dirty = {
    headline: `<b>${SECRET}</b>`,
    body: `body ${SECRET} &amp;`,
    cta_text: `<i>${SECRET}</i>`,
    destination_url: `http://user:${SECRET}@example.com/a?token=${SECRET}`,
    script: SECRET,
  };
  const inputs: Array<[string, () => ReturnType<typeof validateJsonEndpointPayload>]> = [
    ["dirty payload", () => validateJsonEndpointPayload(dirty)],
    ["bad headline", () => validateJsonEndpointPayload(withField({ headline: `<b>${SECRET}</b>` }))],
    ["bad body", () => validateJsonEndpointPayload(withField({ body: `${SECRET} &amp;` }))],
    ["bad cta", () => validateJsonEndpointPayload(withField({ cta_text: `<i>${SECRET}</i>` }))],
    ["bad destination", () => validateJsonEndpointPayload(withField({ destination_url: `https://u:${SECRET}@example.com/?token=${SECRET}` }))],
    ["executable key name", () => validateJsonEndpointPayload(withField({ [`script`]: SECRET }))],
    ["unknown key name strict", () => validateJsonEndpointPayload(withField({ [`k_${SECRET}`]: 1 }), { strictFields: true })],
    ["invalid JSON text", () => validateJsonEndpointText(`{"destination_url":"https://example.com/?token=${SECRET}"`)],
    ["not an object text", () => validateJsonEndpointText(`"${SECRET}"`)],
    ["oversize text", () => validateJsonEndpointText(JSON.stringify({ ...good, pad: SECRET.repeat(8000) }))],
    ["invalid utf8 bytes", () => validateJsonEndpointText(new Uint8Array([...enc(SECRET), 0xff]))],
  ];

  it("a failure is only { ok:false, reason } with a fixed reason code and never contains the input", () => {
    for (const [name, run] of inputs) {
      const r = run();
      assert.equal(r.ok, false, name);
      assert.ok(!r.ok);
      assert.deepEqual(Object.keys(r), ["ok", "reason"], name);
      assert.ok((JSON_ENDPOINT_REASONS as readonly string[]).includes(r.reason), name);
      const shown = [JSON.stringify(r), String(r.reason), JSON.stringify(Object.getOwnPropertyNames(r))].join(" ");
      assert.ok(!shown.includes(SECRET), name);
      assert.ok(!/token|user:|example\.com|<b>|http/i.test(shown), name);
    }
  });

  it("failures are shared frozen constants: nothing from the input can be attached", () => {
    const a = validateJsonEndpointPayload(withField({ headline: `<b>${SECRET}</b>` }));
    const b = validateJsonEndpointPayload(withField({ headline: "<i>other</i>" }));
    assert.equal(a, b);
    assert.ok(Object.isFrozen(a));
  });

  it("every reason code is a short fixed lowercase identifier", () => {
    for (const r of JSON_ENDPOINT_REASONS) assert.match(r, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    assert.equal(new Set(JSON_ENDPOINT_REASONS).size, JSON_ENDPOINT_REASONS.length);
  });

  it("a success holds the destination, but its JSON never contains the invalid input's secrets", () => {
    const r = validateJsonEndpointPayload(good);
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });

  it("never throws on hostile input: throwing getters, proxies, BigInt, circular objects, huge nesting", () => {
    const getter = {
      get headline(): string {
        throw new Error(`boom ${SECRET}`);
      },
    };
    const circ: Record<string, unknown> = { ...good };
    circ.self = circ;
    const proxy = new Proxy({}, { ownKeys() { throw new Error(SECRET); } });
    for (const v of [getter, circ, proxy, { ...good, n: BigInt(1) }, Object.create(null), new Date(), () => 1, Symbol("s")]) {
      let r: ReturnType<typeof validateJsonEndpointPayload> | undefined;
      assert.doesNotThrow(() => {
        r = validateJsonEndpointPayload(v);
      });
      assert.ok(r && !JSON.stringify(r).includes(SECRET));
    }
    assert.doesNotThrow(() => validateJsonEndpointText(Symbol("s")));
  });

  it("__proto__ and constructor keys in JSON text do not break validation or pollute anything", () => {
    const r = validateJsonEndpointText(`{"__proto__":{"polluted":true},"headline":"h","body":"b","destination_url":"https://example.com/a"}`);
    assert.equal(r.ok, true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

describe("day 24 part 1 | scope: not wired in, no side effects", () => {
  const src = readFileSync(path.join(ROOT, MODULE), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("imports only the existing pure creative rules and the safe-destination rule", () => {
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ["../campaigns/creative-validation", "./click"]);
  });

  it("the code never uses the word Revive (the old source-scan boundary tests stay untouched and green)", () => {
    assert.doesNotMatch(code, /revive/i);
  });

  it("does not touch env, network, database, billing, ledger, tracking or logging", () => {
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(|supabase|\bsql\b|ledger|billing|payout|console\.|\brequire\s*\(/i);
    assert.doesNotMatch(code, /REVIVE_FALLBACK_ENABLED|REVIVE_DELIVERY_URL/);
  });

  it("no production file imports the validator (serving, fallback and match route are unchanged)", () => {
    const walk = (dir: string): string[] =>
      existsSync(path.join(ROOT, dir))
        ? readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`],
          )
        : [];
    for (const f of [...walk("lib"), ...walk("app"), ...walk("components"), "middleware.ts"]) {
      if (f === MODULE || f === "lib/ads/revive-json-preview.ts" || !/\.(ts|tsx)$/.test(f)) continue; // Day 24 Part 2: alag flag wala preview prototype ise import karta hai
      assert.doesNotMatch(readFileSync(path.join(ROOT, f), "utf8"), /revive-json-endpoint-contract/, f);
    }
  });

  it("the guide's documented limits and fields match this validator", () => {
    const guide = readFileSync(path.join(ROOT, "REVIVE-JSON-ENDPOINT-SETUP.md"), "utf8").replace(/\s+/g, " ");
    assert.match(guide, /65,536 bytes/);
    for (const f of JSON_ENDPOINT_ALLOWED_FIELDS) assert.match(guide, new RegExp(`\`${f}\``));
    for (const k of ["html", "script", "iframe", "adm"]) assert.ok(JSON_ENDPOINT_EXECUTABLE_KEYS.has(k));
    assert.match(guide, new RegExp(`max ${HEADLINE_MAX} characters`));
    assert.match(guide, new RegExp(`max ${BODY_MAX} characters`));
    assert.match(guide, new RegExp(`max ${CTA_MAX} characters`));
    assert.match(guide, new RegExp(`max ${MAX_DESTINATION_LENGTH} characters`));
  });
});
