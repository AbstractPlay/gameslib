import { APGamesInformation } from "../schemas/gameinfo";
import { UserFacingError } from "../common";
import { APGAMES_PRODUCTION } from "./_build-flags.generated";
import { EXPERIMENTAL_VARIANT_UIDS_BY_GAME } from "./_registry-filter.generated";

function blockedVariantUidsForGame(gameUid: string): ReadonlySet<string> {
    return new Set(EXPERIMENTAL_VARIANT_UIDS_BY_GAME[gameUid] ?? []);
}

/**
 * Remove experimental variants and flags from gameinfo for production export.
 */
export function filterGameinfoForProduction(info: APGamesInformation): APGamesInformation {
    if (!APGAMES_PRODUCTION) {
        return info;
    }
    const blocked = blockedVariantUidsForGame(info.uid);
    const filtered: APGamesInformation = { ...info };
    if (filtered.variants !== undefined) {
        filtered.variants = filtered.variants.filter((v) => !blocked.has(v.uid) && !v.experimental);
    }
    if (filtered.flags !== undefined) {
        filtered.flags = filtered.flags.filter((f) => f !== "experimental");
    }
    return filtered;
}

/**
 * Variant uids allowed when issuing new challenges or tournaments (production-filtered).
 */
export function allowedChallengeVariantUids(info: APGamesInformation): Set<string> {
    const filtered = filterGameinfoForProduction(info);
    return new Set(filtered.variants?.map((v) => v.uid) ?? []);
}

/**
 * Reject variant uids not allowed for new challenges in production.
 */
export function assertAllowedChallengeVariants(info: APGamesInformation, variantUids: string[]): void {
    if (!APGAMES_PRODUCTION) {
        return;
    }
    const allowed = allowedChallengeVariantUids(info);
    const disallowed = variantUids.filter((v) => !allowed.has(v));
    if (disallowed.length > 0) {
        throw new UserFacingError(
            "INVALID_VARIANTS",
            `Variant(s) not allowed: ${disallowed.join(", ")}`,
        );
    }
}
