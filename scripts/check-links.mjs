#!/usr/bin/env node
/* eslint-env node */
/**
 * Audit gameinfo URLs in src/games/*.ts and Markdown links in locales/en/apgames.json notes.
 *
 * Usage:
 *   node scripts/check-links.mjs [--fail] [--verbose|-v] [--concurrency N]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project, SyntaxKind } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const APGAMES_PATH = path.join(ROOT, "locales", "en", "apgames.json");

const DEFAULT_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_BODY_BYTES = 256_000;
const USER_AGENT = "AbstractPlay-gameslib-link-checker/1.0";

const PARKING_PHRASES = [
  "domain is for sale",
  "this domain is for sale",
  "buy this domain",
  "domain may be for sale",
  "inquire about this domain",
  "domain parking",
  "parked domain",
  "this webpage is parked",
  "parked free",
  "sedoparking",
  "hugedomains",
  "afternic",
  "dan.com",
  "forsale landing",
  "is parked courtesy of",
  "godaddy parking",
  "namecheap parking",
  "this site can't be reached",
];

const TRUSTED_HOST_SUFFIXES = [
  "abstractplay.com",
  "abstractgames.org",
  "boardgamegeek.com",
  "wikipedia.org",
  "decktet.com",
  "arimaa.com",
  "looneylabs.com",
  "github.io",
  "github.com",
  "google.com",
  "youtu.be",
  "youtube.com",
  "spielstein.com",
  "marksteeregames.com",
  "senseis.xmp.net",
  "logygames.com",
  "cambolbro.com",
  "mindsports.nl",
  "eblong.com",
  "mcdemarco.net",
  "wunderland.com",
  "ibiblio.org",
  "zillions-of-games.com",
  "daltons.ca",
  "perlkonig.com",
  "blackandwhite.develz.org",
  "jpneto.github.io",
];

const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const MARKDOWN_AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^>]+)>/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function parseArgs(argv) {
  const args = {
    fail: false,
    verbose: false,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fail") {
      args.fail = true;
    } else if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    } else if (arg === "--concurrency") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--concurrency requires a positive number");
      }
      args.concurrency = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

function stringLiteralValue(node) {
  return node.getLiteralText();
}

function collectUrlsFromInitializer(initializer, pathPrefix, out) {
  if (!initializer) {
    return;
  }

  if (initializer.isKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const prop of initializer.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) {
        continue;
      }
      const name = prop.getName();
      const childPath = pathPrefix ? `${pathPrefix}.${name}` : name;
      const init = prop.getInitializer();
      if (!init) {
        continue;
      }
      if (name === "urls" && init.isKind(SyntaxKind.ArrayLiteralExpression)) {
        const urls = [];
        for (const element of init.getElements()) {
          if (element.isKind(SyntaxKind.StringLiteral)) {
            urls.push(stringLiteralValue(element));
          }
        }
        out.push({ path: childPath, urls });
      } else {
        collectUrlsFromInitializer(init, childPath, out);
      }
    }
    return;
  }

  if (initializer.isKind(SyntaxKind.ArrayLiteralExpression)) {
    let index = 0;
    for (const element of initializer.getElements()) {
      collectUrlsFromInitializer(element, `${pathPrefix}[${index}]`, out);
      index++;
    }
  }
}

function extractGameinfoFromFile(filePath) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 99, // ESNext — enough for parsing game files
    },
  });
  const sourceFile = project.addSourceFileAtPath(filePath);

  for (const classDecl of sourceFile.getClasses()) {
    const prop = classDecl.getProperty("gameinfo");
    if (!prop) {
      continue;
    }
    const init = prop.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
      continue;
    }

    const uidProp = init.getProperty("uid");
    const nameProp = init.getProperty("name");
    const uid =
      uidProp?.isKind(SyntaxKind.PropertyAssignment) &&
      uidProp.getInitializer()?.isKind(SyntaxKind.StringLiteral)
        ? stringLiteralValue(uidProp.getInitializer())
        : path.basename(filePath, ".ts");
    const name =
      nameProp?.isKind(SyntaxKind.PropertyAssignment) &&
      nameProp.getInitializer()?.isKind(SyntaxKind.StringLiteral)
        ? stringLiteralValue(nameProp.getInitializer())
        : uid;

    const urlEntries = [];
    collectUrlsFromInitializer(init, "gameinfo", urlEntries);
    return { uid, name, filePath, urlEntries };
  }

  return null;
}

function loadGameinfoRecords() {
  const records = [];
  const files = fs
    .readdirSync(GAMES_DIR)
    .filter((name) => name.endsWith(".ts") && !name.startsWith("_"))
    .sort();

  for (const fileName of files) {
    const filePath = path.join(GAMES_DIR, fileName);
    const source = fs.readFileSync(filePath, "utf8");
    if (!source.includes("gameinfo: APGamesInformation")) {
      continue;
    }
    const record = extractGameinfoFromFile(filePath);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function extractMarkdownLinks(markdown, gameUid) {
  const links = [];
  const seen = new Set();

  const add = (url, label) => {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    links.push({
      url: trimmed,
      source: `apgames:notes.${gameUid}`,
      path: `notes.${gameUid}`,
      gameUid,
      label,
    });
  };

  for (const match of markdown.matchAll(MARKDOWN_LINK_RE)) {
    add(match[2], match[1]);
  }
  for (const match of markdown.matchAll(MARKDOWN_AUTOLINK_RE)) {
    add(match[1], match[1]);
  }
  for (const match of markdown.matchAll(BARE_URL_RE)) {
    add(match[0], match[0]);
  }

  return links;
}

function loadNotesLinks() {
  const data = JSON.parse(fs.readFileSync(APGAMES_PATH, "utf8"));
  const notes = data.notes ?? {};
  const links = [];

  for (const [gameUid, markdown] of Object.entries(notes)) {
    if (typeof markdown !== "string") {
      continue;
    }
    links.push(...extractMarkdownLinks(markdown, gameUid));
  }

  return links;
}

function isSkippableUrl(url) {
  if (!url || typeof url !== "string") {
    return true;
  }
  const lower = url.toLowerCase();
  if (lower.startsWith("mailto:") || lower.startsWith("javascript:") || lower.startsWith("#")) {
    return true;
  }
  if (!/^https?:\/\//i.test(url)) {
    return true;
  }
  return false;
}

function normalizeUrl(url) {
  return url.replace(/[),.]+$/g, "");
}

function gameKeywords(gameName, gameUid) {
  const tokens = new Set();
  const addTokens = (value) => {
    if (!value) {
      return;
    }
    for (const part of value.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 4) {
        tokens.add(part);
      }
    }
  };
  addTokens(gameName);
  addTokens(gameUid);
  return tokens;
}

function stripHtml(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function urlMentionsGame(parsedUrl, gameUid, gameName) {
  const haystack = `${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase();
  const uid = gameUid.toLowerCase();
  if (uid.length >= 3 && haystack.includes(uid)) {
    return true;
  }
  for (const part of gameName.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length >= 4 && haystack.includes(part)) {
      return true;
    }
  }
  return false;
}

function shouldCheckGameRelevance(context) {
  if (context.path?.includes(".people[")) {
    return false;
  }
  return true;
}
function hostIsTrusted(hostname) {
  const host = hostname.toLowerCase();
  return TRUSTED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function looksLikeParkingPage(text) {
  const lower = text.toLowerCase();
  return PARKING_PHRASES.some((phrase) => lower.includes(phrase));
}

function pageMentionsGame(text, keywords) {
  if (keywords.size === 0) {
    return true;
  }
  const lower = text.toLowerCase();
  for (const token of keywords) {
    if (lower.includes(token)) {
      return true;
    }
  }
  return false;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(url) {
  const transientStatuses = new Set([404, 408, 429, 500, 502, 503, 504]);
  let lastResponse;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    lastResponse = await fetchWithTimeout(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: FETCH_HEADERS,
      },
      FETCH_TIMEOUT_MS,
    );
    if (!transientStatuses.has(lastResponse.status)) {
      return lastResponse;
    }
  }

  return lastResponse;
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.length;
  }

  try {
    await reader.cancel();
  } catch {
    // ignore
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

async function checkUrl(url, context) {
  const normalized = normalizeUrl(url);
  if (isSkippableUrl(normalized)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      url: normalized,
      ...context,
      issue: "invalid-url",
      detail: "URL could not be parsed",
    };
  }

  const keywords = gameKeywords(context.gameName, context.gameUid);

  try {
    const response = await fetchPage(parsed.href);

    if (response.status === 403 && /(?:^|\.)boardgamegeek\.com$|\.fandom\.com$/.test(parsed.hostname)) {
      return null;
    }

    if (response.status >= 400) {
      return {
        url: normalized,
        ...context,
        issue: "http-error",
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text") && !contentType.includes("html") && !contentType.includes("json")) {
      return null;
    }

    const body = await readLimitedText(response, MAX_BODY_BYTES);
    const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? "";
    const haystack = `${title}\n${body}`;

    if (looksLikeParkingPage(haystack)) {
      return {
        url: normalized,
        ...context,
        issue: "parking-page",
        detail: title ? `title: ${title}` : "page matches domain-parking heuristics",
      };
    }

    if (!shouldCheckGameRelevance(context)) {
      return null;
    }

    if (hostIsTrusted(parsed.hostname) || urlMentionsGame(parsed, context.gameUid, context.gameName)) {
      return null;
    }

    const plainText = stripHtml(haystack);
    if (!pageMentionsGame(haystack, keywords) && plainText.length < 400) {
      return {
        url: normalized,
        ...context,
        issue: "unrelated-content",
        detail: title
          ? `page has little content and no game-related keywords (title: ${title})`
          : "page has little content and no game-related keywords",
      };
    }

    return null;
  } catch (error) {
    const message =
      error instanceof Error && error.cause instanceof Error
        ? `${error.message}: ${error.cause.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      url: normalized,
      ...context,
      issue: "fetch-failed",
      detail: message,
    };
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function collectUrlChecks(gameinfoRecords, notesLinks) {
  const checks = [];
  const seen = new Set();

  const addCheck = (entry) => {
    const key = `${entry.source}|${entry.path}|${entry.url}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    checks.push(entry);
  };

  for (const record of gameinfoRecords) {
    for (const { path: urlPath, urls } of record.urlEntries) {
      for (const url of urls) {
        if (!url?.trim()) {
          continue;
        }
        addCheck({
          url,
          source: `${record.uid} (${path.relative(ROOT, record.filePath)})`,
          path: urlPath,
          gameUid: record.uid,
          gameName: record.name,
        });
      }
    }
  }

  const nameByUid = Object.fromEntries(gameinfoRecords.map((record) => [record.uid, record.name]));

  for (const link of notesLinks) {
    if (isSkippableUrl(link.url)) {
      continue;
    }
    const gameName = nameByUid[link.gameUid] ?? link.gameUid;
    addCheck({
      url: link.url,
      source: link.source,
      path: link.path,
      gameUid: link.gameUid,
      gameName,
    });
  }

  return checks;
}

function findMissingRootUrls(gameinfoRecords) {
  const missing = [];

  for (const record of gameinfoRecords) {
    const root = record.urlEntries.find((entry) => entry.path === "gameinfo.urls");
    const urls = root?.urls ?? [];
    const nonEmpty = urls.map((url) => url?.trim()).filter(Boolean);
    if (nonEmpty.length === 0) {
      missing.push({
        uid: record.uid,
        name: record.name,
        file: path.relative(ROOT, record.filePath),
      });
    }
  }

  return missing;
}

function printIssueGroup(title, issues, verbose) {
  console.log(`\n${title} (${issues.length}):`);
  if (issues.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const issue of issues) {
    console.log(`  - ${issue.uid ?? issue.gameUid}: ${issue.name ?? issue.url}`);
    if (issue.file) {
      console.log(`    file: ${issue.file}`);
    }
    if (issue.url) {
      console.log(`    url: ${issue.url}`);
    }
    if (issue.source) {
      console.log(`    source: ${issue.source}`);
    }
    if (issue.path) {
      console.log(`    path: ${issue.path}`);
    }
    if (issue.issue) {
      console.log(`    problem: ${issue.issue}`);
    }
    if (issue.detail) {
      console.log(`    detail: ${issue.detail}`);
    }
    if (verbose && issue.label) {
      console.log(`    label: ${issue.label}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("Link check report");
  console.log("=================");
  console.log(`Games dir: ${path.relative(ROOT, GAMES_DIR)}`);
  console.log(`Notes: ${path.relative(ROOT, APGAMES_PATH)}`);

  const gameinfoRecords = loadGameinfoRecords();
  const notesLinks = loadNotesLinks();
  const missingRootUrls = findMissingRootUrls(gameinfoRecords);
  const urlChecks = collectUrlChecks(gameinfoRecords, notesLinks);

  console.log(`\nScanned ${gameinfoRecords.length} gameinfo record(s).`);
  console.log(`Found ${urlChecks.length} unique URL(s) to check (${notesLinks.length} from notes).`);

  const urlIssues = (await mapWithConcurrency(urlChecks, args.concurrency, (entry) =>
    checkUrl(entry.url, entry),
  )).filter(Boolean);

  printIssueGroup("Missing or empty root gameinfo.urls", missingRootUrls, args.verbose);
  printIssueGroup("URL problems", urlIssues, args.verbose);

  const issueCount = missingRootUrls.length + urlIssues.length;
  if (issueCount === 0) {
    console.log("\nAll checked links look OK.");
  } else {
    console.log(`\n${issueCount} issue(s) found.`);
    if (args.fail) {
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
