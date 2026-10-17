import fs from "node:fs";
import { collectLeaves } from "../locale-prune.mjs";
import { I18NEXT_PLURAL_LEAVES } from "./locale-en-merge-core.mjs";
import { buildUidToGameSourcePaths } from "./check-apgames-refs.mjs";
import {
    MERGED_EN_ARESULTS,
    PATH_MAP_JSON,
    PATH_MAP_OVERRIDES_JSON,
} from "./apresults-en-paths.mjs";
import { writeLocaleJson } from "../locale-json-format.mjs";

/** Result-type buckets that always live under `_general` (nested shape preserved in `newLeaf`). */
export const GENERAL_NESTED_TYPES = new Set(["ACTOR"]);

/** Homeworlds action → semantic leaf (D7). */
export const HOMEWORLD_ACTION_LEAF = {
    BUILD: "build",
    CAPTURE: "capture",
    CATASTROPHE: "catastrophe",
    CONVERT: "convert",
    DISCOVER: "discover",
    ESTABLISH: "land",
    MOVE: "fly",
    PASS: "pass",
    SACRIFICE: "sacrifice",
};

/**
 * First segment of a leaf path that is shared across games (stays in `_general`).
 * @type {Set<string>}
 */
const SHARED_LEAF_HEADS = new Set([
    "nowhat",
    "complete",
    "default",
    "minimal",
    "simple",
    "complete_what",
    "forced",
    "nonum",
    "add",
    "remove",
    "noperson",
    "resolve",
    "general",
    "between",
    "friendly",
    "enemy",
    "neutral",
    "opponent",
    "self",
    "add_one",
    "add_other",
    "remove_one",
    "remove_other",
    "complete_one",
    "complete_other",
]);

let cachedUids = null;

/** @returns {string[]} registry uids longest-first */
export function registryUidsLongestFirst() {
    if (!cachedUids) {
        cachedUids = [...buildUidToGameSourcePaths().keys()].sort((a, b) => b.length - a.length);
    }
    return cachedUids;
}

/** @param {string} uid */
export function resetRegistryUidsCacheForTests(uid) {
    cachedUids = uid ? [uid] : null;
}

/**
 * @param {string} leafPath dot path under result type (may include dots)
 * @param {string} resultType
 * @param {Set<string>} uidSet
 */
export function inferUidForLeaf(leafPath, resultType, uidSet) {
    if (resultType === "DRUID_HEX_EDGE") {
        return "druid";
    }
    if (resultType === "SCRIBE") {
        return "scribe";
    }
    if (resultType === "DESTROY" && leafPath === "string") {
        return "strings";
    }
    if (GENERAL_NESTED_TYPES.has(resultType)) {
        if (resultType === "ACTOR" && (leafPath === "elOso.bear" || leafPath.startsWith("elOso."))) {
            return "elOso";
        }
        return "_general";
    }
    if (resultType === "homeworlds") {
        return "homeworlds";
    }
    const head = leafPath.split(".")[0] ?? "";
    if (head.startsWith("tritium-") && uidSet.has("tritium")) {
        return "tritium";
    }
    if (head === "amazonsNoFirstShot" && uidSet.has("amazons")) {
        return "amazons";
    }
    if (head === "spooky" && uidSet.has("spook")) {
        return "spook";
    }
    if (SHARED_LEAF_HEADS.has(head) || SHARED_LEAF_HEADS.has(leafPath)) {
        return "_general";
    }
    for (const uid of registryUidsLongestFirst()) {
        if (leafPath === uid) {
            return uid;
        }
        if (leafPath.startsWith(`${uid}_`)) {
            return uid;
        }
    }
    if (uidSet.has(head)) {
        return head;
    }
    return "_general";
}

/**
 * @param {string} uid
 * @param {string} leafPath
 */
export function renameLeafForUid(uid, leafPath) {
    if (uid === "homeworlds") {
        return HOMEWORLD_ACTION_LEAF[leafPath] ?? "default";
    }
    if (uid === "_general") {
        return leafPath;
    }
    if (leafPath === "amazonsNoFirstShot") {
        return "noFirstShot";
    }
    if (leafPath === uid) {
        return "default";
    }
    if (leafPath.startsWith(`${uid}_`)) {
        return leafPath.slice(uid.length + 1);
    }
    const parts = leafPath.split(".");
    if (parts[0] === uid) {
        return parts.slice(1).join(".") || "default";
    }
    if (parts[0]?.startsWith(`${uid}_`)) {
        const rest = parts[0].slice(uid.length + 1);
        return [rest, ...parts.slice(1)].filter(Boolean).join(".");
    }
    if (parts[0]?.startsWith(`${uid}-`)) {
        return parts[0].slice(uid.length + 1);
    }
    return leafPath;
}

