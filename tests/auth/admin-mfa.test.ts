import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cancelEnrollment, confirmEnrollment, getMfaStatus, parseOtp, startEnrollment, type MfaApi, type MfaFactorLike } from "@/lib/auth/mfa";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";

type Calls = { enroll: number; unenroll: string[]; challenge: number; verify: number };
function fake(factors: MfaFactorLike[], opts: { verifyFails?: boolean; listFails?: boolean; enrollFails?: boolean } = {}) {
  const calls: Calls = { enroll: 0, unenroll: [], challenge: 0, verify: 0 };
  const api: MfaApi = {
    async listFactors() {
      if (opts.listFails) return { data: null, error: { message: "x" } };
      return { data: { all: factors, totp: factors.filter((f) => f.status === "verified") }, error: null };
    },
    async enroll() {
      calls.enroll++;
      if (opts.enrollFails) return { data: null, error: { message: "x" } };
      return { data: { id: F1, totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" } }, error: null };
    },
    async challenge() {
      calls.challenge++;
      return { data: { id: "ch1" }, error: null };
    },
    async verify() {
      calls.verify++;
      return opts.verifyFails ? { data: null, error: { message: "bad" } } : { data: {}, error: null };
    },
    async unenroll({ factorId }) {
      calls.unenroll.push(factorId);
      return { data: {}, error: null };
    },
  };
  return { api, calls };
}

describe("admin MFA: status", () => {
  it("no factors => disabled", async () => assert.deepEqual(await getMfaStatus(fake([]).api), { ok: true, status: "disabled" }));
  it("unverified factor only => still disabled", async () =>
    assert.deepEqual(await getMfaStatus(fake([{ id: F1, factor_type: "totp", status: "unverified" }]).api), { ok: true, status: "disabled" }));
  it("verified totp => enabled", async () =>
    assert.deepEqual(await getMfaStatus(fake([{ id: F1, factor_type: "totp", status: "verified" }]).api), { ok: true, status: "enabled" }));
  it("load failure => unknown (ok:false), never throws", async () => assert.deepEqual(await getMfaStatus(fake([], { listFails: true }).api), { ok: false }));
});

describe("admin MFA: enrollment start", () => {
  it("returns QR + manual secret", async () => {
    const r = await startEnrollment(fake([]).api, "abc");
    assert.equal(r.status, "enrolling");
    assert.ok(r.qrCode?.startsWith("data:image/svg+xml"));
    assert.equal(r.secret, "JBSWY3DPEHPK3PXP");
    assert.equal(r.factorId, F1);
  });
  it("refuses a second factor when one is already verified (no enroll call)", async () => {
    const { api, calls } = fake([{ id: F2, factor_type: "totp", status: "verified" }]);
    const r = await startEnrollment(api, "abc");
    assert.equal(r.status, "error");
    assert.equal(calls.enroll, 0);
    assert.deepEqual(calls.unenroll, []);
  });
  it("clears only stale UNVERIFIED factors, never a verified one", async () => {
    const { api, calls } = fake([{ id: F2, factor_type: "totp", status: "unverified" }]);
    await startEnrollment(api, "abc");
    assert.deepEqual(calls.unenroll, [F2]);
    assert.equal(calls.enroll, 1);
  });
  it("enroll failure => safe error, no secret", async () => {
    const r = await startEnrollment(fake([], { enrollFails: true }).api, "abc");
    assert.equal(r.status, "error");
    assert.equal(r.secret, undefined);
  });
});

describe("admin MFA: OTP verification", () => {
  it("parseOtp accepts exactly 6 digits (spaces ok), rejects the rest", () => {
    assert.equal(parseOtp("123 456"), "123456");
    for (const bad of ["12345", "1234567", "abcdef", "", null, undefined, 123456]) assert.equal(parseOtp(bad), null);
  });
  it("correct code => success", async () => {
    const { api, calls } = fake([{ id: F1, factor_type: "totp", status: "unverified" }]);
    assert.equal((await confirmEnrollment(api, F1, "123456")).status, "success");
    assert.equal(calls.verify, 1);
  });
  it("wrong code => error, no success", async () => {
    const r = await confirmEnrollment(fake([{ id: F1, factor_type: "totp", status: "unverified" }], { verifyFails: true }).api, F1, "123456");
    assert.equal(r.status, "error");
  });
  it("bad format => rejected before any Supabase call", async () => {
    const { api, calls } = fake([{ id: F1, factor_type: "totp", status: "unverified" }]);
    assert.equal((await confirmEnrollment(api, F1, "12ab56")).status, "error");
    assert.equal(calls.challenge, 0);
  });
  it("factor not owned / unknown / already verified / not a uuid => rejected, no challenge", async () => {
    for (const [factors, id] of [
      [[], F1],
      [[{ id: F1, factor_type: "totp", status: "verified" }], F1],
      [[{ id: F2, factor_type: "totp", status: "unverified" }], F1],
      [[{ id: F1, factor_type: "totp", status: "unverified" }], "not-a-uuid"],
    ] as [MfaFactorLike[], string][]) {
      const { api, calls } = fake(factors);
      assert.equal((await confirmEnrollment(api, id, "123456")).status, "error");
      assert.equal(calls.challenge, 0);
    }
  });
});

describe("admin MFA: cancel", () => {
  it("removes an unverified factor", async () => {
    const { api, calls } = fake([{ id: F1, factor_type: "totp", status: "unverified" }]);
    await cancelEnrollment(api, F1);
    assert.deepEqual(calls.unenroll, [F1]);
  });
  it("NEVER removes a verified factor (no lock-out / downgrade)", async () => {
    const { api, calls } = fake([{ id: F1, factor_type: "totp", status: "verified" }]);
    await cancelEnrollment(api, F1);
    assert.deepEqual(calls.unenroll, []);
  });
});

describe("admin MFA: access control + nothing weakened (source checks)", () => {
  it("page and every action require the admin role first", () => {
    assert.match(read("app/dashboard/admin/security/page.tsx"), /requireRole\(\["admin"\]\)/);
    const src = read("app/dashboard/admin/security/actions.ts");
    assert.match(src, /^"use server";/);
    assert.equal((src.match(/await requireRole\(\["admin"\]\)/g) ?? []).length, 3);
    assert.ok(!/createAdminClient|SUPABASE_SECRET/.test(src), "no service-role client");
  });
  it("login / role / status checks are untouched (no aal2 forcing, no MFA in session or middleware)", () => {
    for (const f of ["lib/auth/session.ts", "lib/supabase/middleware.ts", "middleware.ts"]) assert.ok(!/mfa|aal2|getAuthenticatorAssuranceLevel/i.test(read(f)), f);
  });
  it("no recovery codes (Supabase MFA does not support them) and no secret logging", () => {
    const all = read("lib/auth/mfa.ts") + read("app/dashboard/admin/security/actions.ts") + read("components/admin/TwoFactorPanel.tsx");
    assert.ok(!/recovery[_ ]?codes?\s*[:=(]|generateRecovery/i.test(all));
    assert.ok(!/console\.(log|error|warn)/.test(all));
  });
  it("admin page links to the security page", () => assert.match(read("app/dashboard/admin/page.tsx"), /\/dashboard\/admin\/security/));
});
