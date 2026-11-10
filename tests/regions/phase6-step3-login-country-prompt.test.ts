import { advFake } from "./advertiser-country-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { skipCountryPrompt } from "@/app/auth/choose-country/actions";
import { updateAdvertiserCountry } from "@/app/dashboard/advertiser/country-actions";
import { initialRunState } from "@/lib/campaigns/types";
import { COUNTRY_PROMPT_COOKIE, countryPromptMarker, countryPromptMode, isCountryPromptSkipped, type CountryPromptInput } from "@/lib/regions/country-prompt";

// Login ke baad, dashboard khulne se pehle country screen (+ "Do it later"). Nakli Supabase / cookies; asli database kabhi nahi.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

async function run<T>(p: Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try {
    return { state: await p };
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return { redirect: m[1] };
    throw e;
  }
}

beforeEach(() => {
  advFake.reset();
  console.error = () => {};
});

const base = (o: Partial<CountryPromptInput>): CountryPromptInput => ({
  role: "advertiser",
  accountFailed: false,
  accountExists: true,
  suspended: false,
  country: { countryCode: null },
  ...o,
});

describe("when the country screen is shown", () => {
  it("brand-new advertiser / publisher (no account row yet) => setup screen (form that includes the country dropdown)", () => {
    assert.equal(countryPromptMode(base({ role: "advertiser", accountExists: false, country: null })), "setup");
    assert.equal(countryPromptMode(base({ role: "publisher", accountExists: false, country: null })), "setup");
  });

  it("existing advertiser without a country => country screen; with a country => no screen", () => {
    assert.equal(countryPromptMode(base({ country: { countryCode: null } })), "country");
    assert.equal(countryPromptMode(base({ country: { countryCode: "IN" } })), null);
  });

  it("existing publisher: no country => screen; pending / verified / rejected => no screen (Step 2 workflow owns those)", () => {
    const pub = (country: CountryPromptInput["country"]) => countryPromptMode(base({ role: "publisher", country }));
    assert.equal(pub({ countryCode: null, status: null }), "country");
    assert.equal(pub({ countryCode: null }), "country");
    assert.equal(pub({ countryCode: "IN", status: "pending" }), null);
    assert.equal(pub({ countryCode: "IN", status: "verified" }), null);
    assert.equal(pub({ countryCode: "IN", status: "rejected" }), null);
  });

  it("never shown for admin / unknown role, on a load failure, or for a suspended account", () => {
    assert.equal(countryPromptMode(base({ role: "admin" })), null);
    assert.equal(countryPromptMode(base({ role: undefined })), null);
    assert.equal(countryPromptMode(base({ accountFailed: true, accountExists: false })), null);
    assert.equal(countryPromptMode(base({ country: null })), null); // country load fail
    assert.equal(countryPromptMode(base({ suspended: true })), null);
    assert.equal(countryPromptMode(base({ role: "publisher", suspended: true, country: { countryCode: null, status: null } })), null);
  });
});

describe('"Do it later" is remembered for this login only', () => {
  it("marker = user id + last sign-in time; a NEW login changes it, so the screen comes back", () => {
    const m1 = countryPromptMarker({ id: "u1", last_sign_in_at: "2026-11-10T06:00:00Z" });
    const m2 = countryPromptMarker({ id: "u1", last_sign_in_at: "2026-11-10T09:00:00Z" });
    assert.ok(m1 && m2 && m1 !== m2);
    assert.equal(isCountryPromptSkipped(m1, m1), true);
    assert.equal(isCountryPromptSkipped(m1, m2), false); // naya login
  });

  it("another user's cookie, a missing cookie or an unidentifiable user never counts as skipped", () => {
    const mine = countryPromptMarker({ id: "u1", last_sign_in_at: "t" });
    assert.equal(isCountryPromptSkipped(countryPromptMarker({ id: "u2", last_sign_in_at: "t" }), mine), false);
    assert.equal(isCountryPromptSkipped(undefined, mine), false);
    assert.equal(isCountryPromptSkipped(5, mine), false);
    assert.equal(countryPromptMarker(null), null);
    assert.equal(countryPromptMarker({ id: "" }), null);
    assert.equal(isCountryPromptSkipped("anything", null), false);
  });

  it("skip action: sets ONE httpOnly session cookie (no maxAge) with this user + login, then opens the dashboard with ?later=1", async () => {
    advFake.user = { id: "user-X", last_sign_in_at: "2026-11-10T08:00:00Z" };
    const r = await run(skipCountryPrompt());
    assert.equal(r.redirect, "/dashboard?later=1");
    assert.equal(advFake.cookieSets.length, 1);
    const c = advFake.cookieSets[0];
    assert.equal(c.name, COUNTRY_PROMPT_COOKIE);
    assert.equal(c.value, "user-X|2026-11-10T08:00:00Z");
    assert.equal(c.options.httpOnly, true);
    assert.equal(c.options.sameSite, "lax");
    assert.equal(c.options.path, "/");
    assert.ok(!("maxAge" in c.options) && !("expires" in c.options), "session cookie: closes with the browser");
    assert.equal(advFake.inserts.length + advFake.updates.length, 0, "skipping saves nothing");
  });
});

