import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CLICK_REF_PREFIX,
  creativeTag,
  mintClickRef,
  verifyClickRef,
  verifyClickRefForServe,
  type ClickServeLookup,
} from "@/lib/ads/click-ref";
import {
  MAX_TTL_SECONDS,
  mintTrackingToken,
  publisherTag,
  verifyTrackingToken,
  type TrackingConfig,
} from "@/lib/ads/tracking-token";

// Day 12 Prompt 5 Part 2: click reference. Database NAKLI hai (lookup inject hota hai); asli Supabase / production kabhi nahi chhuta.
// Redirect route, click writer, destination URL: is part me kuch nahi, isliye tests bhi sirf ref ke signature / expiry / binding jaanchte hain.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const SECRET = "k7f2-0123456789-abcdefghijklmnopqrstuvwxyz-primary";
const OTHER_SECRET = "m4q9-0123456789-abcdefghijklmnopqrstuvwxyz-rotated";
const REF = `bsr_${"ab".repeat(20)}`;
const PUB = "00000000-0000-4000-8000-0000000000a1";
const PUB_2 = "00000000-0000-4000-8000-0000000000a2";
const CREATIVE = "00000000-0000-4000-8000-0000000000c1";
const CREATIVE_2 = "00000000-0000-4000-8000-0000000000c2";
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);

const config = (over: Partial<TrackingConfig> = {}): TrackingConfig => ({ secrets: [SECRET], ttlSeconds: 3600, ...over });
const mint = (over: Partial<Parameters<typeof mintClickRef>[1]> = {}, cfg: TrackingConfig = config()) =>
  mintClickRef(cfg, { serveRef: REF, publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, nowMs: NOW + 5_000, ...over });
