#!/usr/bin/env node
/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MANAGED_LANGS = ["de", "fr", "it"];
const LOCALE_FILES = ["apgames.json", "apresults.json"];

function collectLeaves(obj, prefix = "") {
  const leaves = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return leaves;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) continue;
    const leafPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      leaves[leafPath] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(leaves, collectLeaves(value, leafPath));
    }
  }
  return leaves;
}

function sortObjectKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

function splitFile(lang, fileName) {
  const localePath = path.join(ROOT, "locales", lang, fileName);
  const srcPath = path.join(ROOT, "locale-src", lang, fileName);

  const data = JSON.parse(fs.readFileSync(localePath, "utf8"));
  if (!data._src || typeof data._src !== "object") {
    console.warn(`[${lang}/${fileName}] No _src block — skipping`);
    return false;
  }

  const src = sortObjectKeys(data._src);
  const translations = { ...data };
  delete translations._src;

  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, JSON.stringify(src, null, 2) + "\n");
  fs.writeFileSync(localePath, JSON.stringify(translations, null, 2) + "\n");

  const srcKeys = Object.keys(src);
  const leafKeys = Object.keys(collectLeaves(translations));
  const srcSet = new Set(srcKeys);
  const leafSet = new Set(leafKeys);
  const missingInSrc = leafKeys.filter((k) => !srcSet.has(k));
  const extraInSrc = srcKeys.filter((k) => !leafSet.has(k));

  console.log(
    `[${lang}/${fileName}] split ${srcKeys.length} src keys, ${leafKeys.length} translation leaves`,
  );
  if (missingInSrc.length > 0) {
    console.warn(`  leaves missing in sidecar: ${missingInSrc.slice(0, 5).join(", ")}${missingInSrc.length > 5 ? "…" : ""}`);
  }
  if (extraInSrc.length > 0) {
    console.warn(`  sidecar keys without translation: ${extraInSrc.slice(0, 5).join(", ")}${extraInSrc.length > 5 ? "…" : ""}`);
  }

  return true;
}

function main() {
  let count = 0;
  for (const lang of MANAGED_LANGS) {
    for (const fileName of LOCALE_FILES) {
      if (splitFile(lang, fileName)) {
        count++;
      }
    }
  }
  console.log(`Done. Split ${count} file(s).`);
}

main();
