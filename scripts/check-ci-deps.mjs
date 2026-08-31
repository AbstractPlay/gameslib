/* eslint-env node */
/**
 * Validate split ci-deps manifests (ci-deps.dev.json / ci-deps.prod.json).
 * Canonical AP pins live in ci-deps.*.json; run `npm run sync-deps` (or
 * install-ap-deps) to copy them into package.json after a merge or dispatch.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
    console.error(`check-ci-deps: ${message}`);
    process.exit(1);
}

const legacyPath = path.join(ROOT, "ci-deps.json");
if (fs.existsSync(legacyPath)) {
    fail("remove legacy ci-deps.json; use ci-deps.dev.json and ci-deps.prod.json");
}

const stages = ["dev", "prod"];
const manifests = {};

for (const stage of stages) {
    const filePath = path.join(ROOT, `ci-deps.${stage}.json`);
    if (!fs.existsSync(filePath)) {
        fail(`missing ${path.basename(filePath)}`);
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data.renderer) {
        fail(`${path.basename(filePath)} must include renderer`);
    }
    manifests[stage] = data;
}

if (manifests.prod.renderer === manifests.dev.renderer) {
    console.warn(
        "check-ci-deps: warning: prod and dev pin the same renderer version",
    );
}

<<<<<<< Updated upstream
=======
const pkgJsonPath = path.join(ROOT, "package.json");
if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const renderer = pkgJson.dependencies?.["@abstractplay/renderer"];
    const devRenderer = manifests.dev.renderer;
    if (renderer && devRenderer && renderer !== devRenderer) {
        console.warn(
            `check-ci-deps: warning: package.json renderer (${renderer}) differs from ` +
                `ci-deps.dev.json (${devRenderer}); run: npm run sync-deps`,
        );
    }
}

>>>>>>> Stashed changes
console.log("check-ci-deps OK");