const mustMint = (over: Partial<Parameters<typeof mintClickRef>[1]> = {}, cfg: TrackingConfig = config()) => {
  const g = mint(over, cfg);
  assert.ok(g, "mint should succeed");
  return g.ref;
};

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const payloadOf = (ref: string) => JSON.parse(Buffer.from(ref.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
/** Apna payload apne secret se sign karke (test me jaali ref banane ke liye). */
function forge(payload: unknown, secret = SECRET): string {
  const p = b64u(typeof payload === "string" ? payload : JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`blisscco:click:bc1:${p}`, "utf8").digest("base64url");
  return `bc1.${p}.${sig}`;
}
const goodClaims = (over: Record<string, unknown> = {}) => ({
  v: 1, r: REF, p: publisherTag(SECRET, PUB), c: creativeTag(SECRET, CREATIVE), iat: NOW / 1000, exp: NOW / 1000 + 3600, ...over,
});

const serveRow = (over: Partial<{ publisherId: string; creativeId: string; servedAtMs: number }> = {}) => ({
  publisherId: PUB, creativeId: CREATIVE, servedAtMs: NOW, ...over,
});
const lookupOf = (row: ReturnType<typeof serveRow> | null): ClickServeLookup => async () => row;

describe("day 12 prompt 5 part 2 | valid click ref", () => {
  it("mint -> verify roundtrip gives the same serve_ref, tags and expiry", () => {
    const g = mint();
    assert.ok(g);
    assert.ok(g.ref.startsWith(`${CLICK_REF_PREFIX}.`));
    assert.equal(g.ref.split(".").length, 3);
    assert.equal(g.expiresAtMs, NOW + 3_600_000);
    const v = verifyClickRef(g.ref, config(), NOW + 10_000);
    assert.ok(v.ok);
    if (v.ok) {
      assert.equal(v.claims.serveRef, REF);
      assert.equal(v.claims.publisherTag, publisherTag(SECRET, PUB));
      assert.equal(v.claims.creativeTag, creativeTag(SECRET, CREATIVE));
      assert.equal(v.claims.expiresAtMs, NOW + 3_600_000);
      assert.equal(v.claims.secretIndex, 0);
    }
  });

  it("is deterministic for the same serve and differs for another creative", () => {
    assert.equal(mustMint(), mustMint({ nowMs: NOW + 60_000 }));
    assert.notEqual(mustMint(), mustMint({ creativeId: CREATIVE_2 }));
  });

  it("payload holds no raw publisher/creative id, destination, or url; token fits the length limit", () => {
    const ref = mustMint();
    const text = Buffer.from(ref.split(".")[1], "base64url").toString("utf8");
    assert.ok(!text.includes(PUB) && !text.includes(CREATIVE));
    assert.ok(!/http|url|destination|campaign|spend/i.test(text));
    assert.deepEqual(Object.keys(payloadOf(ref)).sort(), ["c", "exp", "iat", "p", "r", "v"]);
    assert.ok(ref.length <= 512);
  });

  it("verifies against the real serve row (publisher + creative from the database)", async () => {
    const r = await verifyClickRefForServe(mustMint(), { config: config(), nowMs: NOW + 1000, lookupServe: lookupOf(serveRow()) });
    assert.deepEqual(r, { ok: true, serveRef: REF, publisherId: PUB, creativeId: CREATIVE });
  });

  it("an optional claimed creative id must equal the served creative", async () => {
    const deps = { config: config(), nowMs: NOW + 1000, lookupServe: lookupOf(serveRow()) };
    const ok = await verifyClickRefForServe(mustMint(), { ...deps, claimedCreativeId: CREATIVE.toUpperCase() });
    assert.ok(ok.ok);
    const bad = await verifyClickRefForServe(mustMint(), { ...deps, claimedCreativeId: CREATIVE_2 });
    assert.deepEqual(bad, { ok: false, reason: "creative_mismatch" });
    const junk = await verifyClickRefForServe(mustMint(), { ...deps, claimedCreativeId: "not-a-uuid" });
    assert.deepEqual(junk, { ok: false, reason: "creative_mismatch" });
  });

  it("a previous (rotated) secret still verifies, new refs always use the current secret", async () => {
    const old = mustMint({}, config({ secrets: [OTHER_SECRET] }));
    const rotated = config({ secrets: [SECRET, OTHER_SECRET] });
    const v = verifyClickRef(old, rotated, NOW + 1000);
    assert.ok(v.ok && v.claims.secretIndex === 1);
    // creative/publisher tag purane secret se hi milaye jaate hain
    const row = lookupOf(serveRow());
    assert.ok((await verifyClickRefForServe(old, { config: rotated, nowMs: NOW + 1000, lookupServe: row })).ok);
    const fresh = mustMint({}, rotated);
    const f = verifyClickRef(fresh, rotated, NOW + 1000);
    assert.ok(f.ok && f.claims.secretIndex === 0);
    assert.equal(verifyClickRef(fresh, config({ secrets: [OTHER_SECRET] }), NOW + 1000).ok, false);
  });
});

describe("day 12 prompt 5 part 2 | invalid click ref", () => {
  it("rejects non-strings, empty, oversized, wrong shape and wrong prefix as malformed", () => {
    const good = mustMint();
    const [, p, s] = good.split(".");
    const cases: unknown[] = [undefined, null, 5, {}, [], "", "x", "bc1", "bc1.a.b", `bc1.${p}`, `bc1.${p}.${s}.extra`,
      `bt1.${p}.${s}`, `BC1.${p}.${s}`, `bc1.${p}=.${s}`, `bc1.${p}.${s}=`, `bc1.${p}.${"A".repeat(600)}`, `bc1.${p}.${s.slice(0, -2)}`, "a".repeat(5000)];
    for (const c of cases) {
      const r = verifyClickRef(c, config(), NOW + 1000);
      assert.equal(r.ok, false, String(c).slice(0, 30));
      if (!r.ok) assert.equal(r.reason, "malformed");
    }
  });

  it("rejects a ref signed with an unknown secret", () => {
    const r = verifyClickRef(mustMint({}, config({ secrets: [OTHER_SECRET] })), config(), NOW + 1000);
    assert.deepEqual(r, { ok: false, reason: "invalid_signature" });
  });

  it("a tracking (bt1) token is NOT a click ref, and a click ref is NOT a tracking token", () => {
    const bt = mintTrackingToken(config(), { serveRef: REF, publisherId: PUB, servedAtMs: NOW, nowMs: NOW + 5000 });
    assert.ok(bt);
    assert.equal(verifyClickRef(bt.token, config(), NOW + 1000).ok, false);
    // bt1 payload + signature ko bc1 prefix laga kar bhi nahi chalta (alag signing label)
    const [, p, s] = bt.token.split(".");
    assert.equal(verifyClickRef(`bc1.${p}.${s}`, config(), NOW + 1000).ok, false);
    assert.equal(verifyTrackingToken(mustMint(), "click", config(), NOW + 1000).ok, false);
  });

  it("a validly signed payload with wrong fields is malformed", () => {
    const base = goodClaims();
    const bads: unknown[] = [
      { ...base, v: 2 }, { ...base, r: "bsr_xyz" }, { ...base, r: REF.toUpperCase() }, { ...base, p: "short" }, { ...base, c: "ZZ".repeat(16) },
      { ...base, c: undefined }, { ...base, iat: "1" }, { ...base, exp: 1.5 }, { ...base, exp: base.iat }, { ...base, exp: base.iat + MAX_TTL_SECONDS + 1 },
      { ...base, extra: 1 }, { ...base, e: ["click"] }, [], "oops", null,
    ];
    for (const b of bads) {
      const r = verifyClickRef(forge(b), config(), NOW + 1000);
      assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 60));
      if (!r.ok) assert.equal(r.reason, "malformed");
    }
    assert.equal(verifyClickRef(forge("{not json"), config(), NOW + 1000).ok, false);
    assert.ok(verifyClickRef(forge(goodClaims()), config(), NOW + 1000).ok); // control: sahi claims chalte hain
  });

  it("mint refuses bad input (null) instead of issuing a ref", () => {
    for (const over of [{ serveRef: "bsr_1" }, { serveRef: "" }, { publisherId: "nope" }, { creativeId: "nope" }, { creativeId: "" },
      { servedAtMs: NaN }, { nowMs: Infinity }, { servedAtMs: NOW + 3_600_000 }]) {
      assert.equal(mint(over), null, JSON.stringify(over));
    }
    assert.equal(mint({}, { secrets: [], ttlSeconds: 3600 }), null);
  });

  it("unknown serve, database failure and malformed database rows never pass", async () => {
    const ref = mustMint();
    const deps = { config: config(), nowMs: NOW + 1000 };
    assert.deepEqual(await verifyClickRefForServe(ref, { ...deps, lookupServe: lookupOf(null) }), { ok: false, reason: "unknown_serve" });
    assert.deepEqual(await verifyClickRefForServe(ref, { ...deps, lookupServe: async () => { throw new Error("db down"); } }), { ok: false, reason: "unavailable" });
    for (const row of [serveRow({ publisherId: "x" }), serveRow({ creativeId: "x" }), serveRow({ servedAtMs: NaN })]) {
      assert.deepEqual(await verifyClickRefForServe(ref, { ...deps, lookupServe: lookupOf(row) }), { ok: false, reason: "unavailable" });
    }
  });

  it("the ref is not accepted for another publisher, another creative, or another serve time", async () => {
    const ref = mustMint();
    const deps = { config: config(), nowMs: NOW + 1000 };
    assert.deepEqual(await verifyClickRefForServe(ref, { ...deps, lookupServe: lookupOf(serveRow({ publisherId: PUB_2 })) }), { ok: false, reason: "publisher_mismatch" });
    assert.deepEqual(await verifyClickRefForServe(ref, { ...deps, lookupServe: lookupOf(serveRow({ creativeId: CREATIVE_2 })) }), { ok: false, reason: "creative_mismatch" });
    assert.deepEqual(await verifyClickRefForServe(ref, { ...deps, lookupServe: lookupOf(serveRow({ servedAtMs: NOW + 5000 })) }), { ok: false, reason: "serve_mismatch" });
  });
});

