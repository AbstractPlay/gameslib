import { reviver } from "../common/index.js";
import type { APMoveResult } from "../schemas/moveresults.js";
import { GuerrillaGame, type IGuerrillaState, type IMoveState } from "./guerrilla.js";

export type GuerrillaMatchStackRepairResult = {
    state: IGuerrillaState;
    repaired: boolean;
    reason?: string;
};

export function guerrillaStateUsesMatchVariant(variants: string[] | undefined): boolean {
    if (variants === undefined || variants.length === 0) {
        return true;
    }
    return variants.includes("match");
}

/** Legacy combined G1→G2 transition row (pre–two-save fix). */
export function isCombinedGuerrillaTransitionFrame(entry: IMoveState): boolean {
    const results = entry._results ?? [];
    if (!results.some((r) => r.type === "reset")) {
        return false;
    }
    if (!results.some((r) => r.type === "winners")) {
        return false;
    }
    return !Object.prototype.hasOwnProperty.call(entry, "lastmove");
}

function boardsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [key, owner] of a) {
        if (b.get(key) !== owner) {
            return false;
        }
    }
    return true;
}

function plyResultsFromFrame(results: APMoveResult[] | undefined): APMoveResult[] {
    return (results ?? []).filter((r) => r.type !== "winners" && r.type !== "reset" && r.type !== "eog");
}

function plyResultsMatch(a: APMoveResult[], b: APMoveResult[]): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function cloneMoveState(entry: IMoveState): IMoveState {
    const copy: IMoveState = {
        _version: entry._version,
        _results: entry._results !== undefined ? [...entry._results] : [],
        _timestamp: entry._timestamp,
        currplayer: entry.currplayer,
        board: new Map(entry.board),
        insurgents: entry.insurgents,
        rolesSwapped: entry.rolesSwapped,
        g1insurgentScore: entry.g1insurgentScore,
    };
    if (Object.prototype.hasOwnProperty.call(entry, "lastmove") && entry.lastmove !== undefined) {
        copy.lastmove = entry.lastmove;
    }
    return copy;
}

function inferG1EndMove(partial: IGuerrillaState, corrupt: IMoveState): string | undefined {
    const g = new GuerrillaGame(partial);
    const prevIndex = partial.stack.length - 1;
    g.load(prevIndex);
    const expectedPlyResults = plyResultsFromFrame(corrupt._results);
    const candidates: string[] = [];
    for (const m of g.moves()) {
        const trial = new GuerrillaGame(partial);
        trial.load(prevIndex);
        trial.move(m, {trusted: true});
        if (trial.stack.length !== partial.stack.length + 2) {
            continue;
        }
        const g1Frame = trial.stack[trial.stack.length - 2] as IMoveState;
        const resetFrame = trial.stack[trial.stack.length - 1] as IMoveState;
        if (!Object.prototype.hasOwnProperty.call(g1Frame, "lastmove")) {
            continue;
        }
        if (!plyResultsMatch(plyResultsFromFrame(g1Frame._results), expectedPlyResults)) {
            continue;
        }
        if (g1Frame.g1insurgentScore !== corrupt.g1insurgentScore) {
            continue;
        }
        if (!boardsEqual(resetFrame.board, corrupt.board)) {
            continue;
        }
        if (resetFrame.currplayer !== corrupt.currplayer) {
            continue;
        }
        if (resetFrame.rolesSwapped !== corrupt.rolesSwapped) {
            continue;
        }
        candidates.push(m);
    }
    if (candidates.length !== 1) {
        return undefined;
    }
    return candidates[0];
}

function splitCombinedFrame(
    state: IGuerrillaState,
    index: number,
): { g1End: IMoveState; g2Reset: IMoveState } | undefined {
    const corrupt = state.stack[index] as IMoveState;
    const partial: IGuerrillaState = {
        ...state,
        stack: state.stack.slice(0, index),
    };
    const move = inferG1EndMove(partial, corrupt);
    if (move === undefined) {
        return undefined;
    }
    const trial = new GuerrillaGame(partial);
    trial.load(partial.stack.length - 1);
    trial.move(move, {trusted: true});
    const g1End = cloneMoveState(trial.stack[trial.stack.length - 2] as IMoveState);
    const g2Reset = cloneMoveState(trial.stack[trial.stack.length - 1] as IMoveState);
    return { g1End, g2Reset };
}

/**
 * Split legacy combined match-transition stack rows into G1-ending ply + G2 reset checkpoint.
 */
export function repairGuerrillaMatchStack(
    input: IGuerrillaState | string,
): GuerrillaMatchStackRepairResult {
    let state: IGuerrillaState;
    if (typeof input === "string") {
        state = JSON.parse(input, reviver) as IGuerrillaState;
    } else {
        state = input;
    }
    if (state.game !== GuerrillaGame.gameinfo.uid) {
        return { state, repaired: false, reason: "not guerrilla" };
    }
    if (!guerrillaStateUsesMatchVariant(state.variants)) {
        return { state, repaired: false };
    }

    const stack = [...state.stack];
    let repairedAny = false;
    for (let i = stack.length - 1; i >= 1; i--) {
        const entry = stack[i] as IMoveState;
        if (!isCombinedGuerrillaTransitionFrame(entry)) {
            continue;
        }
        const split = splitCombinedFrame({ ...state, stack }, i);
        if (split === undefined) {
            return {
                state,
                repaired: false,
                reason: `could not infer game-1 ending move at stack index ${i}`,
            };
        }
        stack.splice(i, 1, split.g1End, split.g2Reset);
        repairedAny = true;
    }

    if (!repairedAny) {
        return { state, repaired: false };
    }

    const repairedState: IGuerrillaState = {
        ...state,
        stack,
    };
    const engine = new GuerrillaGame(repairedState);
    engine.getPlies();
    return { state: repairedState, repaired: true };
}

/** Parse and repair a serialized guerrilla state JSON string (no-op when clean). */
export function repairGuerrillaMatchStackJson(stateJson: string): {
    stateJson: string;
    repaired: boolean;
    reason?: string;
} {
    const { state, repaired, reason } = repairGuerrillaMatchStack(stateJson);
    if (!repaired) {
        return { stateJson, repaired: false, reason };
    }
    const engine = new GuerrillaGame(state);
    return { stateJson: engine.serialize(), repaired: true };
}
