#!/usr/bin/env node
/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const LOCALES_DIR = path.join(ROOT, "locales");
const REFERENCE_LOCALE = "en";
const LOCALE_FILES = ["apgames.json", "apresults.json"];

/** Skip "identical to English" when normalized text is this short or less. */
const MIN_ENGLISH_LIKE_LENGTH = 2;

const PLACEHOLDER_PREFIX_RE = /^\[[A-Za-z_]+\]\s*/;
const I18N_PLACEHOLDER_RE = /\{\{[-\s]*[^}]+\}\}/g;
const URL_RE = /https?:\/\/\S+/g;

function flattenStrings(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) {
      continue;
    }
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[pathKey] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenStrings(value, pathKey));
    }
  }
  return out;
}

function normalizeForComparison(value) {
  return value
    .replace(I18N_PLACEHOLDER_RE, "")
    .replace(URL_RE, "")
    .replace(/abstractplay/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasPlaceholderPrefix(value) {
  return PLACEHOLDER_PREFIX_RE.test(value.trim());
}

function stripPlaceholderPrefix(value) {
  return value.trim().replace(PLACEHOLDER_PREFIX_RE, "");
}

function looksLikeEnglish(value, englishValue) {
  if (englishValue === undefined) {
    return false;
  }
  const stripped = stripPlaceholderPrefix(value);
  const left = normalizeForComparison(stripped);
  const right = normalizeForComparison(englishValue);
  if (!left || !right) {
    return false;
  }
  if (left.length <= MIN_ENGLISH_LIKE_LENGTH) {
    return false;
  }
  return left === right;
}

function loadLocaleStrings(locale, localeFile) {
  const filePath = path.join(LOCALES_DIR, locale, localeFile);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return flattenStrings(data);
}

function auditLocaleFile(locale, localeFile, reference) {
  const strings = loadLocaleStrings(locale, localeFile);
  const translationKeys = Object.keys(reference);
  const label = `${locale}/${localeFile}`;

  const missing = [];
  const empty = [];
  const placeholderPrefix = [];
  const identicalToEnglish = [];

  if (!strings) {
    return {
      locale,
      localeFile,
      label,
      ready: false,
      totalKeys: translationKeys.length,
      presentKeys: 0,
      missing: translationKeys,
      empty,
      placeholderPrefix,
      identicalToEnglish,
      blockingIssueCount: translationKeys.length,
      reviewCount: 0,
      fileMissing: true,
    };
  }

  for (const key of translationKeys) {
    if (!(key in strings)) {
      missing.push(key);
      continue;
    }

    const value = strings[key];
    if (!value.trim()) {
      empty.push(key);
      continue;
    }

    if (hasPlaceholderPrefix(value)) {
      placeholderPrefix.push({ key, value });
      continue;
    }

    if (looksLikeEnglish(value, reference[key])) {
      identicalToEnglish.push({ key, value });
    }
  }

  const present = translationKeys.length - missing.length;
  const blockingIssueCount = missing.length + empty.length + placeholderPrefix.length;
  const reviewCount = identicalToEnglish.length;
  const ready = blockingIssueCount === 0;

  return {
    locale,
    localeFile,
    label,
    ready,
    totalKeys: translationKeys.length,
    presentKeys: present,
    missing,
    empty,
    placeholderPrefix,
    identicalToEnglish,
    blockingIssueCount,
    reviewCount,
    fileMissing: false,
  };
}

function formatIssueList(items, formatter) {
  if (items.length === 0) {
    return "    (none)";
  }
  return items.map((item) => `    - ${formatter(item)}`).join("\n");
}

function printBlockingDetails(result) {
  if (result.fileMissing) {
    console.log("    file missing");
    return;
  }
  if (result.missing.length) {
    console.log("    missing:");
    console.log(formatIssueList(result.missing, (key) => key));
  }
  if (result.empty.length) {
    console.log("    empty:");
    console.log(formatIssueList(result.empty, (key) => key));
  }
  if (result.placeholderPrefix.length) {
    console.log("    [XX] prefix:");
    console.log(
      formatIssueList(result.placeholderPrefix, ({ key, value }) => `${key}: ${JSON.stringify(value)}`),
    );
  }
}

function printReviewDetails(result) {
  if (result.identicalToEnglish.length) {
    console.log("    identical to English:");
    console.log(
      formatIssueList(result.identicalToEnglish, ({ key, value }) => `${key}: ${JSON.stringify(value)}`),
    );
  }
}

function printReport(results, verbose) {
  const ready = results.filter((r) => r.ready);
  const notReady = results.filter((r) => !r.ready);
  const needsReview = results.filter((r) => r.reviewCount > 0);

  console.log("Locale readiness report");
  console.log("=======================");
  console.log(`Reference: ${REFERENCE_LOCALE}/{${LOCALE_FILES.join(", ")}}`);
  console.log(`Checked: ${results.length} locale file(s)\n`);

  console.log("Ready (no blocking issues):");
  if (ready.length === 0) {
    console.log("  (none)");
  } else {
    for (const result of ready) {
      const reviewNote =
        result.reviewCount > 0 ? `, ${result.reviewCount} identical-to-English for review` : "";
      console.log(`  - ${result.label} (${result.presentKeys}/${result.totalKeys} keys${reviewNote})`);
    }
  }

  console.log("\nNot ready (blocking issues):");
  if (notReady.length === 0) {
    console.log("  (none)");
  } else {
    for (const result of notReady) {
      console.log(
        `  - ${result.label} (${result.presentKeys}/${result.totalKeys} keys, ${result.blockingIssueCount} blocking issue(s))`,
      );
      if (verbose) {
        printBlockingDetails(result);
        console.log("");
      }
    }
  }

  console.log("\nReview suggested (identical to English; not blocking):");
  if (needsReview.length === 0) {
    console.log("  (none)");
  } else {
    for (const result of needsReview) {
      console.log(`  - ${result.label} (${result.reviewCount} key(s))`);
      if (verbose) {
        printReviewDetails(result);
        console.log("");
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");
  const failOnNotReady = args.includes("--fail");
  const onlyLocales = args.filter((arg) => !arg.startsWith("-"));

  const references = Object.fromEntries(
    LOCALE_FILES.map((localeFile) => {
      const reference = loadLocaleStrings(REFERENCE_LOCALE, localeFile);
      if (!reference) {
        throw new Error(`Missing reference locale file: ${REFERENCE_LOCALE}/${localeFile}`);
      }
      return [localeFile, reference];
    }),
  );

  const localeDirs = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((locale) => locale !== REFERENCE_LOCALE)
    .filter((locale) => onlyLocales.length === 0 || onlyLocales.includes(locale))
    .sort();

  const results = [];
  for (const locale of localeDirs) {
    for (const localeFile of LOCALE_FILES) {
      results.push(auditLocaleFile(locale, localeFile, references[localeFile]));
    }
  }

  printReport(results, verbose);

  if (failOnNotReady && results.some((result) => !result.ready)) {
    process.exit(1);
  }
}

main();
