import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Landing page: links jo bahar jaate hain sahi jagah jaate hain, aur sign-up ka raasta maujood hai (source check).

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const landing = ["app/page.tsx", "components/Nav.tsx", "components/Hero.tsx", "components/Sections.tsx", "components/Footer.tsx"]
  .map(read)
  .join("\n");

describe("landing page", () => {
  it("has a Sign up link and a Log in link", () => {
    assert.match(read("components/Nav.tsx"), /href="\/signup"/);
    assert.match(read("components/Nav.tsx"), /href="\/login"/);
    assert.match(read("components/Sections.tsx"), /href="\/signup"/);
  });
  it("does not say sign-up is not open any more", () => {
    assert.ok(!/Not open yet|sign-up form arrives/i.test(read("components/Sections.tsx")));
  });
  it("every #anchor link points to an id that exists", () => {
    const anchors = new Set([...landing.matchAll(/href="#([a-z0-9-]+)"/gi)].map((m) => m[1]));
    const ids = new Set([...landing.matchAll(/\bid="([a-z0-9-]+)"/gi)].map((m) => m[1]));
    // Section component id prop ke roop me bhi
    for (const m of landing.matchAll(/<Section id="([a-z0-9-]+)"/g)) ids.add(m[1]);
    for (const a of anchors) assert.ok(ids.has(a) || a === "main" || a === "top", `missing #${a}`);
  });
  it("internal links point to pages that exist", () => {
    for (const href of new Set([...landing.matchAll(/href="(\/[a-z-]*)"/g)].map((m) => m[1]))) {
      const dir = href === "/" ? "app/page.tsx" : `app${href}/page.tsx`;
      assert.doesNotThrow(() => read(dir), `${href} has no page`);
    }
  });
  it("has social preview, sitemap, robots and error pages", () => {
    for (const f of ["app/opengraph-image.tsx", "app/sitemap.ts", "app/robots.ts", "app/not-found.tsx", "app/error.tsx", "app/global-error.tsx", "app/dashboard/error.tsx"]) {
      assert.doesNotThrow(() => read(f), f);
    }
    assert.match(read("app/robots.ts"), /disallow/);
    assert.match(read("app/layout.tsx"), /openGraph/);
  });
});
