import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Day 30 Part 2: MVP-PILOT-SAFETY-CHECKLIST.md covers the required safety topics, never tells anyone to expose a secret,
// never turns the Revive fallback on, and claims no check as done. Reads local files only: no network, no database, no npm, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const DOC = "MVP-PILOT-SAFETY-CHECKLIST.md";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const doc = read(DOC);

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = doc.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

/** Text of a "### Heading" subsection, up to the next "### " or "## " heading. */
function subsection(title: string): string {
  const parts = doc.split(/^### /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `subsection missing: ${title}`);
  return hit.split("\n").slice(1).join("\n").split(/^## /m)[0];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const SENTENCES = doc
  .split(/\n|(?<=[.!?])\s+/)
  .map((s) => s.trim())
  .filter(Boolean);
const NEGATION = /\b(not|no|nor|never|none|nothing|without|neither|pending)\b/i;

const SECTIONS = [
  "1. Rules for using this checklist",
  "2. Separate TEST and Production environments",
  "3. Server-only secrets",
  "4. Publisher API-key handling",
  "5. Revive fallback stays off",
  "6. Exposure check: browser bundles and public logs",
  "7. Conditions before inviting a real publisher",
  "8. Limits of this checklist",
  "9. Not changed",
];

describe("day 30 part 2: document structure", () => {
  it("has the title and every required section", () => {
    assert.match(doc, /^# Blisscco MVP Pilot Safety Checklist \(Day 30 Part 2\)/m);
    for (const s of SECTIONS) assert.ok(section(s).trim().length > 40, s);
  });

  it("is a real checklist with many unticked items", () => {
    const open = doc.match(/^- \[ \] /gm) ?? [];
    assert.ok(open.length >= 50, `only ${open.length} checklist items`);
  });

  it("says up front that it is documentation only and confirms nothing", () => {
    assert.match(doc, /It is documentation only/);
    assert.match(doc, /Nothing was run to write it/);
    assert.match(doc, /Every box below starts empty\. No item is confirmed by this document/);
  });
});

describe("day 30 part 2: TEST and Production are kept apart", () => {
  const s = section("2. Separate TEST and Production environments");

  it("covers separate projects, Preview values, the TEST workflow and the guard", () => {
    assert.match(s, /two different Supabase projects/);
    assert.match(s, /Vercel Preview uses values from the TEST project/);
    assert.match(s, /`SUPABASE_SECRET_KEY` in Preview is the TEST project's key, not the Production key/);
    assert.match(s, /`\.github\/workflows\/integration\.yml`/);
    assert.match(s, /starts by hand and never on push or pull request/);
    assert.match(s, /`tests\/integration\/test-db-guard\.ts`/);
    assert.match(s, /No Production database URL appears in any TEST secret/);
    assert.match(s, /dedicated test publisher with its own key/);
    assert.match(s, /No real advertiser or publisher data is copied into TEST/);
  });

  it("does not claim which SQL is applied anywhere", () => {
    assert.match(s, /This document does not claim any state/);
    assert.doesNotMatch(doc, /`[^`]*\.sql`/);
  });
});

describe("day 30 part 2: server-only secrets", () => {
  const s = section("3. Server-only secrets");

  it("lists the secret names and the public-by-design names, with no values", () => {
    for (const name of [
      "SUPABASE_SECRET_KEY",
      "AD_TRACKING_SECRET",
      "AD_TRACKING_SECRET_PREVIOUS",
      "REVIVE_DELIVERY_URL",
      "TEST_DATABASE_URL",
      "TEST_SUPABASE_PROJECT_REF",
      "REVIVE_FALLBACK_ENABLED",
      "REVIVE_JSON_PREVIEW_ENABLED",
    ]) assert.match(s, new RegExp("`" + name + "`"), name);
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_CONTACT_EMAIL"]) {
      assert.match(s, new RegExp("`" + name + "`"), name);
    }
    assert.match(s, /Names only, never values/);
  });

  it("requires no NEXT_PUBLIC_ prefix on a secret, Sensitive on, and a rotation plan", () => {
    assert.match(s, /No name in the secret rows above has a `NEXT_PUBLIC_` prefix/);
    assert.match(s, /Sensitive is switched on for each secret/);
    assert.match(s, /rotation plan/);
    assert.match(s, /`\.env` files are not committed/);
  });

  it("states the limit of the build guard: it does not catch a Revive or database name", () => {
    assert.match(s, /The guard does not look at a name such as `NEXT_PUBLIC_REVIVE_DELIVERY_URL` or a public database URL/);
  });
});

describe("day 30 part 2: publisher API-key handling", () => {
  const s = section("4. Publisher API-key handling");

  it("covers one-time display, hash-only storage, server-only storage, separate keys, revoke first and server-to-server calls", () => {
    assert.match(s, /shown once and only a one-way hash is stored/);
    assert.match(s, /never sent by email, chat or ticket/);
    assert.match(s, /`BLISSCCO_PUBLISHER_API_KEY`/);
    assert.match(s, /not put in browser code, a mobile app, a `NEXT_PUBLIC_` variable, git, logs, tickets or chat/);
    assert.match(s, /separate named key for each server or environment/);
    assert.match(s, /revoke it on the Publisher page, then create a replacement/);
    assert.match(s, /server to server only/);
    assert.match(s, /The test key is revoked when testing ends/);
  });
});

describe("day 30 part 2: the Revive fallback stays off", () => {
  const s = section("5. Revive fallback stays off");

  it("explains the default-off behavior and keeps both Revive flags unset", () => {
    assert.match(s, /only when `REVIVE_FALLBACK_ENABLED` has the exact value `"true"`/);
    assert.match(s, /Any other value, or no value, means off/);
    assert.match(s, /`REVIVE_FALLBACK_ENABLED` is unset in Production and in Preview/);
    assert.match(s, /`REVIVE_JSON_PREVIEW_ENABLED` is unset in Production and in Preview/);
    assert.match(s, /absent from Production/);
    assert.match(s, /not charged, has no tracking and earns the publisher nothing/);
  });

  it("says a real Revive endpoint was never checked and the preview is not proof of a live integration", () => {
    assert.match(s, /a real Revive endpoint has never been checked in this repository/);
    assert.match(s, /The Revive JSON preview is not proof of a live Revive integration/);
  });

  it("makes turning the fallback on a separate decision, not part of the pilot checklist", () => {
    assert.match(s, /Turning the fallback on is a separate written decision/);
    assert.match(s, /not part of this pilot checklist/);
    assert.match(s, /`DAY27-REAL-REVIVE-VERIFICATION\.md`/);
  });
});

describe("day 30 part 2: exposure checklist for bundles and logs", () => {
  const s = section("6. Exposure check: browser bundles and public logs");

  it("covers publisher keys, Supabase secrets, database URLs and Revive delivery credentials", () => {
    assert.match(s, /Publisher key \| `blc_live_`/);
    assert.match(s, /Supabase secret key \| `sb_secret_`/);
    assert.match(s, /service_role/);
    assert.match(s, /Database URL \| `postgres:\/\/`/);
    assert.match(s, /Revive delivery URL \| the value of `REVIVE_DELIVERY_URL`/);
    assert.match(s, /Tracking secret \| the value of `AD_TRACKING_SECRET`/);
  });

  it("covers source, built client bundle, browser and public logs", () => {
    assert.match(s, /Search the repository/);
    assert.match(s, /`\.next\/static`/);
    assert.match(s, /no `"use client"` file imports/i);
    assert.match(s, /network tab/);
    assert.match(s, /Vercel logs/);
    assert.match(s, /GitHub Actions logs/);
    assert.match(s, /pull request, issue, comment, screenshot or chat/);
    assert.match(s, /the publisher searches their own built frontend and network tab/i);
  });

  it("says these are manual steps that have not been run, and never to print a real value", () => {
    assert.match(s, /manual steps for a person to do later\. None has been run/);
    assert.match(s, /never print it or type it into a command/);
  });
});

describe("day 30 part 2: conditions before inviting a real publisher", () => {
  const s = section("7. Conditions before inviting a real publisher");

  it("has all four gates, each with evidence and a NOT CONFIRMED status", () => {
    for (const g of ["Gate A: API contract", "Gate B: Tracking behavior", "Gate C: No-fill behavior", "Gate D: Publisher disclosure guidance"]) {
      const body = subsection(g);
      assert.ok((body.match(/^- \[ \] /gm) ?? []).length >= 4, g);
      assert.match(body, /Evidence to record/, g);
      assert.match(body, /Status: NOT CONFIRMED/, g);
    }
    assert.match(s, /Today every gate is NOT CONFIRMED, because nothing has been run/);
  });

  it("Gate A covers the contract: 200, 401, 400, 415, 413, sponsored, public fields, no-store and the version header", () => {
    const a = subsection("Gate A: API contract");
    for (const w of [/`POST \/api\/v1\/ads\/match`/, /401/, /400/, /415/, /413/, /`sponsored: true`/, /public ad fields/, /no-store/, /X-Blisscco-Api-Version: 1/, /429 and 503/]) {
      assert.match(a, w, String(w));
    }
  });

  it("Gate B covers tracking: secret set, opt-in header, duplicate, tampering, click redirect and serve-time charge", () => {
    const b = subsection("Gate B: Tracking behavior");
    for (const w of [/`AD_TRACKING_SECRET` is set/, /X-Blisscco-Tracking: 1/, /`recorded`, then `duplicate`/, /401 for the token, 404 for the click reference/, /redirects to the destination stored for the ad/, /charge happens at serve time only/, /only from the publisher's server/]) {
      assert.match(b, w, String(w));
    }
  });

  it("Gate C covers no-fill: no campaign, sensitive topic, fallback off, 503 versus 200", () => {
    const c = subsection("Gate C: No-fill behavior");
    for (const w of [/`\{"fill":false\}`/, /sensitive topic/, /fallback off, a no-fill stays a no-fill/, /outage \(503 with `unavailable`\)/, /chat keeps working/]) {
      assert.match(c, w, String(w));
    }
  });

  it("Gate D covers disclosure: Sponsored label, topic only, privacy and terms, publisher responsibility", () => {
    const d = subsection("Gate D: Publisher disclosure guidance");
    for (const w of [/Sponsored label \(section 6\)/, /disclosure and responsibilities \(section 6a\)/, /in writing/, /only a topic category is sent/, /privacy and terms pages/, /`NEXT_PUBLIC_CONTACT_EMAIL`/, /responsible for their own chatbot interface/]) {
      assert.match(d, w, String(w));
    }
  });

  it("the sign-off table has every row as NOT CONFIRMED and no row filled in", () => {
    const rows = doc.split("\n").filter((l) => /^\| (Section \d|Gate [A-D])/.test(l));
    assert.equal(rows.length, 9);
    for (const r of rows) {
      assert.match(r, /\| NOT CONFIRMED \|$/, r);
      assert.match(r, /\| \| \| \| NOT CONFIRMED/, r);
    }
    assert.match(s, /Invite a real publisher only when every row has a dated result from a person/);
  });
});

describe("day 30 part 2: the checklist never tells anyone to expose a secret", () => {
  it("every sentence about sharing, printing, committing or pasting a credential is a prohibition", () => {
    const VERB = /\b(commit|paste|email|post|share|publish|print|echo|embed|hard-?code|expose)(s|ed|ing)?\b/i;
    const NOUN = /\b(key|secret|token|password|credentials?|url)\b/i;
    for (const s of SENTENCES) {
      if (VERB.test(s) && NOUN.test(s)) assert.match(s, NEGATION, s);
    }
  });

  it("every sentence that names a NEXT_PUBLIC_ secret-like variable is a prohibition or a warning", () => {
    for (const s of SENTENCES) {
      if (/NEXT_PUBLIC_(SUPABASE_SECRET|AD_TRACKING|REVIVE|DATABASE|TEST_|SERVICE|PUBLISHER)/.test(s)) assert.match(s, NEGATION, s);
    }
  });

  it("no line sets a secret to a value, and no key-like value is written", () => {
    assert.doesNotMatch(doc, /\b(SUPABASE_SECRET_KEY|AD_TRACKING_SECRET|REVIVE_DELIVERY_URL|TEST_DATABASE_URL|BLISSCCO_PUBLISHER_API_KEY)\s*=/);
    assert.doesNotMatch(doc, /\b(export|set)\s+[A-Z_]*(KEY|SECRET|TOKEN|URL)\b/);
  });

  it("contains no secret-like value", () => {
    for (const re of [
      /blc_live_[0-9a-f]{16,}/i,
      /\bb[tc]1\.(?!EXAMPLE)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
      /\bsb_(secret|publishable)_[A-Za-z0-9_]{6,}/i,
      /\b[0-9a-f]{32,}\b/i,
      /postgres(ql)?:\/\/[^\s`]+:[^\s`@]+@/i,
      /\bhttps?:\/\/[^\s`)]*(supabase\.co|vercel\.app)/i,
    ]) assert.doesNotMatch(doc, re, String(re));
  });
});

describe("day 30 part 2: the checklist never enables the Revive fallback by default", () => {
  it("no line sets either Revive flag to true", () => {
    assert.doesNotMatch(doc, /REVIVE_FALLBACK_ENABLED\s*[=:]\s*"?true/i);
    assert.doesNotMatch(doc, /REVIVE_JSON_PREVIEW_ENABLED\s*[=:]\s*"?true/i);
    assert.doesNotMatch(doc, /\b(set|add|export)\s+`?REVIVE_(FALLBACK|JSON_PREVIEW)_ENABLED/i);
    assert.doesNotMatch(doc, /\b(default(s)? (is |to )?on|on by default|enabled by default|on for the pilot)\b/i);
  });

  it("every sentence about enabling, turning on or activating Revive is a prohibition, an off-state or a separate decision", () => {
    const ALLOWED = new RegExp(NEGATION.source + "|\\b(off|unset|separate|only after|until|before)\\b", "i");
    for (const s of SENTENCES) {
      if (/\b(enable|enabled|turn(s|ing)? on|switch(es|ed)? on|activate)\b/i.test(s) && /(fallback|revive)/i.test(s)) assert.match(s, ALLOWED, s);
    }
  });

  it("the Revive flags and values are not in .env.example, ci.yml or integration.yml", () => {
    assert.doesNotMatch(read(".env.example"), /REVIVE/i);
    for (const f of [".github/workflows/ci.yml", ".github/workflows/integration.yml"]) assert.doesNotMatch(read(f), /REVIVE/i, f);
  });

  it("the code turns the fallback and the preview on only for the exact value \"true\"", () => {
    assert.match(read("lib/ads/revive-adapter.ts"), /REVIVE_ENV_FLAG = "REVIVE_FALLBACK_ENABLED"/);
    assert.match(read("lib/ads/revive-adapter.ts"), /env\[REVIVE_ENV_FLAG\] === "true"/);
    assert.match(read("lib/ads/revive-json-preview.ts"), /PREVIEW_ENV_FLAG = "REVIVE_JSON_PREVIEW_ENABLED"/);
    assert.match(read("lib/ads/revive-json-preview.ts"), /env\[PREVIEW_ENV_FLAG\] === "true"/);
  });
});

describe("day 30 part 2: no check is claimed as done", () => {
  it("has no ticked box", () => {
    assert.doesNotMatch(doc, /^\s*- \[[xX]\]/m);
  });

  it("claims no test, lint, build, CI or database result", () => {
    const CLAIMS: [RegExp, string][] = [
      [/\b\d+\s+(tests?\s+)?(pass|passed|passing)\b/i, "pass count"],
      [/\b(all|every) (tests?|checks?|suites?) (pass|passed|are passing|are green|green)\b/i, "all pass"],
      [/\b(lint|eslint|build|ci|type check)\b[^.\n]{0,20}\b(passed|succeeded|is green|was green|ok)\b/i, "tool passed"],
      [/\bexit (code )?0\b/i, "exit code"],
      [/\b(verified|confirmed) (against|on|with|by) (a |the )?(real|live|production|preview|test) (database|postgres|endpoint|deployment|revive)/i, "live verification"],
      [/\bno (defects?|bugs?|failures?) (found|remain)/i, "no-defect claim"],
    ];
    for (const [re, label] of CLAIMS) assert.doesNotMatch(doc, re, label);
  });

  it("every sentence that says verified, confirmed or passed is a negation, a requirement or a pending item", () => {
    const ALLOWED = new RegExp(NEGATION.source + "|\\b(must|before|until|to be|required|only after|if)\\b", "i");
    for (const s of SENTENCES) {
      if (/\b(verified|confirmed|passed|passing)\b/i.test(s)) assert.match(s, ALLOWED, s);
    }
  });

  it("no sentence says Revive is verified, working, live, connected, compatible, integrated or enabled without a negation", () => {
    for (const s of SENTENCES) {
      if (!/revive/i.test(s)) continue;
      if (/\b(is|are|was|were|has been|have been)\s+(now\s+)?(verified|working|live|connected|compatible|certified|integrated|enabled|complete)\b/i.test(s)) {
        assert.match(s, NEGATION, s);
      }
      if (/\blive\b/i.test(s)) assert.match(s, NEGATION, s);
    }
  });

  it("states the limits: nothing run, nothing contacted, pilot not approved, no SQL state claimed", () => {
    const l = section("8. Limits of this checklist");
    assert.match(l, /No test, lint, build, database check or live endpoint check was run/);
    assert.match(l, /no Preview or Production service was contacted/);
    assert.match(l, /It does not approve a pilot/);
    assert.match(l, /no staging environment is published/);
    assert.match(l, /does not say which SQL is applied anywhere/);
  });
});

describe("day 30 part 2: the checklist matches the existing code and files", () => {
  it("every repository path named in the document exists", () => {
    const paths = [
      ...doc.matchAll(/`((?:app|components|lib|tests|config|scripts|examples)\/[^`\s,]+|\.github\/[^`\s,]+|[A-Z][A-Z0-9-]*\.md|\.env\.example|next\.config\.mjs)`/g),
    ].map((m) => m[1]);
    assert.ok(paths.length >= 12, `only ${paths.length} paths found`);
    for (const p of new Set(paths)) assert.ok(existsSync(path.join(ROOT, p)), p);
  });

  it("the build guard checks the secret-looking names and prefixes the document describes, and next.config loads it", () => {
    const guard = read("config/public-env-guard.mjs");
    for (const w of ["SECRET", "SERVICE_?ROLE", "PRIVATE", "PASSWORD", "TOKEN", "SIGNING", "API_?KEY", "sb_secret_", "blc_live_", "service_role"]) {
      assert.ok(guard.includes(w), w);
    }
    assert.doesNotMatch(guard, /REVIVE|DATABASE/);
    assert.match(read("next.config.mjs"), /assertPublicEnvIsSafe\(process\.env\)/);
  });

  it("the TEST database guard refuses Production, and the DB workflow starts only by hand", () => {
    assert.match(read("tests/integration/test-db-guard.ts"), /refusing to run in a production environment/);
    const wf = read(".github/workflows/integration.yml");
    const onBlock = (wf.split(/^on:\s*$/m)[1] ?? "").split(/^permissions:/m)[0];
    assert.match(onBlock, /workflow_dispatch:/);
    assert.doesNotMatch(onBlock, /push|pull_request|schedule/);
  });

  it("CI uses no repository secrets", () => {
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /secrets\./);
  });

  it("no client component imports a server-only module", () => {
    const FORBIDDEN = /from "[^"]*(supabase\/admin|ads\/service|publisher\/keys-db|ledger\/ledger-db|ads\/revive|ads\/fallback|ads\/tracking-token)"/;
    for (const f of [...walk("app"), ...walk("components")]) {
      const src = read(f);
      if (/^\s*["']use client["']/m.test(src)) assert.doesNotMatch(src, FORBIDDEN, f);
    }
  });

  it("the ad handlers write no console logs", () => {
    for (const f of ["lib/ads/match-handler.ts", "lib/ads/impression-handler.ts", "lib/ads/click-handler.ts"]) assert.doesNotMatch(read(f), /console\./, f);
  });

  it("the contract facts used in Gate A and Gate B exist in code", () => {
    const handler = read("lib/ads/match-handler.ts");
    for (const w of [/unsupported_media_type/, /415/, /payload_too_large/, /413/, /Cache-Control": "no-store"/, /invalid_request/]) assert.match(handler, w, String(w));
    assert.match(read("app/api/v1/ads/match/route.ts"), /X-Blisscco-Api-Version/);
    assert.match(read("lib/ads/click-handler.ts"), /not_found/);
    assert.match(read("lib/ads/click.ts"), /"duplicate"/);
  });

  it("the guide has the sections the checklist points to", () => {
    const guide = read("app/dashboard/publisher/guide/page.tsx");
    for (const t of ["6. Showing the ad with a Sponsored label", "6a. Disclosure and your responsibilities", "8. Why the key must stay on your server", "9. Test before any production rollout"]) {
      assert.ok(guide.includes(t), t);
    }
    assert.match(guide, /The key is shown once/);
  });

  it("this part changes no workflow and adds no .sh script", () => {
    assert.match(section("9. Not changed"), /No `\.sh` script was added, so `\.github\/workflows\/ci\.yml` is unchanged/);
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /MVP-PILOT-SAFETY-CHECKLIST/);
  });
});
