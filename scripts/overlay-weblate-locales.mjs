#!/usr/bin/env node
/**
 * Reconcile a bad locale merge: keep develop (auto-translate) as the base and
 * overlay Weblate only where the Weblate leaf is a real translation (value !== English).
 *
 * Usage:
 *   node scripts/overlay-weblate-locales.mjs [--dry-run] [--ours REF] [--theirs REF] [locales/xx/file.json ...]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANAGED_LANGS, collectLeaves, pruneSrcTracking, pruneToSourceShape } from "./locale-prune.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * @param {string} enValue
 * @param {string | undefined} weblateValue
 */
export function isHumanWeblateLeaf(enValue, weblateValue) {
  return weblateValue !== undefined && weblateValue !== enValue;
}

/**
 * @param {Record<string, string>} sourceLeaves
 * @param {Record<string, string>} developLeaves
 * @param {Record<string, string>} weblateLeaves
 * @param {Record<string, unknown>} developTracking
 * @param {Record<string, unknown>} weblateTracking
 */
export function overlayLocaleLeaves(
  sourceLeaves,
  developLeaves,
  weblateLeaves,
  developTracking,
  weblateTracking,
) {
  /** @type {Record<string, string>} */
  const mergedLeaves = {};
  /** @type {Record<string, { src: string; out: string }>} */
  const mergedTracking = {};

  let weblateWins = 0;
  let developKept = 0;
  let weblateFallback = 0;

  for (const [leafPath, enValue] of Object.entries(sourceLeaves)) {
    const devVal = developLeaves[leafPath];
    const wbVal = weblateLeaves[leafPath];

    let chosen;
    let trackingSource;
    if (isHumanWeblateLeaf(enValue, wbVal)) {
      chosen = wbVal;
      trackingSource = weblateTracking;
      weblateWins++;
    } else if (devVal !== undefined) {
      chosen = devVal;
      trackingSource = developTracking;
      developKept++;
    } else if (wbVal !== undefined) {
      chosen = wbVal;
      trackingSource = weblateTracking;
      weblateFallback++;
    } else {
      continue;
    }

    mergedLeaves[leafPath] = chosen;
    const entry = trackingSource[leafPath];
    const entrySrc =
      entry && typeof entry === "object" && typeof entry.src === "string"
        ? entry.src
        : typeof entry === "string"
          ? entry
          : undefined;
    if (entrySrc === enValue && entry && typeof entry === "object" && typeof entry.out === "string") {
      mergedTracking[leafPath] = { src: enValue, out: entry.out };
    } else {
      mergedTracking[leafPath] = { src: enValue, out: chosen };
    }
  }

  const prunedTracking = pruneSrcTracking(mergedTracking, sourceLeaves);
  return { mergedLeaves, mergedTracking: prunedTracking, weblateWins, developKept, weblateFallback };
}

