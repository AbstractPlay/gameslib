import type { MarbleColour, MarbleCounts, playerid } from "./types.js";
import { MARBLE_COLOURS } from "./types.js";

export interface WinThresholds {
    tripleEach: number;
    white: number;
    grey: number;
    black: number;
}

export function thresholds(blitz: boolean): WinThresholds {
    if (blitz) {
        return { tripleEach: 2, white: 3, grey: 4, black: 5 };
    }
    return { tripleEach: 3, white: 4, grey: 5, black: 6 };
}

/** Catalog leaf under `apresults:zertz.EOG.*` when a capturing set is complete. */
export type CaptureWinReason = "each" | "white" | "grey" | "black";

export function captureWinReason(
    captured: MarbleCounts,
    blitz: boolean,
): CaptureWinReason | undefined {
    const t = thresholds(blitz);
    if (
        captured.W >= t.tripleEach &&
        captured.G >= t.tripleEach &&
        captured.B >= t.tripleEach
    ) {
        return "each";
    }
    if (captured.W >= t.white) {
        return "white";
    }
    if (captured.G >= t.grey) {
        return "grey";
    }
    if (captured.B >= t.black) {
        return "black";
    }
    return undefined;
}

export function playerWins(captured: MarbleCounts, blitz: boolean): boolean {
    return captureWinReason(captured, blitz) !== undefined;
}

export function captureWinThreshold(
    reason: CaptureWinReason,
    blitz: boolean,
): number {
    const t = thresholds(blitz);
    switch (reason) {
        case "each":
            return t.tripleEach;
        case "white":
            return t.white;
        case "grey":
            return t.grey;
        case "black":
            return t.black;
    }
}

export function winnersFromCaptures(
    captured: [MarbleCounts, MarbleCounts],
    blitz: boolean,
): playerid[] {
    const w1 = playerWins(captured[0], blitz);
    const w2 = playerWins(captured[1], blitz);
    if (w1 && w2) {
        return [1, 2];
    }
    if (w1) {
        return [1];
    }
    if (w2) {
        return [2];
    }
    return [];
}

export function incrementCapture(
    counts: MarbleCounts,
    colour: MarbleColour,
    n = 1,
): MarbleCounts {
    return { ...counts, [colour]: counts[colour] + n };
}

export function decrementCapture(counts: MarbleCounts, colour: MarbleColour): boolean {
    if (counts[colour] <= 0) {
        return false;
    }
    counts[colour]--;
    return true;
}

export function marblesInPool(pool: MarbleCounts): number {
    return MARBLE_COLOURS.reduce((s, c) => s + pool[c], 0);
}