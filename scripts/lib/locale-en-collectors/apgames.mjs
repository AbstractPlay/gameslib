import fs from "node:fs";
import path from "node:path";
import { SyntaxKind } from "ts-morph";
import { collectLeaves } from "../../locale-prune.mjs";
import { collectGameFiles, DEFAULT_SKIP_FILES, getLiteralProperty } from "../../registry-discovery.mjs";
import { loadGamesProject, objectLiteralToPlain } from "../apgames-extract-ts.mjs";
import { REPO_ROOT } from "../apgames-en-paths.mjs";

const GAMES_DIR = path.join(REPO_ROOT, "src", "games");
const UID_SECTIONS = ["validation", "variants", "displays", "buttons", "status"];
const META_LEAF_PREFIXES = ["names.", "descriptions.", "notes."];

/** @type {{ project: import("ts-morph").Project, uidToPaths: Map<string, string[]> } | null} */
let cachedGamesContext = null;

/**
 * @param {import("ts-morph").Node} node
 * @returns {string | undefined}
 */
function stringLiteralValue(node) {
    if (!node) {
        return undefined;
    }
    if (node.isKind(SyntaxKind.StringLiteral) || node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
        return node.getLiteralValue();
    }
    return undefined;
}

/**
 * @param {import("ts-morph").Node} expr
 */
function isApgamesHelperCall(expr, baseName) {
    const text = expr.getText();
    return text === baseName || text.endsWith(`.${baseName}`);
}

/**
 * @param {import("ts-morph").Node} node
 * @param {string} fileUid
 */
function resolveUidArgument(node, fileUid) {
    const lit = stringLiteralValue(node);
    if (lit !== undefined) {
        return lit;
    }
    const text = node?.getText() ?? "";
    if (text.endsWith(".gameinfo.uid") || text.endsWith("gameinfo.uid")) {
        return fileUid;
    }
    return undefined;
}

/**
 * @param {import("ts-morph").CallExpression} call
 * @param {string} fileUid
 * @returns {string | undefined}
 */
function leafFromGameApgamesUidKeyCall(call, fileUid) {
    const args = call.getArguments();
    if (args.length < 2) {
        return undefined;
    }
    const uid = resolveUidArgument(args[0], fileUid);
    const section = stringLiteralValue(args[1]);
    if (!uid || !section) {
        return undefined;
    }
    const parts = [];
    for (let i = 2; i < args.length; i++) {
        const part = stringLiteralValue(args[i]);
        if (part === undefined) {
            return undefined;
        }
        parts.push(part);
    }
    return `${section}.${uid}${parts.length > 0 ? `.${parts.join(".")}` : ""}`;
}

/**
 * @param {import("ts-morph").Node} node
 * @param {string} fileUid
 * @returns {string | undefined}
 */
/**
 * @param {import("ts-morph").CallExpression} call
 * @param {string} fileUid
 */
function leavesFromPinchDualRelocateKeyCall(call, fileUid) {
    const expr = call.getExpression();
    const name = expr.getText();
    if (name !== "pinchDualRelocateKey" && !name.endsWith(".pinchDualRelocateKey")) {
        return [];
    }
    const base = stringLiteralValue(call.getArguments()[0]);
    if (!base) {
        return [];
    }
    const leaves = [];
    for (const own of ["own_one", "own_other"]) {
        for (const opp of ["opp_one", "opp_other"]) {
            leaves.push(`validation.${fileUid}.${base}_${own}_${opp}`);
        }
    }
    return leaves;
}

/**
 * @param {import("ts-morph").Node} node
 * @param {string} fileUid
 * @returns {string[]}
 */
function apgamesLeavesFromExpression(node, fileUid) {
    if (!node) {
        return [];
    }
    if (node.isKind(SyntaxKind.CallExpression)) {
        const pinch = leavesFromPinchDualRelocateKeyCall(node, fileUid);
        if (pinch.length > 0) {
            return pinch;
        }
    }
    const single = apgamesLeafFromExpression(node, fileUid);
    return single ? [single] : [];
}

