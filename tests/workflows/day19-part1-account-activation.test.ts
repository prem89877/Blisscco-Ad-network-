// Day 19 Part 1: advertiser / publisher account lifecycle (setup -> pending -> active | suspended).
// SIRF nakli (mocked) database: koi SQL nahi chalti, koi migration nahi, asli database/paise ko koi chhoo nahi.
// Maujooda stubs hi use hue hain (publisher-stubs, admin-stubs, action-stubs). Teeno ek hi process me alag-alag actions ko
// apne stub dete hain: har stub file apne action se PEHLE import hoti hai (import ka order jaanboojh kar yahi hai).
import { fake as pubFake } from "../accounts/publisher-stubs";
import { setupAdvertiser, setupPublisher } from "@/app/dashboard/account/actions";
import { createKey, revokeKey } from "@/app/dashboard/publisher/actions";
import { adminFake } from "../campaigns/admin-stubs";
import { adminDecision } from "@/app/dashboard/admin/actions";
import { fake as campFake } from "../campaigns/action-stubs";
import { createCampaign } from "@/app/dashboard/advertiser/campaigns/actions";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashApiKey } from "@/lib/ads/api-key";
import * as v1Route from "@/app/api/v1/ads/match/route";

const ROOT = join(__dirname, "..", "..", "..");
const source = (f: string) => readFileSync(join(ROOT, f), "utf8");

const ADV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = `blc_live_${"d".repeat(64)}`;
const KEY_HASH = hashApiKey(KEY);
const idleState = { status: "idle" } as const;
const TODAY = new Date().toISOString().slice(0, 10);

type AccountStatus = "pending" | "active" | "suspended";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

/** Action ko chalao. Redirect ho toh uska path, warna state. Koi aur error ho toh test fail. */
async function run<T>(p: Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try {
    return { state: await p };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return { redirect: m[1] };
    throw e;
  }
}

// console.error ke andar raw database message / code ke alawa kuch nahi jaana chahiye. Output saaf rakhne ke liye pakad lete hain.
const realError = console.error;
let logged: unknown[][] = [];
beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  pubFake.reset();
  adminFake.reset();
  campFake.reset();
});
afterEach(() => {
  console.error = realError;
});

const inserts = (table: string) => pubFake.inserts.filter((i) => i.table === table);

/* ===========================================================================================
 * 1. Setup: advertiser
 * ========================================================================================= */
