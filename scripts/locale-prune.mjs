#!/usr/bin/env node
/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const MANAGED_LANGS = ["de", "fr", "it", "es-US"];

function isTrackingKey(key) {
  return key === "_src" || key.startsWith("_src_");
}

export function collectLeaves(obj, prefix = "") {
  const leaves = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return leaves;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (isTrackingKey(key)) continue;
    const leafPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      leaves[leafPath] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(leaves, collectLeaves(value, leafPath));
    }
  }
  return leaves;
}

export function pruneToSourceShape(source, target) {
  if (typeof source === "string") {
    return typeof target === "string" ? target : undefined;
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }

  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (isTrackingKey(key)) continue;
    if (!target || typeof target !== "object" || target[key] === undefined) {
      continue;
    }
    const pruned = pruneToSourceShape(value, target[key]);
    if (pruned !== undefined) {
      result[key] = pruned;
    }
  }
  return result;
}

export function pruneSrcTracking(srcTracking, sourceLeaves) {
  const pruned = {};
  for (const leafPath of Object.keys(sourceLeaves)) {
    if (srcTracking[leafPath] !== undefined) {
      pruned[leafPath] = srcTracking[leafPath];
    }
  }
  return pruned;
}

export function pruneManagedLocale({ sourceData, targetData, srcTracking }) {
  const sourceLeaves = collectLeaves(sourceData);
  const targetLeaves = collectLeaves(targetData);
  const prunedTarget = pruneToSourceShape(sourceData, targetData) ?? {};
  const prunedTracking = pruneSrcTracking(srcTracking, sourceLeaves);

  const removedLeaves = Object.keys(targetLeaves).filter((leafPath) => !(leafPath in sourceLeaves)).length;
  const removedTracking = Object.keys(srcTracking).filter((leafPath) => !(leafPath in prunedTracking)).length;

  return {
    targetData: prunedTarget,
    srcTracking: prunedTracking,
    removedLeaves,
    removedTracking,
    changed: removedLeaves > 0 || removedTracking > 0,
  };
}

function localeRoots(sourcePath) {
  const abs = path.resolve(sourcePath);
  const localesDir = path.dirname(path.dirname(abs));
  const parent = path.dirname(localesDir);
  const repoRoot = path.basename(parent) === "public" ? path.dirname(parent) : parent;
  return { localesDir, repoRoot };
}

function srcPathFor(repoRoot, langCode, fileName) {
  return path.join(repoRoot, "locale-src", langCode, fileName);
}

function getEmbeddedSrcTracking(targetData) {
  if (targetData._src && typeof targetData._src === "object") {
    return { ...targetData._src };
  }
  const legacy = {};
  for (const [key, value] of Object.entries(targetData)) {
    if (key.startsWith("_src_") && typeof value === "string") {
      legacy[key.slice(5)] = value;
    }
  }
  return legacy;
}

function loadSrcTracking(repoRoot, langCode, fileName, targetData) {
  const srcPath = srcPathFor(repoRoot, langCode, fileName);
  if (fs.existsSync(srcPath)) {
    try {
      return JSON.parse(fs.readFileSync(srcPath, "utf-8"));
    } catch (error) {
      console.error(`[${langCode}] ${fileName}: Invalid locale-src JSON, using embedded fallback: ${error.message}`);
    }
  }
  return getEmbeddedSrcTracking(targetData);
}

function writeSrcTracking(repoRoot, langCode, fileName, srcTracking) {
  const srcPath = srcPathFor(repoRoot, langCode, fileName);
  const sortedSrc = {};
  for (const key of Object.keys(srcTracking).sort()) {
    sortedSrc[key] = srcTracking[key];
  }
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, JSON.stringify(sortedSrc, null, 2) + "\n");
}

function writeTargetFile(targetPath, repoRoot, langCode, fileName, sourceData, targetData, srcTracking) {
  const cleanTargetData = pruneToSourceShape(sourceData, targetData) ?? {};
  fs.writeFileSync(targetPath, JSON.stringify(cleanTargetData, null, 2) + "\n");
  writeSrcTracking(repoRoot, langCode, fileName, srcTracking);
}

export function pruneManagedLocaleFile(sourcePath, langCode, { dryRun = false } = {}) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`);
  }

  const sourceData = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  const { localesDir, repoRoot } = localeRoots(sourcePath);
  const fileName = path.basename(sourcePath);
  const targetPath = path.join(localesDir, langCode, fileName);

  let targetData = {};
  if (fs.existsSync(targetPath)) {
    targetData = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
  }

  const srcTracking = loadSrcTracking(repoRoot, langCode, fileName, targetData);
  const result = pruneManagedLocale({ sourceData, targetData, srcTracking });

  if (result.changed && !dryRun) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    writeTargetFile(targetPath, repoRoot, langCode, fileName, sourceData, result.targetData, result.srcTracking);
  }

  return {
    langCode,
    fileName,
    targetPath,
    ...result,
  };
}

function summarizeRemoved(result) {
  const parts = [];
  if (result.removedLeaves > 0) {
    parts.push(`${result.removedLeaves} translation leaf${result.removedLeaves === 1 ? "" : "ves"}`);
  }
  if (result.removedTracking > 0) {
    parts.push(`${result.removedTracking} locale-src entr${result.removedTracking === 1 ? "y" : "ies"}`);
  }
  return parts.join(", ");
}

function runCli() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const files = args.filter((arg) => !arg.startsWith("--"));

  if (files.length === 0) {
    console.error("Usage: node scripts/locale-prune.mjs [--dry-run] <locales/en/file.json> [...]");
    process.exit(1);
  }

  let changedCount = 0;

  for (const file of files) {
    for (const langCode of MANAGED_LANGS) {
      const result = pruneManagedLocaleFile(file, langCode, { dryRun });
      if (!result.changed) {
        console.log(`[${langCode}] ${result.fileName}: No stale keys.`);
        continue;
      }

      changedCount++;
      const action = dryRun ? "Would prune" : "Pruned";
      console.log(`[${langCode}] ${result.fileName}: ${action} ${summarizeRemoved(result)}.`);
    }
  }

  if (dryRun && changedCount === 0) {
    console.log("No stale keys found.");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli();
}
