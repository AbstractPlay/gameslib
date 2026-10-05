#!/usr/bin/env node
/* eslint-env node */
/**
 * Fail when locale JSON on disk is not 2-space pretty-print with a trailing newline.
 *
 *   node scripts/check-locale-json-format.mjs
 *   node scripts/check-locale-json-format.mjs --write
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeLocaleJsonText } from "./locale-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const LOCALE_ROOTS = ["locales", "locale-src"];

function collectJsonFiles() {
  const files = [];
  for (const rootName of LOCALE_ROOTS) {
    const root = path.join(ROOT, rootName);
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const lang of fs.readdirSync(root)) {
      const langDir = path.join(root, lang);
      if (!fs.statSync(langDir).isDirectory()) {
        continue;
      }
      for (const file of fs.readdirSync(langDir)) {
        if (file.endsWith(".json")) {
          files.push(path.join(langDir, file));
        }
      }
    }
  }
  return files.sort();
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function run({ write = false } = {}) {
  const mismatches = [];
  for (const filePath of collectJsonFiles()) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
    const raw = fs.readFileSync(filePath, "utf8");
    let canonical;
    try {
      canonical = normalizeLocaleJsonText(raw);
    } catch (error) {
      mismatches.push({ rel, error: `invalid JSON: ${error.message}` });
      continue;
    }
    const normalizedRaw = normalizeNewlines(raw);
    if (canonical !== normalizedRaw) {
      if (write) {
        fs.writeFileSync(filePath, canonical, "utf8");
        console.log(`Normalized ${rel}`);
      } else {
        mismatches.push({ rel });
      }
    }
  }

  if (mismatches.length === 0) {
    if (write) {
      console.log("All locale JSON files already canonical.");
    }
    return 0;
  }

  if (write) {
    return 0;
  }

  console.error(
    `${mismatches.length} locale file(s) not in canonical 2-space format (run with --write to fix):`,
  );
  for (const { rel, error } of mismatches) {
    console.error(`  ${rel}${error ? ` — ${error}` : ""}`);
  }
  return 1;
}

const write = process.argv.includes("--write");
process.exitCode = run({ write });