describe("day 19 part 1: advertiser setup", () => {
  it("valid submission: row is made for the LOGGED-IN user, status is never sent, user goes to campaigns", async () => {
    pubFake.userId = "user-adv-1";
    const r = await run(setupAdvertiser(idleState, form({ companyName: "  Glow   Parlour ", websiteUrl: "https://glow.example.com" })));
    assert.equal(r.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.equal(inserts("advertisers").length, 1);
    assert.deepEqual(inserts("advertisers")[0].payload, {
      profile_id: "user-adv-1",
      company_name: "Glow Parlour",
      website_url: "https://glow.example.com",
    });
    assert.deepEqual(pubFake.revalidated, ["/dashboard"]);
  });

  it("forged profile_id / status / id in the form are ignored (identity comes from login only)", async () => {
    pubFake.userId = "user-adv-1";
    await run(
      setupAdvertiser(
        idleState,
        form({ companyName: "Glow", websiteUrl: "", profile_id: "someone-else", profileId: "someone-else", status: "active", id: ADV_ID }),
      ),
    );
    const payload = inserts("advertisers")[0].payload;
    assert.equal(payload.profile_id, "user-adv-1");
    assert.ok(!("status" in payload), "a new account must never choose its own status (database default is pending)");
    assert.ok(!("id" in payload));
    assert.equal(payload.website_url, null);
  });

  it("invalid data is stopped before the database and values are given back to the form", async () => {
    const bad: Array<[string, Record<string, string>, string]> = [
      ["empty name", { companyName: "   ", websiteUrl: "" }, "companyName"],
      ["name with hidden characters", { companyName: "Glow\u200b", websiteUrl: "" }, "companyName"],
      ["http website", { companyName: "Glow", websiteUrl: "http://glow.example.com" }, "websiteUrl"],
      ["username in website", { companyName: "Glow", websiteUrl: "https://trusted.com@evil.example" }, "websiteUrl"],
      ["IP address website", { companyName: "Glow", websiteUrl: "https://10.0.0.1" }, "websiteUrl"],
    ];
    for (const [name, fields, errorField] of bad) {
      const r = await run(setupAdvertiser(idleState, form(fields)));
      assert.equal(r.redirect, undefined, name);
      assert.equal(r.state?.status, "error", name);
      assert.ok(r.state?.fieldErrors?.[errorField as "companyName" | "websiteUrl"], name);
      assert.equal(r.state?.values?.companyName, fields.companyName.slice(0, 400), name);
    }
    assert.equal(pubFake.inserts.length, 0);
    assert.deepEqual(pubFake.revalidated, []);
  });

  it("missing form fields (no FormData keys at all) are handled like empty", async () => {
    const r = await run(setupAdvertiser(idleState, new FormData()));
    assert.equal(r.state?.status, "error");
    assert.ok(r.state?.fieldErrors?.companyName);
    assert.equal(pubFake.inserts.length, 0);
  });

  it("duplicate setup (double click / second tab): treated as already done, no error, no second row, still goes to campaigns", async () => {
    const first = await run(setupAdvertiser(idleState, form({ companyName: "Glow", websiteUrl: "" })));
    assert.equal(first.redirect, "/dashboard/advertiser/campaigns?setup=1");

    pubFake.dbError = { code: "23505", message: 'duplicate key value violates unique constraint "advertisers_profile_id_key"' };
    const second = await run(setupAdvertiser(idleState, form({ companyName: "Different Name", websiteUrl: "" })));
    assert.equal(second.state, undefined, "no error shown for a duplicate");
    assert.equal(second.redirect, "/dashboard/advertiser/campaigns?setup=1");
    assert.equal(logged.length, 0, "a duplicate is not an error worth logging");
  });

  it("database failures: friendly generic message, no redirect, nothing raw reaches the user or the log", async () => {
    for (const code of ["42501", "23514", "XX000", "57014", "08006"]) {
      logged = [];
      pubFake.dbError = { code, message: `SECRET internal detail ${code} table advertisers` };
      const r = await run(setupAdvertiser(idleState, form({ companyName: "Glow", websiteUrl: "https://glow.example.com" })));
      assert.equal(r.redirect, undefined, code);
      assert.equal(r.state?.status, "error", code);
      assert.equal(r.state?.message, "We could not save your details. Please try again.", code);
      assert.deepEqual(r.state?.values, { companyName: "Glow", websiteUrl: "https://glow.example.com" }, `${code}: typed values are kept`);
      assert.ok(!JSON.stringify(r.state).includes("SECRET"), code);
      assert.ok(!JSON.stringify(logged).includes("SECRET"), `${code}: raw message is not logged`);
      assert.equal(logged.length, 1, code);
    }
    assert.deepEqual(pubFake.revalidated, [], "nothing is revalidated when the save failed");
  });

  it("role check is kept: login/role failure stops before validation and database", async () => {
    pubFake.roleFails = true;
    const r = await run(setupAdvertiser(idleState, form({ companyName: "Glow", websiteUrl: "" })));
    assert.equal(r.redirect, "/login");
    assert.equal(pubFake.inserts.length, 0);
    assert.match(source("app/dashboard/account/actions.ts"), /setupAdvertiser[\s\S]*?requireRole\(\["advertiser"\]\)/);
  });
});

/* ===========================================================================================
 * 2. Setup: publisher
 * ========================================================================================= */
describe("day 19 part 1: publisher setup", () => {
  it("valid submission: row for the LOGGED-IN user, no status in the payload, user goes to publisher page", async () => {
    pubFake.userId = "user-pub-1";
    const r = await run(
      setupPublisher(idleState, form({ name: " My  Bot ", websiteUrl: "https://bot.example.com", category: "gaming", profile_id: "x", status: "active" })),
    );
    assert.equal(r.redirect, "/dashboard/publisher?setup=1");
    assert.deepEqual(inserts("publishers")[0].payload, {
      profile_id: "user-pub-1",
      name: "My Bot",
      website_url: "https://bot.example.com",
      category: "gaming",
    });
    assert.deepEqual(pubFake.revalidated, ["/dashboard"]);
  });

  it("invalid data is stopped before the database (name, https website, category list)", async () => {
    const bad: Array<[string, Record<string, string>, string]> = [
      ["empty name", { name: "", websiteUrl: "", category: "" }, "name"],
      ["hidden-character name", { name: "Bo\u202et", websiteUrl: "", category: "" }, "name"],
      ["too long name", { name: "x".repeat(151), websiteUrl: "", category: "" }, "name"],
      ["http website", { name: "Bot", websiteUrl: "http://bot.example.com", category: "" }, "websiteUrl"],
      ["localhost website", { name: "Bot", websiteUrl: "https://localhost", category: "" }, "websiteUrl"],
      ["unknown category", { name: "Bot", websiteUrl: "", category: "weapons" }, "category"],
    ];
    for (const [name, fields, errorField] of bad) {
      const r = await run(setupPublisher(idleState, form(fields)));
      assert.equal(r.redirect, undefined, name);
      assert.equal(r.state?.status, "error", name);
      assert.ok(r.state?.fieldErrors?.[errorField as "name" | "websiteUrl" | "category"], name);
    }
    assert.equal(pubFake.inserts.length, 0);
  });

  it("duplicate setup: no error and NO 'details saved' banner (old row is not changed), goes to the publisher page", async () => {
    pubFake.dbError = { code: "23505", message: "duplicate key publishers_profile_id_key" };
    const r = await run(setupPublisher(idleState, form({ name: "Other Name", websiteUrl: "", category: "" })));
    assert.equal(r.state, undefined);
    assert.equal(r.redirect, "/dashboard/publisher");
    assert.deepEqual(pubFake.revalidated, ["/dashboard"]);
  });

  it("database failures map to safe messages; category FK error becomes a category field error", async () => {
    const cases: Array<[{ code: string; message?: string }, RegExp, string | undefined]> = [
      [{ code: "23503", message: 'violates foreign key constraint "publishers_category_fkey" SECRET' }, /highlighted/, "category"],
      [{ code: "23503", message: "violates foreign key constraint profile SECRET" }, /could not save/, undefined],
      [{ code: "23514", message: "check constraint SECRET" }, /not accepted/, undefined],
      [{ code: "42501", message: "row-level security SECRET" }, /contact support/, undefined],
      [{ code: "XX000", message: "SECRET" }, /could not save/, undefined],
    ];
    for (const [dbError, messageRe, fieldError] of cases) {
      logged = [];
      pubFake.dbError = dbError;
      const r = await run(setupPublisher(idleState, form({ name: "Bot", websiteUrl: "", category: "gaming" })));
      assert.equal(r.redirect, undefined, dbError.code);
      assert.equal(r.state?.status, "error", dbError.code);
      assert.match(r.state?.message ?? "", messageRe, dbError.code);
      assert.equal(Boolean(r.state?.fieldErrors?.category), fieldError === "category", dbError.code);
      assert.ok(!JSON.stringify(r.state).includes("SECRET"), dbError.code);
      assert.ok(!JSON.stringify(logged).includes("SECRET"), dbError.code);
    }
  });

  it("role check is kept: login/role failure stops everything", async () => {
    pubFake.roleFails = true;
    const r = await run(setupPublisher(idleState, form({ name: "Bot", websiteUrl: "", category: "" })));
    assert.equal(r.redirect, "/login");
    assert.equal(pubFake.inserts.length, 0);
    assert.match(source("app/dashboard/account/actions.ts"), /setupPublisher[\s\S]*?requireRole\(\["publisher"\]\)/);
  });
});

/* ===========================================================================================
 * 3. Status transitions through the admin action
 * ========================================================================================= */
describe("day 19 part 1: admin account decisions (pending -> active | suspended)", () => {
  const decide = (kind: string, id: string, decision: string) => run(adminDecision({ status: "idle" } as never, form({ kind, id, decision })));

  it("approve and suspend call exactly the right database function with the right arguments", async () => {
    const cases: Array<[string, string, string, string]> = [
      ["advertiser", ADV_ID, "active", "admin_set_advertiser_status"],
      ["advertiser", ADV_ID, "suspended", "admin_set_advertiser_status"],
      ["publisher", PUB_ID, "active", "admin_set_publisher_status"],
      ["publisher", PUB_ID, "suspended", "admin_set_publisher_status"],
    ];
    for (const [kind, id, decision, fn] of cases) {
      adminFake.reset();
      const r = await decide(kind, id, decision);
      assert.deepEqual(r.state, { status: "success", message: "Done." }, `${kind} ${decision}`);
      assert.equal(adminFake.rpcCalls.length, 1, `${kind} ${decision}`);
      assert.equal(adminFake.rpcCalls[0].name, fn);
      assert.deepEqual(adminFake.rpcCalls[0].args, { [kind === "advertiser" ? "p_advertiser_id" : "p_publisher_id"]: id, p_status: decision });
      assert.deepEqual(adminFake.revalidated, ["/dashboard/admin"]);
    }
  });

  it("'rejected' is NOT a database status: the existing 'suspended' decision is how a pending account is turned down", async () => {
    // Database check: status in ('pending','active','suspended') (day-3-2). Isliye naya 'rejected' status nahi banaya gaya.
    for (const kind of ["advertiser", "publisher"]) {
      for (const bad of ["rejected", "reject", "approve", "pending", "ACTIVE", " active", "", "deleted"]) {
        adminFake.reset();
        const r = await decide(kind, kind === "advertiser" ? ADV_ID : PUB_ID, bad);
        assert.deepEqual(r.state, { status: "error", message: "That request was not understood." }, `${kind} "${bad}"`);
        assert.equal(adminFake.rpcCalls.length, 0, `${kind} "${bad}"`);
      }
    }
    assert.match(source("supabase/sql/day-3-2-advertiser-publisher.sql"), /status in \('pending', 'active', 'suspended'\)/);
  });

  it("bad id / unknown kind / missing fields never reach the database", async () => {
    const bad: Array<Record<string, string>> = [
      { kind: "advertiser", id: "not-a-uuid", decision: "active" },
      { kind: "advertiser", id: "1; drop table advertisers", decision: "active" },
      { kind: "profile", id: ADV_ID, decision: "active" },
      { kind: "advertiser", decision: "active" },
      { kind: "advertiser", id: ADV_ID },
      { id: ADV_ID, decision: "active" },
    ];
    for (const fields of bad) {
      adminFake.reset();
      const r = await run(adminDecision({ status: "idle" } as never, form(fields)));
      assert.equal(r.state?.status, "error", JSON.stringify(fields));
      assert.equal(adminFake.rpcCalls.length, 0, JSON.stringify(fields));
    }
  });

  it("only the admin role is allowed; a non-admin or logged-out caller never reaches the database", async () => {
    adminFake.roleFails = true;
    const r = await decide("advertiser", ADV_ID, "active");
    assert.equal(r.redirect, "/dashboard");
    assert.equal(adminFake.rpcCalls.length, 0);
    assert.deepEqual(adminFake.roleCalls, [["admin"]], "requireRole is called with exactly ['admin']");
  });

  it("database errors become safe messages; nothing is revalidated; raw details are not shown or logged", async () => {
    const cases: Array<[{ code?: string; hint?: string }, string]> = [
      [{ code: "42501", hint: "SECRET" }, "Only an admin can do this."],
      [{ code: "P0002" }, "That item no longer exists. Refresh the page."],
      [{ code: "22023" }, "The database did not allow this change (for example, a campaign needs an approved ad first)."],
      [{ code: "XX000" }, "Something went wrong. Please try again."],
      [{}, "Something went wrong. Please try again."],
    ];
    for (const [rpcError, message] of cases) {
      adminFake.reset();
      logged = [];
      adminFake.rpcError = rpcError;
      const r = await decide("publisher", PUB_ID, "active");
      assert.deepEqual(r.state, { status: "error", message }, JSON.stringify(rpcError));
      assert.deepEqual(adminFake.revalidated, [], JSON.stringify(rpcError));
      assert.ok(!JSON.stringify(r.state).includes("SECRET"));
    }
  });

  it("the account action uses the admin's own session (RLS), never the service-role client", () => {
    const src = source("app/dashboard/admin/actions.ts");
    assert.ok(!/supabase\/admin|createAdminClient|service_role/i.test(src.replace(/\/\/.*$/gm, "")));
  });
});

/* ===========================================================================================
 * 4. Full lifecycle: what each status allows (advertiser campaign creation, publisher key + ad serving)
 *    Admin ka rpc ek chhote in-test model par lagta hai jo day-3-5 SQL ka niyam dohrata hai (status in pending|active|suspended).
 *    SQL yahan chalti nahi.
 * ========================================================================================= */
const model = { advertiser: "pending" as AccountStatus, publisher: "pending" as AccountStatus };
const SQL_ALLOWED: readonly string[] = ["pending", "active", "suspended"];

function mirrorAdminRpcs() {
  for (const call of adminFake.rpcCalls) {
    // Database error aaya toh SQL ne kuch nahi badla: model bhi nahi badlega.
    if (adminFake.rpcError) continue;
    const status = String(call.args.p_status);
    if (!SQL_ALLOWED.includes(status)) continue;
    if (call.name === "admin_set_advertiser_status") model.advertiser = status as AccountStatus;
    if (call.name === "admin_set_publisher_status") model.publisher = status as AccountStatus;
  }
  adminFake.rpcCalls = [];
  campFake.me = { id: ADV_ID, status: model.advertiser };
  pubFake.load = {
    publisher: { id: PUB_ID, status: model.publisher, name: "Bot", websiteUrl: null, category: null },
    failed: false,
  };
}

async function admin(kind: "advertiser" | "publisher", decision: string) {
  const r = await run(adminDecision({ status: "idle" } as never, form({ kind, id: kind === "advertiser" ? ADV_ID : PUB_ID, decision })));
  mirrorAdminRpcs();
  return r;
}

async function tryCreateCampaign() {
  const fd = form({
    name: "Spring Sale 2026",
    category: "gaming",
    totalBudget: "250",
    dailyBudget: "25",
    startDate: TODAY,
    endDate: "",
    advertiser_id: "adv-forged",
  });
  return run(createCampaign({ status: "idle" } as never, fd));
}

const campaignInserts = () => campFake.calls.filter((c) => c.op === "insert" && c.table === "campaigns");

describe("day 19 part 1: advertiser lifecycle gates campaign creation", () => {
  beforeEach(() => {
    model.advertiser = "pending";
    model.publisher = "pending";
    mirrorAdminRpcs();
  });

  it("pending advertiser cannot create a campaign (no database write)", async () => {
    const r = await tryCreateCampaign();
    assert.equal(r.redirect, undefined);
    assert.equal((r.state as { status?: string }).status, "error");
    assert.match((r.state as { message?: string }).message ?? "", /not active/);
    assert.equal(campFake.calls.length, 0);
  });

  it("pending -> active: campaign creation works, for the advertiser found from login (forged id ignored)", async () => {
    assert.equal((await admin("advertiser", "active")).state?.status, "success");
    const r = await tryCreateCampaign();
    assert.match(r.redirect ?? "", /\/dashboard\/advertiser\/campaigns\/00000000-0000-4000-8000-000000000001\?created=1/);
    assert.equal(campaignInserts().length, 1);
    assert.equal(campaignInserts()[0].payload.advertiser_id, ADV_ID);
  });

  it("active -> suspended: creation is blocked again", async () => {
    await admin("advertiser", "active");
    await admin("advertiser", "suspended");
    const r = await tryCreateCampaign();
    assert.match((r.state as { message?: string }).message ?? "", /not active/);
    assert.equal(campFake.calls.length, 0);
  });

  it("pending -> suspended (the way a pending account is rejected): creation stays blocked", async () => {
    await admin("advertiser", "suspended");
    assert.equal(model.advertiser, "suspended");
    const r = await tryCreateCampaign();
    assert.match((r.state as { message?: string }).message ?? "", /not active/);
    assert.equal(campFake.calls.length, 0);
  });

  it("suspended -> active (reactivation) works again", async () => {
    await admin("advertiser", "suspended");
    await admin("advertiser", "active");
    const r = await tryCreateCampaign();
    assert.match(r.redirect ?? "", /created=1/);
  });

  it("a failed admin decision leaves the account (and the gate) unchanged", async () => {
    adminFake.rpcError = { code: "XX000" };
    const r = await admin("advertiser", "active");
    assert.equal(r.state?.status, "error");
    assert.equal(model.advertiser, "pending");
    const created = await tryCreateCampaign();
    assert.match((created.state as { message?: string }).message ?? "", /not active/);
  });

  it("missing advertiser row / database failure while loading it: no write, clear different messages", async () => {
    campFake.me = null;
    const missing = await tryCreateCampaign();
    assert.match((missing.state as { message?: string }).message ?? "", /not found/);
    assert.equal(campFake.calls.length, 0);
  });

  it("role check is kept: a logged-out / wrong-role caller is redirected before anything else", async () => {
    await admin("advertiser", "active");
    campFake.roleFails = true;
    const r = await tryCreateCampaign();
    assert.equal(r.redirect, "/login");
    assert.equal(campFake.calls.length, 0);
    const src = source("app/dashboard/advertiser/campaigns/actions.ts");
    assert.match(src, /async function requireActiveAdvertiser[\s\S]*?requireRole\(\["advertiser"\]\)[\s\S]*?adv\.status !== "active"/);
  });

  it("every advertiser write path (campaigns and creatives) is behind the same active-account check", () => {
    const campaigns = source("app/dashboard/advertiser/campaigns/actions.ts");
    assert.equal((campaigns.match(/await requireActiveAdvertiser\(\)/g) ?? []).length >= 3, true);
    const creatives = source("app/dashboard/advertiser/campaigns/creative-actions.ts");
    assert.match(creatives, /requireRole\(\["advertiser"\]\)/);
    assert.match(creatives, /adv\.status !== "active"/);
  });

  it("profile suspended (account-level): requireAccount sends the user to the status page, which requireRole uses first", () => {
    const session = source("lib/auth/session.ts");
    assert.match(session, /account\.status !== "active"\) redirect\("\/dashboard\/account-status"\)/);
    assert.match(session, /requireRole[\s\S]*?await requireAccount\(\)[\s\S]*?allowed\.includes\(account\.role\)/);
  });
});