function apgamesLeafFromExpression(node, fileUid) {
    if (!node) {
        return undefined;
    }
    if (node.isKind(SyntaxKind.CallExpression)) {
        const exprText = node.getExpression().getText();
        if (exprText === "gameApgamesUidKey" || exprText.endsWith(".gameApgamesUidKey")) {
            return leafFromGameApgamesUidKeyCall(node, fileUid);
        }
    }
    const str = stringLiteralValue(node);
    if (str === undefined) {
        return undefined;
    }
    if (str.startsWith("apgames:")) {
        return str.slice("apgames:".length);
    }
    if (/^(validation|variants|displays|buttons|status)\./.test(str)) {
        return str;
    }
    return undefined;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 * @param {string} fileUid
 * @returns {Set<string>}
 */
export function collectApgamesRefLeavesFromSourceFile(sourceFile, fileUid) {
    const leaves = new Set();

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (isApgamesHelperCall(expr, "gameApgamesUidKey")) {
            const leaf = leafFromGameApgamesUidKeyCall(call, fileUid);
            if (leaf) {
                leaves.add(leaf);
            }
            continue;
        }
        if (isApgamesHelperCall(expr, "gameApgamesT")) {
            const leaf = apgamesLeafFromExpression(call.getArguments()[0], fileUid);
            if (leaf) {
                leaves.add(leaf);
            }
            continue;
        }
        if (isApgamesHelperCall(expr, "i18next.t")) {
            for (const leaf of apgamesLeavesFromExpression(call.getArguments()[0], fileUid)) {
                leaves.add(leaf);
            }
            continue;
        }
        if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
            const name = expr.getName();
            if (name === "neutralAreaLabel" || name === "seatAreaLabel") {
                const leaf = apgamesLeafFromExpression(call.getArguments()[0], fileUid);
                if (leaf) {
                    leaves.add(leaf);
                }
            }
        }
    }

    for (const kind of [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral]) {
        for (const node of sourceFile.getDescendantsOfKind(kind)) {
            const leaf = apgamesLeafFromExpression(node, fileUid);
            if (leaf) {
                leaves.add(leaf);
            }
        }
    }

    return leaves;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 */
function findUidForSourceFile(sourceFile) {
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
 * @param {import("ts-morph").ObjectLiteralExpression} gameinfoInit
 * @returns {{ variantUids: Set<string>, groups: Set<string>, displayUids: Set<string>, displayGroups: Set<string> }}
 */
function gameinfoVariantDisplayMeta(gameinfoInit) {
    const variantUids = new Set();
    const groups = new Set();
    const displayUids = new Set();
    const displayGroups = new Set();

    const variantsProp = gameinfoInit.getProperty("variants");
    if (variantsProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const variantsInit = variantsProp.getInitializer();
        if (variantsInit?.isKind(SyntaxKind.ArrayLiteralExpression)) {
            for (const el of variantsInit.getElements()) {
                if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) {
                    continue;
                }
                const uid = getLiteralProperty(el, "uid");
                if (uid) {
                    variantUids.add(uid);
                }
                const group = getLiteralProperty(el, "group");
                if (group) {
                    groups.add(group);
                }
            }
        }
    }

    const displaysProp = gameinfoInit.getProperty("displays");
    if (displaysProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const displaysInit = displaysProp.getInitializer();
        if (displaysInit?.isKind(SyntaxKind.ArrayLiteralExpression)) {
            for (const el of displaysInit.getElements()) {
                if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) {
                    continue;
                }
                const uid = getLiteralProperty(el, "uid");
                if (uid) {
                    displayUids.add(uid);
                }
                const group = getLiteralProperty(el, "group");
                if (group) {
                    displayGroups.add(group);
                }
            }
        }
    }

    return { variantUids, groups, displayUids, displayGroups };
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 */
function findGameinfoInit(sourceFile) {
    for (const cls of sourceFile.getClasses()) {
        if (!cls.getName()?.endsWith("Game")) {
            continue;
        }
        const gameinfoProp = cls.getStaticProperty("gameinfo");
        if (!gameinfoProp?.isKind(SyntaxKind.PropertyDeclaration)) {
            continue;
        }
        const init = gameinfoProp.getInitializer();
        if (init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            return init;
        }
    }
    return undefined;
}

