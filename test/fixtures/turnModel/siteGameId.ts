const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedSiteGameId {
    metaGame: string;
    id: string;
    variants: string[];
}

/**
 * Parse `header.site.gameid` from published records.
 *
 * Current format: `{id}#{meta}:{variants.join("|")}` (variants may be empty → trailing `:`).
 * Legacy format: `{meta}#{id}`.
 */
export function parseSiteGameId(siteGameId: string, expectedMetaUid?: string): ParsedSiteGameId {
    const hashIdx = siteGameId.indexOf("#");
    if (hashIdx === -1) {
        throw new Error(`Unexpected site.gameid format: ${siteGameId}`);
    }
    const left = siteGameId.slice(0, hashIdx);
    const afterHash = siteGameId.slice(hashIdx + 1);

    const splitMetaVariants = (segment: string): { meta: string; variants: string[] } => {
        const colonIdx = segment.indexOf(":");
        if (colonIdx === -1) {
            return { meta: segment, variants: [] };
        }
        const meta = segment.slice(0, colonIdx);
        const variantPart = segment.slice(colonIdx + 1);
        const variants = variantPart.length > 0 ? variantPart.split("|").filter((v) => v.length > 0) : [];
        return { meta, variants };
    };

    if (UUID_PATTERN.test(left)) {
        const { meta, variants } = splitMetaVariants(afterHash);
        const parsed = { metaGame: meta, id: left, variants };
        assertExpectedMeta(parsed, expectedMetaUid);
        return parsed;
    }

    if (UUID_PATTERN.test(afterHash.split(":")[0]!)) {
        const id = afterHash.split(":")[0]!;
        const parsed = { metaGame: left, id, variants: [] };
        assertExpectedMeta(parsed, expectedMetaUid);
        return parsed;
    }

    const { meta, variants } = splitMetaVariants(afterHash);
    if (expectedMetaUid !== undefined && left === expectedMetaUid.replace(/:+$/, "")) {
        return { metaGame: left, id: meta, variants };
    }
    if (expectedMetaUid !== undefined && meta === expectedMetaUid.replace(/:+$/, "")) {
        return { metaGame: meta, id: left, variants };
    }

    const parsed = { metaGame: left, id: meta.length > 0 ? meta : afterHash, variants };
    assertExpectedMeta(parsed, expectedMetaUid);
    return parsed;
}

function assertExpectedMeta(parsed: ParsedSiteGameId, expectedMetaUid?: string): void {
    if (expectedMetaUid === undefined) {
        return;
    }
    const expected = expectedMetaUid.replace(/:+$/, "");
    if (parsed.metaGame !== expected) {
        throw new Error(`Record meta mismatch: expected ${expected}, got ${parsed.metaGame}`);
    }
}
