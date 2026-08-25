/* eslint-env node */
import { filterLocalesForProd } from "./filter-locales-prod.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

if (process.env.APGAMES_PRODUCTION === "1") {
    const metaPath = path.join(ROOT, "src", "games", "_registry-meta.generated.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const buildGamesDir = path.join(ROOT, "build", "games");
    fs.mkdirSync(buildGamesDir, { recursive: true });
    fs.copyFileSync(
        metaPath,
        path.join(buildGamesDir, "_registry-meta.generated.json"),
    );
    const outDir = path.join(ROOT, "build", "locales");
    filterLocalesForProd(
        path.join(ROOT, "locales"),
        outDir,
        meta.experimentalUids ?? [],
        meta.experimentalVariantsByUid ?? {},
    );
    console.log("Production build: registry meta copied to build/games; filtered locales copied to build/locales");
}