describe("day 12 prompt 5 part 2 | expired click ref", () => {
  it("is valid just before exp and expired exactly at and after exp", () => {
    const ref = mustMint();
    assert.ok(verifyClickRef(ref, config(), NOW + 3_599_999).ok);
    assert.deepEqual(verifyClickRef(ref, config(), NOW + 3_600_000), { ok: false, reason: "expired" });
    assert.deepEqual(verifyClickRef(ref, config(), NOW + 86_400_000), { ok: false, reason: "expired" });
  });

  it("expiry is tied to serve time: a late retry cannot mint a fresh ref for an old serve", () => {
    assert.equal(mint({ nowMs: NOW + 3_600_000 }), null);
    assert.equal(mint({ nowMs: NOW + 2 * 86_400_000 }), null);
  });

  it("expiry follows the configured TTL (and an overlong signed lifetime is malformed)", () => {
    const short = mustMint({}, config({ ttlSeconds: 60 }));
    assert.ok(verifyClickRef(short, config(), NOW + 59_000).ok);
    assert.equal(verifyClickRef(short, config(), NOW + 60_000).ok, false);
  });

  it("an expired ref is rejected before any database lookup", async () => {
    let called = 0;
    const r = await verifyClickRefForServe(mustMint(), {
      config: config(), nowMs: NOW + 3_600_000, lookupServe: async () => { called += 1; return serveRow(); },
    });
    assert.deepEqual(r, { ok: false, reason: "expired" });
    assert.equal(called, 0);
  });

  it("a ref issued in the future (beyond clock skew) is not_yet_valid", () => {
    const future = forge(goodClaims({ iat: (NOW + 120_000) / 1000, exp: (NOW + 120_000) / 1000 + 3600 }));
    assert.deepEqual(verifyClickRef(future, config(), NOW), { ok: false, reason: "not_yet_valid" });
    const skew = forge(goodClaims({ iat: (NOW + 30_000) / 1000, exp: (NOW + 30_000) / 1000 + 3600 }));
    assert.ok(verifyClickRef(skew, config(), NOW).ok);
  });
});

