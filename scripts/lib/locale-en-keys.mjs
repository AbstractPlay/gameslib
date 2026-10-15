import {
    getGameinfoPointerViolations,
    getMergeCollisions,
    mergeApgamesEnSources,
} from "./apgames-en-merge.mjs";
import { getApresultsMergeCollisions, mergeApresultsEnSources } from "./apresults-en-merge.mjs";
import { findDuplicateEnWarnings } from "./apgames-duplicate-en.mjs";
import {
    findApresultsDuplicateEnWarnings,
    findApresultsGeneralInternalDuplicateEnWarnings,
} from "./apresults-duplicate-en.mjs";
import {
    findMissingApgamesReferences,
    findOrphanApgamesLeaves,
} from "./check-apgames-refs.mjs";
import {
    findMissingApresultsReferences,
    findOrphanApresultsLeaves,
} from "./check-apresults-refs.mjs";

/**
 * @param {'apgames' | 'apresults'} namespace
 * @param {{
 *   warn?: boolean,
 *   strict?: boolean,
 *   summary?: boolean,
 *   uidFilter?: string,
 *   generalScope?: 'global' | 'perResultType' | 'both',
 * }} opts
 * @returns {number} exit code
 */
export function runLocaleEnKeys(namespace, opts) {
    const warnMode = opts.warn === true;
    const strict = opts.strict === true;
    const summary = opts.summary === true;
    const uidFilter = opts.uidFilter;
    const label = `locale-en keys ${namespace}`;

    if (!warnMode && !strict) {
        throw new Error(`${label}: pass --warn and/or --strict`);
    }

    let exitCode = 0;

    if (namespace === "apgames") {
        const merged = mergeApgamesEnSources();
        const mergeCollisions = getMergeCollisions();

        for (const v of getGameinfoPointerViolations()) {
            console.error(
                `gameinfo-pointer: ${v.uid} still uses apgames:${v.field} pointer in ${v.filePath} (forbidden when gameApgamesEn is exported)`,
            );
            exitCode = 1;
        }

        if (warnMode && mergeCollisions.length > 0) {
            if (summary) {
                console.error(`${label}: ${mergeCollisions.length} merge collision(s) with differing English (use --verbose)`);
                for (const c of mergeCollisions.slice(0, 5)) {
                    console.error(`  merge-collision: ${c.leafPath} (${c.prior} → ${c.next})`);
                }
            } else {
                for (const c of mergeCollisions) {
                    console.error(`WARN: merge-collision: ${c.leafPath} was ${c.prior}, overwritten by ${c.next}`);
                }
            }
        }

        const duplicateWarnings = findDuplicateEnWarnings(merged, { uidFilter });
        if (duplicateWarnings.length > 0 && warnMode) {
            if (summary) {
                console.error(`${label}: ${duplicateWarnings.length} duplicate-en warning(s) (use --verbose for lines)`);
                for (const line of duplicateWarnings.slice(0, 5)) {
                    console.error(`  ${line}`);
                }
            } else {
                for (const line of duplicateWarnings) {
                    console.error(`WARN: ${line}`);
                }
            }
        }

        if (strict) {
            const strictOpts = { uidFilter };
            const missing = findMissingApgamesReferences(merged, strictOpts);
            const orphans = findOrphanApgamesLeaves(merged, strictOpts);
            for (const line of [...missing, ...orphans]) {
                console.error(`ERROR: ${line}`);
            }
            if (missing.length > 0 || orphans.length > 0) {
                exitCode = 1;
            } else if (summary && !uidFilter) {
                console.log(`${label}: strict full-registry OK (0 missing, 0 orphans)`);
            }
        }

        if (exitCode === 0) {
            const parts = [];
            if (strict && uidFilter) {
                parts.push(`strict uid ${uidFilter} OK`);
            }
            const dupCount = findDuplicateEnWarnings(merged, { uidFilter }).length;
            if (dupCount > 0) {
                parts.push(`${dupCount} duplicate-en warning(s)`);
            }
            if (parts.length === 0 && !(strict && !uidFilter && summary)) {
                console.log(`${label}: OK`);
            } else if (parts.length > 0) {
                console.log(`${label}: OK (${parts.join("; ")})`);
            }
        }
        return exitCode;
    }

    const merged = mergeApresultsEnSources();
    const mergeCollisions = getApresultsMergeCollisions();
    const generalScope = opts.generalScope ?? "both";

    if (warnMode && mergeCollisions.length > 0) {
        if (summary) {
            console.error(`${label}: ${mergeCollisions.length} merge collision(s) with differing English (use --verbose)`);
            for (const c of mergeCollisions.slice(0, 5)) {
                console.error(`  merge-collision: ${c.leafPath} (${c.prior} → ${c.next})`);
            }
        } else {
            for (const c of mergeCollisions) {
                console.error(`WARN: merge-collision: ${c.leafPath} was ${c.prior}, overwritten by ${c.next}`);
            }
        }
    }

    const generalInternalWarnings = warnMode
        ? findApresultsGeneralInternalDuplicateEnWarnings(merged, { scope: generalScope })
        : [];
    const duplicateWarnings = findApresultsDuplicateEnWarnings(merged, { uidFilter });

    if (generalInternalWarnings.length > 0 && warnMode) {
        if (summary) {
            console.error(
                `${label}: ${generalInternalWarnings.length} duplicate-en-general warning(s) (use --verbose for lines)`,
            );
            for (const line of generalInternalWarnings.slice(0, 5)) {
                console.error(`  ${line}`);
            }
        } else {
            for (const line of generalInternalWarnings) {
                console.error(`WARN: ${line}`);
            }
        }
    }

    if (duplicateWarnings.length > 0 && warnMode) {
        if (summary) {
            console.error(`${label}: ${duplicateWarnings.length} duplicate-en warning(s) (use --verbose for lines)`);
            for (const line of duplicateWarnings.slice(0, 5)) {
                console.error(`  ${line}`);
            }
        } else {
            for (const line of duplicateWarnings) {
                console.error(`WARN: ${line}`);
            }
        }
    }

    if (strict) {
        const strictOpts = { uidFilter };
        const missing = findMissingApresultsReferences(strictOpts);
        const orphans = findOrphanApresultsLeaves(strictOpts);
        for (const line of [...missing, ...orphans]) {
            console.error(`ERROR: ${line}`);
        }
        if (missing.length > 0 || orphans.length > 0) {
            exitCode = 1;
        } else if (summary && uidFilter) {
            console.log(`${label}: strict uid ${uidFilter} OK (0 missing, 0 orphans)`);
        } else if (summary && !uidFilter) {
            console.log(`${label}: strict full-registry OK (0 missing, 0 orphans)`);
        }
    }

    if (exitCode === 0) {
        const parts = [];
        if (strict && uidFilter) {
            parts.push(`strict uid ${uidFilter} OK`);
        }
        if (duplicateWarnings.length > 0) {
            parts.push(`${duplicateWarnings.length} duplicate-en warning(s)`);
        }
        if (generalInternalWarnings.length > 0) {
            parts.push(`${generalInternalWarnings.length} duplicate-en-general warning(s)`);
        }
        if (parts.length === 0 && !(strict && !uidFilter && summary)) {
            console.log(`${label}: OK`);
        } else if (parts.length > 0) {
            console.log(`${label}: OK (${parts.join("; ")})`);
        }
    }
    return exitCode;
}
