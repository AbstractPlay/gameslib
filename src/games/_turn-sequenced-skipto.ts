import type { GameBase } from "./_base";
import { defaultPlyActor } from "./_turn-plies";
import type { IGamePly } from "./_turn-model";
import { sequencedShouldCloseRound } from "./_turn-sequenced";
import type { ISkipTurnHost } from "./_turn-skip";

/**
 * Legacy stack-field support for Frogger refills (`skipto`). New sequenced games
 * should model supplemental turns in game logic and rely on {@link GameBaseSequenced}
 * hooks instead of this stack flag.
 */
export interface ISkiptoStackState {
    currplayer?: number;
    skipto?: number;
    lastmove?: string;
}

/**
 * While `skipto` is still set on the post-move stack entry, supplemental follow-up
 * plies belong in the same logical round even if `currplayer` wraps to the opener.
 */
export function sequencedSkiptoShouldCloseRound(
    game: ISkipTurnHost & { stack: ISkiptoStackState[] },
    roundPlies: IGamePly[],
    stackIndex: number,
): boolean {
    if (roundPlies.length === 0) {
        return false;
    }
    const after = game.stack[stackIndex];
    if (after?.skipto !== undefined) {
        return false;
    }
    return sequencedShouldCloseRound(game, roundPlies, stackIndex);
}

function seatAfter(seat: number, numplayers: number): number {
    return seat >= numplayers ? 1 : seat + 1;
}

function countPriorSkiptoPasses(
    stack: ISkiptoStackState[],
    stackIndex: number,
    skipto: number,
): number {
    let count = 0;
    for (let i = stackIndex - 1; i >= 1; i--) {
        const entry = stack[i]!;
        const prev = stack[i - 1]!;
        if (prev.skipto !== skipto) {
            if (entry.skipto === skipto && prev.skipto === undefined) {
                break;
            }
            break;
        }
        if (entry.lastmove === "pass") {
            count++;
        }
    }
    return count;
}

function passActorDuringSkipto(skipto: number, passIndex: number, numplayers: number): number {
    let actor = seatAfter(skipto, numplayers);
    for (let i = 0; i < passIndex; i++) {
        actor = seatAfter(actor, numplayers);
    }
    return actor;
}

/**
 * Ply actor while a legacy `skipto` obligation is pending on the stack.
 */
export function sequencedSkiptoPlyActor(game: GameBase, stackIndex: number): number {
    const stack = game.stack as ISkiptoStackState[];
    const prev = stack[stackIndex - 1]!;
    const entry = stack[stackIndex]!;

    if (entry.skipto !== undefined && prev.skipto === undefined) {
        return entry.skipto as number;
    }

    if (prev.skipto !== undefined) {
        if (prev.skipto === prev.currplayer) {
            return prev.skipto as number;
        }
        if (entry.lastmove === "pass") {
            const passIndex = countPriorSkiptoPasses(stack, stackIndex, prev.skipto);
            return passActorDuringSkipto(prev.skipto, passIndex, game.numplayers);
        }
    }

    return defaultPlyActor(game, stackIndex);
}
