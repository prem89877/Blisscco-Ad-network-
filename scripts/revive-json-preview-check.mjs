#!/usr/bin/env node
// Day 25 Part 3: MANUAL check (sirf Preview deployment). Production par ya CI me kabhi nahi chalana.
//
// Ek hi GET bhejta hai: <preview-origin>/api/revive-json-preview (Day 24 ka TEST FIXTURE route). Aur kuch nahi.
// Yeh script publisher API key nahi bhejta, cookies/headers inspect nahi karta, redirect follow nahi karta,
// aur Blisscco match API / Revive / database ko nahi chhuta.
//
// Env (terminal me; kuch bhi file me save mat karo):
//   BLISSCCO_PREVIEW_URL             (zaroori) https://<preview-host>  (sirf origin; path/query/fragment/credentials nahi)
//   BLISSCCO_PREVIEW_CHECK_CONFIRM   (zaroori) exactly "yes"           (pushti: yeh Preview hai, production nahi)
//   BLISSCCO_PRODUCTION_HOST         (optional) is host par chalane se inkaar
//   BLISSCCO_PREVIEW_CHECK_EXPECT    (optional) "enabled" (default: 200 + fixture) | "disabled" (404) | "unavailable" (503)
//
// Niyam:
//   1. Path FIXED hai (/api/revive-json-preview). Input se koi path ya query string nahi li jaati.
//   2. Output sirf fixed reason codes se banta hai. Env values, URL, headers, cookies, response text kabhi print nahi hote.
//   3. Sirf HTTPS. redirect: "manual"; 3xx => FAIL, Location kabhi padha/print nahi hota.
//   4. Koi cookie/authorization header nahi bheja jaata; credentials: "omit".
//   5. Exit codes: 0 = pass, 1 = response/validation fail, 2 = config galat (koi request nahi gayi).
//
// Chalane ka tarika: node scripts/revive-json-preview-check.mjs

import { pathToFileURL } from "node:url";

export const CHECK_PATH = "/api/revive-json-preview";
export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CONFIG = 2;

// lib/ads/revive-json-endpoint-contract.ts aur lib/campaigns/creative-validation.ts ki copy; test inhe asli constants se milata hai.
export const PUBLIC_FIELDS = Object.freeze(["headline", "body", "cta_text", "destination_url"]);
export const HEADLINE_MAX = 90;
export const BODY_MAX = 300;
export const CTA_MAX = 30;
export const MAX_DESTINATION_LENGTH = 2048;
export const MAX_RESPONSE_CHARS = 65536;
export const REQUEST_TIMEOUT_MS = 10000;
export const FIXTURE_LABEL = "TEST FIXTURE";

const EXPECTS = Object.freeze(["enabled", "disabled", "unavailable"]);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
const LEAK_PATTERNS = Object.freeze([/blc_live_[0-9a-f]{16,}/i, /\bbearer\s+\S{8,}/i, /REVIVE_[A-Z_]+/, /zoneid\s*=/i, /api[_-]?key\s*=/i, /openx/i]);

const config = (reason) => Object.freeze({ ok: false, code: EXIT_CONFIG, reason });
const failed = (reason) => Object.freeze({ ok: false, code: EXIT_FAIL, reason });
const passed = (state) => Object.freeze({ ok: true, code: EXIT_OK, reason: "ok", state });
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (obj, keys) => {
  const a = Object.keys(obj).sort();
  const b = [...keys].sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
};

/** Env => config ya (ok:false, reason). Kabhi throw nahi karta, kabhi koi input value wapas nahi karta. */
export function readCheckConfig(env) {
  try {
    if (!isPlainObject(env)) return config("missing_configuration");
    const rawUrl = env.BLISSCCO_PREVIEW_URL;
    if (typeof rawUrl !== "string" || rawUrl === "") return config("missing_preview_url");
    if (rawUrl !== rawUrl.trim()) return config("invalid_preview_url");

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
    if (rawUrl.includes("?") || rawUrl.includes("#")) return config("invalid_preview_url");

    if (env.BLISSCCO_PREVIEW_CHECK_CONFIRM !== "yes") return config("preview_not_confirmed");
    const prodHost = env.BLISSCCO_PRODUCTION_HOST;
    if (typeof prodHost === "string" && prodHost.trim() !== "" && prodHost.trim().toLowerCase() === url.hostname.toLowerCase()) {
      return config("production_host_refused");
    }

    const expect = env.BLISSCCO_PREVIEW_CHECK_EXPECT === undefined || env.BLISSCCO_PREVIEW_CHECK_EXPECT === "" ? "enabled" : env.BLISSCCO_PREVIEW_CHECK_EXPECT;
    if (typeof expect !== "string" || !EXPECTS.includes(expect)) return config("invalid_expect");

    return Object.freeze({ ok: true, endpoint: `${url.origin}${CHECK_PATH}`, expect });
  } catch {
    return config("missing_configuration");
  }
}

