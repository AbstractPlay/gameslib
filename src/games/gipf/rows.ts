import type { GipfGraph } from "./graph.js";
import type { CapturableRow, CellPiece, playerid, RulesVariant } from "./types.js";

function rowId(owner: playerid, cells: string[]): string {
    return `${owner}:${cells.join(",")}`;
}

function lineKey(line: string[]): string {
    return [...line].sort().join("|");
}

/** Find capturable rows on one GIPF line (spots only for runs; extensions use full line). */
export function capturableRowsOnLine(
    line: string[],
    board: Map<string, CellPiece>,
    graph: GipfGraph,
): CapturableRow[] {
    const spots = line.filter((c) => graph.isSpot(c));
    const rows: CapturableRow[] = [];
    let i = 0;
    while (i < spots.length) {
        const cell = spots[i]!;
        const occ = board.get(cell);
        if (occ === undefined) {
            i++;
            continue;
        }
        let j = i;
        while (j + 1 < spots.length) {
            const n = spots[j + 1]!;
            const next = board.get(n);
            if (next === undefined || next.owner !== occ.owner) {
                break;
            }
            j++;
        }
        const runLen = j - i + 1;
        if (runLen >= 4) {
            const core = spots.slice(i, j + 1);
            const startIdx = line.indexOf(core[0]!);
            const endIdx = line.indexOf(core[core.length - 1]!);
            const cells: string[] = [...core];
            for (let k = startIdx - 1; k >= 0; k--) {
                const c = line[k]!;
                if (!board.has(c)) {
                    break;
                }
                cells.unshift(c);
            }
            for (let k = endIdx + 1; k < line.length; k++) {
                const c = line[k]!;
                if (!board.has(c)) {
                    break;
                }
                cells.push(c);
            }
            rows.push({
                id: rowId(occ.owner, core),
                lineKey: lineKey(line),
                owner: occ.owner,
                cells,
                core,
            });
        }
        i = j + 1;
    }
    return rows;
}

export function findAllCapturableRows(
    board: Map<string, CellPiece>,
    graph: GipfGraph,
): CapturableRow[] {
    const byKey = new Map<string, CapturableRow>();
    for (const line of graph.allLines()) {
        for (const row of capturableRowsOnLine(line, board, graph)) {
            byKey.set(row.id, row);
        }
    }
    return [...byKey.values()];
}

export function defaultGipfTake(
    row: CapturableRow,
    board: Map<string, CellPiece>,
    actor: playerid,
    variant: RulesVariant,
): Set<string> {
    const take = new Set<string>();
    for (const c of row.cells) {
        const p = board.get(c);
        if (p === undefined) {
            continue;
        }
        if (p.kind === "gipf" && variant !== "basic") {
            if (p.owner !== actor) {
                take.add(c);
            }
            continue;
        }
        take.add(c);
    }
    return take;
}

export function optionalGipfOnRow(
    row: CapturableRow,
    board: Map<string, CellPiece>,
    variant: RulesVariant,
): string[] {
    if (variant === "basic") {
        return [];
    }
    return row.cells.filter((c) => board.get(c)?.kind === "gipf");
}

export function sortedOptionalGipf(cells: string[]): string[] {
    return [...cells].sort();
}

/** Bit *i* is set when sorted `optionalGipf[i]` is removed; mandatory row cells are always taken. */
export function takeSetForCaptureMask(
    row: CapturableRow,
    optionalGipf: string[],
    mask: number,
): Set<string> {
    const optional = new Set(optionalGipf);
    const sorted = sortedOptionalGipf(optionalGipf);
    const take = new Set<string>();
    for (const c of row.cells) {
        if (!optional.has(c)) {
            take.add(c);
        }
    }
    for (let i = 0; i < sorted.length; i++) {
        if ((mask & (1 << i)) !== 0) {
            take.add(sorted[i]!);
        }
    }
    return take;
}

export function captureMaskFromTake(optionalGipf: string[], take: Set<string>): number {
    const sorted = sortedOptionalGipf(optionalGipf);
    let mask = 0;
    for (let i = 0; i < sorted.length; i++) {
        if (take.has(sorted[i]!)) {
            mask |= 1 << i;
        }
    }
    return mask;
}
