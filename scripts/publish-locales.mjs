/* eslint-env node */
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

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

const SUPPORTED_LANGUAGES = ["en", "fr", "de", "it"];
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

function stripSrc(data, lang) {
  if (lang === "en" || !data || typeof data !== "object") {
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _src, ...rest } = data;
  return rest;
}

function prepareLocaleFile(sourcePath, lang) {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const data = JSON.parse(raw);
  const cleaned = stripSrc(data, lang);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-locales-"));
  const tmpPath = path.join(tmpDir, path.basename(sourcePath));
  fs.writeFileSync(tmpPath, JSON.stringify(cleaned));
  return { tmpPath, tmpDir };
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
  const tmpDirs = [];

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
      const { tmpPath, tmpDir } = prepareLocaleFile(sourcePath, lang);
      tmpDirs.push(tmpDir);
      uploadFile(tmpPath, `locales/${lang}/${file}`, config);
      count += 1;
    }
  }

  for (const tmpDir of tmpDirs) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return count;
}

function main() {
  const { stage, config } = parseArgs();
  console.log(`Publishing gameslib locale files to ${config.bucket} (${stage})`);

  const localesDir = path.join(ROOT, "locales");
  const total = uploadLocaleDir(localesDir, config);

  if (total === 0) {
    console.error("No locale files found to upload");
    process.exit(1);
  }

  console.log(`Done. Published ${total} locale file(s).`);
}

main();
