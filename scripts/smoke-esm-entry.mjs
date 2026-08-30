/* eslint-env node */
/**
 * Post-build smoke: verify ESM subpath modules and nanoid v5 challenge seeds.
 * Full `build/index.js` import requires a consumer bundler (graphology CJS interop).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
    const indexJs = path.join(ROOT, "build", "index.js");
    if (!fs.existsSync(indexJs)) {
        throw new Error("build/index.js missing — run npm run build-ts first");
    }

    const { generateChallengeSeed } = await import(
        pathToFileURL(path.join(ROOT, "build", "common", "challenge-seed.js")).href
    );
    const { addResource } = await import(
        pathToFileURL(path.join(ROOT, "build", "i18n-node.js")).href
    );

    if (typeof generateChallengeSeed !== "function") {
        throw new Error("challenge-seed export missing");
    }
    if (typeof addResource !== "function") {
        throw new Error("i18n-node addResource missing");
    }
    const seed = generateChallengeSeed();
    if (typeof seed !== "string" || seed.length === 0) {
        throw new Error("generateChallengeSeed returned empty value");
    }

    console.log("smoke-esm-entry: ESM subpaths OK");
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`smoke-esm-entry: ${message}`);
    process.exit(1);
}
