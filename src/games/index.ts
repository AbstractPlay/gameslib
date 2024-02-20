/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, GameBaseSimultaneous, IAPGameState } from "./_base";
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
import { FocusGame, IFocusState } from "./focus";
import { StringsGame, IStringsState } from "./strings";
import { WitchGame, IWitchState } from "./witch";
import { ComplicaGame, IComplicaState } from "./complica";
import { PigsGame, IPigsState } from "./pigs";
import { GardenGame, IGardenState } from "./garden";
import { OrbGame, IOrbState } from "./orb";
import { MixtourGame, IMixtourState } from "./mixtour";
import { CrosswayGame, ICrosswayState } from "./crossway";
import { TintasGame, ITintasState } from "./tintas";
import { StreetcarGame, IStreetcarState } from "./streetcar";
import { CourtesanGame, ICourtesanState } from "./courtesan";
import { PhutballGame, IPhutballState } from "./phutball";
import { ArmadasGame, IArmadasState } from "./armadas";
import { FlumeGame, IFlumeState } from "./flume";
import { BoomGame, IBoomState } from "./boom";
import { ClearcutGame, IClearcutState } from "./clearcut";
import { AgereGame, IAgereState } from "./agere";
import { BideGame, IBideState } from "./bide";
import { MiradorGame, IMiradorState } from "./mirador";
import { RazzleGame, IRazzleState } from "./razzle";
import { DagEnNachtGame, IDagEnNachtState } from "./dagnacht";
import { HexYGame, IHexYState } from "./hexy";
import { MurusGame, IMurusState } from "./murus";
import { BounceGame, IBounceState } from "./bounce";
import { QuagmireGame, IQuagmireState } from "./quagmire";
import { BaoGame, IBaoState } from "./bao";
import { AlmataflGame, IAlmataflState } from "./almatafl";
import { SlitherGame, ISlitherState } from "./slither";
import { ScaffoldGame, IScaffoldState } from "./scaffold";
import { ByteGame, IByteState } from "./byte";
import { LielowGame, ILielowState } from "./lielow";
import { ToguzGame, IToguzState } from "./toguz";
import { TrikeGame, ITrikeState } from "./trike";
import { FnapGame, IFnapState } from "./fnap";
import { IqishiqiGame, IIqishiqiState } from "./iqishiqi";
import { FurlGame, IFurlState } from "./furl";
import { DiffusionGame, IDiffusionState } from "./diffusion";
import { HavannahGame, IHavannahState } from "./havannah";
import { HexGame, IHexState } from "./hex";
import { TumbleweedGame, ITumbleweedState } from "./tumbleweed";
import { MeridiansGame, IMeridiansState } from "./meridians";
import { ExxitGame, IExxitState } from "./exxit";
import { MattockGame, IMattockState } from "./mattock";
import { CatchupGame, ICatchupState } from "./catchup";
import { BloomsGame, IBloomsState } from "./blooms";
import { MimicGame, IMimicState } from "./mimic";
import { VeletasGame, IVeletasState } from "./veletas";
import { GessGame, IGessState } from "./gess";
import { OnagerGame, IOnagerState } from "./onager";
import { VergeGame, IVergeState } from "./verge";
import { TableroGame, ITableroState } from "./tablero";
import { ClusterfussGame, IClusterfussState } from "./clusterfuss";
import { ConhexGame, IConhexState } from "./conhex";
import { FightopiaGame, IFightopiaState } from "./fightopia";
import { HensGame, IHensState } from "./hens";
import { TBTGame, ITBTState } from "./tbt";
import { QueenslandGame, IQueenslandState } from "./queensland";
import { BinarGame, IBinarState } from "./binar";
import { TaflGame, ITaflState } from "./tafl";
import { FourGame, IFourState } from "./four";
import { ValleyGame, IValleyState } from "./valley";
import { DameoGame, IDameoState } from "./dameo";

