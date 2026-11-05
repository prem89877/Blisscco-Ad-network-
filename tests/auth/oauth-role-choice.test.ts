import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeIntent, isFreshGoogleSignup, parseIntent } from "@/lib/auth/oauth-intent";

// Phase 3 Step 5: naya Google user ab chup-chaap advertiser nahi banta; account type dashboard me dikhta hai.
// Ye SOURCE-LEVEL aur pure-function jaanch hai: asli Google login ya database ka test NAHI hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const NOW = Date.parse("2026-11-05T10:00:00Z");
const google = [{ provider: "google" }];

describe("oauth intent", () => {
  it("round-trips signup and login, anything else means login (ask the user)", () => {
    assert.deepEqual(parseIntent(encodeIntent({ kind: "signup", role: "publisher" })), { kind: "signup", role: "publisher" });
    assert.deepEqual(parseIntent(encodeIntent({ kind: "signup", role: "advertiser" })), { kind: "signup", role: "advertiser" });
    for (const bad of [undefined, null, "", "admin", "signup:admin", "signup:", "SIGNUP:publisher", 5]) {
      assert.deepEqual(parseIntent(bad), { kind: "login" });
    }
  });
});

describe("fresh Google signup detection", () => {
  const fresh = { created_at: "2026-11-05T09:59:30Z", last_sign_in_at: "2026-11-05T09:59:31Z", identities: google };
  it("a just-created Google user is new", () => assert.equal(isFreshGoogleSignup(fresh, NOW), true));
  it("an older user is not touched", () => {
    assert.equal(isFreshGoogleSignup({ ...fresh, created_at: "2026-10-25T09:00:00Z", last_sign_in_at: "2026-11-05T09:59:50Z" }, NOW), false);
  });
  it("an email user is not touched", () => {
    assert.equal(isFreshGoogleSignup({ ...fresh, identities: [{ provider: "email" }] }, NOW), false);
    assert.equal(isFreshGoogleSignup({ ...fresh, identities: null }, NOW), false);
  });
  it("missing or broken dates are not new", () => {
    assert.equal(isFreshGoogleSignup(null, NOW), false);
    assert.equal(isFreshGoogleSignup({ identities: google }, NOW), false);
    assert.equal(isFreshGoogleSignup({ ...fresh, created_at: "nope" }, NOW), false);
  });
});

describe("oauth role choice: source checks", () => {
  it("login page Google button asks the user; signup page passes the chosen type", () => {
    assert.match(read("components/auth/LoginForm.tsx"), /<GoogleButton intent="login" \/>/);
    assert.match(read("components/auth/SignupForm.tsx"), /<GoogleButton intent="signup" accountType=\{accountType\} \/>/);
  });
  it("the confirm route only handles fresh Google signups and never blocks login", () => {
    const src = read("app/auth/confirm/route.ts");
    assert.match(src, /isFreshGoogleSignup\(data\.user\)/);
    assert.match(src, /CHOOSE_ROLE_PATH/);
    assert.match(read("lib/auth/oauth-role.ts"), /catch \{[\s\S]*return "skip"/);
  });
  it("chooseAccountRole takes the user id from the login, only advertiser or publisher from the form", () => {
    const src = read("app/auth/actions.ts");
    const fn = src.slice(src.indexOf("export async function chooseAccountRole"));
    assert.match(fn, /await requireUser\(\)/);
    assert.match(fn, /!current\.roleChoicePending\) redirect\("\/dashboard"\)/);
    assert.match(fn, /picked !== "advertiser" && picked !== "publisher"/);
    assert.match(fn, /setChosenRole\(user\.id, picked\)/);
    assert.ok(!/formData\.get\("(userId|user_id|profileId|role|status)"\)/.test(fn));
  });
  it("dashboard pages and layout send a pending user to the choose page", () => {
    assert.match(read("lib/auth/session.ts"), /roleChoicePending\) redirect\("\/auth\/choose-role"\)/);
    assert.match(read("app/dashboard/layout.tsx"), /roleChoicePending\) redirect\("\/auth\/choose-role"\)/);
  });
  it("session falls back to the old query when the new column is not in the database yet", () => {
    assert.match(read("lib/auth/session.ts"), /select\("role, status"\)/);
  });
  it("the dashboard header shows the account type", () => {
    const src = read("components/dashboard/DashboardHeader.tsx");
    assert.match(src, /account-role-badge/);
    assert.match(src, /publisher: "AI Publisher"/);
    assert.match(read("app/dashboard/layout.tsx"), /role=\{account\?\.role \?\? null\}/);
  });
});

describe("oauth role choice: SQL (static)", () => {
  const sql = read("supabase/sql/phase3-step5-1-oauth-role-choice.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("both functions are security definer with a locked search_path", () => {
    assert.equal((code.match(/security definer/g) ?? []).length, 2);
    assert.equal((code.match(/set search_path = ''/g) ?? []).length, 2);
  });
  it("only service_role may run them", () => {
    assert.match(code, /grant execute on function public\.mark_role_choice_pending\(uuid\) to service_role;/);
    assert.match(code, /grant execute on function public\.set_initial_account_role\(uuid, text\) to service_role;/);
    assert.ok(!/grant[^;]*to[^;]*(authenticated|anon|public)\b/.test(code.replace(/revoke[^;]*;/g, "")));
  });
  it("admin can never be chosen and the flag is required", () => {
    assert.match(code, /p_role not in \('advertiser', 'publisher'\)/);
    assert.match(code, /role_choice_pending\) then/);
  });
  it("only brand-new advertiser profiles without campaigns can be marked", () => {
    assert.match(code, /interval '10 minutes'/);
    assert.match(code, /p\.role = 'advertiser'/);
    assert.match(code, /not exists \(/);
  });
});
