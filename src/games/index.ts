/* eslint-disable @typescript-eslint/no-unsafe-argument */
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
import { AttangleGame, IAttangleState } from "./attangle";
import { AccastaGame, IAccastaState } from "./accasta";
import { EpamGame, IEpamState } from "./epam";
import { TaijiGame, ITaijiState } from "./taiji";
import { BreakthroughGame, IBreakthroughState } from "./breakthrough";
import { FabrikGame, IFabrikState } from "./fabrik";
import { ManalathGame, IManalathState } from "./manalath";
import { UrbinoGame, IUrbinoState } from "./urbino";
import { FendoGame, IFendoState } from "./fendo";
import { ArchimedesGame, IArchimedesState } from "./archimedes";
import { ZolaGame, IZolaState } from "./zola";
import { MonkeyQueenGame, IMonkeyQueenState } from "./monkey";
import { DipoleGame, IDipoleState } from "./dipole";
import { AlfredsWykeGame, IAlfredsWykeState } from "./wyke";
import { RealmGame, IRealmState } from "./realm";
import { ACityGame, IACityState } from "./acity";
import { FanoronaGame, IFanoronaState } from "./fanorona";

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
    AttangleGame, IAttangleState,
    AccastaGame, IAccastaState,
    EpamGame, IEpamState,
    TaijiGame, ITaijiState,
    BreakthroughGame, IBreakthroughState,
    FabrikGame, IFabrikState,
    ManalathGame, IManalathState,
    UrbinoGame, IUrbinoState,
    FendoGame, IFendoState,
    ArchimedesGame, IArchimedesState,
    ZolaGame, IZolaState,
    MonkeyQueenGame, IMonkeyQueenState,
    DipoleGame, IDipoleState,
    AlfredsWykeGame, IAlfredsWykeState,
    RealmGame, IRealmState,
    ACityGame, IACityState,
    FanoronaGame, IFanoronaState,
};

const games = new Map<string, typeof AmazonsGame | typeof BlamGame | typeof CannonGame |
                              typeof MchessGame | typeof HomeworldsGame | typeof EntropyGame |
                              typeof VolcanoGame | typeof MvolcanoGame | typeof ChaseGame |
                              typeof AbandeGame | typeof CephalopodGame | typeof LinesOfActionGame |
                              typeof PikemenGame | typeof OrdoGame | typeof AttangleGame |
                              typeof AccastaGame | typeof EpamGame | typeof TaijiGame | typeof BreakthroughGame |
                              typeof FabrikGame | typeof ManalathGame | typeof UrbinoGame | typeof FendoGame |
                              typeof ArchimedesGame | typeof ZolaGame | typeof MonkeyQueenGame | typeof DipoleGame | typeof AlfredsWykeGame | typeof RealmGame |
                              typeof ACityGame | typeof FanoronaGame
                >();
// Manually add each game to the following array
[AmazonsGame, BlamGame, CannonGame, MchessGame, HomeworldsGame, EntropyGame, VolcanoGame, MvolcanoGame, ChaseGame, AbandeGame, CephalopodGame, LinesOfActionGame, PikemenGame, OrdoGame, AttangleGame, AccastaGame, EpamGame, TaijiGame, BreakthroughGame, FabrikGame, ManalathGame, UrbinoGame, FendoGame, ArchimedesGame, ZolaGame, MonkeyQueenGame, DipoleGame, AlfredsWykeGame, RealmGame, ACityGame, FanoronaGame].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g);
});
export { games };

// eslint-disable-next-line @typescript-eslint/naming-convention
export const GameFactory = (game: string, ...args: any[]): GameBase|undefined => {
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
        case "attangle":
            return new AttangleGame(...args);
        case "accasta":
            return new AccastaGame(...args);
        case "epam":
            return new EpamGame(...args);
        case "taiji":
            return new TaijiGame(...args);
        case "breakthrough":
            return new BreakthroughGame(...args);
        case "fabrik":
            return new FabrikGame(...args);
        case "manalath":
            return new ManalathGame(...args);
        case "urbino":
            return new UrbinoGame(...args);
        case "fendo":
            return new FendoGame(...args);
        case "archimedes":
            return new ArchimedesGame(...args);
        case "zola":
            return new ZolaGame(...args);
        case "monkey":
            return new MonkeyQueenGame(...args);
        case "dipole":
            return new DipoleGame(...args);
        case "wyke":
            return new AlfredsWykeGame(...args);
        case "realm":
            return new RealmGame(...args);
        case "acity":
            return new ACityGame(...args);
        case "fanorona":
            return new FanoronaGame(...args);
    }
    return;
}