export {
    APGamesInformation, GameBase, GameBaseSimultaneous, IAPGameState,
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
    FocusGame, IFocusState,
    StringsGame, IStringsState,
    WitchGame, IWitchState,
    ComplicaGame, IComplicaState,
    PigsGame, IPigsState,
    GardenGame, IGardenState,
    OrbGame, IOrbState,
    MixtourGame, IMixtourState,
    CrosswayGame, ICrosswayState,
    TintasGame, ITintasState,
    StreetcarGame, IStreetcarState,
    CourtesanGame, ICourtesanState,
    PhutballGame, IPhutballState,
    ArmadasGame, IArmadasState,
    FlumeGame, IFlumeState,
    BoomGame, IBoomState,
    ClearcutGame, IClearcutState,
    AgereGame, IAgereState,
    BideGame, IBideState,
    MiradorGame, IMiradorState,
    RazzleGame, IRazzleState,
    DagEnNachtGame, IDagEnNachtState,
    HexYGame, IHexYState,
    MurusGame, IMurusState,
    BounceGame, IBounceState,
    QuagmireGame, IQuagmireState,
    BaoGame, IBaoState,
    AlmataflGame, IAlmataflState,
    SlitherGame, ISlitherState,
    ScaffoldGame, IScaffoldState,
    ByteGame, IByteState,
    LielowGame, ILielowState,
    ToguzGame, IToguzState,
    TrikeGame, ITrikeState,
    FnapGame, IFnapState,
    IqishiqiGame, IIqishiqiState,
    FurlGame, IFurlState,
    DiffusionGame, IDiffusionState,
    HavannahGame, IHavannahState,
    HexGame, IHexState,
    TumbleweedGame, ITumbleweedState,
    MeridiansGame, IMeridiansState,
    ExxitGame, IExxitState,
    MattockGame, IMattockState,
    CatchupGame, ICatchupState,
    BloomsGame, IBloomsState,
    MimicGame, IMimicState,
    VeletasGame, IVeletasState,
    GessGame, IGessState,
    OnagerGame, IOnagerState,
    VergeGame, IVergeState,
    TableroGame, ITableroState,
    ClusterfussGame, IClusterfussState,
    ConhexGame, IConhexState,
    FightopiaGame, IFightopiaState,
    HensGame, IHensState,
    TBTGame, ITBTState,
    QueenslandGame, IQueenslandState,
    BinarGame, IBinarState,
    TaflGame, ITaflState,
    FourGame, IFourState,
    ValleyGame, IValleyState,
    DameoGame, IDameoState,
};

const games = new Map<string, typeof AmazonsGame | typeof BlamGame | typeof CannonGame |
                              typeof MchessGame | typeof HomeworldsGame | typeof EntropyGame |
                              typeof VolcanoGame | typeof MvolcanoGame | typeof ChaseGame |
                              typeof AbandeGame | typeof CephalopodGame | typeof LinesOfActionGame |
                              typeof PikemenGame | typeof OrdoGame | typeof AttangleGame |
                              typeof AccastaGame | typeof EpamGame | typeof TaijiGame |
                              typeof BreakthroughGame | typeof FabrikGame | typeof ManalathGame |
                              typeof UrbinoGame | typeof FendoGame | typeof ArchimedesGame |
                              typeof ZolaGame | typeof MonkeyQueenGame | typeof DipoleGame |
                              typeof AlfredsWykeGame | typeof RealmGame | typeof ACityGame |
                              typeof FanoronaGame | typeof FocusGame | typeof StringsGame |
                              typeof WitchGame | typeof ComplicaGame | typeof PigsGame |
                              typeof GardenGame | typeof OrbGame | typeof MixtourGame |
                              typeof CrosswayGame | typeof TintasGame | typeof StreetcarGame |
                              typeof CourtesanGame | typeof PhutballGame | typeof ArmadasGame |
                              typeof FlumeGame | typeof BoomGame | typeof ClearcutGame |
                              typeof AgereGame | typeof BideGame | typeof MiradorGame |
                              typeof RazzleGame | typeof DagEnNachtGame | typeof HexYGame |
                              typeof MurusGame | typeof BounceGame | typeof QuagmireGame |
                              typeof BaoGame | typeof AlmataflGame | typeof SlitherGame |
                              typeof ScaffoldGame | typeof ByteGame | typeof LielowGame |
                              typeof ToguzGame | typeof TrikeGame | typeof FnapGame |
                              typeof IqishiqiGame | typeof FurlGame | typeof DiffusionGame |
                              typeof HavannahGame | typeof HexGame | typeof TumbleweedGame |
                              typeof MeridiansGame | typeof ExxitGame | typeof MattockGame |
                              typeof CatchupGame | typeof BloomsGame | typeof MimicGame |
                              typeof VeletasGame | typeof GessGame | typeof OnagerGame |
                              typeof VergeGame | typeof TableroGame | typeof ClusterfussGame |
                              typeof ConhexGame | typeof FightopiaGame | typeof HensGame |
                              typeof TBTGame | typeof QueenslandGame | typeof BinarGame |
                              typeof TaflGame | typeof FourGame | typeof ValleyGame |
                              typeof DameoGame
                >();
