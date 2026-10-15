import fs from "node:fs";
import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import {
    collectGameFiles,
    DEFAULT_SKIP_FILES,
    getLiteralProperty,
    VALID_BASES,
} from "../registry-discovery.mjs";
import { REPO_ROOT, LEGACY_SLICE, MERGED_EN } from "./apgames-en-paths.mjs";

const GAMES_DIR = path.join(REPO_ROOT, "src", "games");

/** @returns {import("ts-morph").Project} */
export function loadGamesProject() {
    const project = new Project({
        tsConfigFilePath: path.join(REPO_ROOT, "tsconfig.json"),
        skipAddingFilesFromTsConfig: true,
    });
    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        project.addSourceFileAtPath(filePath);
    }
    return project;
}

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
 * @param {import("ts-morph").PropertyAssignment} prop
 * @returns {string | undefined}
 */
function propertyAssignmentKey(prop) {
    const nameNode = prop.getNameNode();
    if (nameNode.isKind(SyntaxKind.StringLiteral) || nameNode.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
        return nameNode.getLiteralValue();
    }
    if (nameNode.isKind(SyntaxKind.Identifier)) {
        return nameNode.getText();
    }
    if (nameNode.isKind(SyntaxKind.ComputedPropertyName)) {
        const expr = nameNode.getExpression();
        const str = stringLiteralValue(expr);
        if (str !== undefined) {
            return str;
        }
    }
    const fallback = prop.getName();
    if (
        fallback.length >= 2
        && fallback.startsWith('"')
        && fallback.endsWith('"')
    ) {
        return fallback.slice(1, -1);
    }
    return fallback;
}

/**
 * @param {import("ts-morph").ObjectLiteralExpression} node
 * @returns {Record<string, unknown> | undefined}
 */
export function objectLiteralToPlain(node) {
    if (!node?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return undefined;
    }
    const out = {};
    for (const prop of node.getProperties()) {
        if (!prop.isKind(SyntaxKind.PropertyAssignment)) {
            continue;
        }
        const key = propertyAssignmentKey(prop);
        if (key === undefined) {
            continue;
        }
        const init = prop.getInitializer();
        if (!init) {
            continue;
        }
        const str = stringLiteralValue(init);
        if (str !== undefined) {
            out[key] = str;
            continue;
        }
        if (init.isKind(SyntaxKind.ObjectLiteralExpression)) {
            const nested = objectLiteralToPlain(init);
            if (nested !== undefined) {
                out[key] = nested;
            }
            continue;
        }
        if (init.isKind(SyntaxKind.ArrayLiteralExpression)) {
            const arr = [];
            for (const el of init.getElements()) {
                const s = stringLiteralValue(el);
                if (s !== undefined) {
                    arr.push(s);
                } else {
                    const nested = objectLiteralToPlain(el);
                    if (nested !== undefined) {
                        arr.push(nested);
                    }
                }
            }
            out[key] = arr;
        }
    }
    return out;
}

/**
 * @param {string | undefined} value
 * @param {string} uid
 * @param {"descriptions"|"notes"} section
 * @param {Record<string, string>} legacySection
 */
function tryResolveMetaString(value, uid, section, legacySection) {
    if (value === undefined) {
        return undefined;
    }
    const pointer = `apgames:${section}.${uid}`;
    if (value === pointer || value === `${section}.${uid}`) {
        return legacySection[uid];
    }
    if (value.startsWith("apgames:")) {
        return undefined;
    }
    return value;
}

/**
 * @param {Record<string, unknown>} [legacySlice]
 */
function metaSectionsForResolve(legacySlice) {
    const legacy = legacySlice ?? loadLegacySlice();
    const committed = fs.existsSync(MERGED_EN)
        ? JSON.parse(fs.readFileSync(MERGED_EN, "utf8"))
        : {};
    return {
        descriptions: { ...(legacy.descriptions ?? {}), ...(committed.descriptions ?? {}) },
        notes: { ...(legacy.notes ?? {}), ...(committed.notes ?? {}) },
    };
}

export function discoverGameinfoOverlay(legacySlice) {
    const { descriptions: legacyDescriptions, notes: legacyNotes } = metaSectionsForResolve(legacySlice);

    const names = {};
    const descriptions = {};
    const notes = {};
    const pointerViolations = [];

    const project = loadGamesProject();
    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        const gameApgamesEnDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
        const hasGameApgamesEn = gameApgamesEnDecl?.getVariableStatement()?.isExported() ?? false;

        for (const cls of sourceFile.getClasses()) {
            if (!cls.isExported() || !cls.getName()?.endsWith("Game")) {
                continue;
            }
            const extendsExpr = cls.getExtends();
            if (!extendsExpr || !VALID_BASES.has(extendsExpr.getText())) {
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
            const uid = getLiteralProperty(init, "uid");
            const name = getLiteralProperty(init, "name");
            if (!uid || !name) {
                continue;
            }
            names[uid] = name;

            const descProp = init.getProperty("description");
            let descValue;
            if (descProp?.isKind(SyntaxKind.PropertyAssignment)) {
                descValue = stringLiteralValue(descProp.getInitializer());
            }
            if (descValue !== undefined) {
                if (hasGameApgamesEn && descValue.startsWith("apgames:descriptions.")) {
                    pointerViolations.push({ uid, filePath, field: "description" });
                }
                const resolved = tryResolveMetaString(descValue, uid, "descriptions", legacyDescriptions);
                if (resolved !== undefined) {
                    descriptions[uid] = resolved;
                }
            }

            const notesProp = init.getProperty("notes");
            if (notesProp?.isKind(SyntaxKind.PropertyAssignment)) {
                const notesValue = stringLiteralValue(notesProp.getInitializer());
                if (notesValue !== undefined) {
                    if (hasGameApgamesEn && notesValue.startsWith("apgames:notes.")) {
                        pointerViolations.push({ uid, filePath, field: "notes" });
                    }
                    const resolved = tryResolveMetaString(notesValue, uid, "notes", legacyNotes);
                    if (resolved !== undefined) {
                        notes[uid] = resolved;
                    }
                }
            }
        }
    }

    const overlay = { names, descriptions };
    if (Object.keys(notes).length > 0) {
        overlay.notes = notes;
    }
    return { overlay, pointerViolations };
}

function loadLegacySlice() {
    if (!fs.existsSync(LEGACY_SLICE)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(LEGACY_SLICE, "utf8"));
}

export function discoverGameApgamesEnOverlay() {
    const overlay = {};
    const project = loadGamesProject();

    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        const exportDecl = sourceFile.getVariableDeclaration("gameApgamesEn");
        if (!exportDecl?.getVariableStatement()?.isExported()) {
            continue;
        }
        const init = exportDecl.getInitializer();
        if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            throw new Error(`gameApgamesEn must be an object literal in ${filePath}`);
        }
        const uid = findUidForFile(sourceFile);
        if (!uid) {
            throw new Error(`gameApgamesEn in ${filePath} but no gameinfo.uid found`);
        }
        const plain = objectLiteralToPlain(init);
        if (!plain) {
            continue;
        }
        for (const section of ["validation", "variants", "displays", "buttons", "status"]) {
            if (plain[section] !== undefined) {
                if (!overlay[section]) {
                    overlay[section] = {};
                }
                overlay[section][uid] = plain[section];
            }
        }
    }
    return overlay;
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
