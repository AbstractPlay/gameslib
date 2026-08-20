import { GameBase } from "./_base";
import type { IGamePly, IGameRound, TurnModel } from "./_turn-model";
import { defaultPlyActor } from "./_turn-plies";
import { skipTurnShouldCloseRound, type ISkipTurnHost } from "./_turn-skip";

export interface IFroggerStackState {
    currplayer?: number;
    skipto?: number;
}

/** Seat-cycle round close (wrap to round opener), without skip-turn null slots. */
export function sequencedShouldCloseRound(
    game: ISkipTurnHost,
    roundPlies: IGamePly[],
    stackIndex: number,
): boolean {
    return skipTurnShouldCloseRound(game, roundPlies, stackIndex);
}

/**
 * Refill `skipto` can insert consecutive plies for one seat before the cycle completes.
 * Do not close while `skipto` is still set on the post-move stack entry.
 */
export function froggerRefillsShouldCloseRound(
    game: ISkipTurnHost & { stack: IFroggerStackState[] },
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

/**
 * During refill follow-up, `currplayer` advances round-robin while `skipto` names
 * the seat that still owes a supplemental submit.
 */
export function froggerPlyActor(game: GameBase, stackIndex: number): number {
    const prev = game.stack[stackIndex - 1] as IFroggerStackState;
    if (prev.skipto !== undefined) {
        if (prev.skipto !== prev.currplayer) {
            return prev.currplayer as number;
        }
        return prev.skipto as number;
    }
    return defaultPlyActor(game, stackIndex);
}

/**
 * Optional base for games that export `turn-model: sequenced` with seat-cycle round
 * boundaries. Individual games can instead override mixin hooks on `GameBase` when
 * they need custom `plyActor` / `shouldCloseRound` without inheriting this class.
 */
export abstract class GameBaseSequenced extends GameBase {
    public turnModel(): TurnModel {
        return "sequenced";
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    /** Consecutive plies by the same seat use one sparse row per ply. */
    public getRounds(): IGameRound[] {
        return this.getPlies().map((ply) => this.buildRoundRow([ply]));
    }

    protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
        return rounds;
    }
}
