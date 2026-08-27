/* eslint-env node */
/**
 * Guard against ESM-only packages in a CommonJS Lambda init graph.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const NANOID_MAX_CJS_MAJOR = 3;

function fail(message) {
  console.error(`check-cjs-runtime-deps: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveInstalledVersion(name) {
  try {
    const pkgPath = require.resolve(`${name}/package.json`);
    return readJson(pkgPath).version;
  } catch {
    return null;
  }
}

function checkKnownEsmOnlyPackages() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const overrides = pkg.overrides ?? {};
  const version = resolveInstalledVersion("nanoid");
  if (!version) {
    return;
  }
  const major = Number.parseInt(version.split(".")[0], 10);
  if (major > NANOID_MAX_CJS_MAJOR && !overrides.nanoid) {
    fail(
      `nanoid@${version} is ESM-only; pin overrides.nanoid to 3.3.x for Lambda CJS`,
    );
  }
}

checkKnownEsmOnlyPackages();
console.log("check-cjs-runtime-deps OK");
