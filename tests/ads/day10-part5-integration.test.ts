import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as legacyRoute from "@/app/api/ads/match/route";
import * as v1Route from "@/app/api/v1/ads/match/route";
import { handleMatchPost } from "@/lib/ads/match-handler";
import { createIpGuard } from "@/lib/ads/ip-guard";
import { PUBLIC_AD_FIELDS } from "@/lib/ads/contract";
import { FakeAdDb, makeKey, sha256 } from "./fake-ad-db";

// Day 10 Part 5: publisher ad API ke integration tests (route -> handler -> key check -> validation -> category -> selection -> record).
// Database NAKLI aur STATEFUL hai (tests/ads/fake-ad-db.ts): SQL ke rules Node me dohraye gaye hain. Asli Supabase, asli keys ya
// production traffic kabhi nahi. SQL ka asli check: tests/integration/day10-part5-db.test.ts (sirf TEST database par, warna skip).
// Har response `send()` se guzarta hai, jo contract (status, headers, exact JSON shape, leak scan) apne aap check karta hai.

type RouteDef = { name: string; post: (r: Request) => Promise<Response>; versioned: boolean };
const ROUTES: RouteDef[] = [
  { name: "/api/ads/match (legacy)", post: legacyRoute.POST, versioned: false },
  { name: "/api/v1/ads/match", post: v1Route.POST, versioned: true },
];

const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
const realError = console.error;
let logged: unknown[][] = [];
let db: FakeAdDb;

const KEY_A = makeKey("a");
const KEY_B = makeKey("b");
const KEY_UNKNOWN = makeKey("9");

type Sent = { res: Response; body: Record<string, unknown>; text: string };

const REASONS = ["invalid_json", "invalid_body", "unknown_field", "invalid_topic", "invalid_exclude_ad_ids", "unreadable_body", "invalid_idempotency_key"];
const FORBIDDEN_KEYS = [
  "publisher_id", "publisher", "advertiser", "advertiser_id", "campaign", "campaign_id", "budget", "total_budget", "daily_budget",
  "spend", "spent", "spent_total", "cpm", "unit_cost_usd", "key", "key_hash", "hash", "email", "status", "creative_id", "category",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function collectKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => collectKeys(x, out));
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      collectKeys(x, out);
    }
  }
  return out;
}

/** Har response ka contract: status/body shape, headers, aur koi andar ki cheez bahar nahi. */
function assertContract(route: RouteDef, res: Response, body: Record<string, unknown>, text: string): void {
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("vary"), "Authorization");
  assert.equal(res.headers.get("x-blisscco-api-version"), route.versioned ? "1" : null);
  assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS: keys must stay server side");

  switch (res.status) {
    case 200:
      if (body.fill === false) {
        assert.deepEqual(body, { fill: false });
      } else {
        assert.deepEqual(Object.keys(body).sort(), ["ad", "fill", "sponsored"]);
        assert.equal(body.fill, true);
        assert.equal(body.sponsored, true);
        const ad = body.ad as Record<string, unknown>;
        assert.deepEqual(Object.keys(ad).sort(), [...PUBLIC_AD_FIELDS].sort());
        assert.match(String(ad.id), UUID_RE);
        assert.equal(typeof ad.headline, "string");
        assert.equal(typeof ad.body, "string");
        assert.ok(ad.cta_text === null || typeof ad.cta_text === "string");
        assert.match(String(ad.destination_url), /^https:\/\//);
      }
      break;
    case 400:
      assert.deepEqual(Object.keys(body).sort(), ["error", "reason"]);
      assert.equal(body.error, "invalid_request");
      assert.ok(REASONS.includes(String(body.reason)), `unknown reason ${String(body.reason)}`);
      break;
    case 401:
      assert.deepEqual(body, { error: "unauthorized" });
      assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="blisscco-ads"');
      break;
    case 413:
      assert.deepEqual(body, { error: "payload_too_large" });
      break;
    case 415:
      assert.deepEqual(body, { error: "unsupported_media_type" });
      break;
    case 429:
      assert.deepEqual(body, { error: "rate_limited" });
      assert.equal(res.headers.get("retry-after"), "60");
      break;
    case 503:
      assert.deepEqual(body, { fill: false, error: "unavailable" });
      break;
    default:
      assert.fail(`status ${res.status} is not part of the contract`);
  }

  // Leak scan: sirf ad ke 5 public fields; koi andar ka field-naam / id / key / hash nahi.
  const keys = collectKeys(body).filter((k) => !(PUBLIC_AD_FIELDS as readonly string[]).includes(k));
  for (const k of keys) assert.equal(FORBIDDEN_KEYS.includes(k), false, `forbidden field "${k}" in response`);
  assert.equal(text.includes("blc_live_"), false, "response must never echo a key");
  assert.equal(/[0-9a-f]{64}/.test(text), false, "response must never contain a hash or key material");
  for (const id of db.allPublisherIds()) assert.equal(text.includes(id), false, "publisher id leaked");
}

function build(body: string | undefined, key: string | null, headers: Record<string, string>): Request {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (key) h.authorization = `Bearer ${key}`;
  return new Request("https://example.test/api/ads/match", { method: "POST", headers: h, body });
}

