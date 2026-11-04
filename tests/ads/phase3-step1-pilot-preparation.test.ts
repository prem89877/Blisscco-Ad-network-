import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Phase 3 Step 1: the pilot documents keep the pilot limited, claim no check as done, never call the API ready for
// production, and the report names real files. Reads local files only: no network, no database, no npm, no secrets.
// A passing run shows the documents agree with their own rules. It does not show that any product check passed.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const safety = read("MVP-PILOT-SAFETY-CHECKLIST.md");
const onboarding = read("PUBLISHER-PILOT-ONBOARDING.md");
const report = read("PHASE3-STEP1-PILOT-PREPARATION-REPORT.md");

function section(doc: string, title: string): string {
  const hit = doc.split(/^## /m).slice(1).find((p) => p.split("\n")[0].trim() === title);
  assert.ok(hit, `section missing: ${title}`);
  return hit.split("\n").slice(1).join("\n");
}

describe("phase 3 step 1: pilot scope in the safety checklist", () => {
  const s = section(safety, "10. Phase 3 Step 1: controlled pilot scope and limits");

  it("keeps the pilot limited and not public", () => {
    for (const re of [
      /At most 1 trusted chatbot publisher/,
      /At most 2 early advertisers/,
      /Only Blisscco contextual ads/,
      /Revive fallback stays off/,
      /Payouts stay manual/,
      /signup page is not promoted/,
      /not a public launch/,
    ]) assert.match(s, re, String(re));
  });

  it("sets no cap number and says the code has no pilot cap", () => {
    assert.match(s, /The application has no pilot cap/);
    assert.match(s, /This document sets no number/);
    assert.doesNotMatch(s, /\$\s?\d/);
  });

  it("has revoke first, stop conditions and a sign-off with no filled row", () => {
    assert.match(s, /Revoke the key on the Publisher page\. Do this before anything else/);
    assert.match(s, /Stop the pilot at once on any condition below/);
    const rows = s.split("\n").filter((l) => /^\| (Pilot scope|Budget caps|Payout maximum|Revoke practised|Stop thresholds)/.test(l));
    assert.equal(rows.length, 5);
    for (const r of rows) assert.match(r, /\| \| \| \| NOT CONFIRMED \|$/, r);
  });
});

describe("phase 3 step 1: observation checklist", () => {
  const s = section(safety, "11. Phase 3 Step 1: pilot observation checklist");

  it("covers all eight observations and the record format", () => {
    for (const w of [
      "Ad match response latency",
      "API errors and timeout behavior",
      "Fill and no-fill rate",
      "Ad relevance",
      "Impression and click consistency",
      "Publisher integration errors",
      "Advertiser campaign spend",
      "Publisher earnings and payout records",
    ]) assert.ok(s.includes(w), w);
    for (const w of ["Date (UTC)", "Environment", "Actual result", "Method and tool", "Source of the result"]) assert.ok(s.includes(w), w);
    assert.match(s, /not measured/);
  });

  it("fills in no measured value", () => {
    assert.doesNotMatch(s, /\b\d+(\.\d+)?\s?(ms|milliseconds|%)/i);
  });
});

describe("phase 3 step 1: publisher onboarding for the pilot", () => {
  const s = section(onboarding, "10. Controlled pilot rules for the publisher (Phase 3 Step 1)");

  it("covers manual approval, no conversation data, relevance, no-fill, tracking limits and revoke", () => {
    for (const re of [
      /approves the pilot publisher account by hand/,
      /Raw chatbot conversation text, user ids, emails, session ids and other personal data never go to Blisscco/,
      /Relevance:/,
      /No-fill:/,
      /Tracking limits:/,
      /revoke that key first/,
      /Revoking cannot be undone/,
    ]) assert.match(s, re, String(re));
  });

  it("does not approve the pilot or call the API ready", () => {
    assert.match(s, /does not approve it/);
    assert.match(s, /not ready for production use/);
  });
});

describe("phase 3 step 1: no check is claimed as done", () => {
  it("has no ticked box in any pilot document", () => {
    for (const d of [safety, onboarding, report]) assert.doesNotMatch(d, /^\s*- \[[xX]\]/m);
  });

  it("the report does not declare the API or the pilot ready", () => {
    assert.match(report, /NOT STARTED\. NOT APPROVED\. NOT A PUBLIC LAUNCH/);
    assert.match(report, /The publisher API is not declared ready for production use or for real pilot traffic/);
    assert.match(section(report, "5. Is the publisher API safe for real pilot traffic?"), /\*\*No\. It is not declared ready\.\*\*/);
  });

  it("the report keeps earlier evidence labelled as the user's word", () => {
    assert.match(report, /User-confirmed, on the user's word/);
    assert.match(report, /rest on the user's word|rests on the user's word|on the user's word/);
  });
});

describe("phase 3 step 1: the report names real files", () => {
  it("every backticked repository path and document exists", () => {
    const names = [...report.matchAll(/`((?:app|components|lib|tests|config|scripts|examples)\/[^`\s,]+|\.github\/[^`\s,]+|[A-Z][A-Z0-9-]*\.md)`/g)].map((m) => m[1]);
    assert.ok(names.length >= 8);
    for (const n of new Set(names)) assert.ok(existsSync(path.join(ROOT, n)), n);
  });

  it("changes no workflow and adds no .sh script", () => {
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /PHASE3-STEP1|PILOT-PREPARATION/);
  });
});

describe("phase 3 step 1: Gate A report from the user", () => {
  const s = section(report, "10. Gate A checks reported by the user (2026-11-04)");

  it("labels every result as user-reported and keeps Gate A open", () => {
    assert.match(s, /\*\*User-reported\*\*, on the user's word only/);
    assert.match(s, /Gate A stays NOT CONFIRMED/);
    for (const w of ["unauthorized", "unknown_field", "unsupported_media_type", "payload_too_large", "no-fill answer"]) assert.ok(s.includes(w), w);
    assert.match(s, /Still pending: the response headers/);
  });

  it("does not claim the key was revoked and writes no key value", () => {
    assert.match(s, /A revoke has not been reported, so it is pending/);
    assert.doesNotMatch(report, /blc_live_[0-9a-f]{8,}/i);
    assert.doesNotMatch(safety, /blc_live_[0-9a-f]{8,}/i);
    assert.doesNotMatch(report, /vercel\.app/i);
  });

  it("the safety checklist keeps every gate NOT CONFIRMED and points to the record", () => {
    assert.match(safety, /Gate A: on 2026-11-04 the user reported/);
    assert.match(safety, /the gate stays NOT CONFIRMED/);
    const rows = safety.split("\n").filter((l) => /^\| (Section \d|Gate [A-D])/.test(l));
    assert.equal(rows.length, 9);
    for (const r of rows) assert.match(r, /\| NOT CONFIRMED \|$/, r);
  });

  it("the cross-document table names real files", () => {
    const x = section(report, "11. Cross-document status after the Gate A report");
    for (const f of ["PHASE2-STABILIZATION-EXIT-REPORT.md", "DAY30-MVP-HANDOFF-REPORT.md", "DAY-B-CI-TEST-DB-VERIFICATION-REPORT.md", "MVP-FEATURE-STATUS.md", "MVP-VERIFICATION-RUNBOOK.md"]) {
      assert.ok(x.includes("`" + f + "`"), f);
      assert.ok(existsSync(path.join(ROOT, f)), f);
    }
  });
});
