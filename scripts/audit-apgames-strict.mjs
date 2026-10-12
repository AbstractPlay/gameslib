#!/usr/bin/env node
/** Full-registry strict apgames catalog ↔ TS coverage (single ts-morph load). */
import { mergeApgamesEnSources } from "./lib/apgames-en-merge.mjs";
import {
    buildUidToGameSourcePaths,
    findMissingApgamesReferences,
    findOrphanApgamesLeaves,
} from "./lib/check-apgames-refs.mjs";
import { discoverGameApgamesEnOverlay } from "./lib/apgames-extract-ts.mjs";

/**
 * @param {string} line
 */
function bucketFromIssueLine(line) {
    const m = line.match(/apgames:((?:validation|variants|displays|buttons|status)\.[^)\s]+)/);
    if (!m) {
        return "other";
    }
    const leaf = m[1];
    const section = leaf.split(".")[0];
    const rest = leaf.slice(section.length + 1);
    const uid = rest.split(".")[0] ?? "";
    return `${section}/${uid}`;
}

/**
 * @param {string[]} lines
 */
function summarizeBuckets(lines) {
    const counts = new Map();
    for (const line of lines) {
        const b = bucketFromIssueLine(line);
        counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const t0 = Date.now();
const uids = [...buildUidToGameSourcePaths().keys()].sort();
const overlay = discoverGameApgamesEnOverlay();
const withExport = new Set();
for (const section of ["validation", "variants", "displays", "buttons", "status"]) {
    for (const u of Object.keys(overlay[section] ?? {})) {
        withExport.add(u);
    }
}
const noExport = uids.filter((u) => !withExport.has(u));

console.log("registry uids", uids.length);
console.log("with gameApgamesEn section", withExport.size);
console.log("no gameApgamesEn", noExport.length, noExport.length ? noExport.join(", ") : "(none)");

const merged = mergeApgamesEnSources();
console.log("merge + overlay", `${Date.now() - t0}ms`);

const t1 = Date.now();
const allMissing = findMissingApgamesReferences(merged);
const allOrphans = findOrphanApgamesLeaves(merged);
console.log("strict pass (full registry)", `${Date.now() - t1}ms`);
console.log("missing", allMissing.length, "orphans", allOrphans.length);

const topN = 15;
console.log("\nTop missing buckets:");
for (const [bucket, count] of summarizeBuckets(allMissing).slice(0, topN)) {
    console.log(`  ${count}\t${bucket}`);
}
console.log("\nTop orphan buckets:");
for (const [bucket, count] of summarizeBuckets(allOrphans).slice(0, topN)) {
    console.log(`  ${count}\t${bucket}`);
}

const sample = 20;
if (allMissing.length) {
    console.log(`\nSample missing (up to ${sample}):`);
    for (const line of allMissing.slice(0, sample)) {
        console.log(" ", line);
    }
}
if (allOrphans.length) {
    console.log(`\nSample orphans (up to ${sample}):`);
    for (const line of allOrphans.slice(0, sample)) {
        console.log(" ", line);
    }
}
if (allMissing.length + allOrphans.length > sample * 2) {
    console.log(" …");
}
console.log("\ntotal", `${Date.now() - t0}ms`);
