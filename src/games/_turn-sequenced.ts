import { GameBase } from "./_base";
import type { IGamePly, IGameRound, TurnModel } from "./_turn-model";
import { skipTurnShouldCloseRound, type ISkipTurnHost } from "./_turn-skip";

/** Seat-cycle round close (wrap to round opener), without skip-turn null slots. */
export function sequencedShouldCloseRound(
    game: ISkipTurnHost,
    roundPlies: IGamePly[],
    stackIndex: number,
): boolean {
    return skipTurnShouldCloseRound(game, roundPlies, stackIndex);
}

/**
 * Base for `turn-model: sequenced` games: seat-cycle round boundaries and sparse
 * export rows (one ply per row when the same seat acts more than once per round).
 *
 * Ply actors default to `stack[stackIndex - 1].currplayer`. Override `plyActor` or
 * `shouldCloseRound` when a game needs richer turn structure than plain seat order.
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