describe("day 19 part 1: publisher lifecycle gates keys", () => {
  beforeEach(() => {
    model.advertiser = "pending";
    model.publisher = "pending";
    mirrorAdminRpcs();
  });
  const keyForm = () => form({ label: "Prod server", expiry: "90" });
  const create = () => run(createKey({ status: "idle" } as never, keyForm()));

  it("pending publisher cannot create a key (nothing issued)", async () => {
    const r = await create();
    assert.equal(r.state?.status, "error");
    assert.match((r.state as { message?: string }).message ?? "", /not approved yet/);
    assert.equal(pubFake.issued.length, 0);
  });

  it("pending -> active: key creation is allowed; the publisher id comes from login, not the form", async () => {
    await admin("publisher", "active");
    const fd = keyForm();
    fd.set("publisherId", "pub-forged");
    const r = await run(createKey({ status: "idle" } as never, fd));
    assert.equal(r.state?.status, "success");
    assert.equal(pubFake.issued.length, 1);
    assert.equal(pubFake.issued[0].publisherId, PUB_ID);
  });

  it("active -> suspended and pending -> suspended: key creation is blocked", async () => {
    await admin("publisher", "suspended");
    assert.equal((await create()).state?.status, "error");
    await admin("publisher", "active");
    assert.equal((await create()).state?.status, "success");
    await admin("publisher", "suspended");
    assert.equal((await create()).state?.status, "error");
    assert.equal(pubFake.issued.length, 1, "only the one made while active");
  });

  it("suspended publisher can still revoke a key (existing safety rule), but cannot create one", async () => {
    await admin("publisher", "suspended");
    const keyId = "11111111-1111-4111-8111-111111111111";
    const r = await run(revokeKey({ status: "idle" } as never, form({ keyId })));
    assert.equal(r.state?.status, "success");
    assert.deepEqual(pubFake.revoked, [{ publisherId: PUB_ID, keyId }]);
    assert.equal((await create()).state?.status, "error");
  });

  it("publisher row missing or failed to load: clear message, nothing issued", async () => {
    pubFake.load = { publisher: null, failed: false };
    assert.match(((await create()).state as { message?: string }).message ?? "", /set up your platform/i);
    pubFake.load = { publisher: null, failed: true };
    assert.match(((await create()).state as { message?: string }).message ?? "", /could not check/);
    assert.equal(pubFake.issued.length, 0);
  });

  it("role check is kept: wrong role / logged out never reaches the key service", async () => {
    await admin("publisher", "active");
    pubFake.roleFails = true;
    const r = await create();
    assert.equal(r.redirect, "/login");
    assert.equal(pubFake.issued.length, 0);
    assert.match(source("app/dashboard/publisher/actions.ts"), /async function requireOwnPublisher[\s\S]*?requireRole\(\["publisher"\]\)/);
  });
});

