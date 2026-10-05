/**
 * Canonical on-disk formatting for locale JSON (locales/, locale-src/).
 * All writers should use formatLocaleJson / writeLocaleJson so --write tools
 * do not fight historical 4-space English files.
 */
import fs from "fs";
import path from "path";

/** Pretty-print indent for locale JSON files (Weblate + script output). */
export const LOCALE_JSON_INDENT = 2;

export function formatLocaleJson(data) {
  return `${JSON.stringify(data, null, LOCALE_JSON_INDENT)}\n`;
}

export function normalizeLocaleJsonText(text) {
  const parsed = JSON.parse(text);
  return formatLocaleJson(parsed);
}

export function writeLocaleJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, formatLocaleJson(data), "utf8");
}
