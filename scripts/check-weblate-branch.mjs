#!/usr/bin/env node
/* eslint-env node */
/**
 * Review origin/l10n/weblate before merging into develop:
 * - fetch remote branch
 * - fail if non-locale files changed
 * - report merge conflicts vs develop
 * - classify locale diffs as substantive vs formatting-only (JSON reorder/indent)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** @typedef {{
 *   baseBranch: string;
 *   weblateBranch: string;
 *   remote: string;
 *   localePathRe: RegExp;
 *   englishPathRe: RegExp;
 *   repoLabel: string;
 *   localeImportPath: string;
 * }} WeblateBranchConfig */

/** @type {WeblateBranchConfig} */
export const WEBLATE_BRANCH_CONFIG = {
  baseBranch: "develop",
  weblateBranch: "l10n/weblate",
  remote: "origin",
  localePathRe: /^locales\/[^/]+\/[^/]+\.json$/,
  englishPathRe: /^locales\/en\//,
  repoLabel: "gameslib",
  localeImportPath: "locales",
};

/**
 * @param {Record<string, unknown>} obj
 * @param {string} [prefix]
 * @param {Map<string, string>} [out]
 */
export function flattenLocaleLeaves(obj, prefix = "", out = new Map()) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === "_src" || key.startsWith("_src_")) {
      continue;
    }
    const leafPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(leafPath, value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenLocaleLeaves(value, leafPath, out);
    }
  }
  return out;
}

/**
 * @param {string} baseText
 * @param {string} headText
 */
export function analyzeLocaleDiff(baseText, headText) {
  const base = JSON.parse(baseText);
  const head = JSON.parse(headText);
  const baseFlat = flattenLocaleLeaves(base);
  const headFlat = flattenLocaleLeaves(head);

  /** @type {string[]} */
  const keysAdded = [];
  /** @type {string[]} */
  const keysRemoved = [];
  /** @type {{ key: string; from: string; to: string }[]} */
  const valueChanges = [];

  for (const key of baseFlat.keys()) {
    if (!headFlat.has(key)) {
      keysRemoved.push(key);
    } else if (baseFlat.get(key) !== headFlat.get(key)) {
      valueChanges.push({
        key,
        from: baseFlat.get(key),
        to: headFlat.get(key),
      });
    }
  }
  for (const key of headFlat.keys()) {
    if (!baseFlat.has(key)) {
      keysAdded.push(key);
    }
  }

  const formattingOnly =
    keysAdded.length === 0 &&
    keysRemoved.length === 0 &&
    valueChanges.length === 0;

  return { keysAdded, keysRemoved, valueChanges, formattingOnly };
}

/**
 * @param {string} filePath
 * @param {RegExp} localePathRe
 */
export function isLocalePath(filePath, localePathRe) {
  return localePathRe.test(filePath.replace(/\\/g, "/"));
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ allowFail?: boolean }} [opts]
 */
function runGit(cwd, args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !opts.allowFail) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

/**
 * @param {string} cwd
 * @param {string} ref
 */
function refExists(cwd, ref) {
  return (
    runGit(cwd, ["rev-parse", "--verify", ref], { allowFail: true }).status === 0
  );
}

/**
 * @param {string} cwd
 * @param {string} ref
 */