async function send(
  route: RouteDef,
  body: unknown,
  opts: { key?: string | null; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<Sent> {
  const payload = opts.raw ? (body as string) : JSON.stringify(body);
  const key = opts.key === undefined ? KEY_A : opts.key;
  const res = await route.post(build(payload, key, opts.headers ?? {}));
  const text = await res.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assertContract(route, res, parsed, text);
  return { res, body: parsed, text };
}

const adId = (s: Sent): string => (s.body.ad as { id: string }).id;

beforeEach(() => {
  logged = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  db = new FakeAdDb();
  globals.__TEST_SUPABASE__ = db.client();
});
afterEach(() => {
  console.error = realError;
});

/** Ek active publisher (KEY_A) + ek active advertiser jiska ek gaming ad hai. */
function world() {
  const pub = db.addPublisher("active");
  db.addKey(pub.id, KEY_A);
  const adv = db.addAdvertiser("active");
  const ad = db.addAd(adv.id, { category: "gaming" });
  return { pub, adv, ad };
}

for (const route of ROUTES) {
  describe(`part 5 | ${route.name}`, () => {
    // ------------------------------------------------------------------ valid key
    describe("valid approved publisher and key", () => {
      it("serves a sponsored ad; the serve is attributed to this publisher and charged once", async () => {
        const { pub, ad } = world();
        const r = await send(route, { topic: "gaming" });
        assert.equal(r.res.status, 200);
        assert.equal(r.body.fill, true);
        assert.equal(adId(r), ad.creativeId);
        assert.deepEqual(db.servesFor(pub.id).map((s) => s.creativeId), [ad.creativeId]);
        assert.equal(db.spendOf(ad.campaignId), db.unitCostUsd);
        assert.deepEqual(db.calls.map((c) => c.name), ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
      });

      it("topic aliases map to the canonical category (games -> gaming)", async () => {
        world();
        const r = await send(route, { topic: "games" });
        assert.equal(r.body.fill, true);
      });

      it("only the SHA-256 hash of the key ever reaches the database", async () => {
        world();
        await send(route, { topic: "gaming" });
        const text = JSON.stringify(db.calls);
        assert.equal(text.includes(KEY_A), false);
        assert.ok(text.includes(sha256(KEY_A)));
      });
    });

    // ------------------------------------------------------------------ invalid / revoked / expired keys
    describe("invalid, revoked and expired keys", () => {
      it("unknown, wrongly formatted and missing keys all get the same 401", async () => {
        world();
        const seen: string[] = [];
        for (const key of [KEY_UNKNOWN, `blc_live_${"A".repeat(64)}`, `blc_live_${"a".repeat(63)}`, "garbage", null]) {
          const r = await send(route, { topic: "gaming" }, { key });
          assert.equal(r.res.status, 401, String(key));
          seen.push(r.text);
        }
        assert.equal(new Set(seen).size, 1, "no oracle: every 401 body is identical");
        assert.equal(db.serveLog.length, 0);
      });

      it("malformed keys never reach the database; well-formed unknown keys do exactly one authorize call and stop", async () => {
        world();
        await send(route, { topic: "gaming" }, { key: "garbage" });
        await send(route, { topic: "gaming" }, { key: null });
        assert.equal(db.calls.length, 0);
        await send(route, { topic: "gaming" }, { key: KEY_UNKNOWN });
        assert.deepEqual(db.calls.map((c) => c.name), ["authorize_publisher_key"]);
      });

      it("Authorization header shapes: lowercase bearer works, other schemes / extra tokens / empty are 401", async () => {
        world();
        const ok = await route.post(build(JSON.stringify({ topic: "gaming" }), null, { authorization: `bearer ${KEY_A}` }));
        assert.equal(ok.status, 200);
        for (const value of [`Basic ${KEY_A}`, `Bearer ${KEY_A} extra`, "Bearer", "", KEY_A, `Token ${KEY_A}`]) {
          const r = await send(route, { topic: "gaming" }, { key: null, headers: { authorization: value } });
          assert.equal(r.res.status, 401, JSON.stringify(value));
        }
      });

      it("a revoked key stops working immediately (and the revoked key does not leak that it once existed)", async () => {
        world();
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        db.revokeKey(KEY_A);
        const r = await send(route, { topic: "gaming" });
        assert.equal(r.res.status, 401);
        assert.equal(db.serveLog.length, 1, "no serve after revoke");
        const unknown = await send(route, { topic: "gaming" }, { key: KEY_UNKNOWN });
        assert.equal(r.text, unknown.text);
      });

      it("an expired key is rejected; before expiry it works", async () => {
        const pub = db.addPublisher("active");
        db.addKey(pub.id, KEY_A, { expiresInMs: 90_000 });
        db.addAd(db.addAdvertiser().id);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        db.advanceMinutes(2);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 401);
      });

      it("a revoked key does not affect another key of the same publisher", async () => {
        const { pub } = world();
        db.addKey(pub.id, KEY_B);
        db.revokeKey(KEY_A);
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_A })).res.status, 401);
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_B })).res.status, 200);
      });

      it("a key sent in the body or query string is never accepted as authentication", async () => {
        world();
        const r = await send(route, { topic: "gaming", api_key: KEY_A }, { key: null });
        assert.equal(r.res.status, 401, "auth is checked before the body");
        assert.equal(db.calls.length, 0);
      });
    });

    // ------------------------------------------------------------------ pending / rejected / suspended publishers
    describe("publisher account status (pending, rejected = suspended, suspended)", () => {
      // NOTE: database me publisher ka status sirf pending | active | suspended hai (publishers_status_check).
      // "Rejected" ke liye alag status nahi: admin ka "no" = suspended (lib/admin/decisions.ts: active | suspended).
      for (const status of ["pending", "suspended"] as const) {
        it(`${status} publisher: a valid key gets 401, nothing is looked up or recorded`, async () => {
          const pub = db.addPublisher(status);
          db.addKey(pub.id, KEY_A);
          const adv = db.addAdvertiser();
          const ad = db.addAd(adv.id);
          const r = await send(route, { topic: "gaming" });
          assert.equal(r.res.status, 401);
          assert.deepEqual(db.calls.map((c) => c.name), ["authorize_publisher_key"]);
          assert.equal(db.serveLog.length, 0);
          assert.equal(db.spendOf(ad.campaignId), 0);
          // same body as an unknown key: status cannot be probed
          const unknown = await send(route, { topic: "gaming" }, { key: KEY_UNKNOWN });
          assert.equal(r.text, unknown.text);
        });
      }

      it("publisher whose profile is suspended gets 401 even though publisher row is active", async () => {
        const pub = db.addPublisher("active", "suspended");
        db.addKey(pub.id, KEY_A);
        db.addAd(db.addAdvertiser().id);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 401);
        assert.equal(db.serveLog.length, 0);
      });

      it("status changes take effect on the very next request: active -> suspended -> active", async () => {
        const { pub } = world();
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        db.setPublisherStatus(pub.id, "suspended");
        assert.equal((await send(route, { topic: "gaming" })).res.status, 401);
        db.setPublisherStatus(pub.id, "active");
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        db.setPublisherStatus(pub.id, "pending");
        assert.equal((await send(route, { topic: "gaming" })).res.status, 401);
      });

      it("an Idempotency-Key replay does not bypass a suspended publisher", async () => {
        const { pub } = world();
        const headers = { "idempotency-key": "retry-key-0001" };
        assert.equal((await send(route, { topic: "gaming" }, { headers })).res.status, 200);
        db.setPublisherStatus(pub.id, "suspended");
        assert.equal((await send(route, { topic: "gaming" }, { headers })).res.status, 401);
      });
    });

    // ------------------------------------------------------------------ malformed requests
    describe("malformed requests (400 / 413 / 415) never touch the database", () => {
      const cases: [string, string, number, string?][] = [
        ["empty body", "", 400, "invalid_json"],
        ["not json", "topic=gaming", 400, "invalid_json"],
        ["truncated json", '{"topic":"gam', 400, "invalid_json"],
        ["json null", "null", 400, "invalid_body"],
        ["json string", '"gaming"', 400, "invalid_body"],
        ["json number", "42", 400, "invalid_body"],
        ["json array", '[{"topic":"gaming"}]', 400, "invalid_body"],
        ["missing topic", "{}", 400, "invalid_topic"],
        ["null topic", '{"topic":null}', 400, "invalid_topic"],
        ["numeric topic", '{"topic":7}', 400, "invalid_topic"],
        ["array topic", '{"topic":["gaming"]}', 400, "invalid_topic"],
        ["object topic", '{"topic":{"a":1}}', 400, "invalid_topic"],
        ["empty topic", '{"topic":""}', 400, "invalid_topic"],
        ["uppercase topic", '{"topic":"Gaming"}', 400, "invalid_topic"],
        ["topic with space", '{"topic":"video games"}', 400, "invalid_topic"],
        ["topic with dash", '{"topic":"video-games"}', 400, "invalid_topic"],
        ["sql-ish topic", `{"topic":"gaming'; drop table campaigns;--"}`, 400, "invalid_topic"],
        ["51 char topic", JSON.stringify({ topic: "a".repeat(51) }), 400, "invalid_topic"],
        ["unicode topic", '{"topic":"gämïng"}', 400, "invalid_topic"],
        ["extra field", '{"topic":"gaming","x":1}', 400, "unknown_field"],
        ["__proto__ field", '{"topic":"gaming","__proto__":{"a":1}}', 400, "unknown_field"],
        ["exclude not array", '{"topic":"gaming","exclude_ad_ids":"x"}', 400, "invalid_exclude_ad_ids"],
        ["exclude not uuid", '{"topic":"gaming","exclude_ad_ids":["nope"]}', 400, "invalid_exclude_ad_ids"],
        ["exclude number", '{"topic":"gaming","exclude_ad_ids":[1]}', 400, "invalid_exclude_ad_ids"],
        ["exclude null", '{"topic":"gaming","exclude_ad_ids":null}', 400, "invalid_exclude_ad_ids"],
        [
          "21 exclude ids",
          JSON.stringify({ topic: "gaming", exclude_ad_ids: Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) }),
          400,
          "invalid_exclude_ad_ids",
        ],
        ["oversize body", JSON.stringify({ topic: "gaming", pad: "x".repeat(3000) }), 413],
      ];
      for (const [label, body, status, reason] of cases) {
        it(`${label} -> ${status}${reason ? ` ${reason}` : ""}`, async () => {
          world();
          const r = await send(route, body, { raw: true });
          assert.equal(r.res.status, status);
          if (reason) assert.equal(r.body.reason, reason);
          assert.equal(db.calls.length, 0, "database must not be touched");
        });
      }

      it("wrong Content-Type -> 415 (text/plain, form, missing, json-lookalikes, non-utf8 charset)", async () => {
        world();
        for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/jsonp", "application/json-patch+json", "application/json; charset=latin1", "multipart/form-data"]) {
          const r = await send(route, '{"topic":"gaming"}', { raw: true, headers: { "content-type": ct } });
          assert.equal(r.res.status, 415, ct);
        }
        const noType = await route.post(new Request("https://example.test/x", { method: "POST", headers: { authorization: `Bearer ${KEY_A}` }, body: '{"topic":"gaming"}' }));
        // fetch Request ek string body par text/plain laga deta hai: yahan bhi 415 hi aana chahiye
        assert.equal(noType.status, 415);
        assert.equal(db.calls.length, 0);
      });

      it("Content-Type variants that are valid JSON are accepted (case, charset utf-8)", async () => {
        world();
        for (const ct of ["application/json", "Application/JSON", "application/json; charset=utf-8", 'application/json; charset="UTF-8"']) {
          const r = await send(route, '{"topic":"gaming"}', { raw: true, headers: { "content-type": ct } });
          assert.equal(r.res.status, 200, ct);
        }
      });

      it("a lying Content-Length cannot sneak a large body past the limit", async () => {
        world();
        const big = JSON.stringify({ topic: "gaming", pad: "y".repeat(5000) });
        const r = await send(route, big, { raw: true, headers: { "content-length": "20" } });
        assert.equal(r.res.status, 413);
        assert.equal(db.calls.length, 0);
      });

      it("an oversize chunked body (no Content-Length) is cut off at the limit", async () => {
        world();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const chunk = new TextEncoder().encode("x".repeat(1024));
            for (let i = 0; i < 8; i++) controller.enqueue(chunk);
            controller.close();
          },
        });
        const req = new Request("https://example.test/x", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${KEY_A}` },
          body: stream,
          duplex: "half",
        } as RequestInit);
        const res = await route.post(req);
        assert.equal(res.status, 413);
        assert.equal(db.calls.length, 0);
      });

      it("invalid Idempotency-Key header -> 400 (not silently ignored), database untouched", async () => {
        world();
        for (const v of ["short", "has space in it", "x".repeat(65), "bad/slash-123", "bad;semi-123", "ünïcode-key-1"]) {
          const r = await send(route, { topic: "gaming" }, { headers: { "idempotency-key": v } });
          assert.equal(r.res.status, 400, v);
          assert.equal(r.body.reason, "invalid_idempotency_key", v);
        }
        assert.equal(db.calls.length, 0);
      });

      it("privacy: conversation / user fields are rejected and the secret text is never echoed", async () => {
        world();
        for (const field of ["messages", "prompt", "conversation", "user_id", "email", "ip", "text", "context", "publisher_id", "api_key"]) {
          const r = await send(route, { topic: "gaming", [field]: "secret-user-text-123" });
          assert.equal(r.res.status, 400, field);
          assert.equal(r.text.includes("secret-user-text-123"), false, field);
          assert.equal(r.text.includes(field), false, field);
        }
        assert.equal(db.calls.length, 0);
      });

      it("a malformed request with a valid key does not consume rate-limit quota", async () => {
        world();
        db.rateLimitPerMinute = 2;
        for (let i = 0; i < 5; i++) await send(route, "not json", { raw: true });
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 429);
      });
    });

    // ------------------------------------------------------------------ eligible ads + no-fill
    describe("eligible ads and no-fill", () => {
      it("serves only an eligible ad; every kind of ineligible ad gives exactly {fill:false} and writes nothing", async () => {
        const pub = db.addPublisher("active");
        db.addKey(pub.id, KEY_A);
        const live = db.addAdvertiser("active");
        const pendingAdv = db.addAdvertiser("pending");
        const suspendedAdv = db.addAdvertiser("suspended");
        const suspendedProfile = db.addAdvertiser("active", "suspended");
        const ineligible = [
          db.addAd(live.id, { creativeStatus: "draft" }),
          db.addAd(live.id, { creativeStatus: "pending_review" }),
          db.addAd(live.id, { creativeStatus: "rejected" }),
          db.addAd(live.id, { creativeStatus: "paused" }),
          db.addAd(live.id, { creativeStatus: "archived" }),
          db.addAd(live.id, { campaignStatus: "paused" }),
          db.addAd(live.id, { campaignStatus: "draft" }),
          db.addAd(live.id, { campaignStatus: "pending_review" }),
          db.addAd(live.id, { endDate: "2020-12-31" }),
          db.addAd(live.id, { startDate: "2999-01-01" }),
          db.addAd(live.id, { totalBudget: 0 }),
          db.addAd(pendingAdv.id),
          db.addAd(suspendedAdv.id),
          db.addAd(suspendedProfile.id),
          db.addAd(live.id, { category: "travel" }),
        ];
        const before = db.calls.length;
        const r = await send(route, { topic: "gaming" });
        assert.equal(r.res.status, 200);
        assert.deepEqual(r.body, { fill: false });
        assert.equal(db.serveLog.length, 0);
        for (const ad of ineligible) assert.equal(db.spendOf(ad.campaignId), 0);
        assert.equal(db.rpcCount("record_ad_serve"), 0, "record is never called without an eligible ad");
        assert.ok(db.calls.length > before);

        // ab ek eligible ad aate hi wahi serve hota hai, ineligible mein se koi nahi
        const good = db.addAd(live.id, { headline: "The eligible one" });
        const ok = await send(route, { topic: "gaming" });
        assert.equal(adId(ok), good.creativeId);
      });

      it("approved creative of an advertiser with a different category is not served for this topic", async () => {
        const { adv } = world();
        db.addAd(adv.id, { category: "travel", headline: "Trip" });
        const r = await send(route, { topic: "travel" });
        assert.equal((r.body.ad as { headline: string }).headline, "Trip");
        const g = await send(route, { topic: "gaming" });
        assert.notEqual((g.body.ad as { headline: string }).headline, "Trip");
      });

      it("no-fill (200 {fill:false}) for sensitive, unsupported and inactive topics, and never queries ads", async () => {
        world();
        for (const topic of ["health", "medical", "religion", "politics", "caste", "unknownthing", "beauty", "lifestyle_x", "a"]) {
          const r = await send(route, { topic });
          assert.equal(r.res.status, 200, topic);
          assert.deepEqual(r.body, { fill: false }, topic);
        }
        assert.equal(db.rpcCount("load_ad_candidates"), 0);
        assert.equal(db.rpcCount("record_ad_serve"), 0);
      });

      it("no-fill and fill look the same in size/shape class: no reason, no debug field", async () => {
        world();
        const nofill = await send(route, { topic: "health" });
        assert.deepEqual(Object.keys(nofill.body), ["fill"]);
      });

      it("exclude_ad_ids: an excluded ad is skipped when another is eligible; with no alternative the same ad can repeat", async () => {
        const { adv, ad } = world();
        const second = db.addAd(adv.id, { headline: "Second" });
        const first = await send(route, { topic: "gaming" });
        const firstId = adId(first);
        assert.ok([ad.creativeId, second.creativeId].includes(firstId));
        const other = await send(route, { topic: "gaming", exclude_ad_ids: [firstId] });
        assert.notEqual(adId(other), firstId);
        // Decisive check: ab "other" ki serve ginti 1 hai, to bina exclude ke agla ad `firstId` hota. Usko exclude karo toh
        // `other` hi aana chahiye (agar exclude list ignore hoti toh yahan `firstId` aata).
        const mustSkip = await send(route, { topic: "gaming", exclude_ad_ids: [firstId, adId(other)].slice(0, 1) });
        assert.notEqual(adId(mustSkip), firstId);
        const natural = await send(route, { topic: "gaming" });
        const naturalId = adId(natural);
        const forced = await send(route, { topic: "gaming", exclude_ad_ids: [naturalId] });
        assert.notEqual(adId(forced), naturalId, "excluded ad must be skipped even when it is the natural next pick");
        const both = await send(route, { topic: "gaming", exclude_ad_ids: [ad.creativeId, second.creativeId] });
        assert.equal(both.body.fill, true, "documented: repeat only when there is no alternative");
      });

      it("exclude_ad_ids that belong to other publishers or unknown ads are harmless", async () => {
        world();
        const r = await send(route, { topic: "gaming", exclude_ad_ids: ["00000000-0000-4000-8000-0000000000ff"] });
        assert.equal(r.body.fill, true);
      });

      it("budget: exactly as many serves as the budget allows, then no-fill, and spend never exceeds the total", async () => {
        const pub = db.addPublisher("active");
        db.addKey(pub.id, KEY_A);
        const ad = db.addAd(db.addAdvertiser().id, { totalBudget: 0.01 }); // 5 x 0.002
        const results: boolean[] = [];
        for (let i = 0; i < 8; i++) results.push((await send(route, { topic: "gaming" })).body.fill === true);
        assert.deepEqual(results, [true, true, true, true, true, false, false, false]);
        assert.ok(db.spendOf(ad.campaignId) <= 0.01 + 1e-9);
        assert.equal(db.serveLog.length, 5);
      });

      it("daily budget limits serves for the day", async () => {
        const pub = db.addPublisher("active");
        db.addKey(pub.id, KEY_A);
        db.addAd(db.addAdvertiser().id, { totalBudget: 10, dailyBudget: 0.004 }); // 2 per day
        const results: boolean[] = [];
        for (let i = 0; i < 4; i++) results.push((await send(route, { topic: "gaming" })).body.fill === true);
        assert.deepEqual(results, [true, true, false, false]);
      });

      it("an ad paused between selection and record becomes no-fill (database re-verifies)", async () => {
        const { ad } = world();
        const original = db.client().rpc;
        const client = db.client();
        globals.__TEST_SUPABASE__ = {
          rpc: async (name: string, args: Record<string, unknown>) => {
            const out = await original.call(client, name, args);
            if (name === "load_ad_candidates") db.setCreativeStatus(ad.creativeId, "paused");
            return out;
          },
        };
        const r = await send(route, { topic: "gaming" });
        assert.deepEqual(r.body, { fill: false });
        assert.equal(db.serveLog.length, 0);
      });
    });

    // ------------------------------------------------------------------ rate limiting
    describe("rate limiting", () => {
      it("allows exactly the limit per minute, then 429 with Retry-After 60 and no ad lookup or charge", async () => {
        const { ad } = world();
        db.rateLimitPerMinute = 3;
        for (let i = 0; i < 3; i++) assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        const spend = db.spendOf(ad.campaignId);
        const loads = db.rpcCount("load_ad_candidates");
        const r = await send(route, { topic: "gaming" });
        assert.equal(r.res.status, 429);
        assert.equal(db.rpcCount("load_ad_candidates"), loads);
        assert.equal(db.spendOf(ad.campaignId), spend);
        assert.equal(db.serveLog.length, 3);
      });

      it("a new minute opens a new window", async () => {
        world();
        db.rateLimitPerMinute = 2;
        await send(route, { topic: "gaming" });
        await send(route, { topic: "gaming" });
        assert.equal((await send(route, { topic: "gaming" })).res.status, 429);
        db.advanceMinutes(1);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
      });

      it("the limit is per key: one key hitting 429 does not slow another key (same or other publisher)", async () => {
        const { pub } = world();
        const other = db.addPublisher("active");
        db.addKey(pub.id, KEY_B);
        const KEY_C = makeKey("c");
        db.addKey(other.id, KEY_C);
        db.rateLimitPerMinute = 2;
        await send(route, { topic: "gaming" }, { key: KEY_A });
        await send(route, { topic: "gaming" }, { key: KEY_A });
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_A })).res.status, 429);
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_B })).res.status, 200);
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_C })).res.status, 200);
      });

      it("429 also applies to no-fill and invalid-topic-but-valid-shape requests (every authorized call counts)", async () => {
        world();
        db.rateLimitPerMinute = 2;
        assert.equal((await send(route, { topic: "health" })).res.status, 200);
        assert.equal((await send(route, { topic: "health" })).res.status, 200);
        assert.equal((await send(route, { topic: "health" })).res.status, 429);
      });

      it("wrong keys do not eat the quota of a real key", async () => {
        world();
        db.rateLimitPerMinute = 2;
        for (let i = 0; i < 10; i++) await send(route, { topic: "gaming" }, { key: KEY_UNKNOWN });
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
      });
    });

    // ------------------------------------------------------------------ repeated requests / idempotency
    describe("repeated requests", () => {
      it("the same Idempotency-Key returns the same ad and is charged only once", async () => {
        const { pub, ad } = world();
        db.addAd(db.addAdvertiser().id, { headline: "Another" });
        const headers = { "idempotency-key": "retry-key-0001" };
        const first = await send(route, { topic: "gaming" }, { headers });
        const second = await send(route, { topic: "gaming" }, { headers });
        const third = await send(route, { topic: "gaming" }, { headers });
        assert.equal(adId(second), adId(first));
        assert.equal(adId(third), adId(first));
        assert.equal(db.servesFor(pub.id).length, 1);
        assert.equal(db.spendOf(ad.campaignId) + db.spendOf(db.servesFor(pub.id)[0].campaignId) > 0, true);
        const total = [...new Set(db.serveLog.map((s) => s.campaignId))].reduce((n, c) => n + db.spendOf(c), 0);
        assert.equal(Math.round(total * 1e6) / 1e6, db.unitCostUsd);
      });

      it("different Idempotency-Keys (or none) are separate serves and separate charges", async () => {
        const { pub } = world();
        await send(route, { topic: "gaming" }, { headers: { "idempotency-key": "retry-key-0001" } });
        await send(route, { topic: "gaming" }, { headers: { "idempotency-key": "retry-key-0002" } });
        await send(route, { topic: "gaming" });
        await send(route, { topic: "gaming" });
        assert.equal(db.servesFor(pub.id).length, 4);
      });

      it("five concurrent requests with the same Idempotency-Key are charged once and all get the same ad", async () => {
        const { pub } = world();
        db.addAd(db.addAdvertiser().id, { headline: "Other" });
        const headers = { "idempotency-key": "concurrent-key-1" };
        const all = await Promise.all(Array.from({ length: 5 }, () => send(route, { topic: "gaming" }, { headers })));
        assert.deepEqual(new Set(all.map((r) => r.res.status)), new Set([200]));
        assert.equal(new Set(all.map(adId)).size, 1);
        assert.equal(db.servesFor(pub.id).length, 1);
      });

      it("a retry still gets its ad after the budget ran out, but a creative paused since then gives no-fill", async () => {
        const pub = db.addPublisher("active");
        db.addKey(pub.id, KEY_A);
        const ad = db.addAd(db.addAdvertiser().id, { totalBudget: 0.002 }); // exactly one serve
        const headers = { "idempotency-key": "retry-key-0001" };
        const first = await send(route, { topic: "gaming" }, { headers });
        assert.equal(first.body.fill, true);
        assert.deepEqual((await send(route, { topic: "gaming" })).body, { fill: false }, "budget is used up for new requests");
        const retry = await send(route, { topic: "gaming" }, { headers });
        assert.equal(adId(retry), adId(first));
        db.setCreativeStatus(ad.creativeId, "paused");
        assert.deepEqual((await send(route, { topic: "gaming" }, { headers })).body, { fill: false });
        assert.equal(db.servesFor(pub.id).length, 1);
      });

      it("100 sequential requests: no crash, every response is contract-valid, total charge equals served ads", async () => {
        const { pub } = world();
        db.rateLimitPerMinute = 1000;
        let fills = 0;
        for (let i = 0; i < 100; i++) {
          const r = await send(route, { topic: "gaming" });
          if (r.body.fill === true) fills += 1;
        }
        assert.equal(fills, 100);
        assert.equal(db.servesFor(pub.id).length, 100);
        const total = [...new Set(db.serveLog.map((s) => s.campaignId))].reduce((n, c) => n + db.spendOf(c), 0);
        assert.ok(Math.abs(total - 100 * db.unitCostUsd) < 1e-6);
      });
    });

    describe("key revoked mid-request", () => {
      it("key revoked after authorize but before the retry lookup -> 401, nothing charged", async () => {
        const { ad } = world();
        const client = db.client();
        globals.__TEST_SUPABASE__ = {
          rpc: async (name: string, args: Record<string, unknown>) => {
            const out = await client.rpc(name, args);
            if (name === "authorize_publisher_key") db.revokeKey(KEY_A);
            return out;
          },
        };
        const r = await send(route, { topic: "gaming" }, { headers: { "idempotency-key": "retry-key-0001" } });
        assert.equal(r.res.status, 401);
        assert.equal(db.serveLog.length, 0);
        assert.equal(db.spendOf(ad.campaignId), 0);
      });

      it("key revoked between selection and record -> never serves an ad and never charges", async () => {
        const { ad } = world();
        const client = db.client();
        globals.__TEST_SUPABASE__ = {
          rpc: async (name: string, args: Record<string, unknown>) => {
            const out = await client.rpc(name, args);
            if (name === "load_ad_candidates") db.revokeKey(KEY_A);
            return out;
          },
        };
        const r = await send(route, { topic: "gaming" });
        assert.equal(r.body.fill === true, false);
        assert.equal(db.serveLog.length, 0);
        assert.equal(db.spendOf(ad.campaignId), 0);
      });
    });

    // ------------------------------------------------------------------ outages
    describe("service failures", () => {
      for (const rpc of ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]) {
        it(`${rpc} failing -> 503 {fill:false,error:'unavailable'}, no charge, no internal detail in response or logs`, async () => {
          const { ad } = world();
          db.failRpc[rpc] = { data: null, error: { code: "XX000", message: "internal secret detail: relation campaigns" } };
          const r = await send(route, { topic: "gaming" });
          assert.equal(r.res.status, 503);
          assert.equal(db.serveLog.length, 0);
          assert.equal(db.spendOf(ad.campaignId), 0);
          assert.equal(/secret detail|campaigns/.test(r.text + JSON.stringify(logged)), false);
        });
      }

      it("an Idempotency-Key lookup failure is 503 (never guesses) and does not charge", async () => {
        const { ad } = world();
        db.failRpc["find_idempotent_serve"] = { data: null, error: { code: "XX000" } };
        const r = await send(route, { topic: "gaming" }, { headers: { "idempotency-key": "retry-key-0001" } });
        assert.equal(r.res.status, 503);
        assert.equal(db.spendOf(ad.campaignId), 0);
      });

      it("recovery: after the outage ends the same key works again", async () => {
        world();
        db.failRpc["authorize_publisher_key"] = { data: null, error: { code: "XX000" } };
        assert.equal((await send(route, { topic: "gaming" })).res.status, 503);
        db.failRpc["authorize_publisher_key"] = undefined;
        assert.equal((await send(route, { topic: "gaming" })).res.status, 200);
      });
    });

    // ------------------------------------------------------------------ publisher data isolation
    describe("publisher data isolation", () => {
      function twoPublishers() {
        const a = db.addPublisher("active");
        db.addKey(a.id, KEY_A);
        const b = db.addPublisher("active");
        db.addKey(b.id, KEY_B);
        const adv = db.addAdvertiser();
        db.addAd(adv.id, { headline: "Ad one" });
        db.addAd(adv.id, { headline: "Ad two" });
        return { a, b };
      }

      it("each serve is logged under the publisher whose key made the request, never the other", async () => {
        const { a, b } = twoPublishers();
        for (let i = 0; i < 3; i++) await send(route, { topic: "gaming" }, { key: KEY_A });
        for (let i = 0; i < 2; i++) await send(route, { topic: "gaming" }, { key: KEY_B });
        assert.equal(db.servesFor(a.id).length, 3);
        assert.equal(db.servesFor(b.id).length, 2);
      });

      it("another publisher's Idempotency-Key is never replayed: B using A's retry key is a fresh serve for B", async () => {
        const { a, b } = twoPublishers();
        const headers = { "idempotency-key": "shared-looking-key" };
        await send(route, { topic: "gaming" }, { key: KEY_A, headers });
        const spendBefore = [...new Set(db.serveLog.map((s) => s.campaignId))].reduce((n, c) => n + db.spendOf(c), 0);
        await send(route, { topic: "gaming" }, { key: KEY_B, headers });
        assert.equal(db.servesFor(a.id).length, 1);
        assert.equal(db.servesFor(b.id).length, 1, "B is charged separately");
        const spendAfter = [...new Set(db.serveLog.map((s) => s.campaignId))].reduce((n, c) => n + db.spendOf(c), 0);
        assert.ok(spendAfter > spendBefore);
        // and A's own retry still replays A's ad
        const again = await send(route, { topic: "gaming" }, { key: KEY_A, headers });
        assert.equal(again.body.fill, true);
        assert.equal(db.servesFor(a.id).length, 1);
      });

      it("suspending, revoking or rate-limiting publisher A has no effect on publisher B", async () => {
        const { a } = twoPublishers();
        db.rateLimitPerMinute = 1;
        await send(route, { topic: "gaming" }, { key: KEY_A });
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_A })).res.status, 429);
        db.rateLimitPerMinute = 60;
        db.setPublisherStatus(a.id, "suspended");
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_A })).res.status, 401);
        db.revokeKey(KEY_A);
        assert.equal((await send(route, { topic: "gaming" }, { key: KEY_B })).res.status, 200);
      });

      it("responses never contain either publisher's id, key or hash (leak scan runs on every response)", async () => {
        twoPublishers();
        for (const key of [KEY_A, KEY_B]) {
          const r = await send(route, { topic: "gaming" }, { key });
          assert.equal(r.text.includes(sha256(key)), false);
          assert.equal(r.text.includes(key), false);
        }
      });

      it("B's 401/429/400 bodies carry nothing about A (same fixed bodies)", async () => {
        const { a } = twoPublishers();
        db.setPublisherStatus(a.id, "suspended");
        const fromSuspended = await send(route, { topic: "gaming" }, { key: KEY_A });
        const fromUnknown = await send(route, { topic: "gaming" }, { key: KEY_UNKNOWN });
        assert.equal(fromSuspended.text, fromUnknown.text);
      });

      it("a publisher cannot choose their identity: publisher_id in body or header is rejected / ignored", async () => {
        const { a, b } = twoPublishers();
        const inBody = await send(route, { topic: "gaming", publisher_id: b.id }, { key: KEY_A });
        assert.equal(inBody.res.status, 400);
        await send(route, { topic: "gaming" }, { key: KEY_A, headers: { "x-publisher-id": b.id } });
        assert.equal(db.servesFor(a.id).length, 1);
        assert.equal(db.servesFor(b.id).length, 0);
      });

      it("authorize results are cached nowhere: switching keys between requests always uses that key's own publisher", async () => {
        const { a, b } = twoPublishers();
        const order = [KEY_A, KEY_B, KEY_B, KEY_A, KEY_B];
        for (const key of order) await send(route, { topic: "gaming" }, { key });
        assert.equal(db.servesFor(a.id).length, 2);
        assert.equal(db.servesFor(b.id).length, 3);
      });
    });
  });
}

// ---------------------------------------------------------------------- both API versions together
describe("part 5 | legacy and v1 together", () => {
  it("identical request sequences give identical statuses and bodies on both URLs", async () => {
    const run = async (route: RouteDef) => {
      db = new FakeAdDb();
      globals.__TEST_SUPABASE__ = db.client();
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      const susp = db.addPublisher("suspended");
      db.addKey(susp.id, KEY_B);
      const adv = db.addAdvertiser();
      db.addAd(adv.id, { totalBudget: 0.004 });
      db.rateLimitPerMinute = 4;
      const out: [number, string][] = [];
      const steps: [unknown, { key?: string | null; raw?: boolean; headers?: Record<string, string> }][] = [
        [{ topic: "gaming" }, {}],
        [{ topic: "gaming" }, {}],
        [{ topic: "gaming" }, {}], // budget over: no-fill
        [{ topic: "health" }, {}],
        [{ topic: "gaming" }, {}], // rate limited
        [{ topic: "gaming" }, { key: KEY_B }],
        [{ topic: "gaming" }, { key: null }],
        ["{bad", { raw: true }],
        [{ topic: "gaming", x: 1 }, {}],
      ];
      for (const [body, opts] of steps) {
        const r = await send(route, body, opts);
        out.push([r.res.status, r.text]);
      }
      return out;
    };
    const [legacy, v1] = [await run(ROUTES[0]), await run(ROUTES[1])];
    assert.deepEqual(v1, legacy);
  });

  it("the rate-limit quota is shared across both URLs (same key)", async () => {
    world();
    db.rateLimitPerMinute = 3;
    assert.equal((await send(ROUTES[0], { topic: "gaming" })).res.status, 200);
    assert.equal((await send(ROUTES[1], { topic: "gaming" })).res.status, 200);
    assert.equal((await send(ROUTES[0], { topic: "gaming" })).res.status, 200);
    assert.equal((await send(ROUTES[1], { topic: "gaming" })).res.status, 429);
    assert.equal((await send(ROUTES[0], { topic: "gaming" })).res.status, 429);
  });

  it("an Idempotency-Key used on one URL is replayed on the other (one charge)", async () => {
    const { pub } = world();
    db.addAd(db.addAdvertiser().id, { headline: "Other" });
    const headers = { "idempotency-key": "cross-url-key-1" };
    const a = await send(ROUTES[0], { topic: "gaming" }, { headers });
    const b = await send(ROUTES[1], { topic: "gaming" }, { headers });
    assert.equal(adId(a), adId(b));
    assert.equal(db.servesFor(pub.id).length, 1);
  });

  it("X-Blisscco-Api-Version: 1 is present on every v1 status (200, 400, 401, 413, 415, 429, 503) and on no legacy status", async () => {
    world();
    for (const route of ROUTES) {
      const statuses = new Set<number>();
      const collect = (s: Sent) => statuses.add(s.res.status);
      db = new FakeAdDb();
      globals.__TEST_SUPABASE__ = db.client();
      const pub = db.addPublisher("active");
      db.addKey(pub.id, KEY_A);
      db.addAd(db.addAdvertiser().id);
      collect(await send(route, { topic: "gaming" }));
      collect(await send(route, "{bad", { raw: true }));
      collect(await send(route, { topic: "gaming" }, { key: null }));
      collect(await send(route, { topic: "gaming", pad: "z".repeat(3000) }));
      collect(await send(route, '{"topic":"gaming"}', { raw: true, headers: { "content-type": "text/plain" } }));
      db.rateLimitPerMinute = 1;
      collect(await send(route, { topic: "gaming" }));
      db.failRpc["authorize_publisher_key"] = { data: null, error: { code: "XX000" } };
      db.rateLimitPerMinute = 60;
      db.advanceMinutes(1);
      collect(await send(route, { topic: "gaming" }));
      assert.deepEqual([...statuses].sort(), [200, 400, 401, 413, 415, 429, 503], route.name);
    }
  });

  it("only POST is exported by both routes (GET/PUT/DELETE are answered by the platform with 405)", () => {
    for (const mod of [legacyRoute, v1Route]) {
      assert.deepEqual(Object.keys(mod).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(k)), ["POST"]);
    }
  });
});

// ---------------------------------------------------------------------- wrong-key flood guard (before the database)
describe("part 5 | wrong-key flood guard", () => {
  it("after the limit of wrong keys from one IP a valid key from that IP also gets 429 without a database call; other IPs are unaffected", async () => {
    world();
    const guard = createIpGuard(3, 60_000);
    const ip = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 3; i++) {
      const res = await handleMatchPost(build('{"topic":"gaming"}', KEY_UNKNOWN, ip), { ipGuard: guard });
      assert.equal(res.status, 401);
    }
    const callsBefore = db.calls.length;
    const blocked = await handleMatchPost(build('{"topic":"gaming"}', KEY_A, ip), { ipGuard: guard });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(db.calls.length, callsBefore);
    const other = await handleMatchPost(build('{"topic":"gaming"}', KEY_A, { "x-forwarded-for": "198.51.100.4" }), { ipGuard: guard });
    assert.equal(other.status, 200);
  });

  it("successful requests and non-auth errors never count against the IP guard", async () => {
    world();
    const guard = createIpGuard(2, 60_000);
    const ip = { "x-forwarded-for": "203.0.113.50" };
    for (let i = 0; i < 6; i++) assert.equal((await handleMatchPost(build('{"topic":"gaming"}', KEY_A, ip), { ipGuard: guard })).status, 200);
    for (let i = 0; i < 6; i++) assert.equal((await handleMatchPost(build("{bad", KEY_A, ip), { ipGuard: guard })).status, 400);
    assert.equal((await handleMatchPost(build('{"topic":"gaming"}', KEY_A, ip), { ipGuard: guard })).status, 200);
  });
});
