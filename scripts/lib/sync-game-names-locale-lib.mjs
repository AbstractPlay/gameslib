import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, SyntaxKind } from "ts-morph";
import { MANAGED_LANGS } from "../locale-prune.mjs";
import { writeLocaleJson } from "../locale-json-format.mjs";
import {
    collectGameFiles,
    DEFAULT_SKIP_FILES,
    getLiteralProperty,
    VALID_BASES,
} from "../registry-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
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
        writeLocaleJson(localePath, merged);

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
        writeLocaleJson(srcPath, sortedTracking);
        console.log(`Seeded names (${Object.keys(englishNames).length}) → ${localePath} + locale-src`);
    }
}

/** @returns {Record<string, string>} */
export function discoverGameNamesFromRegistry() {
    return discoverGameNames(loadProject(), GAMES_DIR);
}

/** Sync `names.{uid}` in English from `gameinfo.name` (same data as apgames merge overlay). */
export function writeEnglishGameNamesFromRegistry() {
    const expectedNames = discoverGameNamesFromRegistry();
    const apgames = JSON.parse(fs.readFileSync(APGAMES_PATH, "utf8"));
    const merged = mergeNamesIntoApgames(apgames, expectedNames);
    writeLocaleJson(APGAMES_PATH, merged);
    console.log(`Updated names (${Object.keys(expectedNames).length} games) in ${APGAMES_PATH}`);
    return merged.names;
}

/** Copy English titles into de/fr/it/es-US and locale-src tracking (`src=out`). */
export function seedManagedGameNamesFromEnglishApgames() {
    const englishNames = loadEnglishNames();
    if (Object.keys(englishNames).length === 0) {
        throw new Error("English apgames.json has no names section — run locale-en merge apgames --write first");
    }
    seedManagedLocales(englishNames);
}

/** @param {{ seedManaged?: boolean }} [opts] */
export function writeGameNamesFromRegistry(opts = {}) {
    const names = writeEnglishGameNamesFromRegistry();
    if (opts.seedManaged) {
        seedManagedLocales(names);
    }
    return names;
}
