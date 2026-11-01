import { collectLeaves } from "../locale-prune.mjs";

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

function isVerifiedSame(trackingEntry, sourceValue, translated) {
    const { src, out } = normalizeTrackingEntry(trackingEntry);
    return src === sourceValue && out === translated;
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

function getLeafValue(obj, leafPath) {
    const parts = leafPath.split(".");
    let current = obj;
    for (const part of parts) {
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[part];
    }
    return typeof current === "string" ? current : undefined;
}

/**
 * Same stale-leaf rules as {@link scripts/translate.mjs} `getDiffLeaves` (keys needing re-translation or tracking fix).
 * @returns {Record<string, string>} leafPath → current English source
 */
export function diffStaleManagedTranslationLeaves(sourceData, targetData, srcTracking) {
    const sourceLeaves = collectLeaves(sourceData);
    /** @type {Record<string, string>} */
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
