/* eslint-env node */
/**
 * Validate ci-deps manifests and (optionally) package.json sync after install-ap-deps.
 *
 *   node bin/check-ci-deps.mjs                    manifest validation only
 *   node bin/check-ci-deps.mjs --stage dev --strict   fail if package.json drifts from ci-deps.<stage>.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_AP_DEPS = fs.existsSync(path.join(ROOT, "bin", "install-ap-deps.mjs"))
  ? "node bin/install-ap-deps.mjs"
  : "node scripts/install-ap-deps.mjs";

function parseArgs(argv) {
  let stage = null;
  let strict = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--stage" && argv[i + 1]) {
      stage = argv[++i];
    } else if (argv[i] === "--strict") {
      strict = true;
    }
  }
  if (stage && stage !== "dev" && stage !== "prod") {
    throw new Error(`Invalid --stage "${stage}" (expected dev or prod)`);
  }
  if (strict && !stage) {
    throw new Error("--strict requires --stage dev or prod");
  }
  return { stage, strict };
}

function fail(message) {
  console.error(`check-ci-deps: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`check-ci-deps: warning: ${message}`);
}

const { stage: checkStage, strict } = parseArgs(process.argv);

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

const pkgJsonPath = path.join(ROOT, "package.json");
const pkgJson = fs.existsSync(pkgJsonPath)
  ? JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
  : null;
const deps = pkgJson?.dependencies ?? {};

const requiredManifestKeys = [
  { dep: "@abstractplay/gameslib", key: "gameslib" },
  { dep: "@abstractplay/recranks", key: "recranks" },
];

for (const { dep, key } of requiredManifestKeys) {
  if (!(dep in deps)) {
    continue;
  }
  const pinsThisPackage = stages.some((stage) => manifests[stage][key] != null);
  if (!pinsThisPackage) {
    continue;
  }
  for (const stage of stages) {
    if (!manifests[stage][key]) {
      fail(`ci-deps.${stage}.json must include ${key} for this consumer`);
    }
  }
}

if (
  manifests.prod.gameslib &&
  manifests.dev.gameslib &&
  manifests.prod.gameslib === manifests.dev.gameslib
) {
  warn("prod and dev pin the same gameslib version");
}

if (manifests.prod.renderer === manifests.dev.renderer) {
  warn("prod and dev pin the same renderer version");
}

function checkDrift(stage) {
  if (!pkgJson) {
    return;
  }
  const manifest = manifests[stage];
  const fix = `run: npm run sync-deps${stage === "prod" ? ":prod" : ""} (or ${INSTALL_AP_DEPS} --stage ${stage})`;

  if (deps["@abstractplay/gameslib"] && manifest.gameslib) {
    if (deps["@abstractplay/gameslib"] !== manifest.gameslib) {
      const msg =
        `package.json gameslib (${deps["@abstractplay/gameslib"]}) differs from ` +
        `ci-deps.${stage}.json (${manifest.gameslib}); ${fix}`;
      if (strict) {
        fail(msg);
      }
      warn(msg);
    }
  }

  if (deps["@abstractplay/recranks"] && manifest.recranks) {
    if (deps["@abstractplay/recranks"] !== manifest.recranks) {
      const msg =
        `package.json recranks (${deps["@abstractplay/recranks"]}) differs from ` +
        `ci-deps.${stage}.json (${manifest.recranks}); ${fix}`;
      if (strict) {
        fail(msg);
      }
      warn(msg);
    }
  }

  if (manifest.renderer && deps["@abstractplay/renderer"] !== manifest.renderer) {
    const msg =
      `package.json renderer (${deps["@abstractplay/renderer"]}) differs from ` +
      `ci-deps.${stage}.json (${manifest.renderer}); ${fix}`;
    if (strict) {
      fail(msg);
    }
    warn(msg);
  }

  const overrideRenderer = pkgJson.overrides?.["@abstractplay/renderer"];
  if (manifest.renderer && overrideRenderer && overrideRenderer !== manifest.renderer) {
    const msg =
      `package.json overrides renderer (${overrideRenderer}) differs from ` +
      `ci-deps.${stage}.json (${manifest.renderer}); ${fix}`;
    if (strict) {
      fail(msg);
    }
    warn(msg);
  }
}

if (checkStage) {
  checkDrift(checkStage);
}

console.log("check-ci-deps OK");
