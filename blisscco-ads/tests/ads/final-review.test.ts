import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { candidateIneligibility, type AdCandidate, type MatchContext } from "@/lib/ads/category-matching";

// Day 5 final review ke extra tests. Sab data NAKLI hai (example.com, nakli uuid). Koi database/network nahi.
// Ye file purane tests nahi badalti: sirf final review me mile gaps (URL userinfo, test-data cleanup, secrets ka raasta,
// third-party chatbot ke jhoothe daave) ko pakka karti hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const CTX: MatchContext = { today: "2026-10-24", unitCostUsd: 0.002, budgetCheck: "skip" };

function candidate(destinationUrl: string): AdCandidate {
  return {
    ad: {
      id: "a0000000-0000-4000-8000-0000000000f1",
      headline: "Headline",
      body: "Body",
      ctaText: "Learn more",
      destinationUrl,
    },
    creativeStatus: "approved",
    campaignId: "10000000-0000-4000-8000-0000000000f1",
    campaignStatus: "active",
    category: "technology",
    startDate: "2026-10-01",
    endDate: null,
    totalBudget: 100,
    dailyBudget: null,
    spentTotal: 0,
    spentToday: 0,
    advertiserStatus: "active",
    advertiserProfileStatus: "active",
    campaignServesToday: 0,
    creativeServesToday: 0,
  };
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) listSources(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("final review: destination URL safety (userinfo / phishing)", () => {
  for (const url of [
    "https://trusted-site.com@evil.example/page",
    "https://user:pass@example.com/",
    "https://@example.com/",
    "https://example.com@evil.example",
    "https://a@b?x=1",
    "https://a@b#frag",
  ]) {
    it(`rejects ${url}`, () => {
      assert.equal(candidateIneligibility(candidate(url), "technology", CTX), "creative_incomplete");
    });
  }

  for (const url of [
    "https://example.com/",
    "https://example.com/a@b",
    "https://example.com/?email=a@b.example",
    "https://example.com/#a@b",
    "https://sub.example.com:8443/path?x=1",
  ]) {
    it(`allows ${url} ('@' only after the host is fine)`, () => {
      assert.equal(candidateIneligibility(candidate(url), "technology", CTX), null);
    });
  }

  it("http:// and javascript: URLs are still rejected", () => {
    for (const url of ["http://example.com", "javascript:alert(1)", "https://exa mple.com", "//example.com"]) {
      assert.equal(candidateIneligibility(candidate(url), "technology", CTX), "creative_incomplete", url);
    }
  });

  it("schema: day-5-11 migration blocks userinfo, is NOT VALID first and validated separately", () => {
    const sql = read("supabase/sql/day-5-11-creative-url-hardening.sql").replace(/--.*$/gm, "");
    assert.match(sql, /ad_creatives_destination_url_no_userinfo_check/);
    assert.match(sql, /check\s*\(destination_url !~\* '\^https:\/\/\[\^\/\?#\]\*@'\)\s*not valid/i);
    assert.match(sql, /validate constraint ad_creatives_destination_url_no_userinfo_check/i);
    assert.ok(!/\b(delete|truncate|drop table|update)\b/i.test(sql.replace(/drop constraint if exists/gi, "")));
  });
});

describe("final review: test-data cleanup SQL is narrow and safe", () => {
  const sql = read("supabase/sql/day-5-10-test-data-cleanup.sql").replace(/--.*$/gm, "");
  const statements = sql.split(";").map((s) => s.trim()).filter((s) => /^delete\b/i.test(s));

  it("has a delete for every Day 5 table that blocks the old cleanup", () => {
    for (const table of ["ad_serve_log", "creative_serve_daily", "campaign_spend_daily", "publisher_api_keys"]) {
      assert.ok(statements.some((s) => s.includes(`public.${table}`)), table);
    }
  });

  it("every delete has a where clause limited to exact TEST names", () => {
    assert.ok(statements.length >= 8);
    for (const s of statements) {
      assert.match(s, /\bwhere\b/i, s);
      assert.match(s, /'TEST (creative|Campaign|Advertiser|Publisher) [A-D]'/, s);
    }
  });

  it("children are deleted before parents (foreign keys are ON DELETE RESTRICT)", () => {
    const at = (table: string) => statements.findIndex((s) => s.startsWith(`delete from public.${table}`));
    for (const t of ["ad_serve_log", "creative_serve_daily", "campaign_spend_daily", "publisher_api_keys", "ad_creatives", "campaigns", "advertisers", "publishers"]) {
      assert.ok(at(t) >= 0, `delete for ${t}`);
    }
    assert.ok(at("ad_serve_log") < at("ad_creatives"));
    assert.ok(at("creative_serve_daily") < at("ad_creatives"));
    assert.ok(at("campaign_spend_daily") < at("campaigns"));
    assert.ok(at("publisher_api_keys") < at("publishers"));
    assert.ok(at("ad_creatives") < at("campaigns"));
    assert.ok(at("campaigns") < at("advertisers"));
  });

  it("runs inside one transaction and never touches auth.users", () => {
    assert.match(sql, /\bbegin;/i);
    assert.match(sql, /\bcommit;/i);
    assert.ok(!/auth\.users/i.test(sql));
  });
});

describe("final review: secrets never reach the browser", () => {
  const files = [...listSources("app"), ...listSources("components"), ...listSources("lib")];

  it("no client component imports the admin client or the ads server modules", () => {
    const clientFiles = files.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    assert.ok(clientFiles.length > 5, "expected several client components");
    for (const f of clientFiles) {
      const src = read(f);
      assert.ok(!/supabase\/admin|lib\/ads\/(service|serve-db|candidate-loader|match)\b|SUPABASE_SECRET/.test(src), f);
    }
  });

  it("SUPABASE_SECRET_KEY is read in exactly one file, and that file is server-only", () => {
    const users = files.filter((f) => read(f).replace(/\/\/.*$/gm, "").includes("SUPABASE_SECRET_KEY"));
    assert.deepEqual(users, ["lib/supabase/admin.ts"]);
    assert.match(read("lib/supabase/admin.ts"), /import "server-only";/);
  });

  it("every module that touches the admin client imports server-only", () => {
    for (const f of files.filter((x) => /createAdminClient/.test(read(x)) && x !== "lib/supabase/admin.ts")) {
      assert.match(read(f), /import "server-only";/, f);
    }
  });

  it("no NEXT_PUBLIC_ variable holds a secret/service name", () => {
    for (const f of files) {
      assert.ok(!/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE)/.test(read(f).replace(/\/\/.*$/gm, "")), f);
    }
    const example = read(".env.example");
    assert.ok(!/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE)/.test(example));
    assert.match(example, /^SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY$/m, "placeholder only");
    assert.ok(!/sb_secret_[A-Za-z0-9]{20,}/.test(example), "no real-looking secret in .env.example");
  });

  it("the public ad route does not set CORS headers (key must stay on the publisher's server)", () => {
    assert.ok(!/access-control-allow/i.test(read("app/api/ads/match/route.ts")));
  });
});

describe("final review: no overclaiming about third-party chatbots or readiness", () => {
  const files = [...listSources("app"), ...listSources("components"), ...listSources("lib")];

  it("no page copy says ads work inside ChatGPT or another named third-party chatbot", () => {
    for (const f of files) {
      const text = read(f).replace(/\/\/.*$/gm, "");
      assert.ok(
        !/(?<!\bno\s)(?<!\bnot\s)\b(works?|integrat\w*|available|live)\s+(with|in|inside|on)\s+(chatgpt|openai|gemini|claude|perplexity|copilot)/i.test(text),
        f,
      );
    }
  });

  it("the publisher guide says keys are manual and that no third-party integration exists", () => {
    const guide = read("app/dashboard/publisher/guide/page.tsx").replace(/\s+/g, " ");
    assert.match(guide, /not self-service/);
    assert.match(guide, /no integration with ChatGPT or any other third-party chatbot/);
    assert.ok(!/There is no live API/.test(guide), "stale claim removed");
  });

  it("no code or copy calls the ad system production-ready", () => {
    for (const f of files) {
      assert.ok(!/production[- ]ready/i.test(read(f)), f);
    }
  });
});
