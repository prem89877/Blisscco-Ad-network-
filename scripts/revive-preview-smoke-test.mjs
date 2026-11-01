#!/usr/bin/env node
// Day 23 Part 3: MANUAL smoke test (sirf Preview deployment). Production par ya CI me kabhi nahi chalana.
//
// Ek hi controlled POST /api/v1/ads/match bhejta hai aur PUBLIC response ko Blisscco ke existing contract se jaanchta hai.
// Yeh script na database chhuta hai, na Revive ko seedha call karta hai (Revive sirf Blisscco server ke andar se bulaya jaata hai).
//
// Env (sab server/terminal me; kuch bhi file me save mat karo):
//   BLISSCCO_PREVIEW_URL            (zaroori) https://<preview-host>  (sirf origin; credentials/query/fragment nahi)
//   BLISSCCO_PUBLISHER_API_KEY      (zaroori) blc_live_<64 hex>       (sirf Authorization header me jaati hai)
//   BLISSCCO_SMOKE_CONFIRM_PREVIEW  (zaroori) exactly "yes"           (pushti: yeh Preview hai, production nahi)
//   BLISSCCO_SMOKE_TOPIC            (optional) slug, default "technology"
//   BLISSCCO_SMOKE_EXPECT           (optional) "any" (default) | "revive_fill" | "no_fill"
//   BLISSCCO_PRODUCTION_HOST        (optional) is host par chalane se inkaar
//   BLISSCCO_SMOKE_REVIVE_URL       (optional) SIRF leak-check ke liye: response me iska koi hissa dikha toh FAIL. Kabhi print/bheja nahi jaata.
//
// Niyam:
//   1. Key aur Revive URL kabhi print/log/error me nahi: output sirf fixed reason codes se banta hai (upar se redact bhi hota hai).
//   2. Sirf HTTPS. Redirect FOLLOW nahi hota (redirect: "manual"); 3xx => FAIL, Location kabhi padha/print nahi hota.
//   3. Tracking opt-in header nahi bhejta; response me `tracking` aaye toh FAIL.
//   4. Exit codes: 0 = pass, 1 = response/validation fail, 2 = config galat (koi request nahi gayi).
//
// Chalane ka tarika: node scripts/revive-preview-smoke-test.mjs

import { pathToFileURL } from "node:url";

export const MATCH_PATH = "/api/v1/ads/match";
export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CONFIG = 2;

// lib/ads/contract.ts aur lib/campaigns/creative-validation.ts ki copy; test inhe asli constants se milata hai.
export const PUBLIC_AD_FIELDS = Object.freeze(["id", "headline", "body", "cta_text", "destination_url"]);
export const HEADLINE_MAX = 90;
export const BODY_MAX = 300;
export const CTA_MAX = 30;
export const MAX_DESTINATION_LENGTH = 2048;
export const MAX_RESPONSE_CHARS = 65536;
export const REQUEST_TIMEOUT_MS = 10000;

const API_KEY_RE = /^blc_live_[0-9a-f]{64}$/;
const TOPIC_RE = /^[a-z0-9_]{1,50}$/;
const REVIVE_ID_RE = /^revive_[0-9a-f]{8}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
const EXPECTS = Object.freeze(["any", "revive_fill", "no_fill"]);
const DEFAULT_TOPIC = "technology";
const LEAK_PATTERNS = Object.freeze([/blc_live_[0-9a-f]{16,}/i, /\bbearer\s+\S{8,}/i, /REVIVE_[A-Z_]+/, /zoneid\s*=/i, /api[_-]?key\s*=/i, /openx/i]);

const config = (reason) => Object.freeze({ ok: false, code: EXIT_CONFIG, reason });
const failed = (reason) => Object.freeze({ ok: false, code: EXIT_FAIL, reason });
const passed = (summary) => Object.freeze({ ok: true, code: EXIT_OK, reason: "ok", ...summary });
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (obj, keys) => {
  const a = Object.keys(obj).sort();
  const b = [...keys].sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
};