/**
 * @param {string} rootKey e.g. WINNERS_one
 * @returns {{ resultType: string, newLeaf: string }}
 */
export function splitRootPluralKey(rootKey) {
    if (rootKey.endsWith("_one")) {
        return { resultType: rootKey.slice(0, -4), newLeaf: "one" };
    }
    if (rootKey.endsWith("_other")) {
        return { resultType: rootKey.slice(0, -6), newLeaf: "other" };
    }
    return { resultType: rootKey, newLeaf: "default" };
}

/**
 * @param {string} oldPath catalog leaf path (no apresults: prefix)
 * @param {Set<string>} uidSet
 */
export function mapCatalogLeafPath(oldPath, uidSet, catalogOldPaths) {
    const parts = oldPath.split(".");
    let uid;
    let resultType;
    let newLeaf;

    if (parts[0] === "homeworlds" && parts.length === 2) {
        uid = "homeworlds";
        resultType = parts[1];
        newLeaf = HOMEWORLD_ACTION_LEAF[resultType] ?? "default";
        return buildEntry(oldPath, uid, resultType, newLeaf, catalogOldPaths);
    }

    if (parts[0] === "DRUID_HEX_EDGE" && parts.length === 2) {
        return buildEntry(oldPath, "druid", "HEX_EDGE", parts[1], catalogOldPaths);
    }

    if (parts.length === 1) {
        uid = "_general";
        const split = splitRootPluralKey(parts[0]);
        if (I18NEXT_PLURAL_LEAVES.has(split.newLeaf)) {
            return buildEntry(oldPath, uid, "", parts[0], catalogOldPaths);
        }
        resultType = split.resultType;
        newLeaf = split.newLeaf;
        return buildEntry(oldPath, uid, resultType, newLeaf, catalogOldPaths);
    }

    if (parts.length === 2 && uidSet.has(parts[0])) {
        uid = parts[0];
        const stem = parts[1];
        const split = splitRootPluralKey(stem);
        if (split.newLeaf === "one" || split.newLeaf === "other") {
            return buildEntry(oldPath, uid, "", stem, catalogOldPaths);
        }
        resultType = stem;
        newLeaf = "default";
        return buildEntry(oldPath, uid, resultType, newLeaf, catalogOldPaths);
    }

    resultType = parts[0];
    const leafPath = parts.slice(1).join(".");
    uid = inferUidForLeaf(leafPath, resultType, uidSet);
    newLeaf = renameLeafForUid(uid, leafPath);
    return buildEntry(oldPath, uid, resultType, newLeaf, catalogOldPaths);
}

/**
 * @param {string} oldPath
 * @param {string} uid
 * @param {string} resultType
 * @param {string} newLeaf
 */
/**
 * True when `one`/`other` leaves are i18next plurals (`CAPTURE_one`), not context (`CAPTURE.other`).
 * @param {string} oldPath
 * @param {string} uid
 * @param {string} resultType
 * @param {string} newLeaf
 * @param {Set<string>} [catalogOldPaths]
 */
export function shouldUseI18nextPluralSuffix(oldPath, uid, resultType, newLeaf, catalogOldPaths) {
    if (!I18NEXT_PLURAL_LEAVES.has(newLeaf) || newLeaf.includes(".")) {
        return false;
    }
    if (!resultType) {
        return false;
    }
    const suffix = `_${newLeaf}`;
    if (oldPath === `${resultType}${suffix}`) {
        return true;
    }
    const leaf = oldPath.includes(".") ? oldPath.slice(oldPath.lastIndexOf(".") + 1) : oldPath;
    if (leaf !== `${uid}${suffix}`) {
        return false;
    }
    if (newLeaf === "one") {
        return true;
    }
    return catalogOldPaths?.has(`${resultType}.${uid}_one`) === true;
}

export function computeApresultsNewPath(uid, resultType, newLeaf, oldPath, catalogOldPaths) {
    if (!resultType) {
        return `${uid}.${newLeaf}`;
    }
    if (shouldUseI18nextPluralSuffix(oldPath, uid, resultType, newLeaf, catalogOldPaths)) {
        return `${uid}.${resultType}_${newLeaf}`;
    }
    return `${uid}.${resultType}.${newLeaf}`;
}

