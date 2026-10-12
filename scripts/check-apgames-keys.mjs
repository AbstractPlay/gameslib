#!/usr/bin/env node
/**
 * apgames key coverage (Phase 2): duplicate English vs shared shards, optional strict missing refs.
 *
 *   node scripts/check-apgames-keys.mjs --warn [--summary] [--uid foo]
 *   node scripts/check-apgames-keys.mjs --strict [--summary] [--uid <uid>]
 *   node scripts/check-apgames-keys.mjs --warn --strict --summary   # lint (Phase 6)
 */
import {
    getGameinfoPointerViolations,
    getMergeCollisions,
    mergeApgamesEnSources,
} from "./lib/apgames-en-merge.mjs";
import { findDuplicateEnWarnings } from "./lib/apgames-duplicate-en.mjs";
import {
    findMissingApgamesReferences,
    findOrphanApgamesLeaves,
} from "./lib/check-apgames-refs.mjs";

const argv = process.argv.slice(2);
const warnMode = argv.includes("--warn");
const strict = argv.includes("--strict");
const summary = argv.includes("--summary") || (!argv.includes("--verbose") && warnMode);
const uidIdx = argv.indexOf("--uid");
const uidFilter = uidIdx >= 0 ? argv[uidIdx + 1] : undefined;

if (!warnMode && !strict) {
    console.error("Usage: node scripts/check-apgames-keys.mjs --warn | --strict [--summary] [--uid <uid>]");
    process.exit(2);
}

const merged = mergeApgamesEnSources();
const mergeCollisions = getMergeCollisions();
let exitCode = 0;

const pointerViolations = getGameinfoPointerViolations();
for (const v of pointerViolations) {
    console.error(
        `gameinfo-pointer: ${v.uid} still uses apgames:${v.field} pointer in ${v.filePath} (forbidden when gameApgamesEn is exported)`,
    );
    exitCode = 1;
}

if (warnMode && mergeCollisions.length > 0) {
    if (summary) {
        console.error(`check-apgames-keys: ${mergeCollisions.length} merge collision(s) with differing English (use --verbose)`);
        for (const c of mergeCollisions.slice(0, 5)) {
            console.error(`  merge-collision: ${c.leafPath} (${c.prior} → ${c.next})`);
        }
        if (mergeCollisions.length > 5) {
            console.error(`  … and ${mergeCollisions.length - 5} more`);
        }
    } else {
        for (const c of mergeCollisions) {
            console.error(`WARN: merge-collision: ${c.leafPath} was ${c.prior}, overwritten by ${c.next}`);
        }
    }
}

const duplicateWarnings = findDuplicateEnWarnings(merged, { uidFilter });
if (duplicateWarnings.length > 0) {
    if (summary) {
        console.error(`check-apgames-keys: ${duplicateWarnings.length} duplicate-en warning(s) (use --verbose for lines)`);
        for (const line of duplicateWarnings.slice(0, 5)) {
            console.error(`  ${line}`);
        }
        if (duplicateWarnings.length > 5) {
            console.error(`  … and ${duplicateWarnings.length - 5} more`);
        }
    } else {
        for (const line of duplicateWarnings) {
            console.error(`WARN: ${line}`);
        }
    }
}

let missing = [];
let orphans = [];
if (strict) {
    const strictOpts = { uidFilter };
    missing = findMissingApgamesReferences(merged, strictOpts);
    orphans = findOrphanApgamesLeaves(merged, strictOpts);
    for (const line of [...missing, ...orphans]) {
        console.error(`ERROR: ${line}`);
    }
    if (missing.length > 0 || orphans.length > 0) {
        exitCode = 1;
    } else if (summary && !uidFilter) {
        console.log("check-apgames-keys: strict full-registry OK (0 missing, 0 orphans)");
    }
}

if (exitCode === 0) {
    const parts = [];
    if (strict && uidFilter) {
        parts.push(`strict uid ${uidFilter} OK`);
    }
    if (duplicateWarnings.length > 0) {
        parts.push(`${duplicateWarnings.length} duplicate-en warning(s)`);
    }
    if (parts.length === 0 && !(strict && !uidFilter && summary)) {
        console.log("check-apgames-keys: OK");
    } else if (parts.length > 0) {
        console.log(`check-apgames-keys: OK (${parts.join("; ")})`);
    }
}

process.exit(exitCode);
