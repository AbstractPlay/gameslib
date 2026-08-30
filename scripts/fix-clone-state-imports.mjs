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

function commonImportPath(fromFile) {
    const rel = path.relative(path.dirname(fromFile), path.join(SRC, "common")).replace(/\\/g, "/");
    return `${rel}/index.js`;
}

let fixed = 0;
for (const file of walkTs(SRC)) {
    let content = fs.readFileSync(file, "utf8");
    if (!/\bcloneState\(/.test(content)) {
        continue;
    }
    if (/import\s*\{[^}]*\bcloneState\b/.test(content)) {
        continue;
    }
    const commonImportRe =
        /import\s*\{([^}]+)\}\s*from\s*(["'])(\.\.[\\/]+common(?:\/index)?\.js)\2\s*;/;
    const m = content.match(commonImportRe);
    if (m) {
        const names = m[1].trim();
        content = content.replace(
            commonImportRe,
            `import { ${names}, cloneState } from ${m[2]}${m[3]}${m[2]};`,
        );
    } else {
        const commonPath = commonImportPath(file);
        const lines = content.split(/\r?\n/);
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("import ")) {
                insertAt = i + 1;
            }
        }
        lines.splice(insertAt, 0, `import { cloneState } from "${commonPath}";`);
        content = lines.join("\n");
    }
    fs.writeFileSync(file, content);
    fixed++;
}
console.log(`fix-clone-state-imports: updated ${fixed} files`);