function buildEntry(oldPath, uid, resultType, newLeaf, catalogOldPaths) {
    const newPath = computeApresultsNewPath(uid, resultType, newLeaf, oldPath, catalogOldPaths);
    return {
        oldPath,
        oldFullKey: `apresults:${oldPath}`,
        uid,
        resultType,
        newLeaf,
        newPath,
        newFullKey: `apresults:${newPath}`,
    };
}

/**
 * @param {Record<string, string>} catalogLeaves
 * @param {Record<string, Partial<{ uid: string, resultType: string, newLeaf: string }>>} [overrides]
 */
export function buildPathMapFromCatalog(catalogLeaves, overrides = loadOverrides()) {
    const uidSet = new Set(registryUidsLongestFirst());
    const catalogOldPaths = new Set(Object.keys(catalogLeaves));
    /** @type {import("./apresults-path-map.mjs").PathMapEntry[]} */
    const entries = [];
    for (const oldPath of Object.keys(catalogLeaves).sort()) {
        let entry = mapCatalogLeafPath(oldPath, uidSet, catalogOldPaths);
        const o = overrides[oldPath];
        if (o) {
            entry = {
                ...entry,
                ...o,
                oldPath,
                oldFullKey: `apresults:${oldPath}`,
            };
            entry.newPath = computeApresultsNewPath(
                entry.uid,
                entry.resultType,
                entry.newLeaf,
                oldPath,
                catalogOldPaths,
            );
            entry.newFullKey = `apresults:${entry.newPath}`;
        }
        entry.english = catalogLeaves[oldPath];
        entries.push(entry);
    }

    /** @type {Map<string, string[]>} */
    const byNew = new Map();
    for (const e of entries) {
        if (!byNew.has(e.newPath)) {
            byNew.set(e.newPath, []);
        }
        byNew.get(e.newPath).push(e.oldPath);
    }
    const collisions = [];
    for (const [newPath, oldPaths] of byNew) {
        if (oldPaths.length > 1) {
            collisions.push({ newPath, oldPaths });
        }
    }
    collisions.sort((a, b) => b.oldPaths.length - a.oldPaths.length);

    return { entries, collisions };
}

function loadOverrides() {
    if (!fs.existsSync(PATH_MAP_OVERRIDES_JSON)) {
        return {};
    }
    const data = JSON.parse(fs.readFileSync(PATH_MAP_OVERRIDES_JSON, "utf8"));
    return data.overrides ?? data;
}

/**
 * Expand TS literal keys to catalog leaf paths where i18next plurals omit `_one`/`_other`.
 * @param {string} ref e.g. apresults:DELTA_SCORE_GAIN
 * @param {Set<string>} catalogPaths
 * @returns {string[]}
 */
export function expandTsRefToCatalogPaths(ref, catalogPaths) {
    const path = ref.replace(/^apresults:/, "");
    if (catalogPaths.has(path)) {
        return [path];
    }
    const candidates = [`${path}_one`, `${path}_other`];
    const hits = candidates.filter((c) => catalogPaths.has(c));
    if (hits.length) {
        return hits;
    }
    return [path];
}

/**
 * @param {string} text
 */
export function normalizeEnglish(text) {
    if (typeof text !== "string") {
        return "";
    }
    return text.trim().replace(/\s+/g, " ");
}

/**
 * @param {import("./apresults-path-map.mjs").PathMapEntry[]} entries
 */
/**
 * @param {Record<string, unknown>} uidBlock
 * @param {string} resultType
 * @param {string} newLeaf dot-separated leaf under result type
 * @param {string} english
 */
export function setResultLeaf(uidBlock, uid, resultType, newLeaf, english, oldPath, catalogOldPaths) {
    if (!resultType) {
        uidBlock[newLeaf] = english;
        return;
    }
    if (shouldUseI18nextPluralSuffix(oldPath, uid, resultType, newLeaf, catalogOldPaths)) {
        uidBlock[`${resultType}_${newLeaf}`] = english;
        return;
    }
    if (!uidBlock[resultType] || typeof uidBlock[resultType] !== "object") {
        uidBlock[resultType] = {};
    }
    let cur = uidBlock[resultType];
    const parts = newLeaf.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const next = cur[part];
        if (next === undefined || typeof next === "string") {
            cur[part] = {};
        }
        cur = cur[part];
    }
    const last = parts[parts.length - 1];
    cur[last] = english;
}

/**
 * @param {{ uid: string, resultType: string, newLeaf: string, english: string }[]} entries
 * @returns {Record<string, unknown>}
 */
