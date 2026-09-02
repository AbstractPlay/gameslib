/* eslint-env node */
/**
 * Keep locales/en/apgames.json `names.{uid}` in sync with gameinfo.name in source.
 *
 *   node scripts/sync-game-names-locale.mjs --write
 *   node scripts/sync-game-names-locale.mjs --check
 *   node scripts/sync-game-names-locale.mjs --seed-managed
 *
 * `--seed-managed` copies English titles into de/fr/it/es-US locales and locale-src
 * sidecars (src=out). Translate never MTs `names.*`; it copies English only for missing keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project, SyntaxKind } from "ts-morph";
import { MANAGED_LANGS } from "./locale-prune.mjs";
import {
    collectGameFiles,
    DEFAULT_SKIP_FILES,
    getLiteralProperty,
    VALID_BASES,
} from "./registry-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const APGAMES_PATH = path.join(ROOT, "locales", "en", "apgames.json");

function discoverGameNames(project, gamesDir) {
    /** @type {Record<string, string>} */
    const names = {};
    for (const filePath of collectGameFiles(gamesDir, DEFAULT_SKIP_FILES)) {
        const sourceFile = project.getSourceFile(filePath);
        if (!sourceFile) {
            continue;
        }
        for (const cls of sourceFile.getClasses()) {
            if (!cls.isExported()) {
                continue;
            }
            const className = cls.getName();
            if (!className || !className.endsWith("Game")) {
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
            if (names[uid] !== undefined && names[uid] !== name) {
                throw new Error(`Duplicate uid "${uid}" with conflicting names in ${filePath}`);
            }
            names[uid] = name;
        }
    }
    return names;
}

function sortObjectKeys(obj) {
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

function mergeNamesIntoApgames(apgames, expectedNames) {
    const sortedNames = sortObjectKeys(expectedNames);
    const rest = { ...apgames };
    delete rest.names;
    const { descriptions, ...tail } = rest;
    return {
        descriptions,
        names: sortedNames,
        ...tail,
    };
}

function diffNames(expected, actual) {
    const missing = [];
    const mismatch = [];
    const extra = [];
    for (const [uid, name] of Object.entries(expected)) {
        if (actual[uid] === undefined) {
            missing.push(uid);
        } else if (actual[uid] !== name) {
            mismatch.push({ uid, expected: name, actual: actual[uid] });
        }
    }
    for (const uid of Object.keys(actual ?? {})) {
        if (expected[uid] === undefined) {
            extra.push(uid);
        }
    }
    return { missing, mismatch, extra };
}

function loadEnglishNames() {
    const apgames = JSON.parse(fs.readFileSync(APGAMES_PATH, "utf8"));
    return apgames.names ?? {};
}

function seedManagedLocales(englishNames) {
    for (const lang of MANAGED_LANGS) {
        const localePath = path.join(ROOT, "locales", lang, "apgames.json");
        if (!fs.existsSync(localePath)) {
            throw new Error(`Missing managed locale: ${localePath}`);
        }
        const apgames = JSON.parse(fs.readFileSync(localePath, "utf8"));
        const merged = mergeNamesIntoApgames(apgames, englishNames);
        fs.writeFileSync(localePath, `${JSON.stringify(merged, null, 4)}\n`);

        const srcPath = path.join(ROOT, "locale-src", lang, "apgames.json");
        const srcTracking = fs.existsSync(srcPath)
            ? JSON.parse(fs.readFileSync(srcPath, "utf8"))
            : {};
        for (const [uid, name] of Object.entries(englishNames)) {
            srcTracking[`names.${uid}`] = { src: name, out: name };
        }
        const sortedTracking = Object.fromEntries(
            Object.keys(srcTracking).sort().map((key) => [key, srcTracking[key]]),
        );
        fs.mkdirSync(path.dirname(srcPath), { recursive: true });
        fs.writeFileSync(srcPath, `${JSON.stringify(sortedTracking, null, 2)}\n`);
        console.log(`Seeded names (${Object.keys(englishNames).length}) → ${localePath} + locale-src`);
    }
}

function checkManagedLocales(englishNames) {
    const errors = [];
    for (const lang of MANAGED_LANGS) {
        const localePath = path.join(ROOT, "locales", lang, "apgames.json");
        const apgames = JSON.parse(fs.readFileSync(localePath, "utf8"));
        const { missing, mismatch, extra } = diffNames(englishNames, apgames.names ?? {});
        if (missing.length > 0) {
            errors.push(`[${lang}] missing names: ${missing.join(", ")}`);
        }
        if (mismatch.length > 0) {
            for (const { uid, expected, actual } of mismatch) {
                errors.push(`[${lang}] ${uid}: expected "${expected}", got "${actual}"`);
            }
        }
        if (extra.length > 0) {
            errors.push(`[${lang}] stale names: ${extra.join(", ")}`);
        }

        const srcPath = path.join(ROOT, "locale-src", lang, "apgames.json");
        const srcTracking = JSON.parse(fs.readFileSync(srcPath, "utf8"));
        for (const [uid, name] of Object.entries(englishNames)) {
            const key = `names.${uid}`;
            const entry = srcTracking[key];
            if (!entry || entry.src !== name || entry.out !== name) {
                errors.push(`[${lang}] locale-src ${key} not seeded with English (src=out)`);
            }
        }
    }
    return errors;
}

function loadProject() {
    const project = new Project({
        tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
        skipAddingFilesFromTsConfig: true,
    });
    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        project.addSourceFileAtPath(filePath);
    }
    return project;
}

