/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(d, out = []) {
    for (const n of fs.readdirSync(d)) {
        const f = path.join(d, n);
        if (fs.statSync(f).isDirectory()) {
            walk(f, out);
        } else if (n.endsWith(".ts") && !n.endsWith(".d.ts")) {
            out.push(f);
        }
    }
    return out;
}

let fixed = 0;
for (const file of walk(SRC)) {
    let c = fs.readFileSync(file, "utf8");
    const b = c;
    c = c.replace(
        /import \{ APGamesInformation \} from (["'])(\.\.?\/schemas\/gameinfo)\.js\1;/g,
        "import type { APGamesInformation } from $1$2.js$1;",
    );
    c = c.replace(
        /import \{ APMoveResult \} from (["'])(\.\.?\/schemas\/moveresults)\.js\1;/g,
        "import type { APMoveResult } from $1$2.js$1;",
    );
    if (c !== b) {
        fs.writeFileSync(file, c);
        fixed++;
    }
}
console.log(`schema-import-type: updated ${fixed} files`);