function gitShow(ref) {
  const result = spawnSync("git", ["show", ref], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git show ${ref} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

function gitJson(ref) {
  return JSON.parse(gitShow(ref));
}

function setLeafValue(obj, leafPath, value) {
  const parts = leafPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function unflattenLeaves(leaves) {
  const result = {};
  for (const [leafPath, value] of Object.entries(leaves)) {
    setLeafValue(result, leafPath, value);
  }
  return result;
}

function langFromLocalePath(localePath) {
  const parts = localePath.replace(/\\/g, "/").split("/");
  const idx = parts.indexOf("locales");
  if (idx < 0 || idx + 1 >= parts.length) {
    throw new Error(`Not a locale path: ${localePath}`);
  }
  return parts[idx + 1];
}

function englishSourcePath(localePath) {
  const normalized = localePath.replace(/\\/g, "/");
  const fileName = path.basename(normalized);
  return `locales/en/${fileName}`;
}

function listDefaultTargets(ours, theirs) {
  const result = spawnSync("git", ["diff", "--name-only", ours, theirs, "--", "locales/"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git diff failed: ${(result.stderr || "").trim()}`);
  }
  const fromRefs = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line.startsWith("locales/") && !line.startsWith("locales/en/"));
  if (fromRefs.length > 0) {
    return fromRefs;
  }
  const mergeResult = spawnSync("git", ["diff", "--name-only", "HEAD^1", "HEAD", "--", "locales/"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return (mergeResult.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line.startsWith("locales/") && !line.startsWith("locales/en/"));
}

function loadTracking(ref, langCode, fileName) {
  const trackingPath = `locale-src/${langCode}/${fileName}`;
  try {
    return gitJson(`${ref}:${trackingPath}`);
  } catch {
    return {};
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * @param {string} localeRelPath e.g. locales/fr/apgames.json
 * @param {{ ours: string; theirs: string; dryRun: boolean }} opts
 */
export function overlayLocaleFile(localeRelPath, opts) {
  const langCode = langFromLocalePath(localeRelPath);
  const fileName = path.basename(localeRelPath);
  const enPath = englishSourcePath(localeRelPath);
  const enAbs = path.join(ROOT, enPath);
  if (!fs.existsSync(enAbs)) {
    throw new Error(`Missing English source: ${enPath}`);
  }

  const sourceData = JSON.parse(fs.readFileSync(enAbs, "utf8"));
  const sourceLeaves = collectLeaves(sourceData);
  const developLeaves = collectLeaves(gitJson(`${opts.ours}:${localeRelPath}`));
  const weblateLeaves = collectLeaves(gitJson(`${opts.theirs}:${localeRelPath}`));
  const developTracking = loadTracking(opts.ours, langCode, fileName);
  const weblateTracking = loadTracking(opts.theirs, langCode, fileName);

  const { mergedLeaves, mergedTracking, weblateWins, developKept, weblateFallback } =
    overlayLocaleLeaves(
      sourceLeaves,
      developLeaves,
      weblateLeaves,
      developTracking,
      weblateTracking,
    );

  const nested = unflattenLeaves(mergedLeaves);
  const targetData = pruneToSourceShape(sourceData, nested) ?? {};

  const outPath = path.join(ROOT, localeRelPath);
  if (!opts.dryRun) {
    writeJson(outPath, targetData);
    if (MANAGED_LANGS.includes(langCode)) {
      writeJson(path.join(ROOT, "locale-src", langCode, fileName), mergedTracking);
    }
  }

  const leafCount = collectLeaves(targetData);
  return {
    localeRelPath,
    langCode,
    leafCount: Object.keys(leafCount).length,
    sourceLeafCount: Object.keys(sourceLeaves).length,
    weblateWins,
    developKept,
    weblateFallback,
  };
}

function parseArgs(argv) {
  let dryRun = false;
  let ours = "origin/develop";
  let theirs = "weblate/develop";
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--ours" && argv[i + 1]) {
      ours = argv[++i];
    } else if (arg === "--theirs" && argv[i + 1]) {
      theirs = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, dryRun, ours, theirs, files };
    } else if (!arg.startsWith("--")) {
      files.push(arg.replace(/\\/g, "/"));
    }
  }
  return { help: false, dryRun, ours, theirs, files };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/overlay-weblate-locales.mjs [--dry-run] [--ours REF] [--theirs REF] [paths...]",
    );
    process.exit(0);
  }

  const targets = args.files.length > 0 ? args.files : listDefaultTargets(args.ours, args.theirs);
  if (targets.length === 0) {
    console.log("No locale files to overlay.");
    return;
  }

  console.log(`Overlay ${targets.length} file(s): base=${args.ours}, weblate=${args.theirs}${args.dryRun ? " (dry-run)" : ""}`);

  for (const localeRelPath of targets) {
    const stats = overlayLocaleFile(localeRelPath, {
      ours: args.ours,
      theirs: args.theirs,
      dryRun: args.dryRun,
    });
    const gap = stats.sourceLeafCount - stats.leafCount;
    console.log(
      `[${stats.langCode}] ${path.basename(localeRelPath)}: ` +
        `leaves ${stats.leafCount}/${stats.sourceLeafCount}` +
        (gap ? ` (missing ${gap})` : "") +
        `, weblate ${stats.weblateWins}, develop ${stats.developKept}, wb-fallback ${stats.weblateFallback}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
