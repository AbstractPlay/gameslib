import { GameFactory, games } from "../games/index.js";
import type { GameBase } from "../games/_base.js";
import type { Variant } from "../schemas/gameinfo.js";

type VariantMaps = {
    variantMap: Map<string, string | undefined>;
    variantGroups: Set<string>;
    varId2Group: Map<string, string | undefined>;
};

function factoryPlayerCount(metaUid: string, playerCount: number): number | undefined {
    const ctor = games.get(metaUid);
    if (ctor === undefined) {
        return undefined;
    }
    if (ctor.gameinfo.playercounts.length > 1) {
        return playerCount > 0 ? playerCount : 2;
    }
    return undefined;
}

function createEngine(metaUid: string, playerCount: number): GameBase | undefined {
    const pc = factoryPlayerCount(metaUid, playerCount);
    const engine =
        pc !== undefined ? GameFactory(metaUid, pc, []) : GameFactory(metaUid, undefined, []);
    return engine ?? undefined;
}

function createEngineWithVariants(
    metaUid: string,
    playerCount: number,
    variantUids: readonly string[],
): GameBase | undefined {
    const pc = factoryPlayerCount(metaUid, playerCount);
    const engine =
        pc !== undefined
            ? GameFactory(metaUid, pc, [...variantUids])
            : GameFactory(metaUid, undefined, [...variantUids]);
    return engine ?? undefined;
}

function buildVariantMaps(all: Variant[]): VariantMaps | undefined {
    if (all.length === 0) {
        return undefined;
    }
    return {
        variantMap: new Map(all.map((rec) => [rec.uid, rec.name])),
        variantGroups: new Set(
            all.map((rec) => rec.group).filter((g): g is string => g !== undefined),
        ),
        varId2Group: new Map(all.map((rec) => [rec.uid, rec.group])),
    };
}

/** Shared fill logic for expand labels and batch-rating uid keys. */
export function filledVariantUidsForExpand(
    maps: VariantMaps,
    rawUids: readonly string[],
): string[] {
    const { variantMap, variantGroups, varId2Group } = maps;

    if (rawUids.length === 0) {
        return [...variantMap.keys()].filter((k) => k.startsWith("#")).sort((a, b) => a.localeCompare(b));
    }

    const vars = [...rawUids];
    const groups = new Set(variantGroups);
    for (const v of vars) {
        const g = varId2Group.get(v);
        if (g !== undefined) {
            groups.delete(g);
        }
    }
    for (const g of groups) {
        vars.push(`#${g}`);
    }
    return [...new Set(vars)].sort((a, b) => a.localeCompare(b));
}

function variantMapsForMeta(metaUid: string, playerCount: number): VariantMaps | undefined {
    const engine = createEngine(metaUid, playerCount);
    if (engine === undefined) {
        return undefined;
    }
    const all = engine.allvariants();
    if (all === undefined) {
        return undefined;
    }
    return buildVariantMaps(all);
}

function metaGameHasVariantGroups(metaUid: string): boolean {
    const ctor = games.get(metaUid);
    return (ctor?.gameinfo.variants?.length ?? 0) > 0;
}

function ratingVariantSignature(
    metaUid: string,
    playerCount: number,
    variantUids: readonly string[],
): string | undefined {
    const engine = createEngineWithVariants(metaUid, playerCount, variantUids);
    if (engine === undefined) {
        return undefined;
    }
    return JSON.stringify(engine.getVariants());
}

function ratingEquivalentToEmpty(
    metaUid: string,
    playerCount: number,
    rawUids: readonly string[],
): boolean {
    if (rawUids.length === 0) {
        return true;
    }
    const emptySig = ratingVariantSignature(metaUid, playerCount, []);
    const rawSig = ratingVariantSignature(metaUid, playerCount, rawUids);
    return emptySig !== undefined && emptySig === rawSig;
}

/**
 * Localized variant labels (front expandVariants parity).
 */
export function expandVariantLabels(
    metaUid: string,
    playerCount: number,
    uids: readonly string[],
): string[] {
    const maps = variantMapsForMeta(metaUid, playerCount);
    if (maps === undefined) {
        return [];
    }
    const filled = filledVariantUidsForExpand(maps, uids);
    return filled.map((v) => maps.variantMap.get(v)).filter((n): n is string => Boolean(n));
}

/**
 * Stable variant UIDs for summarize `batchRatingGameLabel` / Glicko pools.
 */
export function variantUidsForBatchRating(
    metaUid: string,
    playerCount: number,
    rawUids: readonly string[],
): string[] {
    if (!metaGameHasVariantGroups(metaUid)) {
        return [...rawUids].sort((a, b) => a.localeCompare(b));
    }
    const maps = variantMapsForMeta(metaUid, playerCount);
    if (maps === undefined) {
        return [...rawUids].sort((a, b) => a.localeCompare(b));
    }
    if (ratingEquivalentToEmpty(metaUid, playerCount, rawUids)) {
        return filledVariantUidsForExpand(maps, []);
    }
    return filledVariantUidsForExpand(maps, rawUids);
}
