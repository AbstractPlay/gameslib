import type { CapturableRow } from "./types.js";
import { defaultMarkerTake, takeSetForSegment } from "./rows.js";

function lineFromKey(lineKey: string): string[] {
    return lineKey.split("|");
}

function orderEndpoints(a: string, b: string, line: string[]): [string, string] {
    const ia = line.indexOf(a);
    const ib = line.indexOf(b);
    if (ia === -1 || ib === -1) {
        return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
    }
    return ia <= ib ? [a, b] : [b, a];
}

/** Official marker row ply: `xg5-g9`. */
export function formatMarkerRowMove(row: CapturableRow, take: Set<string>): string {
    const line = lineFromKey(row.lineKey);
    const ordered = row.cells.filter((c) => take.has(c)).sort((a, b) => line.indexOf(a) - line.indexOf(b));
    if (ordered.length === 0) {
        return "x";
    }
    const [first, last] = orderEndpoints(ordered[0]!, ordered[ordered.length - 1]!, line);
    return `x${first}-${last}`;
}

export function listMarkerRowMoves(row: CapturableRow): string[] {
    if (row.segments.length <= 1) {
        return [formatMarkerRowMove(row, defaultMarkerTake(row))];
    }
    const seen = new Set<string>();
    const moves: string[] = [];
    for (const seg of row.segments) {
        const take = new Set(seg);
        const mv = formatMarkerRowMove(row, take);
        if (!seen.has(mv)) {
            seen.add(mv);
            moves.push(mv);
        }
    }
    return moves.sort();
}

export function takeSetForMarkerMove(m: string, row: CapturableRow): Set<string> | undefined {
    const normalized = m.toLowerCase().replace(/\s+/g, "");
    for (const seg of row.segments) {
        const take = new Set(seg);
        if (formatMarkerRowMove(row, take) === normalized) {
            return take;
        }
    }
    const body = normalized.startsWith("x") ? normalized.slice(1) : normalized;
    if (!body.includes("-")) {
        return undefined;
    }
    const [a, b] = body.split("-") as [string, string];
    const line = lineFromKey(row.lineKey);
    const [first, last] = orderEndpoints(a, b, line);
    const i = line.indexOf(first);
    const j = line.indexOf(last);
    if (i === -1 || j === -1) {
        return undefined;
    }
    const segment = i <= j ? line.slice(i, j + 1) : line.slice(j, i + 1);
    const take = takeSetForSegment(row, segment);
    if (take === undefined) {
        return undefined;
    }
    if (formatMarkerRowMove(row, take) !== normalized) {
        return undefined;
    }
    return take;
}

export function parseRingRemovalMove(m: string): string | undefined {
    if (!m.startsWith("x") || m.includes("-")) {
        return undefined;
    }
    const cell = m.slice(1).toLowerCase();
    if (cell.length < 2) {
        return undefined;
    }
    return cell;
}

export function formatRingRemovalMove(cell: string): string {
    return `x${cell.toLowerCase()}`;
}