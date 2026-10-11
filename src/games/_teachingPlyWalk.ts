import type { IGamePly } from "./_turn-model.js";
import { hasMultiplePliesPerStackIndex } from "./_turn-move-table.js";

/** Maximal trailing run of plies by `actor` (1-based seat), from the end of `plies`. */
export type TrailingSameActorRun = {
    plies: IGamePly[];
    first: IGamePly;
    last: IGamePly;
};

export function trailingSameActorRun(plies: IGamePly[], actor: number): TrailingSameActorRun | null {
    if (plies.length === 0 || plies[plies.length - 1].actor !== actor) {
        return null;
    }
    let start = plies.length - 1;
    while (start > 0 && plies[start - 1].actor === actor) {
        start -= 1;
    }
    const run = plies.slice(start);
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) {
        return null;
    }
    return { plies: run, first, last };
}

/**
 * Stack length after rolling back the trailing same-actor run (state before `first` ply).
 * Matches `walkStackPlies`: ply at `stackIndex` is stored in `stack[stackIndex]`.
 */
export function targetStackLengthBeforeTrailingRun(run: TrailingSameActorRun): number {
    return run.first.stackIndex;
}

/**
 * True when every ply maps to a distinct stack index 1 … stackLength−1 (normal `submit_move` path).
 */
export function pliesAlignWithStackWalk(plies: IGamePly[], stackLength: number): boolean {
    if (stackLength < 1) {
        return false;
    }
    const expectedPlyCount = stackLength - 1;
    if (plies.length !== expectedPlyCount) {
        return false;
    }
    for (let i = 0; i < plies.length; i++) {
        if (plies[i].stackIndex !== i + 1) {
            return false;
        }
    }
    return true;
}

/**
 * Teaching-mode rollback is only well-defined when each ply has its own stack frame.
 * (Contrast: simultaneous wire moves may share one `stackIndex`.)
 */
export function teachingPlyWalkSupported(plies: IGamePly[]): boolean {
    return !hasMultiplePliesPerStackIndex(plies);
}
