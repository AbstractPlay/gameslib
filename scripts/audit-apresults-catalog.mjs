#!/usr/bin/env node
/**
 * Phase 0 — apresults catalog inventory: path map, TS refs, duplicate English, collisions.
 *
 *   node scripts/audit-apresults-catalog.mjs
 *   node scripts/audit-apresults-catalog.mjs --write-map
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectLeaves } from "./locale-prune.mjs";
import {
    MERGED_EN_ARESULTS,
    PATH_MAP_JSON,
} from "./lib/apresults-en-paths.mjs";
import { mergedApresultsUsesNestedShape } from "./lib/apresults-en-paths.mjs";
import {
    buildPathMapFromCatalog,
    expandTsRefToCatalogPaths,
    findDuplicateEnglish,
    flatCatalogLeavesFromCommittedMap,
    GENERAL_NESTED_TYPES,
    pathMapEntriesAlignedWithNested,
    writeCommittedApresultsPathMap,
} from "./lib/apresults-path-map.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const writeMap = process.argv.includes("--write-map");
const writeGaps = process.argv.includes("--write-gaps");
const GAPS_JSON = path.join(repoRoot, "locale-src/en/apresults/apresults-ts-catalog-gaps.json");

const APRESULTS_REF = /apresults:[A-Za-z0-9_.]+/g;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkTsFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            out.push(...walkTsFiles(full));
        } else if (name.endsWith(".ts")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * @param {string[]} files
 */
function collectTsApresultsRefs(files) {
    /** @type {Map<string, string[]>} */
    const refToFiles = new Map();
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const matches = text.match(APRESULTS_REF) ?? [];
        for (const ref of matches) {
            if (!refToFiles.has(ref)) {
                refToFiles.set(ref, []);
            }
            const list = refToFiles.get(ref);
            const rel = path.relative(repoRoot, file);
            if (!list.includes(rel)) {
                list.push(rel);
            }
        }
    }
    return refToFiles;
}

function summarizeUidBuckets(entries) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const e of entries) {
        counts.set(e.uid, (counts.get(e.uid) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const t0 = Date.now();
const catalog = JSON.parse(fs.readFileSync(MERGED_EN_ARESULTS, "utf8"));
const catalogLeaves = mergedApresultsUsesNestedShape(catalog)
    ? flatCatalogLeavesFromCommittedMap(catalog)
    : collectLeaves(catalog);
const catalogPathSet = new Set(
    mergedApresultsUsesNestedShape(catalog)
        ? Object.keys(collectLeaves(catalog))
        : Object.keys(catalogLeaves),
);

const entries = mergedApresultsUsesNestedShape(catalog)
    ? pathMapEntriesAlignedWithNested(catalog)
    : buildPathMapFromCatalog(catalogLeaves).entries;
const collisions = mergedApresultsUsesNestedShape(catalog)
    ? []
    : buildPathMapFromCatalog(catalogLeaves).collisions;
const duplicateEn = findDuplicateEnglish(entries);

const scanDirs = [
    path.join(repoRoot, "src/games"),
    path.join(repoRoot, "src/common"),
    path.join(repoRoot, "test/games"),
    path.join(repoRoot, "test/common"),
];
const tsFiles = scanDirs.flatMap((d) => walkTsFiles(d));
const refToFiles = collectTsApresultsRefs(tsFiles);

/** @type {string[]} */
const missingCatalog = [];
for (const ref of [...refToFiles.keys()].sort()) {
    const paths = expandTsRefToCatalogPaths(ref, catalogPathSet);
    const missing = paths.filter((p) => !catalogPathSet.has(p));
    if (missing.length === paths.length) {
        missingCatalog.push(`${ref}  (${refToFiles.get(ref)?.slice(0, 2).join(", ")}${(refToFiles.get(ref)?.length ?? 0) > 2 ? ", …" : ""})`);
    }
}

const actorScribe = entries.filter((e) => GENERAL_NESTED_TYPES.has(e.resultType));
const homeworlds = entries.filter((e) => e.uid === "homeworlds");

console.log("apresults catalog leaves", catalogPathSet.size);
console.log("path map entries", entries.length);
console.log(
    "by uid (top 12):",
    summarizeUidBuckets(entries)
        .slice(0, 12)
        .map(([u, n]) => `${u}=${n}`)
        .join(", "),
);
console.log("collisions (newPath)", collisions.length);
console.log("duplicate English groups", duplicateEn.length);
console.log("TS apresults refs", refToFiles.size, "from", tsFiles.length, "files");
console.log("TS refs with no catalog leaf", missingCatalog.length);
console.log("ACTOR/SCRIBE leaves", actorScribe.length, "homeworlds", homeworlds.length);
console.log("audit", `${Date.now() - t0}ms`);

if (collisions.length) {
    console.log("\nCollisions (fix overrides before cutover):");
    for (const c of collisions.slice(0, 25)) {
        console.log(`  ${c.newPath}`);
        for (const old of c.oldPaths) {
            console.log(`    ← ${old}`);
        }
    }
}

if (missingCatalog.length) {
    console.log("\nSample TS refs missing catalog (up to 25):");
    for (const line of missingCatalog.slice(0, 25)) {
        console.log(" ", line);
    }
    if (missingCatalog.length > 25) {
        console.log(" …");
    }
}

if (duplicateEn.length) {
    console.log("\nTop duplicate English (up to 10):");
    for (const row of duplicateEn.slice(0, 10)) {
        console.log(
            `  ${row.oldPathCount} old / ${row.newPathCount} new  ${row.english}`,
        );
        console.log(`    new: ${row.newPaths.slice(0, 4).join(", ")}${row.newPaths.length > 4 ? ", …" : ""}`);
    }
}

console.log("\nHomeworlds map:");
for (const e of homeworlds) {
    console.log(`  ${e.oldFullKey} → ${e.newFullKey}`);
}

if (writeMap) {
    writeCommittedApresultsPathMap(catalog);
    console.log("\nWrote", path.relative(repoRoot, PATH_MAP_JSON));
}

if (writeGaps) {
    const gaps = missingCatalog.map((line) => {
        const m = line.match(/^(apresults:[^\s]+)\s+\((.+)\)$/);
        const ref = m?.[1] ?? line;
        const files = m?.[2]?.replace(/, …$/, "").split(", ").map((f) => f.trim()) ?? [];
        return { ref, files };
    });
    fs.mkdirSync(path.dirname(GAPS_JSON), { recursive: true });
    fs.writeFileSync(
        GAPS_JSON,
        `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), schemaVersion: 1, gaps }, null, 2)}\n`,
        "utf8",
    );
    console.log("Wrote", path.relative(repoRoot, GAPS_JSON), `(${gaps.length} refs)`);
}

if (collisions.length) {
    process.exitCode = 1;
}
