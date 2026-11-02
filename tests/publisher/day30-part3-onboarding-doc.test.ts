import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Day 30 Part 3: PUBLISHER-PILOT-ONBOARDING.md names only existing routes and environment variable names, holds no
// live-looking credential and makes no unsupported integration claim. Reads local files only: no network, no database, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const DOC = "PUBLISHER-PILOT-ONBOARDING.md";
const GUIDE = "app/dashboard/publisher/guide/page.tsx";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const doc = read(DOC);
const guide = read(GUIDE).replace(/\s+/g, " ");

const ROUTES = [
  { method: "POST", path: "/api/v1/ads/match", file: "app/api/v1/ads/match/route.ts" },
  { method: "POST", path: "/api/v1/ads/impression", file: "app/api/v1/ads/impression/route.ts" },
  { method: "GET", path: "/api/v1/ads/click", file: "app/api/v1/ads/click/route.ts" },
] as const;
const ENV_NAMES = ["BLISSCCO_PUBLISHER_API_KEY", "BLISSCCO_API_BASE_URL"];
const PREFIX_WORDS = ["NEXT_PUBLIC"]; // named only to forbid them

/** Document without fenced code blocks. */
const prose = doc.replace(/```[\s\S]*?```/g, "");
const SENTENCES = prose
  .split(/\n|(?<=[.!?])\s+/)
  .map((s) => s.trim())
  .filter(Boolean);
const NEGATION = /\b(not|no|nor|never|none|nothing|without|neither|cannot|only)\b/i;

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = doc.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

