import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Google login har baar account chooser dikhata hai, taaki browser me pehle se logged-in account (jaise admin ka) chup-chaap login na ho.
const ROOT = path.join(__dirname, "..", "..", "..");

describe("google sign-in | account chooser", () => {
  it("signInWithOAuth asks Google to show the account chooser every time", () => {
    const src = readFileSync(path.join(ROOT, "app/auth/actions.ts"), "utf8");
    assert.match(src, /queryParams:\s*\{\s*prompt:\s*"select_account"\s*\}/);
  });
});
