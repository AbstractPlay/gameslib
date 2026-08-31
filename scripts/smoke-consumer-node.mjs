/* eslint-env node */
/**
 * Consumer smoke: install the packed tarball in a temp project and import like
 * front test:engines / node-backend (package name resolution, not repo paths).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findTgz() {
    const fromArgv = process.argv[2];
    if (fromArgv) {
        return path.isAbsolute(fromArgv) ? fromArgv : path.join(ROOT, fromArgv);
    }
    const existing = fs
        .readdirSync(ROOT)
        .filter((name) => name.endsWith(".tgz") && name.includes("gameslib"))
        .sort()
        .at(-1);
    if (existing) {
        return path.join(ROOT, existing);
    }
    const packed = execSync("npm pack --silent", { cwd: ROOT, encoding: "utf8" }).trim();
    return path.join(ROOT, packed);
}

try {
    const tgzPath = findTgz();
    if (!fs.existsSync(tgzPath)) {
        throw new Error(`packed tarball not found: ${tgzPath}`);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gameslib-consumer-"));
    fs.writeFileSync(
        path.join(tmp, "package.json"),
        `${JSON.stringify({ name: "gameslib-consumer-smoke", type: "module", private: true }, null, 2)}\n`,
    );
    const npmrcPath = path.join(ROOT, ".npmrc");
    if (fs.existsSync(npmrcPath)) {
        fs.copyFileSync(npmrcPath, path.join(tmp, ".npmrc"));
    } else if (process.env.NODE_AUTH_TOKEN) {
        fs.writeFileSync(
            path.join(tmp, ".npmrc"),
            "@abstractplay:registry=https://npm.pkg.github.com/\n" +
                `//npm.pkg.github.com/:_authToken=${process.env.NODE_AUTH_TOKEN}\n`,
        );
    }
    execSync(`npm install "${tgzPath}"`, { cwd: tmp, stdio: "inherit" });

    const consumer = path.join(tmp, "consumer.mjs");
    fs.writeFileSync(
        consumer,
        `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { GameFactory, gameinfo } = await import("@abstractplay/gameslib");
if (typeof GameFactory !== "function") {
  throw new Error("GameFactory missing from @abstractplay/gameslib");
}
require("@abstractplay/gameslib/package.json");
console.log(\`smoke-consumer-node: ok (\${gameinfo.size} games)\`);
`,
    );
    execSync(`node "${consumer}"`, { cwd: tmp, stdio: "inherit" });
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`smoke-consumer-node: ${message}`);
    process.exit(1);
}