describe("day 30 part 3: structure", () => {
  it("has the title and every section", () => {
    assert.match(doc, /^# Blisscco Publisher Pilot Onboarding \(Day 30 Part 3\)/m);
    for (const s of ["1. Status", "2. Setup flow", "3. API base URL configuration", "4. Server-side publisher key storage", "5. Current routes", "6. Publisher checklist", "7. Limitations", "8. Not changed"]) {
      assert.ok(section(s).trim().length > 40, s);
    }
  });

  it("says it is documentation only and the checklist starts empty", () => {
    assert.match(doc, /This is documentation only/);
    assert.match(doc, /nothing was run to write it/);
    assert.match(doc, /All boxes start empty\. Nothing here is confirmed by this document/);
    assert.doesNotMatch(doc, /^\s*- \[[xX]\]/m);
    assert.ok((doc.match(/^- \[ \] /gm) ?? []).length >= 15);
  });

  it("the checklist covers disclosure, rendering, no-fill and an undisturbed chatbot response", () => {
    const s = section("6. Publisher checklist");
    for (const h of ["### Sponsored-ad disclosure", "### Rendering the sponsored item", "### Handling no-fill", "### Keeping the chatbot response undisturbed"]) {
      assert.ok(s.includes(h), h);
    }
    assert.match(s, /visible word Sponsored as plain text/);
    assert.match(s, /\{"fill":false\}/);
    assert.match(s, /No placeholder, apology or empty Sponsored box/);
    assert.match(s, /answer is sent first or in parallel/);
    assert.match(s, /Retry-After/);
  });
});

describe("day 30 part 3: only existing routes", () => {
  it("every documented route has a real route file exporting exactly that method", () => {
    for (const r of ROUTES) {
      assert.ok(doc.includes(`${r.method} ${r.path}`), `${r.method} ${r.path} documented`);
      assert.ok(existsSync(path.join(ROOT, r.file)), r.file);
      assert.match(read(r.file), new RegExp(`export async function ${r.method}\\b`), r.file);
    }
  });

  it("every /api/ path written in the document is one of the three real routes", () => {
    const found = [...new Set([...doc.matchAll(/\/api\/[A-Za-z0-9_/-]+/g)].map((m) => m[0].replace(/\/+$/, "")))];
    assert.ok(found.length >= 3);
    for (const p of found) assert.ok(ROUTES.some((r) => r.path === p), `unknown path: ${p}`);
    assert.doesNotMatch(doc, /\/api\/ads\/match/, "the legacy route is not documented for publishers");
  });

  it("the documented headers and fields exist in the guide", () => {
    for (const w of ["Idempotency-Key", "X-Blisscco-Tracking: 1", "exclude_ad_ids", "fallback_topics", "Retry-After", "tracking.click_ref", "Query parameter ref"]) {
      assert.ok(guide.includes(w) || read("components/dashboard/IntegrationSteps.tsx").includes(w), w);
    }
  });
});

describe("day 30 part 3: only existing environment variable names", () => {
  it("every environment-style name is a known one, or a public prefix named only to forbid it", () => {
    const names = [...new Set([...doc.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((m) => m[0]))];
    for (const n of names) assert.ok(ENV_NAMES.includes(n) || PREFIX_WORDS.includes(n), `unknown environment name: ${n}`);
    for (const n of ENV_NAMES) assert.ok(names.includes(n), n);
  });

  it("the names exist in the guide and the Next.js example", () => {
    for (const n of ENV_NAMES) {
      assert.ok(guide.includes(n), `${n} in the guide`);
      assert.match(read("examples/publisher-nextjs/.env.example"), new RegExp(`^${n}=`, "m"));
    }
  });

  it("no public prefix is put on the key or base URL, and every prefix mention is a prohibition", () => {
    assert.doesNotMatch(doc, /(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_[A-Z_]*(BLISSCCO|API_KEY|PUBLISHER)/);
    for (const s of SENTENCES) if (/NEXT_PUBLIC|VITE_|REACT_APP_/.test(s)) assert.match(s, NEGATION, s);
  });

  it("variable assignments hold placeholders only", () => {
    const lines = doc.split("\n").filter((l) => /^[A-Z][A-Z0-9_]+=/.test(l));
    assert.equal(lines.length, 2);
    for (const l of lines) assert.match(l, /=(paste-your-key-from-the-publisher-page|https:\/\/YOUR-BLISSCCO-API-HOST)$/, l);
  });

  it("the key is described as server-side only", () => {
    const s = section("4. Server-side publisher key storage");
    assert.match(s, /only in `BLISSCCO_PUBLISHER_API_KEY` on your server/);
    assert.match(s, /server to server only/);
    assert.match(s, /Do not put the key in browser code, a mobile app, git, logs, tickets, screenshots or chat/);
    assert.match(s, /no public key, site key or publisher id/);
  });

  it("no sentence about sharing or exposing a credential is anything but a prohibition", () => {
    const VERB = /\b(commit|paste|email|post|share|publish|print|echo|embed|hard-?code|expose)(s|ed|ing)?\b/i;
    const NOUN = /\b(key|secret|token|password|credentials?)\b/i;
    for (const s of SENTENCES) if (VERB.test(s) && NOUN.test(s)) assert.match(s, NEGATION, s);
  });
});

describe("day 30 part 3: no live-looking credentials", () => {
  it("contains no key, token, secret, database URL or deployment URL", () => {
    for (const re of [
      /blc_live_[0-9a-f]{8,}/i,
      /\bb[tc]1\.(?!EXAMPLE)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
      /\bsb_(secret|publishable)_[A-Za-z0-9_]{6,}/i,
      /\b[0-9a-f]{32,}\b/i,
      /postgres(ql)?:\/\//i,
      /\bhttps?:\/\/(?!YOUR-BLISSCCO-API-HOST)[^\s`)]+/i,
      /Bearer\s+(?!`)[A-Za-z0-9_-]{16,}/,
    ]) assert.doesNotMatch(doc, re, String(re));
  });

  it("the only URL is the placeholder host", () => {
    const urls = [...doc.matchAll(/https?:\/\/[^\s`)]+/g)].map((m) => m[0]);
    assert.deepEqual(urls, ["https://YOUR-BLISSCCO-API-HOST"]);
  });
});

describe("day 30 part 3: no unsupported integration claims", () => {
  it("every sentence naming a third-party chatbot or platform is a negation", () => {
    const NAMES = /\b(ChatGPT|OpenAI|Claude|Gemini|Copilot|Slack|Discord|WhatsApp|Telegram|Poe|Perplexity|Character\.AI|third-party)\b/i;
    let seen = 0;
    for (const s of SENTENCES) {
      if (NAMES.test(s)) {
        seen++;
        assert.match(s, NEGATION, s);
      }
    }
    assert.ok(seen >= 2, "the limitation is stated");
  });

  it("states the no-integration limitation the guide states", () => {
    assert.match(guide, /Blisscco has no integration with ChatGPT or any other third-party chatbot/);
    assert.match(doc, /Blisscco has no integration with ChatGPT or any other third-party chatbot/);
    assert.match(guide, /No third-party integration has been tested/);
    assert.match(doc, /No third-party integration has been tested/);
  });

  it("repeats the guide's other limitations", () => {
    for (const [g, d] of [
      [/Not ready for production use/, /not ready for production use/],
      [/No staging environment is published/, /No staging environment is published/],
      [/The contract can still change/, /the contract can still change/],
      [/not a published package/, /not a published package/],
      [/The impression endpoint has no CORS/, /no CORS/],
      [/Database calls time out after 8 seconds/, /Database calls time out after 8 seconds/],
    ] as const) {
      assert.match(guide, g, String(g));
      assert.match(doc, d, String(d));
    }
  });

  it("makes no readiness, certification, outcome or integration claim without a negation", () => {
    const CLAIM = /\b(production[- ]ready|ready for production|certified|guaranteed?|official(ly)? (integration|partner)|plugin|marketplace|compatible with|works with|supports? (ChatGPT|Slack)|integrated with)\b/i;
    for (const s of SENTENCES) if (CLAIM.test(s)) assert.match(s, NEGATION, s);
  });

  it("claims no test, build, CI or live result", () => {
    for (const re of [
      /\b\d+\s+(tests?\s+)?(pass|passed|passing)\b/i,
      /\b(all|every) (tests?|checks?) (pass|passed|are passing)\b/i,
      /\bexit (code )?0\b/i,
      /\b(verified|confirmed) (against|on|with) (a |the )?(real|live|production|preview) /i,
    ]) assert.doesNotMatch(doc, re, String(re));
    for (const s of SENTENCES) if (/\b(verified|confirmed|passed|passing)\b/i.test(s)) assert.match(s, NEGATION, s);
  });

  it("keeps the Revive fallback off and out of the publisher flow", () => {
    assert.match(doc, /off by default and can only be switched on by Blisscco on its own server/);
    assert.doesNotMatch(doc, /REVIVE_[A-Z_]+/);
    assert.doesNotMatch(doc, /\b(set|add|export)\s+`?REVIVE/i);
  });

  it("changes no workflow and adds no .sh script", () => {
    assert.match(section("8. Not changed"), /No `\.sh` script was added, so `\.github\/workflows\/ci\.yml` is unchanged/);
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /PUBLISHER-PILOT-ONBOARDING/);
  });
});

describe("day 30 part 3: files named in the document exist", () => {
  it("every repository path in backticks exists", () => {
    const paths = [...doc.matchAll(/`((?:app|components|lib|tests|config|scripts|examples)\/[^`\s,]+|\.github\/[^`\s,]+)`/g)].map((m) => m[1]);
    assert.ok(paths.length >= 3);
    for (const p of new Set(paths)) assert.ok(existsSync(path.join(ROOT, p)), p);
  });
});
