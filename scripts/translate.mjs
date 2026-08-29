import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { pruneManagedLocale, pruneToSourceShape } from "./locale-prune.mjs";

const ES_US_DIALECT = [
  "Use Latin American Spanish as spoken in the United States (es-US).",
  'Use "ustedes" (not "vosotros"), LatAm vocabulary (e.g. computadora, celular, aplicación), and informal "tú" for game UI where natural.',
  "Avoid European Spanish forms (vuestro, os, ordenador).",
  "Use standard board-game terms (Pasar, Rendirse, Tablero, etc.).",
].join(" ");

const TARGET_LANGUAGES = [
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  {
    code: "es-US",
    name: "Latin American Spanish (United States)",
    dialect: ES_US_DIALECT,
  },
];

const CHUNK_BYTES = Number(process.env.TRANSLATE_CHUNK_BYTES) || 24 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_QUOTA_WAITS = Number(process.env.TRANSLATE_MAX_QUOTA_WAITS) || 10;
const MAX_WAIT_SEC = 120;
// Set TRANSLATE_CHUNK_DELAY_MS=3000 to reduce per-minute rate limits on free tier
const CHUNK_DELAY_MS = Number(process.env.TRANSLATE_CHUNK_DELAY_MS) || 0;
const DEBUG_DIR = path.join("bin", "translate-debug");

const args = process.argv.slice(2);
const debugFlag = args.includes("--debug");
const noWaitFlag = args.includes("--no-wait");
const waitOnQuota = !noWaitFlag && !process.env.CI;
const files = args.filter((arg) => !arg.startsWith("--"));

let failed = false;
let quotaPaused = false;
let partialProgress = false;

class QuotaPausedError extends Error {
  constructor(parsed, context) {
    super(parsed.message);
    this.name = "QuotaPausedError";
    this.parsed = parsed;
    this.context = context;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseApiError(error) {
  const result = {
    code: null,
    status: null,
    quotaId: null,
    retryDelaySec: 60,
    message: error?.message ?? String(error),
  };

  let payload = null;
  try {
    payload = JSON.parse(result.message);
  } catch {
    if (error?.error) {
      payload = { error: error.error };
    }
  }

  const err = payload?.error ?? null;
  if (!err) {
    return result;
  }

  result.code = err.code ?? null;
  result.status = err.status ?? null;
  result.message = err.message ?? result.message;

  for (const detail of err.details ?? []) {
    if (detail["@type"]?.includes("RetryInfo") && detail.retryDelay) {
      const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
      if (match) {
        result.retryDelaySec = Math.ceil(Number(match[1]));
      }
    }
    if (detail["@type"]?.includes("QuotaFailure")) {
      for (const violation of detail.violations ?? []) {
        if (violation.quotaId) {
          result.quotaId = violation.quotaId;
        }
      }
    }
  }

  const retryMatch = /Please retry in ([\d.]+)s/.exec(result.message);
  if (retryMatch) {
    result.retryDelaySec = Math.ceil(Number(retryMatch[1]));
  }

  return result;
}

function isDailyQuotaError(parsed) {
  if (parsed.code !== 429 && parsed.status !== "RESOURCE_EXHAUSTED") {
    return false;
  }
  if (parsed.quotaId?.includes("PerDay")) {
    return true;
  }
  return /free_tier_requests|per day|daily/i.test(parsed.message);
}

function isRetryableRateLimit(parsed) {
  if (parsed.code !== 429 && parsed.status !== "RESOURCE_EXHAUSTED") {
    return false;
  }
  return !isDailyQuotaError(parsed);
}

function formatApiErrorSummary(parsed) {
  const code = parsed.code ?? "unknown";
  const status = parsed.status ?? "error";
  const detail = parsed.quotaId ? ` (${parsed.quotaId})` : "";
  const text = parsed.message.split("\n")[0];
  return `${code} ${status}${detail}: ${text}`;
}

function printResumeSummary() {
  const command =
    files.length > 0
      ? `node scripts/translate.mjs${debugFlag ? " --debug" : ""}${noWaitFlag ? " --no-wait" : ""} ${files.join(" ")}`
      : "npm run translate";
  console.error("");
  console.error("Translation incomplete. Partial files saved. Re-run the same command to resume:");
  console.error(`  ${command}`);
}

function isTrackingKey(key) {
  return key === "_src" || key.startsWith("_src_");
}

function collectLeaves(obj, prefix = "") {
  const leaves = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return leaves;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (isTrackingKey(key)) continue;
    const leafPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      leaves[leafPath] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(leaves, collectLeaves(value, leafPath));
    }
  }
  return leaves;
}

