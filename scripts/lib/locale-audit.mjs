import fs from "node:fs";
import path from "node:path";
import { assertEnLocaleMergeCurrent } from "./ensure-merged-locale-en.mjs";
import { mergeApgamesEnSources } from "./apgames-en-merge.mjs";
import { mergeApresultsEnSources } from "./apresults-en-merge.mjs";
import { findDuplicateEnWarnings } from "./apgames-duplicate-en.mjs";
import {
    findApresultsDuplicateEnWarnings,
    findApresultsGeneralInternalDuplicateEnWarnings,
} from "./apresults-duplicate-en.mjs";
import {
    buildUidToGameSourcePaths,
    findMissingApgamesReferences,
    findOrphanApgamesLeaves,
} from "./check-apgames-refs.mjs";
import {
    findMissingApresultsReferences,
    findOrphanApresultsGeneralLeaves,
    findOrphanApresultsLeaves,
} from "./check-apresults-refs.mjs";
import { MANAGED_LANGS } from "../locale-prune.mjs";
import { diffStaleManagedTranslationLeaves } from "./locale-translate-stale.mjs";
import { REPO_ROOT } from "./apgames-en-paths.mjs";

export const LOCALE_AUDIT_ALLOWLIST_PATH = path.join(REPO_ROOT, "locale-src", "en", "_locale-audit-allowlist.json");

/** @typedef {"error" | "warn"} AuditSeverity */
/** @typedef {{ id: string, category: string, severity: AuditSeverity, message: string }} AuditIssue */

/**
 * @param {unknown} raw
 * @returns {{ suppress: Record<string, string[]>, warnOnly: Set<string> }}
 */
export function loadLocaleAuditAllowlist(raw = undefined) {
    /** @type {Record<string, string[]>} */
    let suppress = {
        missingApgames: [],
        missingApresults: [],
        orphanApgames: [],
        orphanApresults: [],
        orphanApresultsGeneral: [],
        managedShape: [],
        translateStale: [],
        mergeDrift: [],
    };
    /** @type {Set<string>} */
    let warnOnly = new Set([
        "orphanApgames",
        "orphanApresults",
        "orphanApresultsGeneral",
        "managedShape",
        "translateStale",
        "duplicateEnApgames",
        "duplicateEnApresults",
        "duplicateEnApresultsGeneral",
    ]);

    if (raw === undefined && fs.existsSync(LOCALE_AUDIT_ALLOWLIST_PATH)) {
        raw = JSON.parse(fs.readFileSync(LOCALE_AUDIT_ALLOWLIST_PATH, "utf8"));
    }

    if (raw && typeof raw === "object") {
        const obj = /** @type {Record<string, unknown>} */ (raw);
        if (obj.suppress && typeof obj.suppress === "object") {
            suppress = { ...suppress };
            for (const [key, value] of Object.entries(obj.suppress)) {
                if (Array.isArray(value)) {
                    suppress[key] = value.map(String);
                }
            }
        }
        if (Array.isArray(obj.warnOnly)) {
            warnOnly = new Set(obj.warnOnly.map(String));
        } else if (obj.warnOnly instanceof Set) {
            warnOnly = obj.warnOnly;
        }
    }

    return { suppress, warnOnly };
}

/**
 * @param {string} id
 * @param {string[]} patterns
 */
export function isAllowlisted(id, patterns) {
    for (const pat of patterns) {
        if (pat === id) {
            return true;
        }
        if (pat.endsWith("*") && id.startsWith(pat.slice(0, -1))) {
            return true;
        }
    }
    return false;
}

/**
 * @param {AuditIssue} issue
 * @param {{ suppress: Record<string, string[]>, warnOnly: Set<string> }} allowlist
 */
export function isIssueSuppressed(issue, allowlist) {
    const patterns = allowlist.suppress[issue.category] ?? allowlist.suppress.all ?? [];
    return patterns.length > 0 && isAllowlisted(issue.id, patterns);
}

function firstContentKey(obj) {
    if (!obj || typeof obj !== "object") {
        return undefined;
    }
    for (const key of Object.keys(obj)) {
        if (key === "_src" || key.startsWith("_src_")) {
            continue;
        }
        return key;
    }
    return undefined;
}