describe("choosing a country on this screen", () => {
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("advertiser: with the continue flag the country is saved (one column) and the user goes straight to the dashboard", async () => {
    const r = await run(updateAdvertiserCountry(initialRunState, fd({ country: "in", continue: "dashboard" })));
    assert.equal(r.redirect, "/dashboard");
    assert.deepEqual(advFake.updates, [{ table: "advertisers", payload: { country_code: "IN" }, filters: [["profile_id", "user-adv-1"]] }]);
  });

  it("advertiser: invalid country with the flag still stops (no save, no redirect); without the flag nothing redirects (old behavior)", async () => {
    const bad = await run(updateAdvertiserCountry(initialRunState, fd({ country: "XX", continue: "dashboard" })));
    assert.equal(bad.redirect, undefined);
    assert.equal(bad.state?.status, "error");
    assert.equal(advFake.updates.length, 0);
    const plain = await run(updateAdvertiserCountry(initialRunState, fd({ country: "US" })));
    assert.equal(plain.redirect, undefined);
    assert.equal(plain.state?.status, "success");
  });

  it("advertiser: a failed save never redirects (the user sees the error and can retry or choose later)", async () => {
    advFake.updateError = { code: "XX000" };
    const r = await run(updateAdvertiserCountry(initialRunState, fd({ country: "IN", continue: "dashboard" })));
    assert.equal(r.redirect, undefined);
    assert.equal(r.state?.status, "error");
  });
});

describe("wiring (source checks)", () => {
  it("overview redirects to the country screen only for advertiser / publisher, only when not skipped, and honours ?later=1", () => {
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /account\.role === "advertiser" \|\| account\.role === "publisher"/);
    assert.match(page, /\.later === "1"/);
    assert.match(page, /isCountryPromptSkipped\(\(await cookies\(\)\)\.get\(COUNTRY_PROMPT_COOKIE\)\?\.value, countryPromptMarker\(account\.user\)\)/);
    assert.match(page, /if \(!skipped && \(await loadCountryPromptMode\(account\.role\)\) !== null\) redirect\("\/auth\/choose-country"\)/);
  });

  it("the country screen: needs login, honours role choice, leaves when there is nothing to ask, has the Do it later button", () => {
    const page = read("app/auth/choose-country/page.tsx");
    assert.match(page, /await requireUser\(\)/);
    assert.match(page, /roleChoicePending\) redirect\("\/auth\/choose-role"\)/);
    assert.match(page, /if \(!mode\) redirect\("\/dashboard"\)/);
    assert.match(page, /action=\{skipCountryPrompt\}/);
    assert.match(page, /Do it later/);
    assert.match(page, /<AdvertiserSetupForm countryOptions=\{options\}/);
    assert.match(page, /<PublisherSetupForm countryOptions=\{options\}/);
    assert.match(page, /<AdvertiserCountryForm[\s\S]*?continueToDashboard/);
    assert.match(page, /<PublisherCountryForm[\s\S]*?continueToDashboard/);
  });

  it("the screen reuses the existing forms / actions / country list: no new country list, no new verification, no pricing", () => {
    for (const f of ["app/auth/choose-country/page.tsx", "app/auth/choose-country/actions.ts", "lib/regions/country-prompt.ts", "lib/regions/country-prompt-queries.ts"]) {
      const code = strip(read(f));
      assert.ok(!/NAMED_REGION_COUNTRIES|COUNTRY_TO_REGION|ISO_COUNTRY_CODES\s*[:=]/.test(code), f);
      assert.ok(!/\[(\s*"[A-Z]{2}"\s*,){3,}/.test(code), f);
      assert.ok(!/cpm|cpc|ledger|payout|payment|usd|currency|admin_review|country_status\s*[:=]|\.rpc\(|\.from\(/i.test(code), f);
    }
  });

  it("hidden continue flag is only added by the login screen; the account pages keep their old behavior", () => {
    assert.match(read("components/dashboard/AdvertiserCountryForm.tsx"), /continueToDashboard = false/);
    assert.match(read("components/dashboard/PublisherCountryForm.tsx"), /continueToDashboard = false/);
    assert.ok(!/continueToDashboard/.test(read("app/dashboard/publisher/page.tsx")));
    assert.ok(!/continueToDashboard/.test(read("app/dashboard/advertiser/campaigns/page.tsx")));
  });
});