/**
 * Leaves resolved via gameinfo + GameBase (variants / displays), not literal i18next in game code.
 * @param {string} uid
 * @param {{ variantUids: Set<string>, groups: Set<string>, displayUids: Set<string>, displayGroups: Set<string> }} meta
 * @returns {Set<string>}
 */
export function implicitCatalogLeavesFromGameinfo(uid, meta) {
    const leaves = new Set();
    for (const v of meta.variantUids) {
        leaves.add(`variants.${uid}.${v}.name`);
        leaves.add(`variants.${uid}.${v}.description`);
    }
    for (const g of meta.groups) {
        leaves.add(`variants.${uid}.#${g}.name`);
        leaves.add(`variants.${uid}.#${g}.description`);
    }
    for (const d of meta.displayUids) {
        leaves.add(`displays.${uid}.${d}.name`);
        leaves.add(`displays.${uid}.${d}.description`);
    }
    for (const g of meta.displayGroups) {
        leaves.add(`displays.${uid}.#${g}.name`);
        leaves.add(`displays.${uid}.#${g}.description`);
    }
    return leaves;
}

/**
 * @param {string} leaf
 * @param {string} uid
 * @param {{ variantUids: Set<string>, groups: Set<string>, displayUids: Set<string>, displayGroups: Set<string> }} meta
 */
export function catalogLeafSatisfiedByGameinfo(leaf, uid, meta) {
    const variantPrefix = `variants.${uid}.`;
    if (leaf.startsWith(variantPrefix)) {
        const rest = leaf.slice(variantPrefix.length);
        const id = rest.split(".")[0] ?? "";
        if (id.startsWith("#")) {
            return meta.groups.has(id.slice(1));
        }
        return meta.variantUids.has(id);
    }
    const displayPrefix = `displays.${uid}.`;
    if (leaf.startsWith(displayPrefix)) {
        const rest = leaf.slice(displayPrefix.length);
        const id = rest.split(".")[0] ?? "";
        if (id.startsWith("#")) {
            return meta.displayGroups.has(id.slice(1));
        }
        return meta.displayUids.has(id);
    }
    return false;
}

/**
 * @param {string} leaf
 */
function isCatalogLeafPath(leaf) {
    return UID_SECTIONS.some((section) => leaf.startsWith(`${section}.`));
}

/**
 * i18next plural stems (`KEY` vs `KEY_one` / `KEY_other`) and context suffixes (`KEY` vs `KEY_place`).
 * @param {Set<string>} catalog
 * @param {string} refLeaf
 */
