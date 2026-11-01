#!/usr/bin/env node
/**
 * Dev-only locale health audit (catalog ↔ game source, managed shape, translation staleness).
 *
 * CI and `npm test` enforce **missing catalog keys** only (runtime i18n gaps) via
 * `test/scripts/locale-catalog-missing.test.mjs`. This script is for deeper debt triage.
 *
 * Allowlist: locale-src/en/_locale-audit-allowlist.json
 *
 * Usage:
 *   npm run audit-locale
 *   npm run audit-locale -- --check missingApgames,missingApresults
 *   npm run audit-locale -- --json
 *   npm run audit-locale -- --list-checks
 */
import {
    loadLocaleAuditAllowlist,
    localeAuditExitCode,
    runLocaleAudit,
    summarizeLocaleAudit,
} from "./lib/locale-audit.mjs";

const CHECK_IDS = [
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
];

function parseArgs(argv) {
    const json = argv.includes("--json");
    const listChecks = argv.includes("--list-checks");
    const fail = !argv.includes("--no-fail");
    const eqIdx = argv.findIndex((a) => a.startsWith("--check="));
    const flagIdx = argv.indexOf("--check");
    let checks;
    if (eqIdx !== -1) {
        checks = argv[eqIdx].slice("--check=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (flagIdx !== -1 && argv[flagIdx + 1] && !argv[flagIdx + 1].startsWith("--")) {
        checks = argv[flagIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    return { json, listChecks, fail, checks };
}

const { json, listChecks, fail, checks } = parseArgs(process.argv.slice(2));

if (listChecks) {
    console.log(CHECK_IDS.join("\n"));
    process.exit(0);
}

if (checks?.some((c) => !CHECK_IDS.includes(c))) {
    console.error(`Unknown --check id. Valid: ${CHECK_IDS.join(", ")}`);
    process.exit(2);
}

const allowlist = loadLocaleAuditAllowlist();
const result = runLocaleAudit(checks, allowlist);
const summary = summarizeLocaleAudit(result, allowlist);
const exitCode = fail ? localeAuditExitCode(result, allowlist) : 0;

if (json) {
    console.log(JSON.stringify({ summary, issues: result.issues, suppressed: result.suppressed }, null, 2));
} else {
    console.log("locale audit (dev-only)");
    console.log("allowlist:", allowlist.suppress ? "locale-src/en/_locale-audit-allowlist.json" : "(none)");
    console.log("errors:", summary.errors, "warnings:", summary.warns, "suppressed:", summary.suppressed);
    if (Object.keys(summary.byCategory).length) {
        console.log("by category:", summary.byCategory);
    }
    console.log("warn-only categories (do not fail exit):", summary.warnOnlyCategories.join(", "));
    const sample = 40;
    if (result.issues.length) {
        console.log(`\nIssues (up to ${sample}):`);
        for (const issue of result.issues.slice(0, sample)) {
            console.log(`  [${issue.severity}] ${issue.category} ${issue.id}`);
            console.log(`    ${issue.message}`);
        }
        if (result.issues.length > sample) {
            console.log(`  … and ${result.issues.length - sample} more`);
        }
    }
    if (result.suppressed.length) {
        console.log(`\nSuppressed: ${result.suppressed.length} (see allowlist)`);
    }
}

process.exit(exitCode);
