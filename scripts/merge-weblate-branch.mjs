#!/usr/bin/env node
/* eslint-env node */
/**
 * Interactive workflow: review, import locales from l10n/weblate, commit, push, reset branch.
 *
 * Usage:
 *   npm run merge-weblate-branch
 *   npm run merge-weblate-branch -- --from review
 *   npm run merge-weblate-branch -- --from push --no-fetch
 */
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEBLATE_BRANCH_CONFIG,
  printReport,
  reviewWeblateBranch,
} from "./check-weblate-branch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** @type {const} */
const STEPS = [
  "fetch",
  "review",
  "prepare",
  "import",
  "commit",
  "push",
  "reset-branch",
  "verify",
];

const STEP_LABELS = {
  fetch: "Fetch origin/develop and origin/l10n/weblate",
  review: "Review Weblate branch (locale-only, conflicts, substance)",
  prepare: "Checkout develop and pull latest",
  import: "Import locale files only from l10n/weblate",
  commit: "Commit imported locales on develop",
  push: "Push develop to origin",
  "reset-branch": "Force-update origin/l10n/weblate to match develop",
  verify: "Re-run review (expect no_changes)",
};

/**
 * @param {string[]} args
 * @param {{ inherit?: boolean; allowFail?: boolean }} [opts]
 */
function runGit(args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !opts.allowFail) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function line(text = "") {
  console.log(text);
}

function printBanner() {
  const { repoLabel, remote, baseBranch, weblateBranch, localeImportPath } =
    WEBLATE_BRANCH_CONFIG;
  line();
  line(`=== Weblate merge workflow (${repoLabel}) ===`);
  line(`Base:    ${remote}/${baseBranch}`);
  line(`Weblate: ${remote}/${weblateBranch}`);
  line(`Import:  ${localeImportPath}/`);
  line(`ci-deps.dev.json is kept from ${baseBranch} via .gitattributes (merge=ours).`);
  line();
  line("Steps:");
  for (const step of STEPS) {
    line(`  ${step.padEnd(14)} ${STEP_LABELS[step]}`);
  }
  line();
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} step
 */
async function promptStepAction(rl, step) {
  const answer = await rl.question(
    `[${step}] Continue? [c]ontinue / [a]bort / [s]kip to step / [?]help: `,
  );
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "a" || trimmed === "abort") {
    line("Aborted.");
    process.exit(0);
  }
  if (trimmed === "?" || trimmed === "help") {
    line("Steps: " + STEPS.join(", "));
    return promptStepAction(rl, step);
  }
  if (trimmed === "s" || trimmed.startsWith("skip")) {
    const target = await rl.question(`Skip to step (${STEPS.join(", ")}): `);
    const normalized = target.trim().toLowerCase();
    if (!STEPS.includes(normalized)) {
      line(`Unknown step "${target}".`);
      return promptStepAction(rl, step);
    }
    return { action: "jump", target: normalized };
  }
  return { action: "continue" };
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} message
 */