describe("day 12 prompt 5 part 2 | tampered click ref", () => {
  it("any change to payload (creative, publisher, serve_ref, expiry) with the old signature is invalid_signature", () => {
    const ref = mustMint();
    const [prefix, , sig] = ref.split(".");
    const original = payloadOf(ref);
    const edits: Record<string, unknown>[] = [
      { c: creativeTag(SECRET, CREATIVE_2) },
      { p: publisherTag(SECRET, PUB_2) },
      { r: `bsr_${"cd".repeat(20)}` },
      { exp: (original.exp as number) + 86_000 },
      { iat: (original.iat as number) + 1 },
    ];
    for (const e of edits) {
      const tampered = `${prefix}.${b64u(JSON.stringify({ ...original, ...e }))}.${sig}`;
      assert.deepEqual(verifyClickRef(tampered, config(), NOW + 1000), { ok: false, reason: "invalid_signature" }, JSON.stringify(e));
    }
  });

  it("flipping any signature character (or swapping signatures between refs) fails", () => {
    const ref = mustMint();
    const [prefix, payload, sig] = ref.split(".");
    for (const i of [0, 7, sig.length - 1]) {
      const flipped = sig.slice(0, i) + (sig[i] === "A" ? "B" : "A") + sig.slice(i + 1);
      const r = verifyClickRef(`${prefix}.${payload}.${flipped}`, config(), NOW + 1000);
      assert.equal(r.ok, false);
    }
    const other = mustMint({ creativeId: CREATIVE_2 });
    assert.deepEqual(verifyClickRef(`${prefix}.${payload}.${other.split(".")[2]}`, config(), NOW + 1000), { ok: false, reason: "invalid_signature" });
  });

  it("re-encoded (non-canonical) payload or signature is malformed, not accepted", () => {
    const ref = mustMint();
    const [prefix, payload, sig] = ref.split(".");
    const std = Buffer.from(payload, "base64url").toString("base64"); // padding / + / / wala roop
    const padded = std.endsWith("=") ? std : `${std}==`;
    assert.equal(verifyClickRef(`${prefix}.${padded}.${sig}`, config(), NOW + 1000).ok, false);
    assert.equal(verifyClickRef(`${prefix}.${payload}.${sig}=`, config(), NOW + 1000).ok, false);
    assert.equal(verifyClickRef(` ${ref}`, config(), NOW + 1000).ok, false);
    assert.equal(verifyClickRef(`${ref}\n`, config(), NOW + 1000).ok, false);
  });

  it("a ref made for creative A cannot be re-pointed at creative B even with a matching claimed id (no destination from caller)", async () => {
    // Attacker ke paas creative A ka ref hai, DB me serve creative A ki hai, par caller creative B (jis ka destination use chahiye) bata raha hai.
    const r = await verifyClickRefForServe(mustMint(), {
      config: config(), nowMs: NOW + 1000, lookupServe: lookupOf(serveRow()), claimedCreativeId: CREATIVE_2,
    });
    assert.deepEqual(r, { ok: false, reason: "creative_mismatch" });
  });

  it("creative and publisher tags are not interchangeable (domain separation)", () => {
    assert.notEqual(creativeTag(SECRET, CREATIVE), publisherTag(SECRET, CREATIVE));
    const swapped = forge(goodClaims({ p: creativeTag(SECRET, PUB), c: publisherTag(SECRET, CREATIVE) }));
    // signature sahi hai par tag galat jagah: DB milan me fail
    return verifyClickRefForServe(swapped, { config: config(), nowMs: NOW + 1000, lookupServe: lookupOf(serveRow()) }).then((r) => {
      assert.equal(r.ok, false);
    });
  });

  it("verify never throws on hostile input", () => {
    const hostile: unknown[] = ["bc1..", "bc1...", "bc1.%%%.%%%", "bc1.__proto__.__proto__", { toString() { throw new Error("x"); } }, Symbol.iterator as unknown];
    for (const h of hostile) assert.doesNotThrow(() => verifyClickRef(h, config(), NOW));
    assert.equal(verifyClickRef(mustMint(), config(), Number.NaN).ok, false);
  });
});

