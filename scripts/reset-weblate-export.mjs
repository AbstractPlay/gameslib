#!/usr/bin/env node
/**
 * After locale changes are on origin/develop, reset GitHub l10n/weblate to match.
 * Hosted Weblate's git URL is read-only — use the Weblate UI / wlc to pull upstream.
 *
 *   npm run reset-weblate-export
 *   npm run reset-weblate-export -- --dry-run
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEBLATE_BRANCH_CONFIG } from "./check-weblate-branch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run"), help: argv.includes("--help") || argv.includes("-h") };
}

function main() {
  const { dryRun, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log("Usage: npm run reset-weblate-export [-- --dry-run]");
    process.exit(0);
  }

  const { remote, baseBranch, weblateBranch } = WEBLATE_BRANCH_CONFIG;
  const developRef = `${remote}/${baseBranch}`;

  runGit(["fetch", remote, baseBranch, weblateBranch], { allowFail: true });
  if (!runGit(["rev-parse", developRef], { allowFail: true }).stdout?.trim()) {
    throw new Error(`Missing ${developRef}. Fetch origin and push develop first.`);
  }

  const label = `GitHub ${remote}/${weblateBranch}`;
  const pushArgs = [
    "push",
    "--force-with-lease",
    remote,
    `${developRef}:refs/heads/${weblateBranch}`,
  ];

  console.log(`${dryRun ? "[dry-run] " : ""}${label} ← ${developRef}`);
  if (!dryRun) {
    runGit(pushArgs, { inherit: true });
  }

  console.log("");
  console.log("GitHub branch updated. Hosted Weblate does not accept git push (read-only exporter).");
  console.log("Next in Weblate (per component): lock → Repository → Update / Pull → unlock.");
  console.log("If merge errors persist: Operations → Repository maintenance → Reset (admin), then pull again.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