/** Jo strings kabhi output me nahi aani chahiye (preview URL ke hisse). */
function secretsFor(cfg) {
  const out = new Set();
  try {
    const u = new URL(cfg.endpoint);
    out.add(u.origin);
    out.add(u.host);
  } catch {
    /* config validate ho chuka hai */
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function redact(text, secrets) {
  let s = String(text);
  for (const secret of secrets) s = s.split(secret).join("[redacted]");
  return s;
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

/** 200 body => { ok:true } ya { ok:false, reason }. Sirf 4 public fields, https destination, TEST FIXTURE label. */
export function validateFixtureBody(body) {
  if (!isPlainObject(body)) return { ok: false, reason: "malformed_response" };
  if (!sameKeys(body, PUBLIC_FIELDS)) return { ok: false, reason: "unexpected_fields" };
  if (!plainText(body.headline, HEADLINE_MAX) || !plainText(body.body, BODY_MAX)) return { ok: false, reason: "invalid_field" };
  if (body.cta_text !== null && !plainText(body.cta_text, CTA_MAX)) return { ok: false, reason: "invalid_field" };
  if (!httpsDestination(body.destination_url)) return { ok: false, reason: "unsafe_destination" };
  if (!body.headline.includes(FIXTURE_LABEL)) return { ok: false, reason: "missing_fixture_label" };
  return { ok: true };
}

/** Error body (404/503) sirf exactly { error: "<code>" } hona chahiye. */
function validateErrorBody(body, code) {
  return isPlainObject(body) && sameKeys(body, ["error"]) && body.error === code;
}

function hasNoStore(res) {
  try {
    const cc = res.headers.get("cache-control");
    return typeof cc === "string" && cc.split(",").some((p) => p.trim().toLowerCase() === "no-store");
  } catch {
    return false;
  }
}

function isJsonType(res) {
  try {
    const ct = res.headers.get("content-type");
    return typeof ct === "string" && /^application\/json\s*(;|$)/i.test(ct);
  } catch {
    return false;
  }
}

/**
 * Ek controlled GET + poori jaanch. Kabhi throw nahi karta.
 * deps: { env, fetchImpl?, log?, errLog? }. fetchImpl na ho toh globalThis.fetch (call ke samay padha jaata hai).
 */
export async function runPreviewCheck(deps = {}) {
  const log = typeof deps.log === "function" ? deps.log : () => undefined;
  const errLog = typeof deps.errLog === "function" ? deps.errLog : () => undefined;
  const cfg = readCheckConfig(deps.env);
  const secrets = cfg.ok ? secretsFor(cfg) : [];
  const finish = (result) => {
    const line = `${result.ok ? "PASS" : "FAIL"} ${result.reason}${result.ok ? ` state=${result.state}` : ""}`;
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
        method: "GET",
        headers: { accept: "application/json" },
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

    const wantStatus = cfg.expect === "enabled" ? 200 : cfg.expect === "disabled" ? 404 : 503;
    if (res.status !== wantStatus) {
      const known = { 200: "unexpected_200", 404: "unexpected_404", 503: "unexpected_503" };
      return finish(failed(known[res.status] ?? "unexpected_status"));
    }

    if (!isJsonType(res)) return finish(failed("bad_content_type"));
    if (!hasNoStore(res)) return finish(failed("missing_no_store"));

    let text;
    try {
      text = await res.text();
    } catch {
      return finish(failed("network_error"));
    }
    if (typeof text !== "string" || text.length === 0) return finish(failed("malformed_json"));
    if (text.length > MAX_RESPONSE_CHARS) return finish(failed("response_too_large"));
    if (LEAK_PATTERNS.some((re) => re.test(text)) || secrets.some((s) => text.includes(s))) return finish(failed("credential_leak"));

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return finish(failed("malformed_json"));
    }

    if (cfg.expect === "enabled") {
      const v = validateFixtureBody(body);
      if (!v.ok) return finish(failed(v.reason));
      return finish(passed("enabled"));
    }
    if (cfg.expect === "disabled") {
      return validateErrorBody(body, "not_found") ? finish(passed("disabled")) : finish(failed("unexpected_error_body"));
    }
    return validateErrorBody(body, "unavailable") ? finish(passed("unavailable")) : finish(failed("unexpected_error_body"));
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
  const result = await runPreviewCheck({
    env: process.env,
    log: (m) => process.stdout.write(`${m}\n`),
    errLog: (m) => process.stderr.write(`${m}\n`),
  });
  process.exitCode = result.code;
}
