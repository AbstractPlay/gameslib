/* eslint-env node */
/**
 * Patch dependencies whose package.json exports omit ESM entry points needed for NodeNext consumers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function patchJson(filePath, mutator) {
    if (!fs.existsSync(filePath)) {
        return;
    }
    const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!mutator(pkg)) {
        return;
    }
    fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function patchHoneycomb() {
    const pkgJson = path.join(ROOT, "node_modules", "honeycomb-grid", "package.json");
    const indexDts = path.join(ROOT, "node_modules", "honeycomb-grid", "dist", "index.d.ts");
    patchJson(pkgJson, (pkg) => {
        const exp = pkg.exports?.["."];
        if (exp?.types === "./dist/index.d.ts") {
            return false;
        }
        pkg.exports = {
            ...pkg.exports,
            ".": { ...exp, types: "./dist/index.d.ts" },
        };
        return true;
    });
    if (fs.existsSync(indexDts)) {
        const before = fs.readFileSync(indexDts, "utf8");
        const after = before
            .replace("from './grid';", "from './grid/index.js';")
            .replace("from './hex';", "from './hex/index.js';")
            .replace("from './utils';", "from './utils/index.js';");
        if (after !== before) {
            fs.writeFileSync(indexDts, after);
        }
    }
}

patchHoneycomb();
console.log("patch-esm-deps: OK");
