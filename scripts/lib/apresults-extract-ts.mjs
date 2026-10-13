import path from "node:path";
import { SyntaxKind } from "ts-morph";
import {
    collectGameFiles,
    DEFAULT_SKIP_FILES,
    getLiteralProperty,
} from "../registry-discovery.mjs";
import { REPO_ROOT } from "./apresults-en-paths.mjs";
import { loadGamesProject, objectLiteralToPlain } from "./apgames-extract-ts.mjs";

const GAMES_DIR = path.join(REPO_ROOT, "src", "games");

/**
 * @returns {Record<string, unknown>} uid → per-game result buckets from `gameApresultsEn`
 */
export function discoverGameApresultsEnOverlay() {
    const overlay = {};
    const project = loadGamesProject();

    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        const exportDecl = sourceFile.getVariableDeclaration("gameApresultsEn");
        if (!exportDecl?.getVariableStatement()?.isExported()) {
            continue;
        }
        const init = exportDecl.getInitializer();
        if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            throw new Error(`gameApresultsEn must be an object literal in ${filePath}`);
        }
        const uid = findUidForFile(sourceFile);
        if (!uid) {
            throw new Error(`gameApresultsEn in ${filePath} but no gameinfo.uid found`);
        }
        const plain = objectLiteralToPlain(init);
        if (!plain || Object.keys(plain).length === 0) {
            continue;
        }
        overlay[uid] = plain;
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
