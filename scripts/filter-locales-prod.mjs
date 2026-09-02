/* eslint-env node */
/**
 * Filter locale JSON for production: remove experimental game keys.
 * Reads experimental UIDs from src/games/_registry-meta.generated.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const META_PATH = path.join(ROOT, "src", "games", "_registry-meta.generated.json");
const SUPPORTED_LANGUAGES = ["en", "fr", "de", "it", "es-US"];

function loadRegistryMeta() {
    if (!fs.existsSync(META_PATH)) {
        console.error("Missing registry meta — run npm run generate-registry first");
        process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    return {
        experimentalUids: meta.experimentalUids ?? [],
        experimentalVariantsByUid: meta.experimentalVariantsByUid ?? {},
    };
}

function stripExperimentalFromApgames(data, experimentalUids, experimentalVariantsByUid) {
    if (data.descriptions && typeof data.descriptions === "object") {
        for (const uid of experimentalUids) {
            delete data.descriptions[uid];
        }
    }
    if (data.names && typeof data.names === "object") {
        for (const uid of experimentalUids) {
            delete data.names[uid];
        }
    }
    if (data.variants && typeof data.variants === "object") {
        for (const uid of experimentalUids) {
            delete data.variants[uid];
        }
        for (const [gameUid, variantUids] of Object.entries(experimentalVariantsByUid)) {
            const gameVariants = data.variants[gameUid];
            if (!gameVariants || typeof gameVariants !== "object") {
                continue;
            }
            for (const variantUid of variantUids) {
                delete gameVariants[variantUid];
            }
        }
    }
    for (const uid of experimentalUids) {
        if (Object.prototype.hasOwnProperty.call(data, uid)) {
            delete data[uid];
        }
    }
    return data;
}

function stripExperimentalFromApresults(data, experimentalUids) {
    for (const uid of experimentalUids) {
        if (Object.prototype.hasOwnProperty.call(data, uid)) {
            delete data[uid];
        }
    }
    return data;
}

function filterLocaleFile(data, fileName, experimentalUids, experimentalVariantsByUid) {
    if (fileName === "apgames.json") {
        return stripExperimentalFromApgames(data, experimentalUids, experimentalVariantsByUid);
    }
    if (fileName === "apresults.json") {
        return stripExperimentalFromApresults(data, experimentalUids);
    }
    return data;
}

export function filterLocalesForProd(
    sourceLocalesDir,
    destLocalesDir,
    experimentalUids,
    experimentalVariantsByUid = {},
) {
    for (const lang of SUPPORTED_LANGUAGES) {
        const srcLangDir = path.join(sourceLocalesDir, lang);
        if (!fs.existsSync(srcLangDir)) {
            continue;
        }
        const destLangDir = path.join(destLocalesDir, lang);
        fs.mkdirSync(destLangDir, { recursive: true });

        for (const file of fs.readdirSync(srcLangDir)) {
            if (!file.endsWith(".json")) {
                continue;
            }
            const srcPath = path.join(srcLangDir, file);
            const data = JSON.parse(fs.readFileSync(srcPath, "utf8"));
            const filtered = filterLocaleFile(data, file, experimentalUids, experimentalVariantsByUid);
            fs.writeFileSync(path.join(destLangDir, file), `${JSON.stringify(filtered, null, 4)}\n`);
        }
    }
}

function main() {
    const outDir = process.argv[2] ?? path.join(ROOT, "build", "locales");
    const { experimentalUids, experimentalVariantsByUid } = loadRegistryMeta();
    const sourceDir = path.join(ROOT, "locales");
    const experimentalVariantCount = Object.values(experimentalVariantsByUid).reduce((n, uids) => n + uids.length, 0);

    fs.mkdirSync(outDir, { recursive: true });
    filterLocalesForProd(sourceDir, outDir, experimentalUids, experimentalVariantsByUid);
    console.log(
        `Filtered locales for prod (${experimentalUids.length} experimental games; ${experimentalVariantCount} experimental variants) → ${outDir}`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
