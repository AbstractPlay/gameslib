#!/usr/bin/env node
/**
 * List `_general` leaves that look game-specific (registry uid in the leaf stem).
 *
 *   node scripts/audit-apresults-general-game-specific-keys.mjs
 *   node scripts/audit-apresults-general-game-specific-keys.mjs --json
 */
import { collectLeaves } from "./locale-prune.mjs";
import { mergeApresultsEnSources } from "./lib/apresults-en-merge.mjs";
import { GENERAL_NESTED_TYPES, registryUidsLongestFirst } from "./lib/apresults-path-map.mjs";

const asJson = process.argv.includes("--json");
const merged = mergeApresultsEnSources();
const general = merged._general ?? {};
const uids = registryUidsLongestFirst();

/** @type {Set<string>} */
const MULTI_GAME_STEMS = new Set([
    "decktet",
    "mancala",
    "general", // SOW.general
    "PYRAMID_1",
    "PYRAMID_2",
    "PYRAMID_3",
]);

/**
 * @param {string} leafPath path under _general (e.g. PLACE.decktet)
 * @param {string} resultType top bucket under _general
 */
function classifyGameSpecific(leafPath, resultType) {
    const head = leafPath.split(".")[0] ?? "";

    if (GENERAL_NESTED_TYPES.has(resultType)) {
        if (resultType === "ACTOR" && head === "elOso") {
            return { kind: "single-game", uid: "elOso", notes: ["ACTOR.elOso.* should live on elOso export"] };
        }
        return { kind: "infra", notes: [`${resultType} nested type`] };
    }

    if (resultType === "DRUID_HEX_EDGE") {
        return { kind: "single-game", uid: "druid", notes: ["druid-only edge labels"] };
    }

    for (const uid of uids) {
        if (head.startsWith(`${uid}_`) || head.startsWith(`${uid}-`)) {
            return { kind: "single-game", uid, notes: [`leaf head prefixed with uid`] };
        }
    }

    if (head === "amazonsNoFirstShot") {
        return { kind: "single-game", uid: "amazons", notes: ["amazons first-move copy"] };
    }
    if (head === "spooky") {
        return { kind: "single-game", uid: "spook", notes: ["spook character placement"] };
    }
    if (head.startsWith("tritium-")) {
        return { kind: "single-game", uid: "tritium", notes: ["legacy PLACE.tritium-* stems; game uses tritium.PLACE.*"] };
    }
    if (head.startsWith("PYRAMID_")) {
        return {
            kind: "multi-game",
            notes: ["pylon + subdivision share pyramid size labels"],
        };
    }
    if (MULTI_GAME_STEMS.has(head) || head.startsWith("mancala")) {
        return {
            kind: "multi-game",
            notes: ["shared across mancala-family or decktet games — not a single uid bucket"],
        };
    }

    return null;
}

/** @type {Array<{ resultType: string, leafPath: string, classification: object }>} */
const rows = [];
const flat = collectLeaves({ _general: general });
for (const fullPath of Object.keys(flat)) {
    if (!fullPath.startsWith("_general.")) {
        continue;
    }
    const rest = fullPath.slice("_general.".length);
    const resultType = rest.split(".")[0] ?? "";
    const leafPath = rest.slice(resultType.length + 1);
    const classification = classifyGameSpecific(leafPath, resultType);
    if (classification) {
        rows.push({ resultType, leafPath, classification });
    }
}

if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
} else {
    const byKind = { "single-game": [], "multi-game": [], infra: [] };
    for (const row of rows) {
        byKind[row.classification.kind]?.push(row);
    }
    console.log(`_general game-specific audit: ${rows.length} flagged leaves\n`);
    for (const kind of ["single-game", "multi-game", "infra"]) {
        console.log(`## ${kind} (${byKind[kind].length})`);
        for (const row of byKind[kind]) {
            const uid = row.classification.uid ? ` → ${row.classification.uid}` : "";
            console.log(`  ${row.resultType}.${row.leafPath}${uid}`);
            for (const n of row.classification.notes) {
                console.log(`      ${n}`);
            }
        }
        console.log("");
    }
}
