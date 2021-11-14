import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, IAPGameState } from "./_base";
import { AmazonsGame, IAmazonsState } from "./amazons";
import { BlamGame, IBlamState } from "./blam";
import { CannonGame, ICannonState } from "./cannon";
import { MchessGame, IMchessState } from "./mchess";
import { HomeworldsGame, IHomeworldsState } from "./homeworlds";
import { EntropyGame, IEntropyState } from "./entropy";
import { VolcanoGame, IVolcanoState } from "./volcano";
import { MvolcanoGame, IMvolcanoState } from "./mvolcano";
import { ChaseGame, IChaseState } from "./chase";
import { AbandeGame, IAbandeState } from "./abande";
import { CephalopodGame, ICephalopodState } from "./ceph";
import { LinesOfActionGame, ILinesOfActionState } from "./loa";
import { PikemenGame, IPikemenState } from "./pikemen";
import { OrdoGame, IOrdoState } from "./ordo";

export {
    APGamesInformation, GameBase, IAPGameState,
    AmazonsGame, IAmazonsState,
    BlamGame, IBlamState,
    CannonGame, ICannonState,
    MchessGame, IMchessState,
    HomeworldsGame, IHomeworldsState,
    EntropyGame, IEntropyState,
    VolcanoGame, IVolcanoState,
    MvolcanoGame, IMvolcanoState,
    ChaseGame, IChaseState,
    AbandeGame, IAbandeState,
    CephalopodGame, ICephalopodState,
    LinesOfActionGame, ILinesOfActionState,
    PikemenGame, IPikemenState,
    OrdoGame, IOrdoState,
};

const games = new Map<string, typeof AmazonsGame | typeof BlamGame | typeof CannonGame |
                              typeof MchessGame | typeof HomeworldsGame | typeof EntropyGame |
                              typeof VolcanoGame | typeof MvolcanoGame | typeof ChaseGame |
                              typeof AbandeGame | typeof CephalopodGame | typeof LinesOfActionGame |
                              typeof PikemenGame | typeof OrdoGame>();
// Manually add each game to the following array
[AmazonsGame, BlamGame, CannonGame, MchessGame, HomeworldsGame, EntropyGame, VolcanoGame, MvolcanoGame,
    ChaseGame, AbandeGame, CephalopodGame, LinesOfActionGame, PikemenGame, OrdoGame].forEach((g) => {
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
        case "entropy":
            return new EntropyGame(...args);
        case "volcano":
            return new VolcanoGame(...args);
        case "mvolcano":
            return new MvolcanoGame(...args);
        case "chase":
            return new ChaseGame(...args);
        case "abande":
            return new AbandeGame(...args);
        case "ceph":
            return new CephalopodGame(...args);
        case "loa":
            return new LinesOfActionGame(...args);
        case "pikemen":
            return new PikemenGame(...args);
        case "ordo":
            return new OrdoGame(...args);
    }
    return;
}