function main() {
    const write = process.argv.includes("--write");
    const seedManaged = process.argv.includes("--seed-managed");
    const check = process.argv.includes("--check")
        || (!write && !seedManaged && !process.argv.includes("--help"));
    if (process.argv.includes("--help")) {
        console.log(
            "Usage: node scripts/sync-game-names-locale.mjs [--write | --check | --seed-managed]",
        );
        process.exit(0);
    }

    const expectedNames = discoverGameNames(loadProject(), GAMES_DIR);
    if (!fs.existsSync(APGAMES_PATH)) {
        console.error(`Missing ${APGAMES_PATH}`);
        process.exit(1);
    }

    if (seedManaged && !write) {
        const englishNames = loadEnglishNames();
        if (Object.keys(englishNames).length === 0) {
            console.error("English apgames.json has no names section — run with --write first");
            process.exit(1);
        }
        seedManagedLocales(englishNames);
        if (!check) {
            return;
        }
    }

    const apgames = JSON.parse(fs.readFileSync(APGAMES_PATH, "utf8"));
    const actualNames = apgames.names ?? {};
    const { missing, mismatch, extra } = diffNames(expectedNames, actualNames);

    if (write) {
        const merged = mergeNamesIntoApgames(apgames, expectedNames);
        fs.writeFileSync(APGAMES_PATH, `${JSON.stringify(merged, null, 4)}\n`);
        console.log(`Updated names (${Object.keys(expectedNames).length} games) in ${APGAMES_PATH}`);
        if (process.argv.includes("--seed-managed")) {
            seedManagedLocales(merged.names);
        }
        return;
    }

    if (check) {
        let failed = false;
        if (missing.length === 0 && mismatch.length === 0 && extra.length === 0) {
            console.log(`Game names locale OK: ${Object.keys(expectedNames).length} entries`);
        } else {
            failed = true;
            if (missing.length > 0) {
                console.error(`Missing names keys: ${missing.join(", ")}`);
            }
            if (mismatch.length > 0) {
                for (const { uid, expected, actual } of mismatch) {
                    console.error(`Name mismatch for ${uid}: locale="${actual}" source="${expected}"`);
                }
            }
            if (extra.length > 0) {
                console.error(`Stale names keys (not in registry): ${extra.join(", ")}`);
            }
        }

        const managedErrors = checkManagedLocales(actualNames);
        if (managedErrors.length === 0) {
            console.log(`Managed locale names OK: ${MANAGED_LANGS.join(", ")}`);
        } else {
            failed = true;
            for (const err of managedErrors) {
                console.error(err);
            }
        }

        if (failed) {
            process.exit(1);
        }
        return;
    }
}

main();
