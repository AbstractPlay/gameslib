import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase } from "./_base";
import { AmazonsGame, IAmazonsState } from "./amazons";

export { APGamesInformation, GameBase, AmazonsGame, IAmazonsState };

const games = new Map<string, typeof GameBase>();
// Manually add each game to the following array
[AmazonsGame].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g);
});
export { games };

export function GameFactory(game: string, state?: any): GameBase|undefined {
    switch (game) {
        case "amazons":
            return new AmazonsGame(state);
    }
    return;
}
