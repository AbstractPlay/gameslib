import type { YinshGraph } from "./graph.js";
import type { CapturableRow, playerid } from "./types.js";

function rowId(owner: playerid, cells: string[]): string {
    return `${owner}:${cells.join(",")}`;
}

function lineKey(line: string[]): string {
    return [...line].sort().join("|");
}

function fiveSegments(core: string[]): string[][] {
    const segments: string[][] = [];
    if (core.length < 5) {
        return segments;
    }
    if (core.length === 5) {
        return [[...core]];
    }
    for (let start = 0; start <= core.length - 5; start++) {
        segments.push(core.slice(start, start + 5));
    }
    return segments;
}

export function capturableRowsOnLine(
    line: string[],
    markers: Map<string, playerid>,
    rings: Map<string, playerid>,
): CapturableRow[] {
    const rows: CapturableRow[] = [];
    let i = 0;
    while (i < line.length) {
        const cell = line[i]!;
        if (rings.has(cell)) {
            i++;
            continue;
        }
        const colour = markers.get(cell);
        if (colour === undefined) {
            i++;
            continue;
        }
        let j = i;
        while (j + 1 < line.length) {
            const next = line[j + 1]!;
            if (rings.has(next)) {
                break;
            }
            const nc = markers.get(next);
            if (nc === undefined || nc !== colour) {
                break;
            }
            j++;
        }
        const core = line.slice(i, j + 1).filter((c) => !rings.has(c) && markers.get(c) === colour);
        if (core.length >= 5) {
            const segments = fiveSegments(core);
            rows.push({
                id: rowId(colour, core),
                lineKey: lineKey(line),
                owner: colour,
                cells: [...core],
                core,
                segments,
            });
        }
        i = j + 1;
    }
    return rows;
}

export function rowSetKey(row: CapturableRow): string {
    const core = [...row.core].sort().join(",");
    return `${row.owner}:${core}`;
}

/** Drop strict subsets of another same-colour row (5-in-6 is segment choice, not row choice). */
export function pruneNestedCapturableRows(rows: CapturableRow[]): CapturableRow[] {
    return rows.filter((row) => {
        return !rows.some((other) => {
            if (other === row || other.owner !== row.owner) {
                return false;
            }
            if (other.core.length <= row.core.length) {
                return false;
            }
            return row.core.every((c) => other.core.includes(c));
        });
    });
}

export function findAllCapturableRows(
    markers: Map<string, playerid>,
    rings: Map<string, playerid>,
    graph: YinshGraph,
): CapturableRow[] {
    const byKey = new Map<string, CapturableRow>();
    for (const line of graph.allLines()) {
        for (const row of capturableRowsOnLine(line, markers, rings)) {
            const key = rowSetKey(row);
            const existing = byKey.get(key);
            if (existing === undefined || row.lineKey.length > existing.lineKey.length) {
                byKey.set(key, row);
            }
        }
    }
    return pruneNestedCapturableRows([...byKey.values()]);
}

export function defaultMarkerTake(row: CapturableRow): Set<string> {
    if (row.core.length === 5) {
        return new Set(row.core);
    }
    return new Set(row.segments[0]!);
}

export function takeSetForSegment(row: CapturableRow, segment: string[]): Set<string> | undefined {
    if (segment.length !== 5) {
        return undefined;
    }
    const key = segment.join(",");
    const match = row.segments.find((s) => s.join(",") === key);
    if (match === undefined) {
        return undefined;
    }
    return new Set(match);
}

export function rowsNeedChoice(rows: CapturableRow[]): boolean {
    if (rows.length < 2) {
        return false;
    }
    for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i]!;
            const b = rows[j]!;
            if (a.cells.some((c) => b.cells.includes(c))) {
                return true;
            }
        }
    }
    return false;
}

export function rowNeedsSegmentChoice(row: CapturableRow): boolean {
    return row.segments.length > 1;
}

/** Marker cells along `first`–`last` on the row line (subset of `core` that still have markers). */
export function markerTakeFromSpan(
    row: CapturableRow,
    first: string,
    last: string,
    hasMarker: (cell: string) => boolean,
): Set<string> {
    const line = row.lineKey.split("|");
    const i = line.indexOf(first);
    const j = line.indexOf(last);
    if (i === -1 || j === -1) {
        return new Set();
    }
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const take = new Set<string>();
    for (let k = lo; k <= hi; k++) {
        const cell = line[k]!;
        if (row.core.includes(cell) && hasMarker(cell)) {
            take.add(cell);
        }
    }
    return take;
}

export function takeIsOnRowCore(row: CapturableRow, take: Set<string>): boolean {
    for (const cell of take) {
        if (!row.core.includes(cell)) {
            return false;
        }
    }
    return true;
}

/** Exactly five markers matching one legal segment on this row. */
export function isValidMarkerTake(row: CapturableRow, take: Set<string>): boolean {
    if (take.size !== 5) {
        return false;
    }
    return row.segments.some((seg) => seg.length === 5 && seg.every((c) => take.has(c)));
}