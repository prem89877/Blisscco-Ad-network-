import { fake, type FakePublisher } from "./publisher-stubs"; // sabse pehle: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapPublisherSetupError, parseAdvertiserSetup, parsePublisherSetup } from "@/lib/accounts/validation";
import { toPublisher } from "@/lib/publisher/publisher";
import { setupPublisher } from "@/app/dashboard/account/actions";
import { createKey, revokeKey } from "@/app/dashboard/publisher/actions";

const root = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

const UUID_KEY = "11111111-1111-4111-8111-111111111111";
const idle = { status: "idle" } as const;

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}
const pub = (over: Partial<FakePublisher> = {}): FakePublisher => ({
  id: "pub-A",
  status: "active",
  name: "Bot",
  websiteUrl: null,
  category: null,
  ...over,
});

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  return "";
}

describe("publisher: row shape (toPublisher)", () => {
  it("reads a good row, keeps website and category, empty becomes null", () => {
    assert.deepEqual(toPublisher({ id: "1", status: "pending", name: "Bot", website_url: "https://a.com", category: "gaming" }), {
      id: "1",
      status: "pending",
      name: "Bot",
      websiteUrl: "https://a.com",
      category: "gaming",
    });
    assert.deepEqual(toPublisher({ id: "1", status: "active", name: "Bot", website_url: "", category: null }), {
      id: "1",
      status: "active",
      name: "Bot",
      websiteUrl: null,
      category: null,
    });
  });
  it("rejects a wrong shape or unknown status", () => {
    assert.equal(toPublisher(null), null);
    assert.equal(toPublisher({ id: "1", status: "weird", name: "Bot" }), null);
    assert.equal(toPublisher({ id: 1, status: "active", name: "Bot" }), null);
    assert.equal(toPublisher({ id: "1", status: "active" }), null);
  });
});

describe("publisher setup: name validation (hidden characters)", () => {
  it("rejects names made of invisible characters or with text-direction tricks", () => {
    for (const bad of ["\u200b", "Bot\u200b", "\u2060\u2060", "Bo\u202ect", "Bo\u00adt"]) {
      assert.ok(!parsePublisherSetup({ name: bad, websiteUrl: "", category: "" }).ok, JSON.stringify(bad));
      assert.ok(!parseAdvertiserSetup({ companyName: bad, websiteUrl: "" }).ok, JSON.stringify(bad));
    }
  });
  it("still accepts normal names, accents, Devanagari and ZWNJ/ZWJ used in real scripts", () => {
    for (const good of ["Café Bot", "ब्लिस बॉट", "می\u200cخواهم", "क्‍ष Bot", "Bot 2.0 (beta)"]) {
      assert.ok(parsePublisherSetup({ name: good, websiteUrl: "", category: "" }).ok, good);
    }
  });
  it("trims and collapses spaces, and the 150 character limit still holds", () => {
    const r = parsePublisherSetup({ name: "  My   Bot ", websiteUrl: "", category: "" });
    assert.ok(r.ok && r.value.name === "My Bot");
    assert.ok(parsePublisherSetup({ name: "x".repeat(150), websiteUrl: "", category: "" }).ok);
    assert.ok(!parsePublisherSetup({ name: "x".repeat(151), websiteUrl: "", category: "" }).ok);
  });
});

describe("publisher setup: database error messages", () => {
  it("category foreign key problem points at the category field", () => {
    const r = mapPublisherSetupError({ code: "23503", message: 'violates foreign key constraint "publishers_category_fkey"' });
    assert.ok(r.fieldErrors?.category);
  });
  it("other foreign key problem is generic", () => {
    const r = mapPublisherSetupError({ code: "23503", message: "something else" });
    assert.equal(r.fieldErrors, undefined);
    assert.match(r.message, /could not save/i);
  });
  it("check, permission and unknown errors give safe messages with no raw database text", () => {
    assert.match(mapPublisherSetupError({ code: "23514" }).message, /not accepted/i);
    assert.match(mapPublisherSetupError({ code: "42501" }).message, /contact support/i);
    const unknown = mapPublisherSetupError({ code: "XX000", message: 'secret table "publishers" detail' });
    assert.match(unknown.message, /could not save/i);
    assert.equal(/secret|publishers/.test(unknown.message), false);
    assert.match(mapPublisherSetupError(null).message, /could not save/i);
  });
});

