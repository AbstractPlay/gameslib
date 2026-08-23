/* eslint-env node */
/**
 * Verify registry completeness: every discovered game class is in the dev registry.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project } from "ts-morph";
import {
    collectGameFiles,
    discoverGames,
    buildExperimentalVariantsByUid,
    DEFAULT_SKIP_FILES,
} from "./registry-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const META_PATH = path.join(GAMES_DIR, "_registry-meta.generated.json");

const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
});
for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
    project.addSourceFileAtPath(filePath);
}

const discovered = discoverGames(project, GAMES_DIR, DEFAULT_SKIP_FILES);
const discoveredMap = new Map(discovered.map((e) => [e.uid, e]));
const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
const registered = new Set(meta.uids);
const experimentalUids = new Set(meta.experimentalUids ?? []);
const metaExperimentalVariants = meta.experimentalVariantsByUid ?? {};
const discoveredExperimentalVariants = buildExperimentalVariantsByUid(discovered);

const expectedRegistered = new Set(
    [...discoveredMap.keys()].filter((uid) => !meta.production || !discoveredMap.get(uid)?.experimental),
);

const missing = [...expectedRegistered].filter((uid) => !registered.has(uid));
const extra = [...registered].filter((uid) => !discoveredMap.has(uid));

if (missing.length > 0) {
    console.error("Games missing from registry:", missing.map((u) => `${u} (${discoveredMap.get(u)?.className})`).join(", "));
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
    for (const uid of discoveredMap.keys()) {
        if (discoveredMap.get(uid)?.experimental && registered.has(uid)) {
            console.error(`Experimental game "${uid}" should not be in production registry`);
            process.exit(1);
        }
    }
}

const metaVariantKeys = Object.keys(metaExperimentalVariants).sort();
const discoveredVariantKeys = Object.keys(discoveredExperimentalVariants).sort();
if (JSON.stringify(metaVariantKeys) !== JSON.stringify(discoveredVariantKeys)) {
    console.error(
        "experimentalVariantsByUid game keys mismatch:",
        `meta=${metaVariantKeys.join(",")}`,
        `discovered=${discoveredVariantKeys.join(",")}`,
    );
    process.exit(1);
}
for (const uid of metaVariantKeys) {
    const metaUids = [...metaExperimentalVariants[uid]].sort();
    const discoveredUids = [...discoveredExperimentalVariants[uid]].sort();
    if (JSON.stringify(metaUids) !== JSON.stringify(discoveredUids)) {
        console.error(
            `experimentalVariantsByUid mismatch for "${uid}":`,
            `meta=${metaUids.join(",")}`,
            `discovered=${discoveredUids.join(",")}`,
        );
        process.exit(1);
    }
}

console.log(`Registry check OK: ${registered.size} games (${meta.production ? "production" : "dev"} build)`);