function readFileAtRef(cwd, ref, filePath) {
  const result = runGit(cwd, ["show", `${ref}:${filePath}`], {
    allowFail: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

/**
 * @param {string} cwd
 * @param {string} baseRef
 * @param {string} weblateRef
 */
function listChangedFiles(cwd, baseRef, weblateRef) {
  const result = runGit(cwd, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    `${baseRef}...${weblateRef}`,
  ]);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string} cwd
 * @param {string} baseRef
 * @param {string} weblateRef
 */
function detectMergeConflicts(cwd, baseRef, weblateRef) {
  const mergeBase = runGit(cwd, ["merge-base", baseRef, weblateRef])
    .stdout.trim();
  const result = runGit(
    cwd,
    ["merge-tree", mergeBase, baseRef, weblateRef],
    { allowFail: true },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const conflicts = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/Merge conflict in (.+)$/);
    if (match) {
      conflicts.add(match[1].trim());
    }
  }
  return [...conflicts];
}

/**
 * @param {typeof WEBLATE_BRANCH_CONFIG} config
 * @param {{ fetch?: boolean; json?: boolean }} [opts]
 */
export function reviewWeblateBranch(config, opts = {}) {
  const shouldFetch = opts.fetch !== false;
  const baseRef = `${config.remote}/${config.baseBranch}`;
  const weblateRef = `${config.remote}/${config.weblateBranch}`;

  if (shouldFetch) {
    runGit(ROOT, ["fetch", config.remote, config.baseBranch, config.weblateBranch], {
      allowFail: true,
    });
  }

  if (!refExists(ROOT, weblateRef)) {
    return {
      ok: false,
      blocked: true,
      baseRef,
      weblateRef,
      cosmeticOnly: false,
      noChanges: false,
      substantive: false,
      errors: [
        `Remote branch ${weblateRef} does not exist. Push from Weblate first.`,
      ],
      warnings: [],
      files: [],
      conflicts: [],
      localeConflicts: [],
      nonLocaleConflicts: [],
      fileReports: [],
      summary: { valueChanges: 0, keysAdded: 0, keysRemoved: 0, formattingOnlyFiles: 0, changedLocaleFiles: 0 },
      verdict: "blocked",
    };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  const changedFiles = listChangedFiles(ROOT, baseRef, weblateRef);
  const nonLocaleFiles = changedFiles.filter(
    (file) => !isLocalePath(file, config.localePathRe),
  );
  if (nonLocaleFiles.length > 0) {
    errors.push(
      `Non-locale files changed (${nonLocaleFiles.length}): ${nonLocaleFiles.join(", ")}`,
    );
  }

  const englishFiles = changedFiles.filter((file) =>
    config.englishPathRe.test(file.replace(/\\/g, "/")),
  );
  if (englishFiles.length > 0) {
    errors.push(
      `English locale files must not change on Weblate branch: ${englishFiles.join(", ")}`,
    );
  }

  const conflicts = detectMergeConflicts(ROOT, baseRef, weblateRef);
  const localeConflicts = conflicts.filter((file) =>
    isLocalePath(file, config.localePathRe),
  );
  const nonLocaleConflicts = conflicts.filter(
    (file) => !isLocalePath(file, config.localePathRe),
  );
  if (conflicts.length > 0) {
    errors.push(
      `Merge conflicts vs ${baseRef} (${conflicts.length}): ${conflicts.join(", ")}`,
    );
  }

  /** @type {Array<{
   *   file: string;
   *   status: "added" | "removed" | "modified" | "unchanged";
   *   keysAdded: string[];
   *   keysRemoved: string[];
   *   valueChanges: { key: string; from: string; to: string }[];
   *   formattingOnly: boolean;
   * }>} */
  const fileReports = [];

  let valueChanges = 0;
  let keysAdded = 0;
  let keysRemoved = 0;
  let formattingOnlyFiles = 0;

  for (const file of changedFiles.filter((f) => isLocalePath(f, config.localePathRe))) {
    const baseText = readFileAtRef(ROOT, baseRef, file);
    const headText = readFileAtRef(ROOT, weblateRef, file);

    if (headText === null && baseText !== null) {
      fileReports.push({
        file,
        status: "removed",
        keysAdded: [],
        keysRemoved: [],
        valueChanges: [],
        formattingOnly: false,
      });
      warnings.push(`Locale file removed on Weblate branch: ${file}`);
      continue;
    }
    if (headText !== null && baseText === null) {
      const parsed = analyzeLocaleDiff("{}", headText);
      fileReports.push({
        file,
        status: "added",
        keysAdded: parsed.keysAdded,
        keysRemoved: parsed.keysRemoved,
        valueChanges: parsed.valueChanges,
        formattingOnly: false,
      });
      keysAdded += parsed.keysAdded.length;
      valueChanges += parsed.valueChanges.length;
      continue;
    }
    if (headText === null || baseText === null) {
      continue;
    }

    let parsed;
    try {
      parsed = analyzeLocaleDiff(baseText, headText);
    } catch (error) {
      errors.push(`Invalid JSON in ${file}: ${error.message}`);
      continue;
    }

    fileReports.push({
      file,
      status: "modified",
      keysAdded: parsed.keysAdded,
      keysRemoved: parsed.keysRemoved,
      valueChanges: parsed.valueChanges,
      formattingOnly: parsed.formattingOnly,
    });

    keysAdded += parsed.keysAdded.length;
    keysRemoved += parsed.keysRemoved.length;
    valueChanges += parsed.valueChanges.length;
    if (parsed.formattingOnly) {
      formattingOnlyFiles += 1;
    }
  }

  const substantive =
    valueChanges > 0 || keysAdded > 0 || keysRemoved > 0;
  const ok = errors.length === 0;
  const cosmeticOnly =
    ok && changedFiles.length > 0 && !substantive && formattingOnlyFiles > 0;
  const noChanges = ok && changedFiles.length === 0;

  return {
    ok,
    blocked: !ok,
    cosmeticOnly,
    noChanges,
    substantive,
    errors,
    warnings,
    files: changedFiles,
    conflicts,
    localeConflicts,
    nonLocaleConflicts,
    fileReports,
    baseRef,
    weblateRef,
    summary: {
      valueChanges,
      keysAdded,
      keysRemoved,
      formattingOnlyFiles,
      changedLocaleFiles: fileReports.length,
    },
    verdict: !ok
      ? "blocked"
      : noChanges
        ? "no_changes"
        : cosmeticOnly
          ? "formatting_only"
          : substantive
            ? "substantive"
            : "ok",
  };
}

export function printReport(result, config) {
  const line = (text = "") => console.log(text);
  line(`=== Weblate branch review (${config.repoLabel}) ===`);
  line(`Base:    ${result.baseRef}`);
  line(`Weblate: ${result.weblateRef}`);
  line("");

  if (!result.ok && result.files.length === 0 && result.fileReports.length === 0) {
    if (result.errors.length > 0) {
      line("Errors:");
      for (const error of result.errors) {
        line(`  - ${error}`);
      }
      line("");
    }
    line(`VERDICT: ${result.verdict}`);
    return;
  }

  if (result.noChanges) {
    line("No file changes between base and Weblate branch.");
    line("VERDICT: no_changes");
    return;
  }

  line(`Changed files: ${result.files.length}`);
  for (const file of result.files) {
    const tag = isLocalePath(file, config.localePathRe) ? "locale" : "NON-LOCALE";
    line(`  - [${tag}] ${file}`);
  }
  line("");

  if (result.conflicts.length > 0) {
    line(`Merge conflicts: ${result.conflicts.length}`);
    for (const file of result.conflicts) {
      line(`  - ${file}`);
    }
    line("");
  } else {
    line("Merge conflicts: none");
    line("");
  }

  for (const report of result.fileReports) {
    if (report.status === "added") {
      line(
        `${report.file}: new file (${report.keysAdded.length} keys, ${report.valueChanges.length} values)`,
      );
      continue;
    }
    if (report.status === "removed") {
      line(`${report.file}: removed`);
      continue;
    }
    if (report.formattingOnly) {
      line(`${report.file}: formatting only (same translation values)`);
      continue;
    }
    line(
      `${report.file}: +${report.keysAdded.length} keys, -${report.keysRemoved.length} keys, ${report.valueChanges.length} value changes`,
    );
    if (report.valueChanges.length > 0 && report.valueChanges.length <= 5) {
      for (const change of report.valueChanges) {
        line(`    ~ ${change.key}`);
      }
    }
  }

  if (result.warnings.length > 0) {
    line("");
    line("Warnings:");
    for (const warning of result.warnings) {
      line(`  - ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    line("");
    line("Errors:");
    for (const error of result.errors) {
      line(`  - ${error}`);
    }
  }

  line("");
  line(`Summary: ${result.summary.valueChanges} value changes, ${result.summary.keysAdded} keys added, ${result.summary.keysRemoved} keys removed, ${result.summary.formattingOnlyFiles} formatting-only file(s)`);
  line(`VERDICT: ${result.verdict}`);
}

function parseArgs(argv) {
  return {
    fetch: !argv.includes("--no-fetch"),
    json: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: npm run check-weblate-branch [-- --no-fetch] [--json]

Fetches ${WEBLATE_BRANCH_CONFIG.remote}/${WEBLATE_BRANCH_CONFIG.weblateBranch}, compares to
${WEBLATE_BRANCH_CONFIG.remote}/${WEBLATE_BRANCH_CONFIG.baseBranch}, and reports whether the branch is safe to merge.

To import and push interactively, run: npm run merge-weblate-branch

Exit codes:
  0  checks passed (substantive or formatting-only changes; no blockers)
  1  blocked (missing branch, non-locale files, English edits, conflicts, invalid JSON)
`);
    process.exit(0);
  }

  const result = reviewWeblateBranch(WEBLATE_BRANCH_CONFIG, {
    fetch: args.fetch,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result, WEBLATE_BRANCH_CONFIG);
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
