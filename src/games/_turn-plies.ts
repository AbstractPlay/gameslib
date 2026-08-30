import type { GameBase } from "./_base.js";
import type { IGamePly } from "./_turn-model.js";

export interface IPlyWalkHost {
    readonly stack: GameBase["stack"];
    readonly numplayers: number;
    plyFromStack(stackIndex: number): IGamePly;
    shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean;
}

/** Who made the move that produced `stack[stackIndex]`? Default: `stack[stackIndex - 1].currplayer`. */
export function defaultPlyActor(game: GameBase, stackIndex: number): number {
    const prevState = game.stack[stackIndex - 1];
    if (!("currplayer" in prevState)) {
        throw new Error("plyActor requires `currplayer` on the stack entry before the move.");
    }
    return prevState.currplayer as number;
}

/** Default stride: close every ply at 1p; else every `numplayers` plies. */
export function defaultShouldCloseRound(game: GameBase, roundPlies: IGamePly[]): boolean {
    if (roundPlies.length === 0) {
        return false;
    }
    if (game.numplayers === 1) {
        return true;
    }
    return roundPlies.length >= game.numplayers;
}

/** Walk `stackIndex = 1 … length-1` and assign round / playOrder via game hooks. */
export function walkStackPlies(game: IPlyWalkHost): IGamePly[] {
    const plies: IGamePly[] = [];
    let round = 0;
    let playOrderInRound = 0;
    let roundPlies: IGamePly[] = [];

    for (let stackIndex = 1; stackIndex < game.stack.length; stackIndex++) {
        const ply = game.plyFromStack(stackIndex);
        playOrderInRound += 1;
        ply.round = round;
        ply.playOrder = playOrderInRound;
        roundPlies.push(ply);
        plies.push(ply);

        if (game.shouldCloseRound(roundPlies, stackIndex)) {
            round += 1;
            playOrderInRound = 0;
            roundPlies = [];
        }
    }
    return plies;
}
