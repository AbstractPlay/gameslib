/* eslint-env node */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { filterLocalesForProd } from "./filter-locales-prod.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const STAGE_CONFIG = {
  dev: {
    bucket: "abstract-play-dev",
    profile: "AbstractPlayDev",
  },
  prod: {
    bucket: "abstract-play-prod",
    profile: "AbstractPlayProd",
  },
};

const SUPPORTED_LANGUAGES = ["en", "fr", "de", "it", "es-US"];
const MANAGED_LANGUAGES = ["fr", "de", "it", "es-US"];
const CACHE_CONTROL = "public, max-age=3600";

function parseArgs() {
  const args = process.argv.slice(2);
  const stageIdx = args.indexOf("--stage");
  const stage = stageIdx >= 0 ? args[stageIdx + 1] : "dev";
  if (!STAGE_CONFIG[stage]) {
    console.error(`Unknown stage "${stage}". Use --stage dev|prod`);
    process.exit(1);
  }
  return { stage, config: STAGE_CONFIG[stage] };
}

function assertNoEmbeddedSrc(data, lang, fileName) {
  if (!MANAGED_LANGUAGES.includes(lang) || !data || typeof data !== "object") {
    return;
  }
  if (data._src) {
    console.error(`Refusing to publish ${lang}/${fileName}: embedded _src found (use locale-src/ sidecars)`);
    process.exit(1);
  }
  for (const key of Object.keys(data)) {
    if (key.startsWith("_src_")) {
      console.error(`Refusing to publish ${lang}/${fileName}: embedded ${key} found (use locale-src/ sidecars)`);
      process.exit(1);
    }
  }
}

function uploadFile(localPath, s3Key, config) {
  const s3Uri = `s3://${config.bucket}/${s3Key}`;
  const cmd = [
    "aws",
    "s3",
    "cp",
    JSON.stringify(localPath),
    JSON.stringify(s3Uri),
    "--content-type",
    "application/json",
    "--cache-control",
    JSON.stringify(CACHE_CONTROL),
    "--profile",
    config.profile,
  ].join(" ");
  console.log(`Uploading ${s3Key}`);
  execSync(cmd, { stdio: "inherit" });
}

function uploadLocaleDir(localDir, config) {
  if (!fs.existsSync(localDir)) {
    console.error(`Locale dir not found: ${localDir}`);
    process.exit(1);
  }

  let count = 0;

  for (const lang of SUPPORTED_LANGUAGES) {
    const langDir = path.join(localDir, lang);
    if (!fs.existsSync(langDir)) {
      continue;
    }

    for (const file of fs.readdirSync(langDir)) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const sourcePath = path.join(langDir, file);
      const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
      assertNoEmbeddedSrc(data, lang, file);
      uploadFile(sourcePath, `locales/${lang}/${file}`, config);
      count += 1;
    }
  }

  return count;
}

function main() {
  const { stage, config } = parseArgs();
  console.log(`Publishing gameslib locale files to ${config.bucket} (${stage})`);

  let localesDir = path.join(ROOT, "locales");
  if (stage === "prod") {
    const metaPath = path.join(ROOT, "src", "games", "_registry-meta.generated.json");
    if (!fs.existsSync(metaPath)) {
      console.error("Missing registry meta — run npm run generate-registry first");
      process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const filteredDir = path.join(ROOT, "build", "locales-publish-prod");
    filterLocalesForProd(localesDir, filteredDir, meta.experimentalUids ?? []);
    localesDir = filteredDir;
  }

  const total = uploadLocaleDir(localesDir, config);

  if (total === 0) {
    console.error("No locale files found to upload");
    process.exit(1);
  }

  console.log(`Done. Published ${total} locale file(s).`);
}

main();
