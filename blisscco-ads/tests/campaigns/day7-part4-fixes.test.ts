import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCampaignForm } from "@/lib/campaigns/validation";
import { validateNewPassword } from "@/lib/auth/validation";
import type { FormValues } from "@/lib/campaigns/types";

const TODAY = "2026-10-25";
const base: FormValues = {
  name: "Diwali sale",
  description: "",
  category: "lifestyle",
  totalBudget: "1000",
  dailyBudget: "",
  startDate: TODAY,
  endDate: "",
};
const read = (f: string) => readFileSync(f, "utf8");

describe("day 7 part 4 fixes", () => {
  it("budget commas must be real thousands groups", () => {
    for (const bad of ["2,5,0,0", "1,00", "12,34,567", ",500"]) {
      const r = parseCampaignForm({ ...base, totalBudget: bad }, { todayUtc: TODAY });
      assert.equal(r.ok, false, bad);
    }
    for (const good of ["2,500", "1,234,567.50", "2500"]) {
      assert.equal(parseCampaignForm({ ...base, totalBudget: good }, { todayUtc: TODAY }).ok, true, good);
    }
  });

  it("long multi-byte password gets a clear message", () => {
    const msg = validateNewPassword("é".repeat(50));
    assert.match(msg ?? "", /bytes/);
    assert.equal(validateNewPassword("a".repeat(72)), undefined);
  });

  it("legal pages use ids without spaces for aria-labelledby", () => {
    for (const f of ["app/terms/page.tsx", "app/privacy/page.tsx"]) {
      const s = read(f);
      assert.ok(s.includes("legal-h-${i}"), f);
      assert.equal(s.includes("h-${s.title}"), false, f);
      assert.equal(/sample data only/i.test(s), false, f);
    }
  });

  it("PageHeader shows the Demo badge only when asked", () => {
    assert.match(read("components/dashboard/PageHeader.tsx"), /demo = false/);
  });

  it("landing does not call the real dashboard a demo", () => {
    assert.equal(/Demo dashboard/.test(read("components/Nav.tsx") + read("components/Footer.tsx")), false);
  });
});
