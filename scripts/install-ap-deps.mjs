/* eslint-env node */
/**
 * Resolve and install pinned @abstractplay/renderer for gameslib CI.
 *
 * Resolution order:
 *   1. AP_RENDERER_VERSION env (from repository_dispatch)
 *   2. ci-deps.<stage>.json (ci-deps.dev.json or ci-deps.prod.json)
 *   3. fallback: @development (dev) or @latest (prod)
 *
 * Usage: node scripts/install-ap-deps.mjs --stage dev|prod
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_CI_DEPS_PATH = path.join(ROOT, "ci-deps.json");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");

function parseArgs(argv) {
    let stage = "dev";
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--stage" && argv[i + 1]) {
            stage = argv[++i];
        }
    }
    if (stage !== "dev" && stage !== "prod") {
        throw new Error(`Invalid --stage "${stage}" (expected dev or prod)`);
    }
    return { stage };
}

function ciDepsPath(stage) {
    return path.join(ROOT, `ci-deps.${stage}.json`);
}

function manifestLabel(stage) {
    return `ci-deps.${stage}.json`;
}

function readJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function readManifest(stage) {
    const staged = readJson(ciDepsPath(stage));
    if (staged) {
        return staged;
    }
    const legacy = readJson(LEGACY_CI_DEPS_PATH);
    if (legacy) {
        console.warn(
            `Warning: using legacy ci-deps.json; migrate to ${manifestLabel(stage)}`,
        );
        return legacy;
    }
    return null;
}

function getInstalledVersion(pkg) {
    const pkgPath = path.join(ROOT, "node_modules", ...pkg.split("/"), "package.json");
    if (fs.existsSync(pkgPath)) {
        return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
    }

    try {
        const out = execSync(`npm ls ${pkg} --depth=0 --json`, {
            cwd: ROOT,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return JSON.parse(out).dependencies?.[pkg]?.version ?? null;
    } catch (err) {
        if (err.stdout) {
            try {
                return JSON.parse(err.stdout).dependencies?.[pkg]?.version ?? null;
            } catch {
                return null;
            }
        }
        return null;
    }
}

function resolveVersions({ stage }) {
    const dispatchRenderer = process.env.AP_RENDERER_VERSION?.trim() || null;
    const manifest = readManifest(stage);
    const manifestName = manifestLabel(stage);

    let renderer = dispatchRenderer || manifest?.renderer || null;
    let source = manifestName;

    if (dispatchRenderer) {
        source = process.env.AP_SOURCE || "repository_dispatch";
    }

    const tag = stage === "prod" ? "latest" : "development";

    if (!renderer) {
        console.warn(`No renderer version resolved; falling back to @${tag}`);
        renderer = tag;
        source = `fallback@${tag}`;
    }

    return { stage, renderer, source };
}

function syncPackageJson(pkgJson, versions) {
    pkgJson.dependencies = pkgJson.dependencies ?? {};
    pkgJson.dependencies["@abstractplay/renderer"] = versions.renderer;
    writeJson(PACKAGE_JSON_PATH, pkgJson);
}

function installRenderer(renderer) {
    const spec = `@abstractplay/renderer@${renderer}`;
    console.log(`Installing: ${spec}`);
    execSync(`npm install --save-exact ${spec}`, {
        cwd: ROOT,
        stdio: "inherit",
    });
}

function versionMatches(installed, expected) {
    if (!installed) {
        return false;
    }
    if (expected === "development" || expected === "latest") {
        return true;
    }
    return installed === expected;
}

function verifyInstalledVersion(versions) {
    const installedRenderer = getInstalledVersion("@abstractplay/renderer");
    if (!versionMatches(installedRenderer, versions.renderer)) {
        throw new Error(
            `Renderer version mismatch: expected ${versions.renderer}, got ${installedRenderer}`,
        );
    }
    console.log(`@abstractplay/renderer@${installedRenderer}`);
}

function writeCiDeps(versions) {
    const data = {
        renderer: versions.renderer,
        updatedAt: new Date().toISOString(),
        source: versions.source,
    };
    writeJson(ciDepsPath(versions.stage), data);
}

function writeGithubOutput(versions) {
    const outFile = process.env.GITHUB_OUTPUT;
    if (!outFile) {
        return;
    }
    fs.appendFileSync(outFile, `renderer_version=${versions.renderer}\n`);
}

const args = parseArgs(process.argv);
const pkgJson = readJson(PACKAGE_JSON_PATH);
if (!pkgJson) {
    throw new Error(`Missing ${PACKAGE_JSON_PATH}`);
}

const versions = resolveVersions(args);
console.log("Resolved AP dependency versions:", versions);

syncPackageJson(pkgJson, versions);
installRenderer(versions.renderer);
verifyInstalledVersion(versions);
writeCiDeps(versions);
writeGithubOutput(versions);

console.log("AP dependencies installed and verified.");