/* ===========================================================================================
 * 5. Ad serving: pending / suspended publisher never gets an ad
 * ========================================================================================= */
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const globals = globalThis as unknown as { __TEST_SUPABASE__?: unknown };
let rpcNames: string[] = [];

const AUTH_OK = { outcome: "ok", publisher_id: PUB_ID, publisher_status: "active", unit_cost_usd: 0.002 };
function candidateRow(): Record<string, unknown> {
  return {
    creative_id: "11111111-1111-4111-8111-111111111111", headline: "Visible headline", body: "B", cta_text: null,
    destination_url: "https://example.com/x", creative_status: "approved", campaign_id: "33333333-3333-4333-8333-333333333333",
    campaign_status: "active", category: "gaming", start_date: "2020-01-01", end_date: null, total_budget: 100, daily_budget: null,
    spent_total: 0, spent_today: 0, advertiser_status: "active", advertiser_profile_status: "active",
    campaign_serves_today: 0, creative_serves_today: 0,
  };
}
function setServeDb(over: Record<string, Reply> = {}) {
  rpcNames = [];
  const replies: Record<string, Reply> = {
    authorize_publisher_key: { data: AUTH_OK, error: null },
    load_ad_candidates: { data: [candidateRow()], error: null },
    record_ad_serve: { data: { outcome: "ok" }, error: null },
    ...over,
  };
  globals.__TEST_SUPABASE__ = {
    rpc: async (name: string) => {
      rpcNames.push(name);
      const reply = replies[name];
      if (!reply) throw new Error(`test: unexpected rpc ${name}`);
      return reply;
    },
  };
}
const serve = () =>
  v1Route.POST(
    new Request("https://blisscco.test/api/v1/ads/match", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: '{"topic":"gaming"}',
    }),
  );

