/* eslint-env node */
/**
 * One-shot codemod: rfdc → cloneState, purge game-level compression, .js import suffixes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const COMPRESSION_GAMES = new Set([
    "go",
    "gonnect",
    "gyve",
    "storisende",
    "spora",
    "asli",
    "atarigo",
    "azacru",
    "pacru",
    "biscuit",
    "churn",
]);

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

function resolveRelativeImport(fromFile, spec) {
    if (!spec.startsWith(".")) {
        return spec;
    }
    if (/\.(js|json|node)$/.test(spec)) {
        return spec;
    }
    const base = path.resolve(path.dirname(fromFile), spec);
    if (fs.existsSync(`${base}.ts`)) {
        return `${spec}.js`;
    }
    if (fs.existsSync(path.join(base, "index.ts"))) {
        return `${spec}/index.js`;
    }
    return `${spec}.js`;
}

function patchRelativeImports(content, filePath) {
    return content.replace(
        /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
        (_m, pre, spec, post) => `${pre}${resolveRelativeImport(filePath, spec)}${post}`,
    );
}

function addCloneStateImport(content, filePath) {
    if (content.includes("cloneState")) {
        return content;
    }
    const commonPath = commonImportPath(filePath);
    const importRe = new RegExp(
        `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${commonPath.replace(/\//g, "\\/")}["'];`,
    );
    const m = content.match(importRe);
    if (m) {
        const names = m[1].trim();
        return content.replace(
            importRe,
            `import { ${names}, cloneState } from "${commonPath}";`,
        );
    }
    const lines = content.split(/\r?\n/);
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("import ")) {
            insertAt = i + 1;
        }
    }
    lines.splice(insertAt, 0, `import { cloneState } from "${commonPath}";`);
    return lines.join("\n");
}

function replaceRfdc(content, filePath) {
    const varMatch = content.match(/const (deepclone|clone) = require\("rfdc\/default"\);/);
    if (!varMatch) {
        return content;
    }
    const varName = varMatch[1];
    let next = content
        .replace(/\/\/ eslint-disable-next-line @typescript-eslint\/no-require-imports\r?\nconst (deepclone|clone) = require\("rfdc\/default"\);\r?\n/g, "")
        .replace(/const (deepclone|clone) = require\("rfdc\/default"\);\r?\n/g, "");
    const callRe = new RegExp(`\\b${varName}\\(`, "g");
    next = next.replace(callRe, "cloneState(");
    next = addCloneStateImport(next, filePath);
    return next;
}

const STRING_STATE_BLOCK =
    /if \(typeof state === "string"\) \{\s*\/\/ is the state a raw JSON obj\s*if \(state\.startsWith\("\{"\)\) \{\s*state = JSON\.parse\(state, reviver\) as ([^;]+);\s*\} else \{\s*const decoded = Buffer\.from\(state, "base64"\)[^;]*;\s*const decompressed = pako\.ungzip\(decoded, \{to: "string"\}\);\s*state = JSON\.parse\(decompressed, reviver\) as \1;\s*\}\s*\}/g;

const SERIALIZE_BLOCK =
    /\/\/ eslint-disable-next-line @typescript-eslint\/no-unused-vars\r?\n\s*public serialize\(opts\?:[^)]*\): string \{\s*const json = JSON\.stringify\(this\.state(?:\([^)]*\))?, replacer\);\s*const compressed = pako\.gzip\(json\);\s*\r?\n\s*return Buffer\.from\(compressed\)\.toString\("base64"\)[^;]*;\s*\}\r?\n/g;

function purgeCompression(content) {
    let next = content
        .replace(/\/\/ eslint-disable-next-line @typescript-eslint\/no-require-imports\r?\nconst Buffer = require\('buffer\/'\)\.Buffer[^\n]*\n/g, "")
        .replace(/import pako, \{ Data \} from "pako";\r?\n/g, "")
        .replace(/import pako from "pako";\r?\n/g, "");

    next = next.replace(
        STRING_STATE_BLOCK,
        `if (typeof state === "string") {
                if (!state.startsWith("{") && !state.startsWith("[")) {
                    throw new Error("Compressed game state must be decompressed before constructing the engine.");
                }
                state = JSON.parse(state, reviver) as $1;
            }`,
    );
    next = next.replace(SERIALIZE_BLOCK, "");
    return next;
}

function gameUidFromPath(filePath) {
    const rel = path.relative(path.join(SRC, "games"), filePath).replace(/\\/g, "/");
    return rel.split("/")[0].replace(/\.ts$/, "");
}

const files = walkTs(SRC);
for (const file of files) {
    let content = fs.readFileSync(file, "utf8");
    const uid = file.includes(`${path.sep}games${path.sep}`) ? gameUidFromPath(file) : "";
    if (content.includes("rfdc")) {
        content = replaceRfdc(content, file);
    }
    if (uid && COMPRESSION_GAMES.has(uid)) {
        content = purgeCompression(content);
    }
    content = patchRelativeImports(content, file);
    fs.writeFileSync(file, content);
}

console.log(`esm-codemod-src: updated ${files.length} files under src/`);
