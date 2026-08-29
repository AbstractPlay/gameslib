/* eslint-env node */
/**
 * Validate split ci-deps manifests (ci-deps.dev.json / ci-deps.prod.json).
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

console.log("check-ci-deps OK");