describe("day 19 part 1: ad serving respects publisher status", () => {
  afterEach(() => {
    delete globals.__TEST_SUPABASE__;
  });

  it("the key is looked up by hash only (the plain key never goes to the database)", async () => {
    let args: unknown;
    globals.__TEST_SUPABASE__ = {
      rpc: async (name: string, a: unknown) => {
        if (name === "authorize_publisher_key") args = a;
        return { data: { outcome: "unauthorized" }, error: null };
      },
    };
    await serve();
    assert.deepEqual(args, { p_key_hash: KEY_HASH });
  });

  it("active publisher: ad is served (authorize -> load -> record)", async () => {
    setServeDb();
    const res = await serve();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { fill?: boolean };
    assert.equal(body.fill, true);
    assert.deepEqual(rpcNames, ["authorize_publisher_key", "load_ad_candidates", "record_ad_serve"]);
  });

  it("pending or suspended publisher (database says unauthorized): 401, no ad, no candidate loading, no serve record", async () => {
    setServeDb({ authorize_publisher_key: { data: { outcome: "unauthorized" }, error: null } });
    const res = await serve();
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(!text.includes("Visible headline"));
    assert.deepEqual(rpcNames, ["authorize_publisher_key"]);
  });

  it("a database 'ok' that still carries a pending/suspended publisher status is NOT trusted (fail closed)", async () => {
    for (const status of ["pending", "suspended"]) {
      setServeDb({ authorize_publisher_key: { data: { ...AUTH_OK, publisher_status: status }, error: null } });
      const res = await serve();
      assert.notEqual(res.status, 200, status);
      assert.ok(!(await res.text()).includes("Visible headline"), status);
      assert.deepEqual(rpcNames, ["authorize_publisher_key"], status);
    }
  });

  it("publisher suspended AFTER authorize (before record): the ad is not handed out", async () => {
    setServeDb({ record_ad_serve: { data: { outcome: "unauthorized" }, error: null } });
    const res = await serve();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { fill: false });
  });

  it("database failure while authorizing: 503, nothing else runs", async () => {
    setServeDb({ authorize_publisher_key: { data: null, error: { code: "57014", message: "SECRET" } } });
    const res = await serve();
    assert.equal(res.status, 503);
    assert.ok(!(await res.text()).includes("SECRET"));
    assert.deepEqual(rpcNames, ["authorize_publisher_key"]);
  });
});
