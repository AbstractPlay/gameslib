/* eslint-env node */
/**
 * Shared game discovery for generate-registry.mjs and check-registry.mjs
 */
import fs from "fs";
import path from "path";
import { SyntaxKind } from "ts-morph";

export const DEFAULT_SKIP_FILES = new Set([
    "_base.ts",
    "index.ts",
    "_registry.generated.ts",
    "_build-flags.generated.ts",
    "_registry-filter.generated.ts",
    "_gameinfo-filter.ts",
]);

export const VALID_BASES = new Set(["GameBase", "GameBaseSimultaneous", "GameBaseSkipTurn", "InARowBase"]);

export function collectGameFiles(dir, skipFiles = DEFAULT_SKIP_FILES) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectGameFiles(full, skipFiles));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            if (!skipFiles.has(entry.name)) {
                files.push(full);
            }
        }
    }
    return files;
}

export function getLiteralProperty(obj, name) {
    const prop = obj.getProperty(name);
    if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) {
        return undefined;
    }
    const init = prop.getInitializer();
    if (!init) {
        return undefined;
    }
    if (init.isKind(SyntaxKind.StringLiteral)) {
        return init.getLiteralValue();
    }
    if (init.isKind(SyntaxKind.NumericLiteral)) {
        return Number(init.getLiteralValue());
    }
    return undefined;
}

export function flagsIncludeExperimental(flagsInit) {
    if (!flagsInit || !flagsInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return false;
    }
    return flagsInit.getElements().some((el) => {
        return el.isKind(SyntaxKind.StringLiteral) && el.getLiteralValue() === "experimental";
    });
}

export function getExperimentalVariantUids(gameinfoInit) {
    if (!gameinfoInit || !gameinfoInit.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return [];
    }
    const variantsProp = gameinfoInit.getProperty("variants");
    if (!variantsProp || !variantsProp.isKind(SyntaxKind.PropertyAssignment)) {
        return [];
    }
    const variantsInit = variantsProp.getInitializer();
    if (!variantsInit || !variantsInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return [];
    }
    const uids = [];
    for (const el of variantsInit.getElements()) {
        if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) {
            continue;
        }
        const uid = getLiteralProperty(el, "uid");
        if (!uid) {
            continue;
        }
        const expProp = el.getProperty("experimental");
        if (!expProp || !expProp.isKind(SyntaxKind.PropertyAssignment)) {
            continue;
        }
        const expInit = expProp.getInitializer();
        if (expInit?.isKind(SyntaxKind.TrueKeyword)) {
            uids.push(uid);
        }
    }
    return uids;
}

export function findStateInterfaces(sourceFile, gameClassName) {
    const prefix = gameClassName.replace(/Game$/, "");
    const candidates = sourceFile.getInterfaces()
        .filter((iface) => iface.isExported())
        .filter((iface) => iface.getName().startsWith("I") && iface.getName().endsWith("State"))
        .map((iface) => iface.getName());

    const exact = candidates.find((n) => n === `I${prefix}State`);
    if (exact) {
        return [exact];
    }
    const mainState = candidates.filter((n) => n !== "IMoveState" && n !== "IIndividualState");
    if (mainState.length === 1) {
        return mainState;
    }
    return mainState.length > 0 ? [mainState[0]] : [];
}

export function relativeImport(fromDir, targetFile) {
    let rel = path.relative(fromDir, targetFile).replace(/\\/g, "/");
    if (!rel.startsWith(".")) {
        rel = `./${rel}`;
    }
    return rel.replace(/\.ts$/, "");
}

export function discoverGames(project, gamesDir, skipFiles = DEFAULT_SKIP_FILES) {
    const entries = [];
    const files = collectGameFiles(gamesDir, skipFiles);

    for (const filePath of files) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }

        for (const cls of sourceFile.getClasses()) {
            if (!cls.isExported()) {
                continue;
            }
            const name = cls.getName();
            if (!name || !name.endsWith("Game")) {
                continue;
            }

            const extendsExpr = cls.getExtends();
            if (!extendsExpr) {
                continue;
            }
            const baseName = extendsExpr.getText();
            if (!VALID_BASES.has(baseName)) {
                continue;
            }

            const gameinfoProp = cls.getStaticProperty("gameinfo");
            if (!gameinfoProp || !gameinfoProp.isKind(SyntaxKind.PropertyDeclaration)) {
                continue;
            }

            const init = gameinfoProp.getInitializer();
            if (!init || !init.isKind(SyntaxKind.ObjectLiteralExpression)) {
                continue;
            }

            const uid = getLiteralProperty(init, "uid");
            if (!uid) {
                console.warn(`Skipping ${name}: gameinfo.uid not found as string literal in ${filePath}`);
                continue;
            }

            const flagsInit = init.getProperty("flags")?.getInitializer();
            const experimental = flagsIncludeExperimental(flagsInit);
            const experimentalVariantUids = getExperimentalVariantUids(init);
            const stateInterfaces = findStateInterfaces(sourceFile, name);
            const importPath = relativeImport(gamesDir, filePath);

            entries.push({
                className: name,
                uid,
                experimental,
                experimentalVariantUids,
                importPath,
                stateInterfaces,
                filePath,
            });
        }
    }

    return entries;
}

export function buildExperimentalVariantsByUid(entries) {
    const map = {};
    for (const e of entries) {
        if (e.experimentalVariantUids.length > 0) {
            map[e.uid] = [...e.experimentalVariantUids].sort();
        }
    }
    return map;
}
