/**
 * Replay published Cubeo records from records.abstractplay.com and verify every
 * stored move is in the engine movelist at that ply (post Track 2 move-gen).
 *
 *   npx tsx scripts/replay-cubeo-prod-records.ts
 *   npx tsx scripts/replay-cubeo-prod-records.ts --min-moves 40
 *   npx tsx scripts/replay-cubeo-prod-records.ts --all
 */
/* eslint-disable no-console */
import type { APGameRecord } from "@abstractplay/recranks";
import { CubeoGame } from "../src/games/cubeo.js";
import { parseSiteGameId } from "../test/fixtures/turnModel/siteGameId.js";

const RECORDS_BASE = "https://records.abstractplay.com";
const META_UID = "cubeo";

type VariantBucket =
    | "default"
    | "strict"
    | "d8"
    | "d10"
    | "d12"
    | "d12+strict";

const BUCKETS: VariantBucket[] = ["default", "strict", "d8", "d10", "d12", "d12+strict"];

function slotMoveText(slot: APGameRecord["moves"][number][number]): string | undefined {
    if (slot === null) {
        return undefined;
    }
    if (typeof slot === "string") {
        return slot;
    }
    return slot.move;
}

function classifyRecord(rec: APGameRecord): "normal" | "other" {
    for (const round of rec.moves) {
        for (const slot of round) {
            const move = slotMoveText(slot);
            if (move === "timeout" || move === "resign" || move === "abandoned") {
                return "other";
            }
        }
    }
    return rec.moves.length > 0 ? "normal" : "other";
}

function variantBucket(variants: string[]): VariantBucket {
    const set = new Set(variants);
    const hasStrict = set.has("strict");
    if (set.has("d12") && hasStrict) {
        return "d12+strict";
    }
    if (set.has("d12")) {
        return "d12";
    }
    if (set.has("d10")) {
        return "d10";
    }
    if (set.has("d8")) {
        return "d8";
    }
    if (hasStrict) {
        return "strict";
    }
    return "default";
}

function extractMoves(rec: APGameRecord): string[] {
    const out: string[] = [];
    for (const round of rec.moves) {
        for (const slot of round) {
            const raw = slotMoveText(slot);
            if (raw === undefined || raw === "") {
                continue;
            }
            if (raw === "timeout" || raw === "resign" || raw === "abandoned") {
                continue;
            }
            out.push(raw.toLowerCase().replace(/\s+/g, ""));
        }
    }
    return out;
}

function replayRecord(rec: APGameRecord, moves: string[]): { ok: true } | { ok: false; ply: number; move: string; legalCount: number } {
    const siteId = rec.header.site.gameid as string;
    const { variants } = parseSiteGameId(siteId, META_UID);
    let g = new CubeoGame(undefined, variants.length > 0 ? variants : undefined);
    for (let i = 0; i < moves.length; i++) {
        const m = moves[i]!;
        const legal = g.moves();
        if (!legal.includes(m)) {
            return { ok: false, ply: i + 1, move: m, legalCount: legal.length };
        }
        g = g.move(m, { trusted: true }) as CubeoGame;
    }
    return { ok: true };
}

async function main(): Promise<void> {
    const replayAll = process.argv.includes("--all");
    const minMoves = process.argv.includes("--min-moves")
        ? parseInt(process.argv[process.argv.indexOf("--min-moves") + 1]!, 10)
        : 25;

    const res = await fetch(`${RECORDS_BASE}/meta/${META_UID}.json`);
    if (!res.ok) {
        throw new Error(`Failed to fetch meta/${META_UID}.json: ${res.status}`);
    }
    const records = await res.json() as APGameRecord[];
    console.log(`Fetched ${records.length} published ${META_UID} records`);

    const byBucket = new Map<VariantBucket, APGameRecord[]>();
    for (const bucket of BUCKETS) {
        byBucket.set(bucket, []);
    }
    for (const rec of records) {
        if (classifyRecord(rec) !== "normal") {
            continue;
        }
        const siteId = rec.header.site.gameid as string;
        let variants: string[] = [];
        try {
            variants = parseSiteGameId(siteId, META_UID).variants;
        } catch {
            continue;
        }
        const bucket = variantBucket(variants);
        byBucket.get(bucket)!.push(rec);
    }

    for (const list of byBucket.values()) {
        list.sort((a, b) => b.moves.length - a.moves.length);
    }

    let failures = 0;
    let replayed = 0;

    if (replayAll) {
        const normals = records.filter(r => classifyRecord(r) === "normal");
        console.log(`\n--all: replaying ${normals.length} normal records…`);
        for (const rec of normals) {
            const moves = extractMoves(rec);
            if (moves.length === 0) {
                continue;
            }
            const { id: gameid } = parseSiteGameId(rec.header.site.gameid as string, META_UID);
            const result = replayRecord(rec, moves);
            if (!result.ok) {
                failures++;
                console.error(
                    `FAIL ${gameid} ply ${result.ply}: ${result.move} (${result.legalCount} legal)`,
                );
            } else {
                replayed++;
            }
        }
        console.log(`\nDone: ${replayed} replays OK, ${failures} failed`);
        if (failures > 0) {
            process.exit(1);
        }
        return;
    }

    for (const bucket of BUCKETS) {
        const candidates = byBucket.get(bucket) ?? [];
        const rec = candidates.find(r => extractMoves(r).length >= minMoves) ?? candidates[0];
        if (rec === undefined) {
            console.log(`\n[${bucket}] — no published record`);
            continue;
        }

        const moves = extractMoves(rec);
        const siteId = rec.header.site.gameid as string;
        const { id: gameid, variants } = parseSiteGameId(siteId, META_UID);
        console.log(`\n[${bucket}] game ${gameid} variants=[${variants.join("|")}] rounds=${rec.moves.length} moves=${moves.length}`);

        const result = replayRecord(rec, moves);
        if (!result.ok) {
            failures++;
            console.error(
                `  FAIL ply ${result.ply}: ${result.move} not in movelist (${result.legalCount} legal)`,
            );
        } else {
            replayed++;
            console.log(`  OK replayed ${moves.length} plies`);
        }

        // Second longest in bucket when available
        const rec2 = candidates.find(r => r !== rec && extractMoves(r).length >= minMoves);
        if (rec2 !== undefined) {
            const moves2 = extractMoves(rec2);
            const { id: gameid2 } = parseSiteGameId(rec2.header.site.gameid as string, META_UID);
            console.log(`[${bucket}] #2 game ${gameid2} moves=${moves2.length}`);
            const result2 = replayRecord(rec2, moves2);
            if (!result2.ok) {
                failures++;
                console.error(
                    `  FAIL ply ${result2.ply}: ${result2.move} not in movelist (${result2.legalCount} legal)`,
                );
            } else {
                replayed++;
                console.log(`  OK replayed ${moves2.length} plies`);
            }
        }
    }

    console.log(`\nDone: ${replayed} replays OK, ${failures} failed`);
    if (failures > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
