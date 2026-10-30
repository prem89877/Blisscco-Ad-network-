import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFilters, filtersToHref } from "../../lib/campaigns/filters";

describe("day 11 part 3: campaign list category filter uses the same cleaning as matching", () => {
  it("casing, spaces and hyphens are cleaned to the stored slug", () => {
    for (const raw of ["Gaming", " gaming ", "GAMING", "developer-tools", "Developer Tools", "developer__tools"]) {
      const want = raw.toLowerCase().includes("dev") ? "developer_tools" : "gaming";
      assert.equal(parseFilters({ category: raw }).category, want, raw);
    }
  });
  it("legacy slug still filters (no alias mapping, no taxonomy lookup)", () => {
    assert.equal(parseFilters({ category: "Beauty" }).category, "beauty");
    assert.equal(parseFilters({ category: "tech" }).category, "tech");
  });
  it("malformed values are still dropped", () => {
    for (const raw of ["", "Bad Value!", "gaming;drop", "../etc", "a b c d", "x".repeat(60), "\u0001", "gaming\nx"]) {
      assert.equal(parseFilters({ category: raw }).category, "", JSON.stringify(raw));
    }
  });
  it("href gets the cleaned slug", () => {
    assert.equal(filtersToHref("/x", parseFilters({ category: " Gaming " })), "/x?category=gaming");
  });
});
