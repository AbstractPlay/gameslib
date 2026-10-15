import { mergeApgamesEnSources } from "./apgames-en-merge.mjs";
import { mergeApresultsEnSources } from "./apresults-en-merge.mjs";
import {
    buildUidToGameSourcePaths,
    findMissingApgamesReferences,
    findOrphanApgamesLeaves,
} from "./check-apgames-refs.mjs";
import {
    findMissingApresultsReferences,
    findOrphanApresultsLeaves,
} from "./check-apresults-refs.mjs";
import { discoverGameApgamesEnOverlay } from "./apgames-extract-ts.mjs";
import { discoverGameApresultsEnOverlay } from "./apresults-extract-ts.mjs";
import { loadCommittedPathMapEntries } from "./apresults-path-map.mjs";

function summarizeBuckets(lines, bucketFromIssueLine) {
    const counts = new Map();
    for (const line of lines) {
        const b = bucketFromIssueLine(line);
        counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** @param {'apgames' | 'apresults'} namespace */
export function runLocaleEnAudit(namespace) {
    const t0 = Date.now();
    const uids = [...buildUidToGameSourcePaths().keys()].sort();

    if (namespace === "apgames") {
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

        const bucketFromIssueLine = (line) => {
            const m = line.match(/apgames:((?:validation|variants|displays|buttons|status)\.[^)\s]+)/);
            if (!m) {
                return "other";
            }
            const leaf = m[1];
            const section = leaf.split(".")[0];
            const rest = leaf.slice(section.length + 1);
            const uid = rest.split(".")[0] ?? "";
            return `${section}/${uid}`;
        };

        const t1 = Date.now();
        const allMissing = findMissingApgamesReferences(merged);
        const allOrphans = findOrphanApgamesLeaves(merged);
        console.log("strict pass (full registry)", `${Date.now() - t1}ms`);
        console.log("missing", allMissing.length, "orphans", allOrphans.length);

        const topN = 15;
        console.log("\nTop missing buckets:");
        for (const [bucket, count] of summarizeBuckets(allMissing, bucketFromIssueLine).slice(0, topN)) {
            console.log(`  ${count}\t${bucket}`);
        }
        console.log("\nTop orphan buckets:");
        for (const [bucket, count] of summarizeBuckets(allOrphans, bucketFromIssueLine).slice(0, topN)) {
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
        console.log("\ntotal", `${Date.now() - t0}ms`);
        return;
    }

    const overlay = discoverGameApresultsEnOverlay();
    const withExport = new Set(Object.keys(overlay));
    const noExport = uids.filter((u) => !withExport.has(u));
    console.log("registry uids", uids.length);
    console.log("with gameApresultsEn", withExport.size);
    console.log("no gameApresultsEn", noExport.length, noExport.length ? noExport.join(", ") : "(none)");
    console.log("path map entries", loadCommittedPathMapEntries().length);

    mergeApresultsEnSources();
    console.log("merge", `${Date.now() - t0}ms`);

    const bucketFromIssueLine = (line) => {
        const m = line.match(/apresults:([^\s)]+)/);
        if (!m) {
            return "other";
        }
        const leaf = m[1];
        const parts = leaf.split(".");
        if (parts[0] === "homeworlds") {
            return `homeworlds/${parts[1] ?? ""}`;
        }
        if (parts.length === 1) {
            return `root/${parts[0]}`;
        }
        return `${parts[0]}/${parts[1] ?? ""}`;
    };

    const t1 = Date.now();
    const allMissing = findMissingApresultsReferences();
    const allOrphans = uids.flatMap((uid) => findOrphanApresultsLeaves({ uidFilter: uid }));
    console.log("strict pass (full registry)", `${Date.now() - t1}ms`);
    console.log("missing", allMissing.length, "orphans (per-uid sum)", allOrphans.length);

    const topN = 15;
    console.log("\nTop missing buckets:");
    for (const [bucket, count] of summarizeBuckets(allMissing, bucketFromIssueLine).slice(0, topN)) {
        console.log(`  ${count}\t${bucket}`);
    }
    console.log("\nTop orphan buckets:");
    for (const [bucket, count] of summarizeBuckets(allOrphans, bucketFromIssueLine).slice(0, topN)) {
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
    console.log("\ntotal", `${Date.now() - t0}ms`);
}