/** Env => config ya (ok:false, reason). Kabhi throw nahi karta, kabhi koi value wapas nahi karta jo error me jaa sake. */
export function readSmokeConfig(env) {
  try {
    if (!isPlainObject(env)) return config("missing_configuration");
    const rawUrl = env.BLISSCCO_PREVIEW_URL;
    const key = env.BLISSCCO_PUBLISHER_API_KEY;
    if (typeof rawUrl !== "string" || rawUrl === "") return config("missing_preview_url");
    if (typeof key !== "string" || key === "") return config("missing_api_key");
    if (!API_KEY_RE.test(key)) return config("invalid_api_key_format");

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return config("invalid_preview_url");
    }
    if (url.protocol !== "https:") return config("preview_url_not_https");
    if (url.hostname === "" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.pathname !== "/") {
      return config("invalid_preview_url");
    }
    if (rawUrl !== rawUrl.trim()) return config("invalid_preview_url");

    if (env.BLISSCCO_SMOKE_CONFIRM_PREVIEW !== "yes") return config("preview_not_confirmed");
    const prodHost = env.BLISSCCO_PRODUCTION_HOST;
    if (typeof prodHost === "string" && prodHost.trim() !== "" && prodHost.trim().toLowerCase() === url.hostname.toLowerCase()) {
      return config("production_host_refused");
    }

    const topic = env.BLISSCCO_SMOKE_TOPIC === undefined || env.BLISSCCO_SMOKE_TOPIC === "" ? DEFAULT_TOPIC : env.BLISSCCO_SMOKE_TOPIC;
    if (typeof topic !== "string" || !TOPIC_RE.test(topic)) return config("invalid_topic");

    const expect = env.BLISSCCO_SMOKE_EXPECT === undefined || env.BLISSCCO_SMOKE_EXPECT === "" ? "any" : env.BLISSCCO_SMOKE_EXPECT;
    if (!EXPECTS.includes(expect)) return config("invalid_expect");

    let reviveUrl = "";
    const rawRevive = env.BLISSCCO_SMOKE_REVIVE_URL;
    if (rawRevive !== undefined && rawRevive !== "") {
      try {
        const r = new URL(rawRevive);
        if (typeof rawRevive !== "string" || r.protocol !== "https:") return config("invalid_revive_url");
      } catch {
        return config("invalid_revive_url");
      }
      reviveUrl = rawRevive;
    }

    return Object.freeze({ ok: true, endpoint: `${url.origin}${MATCH_PATH}`, key, topic, expect, reviveUrl });
  } catch {
    return config("missing_configuration");
  }
}

/** Jo strings kabhi output/response me nahi aani chahiye (key + Revive URL ke hisse). */
function secretsFor(cfg) {
  const out = new Set();
  const add = (s) => {
    if (typeof s === "string" && s.length >= 4) out.add(s);
  };
  add(cfg.key);
  if (cfg.reviveUrl) {
    add(cfg.reviveUrl);
    try {
      const r = new URL(cfg.reviveUrl);
      add(r.href);
      add(r.host);
      if (r.pathname.length > 1) add(r.pathname);
      if (r.search.length > 1) add(r.search);
      for (const [, v] of r.searchParams) add(v);
    } catch {
      /* upar validate ho chuka hai */
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function redact(text, secrets) {
  let s = String(text);
  for (const secret of secrets) s = s.split(secret).join("[redacted]");
  return s;
}

function leaksIn(text, secrets) {
  if (secrets.some((s) => text.includes(s))) return true;
  return LEAK_PATTERNS.some((re) => re.test(text));
}

function plainText(v, max) {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > 0 && t.length <= max && !/[<>]/.test(t) && !CONTROL_RE.test(t) && !ENTITY_RE.test(t);
}

function httpsDestination(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_DESTINATION_LENGTH) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname === "" || u.username !== "" || u.password !== "") return false;
    return u.href.length <= MAX_DESTINATION_LENGTH && !/[\u0000-\u0020\u007f]/.test(u.href);
  } catch {
    return false;
  }
}

