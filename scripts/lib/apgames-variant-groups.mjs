import path from "node:path";
import { SyntaxKind } from "ts-morph";
import { collectGameFiles, DEFAULT_SKIP_FILES, getLiteralProperty } from "../registry-discovery.mjs";

/**
 * @param {import("ts-morph").PropertyAssignment} prop
 */
function propertyAssignmentKey(prop) {
    const nameNode = prop.getNameNode();
    if (nameNode.isKind(SyntaxKind.StringLiteral) || nameNode.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
        return nameNode.getLiteralValue();
    }
    if (nameNode.isKind(SyntaxKind.Identifier)) {
        return nameNode.getText();
    }
    return prop.getName();
}
import { loadGamesProject, objectLiteralToPlain } from "./apgames-extract-ts.mjs";
import { REPO_ROOT } from "./apgames-en-paths.mjs";

const GAMES_DIR = path.join(REPO_ROOT, "src", "games");

/** Former `variants-default.json` English labels (seed / migration helper). */
export const VARIANT_GROUP_FALLBACK_LABELS = {
    bases: "Default bases",
    blockers: "Default blockers",
    board: "Default board",
    boardtype: "Default board type",
    capture: "Default capture rules",
    dice: "Default die size",
    enforcers: "Default enforcers",
    eog: "Default end condition",
    fleet: "Default fleet",
    form: "Default form",
    groups: "Default groups",
    komi: "Default komi",
    length: "Default game length",
    movement: "Default movement rules",
    moves: "Default movement rules",
    objective: "Default objective",
    obstacles: "Default obstacles",
    opening: "Default opening",
    parks: "Default park placement",
    penalty: "Default penalty",
    powers: "Default powers",
    rules: "Default rules",
    ruleset: "Default ruleset",
    scoring: "Default scoring",
    setup: "Default setup",
    size: "Default stack size",
    tiebreaker: "Default tiebreaker",
    ties: "Default ties",
    variant: "Default variant",
};

/**
 * @returns {Map<string, Set<string>>} uid → variant group ids from gameinfo
 */
export function discoverVariantGroupsByUid() {
    const project = loadGamesProject();
    const byUid = new Map();
    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        const uid = findUidForFile(sourceFile);
        if (!uid) {
            continue;
        }
        const groups = collectGroupsFromGameinfo(sourceFile);
        if (groups.size > 0) {
            byUid.set(uid, groups);
        }
    }
    return byUid;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 */
function findUidForFile(sourceFile) {
    for (const cls of sourceFile.getClasses()) {
        if (!cls.isExported() || !cls.getName()?.endsWith("Game")) {
            continue;
        }
        const gameinfoProp = cls.getStaticProperty("gameinfo");
        if (!gameinfoProp?.isKind(SyntaxKind.PropertyDeclaration)) {
            continue;
        }
        const init = gameinfoProp.getInitializer();
        if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            continue;
        }
        return getLiteralProperty(init, "uid");
    }
    return undefined;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 * @returns {Set<string>}
 */
function collectGroupsFromGameinfo(sourceFile) {
    const groups = new Set();
    for (const cls of sourceFile.getClasses()) {
        if (!cls.getName()?.endsWith("Game")) {
            continue;
        }
        const gameinfoProp = cls.getStaticProperty("gameinfo");
        if (!gameinfoProp?.isKind(SyntaxKind.PropertyDeclaration)) {
            continue;
        }
        const init = gameinfoProp.getInitializer();
        if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            continue;
        }
        const variantsProp = init.getProperty("variants");
        if (!variantsProp?.isKind(SyntaxKind.PropertyAssignment)) {
            continue;
        }
        const variantsInit = variantsProp.getInitializer();
        if (!variantsInit?.isKind(SyntaxKind.ArrayLiteralExpression)) {
            continue;
        }
        for (const el of variantsInit.getElements()) {
            if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) {
                continue;
            }
            const group = getLiteralProperty(el, "group");
            if (group) {
                groups.add(group);
            }
        }
    }
    return groups;
}

/**
 * @param {Record<string, unknown>} merged
 * @param {{ uidFilter?: string }} [opts]
 * @returns {string[]}
 */
export function findMissingVariantGroupDefaultNames(merged, opts = {}) {
    const { uidFilter } = opts;
    const byUid = discoverVariantGroupsByUid();
    const variantsRoot = merged.variants;
    const missing = [];
    for (const [uid, groups] of byUid) {
        if (uidFilter !== undefined && uid !== uidFilter) {
            continue;
        }
        const block =
            variantsRoot && typeof variantsRoot === "object" && !Array.isArray(variantsRoot)
                ? variantsRoot[uid]
                : undefined;
        for (const group of groups) {
            const pseudo = `#${group}`;
            const entry =
                block && typeof block === "object" && !Array.isArray(block) ? block[pseudo] : undefined;
            const name =
                entry && typeof entry === "object" && !Array.isArray(entry) ? entry.name : undefined;
            if (typeof name !== "string" || name.length === 0) {
                missing.push(
                    `variant-group-default: variants.${uid}.${pseudo}.name is required (gameinfo group "${group}")`,
                );
            }
        }
    }
    return missing.sort();
}

