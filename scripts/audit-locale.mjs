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
 *   npm run audit-locale -- --output bin/locale-audit.json
 *   npm run audit-locale -- --output bin/locale-audit.txt
 *   npm run audit-locale -- --verbose
 *   npm run audit-locale -- --list-checks
 */
import fs from "node:fs";
import path from "node:path";
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
    const verbose = argv.includes("--verbose") || argv.includes("--all");
    const quiet = argv.includes("--quiet");
    const eqIdx = argv.findIndex((a) => a.startsWith("--check="));
    const flagIdx = argv.indexOf("--check");
    let checks;
    if (eqIdx !== -1) {
        checks = argv[eqIdx].slice("--check=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (flagIdx !== -1 && argv[flagIdx + 1] && !argv[flagIdx + 1].startsWith("--")) {
        checks = argv[flagIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    let outputPath;
    const outEq = argv.findIndex((a) => a.startsWith("--output="));
    if (outEq !== -1) {
        outputPath = argv[outEq].slice("--output=".length);
    } else {
        const outFlag = argv.indexOf("--output");
        if (outFlag !== -1 && argv[outFlag + 1] && !argv[outFlag + 1].startsWith("--")) {
            outputPath = argv[outFlag + 1];
        }
    }
    return { json, listChecks, fail, checks, verbose, quiet, outputPath };
}

/**
 * @param {string} outputPath
 * @param {{ summary: object, issues: object[], suppressed: object[] }} payload
 */
function writeAuditExport(outputPath, payload) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    const ext = path.extname(outputPath).toLowerCase();
    if (ext === ".txt" || ext === ".log") {
        const lines = [];
        for (const issue of payload.issues) {
            lines.push(`${issue.severity}\t${issue.category}\t${issue.id}\t${issue.message}`);
        }
        for (const issue of payload.suppressed) {
            lines.push(`suppressed\t${issue.category}\t${issue.id}\t${issue.message}`);
        }
        fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
        return;
    }
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function printHumanReport(result, summary, { verbose }) {
    console.log("locale audit (dev-only)");
    console.log("allowlist:", "locale-src/en/_locale-audit-allowlist.json");
    console.log("errors:", summary.errors, "warnings:", summary.warns, "suppressed:", summary.suppressed);
    if (Object.keys(summary.byCategory).length) {
        console.log("by category:", summary.byCategory);
    }
    console.log("warn-only categories (do not fail exit):", summary.warnOnlyCategories.join(", "));
    const sample = verbose ? result.issues.length : 40;
    if (result.issues.length) {
        console.log(`\nIssues${verbose ? "" : ` (up to ${sample})`}:`);
        for (const issue of result.issues.slice(0, sample)) {
            console.log(`  [${issue.severity}] ${issue.category} ${issue.id}`);
            console.log(`    ${issue.message}`);
        }
        if (!verbose && result.issues.length > sample) {
            console.log(`  … and ${result.issues.length - sample} more (use --verbose or --output)`);
        }
    }
    if (result.suppressed.length) {
        console.log(`\nSuppressed: ${result.suppressed.length} (see allowlist)`);
        if (verbose) {
            for (const issue of result.suppressed) {
                console.log(`  [suppressed] ${issue.category} ${issue.id}`);
            }
        }
    }
}

const { json, listChecks, fail, checks, verbose, quiet, outputPath } = parseArgs(process.argv.slice(2));

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
const payload = { summary, issues: result.issues, suppressed: result.suppressed };

if (outputPath) {
    writeAuditExport(outputPath, payload);
    if (!quiet) {
        console.log(
            `Wrote ${result.issues.length} issue(s)` +
                (result.suppressed.length ? `, ${result.suppressed.length} suppressed` : "") +
                ` → ${path.resolve(outputPath)}`,
        );
    }
}

if (json) {
    console.log(JSON.stringify(payload, null, 2));
} else if (!quiet && (!outputPath || verbose)) {
    printHumanReport(result, summary, { verbose });
} else if (!quiet && outputPath && !verbose) {
    console.log("errors:", summary.errors, "warnings:", summary.warns, "(full list in --output file)");
}

process.exit(exitCode);