export function buildNestedFromPathMapEntries(entries) {
    const root = {};
    const catalogOldPaths = new Set(entries.map((e) => e.oldPath));
    for (const e of entries) {
        if (!root[e.uid]) {
            root[e.uid] = {};
        }
        setResultLeaf(root[e.uid], e.uid, e.resultType, e.newLeaf, e.english, e.oldPath, catalogOldPaths);
    }
    return root;
}

/** @returns {import("./apresults-path-map.mjs").PathMapEntry[]} */
export function loadCommittedPathMapEntries() {
    const data = JSON.parse(fs.readFileSync(PATH_MAP_JSON, "utf8"));
    return data.entries;
}

/**
 * Guess legacy flat catalog path for a nested leaf (inverse of {@link mapCatalogLeafPath} for new games).
 * @param {string} newPath e.g. `killallgo.CAPTURE.suicide_one`
 */
export function guessOldPathFromNewPath(newPath) {
    const parts = newPath.split(".");
    const uid = parts[0];
    if (uid === "_general") {
        const rest = parts.slice(1);
        if (rest.length === 2 && rest[1] === "default") {
            return rest[0];
        }
        return rest.join(".");
    }
    if (uid === "homeworlds") {
        return `homeworlds.${parts[1]}`;
    }
    if (uid === "druid" && parts[1] === "HEX_EDGE") {
        return `DRUID_HEX_EDGE.${parts.slice(2).join(".")}`;
    }
    if (uid === "scribe" && parts[1] === "SCRIBE") {
        return `SCRIBE.${parts.slice(2).join(".")}`;
    }
    if (parts.length === 3 && parts[1] === "ACTOR") {
        return `ACTOR.${uid}.${parts[2]}`;
    }
    if (parts.length === 2) {
        const rtWithPlural = parts[1];
        const plural = rtWithPlural.match(/^(.+)_(one|other)$/);
        if (plural) {
            return `${plural[1]}.${uid}_${plural[2]}`;
        }
        return `${parts[1]}.${uid}`;
    }
    const resultType = parts[1];
    const newLeaf = parts.slice(2).join(".");
    if (newLeaf === "default") {
        return `${resultType}.${uid}`;
    }
    return `${resultType}.${uid}_${newLeaf}`;
}

/**
 * One path-map row per nested catalog leaf, synthesizing rows for new `gameApresultsEn` keys.
 * @param {Record<string, unknown>} mergedNested
 * @param {import("./apresults-path-map.mjs").PathMapEntry[]} [committedEntries]
 */
export function pathMapEntriesForNestedCatalogWrite(
    mergedNested,
    committedEntries = loadCommittedPathMapEntries(),
) {
    const nestedLeaves = collectLeaves(mergedNested);
    const uidSet = new Set(registryUidsLongestFirst());
    /** @type {Map<string, import("./apresults-path-map.mjs").PathMapEntry>} */
    const byNew = new Map();
    for (const e of committedEntries) {
        if (!byNew.has(e.newPath)) {
            byNew.set(e.newPath, e);
        }
    }
    /** @type {Map<string, import("./apresults-path-map.mjs").PathMapEntry>} */
    const remappedByNew = new Map();
    const catalogOldPaths = new Set(committedEntries.map((e) => e.oldPath));
    for (const e of committedEntries) {
        const remapped = mapCatalogLeafPath(e.oldPath, uidSet, catalogOldPaths);
        if (!remappedByNew.has(remapped.newPath)) {
            remappedByNew.set(remapped.newPath, remapped);
        }
    }
    /** @type {import("./apresults-path-map.mjs").PathMapEntry[]} */
    const entries = [];
    for (const newPath of Object.keys(nestedLeaves).sort()) {
        const english = nestedLeaves[newPath];
        let base = byNew.get(newPath) ?? remappedByNew.get(newPath);
        if (!base) {
            const oldPath = guessOldPathFromNewPath(newPath);
            const candidate = mapCatalogLeafPath(oldPath, uidSet, catalogOldPaths);
            if (candidate.newPath !== newPath) {
                throw new Error(
                    `path map: cannot derive row for ${newPath} (tried ${oldPath} → ${candidate.newPath})`,
                );
            }
            base = candidate;
            catalogOldPaths.add(oldPath);
        }
        entries.push({ ...base, english });
    }
    return entries;
}

/**
 * Write `locale-src/en/apresults/apresults-path-map.json` from merged nested English on disk.
 * @param {Record<string, unknown>} [mergedNested]
 */
