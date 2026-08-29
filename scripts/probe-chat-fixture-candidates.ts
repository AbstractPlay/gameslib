/**
 * Scan records.abstractplay.com meta JSON for chat-fixture candidate game ids.
 * Usage: npx ts-node scripts/probe-chat-fixture-candidates.ts
 */
/* eslint-disable no-console */
import type { APGameRecord } from "@abstractplay/recranks";
import { parseSiteGameId } from "../test/fixtures/turnModel/siteGameId";

const RECORDS_BASE = "https://records.abstractplay.com";

type ResultRow = Record<string, unknown>;

function slotResults(rec: APGameRecord): ResultRow[] {
    const out: ResultRow[] = [];
    for (const round of rec.moves) {
        for (const slot of round) {
            if (slot === null || typeof slot === "string") {
                continue;
            }
            const results = (slot as { result?: ResultRow[] }).result;
            if (results !== undefined) {
                out.push(...results);
            }
        }
    }
    return out;
}

function gameIdFromRec(rec: APGameRecord, metaUid: string): string | undefined {
    try {
        return parseSiteGameId(rec.header.site.gameid as string, metaUid).id;
    } catch {
        return undefined;
    }
}

function classify(rec: APGameRecord): string {
    for (const round of rec.moves) {
        for (const slot of round) {
            const move = slot === null ? undefined : typeof slot === "string" ? slot : slot.move;
            if (move === "timeout" || move === "resign" || move === "abandoned") {
                return move;
            }
        }
    }
    return "normal";
}

async function fetchMeta(metaUid: string): Promise<APGameRecord[]> {
    const res = await fetch(`${RECORDS_BASE}/meta/${metaUid}.json`);
    if (!res.ok) {
        throw new Error(`${metaUid}: ${res.status}`);
    }
    return (await res.json()) as APGameRecord[];
}

async function probe(metaUid: string, label: string, match: (rec: APGameRecord, results: ResultRow[]) => boolean): Promise<void> {
    const records = await fetchMeta(metaUid);
    const hits: { id: string; subtype: string; moves: number; np: number }[] = [];
    for (const rec of records) {
        if (!rec.header.players.length || rec.moves.length === 0) {
            continue;
        }
        const id = gameIdFromRec(rec, metaUid);
        if (id === undefined) {
            continue;
        }
        const results = slotResults(rec);
        if (match(rec, results)) {
            hits.push({
                id,
                subtype: classify(rec),
                moves: rec.moves.length,
                np: rec.header.players.length,
            });
        }
    }
    hits.sort((a, b) => b.moves - a.moves);
    console.log(`\n=== ${label} (${metaUid}) — ${hits.length} hit(s) ===`);
    for (const h of hits.slice(0, 8)) {
        console.log(`  ${h.id}  ${h.subtype}  ${h.np}p  ${h.moves} rounds`);
    }
}

async function main(): Promise<void> {
    await probe("breakthrough", "breakthrough detonate", (_rec, results) =>
        results.some((r) => r.type === "detonate"),
    );
    await probe("breakthrough", "breakthrough destroy batch", (_rec, results) => {
        const destroys = results.filter((r) => r.type === "destroy");
        return destroys.length >= 2;
    });
    await probe("lielow", "lielow promote", (_rec, results) =>
        results.some((r) => r.type === "promote"),
    );
    await probe("buku", "buku singletons EOG", (_rec, results) =>
        results.some((r) => r.type === "eog" && r.reason === "singletons"),
    );
    await probe("buku", "buku repetition EOG", (_rec, results) =>
        results.some((r) => r.type === "eog" && r.reason === "repetition"),
    );
    await probe("buku", "buku claim who!=mover", (rec, results) =>
        results.some((r) => {
            if (r.type !== "claim") {
                return false;
            }
            const who = r.who as number | undefined;
            return who !== undefined && who !== rec.header.players.length;
        }),
    );
    await probe("buku", "buku claim repetition", (_rec, results) =>
        results.some((r) => r.type === "claim" && r.how === "repetition"),
    );
    // Print first hit ids for manual fetch
    {
        const recs = await fetchMeta("buku");
        for (const rec of recs) {
            const results = slotResults(rec);
            if (results.some((r) => r.type === "claim" && r.how === "repetition")) {
                const id = gameIdFromRec(rec, "buku");
                console.log(`\n>>> buku repetition candidate: ${id}`);
                break;
            }
        }
    }
    await probe("magnate", "magnate roll+claim+capture", (_rec, results) => {
        const types = new Set(results.map((r) => r.type));
        return types.has("roll") && types.has("claim") && types.has("capture");
    });
    await probe("pigs2", "pigs2 timeout", (rec) => classify(rec) === "timeout");
    await probe("pigs2", "pigs2 resign", (rec) => classify(rec) === "resign");
    await probe("pigs2", "pigs2 abandoned", (rec) => classify(rec) === "abandoned");
    await probe("homeworlds", "homeworlds 3p+ completed", (rec) =>
        rec.header.players.length >= 3 && classify(rec) === "normal" && rec.moves.length >= 5,
    );
    await probe("canoe", "canoe completed 2p", (rec) =>
        rec.header.players.length === 2 && classify(rec) === "normal" && rec.moves.length >= 3,
    );
    await probe("tumbleweed", "tumbleweed self-capture", (_rec, results) =>
        results.some((r) => r.type === "capture" && r.whose !== undefined),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