/**
 * Load shared group default English labels (legacy shard shape).
 * @param {Record<string, { name?: string }>} defaultByGroup
 */
export function defaultLabelForGroup(group, defaultByGroup = {}) {
    const block = defaultByGroup[group];
    if (block && typeof block.name === "string") {
        return block.name;
    }
    const flat = VARIANT_GROUP_FALLBACK_LABELS[group];
    if (flat) {
        return flat;
    }
    return `Default ${group}`;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 * @param {string} group
 * @param {string} name
 * @returns {boolean} whether a change was made
 */
export function ensureGameApgamesEnVariantGroupName(sourceFile, group, name) {
    const exportDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
    if (!exportDecl?.getVariableStatement()?.isExported()) {
        return false;
    }
    const init = exportDecl.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return false;
    }
    const pseudo = `#${group}`;
    let variantsProp = init.getProperty("variants");
    const quotedPseudo = JSON.stringify(pseudo);
    if (!variantsProp?.isKind(SyntaxKind.PropertyAssignment)) {
        init.addPropertyAssignment({
            name: "variants",
            initializer: `{ ${quotedPseudo}: { name: ${JSON.stringify(name)} } }`,
        });
        return true;
    }
    const variantsInit = variantsProp.getInitializer();
    if (!variantsInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return false;
    }
    let groupProp = variantsInit.getProperty(pseudo);
    if (!groupProp) {
        groupProp = variantsInit
            .getProperties()
            .find(
                (p) =>
                    p.isKind(SyntaxKind.PropertyAssignment)
                    && propertyAssignmentKey(p) === pseudo,
            );
    }
    if (!groupProp?.isKind(SyntaxKind.PropertyAssignment)) {
        variantsInit.addPropertyAssignment({
            name: quotedPseudo,
            initializer: `{ name: ${JSON.stringify(name)} }`,
        });
        return true;
    }
    const groupInit = groupProp.getInitializer();
    if (!groupInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return false;
    }
    const nameProp = groupProp.getInitializer()?.getProperty("name");
    if (nameProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const existing = nameProp.getInitializer()?.getText();
        if (existing === JSON.stringify(name)) {
            return false;
        }
        nameProp.setInitializer(JSON.stringify(name));
        return true;
    }
    groupInit.addPropertyAssignment({
        name: "name",
        initializer: JSON.stringify(name),
    });
    return true;
}

/**
 * @param {Record<string, { name?: string }>} defaultByGroup
 * @param {Set<string>} [uidFilter]
 */
export function seedVariantGroupDefaultNamesInSources(defaultByGroup, uidFilter) {
    const project = loadGamesProject();
    const byUid = discoverVariantGroupsByUid();
    const changed = [];
    const touchedFiles = new Set();
    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        const uid = findUidForFile(sourceFile);
        if (!uid) {
            continue;
        }
        if (uidFilter !== undefined && !uidFilter.has(uid)) {
            continue;
        }
        const groups = byUid.get(uid);
        if (!groups) {
            continue;
        }
        let fileChanged = false;
        for (const group of groups) {
            const plain = getGameApgamesEnVariantsPlain(sourceFile);
            const pseudo = `#${group}`;
            const existing = plain?.[pseudo]?.name;
            if (typeof existing === "string" && existing.length > 0) {
                continue;
            }
            const label = defaultLabelForGroup(group, defaultByGroup);
            if (ensureGameApgamesEnVariantGroupName(sourceFile, group, label)) {
                fileChanged = true;
                touchedFiles.add(sourceFile);
            }
        }
        if (fileChanged) {
            changed.push(uid);
        }
    }
    for (const sourceFile of touchedFiles) {
        sourceFile.saveSync();
    }
    return changed;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 */
function getGameApgamesEnVariantsPlain(sourceFile) {
    const exportDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
    const init = exportDecl?.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return undefined;
    }
    const variantsProp = init.getProperty("variants");
    if (!variantsProp?.isKind(SyntaxKind.PropertyAssignment)) {
        return undefined;
    }
    const variantsInit = variantsProp.getInitializer();
    if (!variantsInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return undefined;
    }
    return objectLiteralToPlain(variantsInit);
}
