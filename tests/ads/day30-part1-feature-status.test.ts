import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Day 30 Part 1: MVP-FEATURE-STATUS.md has the required status sections, keeps implemented / prototype / not-integrated apart,
// and claims no verification result and no live integration. Reads local files only: no network, no database, no npm, no secrets.

const ROOT = path.join(__dirname, "..", "..", "..");
const DOC = "MVP-FEATURE-STATUS.md";
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const doc = read(DOC);

/** Text of a "## Heading" section, up to the next "## " heading. */
function section(title: string): string {
  const parts = doc.split(/^## /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

/** Text of a "### Heading" subsection inside a section, up to the next "### " heading. */
function subsection(sectionText: string, title: string): string {
  const parts = sectionText.split(/^### /m).slice(1);
  const hit = parts.find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `subsection missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
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
// Phase 2 Step 4: the only allowed positive wording is a status-table row for a check the user personally ran and reported,
// in exactly this shape, under a "### Phase 2 Step N status" heading. Every other sentence keeps the strict rule.
const USER_CONFIRMED_ROW = /^\| [^|\n]+ \| [^|\n]+ \| \*\*User-confirmed — completed successfully\*\*( \(scope as reported\))? \|$/;
const CLAIM_SENTENCES = SENTENCES.filter((x) => !USER_CONFIRMED_ROW.test(x));

describe("day 30 part 1: document structure", () => {
  it("has the title and every required section", () => {
    assert.match(doc, /^# Blisscco Online Ad Network — MVP Feature Status \(Day 30 Part 1\)/m);
    for (const s of [
      "Implemented features",
      "Prototypes and previews",
      "Not yet integrated",
      "Known verification limitations",
      "What stays manual",
      "Not changed",
    ]) {
      assert.ok(section(s).trim().length > 40, s);
    }
  });

  it("describes each feature area under Implemented features", () => {
    const impl = section("Implemented features");
    for (const area of ["Advertiser", "Publisher", "Contextual ad matching", "Tracking", "Dashboard", "Fallback ads (optional, off by default)"]) {
      assert.ok(subsection(impl, area).trim().length > 80, area);
    }
  });

  it("says up front that nothing was run and that implemented does not mean tested", () => {
    assert.match(doc, /Nothing was run to write it/);
    assert.match(doc, /No test, type check, lint, build, `npm install`, database check or live endpoint check was started/);
    assert.match(doc, /does not mean "tested" or "working in a deployed environment"/);
  });
});

describe("day 30 part 1: implemented, prototype and not-integrated stay separate", () => {
  const impl = section("Implemented features");
  const proto = section("Prototypes and previews");
  const notYet = section("Not yet integrated");

  it("keeps the Revive JSON preview out of Implemented features and inside Prototypes and previews", () => {
    assert.doesNotMatch(impl, /revive-json-preview|REVIVE_JSON_PREVIEW_ENABLED/);
    assert.match(proto, /Revive JSON preview route/);
    assert.match(proto, /`GET \/api\/revive-json-preview`/);
    assert.match(proto, /REVIVE_JSON_PREVIEW_ENABLED/);
  });

  it("states explicitly that the Revive JSON preview is not proof of a live Revive integration", () => {
    assert.match(proto, /The Revive JSON preview is not proof of a live Revive integration/);
    assert.match(proto, /not connected to the match API, fallback, serving, billing, tracking or ledger/);
  });

  it("lists the other prototypes, fixtures, manual scripts and demo-only code as non-features", () => {
    for (const p of [
      /examples\/revive-provider\/ad\.json/,
      /scripts\/revive-json-preview-check\.mjs/,
      /scripts\/revive-preview-smoke-test\.mjs/,
      /scripts\/day28-verify\.sh/,
      /examples\/publisher-node\//,
      /examples\/publisher-nextjs\//,
      /lib\/demo-data\.ts/,
    ]) assert.match(proto, p, String(p));
  });

  it("lists what is not integrated, including a real Revive endpoint", () => {
    assert.match(notYet, /A real Revive endpoint/);
    assert.match(notYet, /No real Revive URL, account or response exists in the repository/);
    assert.match(notYet, /Tracking, reporting or billing for Revive ads/);
    assert.match(notYet, /A payment provider/);
    assert.match(notYet, /Revive HTML or JavaScript ad tags/);
  });

  it("describes the fallback as optional, default off, never run against a real Revive server", () => {
    const fb = subsection(impl, "Fallback ads (optional, off by default)");
    assert.match(fb, /REVIVE_FALLBACK_ENABLED/);
    assert.match(fb, /Default is off/);
    assert.match(fb, /It has never been run against a real Revive server/);
    assert.match(fb, /no `tracking` or `click_ref`/);
    assert.match(fb, /no serve record, no advertiser charge, no ledger entry and no publisher earning/);
  });
});

describe("day 30 part 1: verification limitations are pending, never claimed", () => {
  const v = section("Known verification limitations");

  it("names every check that remains pending", () => {
    assert.match(v, /All of the following are pending\. No result is claimed for any of them/);
    for (const what of [
      /Official dependency installation \(`npm ci`/,
      /Tests \(`npm test`\)/,
      /`npm run lint`/,
      /ESLint \(`npm run lint:eslint`\)/,
      /Production build \(`npm run build`\)/,
      /GitHub CI/,
      /TEST PostgreSQL/,
      /Real Revive endpoint verification: not done/,
    ]) assert.match(v, what, String(what));
    assert.match(v, /implemented, not verified/);
  });

  it("claims no test, lint, build, CI or database result anywhere", () => {
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

  it("has no results table (suite counts) like a run report would", () => {
    assert.doesNotMatch(doc, /\|\s*Tests\s*\|\s*Pass\s*\|\s*Fail/i);
    assert.doesNotMatch(doc, /\|\s*Suite\s*\|/i);
  });

  it("every sentence that says verified, confirmed, tested or passed also carries a negation", () => {
    for (const s of CLAIM_SENTENCES) {
      if (/\b(verified|confirmed|tested|passed|passing)\b/i.test(s)) assert.match(s, NEGATION, s);
    }
  });
});

describe("day 30 part 1: no live integration is claimed", () => {
  it("no sentence says Revive is verified, working, live, connected, compatible, certified, integrated or enabled without a negation", () => {
    for (const s of SENTENCES) {
      if (!/revive/i.test(s)) continue;
      if (/\b(is|are|was|were|has been|have been)\s+(now\s+)?(verified|working|live|connected|compatible|certified|integrated|enabled|complete)\b/i.test(s)) {
        assert.match(s, NEGATION, s);
      }
      if (/\blive\b/i.test(s)) assert.match(s, NEGATION, s);
    }
  });

  it("makes no live, real or Production integration claim", () => {
    assert.doesNotMatch(doc, /\b(live|real|production) (revive )?(integration|endpoint) (is|was|has been) (working|verified|connected|complete|enabled)/i);
    assert.doesNotMatch(doc, /\b(production|preview) (is|was|has been) (verified|working|live|deployed)\b/i);
  });

  it("keeps the Revive flags off and the real check manual", () => {
    const m = section("What stays manual");
    assert.match(m, /Keep `REVIVE_FALLBACK_ENABLED` and `REVIVE_JSON_PREVIEW_ENABLED` unset/);
    assert.match(m, /Preview only/);
    assert.match(m, /DAY27-REAL-REVIVE-VERIFICATION\.md/);
  });
});

describe("day 30 part 1: the document matches the existing code", () => {
  it("every repository path named in the document exists", () => {
    const paths = [
      ...doc.matchAll(/`((?:app|components|lib|tests|examples|supabase|scripts)\/[^`\s,]+|\.github\/[^`\s,]+|DAY\d+-[A-Z0-9-]+\.md|MVP-FEATURE-STATUS\.md)`/g),
    ].map((m) => m[1]);
    assert.ok(paths.length >= 25, `only ${paths.length} paths found`);
    for (const p of new Set(paths)) assert.ok(existsSync(path.join(ROOT, p)), p);
  });

  it("the nine categories in the document match the category list in code", () => {
    const constants = read("lib/campaigns/constants.ts");
    const list = constants.slice(constants.indexOf("CATEGORY_OPTIONS = ["), constants.indexOf("] as const"));
    assert.equal((list.match(/value: "/g) ?? []).length, 9);
    assert.match(section("Implemented features"), /one of nine categories/);
  });

  it("the match endpoint is shared by both routes and reaches the fallback through service.ts", () => {
    assert.match(read("app/api/v1/ads/match/route.ts"), /handleMatchPost/);
    assert.match(read("app/api/ads/match/route.ts"), /handleMatchPost/);
    assert.match(read("lib/ads/match-handler.ts"), /serveMatchForPublisher/);
    assert.match(read("lib/ads/service.ts"), /routeServeWithFallback/);
  });

  it("the fallback flag name, default timeout and no-tracking behavior match the document", () => {
    assert.match(read("lib/ads/fallback-provider.ts"), /REVIVE_FALLBACK_FLAG = "REVIVE_FALLBACK_ENABLED"/);
    assert.match(read("lib/ads/revive-adapter.ts"), /REVIVE_DEFAULT_TIMEOUT_MS = 800/);
    assert.match(read("lib/ads/fallback-routing.ts"), /charged: false/);
    assert.match(read("lib/ads/fallback-routing.ts"), /serveRecorded: false/);
    assert.match(read("lib/ads/fallback-provider.ts"), /`tracking` kabhi nahi/);
  });

  it("the preview route is flag-gated and imports nothing but the preview module", () => {
    const route = read("app/api/revive-json-preview/route.ts");
    const imports = route.split("\n").filter((l) => /^import /.test(l));
    assert.equal(imports.length, 1);
    assert.match(imports[0], /@\/lib\/ads\/revive-json-preview"/);
    const mod = read("lib/ads/revive-json-preview.ts");
    assert.match(mod, /PREVIEW_ENV_FLAG = "REVIVE_JSON_PREVIEW_ENABLED"/);
    for (const l of mod.split("\n").filter((x) => /^import /.test(x))) {
      assert.doesNotMatch(l, /ledger|supabase|service|match-handler|serve|impression|click|tracking/i, l);
    }
    assert.match(mod, /example\.com/);
  });

  it("the demo-only components listed in the document are not imported by any page", () => {
    const files = [...walk("app"), ...walk("components"), ...walk("lib")];
    const orphan = /from "[^"]*\/(AdvertiserWorkspace|CampaignsExplorer|RecentCampaigns|ActivityList)"|from "[^"]*\/(?<!Publisher)AnalyticsView"/;
    for (const f of files) {
      if (/^components\/dashboard\/(AdvertiserWorkspace|CampaignsExplorer|RecentCampaigns|ActivityList|AnalyticsView)\.tsx$/.test(f)) continue;
      const src = read(f);
      assert.doesNotMatch(src, orphan, f);
      if (f !== "components/dashboard/CampaignsExplorer.tsx") assert.doesNotMatch(src, /from "[^"]*\/CampaignTable"/, f);
    }
    assert.match(proto(), /`CampaignTable` is imported only by `CampaignsExplorer`/);
  });

  it("CI does not call the manual verify script, and the workflow was not edited for this document", () => {
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /day28-verify|MVP-FEATURE-STATUS/);
    assert.match(section("Not changed"), /No `\.sh` script was added, so `\.github\/workflows\/ci\.yml` is unchanged/);
  });
});

describe("phase 2 step 4: evidence status stays honest", () => {
  const ev = section("Evidence status by source (Phase 2 Step 4)");

  it("keeps the five kinds of evidence apart and names the report", () => {
    for (const w of [/\*\*Implemented\*\*/, /\*\*Automated\*\*/, /\*\*Preview\*\*/, /\*\*User-confirmed\*\*/, /\*\*Pending or unverified\*\*/]) assert.match(ev, w, String(w));
    assert.match(ev, /`PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT\.md`/);
    assert.ok(existsSync(path.join(ROOT, "PHASE2-STEP4-DOCUMENTATION-ALIGNMENT-REPORT.md")));
  });

  it("the original authoring statements are kept and scoped, not deleted", () => {
    assert.match(doc, /Nothing was run to write it/);
    assert.match(doc, /Status update \(Phase 2 Step 4\)/);
    assert.match(section("Known verification limitations"), /state at the time this file was first written/);
    assert.match(section("Known verification limitations"), /All of the following are pending\. No result is claimed for any of them/);
  });

  it("user-confirmed rows are only in a Phase 2 status table, in the exact shape, and never cover CI, build, lint or a database", () => {
    let heading = "";
    let count = 0;
    for (const l of doc.split("\n")) {
      if (/^#{2,3} /.test(l)) heading = l;
      if (/User-confirmed/.test(l) && /^\|/.test(l)) {
        count++;
        assert.match(l, USER_CONFIRMED_ROW, l);
        assert.match(heading, /^### Phase 2 Step \d+ status/, l);
        assert.doesNotMatch(l, /\b(npm|lint|eslint|build|CI|PostgreSQL|database|integration)\b/i, l);
      }
    }
    assert.ok(count >= 8, `only ${count} user-confirmed rows`);
  });

  it("Revive and Production stay Pending or Unverified; the campaign page error is closed only on the user's word", () => {
    const rows = ev.split("\n").filter((l) => /^\|/.test(l));
    const row = (re: RegExp) => rows.find((l) => re.test(l)) ?? assert.fail(String(re));
    assert.match(row(/Controlled Revive test/), /\*\*Pending\*\*/);
    const cp = row(/Advertiser campaign page error/);
    assert.doesNotMatch(cp, /\*\*Pending\*\*/);
    assert.match(cp, /user's word/);
    assert.match(cp, /Claude saw no log or output/);
    assert.ok(rows.some((l) => /Campaign page error: cause/.test(l) && /\*\*User-confirmed — completed successfully\*\*/.test(l)));
    assert.match(row(/Production deployment and Production data/), /\*\*Unverified\*\*/);
    assert.match(row(/Real Revive endpoint/), /\*\*Unverified\*\*/);
    assert.match(row(/Revive fallback wiring/), /\*\*Unverified\*\*/);
    assert.match(row(/Publisher example code/), /\*\*Unverified\*\*/);
    assert.match(row(/scheduled cleanup/), /\*\*Unverified\*\*/);
  });

  it("no Production, Revive or CI row is marked as a success", () => {
    for (const l of ev.split("\n").filter((x) => /^\|/.test(x))) {
      if (/Production|Revive|CI\b/.test(l) && !/Revive fallback and Revive preview flags unset in Preview/.test(l)) {
        assert.doesNotMatch(l, /User-confirmed — completed successfully/, l);
      }
    }
  });

  it("the stale line that said no deployed environment was checked is gone", () => {
    assert.doesNotMatch(section("Not yet integrated"), /Nothing here confirms either one/);
    assert.match(section("Not yet integrated"), /Production was never accessed/);
  });
});

describe("phase 2 step 4: privacy and terms pages stay inside the evidence", () => {
  const privacy = read("app/privacy/page.tsx").replace(/\s+/g, " ");
  const terms = read("app/terms/page.tsx").replace(/\s+/g, " ");

  it("keeps the existing prompt-handling sentence and adds what the API really does with a request", () => {
    assert.match(privacy, /does not receive, store or log chatbot prompts, conversations or user identifiers/);
    assert.match(privacy, /reads a request only to check it/);
    assert.match(privacy, /does not write the request body to our database and does not log it/);
    assert.match(privacy, /standard server logs of the request itself/);
    assert.match(read("lib/ads/match-handler.ts"), /logging nahi hoti|logging nahi hai/);
    assert.doesNotMatch(read("lib/ads/match-handler.ts"), /console\./);
  });

  it("retention periods are described as targets, with the cleanup condition", () => {
    assert.match(privacy, /set up to be removed by a cleanup routine once they are about 90 days old/);
    assert.match(privacy, /they are targets and not a guarantee/);
    assert.match(read("supabase/sql/day-7-1-budget-keys-retention.sql"), /pg_cron/);
  });

  it("claims no legal compliance, certification or guaranteed outcome", () => {
    for (const t of [privacy, terms]) {
      assert.doesNotMatch(t, /\b(GDPR|CCPA|HIPAA|SOC ?2|ISO ?27001)\b/);
      assert.doesNotMatch(t, /\b(fully |is |are )compliant\b|\bcertified\b/i);
      assert.doesNotMatch(t, /guaranteed (earnings|fill|income|revenue|results)|you will (earn|receive|get paid)/i);
    }
    assert.match(privacy, /not a statement that Blisscco meets the requirements of any particular privacy law or certification/);
    assert.match(terms, /We do not guarantee that an ad is available, how many ads you receive, or how much you earn/);
    assert.match(terms, /not a promise of earnings, ad volume or results|promise of earnings, ad volume or results/);
  });

  it("does not name or claim a live Revive integration", () => {
    assert.doesNotMatch(privacy, /revive/i);
    assert.doesNotMatch(terms, /revive/i);
  });
});

describe("day 30 part 1: scope and safety", () => {
  it("states that behavior, SQL, data, credentials, payment, ledger and deployment were not changed", () => {
    const n = section("Not changed");
    for (const w of [/Application behavior/, /SQL and migration files/, /Production data/, /credentials/, /payment/, /ledger/, /deployment/]) {
      assert.match(n, w, String(w));
    }
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

  it("names no SQL file", () => {
    assert.doesNotMatch(doc, /`[^`]*\.sql`/);
  });
});

function proto(): string {
  return section("Prototypes and previews");
}
