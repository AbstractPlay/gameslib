/* eslint-env node */
/**
 * Patch honeycomb-grid type re-exports for NodeNext resolution.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function patchHoneycomb() {
    const indexDts = path.join(ROOT, "node_modules", "honeycomb-grid", "dist", "index.d.ts");
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
console.log("patch-honeycomb-grid-dts: OK");
