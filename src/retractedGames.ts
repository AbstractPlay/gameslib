import type { Variant } from "./schemas/gameinfo.js";
import retractedRaw from "./retractedGames.json" with { type: "json" };

export type RetractionAvailability = "playable" | "hiddenProd" | "hiddenAll";

export type RecordsGeneration = "include" | "omit";

export type RetractionArchiveMetadata = {
    name: string;
    playercounts: number[];
    variants?: Variant[];
};

export type RetractionEntry = {
    availability: RetractionAvailability;
    recordsGeneration: RecordsGeneration;
    publishStats: boolean;
    reason?: "broken" | "licence" | "rights" | "other";
    removedAt?: string;
    archiveMetadata?: RetractionArchiveMetadata;
};

export type RetractionRegistry = Record<string, RetractionEntry>;

const registry: RetractionRegistry = retractedRaw as RetractionRegistry;

export function getRetraction(metaUid: string): RetractionEntry | undefined {
    return registry[metaUid];
}

export function isRetractedMetaGame(metaUid: string): boolean {
    return registry[metaUid] !== undefined;
}

/** Whether completed-game records for this meta UID should be skipped in the records pipeline. */
export function shouldOmitFromRecords(metaUid: string): boolean {
    return getRetraction(metaUid)?.recordsGeneration === "omit";
}

/** Whether stats, co-occurrence, and published summary aggregates may include this meta UID. */
export function shouldPublishStats(metaUid: string): boolean {
    const entry = getRetraction(metaUid);
    if (entry === undefined) {
        return true;
    }
    return entry.publishStats;
}

export function archiveMetadataFor(metaUid: string): RetractionArchiveMetadata | undefined {
    return getRetraction(metaUid)?.archiveMetadata;
}

/**
 * Catalog and play surfaces: `hiddenAll` hides on dev and prod; `hiddenProd` hides on prod only.
 */
export function isCatalogVisible(metaUid: string, production: boolean): boolean {
    const availability = getRetraction(metaUid)?.availability ?? "playable";
    if (availability === "playable") {
        return true;
    }
    if (availability === "hiddenProd") {
        return !production;
    }
    return false;
}

/** Variant definitions from archive metadata when the engine is absent from gameinfo. */
export function archiveVariantDefsForMetaUid(metaUid: string): Variant[] | undefined {
    const archive = archiveMetadataFor(metaUid)?.variants;
    if (archive !== undefined && archive.length > 0) {
        return archive;
    }
    return undefined;
}

/** Resolve a historical display name to a retracted meta UID (licence / stats path). */
export function resolveRetractedMetaUidByName(displayName: string): string | undefined {
    const lower = displayName.toLowerCase();
    for (const [uid, entry] of Object.entries(registry)) {
        const name = entry.archiveMetadata?.name;
        if (name !== undefined && name.toLowerCase() === lower) {
            return uid;
        }
    }
    return undefined;
}

/** All retracted meta UIDs (for filters and tests). */
export function retractedMetaUids(): string[] {
    return Object.keys(registry);
}
