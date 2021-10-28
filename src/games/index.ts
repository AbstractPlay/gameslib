import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, IAPGameState } from "./_base";
import { AmazonsGame, IAmazonsState } from "./amazons";
import { BlamGame, IBlamState } from "./blam";
import { CannonGame, ICannonState } from "./cannon";
import { MchessGame, IMchessState } from "./mchess";
import { HomeworldsGame, IHomeworldsState } from "./homeworlds";

export {
    APGamesInformation, GameBase, IAPGameState,
    AmazonsGame, IAmazonsState,
    BlamGame, IBlamState,
    CannonGame, ICannonState,
    MchessGame, IMchessState,
    HomeworldsGame, IHomeworldsState
};

const games = new Map<string, typeof AmazonsGame | typeof BlamGame | typeof CannonGame | typeof MchessGame | typeof HomeworldsGame>();
// Manually add each game to the following array
[AmazonsGame, BlamGame, CannonGame, MchessGame, HomeworldsGame].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g);
});
export { games };

export function GameFactory(game: string, ...args: any[]): GameBase|undefined {
    switch (game) {
        case "amazons":
            return new AmazonsGame(...args);
        case "blam":
            return new BlamGame(args[0], ...args);
        case "cannon":
            return new CannonGame(...args);
        case "mchess":
            return new MchessGame(...args);
        case "homeworlds":
            return new HomeworldsGame(args[0]);
    }
    return;
}