describe("setupPublisher action", () => {
  beforeEach(() => fake.reset());

  it("saves with profile_id from the login only and never sends a status", async () => {
    const to = await redirectOf(
      setupPublisher(
        idle,
        form({ name: " My Bot ", websiteUrl: "https://bot.example.com", category: "gaming", profile_id: "someone-else", status: "active", role: "admin" }),
      ),
    );
    assert.equal(to, "/dashboard/publisher?setup=1");
    assert.equal(fake.inserts.length, 1);
    assert.equal(fake.inserts[0].table, "publishers");
    assert.deepEqual(fake.inserts[0].payload, {
      profile_id: "user-A",
      name: "My Bot",
      website_url: "https://bot.example.com",
      category: "gaming",
    });
  });

  it("empty optional fields are saved as null", async () => {
    await redirectOf(setupPublisher(idle, form({ name: "Bot", websiteUrl: "", category: "" })));
    assert.deepEqual(fake.inserts[0].payload, { profile_id: "user-A", name: "Bot", website_url: null, category: null });
  });

  it("bad input returns field errors, keeps what was typed and does not touch the database", async () => {
    const r = await setupPublisher(idle, form({ name: "", websiteUrl: "http://bot.example.com", category: "weapons" }));
    assert.equal(r.status, "error");
    assert.ok(r.fieldErrors?.name && r.fieldErrors.websiteUrl && r.fieldErrors.category);
    assert.equal(r.values?.websiteUrl, "http://bot.example.com");
    assert.equal(fake.inserts.length, 0);
  });

  it("wrong role or not logged in: stops before any database call", async () => {
    fake.roleFails = true;
    await assert.rejects(setupPublisher(idle, form({ name: "Bot" })), /REDIRECT:\/login/);
    assert.equal(fake.inserts.length, 0);
  });

  it("already registered (23505): goes to the publisher page without a 'saved' banner", async () => {
    fake.dbError = { code: "23505" };
    assert.equal(await redirectOf(setupPublisher(idle, form({ name: "Bot" }))), "/dashboard/publisher");
  });

  it("category rejected by the database shows a field error and keeps the typed values", async () => {
    fake.dbError = { code: "23503", message: 'violates foreign key constraint "publishers_category_fkey"' };
    const r = await setupPublisher(idle, form({ name: "Bot", category: "gaming" }));
    assert.equal(r.status, "error");
    assert.ok(r.fieldErrors?.category);
    assert.equal(r.values?.name, "Bot");
  });

  it("permission error and unknown error give a safe message", async () => {
    fake.dbError = { code: "42501", message: "new row violates row-level security policy" };
    const a = await setupPublisher(idle, form({ name: "Bot" }));
    assert.equal(a.status, "error");
    assert.equal(/row-level|policy/i.test(a.message ?? ""), false);
    fake.dbError = { code: "XX000" };
    const b = await setupPublisher(idle, form({ name: "Bot" }));
    assert.match(b.message ?? "", /could not save/i);
  });
});

