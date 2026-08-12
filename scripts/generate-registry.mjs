/* eslint-env node */
/**
 * Generates src/games/_registry.generated.ts and src/games/_build-flags.generated.ts
 * from game classes discovered under src/games/
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project, SyntaxKind } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const OUT_REGISTRY = path.join(GAMES_DIR, "_registry.generated.ts");
const OUT_FLAGS = path.join(GAMES_DIR, "_build-flags.generated.ts");
const OUT_META = path.join(GAMES_DIR, "_registry-meta.generated.json");

const APGAMES_PRODUCTION = process.env.APGAMES_PRODUCTION === "1";

const SKIP_FILES = new Set([
    "_base.ts",
    "index.ts",
    "_registry.generated.ts",
    "_build-flags.generated.ts",
]);

function collectGameFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectGameFiles(full));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            if (!SKIP_FILES.has(entry.name)) {
                files.push(full);
            }
        }
    }
    return files;
}

function getLiteralProperty(obj, name) {
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

function flagsIncludeExperimental(flagsInit) {
    if (!flagsInit || !flagsInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return false;
    }
    return flagsInit.getElements().some((el) => {
        return el.isKind(SyntaxKind.StringLiteral) && el.getLiteralValue() === "experimental";
    });
}

function findStateInterfaces(sourceFile, gameClassName) {
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

function relativeImport(fromDir, targetFile) {
    let rel = path.relative(fromDir, targetFile).replace(/\\/g, "/");
    if (!rel.startsWith(".")) {
        rel = `./${rel}`;
    }
    rel = rel.replace(/\.ts$/, "");
    return rel;
}

function discoverGames(project) {
    const entries = [];
    const files = collectGameFiles(GAMES_DIR);

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
            const VALID_BASES = new Set(["GameBase", "GameBaseSimultaneous", "InARowBase"]);
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
            const stateInterfaces = findStateInterfaces(sourceFile, name);
            const importPath = relativeImport(GAMES_DIR, filePath);

            entries.push({
                className: name,
                uid,
                experimental,
                importPath,
                stateInterfaces,
                filePath,
            });
        }
    }

    return entries;
}

function buildRegistry(entries) {
    const included = entries.filter((e) => !APGAMES_PRODUCTION || !e.experimental);
    const experimentalUids = entries.filter((e) => e.experimental).map((e) => e.uid);

    included.sort((a, b) => a.uid.localeCompare(b.uid));

    const byPath = new Map();
    for (const e of included) {
        if (!byPath.has(e.importPath)) {
            byPath.set(e.importPath, { classes: [], types: [] });
        }
        const bucket = byPath.get(e.importPath);
        bucket.classes.push(e.className);
        bucket.types.push(...e.stateInterfaces);
    }

    const importLines = [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([importPath, bucket]) => {
        const parts = [...new Set(bucket.classes)];
        const typeParts = [...new Set(bucket.types)].map((t) => `type ${t}`);
        const all = [...parts, ...typeParts].join(", ");
        return `import { ${all} } from "${importPath}";`;
    });

    const exportGameLines = included.map((e) => e.className);
    const exportStateLines = included.flatMap((e) => e.stateInterfaces);

    const registryArray = included.map((e) => e.className).join(", ");

    const registryTs = `// Generated by scripts/generate-registry.mjs — do not edit
import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, GameBaseSimultaneous } from "./_base";

${importLines.join("\n")}

export type GameConstructor = (typeof GameBase | typeof GameBaseSimultaneous) & {
    readonly gameinfo: APGamesInformation;
    create(...args: unknown[]): GameBase | GameBaseSimultaneous;
};

const games = new Map<string, GameConstructor>();
[
    ${registryArray.replace(/,/g, ",\n    ")}
].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g as GameConstructor);
});

export { games };

export {
    ${[...exportGameLines, ...exportStateLines].join(",\n    ")}
};
`;

    const flagsTs = `// Generated by scripts/generate-registry.mjs — do not edit
export const APGAMES_PRODUCTION = ${APGAMES_PRODUCTION};
`;

    const meta = {
        generatedAt: new Date().toISOString(),
        production: APGAMES_PRODUCTION,
        gameCount: included.length,
        experimentalUids,
        uids: included.map((e) => e.uid),
    };

    fs.writeFileSync(OUT_REGISTRY, registryTs);
    fs.writeFileSync(OUT_FLAGS, flagsTs);
    fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));

    console.log(
        `Registry: ${included.length} games (${experimentalUids.length} experimental; ${APGAMES_PRODUCTION ? "omitted from build" : "included in build"})`,
    );

    return { included, experimentalUids, all: entries };
}

const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
});

for (const filePath of collectGameFiles(GAMES_DIR)) {
    project.addSourceFileAtPath(filePath);
}

const entries = discoverGames(project);

const uids = new Set();
for (const e of entries) {
    if (uids.has(e.uid)) {
        console.error(`Duplicate UID "${e.uid}" in ${e.className}`);
        process.exit(1);
    }
    uids.add(e.uid);
}

buildRegistry(entries);
