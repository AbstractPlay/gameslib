import type { CapturableRow } from "./types.js";
import {
    sortedOptionalGipf,
    takeSetForCaptureMask,
} from "./rows.js";

function lineFromKey(lineKey: string): string[] {
    return lineKey.split("|");
}

/** Contiguous spot runs along the line, ordered from the graph line. */
function contiguousTakenRuns(line: string[], take: Set<string>): string[][] {
    const runs: string[][] = [];
    let run: string[] = [];
    for (const cell of line) {
        if (take.has(cell)) {
            run.push(cell);
        } else if (run.length > 0) {
            runs.push(run);
            run = [];
        }
    }
    if (run.length > 0) {
        runs.push(run);
    }
    return runs;
}

function formatRun(run: string[], row: CapturableRow): string {
    const sorted = [...run].sort((a, b) => row.cells.indexOf(a) - row.cells.indexOf(b));
    return `x${sorted[0]!}-${sorted[sorted.length - 1]!}`;
}

/** Official row capture ply: `xe8-e5` or `xe8-e4` when optional GIPF removal changes the span. */
export function formatCaptureMove(row: CapturableRow, take: Set<string>): string {
    const line = lineFromKey(row.lineKey);
    const runs = contiguousTakenRuns(line, take);
    if (runs.length === 0) {
        return "x";
    }
    return runs.map((run) => formatRun(run, row)).join(",");
}

export function listCaptureConfirmMoves(row: CapturableRow, optionalGipf: string[]): string[] {
    const n = optionalGipf.length;
    if (n === 0) {
        return [formatCaptureMove(row, takeSetForCaptureMask(row, optionalGipf, 0))];
    }
    const seen = new Set<string>();
    const moves: string[] = [];
    for (let mask = 0; mask < 1 << n; mask++) {
        const take = takeSetForCaptureMask(row, optionalGipf, mask);
        const mv = formatCaptureMove(row, take);
        if (!seen.has(mv)) {
            seen.add(mv);
            moves.push(mv);
        }
    }
    return moves.sort();
}

export function takeSetForCaptureMove(
    m: string,
    row: CapturableRow,
    optionalGipf: string[],
): Set<string> | undefined {
    for (let mask = 0; mask < 1 << optionalGipf.length; mask++) {
        const take = takeSetForCaptureMask(row, optionalGipf, mask);
        if (formatCaptureMove(row, take) === m) {
            return take;
        }
    }
    if (optionalGipf.length === 0 && formatCaptureMove(row, takeSetForCaptureMask(row, [], 0)) === m) {
        return takeSetForCaptureMask(row, [], 0);
    }
    return undefined;
}

export function captureMaskForMove(
    m: string,
    row: CapturableRow,
    optionalGipf: string[],
): number | undefined {
    const sorted = sortedOptionalGipf(optionalGipf);
    for (let mask = 0; mask < 1 << sorted.length; mask++) {
        if (formatCaptureMove(row, takeSetForCaptureMask(row, optionalGipf, mask)) === m) {
            return mask;
        }
    }
    return undefined;
}

/** @deprecated Use {@link formatCaptureMove} */
export function formatCaptureNotation(row: CapturableRow, take: Set<string>): string {
    return formatCaptureMove(row, take);
}