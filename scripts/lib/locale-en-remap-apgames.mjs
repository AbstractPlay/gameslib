import fs from "node:fs";
import path from "node:path";
import { assertEnLocaleMergeCurrent } from "./ensure-merged-locale-en.mjs";
import { getNamespaceConfig, REPO_ROOT } from "./locale-en-namespace-config.mjs";
import {
    MANAGED_LANGS,
    collectLeaves,
    pruneManagedLocale,
} from "../locale-prune.mjs";
import { writeLocaleJson } from "../locale-json-format.mjs";

function normalizeSrc(text) {
    return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
}

function buildSrcToEnPaths(enLeaves) {
    /** @type {Map<string, string[]>} */
    const map = new Map();
    for (const [leafPath, text] of Object.entries(enLeaves)) {
        const key = normalizeSrc(text);
        if (!key) {
            continue;
        }
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(leafPath);
    }
    return map;
}

function bucketPriority(leafPath) {
    if (leafPath.includes("validation._general.")) {
        return 0;
    }
    if (leafPath.includes("validation._inarow.")) {
        return 1;
    }
    if (leafPath.includes("validation.homeworlds.")) {
        return 2;
    }
    return 3;
}

function pickCanonicalPath(candidates) {
    return [...candidates].sort((a, b) => {
        const d = bucketPriority(a) - bucketPriority(b);
        if (d !== 0) {
            return d;
        }
        if (a.length !== b.length) {
            return a.length - b.length;
        }
        return a.localeCompare(b);
    })[0];
}

function getLeaf(obj, leafPath) {
    const parts = leafPath.split(".");
    let cur = obj;
    for (const part of parts) {
        if (cur == null || typeof cur !== "object" || Array.isArray(cur)) {
            return undefined;
        }
        cur = cur[part];
    }
    return typeof cur === "string" ? cur : undefined;
}

function setLeaf(obj, leafPath, value) {
    const parts = leafPath.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in cur) || typeof cur[part] !== "object" || cur[part] === null || Array.isArray(cur[part])) {
            cur[part] = {};
        }
        cur = cur[part];
    }
    cur[parts.at(-1)] = value;
}

function shouldTakePriorTranslation(existing, enText, prior) {
    if (!prior) {
        return false;
    }
    if (existing === undefined || existing === "") {
        return true;
    }
    if (existing === enText) {
        return true;
    }
    return false;
}

function migrateTracking({ tracking, localeData, enLeaves, srcToEnPaths, lang }) {
    let moves = 0;
    for (const oldPath of Object.keys(tracking).sort()) {
        if (oldPath in enLeaves) {
            continue;
        }
        const entry = tracking[oldPath];
        const src = normalizeSrc(entry?.src);
        if (!src) {
            continue;
        }
        const candidates = (srcToEnPaths.get(src) ?? []).filter((p) => p !== oldPath);
        if (candidates.length === 0) {
            continue;
        }
        const target = pickCanonicalPath(candidates);
        if (enLeaves[target] !== entry.src && normalizeSrc(enLeaves[target]) !== src) {
            continue;
        }

        const priorOut = entry.out;
        const existing = tracking[target];
        if (!existing) {
            tracking[target] = { src: entry.src, out: priorOut };
        } else if (shouldTakePriorTranslation(existing.out, entry.src, priorOut)) {
            tracking[target] = { src: entry.src, out: priorOut };
        }
        delete tracking[oldPath];
        if (priorOut && localeData) {
            const enAtTarget = enLeaves[target];
            const existingLocale = getLeaf(localeData, target);
            if (shouldTakePriorTranslation(existingLocale, enAtTarget, priorOut)) {
                setLeaf(localeData, target, priorOut);
            }
        }
        moves++;
        console.log(`[${lang}] tracking: ${oldPath} → ${target}`);
    }
    return moves;
}

