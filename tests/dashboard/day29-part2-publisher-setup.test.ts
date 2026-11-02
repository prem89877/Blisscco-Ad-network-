import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toPublisherKey, type PublisherKey } from "@/lib/publisher/keys";
import type { MyPublisher } from "@/lib/publisher/publisher";
import { GUIDE_HREF, SETUP_STEP_ORDER, buildSetupSteps, propertyGuidance, propertyIsIncomplete, type SetupStep } from "@/lib/publisher/setup-guidance";

// Day 29 Part 2: publisher setup guidance. Setup states, next-action text and key secrecy.
// Logic runs for real (pure module, no database, no network, no secrets). The repo's test build does not compile .tsx,
// so page / component wording is checked from source, the same way the other dashboard tests do it.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const PAGE = "app/dashboard/publisher/page.tsx";
const KEYS_UI = "components/dashboard/PublisherKeyManager.tsx";
const CARD = "components/dashboard/PropertyCard.tsx";
const BADGE = "components/dashboard/PropertyStatusBadge.tsx";
const LIB = "lib/publisher/setup-guidance.ts";

const NOW = new Date("2026-11-02T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();

const pub = (status: MyPublisher["status"]): MyPublisher => ({ id: "00000000-0000-4000-8000-0000000000a1", status, name: "Test Chat", websiteUrl: null, category: null });
// Only the PUBLIC parts of a key exist in the key list: prefix (13 chars) and hint (last 4). No full key, no hash.
const key = (over: Partial<PublisherKey> = {}): PublisherKey => ({
  id: "00000000-0000-4000-8000-0000000000b1",
  label: "Production server",
  prefix: "blc_live_ab12",
  hint: "cd34",
  status: "active",
  createdAt: iso(-3),
  lastUsedAt: null,
  expiresAt: iso(60),
  ...over,
});

const byId = (steps: SetupStep[]) => Object.fromEntries(steps.map((s) => [s.id, s])) as Record<SetupStep["id"], SetupStep>;

describe("day 29 part 2: setup status shows only what the data proves", () => {
  it("always returns the four steps in the same order, each with a visible text label", () => {
    for (const steps of [
      buildSetupSteps(null, null, NOW),
      buildSetupSteps(pub("pending"), null, NOW),
      buildSetupSteps(pub("active"), [], NOW),
      buildSetupSteps(pub("suspended"), [key()], NOW),
    ]) {
      assert.deepEqual(steps.map((s) => s.id), [...SETUP_STEP_ORDER]);
      for (const s of steps) {
        assert.ok(s.label.length > 0 && s.title.length > 0 && s.detail.length > 0, s.id);
      }
    }
  });

  it("no publisher yet: platform details are the next step and nothing is marked done", () => {
    const s = byId(buildSetupSteps(null, null, NOW));
    assert.equal(s.platform.state, "next");
    assert.match(s.platform.action ?? "", /Set up your platform/);
    assert.equal(s.approval.state, "locked");
    assert.equal(s.key.state, "locked");
    assert.equal(s["first-use"].state, "locked");
    assert.equal(Object.values(s).some((x) => x.state === "done"), false);
  });

  it("pending: platform saved, approval waiting (no fake approval), keys not available", () => {
    const s = byId(buildSetupSteps(pub("pending"), null, NOW));
    assert.equal(s.platform.state, "done");
    assert.equal(s.approval.state, "waiting");
    assert.match(s.approval.label, /Waiting for approval/);
    assert.match(s.approval.detail, /by hand/);
    assert.match(s.approval.action ?? "", /once the account is approved/);
    assert.equal(s.key.state, "locked");
    assert.equal(s["first-use"].state, "locked");
  });

  it("approved without keys: approval done, the next step is creating a key and it says the key is shown once", () => {
    const s = byId(buildSetupSteps(pub("active"), [], NOW));
    assert.equal(s.approval.state, "done");
    assert.equal(s.key.state, "next");
    assert.match(s.key.label, /No active key/);
    assert.match(s.key.action ?? "", /shown only once/);
    assert.match(s.key.action ?? "", /server settings/);
    assert.equal(s["first-use"].state, "locked");
  });

  it("approved but the key list could not be loaded: unknown, never 'done' and never 'no keys'", () => {
    const s = byId(buildSetupSteps(pub("active"), null, NOW));
    assert.equal(s.key.state, "unknown");
    assert.match(s.key.action ?? "", /Refresh/);
    assert.equal(s["first-use"].state, "locked");
    assert.doesNotMatch(s.key.detail, /not created a key/);
  });

  it("an active, usable key makes the key step done and the first request the next step, with a guide link", () => {
    const s = byId(buildSetupSteps(pub("active"), [key()], NOW));
    assert.equal(s.key.state, "done");
    assert.equal(s.key.label, "1 active key");
    assert.equal(s["first-use"].state, "next");
    assert.equal(s["first-use"].label, "Not used yet");
    assert.equal(s["first-use"].href, GUIDE_HREF);
    assert.equal(GUIDE_HREF, "/dashboard/publisher/guide");
    assert.match(s["first-use"].action ?? "", /integration guide/);
  });

  it("two usable keys are counted in plural", () => {
    const s = byId(buildSetupSteps(pub("active"), [key(), key({ id: "00000000-0000-4000-8000-0000000000b2" })], NOW));
    assert.equal(s.key.label, "2 active keys");
  });

  it("the first request is done only when a key has a Last used date, and it never claims an ad was shown", () => {
    const s = byId(buildSetupSteps(pub("active"), [key({ lastUsedAt: iso(-1) })], NOW));
    assert.equal(s["first-use"].state, "done");
    assert.match(s["first-use"].detail, /does not show that an ad was displayed/);
    assert.equal(s["first-use"].action, null);
  });

  it("revoked or expired keys do not count as an active key (expiry uses the given clock)", () => {
    const revoked = byId(buildSetupSteps(pub("active"), [key({ status: "revoked", lastUsedAt: iso(-2) })], NOW));
    const expired = byId(buildSetupSteps(pub("active"), [key({ expiresAt: iso(-1), lastUsedAt: iso(-5) })], NOW));
    for (const s of [revoked, expired]) {
      assert.equal(s.key.state, "next");
      assert.match(s.key.detail, /revoked or expired/);
      assert.match(s.key.action ?? "", /Create a key/);
      assert.equal(s["first-use"].state, "locked", "old use of a dead key is not a finished first request");
    }
    // The same key that is expired at NOW is still usable earlier: the clock is an input, not Date.now().
    const earlier = byId(buildSetupSteps(pub("active"), [key({ expiresAt: iso(-1) })], new Date(NOW.getTime() - 3 * DAY)));
    assert.equal(earlier.key.state, "done");
  });

  it("suspended: approval is blocked, keys do not work, no step asks the publisher to create a key", () => {
    const s = byId(buildSetupSteps(pub("suspended"), [key()], NOW));
    assert.equal(s.approval.state, "blocked");
    assert.match(s.approval.label, /Suspended/);
    assert.match(s.approval.detail, /keys do not work/);
    assert.match(s.approval.action ?? "", /contact support/i);
    assert.equal(s.key.state, "blocked");
    assert.equal(s.key.action, null);
    assert.equal(s["first-use"].state, "locked");
  });

  it("a later step is never done unless every earlier step is done (no fake completion), across many situations", () => {
    const pubs: Array<MyPublisher | null> = [null, pub("pending"), pub("active"), pub("suspended")];
    const keyLists: Array<PublisherKey[] | null> = [null, [], [key()], [key({ lastUsedAt: iso(-1) })], [key({ status: "revoked", lastUsedAt: iso(-1) })], [key({ expiresAt: iso(-1) })]];
    for (const p of pubs) {
      for (const k of keyLists) {
        const s = byId(buildSetupSteps(p, k, NOW));
        if (s["first-use"].state === "done") assert.equal(s.key.state, "done");
        if (s.key.state === "done") assert.equal(s.approval.state, "done");
        if (s.approval.state === "done") assert.equal(s.platform.state, "done");
        if (p === null) assert.equal(Object.values(s).filter((x) => x.state === "done").length, 0);
      }
    }
  });

  it("only the public parts of a key can reach the guidance: output never holds a full key", () => {
    const hex = "ab".repeat(32);
    const fullKey = `blc_live_${hex}`;
    const parsed = toPublisherKey({ id: "00000000-0000-4000-8000-0000000000b1", label: "x", key_prefix: fullKey.slice(0, 13), key_hint: hex.slice(-4), status: "active", created_at: iso(-1), last_used_at: null, expires_at: null });
    assert.ok(parsed, "a normal list row parses");
    const text = JSON.stringify(buildSetupSteps(pub("active"), parsed ? [parsed] : [], NOW));
    assert.equal(/blc_live_[0-9a-f]{8,}/i.test(text), false);
    assert.equal(text.includes(hex), false);
    assert.deepEqual(Object.keys(key()).sort(), ["createdAt", "expiresAt", "hint", "id", "label", "lastUsedAt", "prefix", "status"]);
  });
});

describe("day 29 part 2: property status in plain language with a next action", () => {
  const STATUSES = ["Demo", "Pending Integration", "Not Connected"] as const;

  it("covers exactly the existing IntegrationStatus values (no new status was added)", () => {
    const m = /export type IntegrationStatus = ([^;]+);/.exec(read("lib/types.ts"));
    assert.ok(m);
    const declared = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual([...declared].sort(), [...STATUSES].sort());
    for (const s of STATUSES) assert.ok(propertyGuidance(s).meaning.length > 0, s);
  });

  it("Pending Integration and Not Connected are incomplete: they explain themselves and name the next action", () => {
    for (const s of ["Pending Integration", "Not Connected"] as const) {
      const g = propertyGuidance(s);
      assert.equal(propertyIsIncomplete(s), true, s);
      assert.ok(g.nextAction && g.nextAction.length > 0, s);
      assert.match(g.nextAction ?? "", /integration guide/, s);
    }
    assert.match(propertyGuidance("Pending Integration").meaning, /No ad requests yet/);
    assert.match(propertyGuidance("Pending Integration").nextAction ?? "", /request an ad/);
    assert.match(propertyGuidance("Not Connected").meaning, /No data to show/);
    assert.match(propertyGuidance("Not Connected").nextAction ?? "", /publisher key/);
  });

  it("Demo needs no action and is still described as sample data, not a live integration", () => {
    assert.equal(propertyIsIncomplete("Demo"), false);
    assert.equal(propertyGuidance("Demo").nextAction, null);
    assert.match(propertyGuidance("Demo").meaning, /Not a live integration/);
    assert.equal(propertyGuidance("Demo").short, "Sample data");
  });

  it("PropertyCard shows the meaning, the next step only when there is one, and keeps numbers for Demo only", () => {
    const card = read(CARD);
    assert.match(card, /propertyGuidance\(property\.status\)/);
    assert.match(card, /guidance\.meaning/);
    assert.match(card, /guidance\.nextAction && \(/);
    assert.match(card, /Next step:/);
    assert.match(card, /href=\{GUIDE_HREF\}/);
    assert.match(card, /const hasData = property\.status === "Demo";/);
    assert.match(card, /hasData \? formatNumber\(property\.adRequests\) : NONE/);
    assert.match(card, /hasData \? formatPercent\(fill, 1\) : NONE/);
  });

  it("PropertyStatusBadge still shows the status as text and adds the plain-language label for screen readers", () => {
    const badge = read(BADGE);
    assert.match(badge, /\{status\}/);
    assert.match(badge, /sr-only/);
    assert.match(badge, /propertyGuidance\(status\)/);
    for (const s of ["Demo", "Pending Integration", "Not Connected"]) assert.ok(badge.includes(`"${s}"`) || badge.includes(`${s}:`), s);
  });
});

describe("day 29 part 2: the publisher page presents the setup status without fake states", () => {
  const page = read(PAGE);

  it("builds the status from the loaded publisher and key list and renders a visible Setup status panel", () => {
    assert.match(page, /buildSetupSteps\(pub, keys, new Date\(\)\)/);
    assert.match(page, /title="Setup status"/);
    assert.match(page, /\{step\.label\}/);
    assert.match(page, /Next step:/);
    assert.match(page, /\{step\.detail\}/);
  });

  it("'Done' is printed only for a step whose state is done, and no state is hard-coded in the page", () => {
    assert.match(page, /step\.state === "done" \? "Done: " : ""/);
    assert.equal(/state: "(done|next|waiting|blocked|locked|unknown)"/.test(code(page)), false);
    assert.equal(/label: "/.test(code(page)), false, "labels come from the helper, not the page");
  });

  it("keeps the role check, the failed-load error, the suspended revoke-only panel and the existing notices", () => {
    assert.match(page, /requireRole\(\["publisher"\]\)/);
    assert.match(page, /loadMyPublisher\(\)/);
    assert.match(page, /throw new Error\("Publisher could not be loaded"\)/);
    assert.match(page, /canCreate=\{false\}/);
    assert.match(page, /Waiting for approval/);
    assert.match(page, /Your publisher account is suspended, so keys do not work/);
    assert.match(page, /href="\/dashboard\/publisher\/earnings"/);
    assert.match(page, /Open the integration guide/);
  });

  it("adds no new privilege, query or credential: no admin client, no table access, no key hash, no key material", () => {
    const c = code(page);
    assert.doesNotMatch(c, /supabase\/admin|createAdminClient|service_role|SERVICE_ROLE|\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
    assert.doesNotMatch(page, /key_hash|newKey|blc_live_[0-9a-f]{8,}/);
    assert.doesNotMatch(page, /\blocalStorage\b|sessionStorage|document\.cookie|console\./);
    const lib = code(read(LIB));
    assert.doesNotMatch(lib, /import .*(keys-db|supabase|actions|server-only)|process\.env|Date\.now\(|new Date\(\)|Math\.random|console\./);
  });
});

describe("day 29 part 2: key creation, storage and rotation guidance, and key secrecy", () => {
  const ui = read(KEYS_UI);

  it("explains creation, safe storage, the one-time display and rotation in plain words", () => {
    assert.match(ui, /How keys work/);
    assert.match(ui, /Creating a key shows the full key once/);
    assert.match(ui, /secret manager/);
    assert.match(ui, /BLISSCCO_PUBLISHER_API_KEY/);
    assert.match(ui, /This is the only time the full key is shown/);
    assert.match(ui, /cannot show the key again/);
    assert.match(ui, /create a new key and revoke the old one/);
    assert.match(ui, /To rotate a key, choose Rotate/);
    assert.match(ui, /The old key keeps working until you revoke it/);
    assert.match(ui, /Last used date/);
    assert.match(ui, /revoke it first and create a replacement afterwards/);
  });

  it("keeps the current behavior: one create/rotate action, hide button, revoke confirmation, 5-key wording unchanged", () => {
    assert.match(ui, /formData\.has\("rotateKeyId"\) \? rotateKey\(prev, formData\) : createKey\(prev, formData\)/);
    assert.match(ui, /I have saved it, hide/);
    assert.match(ui, /name="rotateKeyId"/);
    assert.match(ui, /Apps using this key will stop working\. Revoke it\?/);
    assert.match(ui, /Only the start and the last 4 characters of each key are shown/);
    assert.match(ui, /the full key can never be shown again/);
    assert.match(ui, /canCreate && keyIsUsable\(k, now\)/);
  });

  it("the full key is rendered in exactly one place: the block that only exists right after creation and until hidden", () => {
    const renders = ui.match(/\{state\.newKey\}/g) ?? [];
    assert.equal(renders.length, 1, "state.newKey is displayed once");
    const at = ui.indexOf("{state.newKey}");
    const open = ui.lastIndexOf('state.status === "success" && state.newKey && state.newKey !== hiddenKey', at);
    assert.ok(open > -1 && open < at, "the display sits inside the success-and-not-hidden block");
    // The list of existing keys shows only prefix and hint.
    const list = ui.slice(ui.indexOf("Your keys"));
    assert.match(list, /\{k\.prefix\}…\{k\.hint \?\? ""\}/);
    assert.doesNotMatch(list, /newKey|k\.key\b|k\.secret|k\.hash|keyHash|key_hash/);
  });

  it("the key never goes to storage, cookies, the URL, logs or the page props", () => {
    assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB|document\.cookie|window\.location|history\.(push|replace)State|router\.(push|replace)/);
    assert.doesNotMatch(ui, /console\./);
    assert.doesNotMatch(ui, /blc_live_[0-9a-f]{8,}/i);
    assert.doesNotMatch(ui, /dangerouslySetInnerHTML/);
    assert.match(ui, /^"use client";/);
    assert.doesNotMatch(read(PAGE), /PublisherKeyManager[^>]*newKey/);
  });

  it("the key list type has no field that could hold a full key or its hash", () => {
    const keysSrc = read("lib/publisher/keys.ts");
    const type = /export type PublisherKey = \{([\s\S]*?)\};/.exec(keysSrc);
    assert.ok(type);
    assert.doesNotMatch(type[1], /\bkey\b\s*:|hash|secret|token/i);
    assert.doesNotMatch(keysSrc, /key_hash/);
    assert.doesNotMatch(read("lib/publisher/queries.ts"), /key_hash/);
  });

  it("no new account privilege or authentication change: the actions still take the publisher from the login", () => {
    const actions = read("app/dashboard/publisher/actions.ts");
    assert.match(actions, /requireRole\(\["publisher"\]\)/);
    assert.equal(/formData\.get\("(publisherId|publisher_id|profileId|profile_id|status|role)"\)/.test(actions), false);
  });
});
