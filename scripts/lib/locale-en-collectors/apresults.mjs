import fs from "node:fs";
import path from "node:path";
import { SyntaxKind } from "ts-morph";
import { collectLeaves } from "../../locale-prune.mjs";
import { collectGameFiles, DEFAULT_SKIP_FILES, getLiteralProperty } from "../../registry-discovery.mjs";
import { loadGamesProject, objectLiteralToPlain } from "../apgames-extract-ts.mjs";
import { REPO_ROOT } from "../apgames-en-paths.mjs";
import { MERGED_EN_ARESULTS, mergedApresultsUsesNestedShape } from "../apresults-en-paths.mjs";
import { mergeApresultsEnSources } from "../apresults-en-merge.mjs";

function catalogLeafPathsForUid(merged, uid) {
    const prefix = `${uid}.`;
    return new Set(
        Object.keys(collectLeaves(merged)).filter((leaf) => leaf.startsWith(prefix)),
    );
}
import { loadCommittedPathMapEntries } from "../apresults-path-map.mjs";
import { catalogContainsRef, refsCoverCatalogLeaf } from "./apgames.mjs";

export { catalogContainsRef, refsCoverCatalogLeaf };

const GAMES_DIR = path.join(REPO_ROOT, "src", "games");
const BASE_TS = path.join(GAMES_DIR, "_base.ts");

/** Catalog leaves only referenced via dynamic `apresults:SCRIBE.*` templates. */
/** Per-uid catalog suffixes only referenced via dynamic `apresults:scribe.SCRIBE.*` templates. */
const ORPHAN_EXCLUDE_PREFIXES = ["SCRIBE.glyphs.", "SCRIBE.mini."];

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
 * @param {import("ts-morph").Node} node
 * @returns {string | undefined} catalog path without `apresults:` prefix
 */
function apresultsPathFromExpression(node) {
    if (!node) {
        return undefined;
    }
    const str = stringLiteralValue(node);
    if (str === undefined) {
        return undefined;
    }
    if (str.startsWith("apresults:")) {
        return str.slice("apresults:".length);
    }
    return undefined;
}

/**
 * @param {import("ts-morph").Node} expr
 * @param {string} methodName
 */
function isThisMethodCall(expr, methodName) {
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) {
        return false;
    }
    return expr.getName() === methodName;
}

