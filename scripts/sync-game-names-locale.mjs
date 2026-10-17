/**
 * Keep locales/en/apgames.json `names.{uid}` in sync with gameinfo.name in source.
 *
 *   node scripts/sync-game-names-locale.mjs --write
 *   node scripts/sync-game-names-locale.mjs --check
 *   node scripts/sync-game-names-locale.mjs --seed-managed
 *
 * Prefer `npm run locale-en -- merge --write` when editing game strings — it also refreshes
 * apresults and seeds managed names. This script remains for check-only and standalone name fixes.
 *
 * `--seed-managed` copies English titles into de/fr/it/es-US locales and locale-src
 * sidecars (src=out). Translate never MTs `names.*`; it copies English only for missing keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MANAGED_LANGS } from "./locale-prune.mjs";
import {
    discoverGameNamesFromRegistry,
    seedManagedGameNamesFromEnglishApgames,
    writeGameNamesFromRegistry,
} from "./lib/sync-game-names-locale-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APGAMES_PATH = path.join(ROOT, "locales", "en", "apgames.json");

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

    const expectedNames = discoverGameNamesFromRegistry();
    if (!fs.existsSync(APGAMES_PATH)) {
        console.error(`Missing ${APGAMES_PATH}`);
        process.exit(1);
    }

    if (seedManaged && !write) {
        seedManagedGameNamesFromEnglishApgames();
        if (!check) {
            return;
        }
    }

    const actualNames = loadEnglishNames();
    const { missing, mismatch, extra } = diffNames(expectedNames, actualNames);

    if (write) {
        writeGameNamesFromRegistry({ seedManaged });
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
    }
}

main();