/** Public 200 body => { ok:true, kind:"fill"|"no_fill", source } ya { ok:false, reason }. Contract: DAY6-ADS-MATCH-CONTRACT.md. */
export function validatePublicResponse(body) {
  if (!isPlainObject(body)) return { ok: false, reason: "malformed_response" };
  if (Object.prototype.hasOwnProperty.call(body, "tracking")) return { ok: false, reason: "tracking_present" };
  if (body.fill === false) return sameKeys(body, ["fill"]) ? { ok: true, kind: "no_fill", source: "none" } : { ok: false, reason: "unexpected_fields" };
  if (body.fill !== true) return { ok: false, reason: "malformed_response" };
  if (body.sponsored !== true) return { ok: false, reason: "missing_sponsored_disclosure" };
  if (!sameKeys(body, ["fill", "sponsored", "ad"])) return { ok: false, reason: "unexpected_fields" };
  const ad = body.ad;
  if (!isPlainObject(ad)) return { ok: false, reason: "malformed_response" };
  if (!sameKeys(ad, PUBLIC_AD_FIELDS)) return { ok: false, reason: "unexpected_ad_fields" };
  if (typeof ad.id !== "string" || ad.id.length === 0 || ad.id.length > 100) return { ok: false, reason: "invalid_ad_field" };
  if (!plainText(ad.headline, HEADLINE_MAX) || !plainText(ad.body, BODY_MAX)) return { ok: false, reason: "invalid_ad_field" };
  if (ad.cta_text !== null && !plainText(ad.cta_text, CTA_MAX)) return { ok: false, reason: "invalid_ad_field" };
  if (!httpsDestination(ad.destination_url)) return { ok: false, reason: "unsafe_destination" };
  return { ok: true, kind: "fill", source: REVIVE_ID_RE.test(ad.id) ? "revive" : "blisscco" };
}

function headerText(res) {
  try {
    return [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  } catch {
    return "";
  }
}

/**
 * Ek controlled request + poori jaanch. Kabhi throw nahi karta.
 * deps: { env, fetchImpl?, log?, errLog? }. fetchImpl na ho toh globalThis.fetch (call ke samay padha jaata hai).
 */
export async function runSmokeTest(deps = {}) {
  const log = typeof deps.log === "function" ? deps.log : () => undefined;
  const errLog = typeof deps.errLog === "function" ? deps.errLog : () => undefined;
  const cfg = readSmokeConfig(deps.env);
  const secrets = cfg.ok ? secretsFor(cfg) : [];
  const finish = (result) => {
    const line = `${result.ok ? "PASS" : "FAIL"} ${result.reason}${result.ok ? ` kind=${result.kind} source=${result.source}` : ""}`;
    (result.ok ? log : errLog)(redact(line, secrets));
    return result;
  };
  try {
    if (!cfg.ok) return finish(cfg);

    const send = typeof deps.fetchImpl === "function" ? deps.fetchImpl : globalThis.fetch;
    if (typeof send !== "function") return finish(failed("no_fetch"));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await send(cfg.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.key}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ topic: cfg.topic }),
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (e) {
      return finish(failed(e && e.name === "AbortError" ? "timeout" : "network_error")); // error text kabhi aage nahi
    } finally {
      clearTimeout(timer);
    }

    if (!res || typeof res.status !== "number") return finish(failed("malformed_response"));
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return finish(failed("unexpected_redirect"));
    if (res.status !== 200) {
      const known = { 400: "http_400", 401: "http_401", 413: "http_413", 415: "http_415", 429: "http_429", 503: "http_503" };
      return finish(failed(known[res.status] ?? "unexpected_status"));
    }

    if (leaksIn(headerText(res), secrets)) return finish(failed("credential_leak"));
    const ct = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") : null;
    if (typeof ct !== "string" || !/^application\/json\s*(;|$)/i.test(ct)) return finish(failed("bad_content_type"));

    let text;
    try {
      text = await res.text();
    } catch {
      return finish(failed("network_error"));
    }
    if (typeof text !== "string" || text.length === 0) return finish(failed("malformed_json"));
    if (text.length > MAX_RESPONSE_CHARS) return finish(failed("response_too_large"));
    if (leaksIn(text, secrets)) return finish(failed("credential_leak"));

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return finish(failed("malformed_json"));
    }
    const v = validatePublicResponse(body);
    if (!v.ok) return finish(failed(v.reason));

    if (cfg.expect === "no_fill" && v.kind !== "no_fill") return finish(failed("expected_no_fill"));
    if (cfg.expect === "revive_fill" && !(v.kind === "fill" && v.source === "revive")) return finish(failed("expected_revive_fill"));

    return finish(passed({ kind: v.kind, source: v.source }));
  } catch {
    return finish(failed("unexpected_error"));
  }
}

const invokedDirectly = (() => {
  try {
    return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const result = await runSmokeTest({
    env: process.env,
    log: (m) => process.stdout.write(`${m}\n`),
    errLog: (m) => process.stderr.write(`${m}\n`),
  });
  process.exitCode = result.code;
}