// Manually add each game to the following array
[
    AmazonsGame, BlamGame, CannonGame, MchessGame, HomeworldsGame, EntropyGame,
    VolcanoGame, MvolcanoGame, ChaseGame, AbandeGame, CephalopodGame, LinesOfActionGame,
    PikemenGame, OrdoGame, AttangleGame, AccastaGame, EpamGame, TaijiGame, BreakthroughGame,
    FabrikGame, ManalathGame, UrbinoGame, FendoGame, ArchimedesGame, ZolaGame, MonkeyQueenGame,
    DipoleGame, AlfredsWykeGame, RealmGame, ACityGame, FanoronaGame, FocusGame, StringsGame,
    WitchGame, ComplicaGame, PigsGame, GardenGame, OrbGame, MixtourGame, CrosswayGame, TintasGame,
    StreetcarGame, CourtesanGame, PhutballGame, ArmadasGame, FlumeGame, BoomGame, ClearcutGame,
    AgereGame, BideGame, MiradorGame, RazzleGame, DagEnNachtGame, HexYGame, MurusGame, BounceGame,
    QuagmireGame, BaoGame, AlmataflGame, SlitherGame, ScaffoldGame, ByteGame, LielowGame, ToguzGame,
    TrikeGame, FnapGame, IqishiqiGame, FurlGame, DiffusionGame, HavannahGame, HexGame,
    TumbleweedGame, MeridiansGame, ExxitGame, MattockGame, CatchupGame, BloomsGame, MimicGame,
    VeletasGame, GessGame, OnagerGame, VergeGame, TableroGame, ClusterfussGame, ConhexGame,
    FightopiaGame, HensGame, TBTGame, QueenslandGame, BinarGame, TaflGame, FourGame, ValleyGame,
    DameoGame,
].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g);
});
export { games };

// eslint-disable-next-line @typescript-eslint/naming-convention
export const GameFactory = (game: string, ...args: any[]): GameBase|GameBaseSimultaneous|undefined => {
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
        case "focus":
            return new FocusGame(...args);
        case "strings":
            return new StringsGame(...args);
        case "witch":
            return new WitchGame(...args);
        case "complica":
            return new ComplicaGame(...args);
        case "pigs":
            return new PigsGame(...args);
        case "garden":
            return new GardenGame(...args);
        case "orb":
            return new OrbGame(...args);
        case "mixtour":
            return new MixtourGame(...args);
        case "crossway":
            return new CrosswayGame(...args);
        case "tintas":
            return new TintasGame(...args);
        case "streetcar":
            return new StreetcarGame(...args);
        case "courtesan":
            return new CourtesanGame(...args);
        case "phutball":
            return new PhutballGame(...args);
        case "armadas":
            return new ArmadasGame(args[0], args[1]);
        case "flume":
            return new FlumeGame(...args);
        case "boom":
            return new BoomGame(...args);
        case "clearcut":
            return new ClearcutGame(...args);
        case "agere":
            return new AgereGame(...args);
        case "bide":
            return new BideGame(args[0]);
        case "mirador":
            return new MiradorGame(...args);
        case "razzle":
            return new RazzleGame(...args);
        case "dagnacht":
            return new DagEnNachtGame(...args);
        case "hexy":
            return new HexYGame(...args);
        case "murus":
            return new MurusGame(...args);
        case "bounce":
            return new BounceGame(...args);
        case "quagmire":
            return new QuagmireGame(...args);
        case "bao":
            return new BaoGame(...args);
        case "almatafl":
            return new AlmataflGame(...args);
        case "slither":
            return new SlitherGame(...args);
        case "scaffold":
            return new ScaffoldGame(...args);
        case "byte":
            return new ByteGame(...args);
        case "lielow":
            return new LielowGame(...args);
        case "toguz":
            return new ToguzGame(...args);
        case "trike":
            return new TrikeGame(...args);
        case "fnap":
            return new FnapGame(...args);
        case "iqishiqi":
            return new IqishiqiGame(args[0], ...args);
        case "furl":
            return new FurlGame(...args);
        case "diffusion":
            return new DiffusionGame(...args);
        case "havannah":
            return new HavannahGame(...args);
        case "hex":
            return new HexGame(...args);
        case "tumbleweed":
            return new TumbleweedGame(...args);
        case "meridians":
            return new MeridiansGame(...args);
        case "exxit":
            return new ExxitGame(...args);
        case "mattock":
            return new MattockGame(...args);
        case "catchup":
            return new CatchupGame(...args);
        case "blooms":
            return new BloomsGame(...args);
        case "mimic":
            return new MimicGame(...args);
        case "veletas":
            return new VeletasGame(...args);
        case "gess":
            return new GessGame(...args);
        case "onager":
            return new OnagerGame(...args);
        case "verge":
            return new VergeGame(...args);
        case "tablero":
            return new TableroGame(...args);
        case "clusterfuss":
            return new ClusterfussGame(...args);
        case "conhex":
            return new ConhexGame(...args);
        case "fightopia":
            return new FightopiaGame(...args);
        case "hens":
            return new HensGame(...args);
        case "tbt":
            return new TBTGame(...args);
        case "queensland":
            return new QueenslandGame(...args);
        case "binar":
            return new BinarGame(...args);
        case "tafl":
            return new TaflGame(...args);
        case "four":
            return new FourGame(...args);
        case "valley":
            return new ValleyGame(...args);
        case "dameo":
            return new DameoGame(...args);
    }
    return;
}