/** Match `src/common/chat-log.ts` `normalizeEogReasonLeaf`. */
function normalizeEogReasonLeaf(reason) {
    return reason
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[\s\-.]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseEogReasonAliasesFromSource(text) {
    const m = text.match(/eogReasonAliases\s*\(\s*\)\s*:\s*Record<string,\s*string>\s*\{([\s\S]*?)\n\s*\}/);
    if (!m) {
        return {};
    }
    /** @type {Record<string, string>} */
    const out = {};
    for (const pair of m[1].matchAll(/(?:["']([^"']+)["']|(\w+))\s*:\s*["']([^"']+)["']/g)) {
        const key = pair[1] ?? pair[2];
        out[key] = pair[3];
    }
    return out;
}

/**
 * `gameApresultsEn.EOG.*` keys resolved at runtime via {@link resolveEogCatalogKey} from move-log reasons.
 * @param {import("ts-morph").SourceFile} sourceFile
 * @param {string} uid
 * @returns {Set<string>} catalog paths without `apresults:` prefix
 */
export function collectEogReasonApresultsPaths(sourceFile, uid) {
    const paths = new Set();
    const text = sourceFile.getFullText();
    const reasonRe = /type:\s*["']eog["'],\s*reason:\s*["']([^"']+)["']/g;
    for (const m of text.matchAll(reasonRe)) {
        paths.add(`${uid}.EOG.${normalizeEogReasonLeaf(m[1])}`);
    }
    for (const leaf of Object.values(parseEogReasonAliasesFromSource(text))) {
        paths.add(`${uid}.EOG.${normalizeEogReasonLeaf(leaf)}`);
    }
    return paths;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 * @returns {Set<string>}
 */
export function collectApresultsRefPathsFromSourceFile(sourceFile) {
    const paths = new Set();

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (expr.getText() === "i18next.t" || expr.getText().endsWith(".i18next.t")) {
            const path = apresultsPathFromExpression(call.getArguments()[0]);
            if (path) {
                paths.add(path);
            }
            continue;
        }
        if (isThisMethodCall(expr, "pushSeatChatLine") || isThisMethodCall(expr, "pushNeutralChatLine")) {
            const path = apresultsPathFromExpression(call.getArguments()[2]);
            if (path) {
                paths.add(path);
            }
            continue;
        }
        if (isThisMethodCall(expr, "pushHomeworldsSeatChatLine")) {
            const path = apresultsPathFromExpression(call.getArguments()[3]);
            if (path) {
                paths.add(path);
            }
        }
    }

    for (const prop of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (prop.getName() === "textKey") {
            const path = apresultsPathFromExpression(prop.getInitializer());
            if (path) {
                paths.add(path);
            }
        }
        if (prop.getName() === "key") {
            const init = prop.getInitializer();
            const parent = prop.getParent();
            if (parent?.isKind(SyntaxKind.ObjectLiteralExpression)) {
                const kindProp = parent.getProperty("kind");
                const kindInit = kindProp?.getInitializer();
                if (kindInit && stringLiteralValue(kindInit) === "label") {
                    const path = apresultsPathFromExpression(init);
                    if (path) {
                        paths.add(path);
                    }
                }
            }
        }
    }

    for (const kind of [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral]) {
        for (const node of sourceFile.getDescendantsOfKind(kind)) {
            const path = apresultsPathFromExpression(node);
            if (path) {
                paths.add(path);
            }
        }
    }

    return paths;
}

/**
 * Static prefix of `apresults:…${…}` template keys in chat helpers (e.g. armadas PLACE sizes).
 * @param {import("ts-morph").SourceFile} sourceFile
 * @returns {Set<string>} catalog path prefixes without `apresults:` (include trailing segment, e.g. `armadas.PLACE.`)
 */
export function collectDynamicApresultsCatalogPrefixes(sourceFile) {
    const prefixes = new Set();
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
        const head = node.getHead();
        const text = head.getLiteralText();
        if (text.startsWith("apresults:")) {
            prefixes.add(text.slice("apresults:".length));
        }
    }
    return prefixes;
}

/**
 * @param {Set<string>} refs
 * @param {Set<string>} prefixes
 * @param {Set<string>} catalogLeaves
 */
function applyDynamicTemplatePrefixRefs(refs, prefixes, catalogLeaves) {
    for (const prefix of prefixes) {
        for (const leaf of catalogLeaves) {
            if (leaf.startsWith(prefix)) {
                refs.add(leaf);
            }
        }
    }
}

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

export function resetApresultsGamesContextCache() {
    cachedGamesContext = null;
}

/**
 * @returns {Set<string>} flat catalog paths (pre-cutover) or nested merge leaf paths (post-cutover)
 */
export function loadApresultsCatalogPathSet() {
    const onDisk = JSON.parse(fs.readFileSync(MERGED_EN_ARESULTS, "utf8"));
    if (mergedApresultsUsesNestedShape(onDisk)) {
        return new Set(Object.keys(collectLeaves(mergeApresultsEnSources())));
    }
    return new Set(Object.keys(collectLeaves(onDisk)));
}

/**
 * @returns {Set<string>} global refs from GameBase chat helpers
 */
function collectGlobalApresultsRefs() {
    const { project } = getGamesContext();
    const sourceFile = project.getSourceFile(BASE_TS);
    if (!sourceFile) {
        return new Set();
    }
    return collectApresultsRefPathsFromSourceFile(sourceFile);
}

/**
 * All `apresults:` catalog paths referenced from GameBase and every registry game module.
 * @returns {Set<string>}
 */
export function collectAllApresultsRefPaths() {
    const { project, uidToPaths } = getGamesContext();
    const refs = new Set(collectGlobalApresultsRefs());
    const dynamicPrefixes = new Set();
    const baseFile = project.getSourceFile(BASE_TS);
    if (baseFile) {
        for (const prefix of collectDynamicApresultsCatalogPrefixes(baseFile)) {
            dynamicPrefixes.add(prefix);
        }
    }
    for (const paths of uidToPaths.values()) {
        for (const filePath of paths) {
            const sourceFile = project.getSourceFile(filePath);
            if (!sourceFile) {
                continue;
            }
            for (const ref of collectApresultsRefPathsFromSourceFile(sourceFile)) {
                refs.add(ref);
            }
            for (const prefix of collectDynamicApresultsCatalogPrefixes(sourceFile)) {
                dynamicPrefixes.add(prefix);
            }
            const uid = findUidForSourceFile(sourceFile);
            if (uid) {
                for (const ref of collectEogReasonApresultsPaths(sourceFile, uid)) {
                    refs.add(ref);
                }
            }
        }
    }
    const merged = mergeApresultsEnSources();
    const generalLeaves = new Set(Object.keys(collectLeaves(merged._general ?? {}, "_general")));
    applyDynamicTemplatePrefixRefs(refs, dynamicPrefixes, generalLeaves);
    return refs;
}

/**
 * Shared `_general.*` catalog leaves with no literal reference in game source or GameBase.
 * @param {{ legacyPathExclude?: (legacyPath: string) => boolean }} [options]
 * @returns {string[]}
 */
export function findOrphanApresultsGeneralLeaves(options = {}) {
    const merged = mergeApresultsEnSources();
    const generalLeaves = Object.keys(collectLeaves(merged._general ?? {}, "_general"));
    const refs = collectAllApresultsRefPaths();
    const orphans = new Set();
    for (const leafPath of generalLeaves) {
        const legacyPath = leafPath.startsWith("_general.") ? leafPath.slice("_general.".length) : leafPath;
        if (isOrphanExcluded(legacyPath)) {
            continue;
        }
        if (options.legacyPathExclude?.(legacyPath)) {
            continue;
        }
        if (!refsCoverCatalogLeaf(refs, leafPath)) {
            orphans.add(
                `orphan catalog leaf apresults:${leafPath} (no reference in game source or GameBase)`,
            );
        }
    }
    return [...orphans].sort();
}

/**
 * @param {string} oldPath
 */
function isOrphanExcluded(leafPath) {
    return ORPHAN_EXCLUDE_PREFIXES.some((p) => leafPath.includes(p));
}


function exportsGameApresultsEn(sourceFile) {
    const exportDecl = sourceFile.getVariableDeclaration("gameApresultsEn");
    return exportDecl?.getVariableStatement()?.isExported() ?? false;
}

/**
 * @param {import("ts-morph").SourceFile} sourceFile
 * @param {string} uid
 */
function catalogOldPathsFromGameApresultsEnExport(sourceFile, uid) {
    const exportDecl = sourceFile.getVariableDeclaration("gameApresultsEn");
    const init = exportDecl?.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return new Set();
    }
    const plain = objectLiteralToPlain(init);
    if (!plain) {
        return new Set();
    }
    const paths = new Set();
    for (const leaf of Object.keys(collectLeaves(plain))) {
        const newPath = `${uid}.${leaf}`;
        const entry = loadCommittedPathMapEntries().find((e) => e.newPath === newPath);
        if (entry) {
            paths.add(entry.oldPath);
        }
    }
    return paths;
}

/**
 * @param {{ uidFilter?: string }} [options]
 * @returns {string[]}
 */
export function findMissingApresultsReferences(options = {}) {
    const { uidFilter } = options;
    const catalog = loadApresultsCatalogPathSet();
    const { project, uidToPaths } = getGamesContext();
    const missing = new Set();
    const uids = uidFilter ? [uidFilter] : [...uidToPaths.keys()];

    for (const uid of uids) {
        const paths = expandSourcePathsForUid(uid, uidToPaths.get(uid) ?? []);
        for (const filePath of paths) {
            const sourceFile = project.getSourceFile(filePath);
            if (!sourceFile) {
                continue;
            }
            for (const refPath of collectApresultsRefPathsFromSourceFile(sourceFile)) {
                if (!catalogContainsRef(catalog, refPath)) {
                    missing.add(
                        `missing catalog key apresults:${refPath} (referenced from ${path.relative(REPO_ROOT, filePath)})`,
                    );
                }
            }
        }
    }

    if (!uidFilter) {
        for (const refPath of collectGlobalApresultsRefs()) {
            if (!catalogContainsRef(catalog, refPath)) {
                missing.add(`missing catalog key apresults:${refPath} (referenced from src/games/_base.ts)`);
            }
        }
    }

    return [...missing].sort();
}

/**
 * @param {{ uidFilter?: string }} [options]
 * @returns {string[]}
 */
export function findOrphanApresultsLeaves(options = {}) {
    const { uidFilter } = options;
    if (!uidFilter) {
        return [];
    }
    const merged = mergeApresultsEnSources();
    const { project, uidToPaths } = getGamesContext();
    const paths = expandSourcePathsForUid(uidFilter, uidToPaths.get(uidFilter) ?? []);
    if (!paths.length) {
        return [`no game source found for uid ${uidFilter}`];
    }

    const refs = new Set(collectGlobalApresultsRefs());
    let usesExport = false;
    const dynamicPrefixes = new Set();
    for (const filePath of paths) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        if (exportsGameApresultsEn(sourceFile)) {
            usesExport = true;
        }
        for (const ref of collectApresultsRefPathsFromSourceFile(sourceFile)) {
            refs.add(ref);
        }
        for (const ref of collectEogReasonApresultsPaths(sourceFile, uidFilter)) {
            refs.add(ref);
        }
        for (const prefix of collectDynamicApresultsCatalogPrefixes(sourceFile)) {
            dynamicPrefixes.add(prefix);
        }
    }

    let catalogLeaves = catalogLeafPathsForUid(merged, uidFilter);
    if (usesExport) {
        catalogLeaves = new Set();
        for (const filePath of paths) {
            const sourceFile = project.getSourceFile(filePath);
            if (!sourceFile) {
                continue;
            }
            for (const oldPath of catalogOldPathsFromGameApresultsEnExport(sourceFile, uidFilter)) {
                const entry = loadCommittedPathMapEntries().find((e) => e.oldPath === oldPath);
                if (entry) {
                    catalogLeaves.add(entry.newPath);
                }
            }
        }
    }

    applyDynamicTemplatePrefixRefs(refs, dynamicPrefixes, catalogLeaves);

    const orphans = new Set();
    for (const leafPath of catalogLeaves) {
        const legacyPath = leafPath.slice(uidFilter.length + 1);
        if (isOrphanExcluded(legacyPath)) {
            continue;
        }
        if (!refsCoverCatalogLeaf(refs, leafPath)) {
            orphans.add(
                `orphan catalog leaf apresults:${leafPath} (no reference in ${uidFilter} game source or GameBase)`,
            );
        }
    }
    return [...orphans].sort();
}