function syncLocaleFromTracking(localeData, tracking, enLeaves, lang) {
    let moves = 0;
    for (const [leafPath, sourceValue] of Object.entries(enLeaves)) {
        const entry = tracking[leafPath];
        if (!entry?.out || entry.src !== sourceValue) {
            continue;
        }
        const existing = getLeaf(localeData, leafPath);
        if (shouldTakePriorTranslation(existing, sourceValue, entry.out)) {
            setLeaf(localeData, leafPath, entry.out);
            moves++;
        }
    }
    if (moves > 0) {
        console.log(`[${lang}] locale: synced ${moves} leaf(s) from locale-src tracking`);
    }
    return moves;
}

function migrateLocaleNested({ localeData, enLeaves, srcToEnPaths, lang, tracking }) {
    let moves = 0;
    const localeLeaves = collectLeaves(localeData);
    for (const oldPath of Object.keys(localeLeaves).sort()) {
        if (oldPath in enLeaves) {
            continue;
        }
        const src = normalizeSrc(tracking[oldPath]?.src ?? enLeaves[oldPath]);
        if (!src) {
            continue;
        }
        const candidates = (srcToEnPaths.get(src) ?? []).filter((p) => p !== oldPath);
        if (candidates.length === 0) {
            continue;
        }
        const target = pickCanonicalPath(candidates);
        const enAtTarget = enLeaves[target];
        if (normalizeSrc(enAtTarget) !== src && enAtTarget !== tracking[oldPath]?.src) {
            continue;
        }
        const prior = localeLeaves[oldPath];
        const existing = getLeaf(localeData, target);
        if (shouldTakePriorTranslation(existing, enAtTarget, prior)) {
            setLeaf(localeData, target, prior);
            moves++;
            console.log(`[${lang}] locale: ${oldPath} → ${target}`);
        }
    }
    return moves;
}

/** @param {{ write?: boolean }} opts */
export function runRemapApgamesLocaleLeaves(opts = {}) {
    const write = opts.write === true;
    const enPath = getNamespaceConfig("apgames").mergedEnPath;
    assertEnLocaleMergeCurrent("apgames");
    const sourceData = JSON.parse(fs.readFileSync(enPath, "utf8"));
    const enLeaves = collectLeaves(sourceData);
    const srcToEnPaths = buildSrcToEnPaths(enLeaves);

    let totalMoves = 0;
    for (const lang of MANAGED_LANGS) {
        const srcPath = path.join(REPO_ROOT, "locale-src", lang, "apgames.json");
        const targetPath = path.join(REPO_ROOT, "locales", lang, "apgames.json");
        if (!fs.existsSync(srcPath) || !fs.existsSync(targetPath)) {
            console.warn(`[${lang}] skip — missing locale-src or locales file`);
            continue;
        }
        const tracking = JSON.parse(fs.readFileSync(srcPath, "utf8"));
        const targetData = JSON.parse(fs.readFileSync(targetPath, "utf8"));

        totalMoves += migrateTracking({
            tracking,
            localeData: targetData,
            enLeaves,
            srcToEnPaths,
            lang,
        });
        totalMoves += migrateLocaleNested({
            localeData: targetData,
            enLeaves,
            srcToEnPaths,
            lang,
            tracking,
        });
        totalMoves += syncLocaleFromTracking(targetData, tracking, enLeaves, lang);

        const pruned = pruneManagedLocale({ sourceData, targetData, srcTracking: tracking });
        if (write) {
            writeLocaleJson(targetPath, pruned.targetData);
            const sorted = {};
            for (const key of Object.keys(pruned.srcTracking).sort()) {
                sorted[key] = pruned.srcTracking[key];
            }
            writeLocaleJson(srcPath, sorted);
        }
        if (pruned.removedLeaves > 0 || pruned.removedTracking > 0) {
            console.log(
                `[${lang}] prune after remap: ${pruned.removedLeaves} locale leaves, ${pruned.removedTracking} tracking entries removed`,
            );
        }
    }

    console.log(
        write
            ? `locale-en remap apgames: wrote ${totalMoves} remap(s) across managed languages`
            : `locale-en remap apgames: dry-run — ${totalMoves} remap(s); pass --write to apply`,
    );
}
