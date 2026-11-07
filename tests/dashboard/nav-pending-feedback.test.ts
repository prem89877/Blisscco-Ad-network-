import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Dashboard nav: tap par turant feedback = background highlight + spinner (+ bar). Source (text) checks.
const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("dashboard nav | pending feedback", () => {
  const src = code("components/dashboard/NavPending.tsx");
  it("uses useLinkStatus and shows nothing unless a navigation is pending", () => {
    assert.match(src, /useLinkStatus\(\)/);
    assert.match(src, /if \(!pending\) return null/);
  });
  it("shows a background highlight AND a spinner (not just a thin bar), and the spinner is not delayed", () => {
    assert.match(src, /bg-violet\/\d+/);
    assert.match(src, /<Spinner size="sm" \/>/);
    assert.doesNotMatch(src, /delayed/);
  });
  it("never blocks a tap and is announced politely to screen readers", () => {
    assert.match(src, /pointer-events-none/);
    assert.match(src, /role="status"/);
    assert.match(src, /aria-live="polite"/);
  });
  it("sidebar and mobile nav both use it with their variant", () => {
    assert.match(read("components/dashboard/Sidebar.tsx"), /<NavPending variant="sidebar" \/>/);
    assert.match(read("components/dashboard/MobileNav.tsx"), /<NavPending variant="mobile" \/>/);
  });
});