function getLeafValue(obj, leafPath) {
  const parts = leafPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

function setLeafValue(obj, leafPath, value) {
  const parts = leafPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function unflatten(flat) {
  const result = {};
  for (const [leafPath, value] of Object.entries(flat)) {
    setLeafValue(result, leafPath, value);
  }
  return result;
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function localeRoots(sourcePath) {
  const abs = path.resolve(sourcePath);
  const localesDir = path.dirname(path.dirname(abs));
  const parent = path.dirname(localesDir);
  const repoRoot = path.basename(parent) === "public" ? path.dirname(parent) : parent;
  return { localesDir, repoRoot };
}

function srcPathFor(repoRoot, langCode, fileName) {
  return path.join(repoRoot, "locale-src", langCode, fileName);
}

function getEmbeddedSrcTracking(targetData) {
  if (targetData._src && typeof targetData._src === "object") {
    return { ...targetData._src };
  }
  const legacy = {};
  for (const [key, value] of Object.entries(targetData)) {
    if (key.startsWith("_src_") && typeof value === "string") {
      legacy[key.slice(5)] = value;
    }
  }
  return legacy;
}

function loadSrcTracking(repoRoot, langCode, fileName, targetData) {
  const srcPath = srcPathFor(repoRoot, langCode, fileName);
  if (fs.existsSync(srcPath)) {
    try {
      return JSON.parse(fs.readFileSync(srcPath, "utf-8"));
    } catch (error) {
      console.error(`[${langCode}] ${fileName}: Invalid locale-src JSON, using embedded fallback: ${error.message}`);
    }
  }
  return getEmbeddedSrcTracking(targetData);
}

function writeSrcTracking(repoRoot, langCode, fileName, srcTracking) {
  const srcPath = srcPathFor(repoRoot, langCode, fileName);
  const sortedSrc = {};
  for (const key of Object.keys(srcTracking).sort()) {
    sortedSrc[key] = srcTracking[key];
  }
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, JSON.stringify(sortedSrc, null, 2) + "\n");
}

function normalizeTrackingEntry(entry) {
  if (entry == null) {
    return { src: undefined, out: undefined };
  }
  if (typeof entry === "string") {
    return { src: entry, out: undefined };
  }
  if (typeof entry === "object") {
    return {
      src: typeof entry.src === "string" ? entry.src : undefined,
      out: typeof entry.out === "string" ? entry.out : undefined,
    };
  }
  return { src: undefined, out: undefined };
}

function makeTrackingEntry(sourceValue, translatedValue) {
  return { src: sourceValue, out: translatedValue };
}

function isSuspectEnglishCopy(value) {
  if (typeof value !== "string" || value.length < 40) {
    return false;
  }
  if (/\.\s+[A-Z]/.test(value)) {
    return true;
  }
  return value.trim().split(/\s+/).length >= 8;
}

function isVerifiedSame(trackingEntry, sourceValue, translated) {
  const { src, out } = normalizeTrackingEntry(trackingEntry);
  return src === sourceValue && out === translated;
}

function backfillSrcTracking(sourceData, targetData, srcTracking) {
  const sourceLeaves = collectLeaves(sourceData);
  let backfilled = false;
  for (const [leafPath, sourceValue] of Object.entries(sourceLeaves)) {
    const translated = getLeafValue(targetData, leafPath);
    if (!translated) {
      continue;
    }
    const { src, out } = normalizeTrackingEntry(srcTracking[leafPath]);
    if (src !== sourceValue || out !== translated) {
      srcTracking[leafPath] = makeTrackingEntry(sourceValue, translated);
      backfilled = true;
    }
  }
  return backfilled;
}

function getDiffLeaves(sourceData, targetData, srcTracking) {
  const sourceLeaves = collectLeaves(sourceData);
  const diff = {};

  for (const [leafPath, sourceValue] of Object.entries(sourceLeaves)) {
    const translated = getLeafValue(targetData, leafPath);
    const tracking = srcTracking[leafPath];
    const { src, out } = normalizeTrackingEntry(tracking);

    if (!translated) {
      diff[leafPath] = sourceValue;
      continue;
    }

    if (src !== undefined && src !== sourceValue) {
      diff[leafPath] = sourceValue;
      continue;
    }

    if (out !== undefined && out !== translated) {
      diff[leafPath] = sourceValue;
      continue;
    }

    if (translated === sourceValue) {
      if (isVerifiedSame(tracking, sourceValue, translated)) {
        continue;
      }
      if (isSuspectEnglishCopy(sourceValue)) {
        diff[leafPath] = sourceValue;
      }
    }
  }

  return diff;
}

function chunkLeaves(diffLeaves, budgetBytes) {
  const entries = Object.entries(diffLeaves);
  const chunks = [];
  let current = {};
  let currentSize = 2;

  for (const [leafPath, value] of entries) {
    const entrySize = JSON.stringify({ [leafPath]: value }).length + 1;
    if (Object.keys(current).length > 0 && currentSize + entrySize > budgetBytes) {
      chunks.push(current);
      current = {};
      currentSize = 2;
    }
    current[leafPath] = value;
    currentSize += entrySize;
  }

  if (Object.keys(current).length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function buildPrompt(lang) {
  const dialectBlock = lang.dialect ? `\n\nDIALECT:\n${lang.dialect}` : "";
  return `You are an expert translator specializing in UI strings for abstract strategy board games (like Chess, Go, Tak, etc.).
Translate the provided JSON key-value pairs from English to ${lang.name} (${lang.code}).${dialectBlock}

STRICT RULES:
1. Preserve all placeholders verbatim (e.g. {{count}}, {{player}}, {0}, %s, HTML tags). Do not modify variables inside braces.
2. Use natural tabletop gaming terms (e.g., "Pass", "Resign", "Stalemate", "Hand", "Pip", "Board").
3. Return a JSON object matching the exact input keys supplied, with translated string values.
4. Preserve all Markdown syntax exactly: [text](url), *italic*, **bold**, \`code\`, bullet lists, and literal \\n newlines.
5. Return ONLY valid JSON. Escape all double quotes inside string values as \\". Do not use smart or curly quotes.
6. Do not translate URLs, placeholder tokens, or content inside backticks unless natural in the target language.`;
}

function stripCodeFences(rawText) {
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return text;
}

function parseModelJson(rawText) {
  const cleaned = stripCodeFences(rawText);
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw firstError;
      }
    }
    throw firstError;
  }
}

function parseErrorContext(rawText, error) {
  const match = /position (\d+)/.exec(error.message);
  if (!match) {
    return { offset: null, line: null, column: null, context: null };
  }

  const offset = Number(match[1]);
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < rawText.length; i++) {
    if (rawText[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return {
    offset,
    line,
    column,
    context: rawText.slice(Math.max(0, offset - 100), Math.min(rawText.length, offset + 100)),
  };
}

function writeDebugArtifacts({ langCode, fileName, chunkIndex, chunkKeys, rawText, error }) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${langCode}-${fileName}-chunk${chunkIndex + 1}-${stamp}`;
  const rawPath = path.join(DEBUG_DIR, `${base}.raw.txt`);
  const metaPath = path.join(DEBUG_DIR, `${base}.meta.json`);
  const context = parseErrorContext(rawText, error);

  fs.writeFileSync(rawPath, rawText);
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        lang: langCode,
        file: fileName,
        chunk: chunkIndex + 1,
        keys: chunkKeys,
        error: error.message,
        ...context,
      },
      null,
      2,
    ) + "\n",
  );

  console.error(`[${langCode}] ${fileName}: Debug artifacts written:`);
  console.error(`  ${rawPath}`);
  console.error(`  ${metaPath}`);
}

function writeDebugSuccess({ langCode, fileName, chunkIndex, rawText }) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawPath = path.join(DEBUG_DIR, `${langCode}-${fileName}-chunk${chunkIndex + 1}-${stamp}.success.raw.txt`);
  fs.writeFileSync(rawPath, rawText);
  console.log(`[${langCode}] ${fileName}: Debug response saved to ${rawPath}`);
}

function writeTargetFile(targetPath, repoRoot, langCode, fileName, sourceData, targetData, srcTracking) {
  const cleanTargetData = pruneToSourceShape(sourceData, targetData) ?? {};
  fs.writeFileSync(targetPath, JSON.stringify(cleanTargetData, null, 2) + "\n");
  writeSrcTracking(repoRoot, langCode, fileName, srcTracking);
}

function summarizeChunkKeys(chunk) {
  const keys = Object.keys(chunk);
  if (keys.length === 0) return "0 keys";
  if (keys.length === 1) return keys[0];
  return `${keys[0]} … +${keys.length - 1} keys`;
}

async function callModel(ai, lang, chunk, prompt) {
  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: `${prompt}\n\nInput JSON:\n${JSON.stringify(chunk, null, 2)}`,
    config: {
      responseMimeType: "application/json",
    },
  });
  return response.text?.trim() ?? "";
}

async function translateChunk(ai, lang, chunk, chunkIndex, totalChunks, fileName, quotaContext) {
  const prompt = buildPrompt(lang);
  const chunkKeys = Object.keys(chunk);
  let lastRawText = "";
  let lastError = null;
  let parseAttempt = 0;
  let quotaWaits = 0;

  while (parseAttempt < MAX_ATTEMPTS) {
    try {
      lastRawText = await callModel(ai, lang, chunk, prompt);
      const translatedChunk = parseModelJson(lastRawText);

      if (debugFlag) {
        writeDebugSuccess({
          langCode: lang.code,
          fileName,
          chunkIndex,
          rawText: lastRawText,
        });
      }

      return translatedChunk;
    } catch (error) {
      lastError = error;
      const parsed = parseApiError(error);

      if (isDailyQuotaError(parsed)) {
        throw new QuotaPausedError(parsed, quotaContext);
      }

      if (isRetryableRateLimit(parsed)) {
        if (!waitOnQuota) {
          console.error(
            `[${lang.code}] ${fileName}: chunk ${chunkIndex + 1}/${totalChunks} rate limited: ${formatApiErrorSummary(parsed)}`,
          );
          if (process.env.CI) {
            console.error(`[${lang.code}] ${fileName}: Auto-wait disabled in CI. Re-run locally or upgrade API quota.`);
          } else {
            console.error(`[${lang.code}] ${fileName}: Auto-wait disabled (--no-wait). Re-run later to resume.`);
          }
          throw error;
        }

        if (quotaWaits >= MAX_QUOTA_WAITS) {
          console.error(
            `[${lang.code}] ${fileName}: chunk ${chunkIndex + 1}/${totalChunks} rate limit persists after ${MAX_QUOTA_WAITS} waits.`,
          );
          throw error;
        }

        const waitSec = Math.min(parsed.retryDelaySec + 1, MAX_WAIT_SEC);
        quotaWaits++;
        console.log(
          `[${lang.code}] ${fileName}: chunk ${chunkIndex + 1}/${totalChunks} rate limited, waiting ${waitSec}s (wait ${quotaWaits}/${MAX_QUOTA_WAITS})...`,
        );
        await sleep(waitSec * 1000);
        continue;
      }

      parseAttempt++;
      const summary = parsed.code ? formatApiErrorSummary(parsed) : error.message.split("\n")[0];
      console.error(
        `[${lang.code}] ${fileName}: chunk ${chunkIndex + 1}/${totalChunks} attempt ${parseAttempt}/${MAX_ATTEMPTS} failed: ${summary}`,
      );
    }
  }

  writeDebugArtifacts({
    langCode: lang.code,
    fileName,
    chunkIndex,
    chunkKeys,
    rawText: lastRawText,
    error: lastError,
  });
  throw lastError;
}

async function translateFile(ai, sourcePath) {
  if (quotaPaused) {
    return;
  }

  if (!fs.existsSync(sourcePath)) {
    console.error(`File not found: ${sourcePath}`);
    failed = true;
    return;
  }

  const sourceData = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  const { localesDir, repoRoot } = localeRoots(sourcePath);
  const fileName = path.basename(sourcePath);

  for (const lang of TARGET_LANGUAGES) {
    if (quotaPaused) {
      break;
    }

    const targetDir = path.join(localesDir, lang.code);
    const targetPath = path.join(targetDir, fileName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let targetData = {};
    if (fs.existsSync(targetPath)) {
      try {
        targetData = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
      } catch (error) {
        console.error(`[${lang.code}] ${fileName}: Invalid target JSON, starting fresh: ${error.message}`);
        targetData = {};
      }
    }

    let srcTracking = loadSrcTracking(repoRoot, lang.code, fileName, targetData);
    const pruneResult = pruneManagedLocale({ sourceData, targetData, srcTracking });
    targetData = pruneResult.targetData;
    srcTracking = pruneResult.srcTracking;
    if (pruneResult.changed) {
      writeTargetFile(targetPath, repoRoot, lang.code, fileName, sourceData, targetData, srcTracking);
      const parts = [];
      if (pruneResult.removedLeaves > 0) {
        parts.push(`${pruneResult.removedLeaves} stale translation leaf${pruneResult.removedLeaves === 1 ? "" : "ves"}`);
      }
      if (pruneResult.removedTracking > 0) {
        parts.push(`${pruneResult.removedTracking} locale-src entr${pruneResult.removedTracking === 1 ? "y" : "ies"}`);
      }
      console.log(`[${lang.code}] ${fileName}: Pruned ${parts.join(", ")}.`);
    }

    const diffLeaves = getDiffLeaves(sourceData, targetData, srcTracking);
    const leavesToTranslate = Object.keys(diffLeaves);

    if (leavesToTranslate.length === 0) {
      if (backfillSrcTracking(sourceData, targetData, srcTracking)) {
        writeSrcTracking(repoRoot, lang.code, fileName, srcTracking);
        console.log(`[${lang.code}] ${fileName}: Backfilled locale-src stamps (translations already up to date).`);
      } else {
        console.log(`[${lang.code}] ${fileName}: 100% up to date. Skipping.`);
      }
      continue;
    }

    const chunks = chunkLeaves(diffLeaves, CHUNK_BYTES);
    console.log(
      `[${lang.code}] ${fileName}: Translating ${leavesToTranslate.length} new/updated leaves in ${chunks.length} chunk(s)...`,
    );

    let langFailed = false;
    let completedChunks = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.log(
        `[${lang.code}] ${fileName}: chunk ${chunkIndex + 1}/${chunks.length} (${summarizeChunkKeys(chunk)})`,
      );

      try {
        const translatedChunk = await translateChunk(ai, lang, chunk, chunkIndex, chunks.length, fileName, {
          targetPath,
          chunkIndex,
          totalChunks: chunks.length,
        });
        const nestedChunk = unflatten(translatedChunk);

        deepMerge(targetData, nestedChunk);

        for (const leafPath of Object.keys(chunk)) {
          const sourceValue = diffLeaves[leafPath];
          const translatedValue = translatedChunk[leafPath] ?? getLeafValue(targetData, leafPath);
          srcTracking[leafPath] = makeTrackingEntry(sourceValue, translatedValue);
        }

        writeTargetFile(targetPath, repoRoot, lang.code, fileName, sourceData, targetData, srcTracking);
        completedChunks++;
        partialProgress = true;

        if (CHUNK_DELAY_MS > 0 && chunkIndex < chunks.length - 1) {
          await sleep(CHUNK_DELAY_MS);
        }
      } catch (error) {
        if (error instanceof QuotaPausedError) {
          quotaPaused = true;
          partialProgress = completedChunks > 0 || fs.existsSync(targetPath);
          console.error(`[${lang.code}] ${fileName}: Daily API quota exhausted.`);
          console.error(
            `Partial progress saved to ${targetPath} (${completedChunks}/${chunks.length} chunks complete).`,
          );
          console.error("Re-run tomorrow or upgrade billing: https://ai.google.dev/gemini-api/docs/rate-limits");
          return;
        }

        console.error(
          `[${lang.code}] ${fileName}: Error translating chunk ${chunkIndex + 1}: ${error.message.split("\n")[0]}`,
        );
        failed = true;
        langFailed = true;
        partialProgress = completedChunks > 0 || fs.existsSync(targetPath);
        break;
      }
    }

    if (!langFailed) {
      console.log(`[${lang.code}] ${fileName}: Updated successfully.`);
    }
  }
}

async function run() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable is required.");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("Usage: node scripts/translate.mjs [--debug] [--no-wait] <source.json> [...]");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  for (const file of files) {
    await translateFile(ai, file);
    if (quotaPaused) {
      break;
    }
  }

  if (quotaPaused) {
    printResumeSummary();
    process.exit(2);
  }

  if (failed) {
    if (partialProgress) {
      printResumeSummary();
    }
    process.exit(1);
  }
}

run();