export function catalogContainsRef(catalog, refLeaf) {
    if (catalog.has(refLeaf)) {
        return true;
    }
    if (catalog.has(`${refLeaf}_one`) || catalog.has(`${refLeaf}_other`)) {
        return true;
    }
    for (const suffix of [".one", ".other", ".zero", ".default"]) {
        if (catalog.has(`${refLeaf}${suffix}`)) {
            return true;
        }
    }
    const underscore = `${refLeaf}_`;
    const dotChild = `${refLeaf}.`;
    for (const leaf of catalog) {
        if (leaf.startsWith(underscore) || leaf.startsWith(dotChild)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {Set<string>} refs
 * @param {string} catalogLeaf
 */
export function refsCoverCatalogLeaf(refs, catalogLeaf) {
    if (refs.has(catalogLeaf)) {
        return true;
    }
    const pluralBase = catalogLeaf.replace(/_(one|other)$/, "").replace(/\.(one|other|zero)$/, "");
    if (pluralBase !== catalogLeaf && refs.has(pluralBase)) {
        return true;
    }
    for (const ref of refs) {
        if (catalogLeaf.startsWith(`${ref}_`) || catalogLeaf.startsWith(`${ref}.`)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {Record<string, unknown>} plain
 */
function variantDisplayMetaFromGameApgamesEnPlain(plain) {
    const variantUids = new Set();
    const groups = new Set();
    const displayUids = new Set();
    const displayGroups = new Set();
    const variants = plain.variants;
    if (variants && typeof variants === "object" && !Array.isArray(variants)) {
        for (const key of Object.keys(variants)) {
            if (key.startsWith("#")) {
                groups.add(key.slice(1));
            } else {
                variantUids.add(key);
            }
        }
    }
    const displays = plain.displays;
    if (displays && typeof displays === "object" && !Array.isArray(displays)) {
        for (const key of Object.keys(displays)) {
            if (key.startsWith("#")) {
                displayGroups.add(key.slice(1));
            } else {
                displayUids.add(key);
            }
        }
    }
    return { variantUids, groups, displayUids, displayGroups };
}

/**
 * @param {{ variantUids: Set<string>, groups: Set<string>, displayUids: Set<string>, displayGroups: Set<string> }} a
 * @param {{ variantUids: Set<string>, groups: Set<string>, displayUids: Set<string>, displayGroups: Set<string> }} b
 */
function mergeVariantDisplayMeta(a, b) {
    return {
        variantUids: new Set([...a.variantUids, ...b.variantUids]),
        groups: new Set([...a.groups, ...b.groups]),
        displayUids: new Set([...a.displayUids, ...b.displayUids]),
        displayGroups: new Set([...a.displayGroups, ...b.displayGroups]),
    };
}

/**
 * @param {string} uid
 * @param {string[]} primaryPaths
 */
function expandSourcePathsForUid(uid, primaryPaths) {
    const out = [...primaryPaths];
    const subDir = path.join(GAMES_DIR, uid);
    if (fs.existsSync(subDir)) {
        for (const filePath of collectGameFiles(subDir, DEFAULT_SKIP_FILES)) {
            if (!out.includes(filePath)) {
                out.push(filePath);
            }
        }
    }
    return out;
}

function getGamesContext() {
    if (!cachedGamesContext) {
        const project = loadGamesProject();
        const uidToPaths = new Map();
        for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
            const sourceFile = project.getSourceFile(filePath);
            if (!sourceFile) {
                continue;
            }
            const uid = findUidForSourceFile(sourceFile);
            if (!uid) {
                continue;
            }
            const list = uidToPaths.get(uid) ?? [];
            list.push(filePath);
            uidToPaths.set(uid, list);
        }
        cachedGamesContext = { project, uidToPaths };
    }
    return cachedGamesContext;
}

/** Clear cached ts-morph project (tests). */
export function resetGamesContextCache() {
    cachedGamesContext = null;
}

/** @returns {Map<string, string[]>} uid ΓåÆ source file paths */
export function buildUidToGameSourcePaths() {
    const { uidToPaths } = getGamesContext();
    const expanded = new Map();
    for (const [uid, paths] of uidToPaths) {
        expanded.set(uid, expandSourcePathsForUid(uid, paths));
    }
    return expanded;
}

/**
 * @param {Record<string, unknown>} merged
 * @param {string} uid
 * @returns {Set<string>}
 */
export function collectUidScopedCatalogLeaves(merged, uid) {
    const leaves = new Set();
    for (const section of UID_SECTIONS) {
        const block = merged[section];
        if (!block || typeof block !== "object" || Array.isArray(block)) {
            continue;
        }
        const gameBlock = block[uid];
        if (!gameBlock || typeof gameBlock !== "object" || Array.isArray(gameBlock)) {
            continue;
        }
        const prefix = `${section}.${uid}`;
        for (const leafPath of Object.keys(collectLeaves(gameBlock, prefix))) {
            leaves.add(leafPath);
        }
    }
    return leaves;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 */
function exportsGameApgamesEn(sourceFile) {
    const exportDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
    return exportDecl?.getVariableStatement()?.isExported() ?? false;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 * @returns {Set<string>}
 */
function catalogLeavesFromGameApgamesEnExport(sourceFile, uid) {
    const exportDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
    const init = exportDecl?.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return new Set();
    }
    const plain = objectLiteralToPlain(init);
    if (!plain) {
        return new Set();
    }
    const leaves = new Set();
    for (const section of UID_SECTIONS) {
        const block = plain[section];
        if (!block || typeof block !== "object" || Array.isArray(block)) {
            continue;
        }
        const prefix = `${section}.${uid}`;
        for (const leafPath of Object.keys(collectLeaves(block, prefix))) {
            leaves.add(leafPath);
        }
    }
    return leaves;
}

/**
 * @param {string} leaf
 * @param {Set<string>} refs
 * @param {string} uid
 * @param {{ variantUids: Set<string>, groups: Set<string>, displayUids: Set<string> }} meta
 */
export function isCatalogLeafReferenced(leaf, refs, uid, meta) {
    if (refsCoverCatalogLeaf(refs, leaf)) {
        return true;
    }
    return catalogLeafSatisfiedByGameinfo(leaf, uid, meta);
}

/**
 * @param {Record<string, unknown>} merged
 * @param {{ uidFilter?: string }} [options]
 * @returns {string[]}
 */
export function findMissingApgamesReferences(merged, options = {}) {
    const { uidFilter } = options;
    const catalog = new Set(Object.keys(collectLeaves(merged)));
    const { project, uidToPaths } = getGamesContext();
    const missing = new Set();

    const uids = uidFilter ? [uidFilter] : [...uidToPaths.keys()];

    for (const uid of uids) {
        const paths = expandSourcePathsForUid(uid, uidToPaths.get(uid) ?? []);
        if (paths.length === 0) {
            if (uidFilter) {
                missing.add(`no game source found for uid ${uid}`);
            }
            continue;
        }
        for (const filePath of paths) {
            const sourceFile = project.getSourceFile(filePath);
            if (!sourceFile) {
                continue;
            }
            const refs = collectApgamesRefLeavesFromSourceFile(sourceFile, uid);
            for (const leaf of refs) {
                if (META_LEAF_PREFIXES.some((p) => leaf.startsWith(p))) {
                    continue;
                }
                if (!isCatalogLeafPath(leaf)) {
                    continue;
                }
                if (!catalogContainsRef(catalog, leaf)) {
                    missing.add(
                        `missing catalog key apgames:${leaf} (referenced from ${path.relative(REPO_ROOT, filePath)})`,
                    );
                }
            }
        }
    }

    return [...missing].sort();
}

/**
 * @param {Record<string, unknown>} merged
 * @param {{ uidFilter?: string }} [options]
 * @returns {string[]}
 */
export function findOrphanApgamesLeaves(merged, options = {}) {
    const { uidFilter } = options;
    const { project, uidToPaths } = getGamesContext();
    const orphans = new Set();

    const uids = uidFilter ? [uidFilter] : [...uidToPaths.keys()];

    for (const uid of uids) {
        const paths = expandSourcePathsForUid(uid, uidToPaths.get(uid) ?? []);
        if (!paths.length) {
            continue;
        }
        const refs = new Set();
        let usesExport = false;
        let gameinfoMeta = {
            variantUids: new Set(),
            groups: new Set(),
            displayUids: new Set(),
            displayGroups: new Set(),
        };

        for (const filePath of paths) {
            const sourceFile = project.getSourceFile(filePath);
            if (!sourceFile) {
                continue;
            }
            if (exportsGameApgamesEn(sourceFile)) {
                usesExport = true;
            }
            const gameinfoInit = findGameinfoInit(sourceFile);
            if (gameinfoInit) {
                gameinfoMeta = mergeVariantDisplayMeta(gameinfoMeta, gameinfoVariantDisplayMeta(gameinfoInit));
            }
            const exportDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
            const exportInit = exportDecl?.getInitializer();
            if (exportInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
                const plain = objectLiteralToPlain(exportInit);
                if (plain) {
                    gameinfoMeta = mergeVariantDisplayMeta(
                        gameinfoMeta,
                        variantDisplayMetaFromGameApgamesEnPlain(plain),
                    );
                }
            }
            for (const leaf of collectApgamesRefLeavesFromSourceFile(sourceFile, uid)) {
                refs.add(leaf);
            }
        }

        const catalogLeaves = usesExport
            ? (() => {
                const fromExport = new Set();
                for (const filePath of paths) {
                    const sourceFile = project.getSourceFile(filePath);
                    if (!sourceFile) {
                        continue;
                    }
                    for (const leaf of catalogLeavesFromGameApgamesEnExport(sourceFile, uid)) {
                        fromExport.add(leaf);
                    }
                }
                return fromExport;
            })()
            : collectUidScopedCatalogLeaves(merged, uid);

        for (const leaf of catalogLeaves) {
            if (!isCatalogLeafReferenced(leaf, refs, uid, gameinfoMeta)) {
                orphans.add(
                    `orphan catalog leaf apgames:${leaf} (no reference in ${uid} game source)`,
                );
            }
        }
    }

    return [...orphans].sort();
}
