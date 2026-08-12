/* eslint-env node */
/**
 * Verify registry completeness: every discovered game class is in the dev registry.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project, SyntaxKind } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const META_PATH = path.join(GAMES_DIR, "_registry-meta.generated.json");

const SKIP_FILES = new Set([
    "_base.ts",
    "index.ts",
    "_registry.generated.ts",
    "_build-flags.generated.ts",
]);

const VALID_BASES = new Set(["GameBase", "GameBaseSimultaneous", "InARowBase"]);

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

function flagsIncludeExperimental(flagsInit) {
    if (!flagsInit || !flagsInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return false;
    }
    return flagsInit.getElements().some((el) => {
        return el.isKind(SyntaxKind.StringLiteral) && el.getLiteralValue() === "experimental";
    });
}

function discoverGames(project) {
    const games = new Map();
    for (const filePath of collectGameFiles(GAMES_DIR)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
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
            const uidProp = init.getProperty("uid");
            if (!uidProp?.isKind(SyntaxKind.PropertyAssignment)) {
                continue;
            }
            const uidInit = uidProp.getInitializer();
            if (!uidInit?.isKind(SyntaxKind.StringLiteral)) {
                continue;
            }
            const uid = uidInit.getLiteralValue();
            const flagsInit = init.getProperty("flags")?.getInitializer();
            const experimental = flagsIncludeExperimental(flagsInit);
            games.set(uid, { className: cls.getName(), experimental });
        }
    }
    return games;
}

const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
});
for (const filePath of collectGameFiles(GAMES_DIR)) {
    project.addSourceFileAtPath(filePath);
}

const discovered = discoverGames(project);
const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
const registered = new Set(meta.uids);
const experimentalUids = new Set(meta.experimentalUids ?? []);

const expectedRegistered = new Set(
    [...discovered.keys()].filter((uid) => !meta.production || !discovered.get(uid)?.experimental),
);

const missing = [...expectedRegistered].filter((uid) => !registered.has(uid));
const extra = [...registered].filter((uid) => !discovered.has(uid));

if (missing.length > 0) {
    console.error("Games missing from registry:", missing.map((u) => `${u} (${discovered.get(u)?.className})`).join(", "));
    process.exit(1);
}
if (extra.length > 0) {
    console.error("Registry contains unknown uids:", extra.join(", "));
    process.exit(1);
}

if (meta.production) {
    for (const uid of experimentalUids) {
        if (registered.has(uid)) {
            console.error(`Experimental game "${uid}" should not be in production registry`);
            process.exit(1);
        }
    }
    for (const uid of discovered.keys()) {
        if (discovered.get(uid)?.experimental && registered.has(uid)) {
            console.error(`Experimental game "${uid}" should not be in production registry`);
            process.exit(1);
        }
    }
}

console.log(`Registry check OK: ${registered.size} games (${meta.production ? "production" : "dev"} build)`);
