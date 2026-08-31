/* eslint-env node */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function walkTs(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            walkTs(full, out);
        } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

function fixParentIndexImport(spec, fromFile) {
    if (spec !== "..") {
        return spec;
    }
    const parent = path.dirname(fromFile);
    if (fs.existsSync(path.join(parent, "index.ts"))) {
        return "../index.js";
    }
    return spec;
}

let fixed = 0;
for (const file of walkTs(SRC)) {
    let content = fs.readFileSync(file, "utf8");
    const before = content;

    content = content.replace(
        /from (["'])\.(["'])/g,
        'from $1./index.js$2',
    );
    content = content.replace(
        /from (["'])\.\.(["'])/g,
        (_m, q1, q2) => `from ${q1}${fixParentIndexImport("..", file)}${q2}`,
    );
    content = content.replace(
        /graphology-shortest-path\/unweighted/g,
        "graphology-shortest-path/unweighted.js",
    );

    if (content !== before) {
        fs.writeFileSync(file, content);
        fixed++;
    }
}
console.log(`fix-nodenext-imports: updated ${fixed} files`);