describe("publisher key actions: ownership and account state", () => {
  beforeEach(() => fake.reset());
  const keyIdle = { status: "idle" } as const;

  it("a database failure is not reported as 'set up your platform'", async () => {
    fake.load = { publisher: null, failed: true };
    const r = await createKey(keyIdle, form({ label: "srv", expiry: "30" }));
    assert.equal(r.status, "error");
    assert.match(r.message ?? "", /could not check/i);
    assert.equal(fake.issued.length, 0);
  });

  it("no publisher yet: asked to set up first", async () => {
    const r = await createKey(keyIdle, form({ label: "srv", expiry: "30" }));
    assert.match(r.message ?? "", /set up/i);
    assert.equal(fake.issued.length, 0);
  });

  it("pending and suspended publishers cannot create or revoke keys", async () => {
    for (const status of ["pending", "suspended"] as const) {
      fake.load = { publisher: pub({ status }), failed: false };
      const a = await createKey(keyIdle, form({ label: "srv", expiry: "30" }));
      assert.equal(a.status, "error", status);
      const b = await revokeKey(keyIdle, form({ keyId: UUID_KEY }));
      assert.equal(b.status, "error", status);
    }
    assert.equal(fake.issued.length, 0);
    assert.equal(fake.revoked.length, 0);
  });

  it("active publisher: the publisher id comes from the login, never from the form", async () => {
    fake.load = { publisher: pub({ id: "pub-A" }), failed: false };
    const r = await createKey(keyIdle, form({ label: "srv", expiry: "30", publisherId: "pub-B", publisher_id: "pub-B" }));
    assert.equal(r.status, "success");
    assert.deepEqual(fake.issued, [{ publisherId: "pub-A", label: "srv", expiry: "30" }]);

    const v = await revokeKey(keyIdle, form({ keyId: UUID_KEY, publisherId: "pub-B", publisher_id: "pub-B" }));
    assert.equal(v.status, "success");
    assert.deepEqual(fake.revoked, [{ publisherId: "pub-A", keyId: UUID_KEY }]);
  });

  it("bad expiry, bad label and bad key id are rejected before the database", async () => {
    fake.load = { publisher: pub(), failed: false };
    assert.equal((await createKey(keyIdle, form({ label: "srv", expiry: "7" }))).status, "error");
    assert.equal((await createKey(keyIdle, form({ label: "x".repeat(61), expiry: "30" }))).status, "error");
    assert.equal((await revokeKey(keyIdle, form({ keyId: "not-a-uuid" }))).status, "error");
    assert.equal(fake.issued.length, 0);
    assert.equal(fake.revoked.length, 0);
  });

  it("wrong role or not logged in: stops before any key call", async () => {
    fake.roleFails = true;
    fake.load = { publisher: pub(), failed: false };
    await assert.rejects(createKey(keyIdle, form({ label: "srv", expiry: "30" })), /REDIRECT:\/login/);
    await assert.rejects(revokeKey(keyIdle, form({ keyId: UUID_KEY })), /REDIRECT:\/login/);
    assert.equal(fake.issued.length + fake.revoked.length, 0);
  });

  it("limit reached and database error give different, safe messages", async () => {
    fake.load = { publisher: pub(), failed: false };
    fake.issueResult = { ok: false, reason: "limit" };
    assert.match((await createKey(keyIdle, form({ label: "", expiry: "never" }))).message ?? "", /5 active keys/);
    fake.issueResult = { ok: false, reason: "error" };
    assert.match((await createKey(keyIdle, form({ label: "", expiry: "never" }))).message ?? "", /could not create/i);
  });
});

describe("publisher pages and actions: source checks", () => {
  const setupActions = read("app/dashboard/account/actions.ts");
  const keyActions = read("app/dashboard/publisher/actions.ts");

  it("the publisher id / profile id never come from form data", () => {
    assert.equal(/formData\.get\("(publisherId|publisher_id|profileId|profile_id|status|role)"\)/.test(setupActions + keyActions), false);
    assert.match(setupActions, /profile_id: account\.user\.id/);
    assert.match(keyActions, /requireRole\(\["publisher"\]\)/);
  });

  it("pages and actions treat a load failure separately from 'no publisher'", () => {
    for (const f of ["app/dashboard/publisher/page.tsx", "app/dashboard/page.tsx", "app/dashboard/publisher/actions.ts"]) {
      const src = read(f);
      assert.match(src, /loadMyPublisher\(\)/, f);
      assert.equal(/getMyPublisher/.test(src), false, f);
    }
    assert.match(read("app/dashboard/publisher/page.tsx"), /throw new Error\("Publisher could not be loaded"\)/);
    assert.match(read("lib/publisher/queries.ts"), /\.eq\("profile_id", user\.id\)/);
  });

  it("the setup action never writes a status, so new publishers start as pending", () => {
    const insert = /from\("publishers"\)\.insert\(\{([^}]*)\}\)/.exec(setupActions);
    assert.ok(insert, "publisher insert not found");
    assert.equal(/status/.test(insert ? insert[1] : "status"), false);
  });
});
