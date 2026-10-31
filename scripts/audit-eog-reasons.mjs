#!/usr/bin/env node
/**
 * Report games that push `{ type: "eog", reason: … }` and English coverage.
 *
 * Each reason must resolve to a catalog leaf (`gameApresultsEn.EOG` or `_general.EOG`).
 * Shared endings (consecutive passes, generic stalemate, etc.) belong in
 * [`locale-src/en/apresults/shared/_general/EOG.json`](locale-src/en/apresults/shared/_general/EOG.json)
 * — do not copy identical text into every game; reference `apresults:_general.EOG.*` in collectors.
 *
 * Usage: node scripts/audit-eog-reasons.mjs [--require-game-eog]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeApresultsEnSources } from "./lib/apresults-en-merge.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAMES_DIR = path.join(REPO_ROOT, "src", "games");
const requireGameEog = process.argv.includes("--require-game-eog");

const merged = mergeApresultsEnSources();

function normalizeLeaf(reason) {
    return reason
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[\s\-.]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

function eogLeafInCatalog(uid, leaf) {
    if (gameEogHasLeaf(uid, leaf)) {
        return "game";
    }
    if (merged._general?.EOG?.[leaf] !== undefined) {
        return "_general";
    }
    const generalEog = merged._general?.EOG;
    if (generalEog && (generalEog[`${leaf}_one`] !== undefined || generalEog[`${leaf}_other`] !== undefined)) {
        return "_general";
    }
    return undefined;
}

/** Leaf present on this game's `gameApresultsEn.EOG` (including i18next plural stems). */
function gameEogHasLeaf(uid, leaf) {
    const eog = merged[uid]?.EOG;
    if (!eog || typeof eog !== "object") {
        return false;
    }
    if (eog[leaf] !== undefined) {
        return true;
    }
    return eog[`${leaf}_one`] !== undefined || eog[`${leaf}_other`] !== undefined;
}

/** @returns {Record<string, string>} */
function parseEogReasonAliases(text) {
    const m = text.match(/eogReasonAliases\s*\(\s*\)\s*:\s*Record<string,\s*string>\s*\{([\s\S]*?)\n\s*\}/);
    if (!m) {
        return {};
    }
    /** @type {Record<string, string>} */
    const out = {};
    const body = m[1];
    for (const pair of body.matchAll(/(?:["']([^"']+)["']|(\w+))\s*:\s*["']([^"']+)["']/g)) {
        const key = pair[1] ?? pair[2];
        out[key] = pair[3];
    }
    return out;
}

const reasonRe = /type:\s*["']eog["'],\s*reason:\s*["']([^"']+)["']/g;
const dynamicRe = /reason\s*=\s*["']([^"']+)["']/g;

const byGame = new Map();

for (const file of fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith(".ts") && !f.startsWith("_"))) {
    const uid = file.replace(/\.ts$/, "");
    const text = fs.readFileSync(path.join(GAMES_DIR, file), "utf8");
    const reasons = new Set();
    for (const re of [reasonRe, dynamicRe]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m[1] !== "eog" && m[1].length > 0) {
                reasons.add(m[1]);
            }
        }
    }
    if (reasons.size === 0) {
        continue;
    }
    const hasCollector = /case\s*["']eog["']|collectEogChatLogLine|eogChatLineOverride/.test(text);
    const hasGameApresultsEn = /export const gameApresultsEn\b/.test(text);
    const aliases = parseEogReasonAliases(text);
    const rows = [...reasons].sort().map((reason) => {
        const aliasLeaf = aliases[reason];
        const leaf = aliasLeaf !== undefined ? aliasLeaf : normalizeLeaf(reason);
        let catalog = eogLeafInCatalog(uid, leaf);
        if (catalog === undefined && aliasLeaf !== undefined) {
            catalog = eogLeafInCatalog(uid, normalizeLeaf(reason));
        }
        if (catalog === undefined) {
            catalog = "missing";
        }
        const gameEog = gameEogHasLeaf(uid, leaf) ? "game" : catalog === "_general" ? "shared (_general)" : "missing";
        const via = aliasLeaf !== undefined && leaf !== normalizeLeaf(reason) ? ` (alias→${leaf})` : "";
        return { reason, leaf: normalizeLeaf(reason), catalog, gameEog, via };
    });
    byGame.set(uid, { hasCollector, hasGameApresultsEn, rows });
}

console.log("EOG reason audit (machine token → leaf → catalog; game copy only when wording differs)\n");
if (requireGameEog) {
    console.log("(--require-game-eog: fail when no gameApresultsEn.EOG leaf even if _general exists)\n");
}

for (const [uid, { hasCollector, hasGameApresultsEn, rows }] of [...byGame.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tags = [];
    if (!hasCollector) {
        tags.push("no eog collector hook");
    }
    if (!hasGameApresultsEn) {
        tags.push("no gameApresultsEn export");
    } else if (Object.keys(merged[uid]?.EOG ?? {}).length === 0) {
        tags.push("no gameApresultsEn.EOG section");
    }
    console.log(`${uid}${tags.length ? ` (${tags.join("; ")})` : ""}`);
    for (const row of rows) {
        const catalogLabel = row.catalog === "missing" ? "catalog MISSING" : `catalog ${row.catalog}`;
        console.log(`  ${row.reason} → ${row.leaf}${row.via} [${catalogLabel}; ${row.gameEog}]`);
    }
    console.log("");
}

const missingCatalog = [...byGame.values()].flatMap((v) => v.rows.filter((r) => r.catalog === "missing"));
const missingGameEog = [...byGame.values()].flatMap((v) => v.rows.filter((r) => r.gameEog === "missing"));

if (missingCatalog.length > 0) {
    console.log(`${missingCatalog.length} reason(s) without any catalog leaf (add gameApresultsEn.EOG or _general).`);
    process.exitCode = 1;
}
if (requireGameEog && missingGameEog.length > 0) {
    console.log(
        `${missingGameEog.length} reason(s) without gameApresultsEn.EOG (add game-specific copy or use _general in code).`,
    );
    process.exitCode = 1;
}