describe("day 12 prompt 5 part 2 | secret and browser safety (static)", () => {
  const src = read("lib/ads/click-ref.ts");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("click-ref.ts reads no env, has no secret literal, no NEXT_PUBLIC, no client marker", () => {
    assert.ok(!/process\.env/.test(code));
    assert.ok(!/NEXT_PUBLIC_/.test(code));
    assert.ok(!/["']use client["']/.test(src));
    assert.ok(!/console\./.test(code));
    assert.ok(!/AD_TRACKING_SECRET/.test(code));
  });

  it("no destination / redirect / network / database code in the helper", () => {
    assert.ok(!/destination_url|destinationUrl|NextResponse|redirect\(|fetch\(|createAdminClient|supabase|rpc\(/i.test(code));
  });

  it("only the existing server-only secret name is used and no route imports the click helper yet", () => {
    assert.ok(/AD_TRACKING_SECRET/.test(read("lib/ads/service.ts")));
    for (const f of ["app/api/ads/match/route.ts", "app/api/v1/ads/match/route.ts", "app/api/v1/ads/impression/route.ts", "lib/ads/match-handler.ts", "lib/ads/service.ts", "lib/ads/contract.ts"]) {
      assert.ok(!/click-ref/.test(read(f)), `${f} must not import click-ref yet`);
    }
  });

  it("existing tracking-token behaviour is untouched: only helpers were exported", () => {
    const tt = read("lib/ads/tracking-token.ts");
    assert.ok(/export function hmac\(/.test(tt) && /export function safeEqual\(/.test(tt) && /export function decodeCanonicalB64Url\(/.test(tt));
    assert.ok(/export const CLOCK_SKEW_SECONDS = 60/.test(tt));
  });
});
