import fs from "node:fs";
import path from "node:path";
import { SyntaxKind } from "ts-morph";
import { mergeApgamesEnSources } from "./apgames-en-merge.mjs";
import { findOrphanApgamesLeaves, resetGamesContextCache } from "./check-apgames-refs.mjs";
import { buildUidToGameSourcePaths } from "./check-apgames-refs.mjs";
import { findOrphanApresultsLeaves, resetApresultsGamesContextCache } from "./check-apresults-refs.mjs";
import { loadGamesProject } from "./apgames-extract-ts.mjs";
import { REPO_ROOT } from "./locale-en-namespace-config.mjs";

const APGAMES_UID_SECTIONS = ["validation", "variants", "displays", "buttons", "status"];

/**
 * @param {import("ts-morph").ObjectLiteralExpression} obj
 * @param {string[]} keys
 */
function removeNestedProperty(obj, keys) {
    if (keys.length === 0) {
        return false;
    }
    const [head, ...rest] = keys;
    const prop = obj.getProperty(head) ?? obj.getProperty(`"${head}"`);
    if (!prop?.isKind(SyntaxKind.PropertyAssignment)) {
        return false;
    }
    if (rest.length === 0) {
        prop.remove();
        return true;
    }
    const init = prop.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return false;
    }
    const removed = removeNestedProperty(init, rest);
    if (removed && init.getProperties().length === 0) {
        prop.remove();
    }
    return removed;
}

/**
 * @param {'apgames' | 'apresults'} namespace
 * @param {{ write?: boolean, uidFilter?: string }} opts
 */
export function runLocaleEnPrune(namespace, opts = {}) {
    const write = opts.write === true;
    const uidFilter = opts.uidFilter;

    if (namespace === "apgames") {
        resetGamesContextCache();
        const merged = mergeApgamesEnSources();
        const orphans = findOrphanApgamesLeaves(merged, uidFilter ? { uidFilter } : {});
        const project = loadGamesProject();

        const byFile = new Map();
        for (const line of orphans) {
            const m = line.match(/apgames:((?:validation|variants|displays|buttons|status)\.[^)\s]+)/);
            const leaf = m?.[1];
            if (!leaf) {
                continue;
            }
            const uid = leaf.split(".")[1];
            const parts = leaf.split(".");
            const section = parts[0];
            if (parts[1] !== uid || !APGAMES_UID_SECTIONS.includes(section)) {
                continue;
            }
            const gamePath = path.join(REPO_ROOT, "src", "games", `${uid}.ts`);
            if (!fs.existsSync(gamePath)) {
                continue;
            }
            const list = byFile.get(gamePath) ?? [];
            list.push({ section, keys: parts.slice(2) });
            byFile.set(gamePath, list);
        }

        let removed = 0;
        for (const [filePath, entries] of byFile) {
            const sf = project.getSourceFile(filePath);
            if (!sf) {
                continue;
            }
            const exportDecl = sf.getVariableDeclaration("gameApgamesEn");
            const init = exportDecl?.getInitializer();
            if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
                continue;
            }
            for (const { section, keys } of entries) {
                const sectionProp = init.getProperty(section);
                if (!sectionProp?.isKind(SyntaxKind.PropertyAssignment)) {
                    continue;
                }
                const sectionInit = sectionProp.getInitializer();
                if (!sectionInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
                    continue;
                }
                if (removeNestedProperty(sectionInit, keys)) {
                    removed++;
                    console.log(write ? "removed" : "would remove", `${section}.${keys.join(".")}`, "from", path.relative(REPO_ROOT, filePath));
                }
            }
            if (write) {
                fs.writeFileSync(filePath, sf.getFullText(), "utf8");
            }
        }
        console.log(write ? `Removed ${removed} apgames export leaf(s).` : `Dry run: ${removed} apgames leaf(s). Pass --write to apply.`);
        return;
    }

    resetApresultsGamesContextCache();
    const orphans = findOrphanApresultsLeaves(uidFilter ? { uidFilter } : {});
    const project = loadGamesProject();
    const uidToPath = buildUidToGameSourcePaths();

    const byFile = new Map();
    for (const line of orphans) {
        const m = line.match(/apresults:([^)\s]+)/);
        const catalogLeaf = m?.[1];
        if (!catalogLeaf) {
            continue;
        }
        const uid = catalogLeaf.split(".")[0];
        if (!catalogLeaf.startsWith(`${uid}.`)) {
            continue;
        }
        const rest = catalogLeaf.slice(uid.length + 1);
        const [resultType, ...leafParts] = rest.split(".");
        if (!resultType || leafParts.length === 0) {
            continue;
        }
        const gamePath = uidToPath.get(uid)?.[0];
        if (!gamePath || !fs.existsSync(gamePath)) {
            continue;
        }
        const list = byFile.get(gamePath) ?? [];
        list.push({ resultType, keys: leafParts });
        byFile.set(gamePath, list);
    }

    let removed = 0;
    for (const [filePath, entries] of byFile) {
        const sf = project.getSourceFile(filePath);
        if (!sf) {
            continue;
        }
        const exportDecl = sf.getVariableDeclaration("gameApresultsEn");
        const init = exportDecl?.getInitializer();
        if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            continue;
        }
        for (const { resultType, keys } of entries) {
            const sectionProp = init.getProperty(resultType);
            if (!sectionProp?.isKind(SyntaxKind.PropertyAssignment)) {
                continue;
            }
            const sectionInit = sectionProp.getInitializer();
            if (!sectionInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
                continue;
            }
            if (removeNestedProperty(sectionInit, keys)) {
                removed++;
                console.log(write ? "removed" : "would remove", `${resultType}.${keys.join(".")}`, "from", path.relative(REPO_ROOT, filePath));
            }
        }
        if (write) {
            fs.writeFileSync(filePath, sf.getFullText(), "utf8");
        }
    }
    console.log(write ? "Removed" : "Would remove", removed, "apresults export leaves");
}