export function writeCommittedApresultsPathMap(mergedNested) {
    const catalog =
        mergedNested ?? JSON.parse(fs.readFileSync(MERGED_EN_ARESULTS, "utf8"));
    const entries = pathMapEntriesForNestedCatalogWrite(catalog);
    const payload = {
        generatedAt: new Date().toISOString().slice(0, 10),
        schemaVersion: 1,
        entries: entries.map(({ english, ...rest }) => ({
            ...rest,
            english,
        })),
    };
    writeLocaleJson(PATH_MAP_JSON, payload);
}

/**
 * One path-map row per nested catalog leaf (drops committed rows whose `newPath` was removed).
 * @param {Record<string, unknown>} mergedNested
 * @param {import("./apresults-path-map.mjs").PathMapEntry[]} [committedEntries]
 */
export function pathMapEntriesAlignedWithNested(mergedNested, committedEntries = loadCommittedPathMapEntries()) {
    const nestedLeaves = collectLeaves(mergedNested);
    const uidSet = new Set(registryUidsLongestFirst());
    /** @type {Map<string, import("./apresults-path-map.mjs").PathMapEntry>} */
    const byNew = new Map();
    for (const e of committedEntries) {
        if (!byNew.has(e.newPath)) {
            byNew.set(e.newPath, e);
        }
    }
    /** @type {Map<string, import("./apresults-path-map.mjs").PathMapEntry>} */
    const remappedByNew = new Map();
    const catalogOldPaths = new Set(committedEntries.map((e) => e.oldPath));
    for (const e of committedEntries) {
        const remapped = mapCatalogLeafPath(e.oldPath, uidSet, catalogOldPaths);
        if (!remappedByNew.has(remapped.newPath)) {
            remappedByNew.set(remapped.newPath, remapped);
        }
    }
    /** @type {import("./apresults-path-map.mjs").PathMapEntry[]} */
    const entries = [];
    const missing = [];
    for (const newPath of Object.keys(nestedLeaves).sort()) {
        const english = nestedLeaves[newPath];
        const base = byNew.get(newPath) ?? remappedByNew.get(newPath);
        if (!base) {
            missing.push(newPath);
            continue;
        }
        entries.push({ ...base, english });
    }
    if (missing.length) {
        throw new Error(
            `path map missing ${missing.length} nested leaf(s), e.g. ${missing.slice(0, 5).join(", ")}`,
        );
    }
    return entries;
}

/**
 * Flat old-path catalog for path-map rebuild checks after nested English cutover.
 * @param {Record<string, unknown>} mergedNested
 * @returns {Record<string, string>}
 */
export function flatCatalogLeavesFromCommittedMap(mergedNested) {
    const nestedLeaves = collectLeaves(mergedNested);
    /** @type {Record<string, string>} */
    const out = {};
    for (const e of pathMapEntriesAlignedWithNested(mergedNested)) {
        const en = nestedLeaves[e.newPath];
        if (typeof en === "string") {
            out[e.oldPath] = en;
        }
    }
    return out;
}

/**
 * Target nested English from the flat committed monolith + path map (pre-cutover check baseline).
 * @returns {Record<string, unknown>}
 */
export function expectedNestedFromFlatMonolith() {
    const flat = JSON.parse(fs.readFileSync(MERGED_EN_ARESULTS, "utf8"));
    const leaves = collectLeaves(flat);
    const { entries } = buildPathMapFromCatalog(leaves);
    return buildNestedFromPathMapEntries(entries);
}

export function findDuplicateEnglish(entries) {
    /** @type {Map<string, { newPaths: Set<string>, oldPaths: string[] }>} */
    const byEn = new Map();
    for (const e of entries) {
        const norm = normalizeEnglish(e.english);
        if (!norm) {
            continue;
        }
        if (!byEn.has(norm)) {
            byEn.set(norm, { newPaths: new Set(), oldPaths: [] });
        }
        const row = byEn.get(norm);
        row.newPaths.add(e.newPath);
        row.oldPaths.push(e.oldPath);
    }
    const dups = [];
    for (const [english, { newPaths, oldPaths }] of byEn) {
        if (newPaths.size > 1 || oldPaths.length > 1) {
            dups.push({
                english: english.slice(0, 80) + (english.length > 80 ? "…" : ""),
                newPathCount: newPaths.size,
                oldPathCount: oldPaths.length,
                newPaths: [...newPaths].sort(),
                oldPaths: oldPaths.sort(),
            });
        }
    }
    dups.sort((a, b) => b.oldPathCount - a.oldPathCount);
    return dups;
}
