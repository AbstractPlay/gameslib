#!/usr/bin/env node
/**
 * Register Git's `merge.ours` driver in this clone so `.gitattributes` merge=ours
 * keeps package pins on the branch you merge into (main vs develop).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GITCONFIG_FRAGMENT = path.join(ROOT, "config", "git-merge-ours.gitconfig");
const INCLUDE_KEY = "include.path";
const FRAGMENT_REL = "../config/git-merge-ours.gitconfig";

function runGit(args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFail) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function getMergedConfig(key) {
  const result = runGit(["config", "--get", key], { allowFail: true });
  if (result.status !== 0) {
    return undefined;
  }
  return (result.stdout ?? "").trim();
}

function listLocalIncludes() {
  const result = runGit(
    ["config", "--local", "--get-all", INCLUDE_KEY],
    { allowFail: true },
  );
  if (result.status !== 0) {
    return [];
  }
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    console.error("setup-git-merge-ours: not a git repository (no .git directory).");
    process.exit(1);
  }
  if (!fs.existsSync(GITCONFIG_FRAGMENT)) {
    console.error(`setup-git-merge-ours: missing ${GITCONFIG_FRAGMENT}`);
    process.exit(1);
  }

  const includes = listLocalIncludes();
  const normalizedTarget = path.normalize(FRAGMENT_REL);
  const alreadyIncluded = includes.some(
    (entry) => path.normalize(entry) === normalizedTarget,
  );

  if (!alreadyIncluded) {
    runGit(["config", "--local", "--add", INCLUDE_KEY, FRAGMENT_REL]);
    console.log(
      "setup-git-merge-ours: registered config/git-merge-ours.gitconfig (merge.ours driver).",
    );
  }

  const driver = getMergedConfig("merge.ours.driver");
  if (driver !== "true") {
    console.error(
      "setup-git-merge-ours: include added but merge.ours.driver is not true — check .git/config.",
    );
    process.exit(1);
  }

  if (alreadyIncluded) {
    console.log("setup-git-merge-ours: merge.ours driver already configured for this clone.");
  } else {
    console.log(
      "Cross-branch merges now keep this branch's ci-deps.*.json, package.json, and package-lock.json.",
    );
    console.log(
      "GitHub PR merges do not run local merge drivers — merge main/develop locally or keep the base branch copy of those files.",
    );
  }
}

main();