function loadSrcTracking(repoRoot, langCode, fileName) {
    const srcPath = path.join(repoRoot, "locale-src", langCode, fileName);
    if (!fs.existsSync(srcPath)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(srcPath, "utf8"));
}

/**
 * @param {Set<string>} [checks] empty = all
 * @param {{ suppress?: Record<string, string[]>, warnOnly?: Set<string> }} [allowlistOpts]
 * @returns {{ issues: AuditIssue[], suppressed: AuditIssue[] }}
 */
export function runLocaleAudit(checks = undefined, allowlistOpts = undefined) {
    const allowlist = allowlistOpts
        ? {
            suppress: { ...loadLocaleAuditAllowlist().suppress, ...allowlistOpts.suppress },
            warnOnly: allowlistOpts.warnOnly ?? loadLocaleAuditAllowlist().warnOnly,
        }
        : loadLocaleAuditAllowlist();

    const allChecks = new Set(
        checks?.length
            ? checks
            : [
                "mergeDrift",
                "missingApgames",
                "missingApresults",
                "orphanApgames",
                "orphanApresults",
                "orphanApresultsGeneral",
                "managedShape",
                "translateStale",
                "duplicateEnApgames",
                "duplicateEnApresults",
                "duplicateEnApresultsGeneral",
            ],
    );

    /** @type {AuditIssue[]} */
    const issues = [];

    const push = (category, severity, id, message) => {
        issues.push({ category, severity, id, message });
    };

    if (allChecks.has("mergeDrift")) {
        for (const ns of ["apgames", "apresults"]) {
            try {
                assertEnLocaleMergeCurrent(ns);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                push("mergeDrift", "error", `mergeDrift:${ns}`, message.split("\n")[0] ?? message);
            }
        }
    }

    const mergedApgames = mergeApgamesEnSources();
    const mergedApresults = mergeApresultsEnSources();

    if (allChecks.has("missingApgames")) {
        for (const line of findMissingApgamesReferences(mergedApgames)) {
            const m = line.match(/missing catalog key (apgames:[^\s)]+)/);
            const id = m ? `missing:${m[1]}` : `missing:apgames:${line}`;
            push("missingApgames", "error", id, line);
        }
    }

    if (allChecks.has("missingApresults")) {
        for (const line of findMissingApresultsReferences()) {
            const m = line.match(/missing catalog key (apresults:[^\s)]+)/);
            const id = m ? `missing:${m[1]}` : `missing:apresults:${line}`;
            push("missingApresults", "error", id, line);
        }
    }

    if (allChecks.has("orphanApgames")) {
        for (const line of findOrphanApgamesLeaves(mergedApgames)) {
            const m = line.match(/(apgames:[^\s)]+)/);
            const id = m ? `orphan:${m[1]}` : `orphan:apgames:${line}`;
            push("orphanApgames", "warn", id, line);
        }
    }

    if (allChecks.has("orphanApresults")) {
        const uids = [...buildUidToGameSourcePaths().keys()].sort();
        for (const uid of uids) {
            for (const line of findOrphanApresultsLeaves({ uidFilter: uid })) {
                const m = line.match(/(apresults:[^\s)]+)/);
                const id = m ? `orphan:${m[1]}` : `orphan:apresults:${line}`;
                push("orphanApresults", "warn", id, line);
            }
        }
    }

    if (allChecks.has("orphanApresultsGeneral")) {
        for (const line of findOrphanApresultsGeneralLeaves()) {
            const m = line.match(/(apresults:[^\s)]+)/);
            const id = m ? `orphan:${m[1]}` : `orphan:apresults-general:${line}`;
            push("orphanApresultsGeneral", "warn", id, line);
        }
    }

    if (allChecks.has("managedShape")) {
        for (const fileName of ["apgames.json", "apresults.json"]) {
            const enPath = path.join(REPO_ROOT, "locales", "en", fileName);
            if (!fs.existsSync(enPath)) {
                continue;
            }
            const enData = JSON.parse(fs.readFileSync(enPath, "utf8"));
            const enFirst = firstContentKey(enData);
            for (const lang of MANAGED_LANGS) {
                const targetPath = path.join(REPO_ROOT, "locales", lang, fileName);
                if (!fs.existsSync(targetPath)) {
                    continue;
                }
                const targetData = JSON.parse(fs.readFileSync(targetPath, "utf8"));
                const targetFirst = firstContentKey(targetData);
                if (enFirst && targetFirst && enFirst !== targetFirst) {
                    push(
                        "managedShape",
                        "warn",
                        `managedShape:${lang}:${fileName}`,
                        `[${lang}] ${fileName}: top-level key "${targetFirst}" ≠ English "${enFirst}" (run translate after merge to realign)`,
                    );
                }
            }
        }
    }

    if (allChecks.has("translateStale")) {
        for (const fileName of ["apgames.json", "apresults.json"]) {
            const enPath = path.join(REPO_ROOT, "locales", "en", fileName);
            if (!fs.existsSync(enPath)) {
                continue;
            }
            const sourceData = JSON.parse(fs.readFileSync(enPath, "utf8"));
            for (const lang of MANAGED_LANGS) {
                const targetPath = path.join(REPO_ROOT, "locales", lang, fileName);
                if (!fs.existsSync(targetPath)) {
                    continue;
                }
                const targetData = JSON.parse(fs.readFileSync(targetPath, "utf8"));
                const srcTracking = loadSrcTracking(REPO_ROOT, lang, fileName);
                const stale = diffStaleManagedTranslationLeaves(sourceData, targetData, srcTracking);
                for (const leafPath of Object.keys(stale)) {
                    push(
                        "translateStale",
                        "warn",
                        `translateStale:${lang}:${leafPath}`,
                        `[${lang}] ${fileName}: stale or missing translation for ${leafPath}`,
                    );
                }
            }
        }
    }

    if (allChecks.has("duplicateEnApgames")) {
        for (const line of findDuplicateEnWarnings(mergedApgames)) {
            push("duplicateEnApgames", "warn", `duplicateEn:${line.slice(0, 120)}`, line);
        }
    }

    if (allChecks.has("duplicateEnApresults")) {
        for (const line of findApresultsDuplicateEnWarnings(mergedApresults)) {
            push("duplicateEnApresults", "warn", `duplicateEn:${line.slice(0, 120)}`, line);
        }
    }

    if (allChecks.has("duplicateEnApresultsGeneral")) {
        for (const line of findApresultsGeneralInternalDuplicateEnWarnings(mergedApresults)) {
            push("duplicateEnApresultsGeneral", "warn", `duplicateEnGeneral:${line.slice(0, 120)}`, line);
        }
    }

    /** @type {AuditIssue[]} */
    const active = [];
    /** @type {AuditIssue[]} */
    const suppressed = [];

    for (const issue of issues) {
        if (isIssueSuppressed(issue, allowlist)) {
            suppressed.push(issue);
        } else {
            active.push(issue);
        }
    }

    return { issues: active, suppressed };
}

/**
 * @param {{ issues: AuditIssue[], suppressed: AuditIssue[] }} result
 * @returns {number} exit code
 */
export function localeAuditExitCode(result, allowlist = loadLocaleAuditAllowlist()) {
    for (const issue of result.issues) {
        if (issue.severity === "error") {
            return 1;
        }
        if (issue.severity === "warn" && !allowlist.warnOnly.has(issue.category)) {
            return 1;
        }
    }
    return 0;
}

export function summarizeLocaleAudit(result, allowlist = loadLocaleAuditAllowlist()) {
    const byCategory = new Map();
    for (const issue of result.issues) {
        byCategory.set(issue.category, (byCategory.get(issue.category) ?? 0) + 1);
    }
    const errors = result.issues.filter((i) => i.severity === "error").length;
    const warns = result.issues.filter((i) => i.severity === "warn").length;
    return {
        errors,
        warns,
        suppressed: result.suppressed.length,
        byCategory: Object.fromEntries(byCategory),
        warnOnlyCategories: [...allowlist.warnOnly],
    };
}
