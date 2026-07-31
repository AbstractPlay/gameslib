#!/usr/bin/env node
/* eslint-env node */
/**
 * Fail if English locale files contain i18next keys that Weblate treats as
 * duplicate identifiers (bare key sharing a stem with _one/_other/_2/etc. siblings).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const LOCALE_FILES = ["apgames.json", "apresults.json"];
const PLURAL_SUFFIX_RE = /^(.*)_(one|other|zero|two|few|many|plural|\d+)$/;

function findConflicts(obj, prefix = "") {
  const conflicts = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return conflicts;
  }

  const bases = new Set();
  const stems = new Set();

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) {
      continue;
    }
    if (typeof value === "string") {
      const match = key.match(PLURAL_SUFFIX_RE);
      if (match) {
        stems.add(match[1]);
      } else {
        bases.add(key);
      }
    }
  }

  for (const base of bases) {
    if (stems.has(base)) {
      conflicts.push(prefix ? `${prefix}.${base}` : base);
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) {
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      conflicts.push(...findConflicts(value, childPrefix));
    }
  }

  return conflicts;
}

function main() {
  let failed = false;

  for (const fileName of LOCALE_FILES) {
    const filePath = path.join(ROOT, "locales", "en", fileName);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const conflicts = findConflicts(data);

    if (conflicts.length > 0) {
      failed = true;
      console.error(`\n${fileName}: ${conflicts.length} Weblate plural-stem conflict(s):`);
      for (const key of conflicts) {
        console.error(`  - ${key}`);
      }
    }
  }

  if (failed) {
    console.error(
      "\nRename bare keys so they do not share a stem with plural/context suffix siblings.",
    );
    console.error("See docs/i18n.md for details.");
    process.exit(1);
  }

  console.log("No Weblate plural-stem conflicts found.");
}

main();