async function confirm(rl, message) {
  const answer = await rl.question(`${message} [y/N]: `);
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

function workingTreeDirty() {
  const result = runGit(["status", "--porcelain"], { allowFail: true });
  return Boolean(result.stdout?.trim());
}

function stepFetch() {
  const { remote, baseBranch, weblateBranch } = WEBLATE_BRANCH_CONFIG;
  line(`Fetching ${remote} ${baseBranch} ${weblateBranch}...`);
  runGit(["fetch", remote, baseBranch, weblateBranch], { inherit: true });
}

/**
 * @param {boolean} doFetch
 */
function stepReview(doFetch) {
  const result = reviewWeblateBranch(WEBLATE_BRANCH_CONFIG, { fetch: doFetch });
  printReport(result, WEBLATE_BRANCH_CONFIG);
  return result;
}

function stepPrepare() {
  const { baseBranch } = WEBLATE_BRANCH_CONFIG;
  if (workingTreeDirty()) {
    throw new Error(
      "Working tree has uncommitted changes. Commit, stash, or clean before prepare.",
    );
  }
  line(`Checking out ${baseBranch}...`);
  runGit(["checkout", baseBranch], { inherit: true });
  line(`Pulling origin ${baseBranch}...`);
  runGit(["pull", "origin", baseBranch], { inherit: true });
}

function stepImport() {
  const { remote, weblateBranch, localeImportPath } = WEBLATE_BRANCH_CONFIG;
  const ref = `${remote}/${weblateBranch}`;
  line(`Importing ${localeImportPath}/ from ${ref}...`);
  runGit(["checkout", ref, "--", localeImportPath], { inherit: true });
  runGit(["status", "--short", localeImportPath], { inherit: true });
}

/**
 * @param {import("node:readline/promises").Interface} rl
 */
async function stepCommit(rl) {
  const { localeImportPath } = WEBLATE_BRANCH_CONFIG;
  const status = runGit(["status", "--porcelain", localeImportPath]);
  if (!status.stdout?.trim()) {
    line("Nothing staged to commit under locale path. Skipping commit.");
    return false;
  }
  runGit(["diff", "--cached", "--stat", localeImportPath], { inherit: true });
  const defaultMessage = "Import Weblate translations from l10n/weblate";
  const custom = await rl.question(
    `Commit message [${defaultMessage}]: `,
  );
  const message = custom.trim() || defaultMessage;
  runGit(["commit", "-m", message], { inherit: true });
  return true;
}

function stepPush() {
  const { remote, baseBranch } = WEBLATE_BRANCH_CONFIG;
  line(`Pushing ${baseBranch} to ${remote}...`);
  runGit(["push", remote, baseBranch], { inherit: true });
}

function stepResetBranch() {
  const { remote, baseBranch, weblateBranch } = WEBLATE_BRANCH_CONFIG;
  const developRef = `${remote}/${baseBranch}`;
  line(
    `Force-updating ${remote}/${weblateBranch} to ${developRef} (--force-with-lease)...`,
  );
  line(
    "(Locale import creates a new commit on develop; l10n/weblate history diverges until reset.)",
  );
  runGit(
    [
      "push",
      "--force-with-lease",
      remote,
      `${developRef}:refs/heads/${weblateBranch}`,
    ],
    { inherit: true },
  );
}

function parseArgs(argv) {
  let fromStep = "fetch";
  let fetchOnReview = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from" && argv[i + 1]) {
      fromStep = argv[i + 1].toLowerCase();
      i += 1;
    } else if (arg === "--no-fetch") {
      fetchOnReview = false;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, fromStep, fetchOnReview };
    }
  }
  if (!STEPS.includes(fromStep)) {
    throw new Error(`Unknown step "${fromStep}". Use: ${STEPS.join(", ")}`);
  }
  return { help: false, fromStep, fetchOnReview };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    line(`Usage: npm run merge-weblate-branch [-- --from <step>] [--no-fetch]`);
    line("");
    line("Steps: " + STEPS.join(" → "));
    line("");
    line("Examples:");
    line("  npm run merge-weblate-branch");
    line("  npm run merge-weblate-branch -- --from review --no-fetch");
    line("  npm run merge-weblate-branch -- --from push");
    process.exit(0);
  }

  printBanner();

  const rl = readline.createInterface({ input, output });
  let startIndex = STEPS.indexOf(args.fromStep);
  if (startIndex > 0) {
    line(`Starting at step: ${args.fromStep}`);
    const ok = await confirm(
      rl,
      `Skip earlier steps and begin at "${args.fromStep}"?`,
    );
    if (!ok) {
      startIndex = 0;
    }
  }

  let fetched = false;

  try {
    for (let i = startIndex; i < STEPS.length; i += 1) {
      const step = STEPS[i];
      line("");
      line(`--- ${step}: ${STEP_LABELS[step]} ---`);

      const decision = await promptStepAction(rl, step);
      if (decision.action === "jump") {
        const jumpIndex = STEPS.indexOf(decision.target);
        if (jumpIndex < 0) {
          throw new Error(`Invalid jump target: ${decision.target}`);
        }
        i = jumpIndex - 1;
        continue;
      }

      switch (step) {
        case "fetch":
          stepFetch();
          fetched = true;
          break;
        case "review": {
          const doFetch = args.fetchOnReview && !fetched;
          const lastReview = stepReview(doFetch);
          if (lastReview.ok === false && lastReview.blocked) {
            const force = await confirm(
              rl,
              "Review reported blocked. Continue anyway?",
            );
            if (!force) {
              line("Aborted after review.");
              process.exit(1);
            }
          } else if (lastReview.verdict === "formatting_only") {
            const proceed = await confirm(
              rl,
              "Only formatting changes detected. Import anyway?",
            );
            if (!proceed) {
              line("Aborted (formatting-only).");
              process.exit(0);
            }
          } else if (lastReview.verdict === "no_changes") {
            const proceed = await confirm(
              rl,
              "No changes between branches. Continue anyway?",
            );
            if (!proceed) {
              line("Nothing to merge.");
              process.exit(0);
            }
          }
          break;
        }
        case "prepare":
          stepPrepare();
          break;
        case "import":
          stepImport();
          break;
        case "commit":
          await stepCommit(rl);
          break;
        case "push":
          stepPush();
          break;
        case "reset-branch":
          stepResetBranch();
          break;
        case "verify": {
          stepFetch();
          const verify = stepReview(false);
          if (!verify.ok) {
            line("");
            line("Verify failed. Check errors above.");
            process.exit(1);
          }
          if (verify.verdict === "no_changes") {
            line("");
            line("Done. develop and l10n/weblate are in sync.");
          } else {
            line("");
            line(
              `Verify finished with verdict "${verify.verdict}" (may be new edits since reset).`,
            );
          }
          break;
        }
        default:
          throw new Error(`Unhandled step: ${step}`);
      }
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
