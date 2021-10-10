import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase } from "./_base";
import { AmazonsGame, IAmazonsState } from "./amazons";
import { BlamGame, IBlamState } from "./blam";

export { APGamesInformation, GameBase, AmazonsGame, IAmazonsState, BlamGame, IBlamState };

const games = new Map<string, typeof AmazonsGame | typeof BlamGame>();
// Manually add each game to the following array
[AmazonsGame, BlamGame].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g);
});
export { games };

export function GameFactory(game: string, ...args: any[]): GameBase|undefined {
    switch (game) {
        case "amazons":
            return new AmazonsGame(args[0]);
        case "blam":
            return new BlamGame(args[0], args[1]);
    }
    return;
}
