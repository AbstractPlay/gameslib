import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts", "gen-docs-catalog.mjs");

test("gen-docs-catalog --check passes on committed docs", () => {
  execFileSync(process.execPath, [script, "--check"], {
    cwd: root,
    stdio: "pipe",
  });
});

test("gen-docs-catalog writes meta-games table", () => {
  const meta = fs.readFileSync(path.join(root, "docs", "meta-games.md"), "utf8");
  assert.match(meta, /## Production catalog/);
  assert.match(meta, /\| Display name \| `metaGame` uid \|/);
});

test("categories.md contains generated tag index", () => {
  const cat = fs.readFileSync(path.join(root, "docs", "categories.md"), "utf8");
  assert.match(cat, /<!-- gen-docs-catalog:start -->/);
  assert.match(cat, /## Generated tag index/);
  assert.match(cat, /play\.abstractplay\.com\/games\//);
});
