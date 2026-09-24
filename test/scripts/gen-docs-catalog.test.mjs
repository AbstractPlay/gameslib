import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts", "gen-docs-catalog.mjs");

test("gen-docs-catalog writes meta-games and categories outputs", () => {
  execFileSync(process.execPath, [script], {
    cwd: root,
    stdio: "pipe",
  });
  const meta = fs.readFileSync(path.join(root, "docs", "meta-games.md"), "utf8");
  assert.match(meta, /## Production catalog/);
  assert.match(meta, /\| Display name \| `metaGame` uid \|/);

  const cat = fs.readFileSync(path.join(root, "docs", "categories.md"), "utf8");
  assert.match(cat, /<!-- gen-docs-catalog:start -->/);
  assert.match(cat, /## Generated tag index/);
  assert.match(cat, /play\.abstractplay\.com\/games\//);
  assert.match(cat, /## Goals \(`goal>…`\)/);
});

test("categories.prose.md is the committed narrative source", () => {
  const prose = fs.readFileSync(
    path.join(root, "docs", "categories.prose.md"),
    "utf8",
  );
  assert.match(prose, /do not hand-edit `docs\/categories\.md`/i);
  assert.doesNotMatch(prose, /<!-- gen-docs-catalog:start -->/);
});
