
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
import { TaflGame, ITaflState } from "./tafl";
import { FourGame, IFourState } from "./four";
import { ValleyGame, IValleyState } from "./valley";
import { DameoGame, IDameoState } from "./dameo";
import { TakeGame, ITakeState } from "./take";
import { SympleGame, ISympleState } from "./symple";
import { RootBoundGame, IRootBoundState } from "./rootbound";
import { TwixtGame, ITwixtState } from "./twixt";
import { ReversiGame, IReversiState } from "./reversi";
import { BlockadeGame, IBlockadeState } from "./blockade";
import { CairoCorridorGame, ICairoCorridorState } from "./ccorridor";
import { SaltireGame, ISaltireState } from "./saltire";
import { ConnecticutGame, IConnecticutState } from "./connecticut";
import { QuaxGame, IQuaxState } from "./quax";
import { AtollGame, IAtollState } from "./atoll";
import { HalfcutGame, IHalfcutState } from "./clearcut";
import { NexGame, INexState } from "./nex";
import { PenteGame, IPenteState } from "./pente";
import { Connect6Game, IConnect6State } from "./connect6";
import { GomokuGame, IGomokuState } from "./gomoku";
import { RenjuGame, IRenjuState } from "./renju";
import { FourInARowGame, IFourInARowState } from "./fourinarow";
import { IrenseiGame, IIrenseiState } from "./irensei";
import { PrudhGame, IPrudhState } from "./prudh";
import { SponnectGame, ISponnectState } from "./sponnect";
import { AkronGame, IAkronState } from "./akron";
import { MargoGame, IMargoState } from "./margo";
import { NecklaceGame, INecklaceState } from "./necklace";
import { UpperHandGame, IUpperHandState } from "./upperhand";
import { OustGame, IOustState } from "./oust";
import { SusanGame, ISusanState } from "./susan";
import { OwareGame, IOwareState } from "./oware";
import { SpookGame, ISpookState } from "./spook";
import { AyuGame, IAyuState } from "./ayu";
import { CalculusGame, ICalculusState } from "./calculus";
import { StigmergyGame, IStigmergyState } from "./stigmergy";
import { PletoreGame, IPletoreState } from "./pletore";
import { AnacheGame, IAnacheState } from "./anache";
import { SplineGame, ISplineState } from "./spline";
import { SploofGame, ISploofState } from "./sploof";
import { SpireGame, ISpireState } from "./spire";
import { SpreeGame, ISpreeState } from "./spree";
import { AsliGame, IAsliState } from "./asli";
import { ConectGame, IConectState } from "./conect";
import { SlydeGame, ISlydeState } from "./slyde";
import { UnlurGame, IUnlurState } from "./unlur";
import { EntrapmentGame, IEntrapmentState } from "./entrapment";
import { HexentaflGame, IHexentaflState } from "./hexentafl";
import { VoloGame, IVoloState } from "./volo";
import { StrandsGame, IStrandsState } from "./strands";
import { GonnectGame, IGonnectState } from "./gonnect";
import { BugGame, IBugState } from "./bug";
import { DragonEyesGame, IDragonEyesState } from "./dragoneyes";
import { AtaxxGame, IAtaxxState } from "./ataxx";
import { MajoritiesGame, IMajoritiesState } from "./majorities";
import { BukuGame, IBukuState } from "./buku";
import { TritiumGame, ITritiumState } from "./tritium";
import { CamelotGame, ICamelotState } from "./camelot";
import { LifelineGame, ILifelineState } from "./lifeline";
import { ShiftyGame, IShiftyState } from "./shifty";
import { PodsGame, IPodsState } from "./pods";
import { LoxGame, ILoxState } from "./lox";
import { QueryGame, IQueryState } from "./query";
import { ControlGame, IControlState } from "./control";
import { BoxesGame, IBoxesState } from "./boxes";
import { ConnectionsGame, IConnectionsState } from "./connections";
import { ResolveGame, IResolveState } from "./resolve";
import { OnyxGame, IOnyxState } from "./onyx";
import { AltaGame, IAltaState } from "./alta";
import { HulaGame, IHulaState } from "./hula";
import { StibroGame, IStibroState } from "./stibro";
import { KonaneGame, IKonaneState } from "./konane";
import { BlastRadiusGame, IBlastRadiusState } from "./blastradius";
import { FramesGame, IFramesState } from "./frames";
import { LoggerGame, ILoggerState } from "./logger";
import { SubdivisionGame, ISubdivisionState } from "./subdivision";
import { PylonGame, IPylonState } from "./pylon";
import { MoonSquadGame, IMoonSquadState } from "./moonsquad";
import { JacynthGame, IJacynthState } from "./jacynth";
import { Pigs2Game, IPigs2State } from "./pigs2";
import { TerraceGame, ITerraceState } from "./terrace";
import { CubeoGame, ICubeoState } from "./cubeo";
import { StorisendeGame, IStorisendeState } from "./storisende";
import { TraxGame, ITraxState } from "./trax";
import { AmoebaGame, IAmoebaState } from "./amoeba";
import { YavalathGame, IYavalathState } from "./yavalath";
import { ConspirateursGame, IConspirateursState } from "./conspirateurs";
import { CatapultGame, ICatapultState } from "./catapult";
import { BasaltGame, IBasaltState } from "./basalt";
import { ChurnGame, IChurnState } from "./churn";
import { PenguinGame, IPenguinState } from "./penguin";
import { OwlmanGame, IOwlmanState } from "./owlman";
import { SquaredanceGame, ISquaredanceState } from "./squaredance";
import { MegGame, IMegState } from "./meg";
import { YonmoqueGame, IYonmoqueState } from "./yonmoque";
import { ChameleonGame, IChameleonState } from "./chameleon";
import { KachitGame, IKachitState } from "./kachit";
import { GyveGame, IGyveState } from "./gyve";
import { PahTumGame, IPahTumState } from "./pahtum";
import { NakattaGame, INakattaState } from "./nakatta";
import { OmnyGame, IOmnyState } from "./omny";
import { PacruGame, IPacruState } from "./pacru";
import { AzacruGame, IAzacruState } from "./azacru";
import { CifraGame, ICifraState } from "./cifra";
import { GygesGame, IGygesState } from "./gyges";
import { PonteDDGame, IPonteDDState } from "./pontedd";
import { SurmountGame, ISurmountState } from "./surmount";
import { GlissGame, IGlissState } from "./gliss";
import { MorphosGame, IMorphosState } from "./morphos";
import { AssemblyGame, IAssemblyState } from "./assembly";
import { PaintbucketGame, IPaintbucketState } from "./paintbucket";
import { C1Game, IC1State } from "./c1";
import { BloqueoGame, IBloqueoState } from "./bloqueo";
import { StormCGame, IStormCState } from "./stormc";
import { PilastriGame, IPilastriState } from "./pilastri";
import { TessellaGame, ITessellaState } from "./tessella";
import { GorogoGame, IGorogoState } from "./gorogo";
import { BiscuitGame, IBiscuitState } from "./biscuit";
import { QuincunxGame, IQuincunxState } from "./quincunx";
import { SiegeOfJGame, ISiegeOfJState } from "./siegeofj";
import { StairsGame, IStairsState } from "./stairs";
import { EmuGame, IEmuState } from "./emu";
import { DeckfishGame, IDeckfishState } from "./deckfish";

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
    TaflGame, ITaflState,
    FourGame, IFourState,
    ValleyGame, IValleyState,
    DameoGame, IDameoState,
    TakeGame, ITakeState,
    SympleGame, ISympleState,
    RootBoundGame, IRootBoundState,
    TwixtGame, ITwixtState,
    ReversiGame, IReversiState,
    BlockadeGame, IBlockadeState,
    CairoCorridorGame, ICairoCorridorState,
    SaltireGame, ISaltireState,
    ConnecticutGame, IConnecticutState,
    QuaxGame, IQuaxState,
    AtollGame, IAtollState,
    HalfcutGame, IHalfcutState,
    NexGame, INexState,
    PenteGame, IPenteState,
    Connect6Game, IConnect6State,
    GomokuGame, IGomokuState,
    RenjuGame, IRenjuState,
    FourInARowGame, IFourInARowState,
    IrenseiGame, IIrenseiState,
    PrudhGame, IPrudhState,
    SponnectGame, ISponnectState,
    AkronGame, IAkronState,
    MargoGame, IMargoState,
    NecklaceGame, INecklaceState,
    UpperHandGame, IUpperHandState,
    OustGame, IOustState,
    SusanGame, ISusanState,
    OwareGame, IOwareState,
    SpookGame, ISpookState,
    AyuGame, IAyuState,
    CalculusGame, ICalculusState,
    StigmergyGame, IStigmergyState,
    PletoreGame, IPletoreState,
    AnacheGame, IAnacheState,
    SplineGame, ISplineState,
    SploofGame, ISploofState,
    SpireGame, ISpireState,
    SpreeGame, ISpreeState,
    AsliGame, IAsliState,
    ConectGame, IConectState,
    SlydeGame, ISlydeState,
    UnlurGame, IUnlurState,
    EntrapmentGame, IEntrapmentState,
    HexentaflGame, IHexentaflState,
    VoloGame, IVoloState,
    StrandsGame, IStrandsState,
    GonnectGame, IGonnectState,
    BugGame, IBugState,
    DragonEyesGame, IDragonEyesState,
    AtaxxGame, IAtaxxState,
    MajoritiesGame, IMajoritiesState,
    BukuGame, IBukuState,
    TritiumGame, ITritiumState,
    CamelotGame, ICamelotState,
    LifelineGame, ILifelineState,
    ShiftyGame, IShiftyState,
    PodsGame, IPodsState,
    LoxGame, ILoxState,
    QueryGame, IQueryState,
    ControlGame, IControlState,
    BoxesGame, IBoxesState,
    ConnectionsGame, IConnectionsState,
    ResolveGame, IResolveState,
    OnyxGame, IOnyxState,
    AltaGame, IAltaState,
    HulaGame, IHulaState,
    StibroGame, IStibroState,
    KonaneGame, IKonaneState,
    BlastRadiusGame, IBlastRadiusState,
    FramesGame, IFramesState,
    LoggerGame, ILoggerState,
    SubdivisionGame, ISubdivisionState,
    PylonGame, IPylonState,
    MoonSquadGame, IMoonSquadState,
    JacynthGame, IJacynthState,
    Pigs2Game, IPigs2State,
    TerraceGame, ITerraceState,
    CubeoGame, ICubeoState,
    StorisendeGame, IStorisendeState,
    TraxGame, ITraxState,
    AmoebaGame, IAmoebaState,
    YavalathGame, IYavalathState,
    ConspirateursGame, IConspirateursState,
    CatapultGame, ICatapultState,
    BasaltGame, IBasaltState,
    ChurnGame, IChurnState,
    PenguinGame, IPenguinState,
    OwlmanGame, IOwlmanState,
    SquaredanceGame, ISquaredanceState,
    MegGame, IMegState,
    YonmoqueGame, IYonmoqueState,
    ChameleonGame, IChameleonState,
    KachitGame, IKachitState,
    GyveGame, IGyveState,
    PahTumGame, IPahTumState,
    NakattaGame, INakattaState,
    OmnyGame, IOmnyState,
    PacruGame, IPacruState,
    AzacruGame, IAzacruState,
    CifraGame, ICifraState,
    GygesGame, IGygesState,
    PonteDDGame, IPonteDDState,
    SurmountGame, ISurmountState,
    GlissGame, IGlissState,
    MorphosGame, IMorphosState,
    AssemblyGame, IAssemblyState,
    PaintbucketGame, IPaintbucketState,
    C1Game, IC1State,
    BloqueoGame, IBloqueoState,
    StormCGame, IStormCState,
    PilastriGame, IPilastriState,
    TessellaGame, ITessellaState,
    GorogoGame, IGorogoState,
    BiscuitGame, IBiscuitState,
    QuincunxGame, IQuincunxState,
    SiegeOfJGame, ISiegeOfJState,
    StairsGame, IStairsState,
    EmuGame, IEmuState,
    DeckfishGame, IDeckfishState,
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
                              typeof FlumeGame | typeof BoomGame |
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
                              typeof TBTGame | typeof QueenslandGame |
                              typeof TaflGame | typeof FourGame | typeof ValleyGame |
                              typeof DameoGame | typeof TakeGame | typeof SympleGame |
                              typeof RootBoundGame | typeof TwixtGame | typeof ReversiGame |
                              typeof BlockadeGame | typeof CairoCorridorGame | typeof SaltireGame |
                              typeof ConnecticutGame | typeof QuaxGame | typeof AtollGame |
                              typeof HalfcutGame | typeof NexGame | typeof PenteGame |
                              typeof Connect6Game | typeof GomokuGame | typeof RenjuGame |
                              typeof FourInARowGame | typeof IrenseiGame | typeof PrudhGame |
                              typeof SponnectGame | typeof AkronGame | typeof MargoGame |
                              typeof NecklaceGame | typeof UpperHandGame | typeof OustGame |
                              typeof SusanGame | typeof OwareGame | typeof SpookGame |
                              typeof AyuGame | typeof CalculusGame | typeof StigmergyGame |
                              typeof PletoreGame | typeof AnacheGame | typeof SplineGame |
                              typeof SploofGame | typeof SpireGame | typeof SpreeGame |
                              typeof AsliGame | typeof ConectGame | typeof SlydeGame |
                              typeof UnlurGame | typeof EntrapmentGame | typeof HexentaflGame |
                              typeof VoloGame | typeof StrandsGame | typeof GonnectGame |
                              typeof BugGame | typeof DragonEyesGame | typeof AtaxxGame |
                              typeof MajoritiesGame | typeof BukuGame | typeof TritiumGame |
                              typeof CamelotGame | typeof LifelineGame | typeof ShiftyGame |
                              typeof PodsGame | typeof LoxGame | typeof QueryGame |
                              typeof ControlGame | typeof BoxesGame | typeof ConnectionsGame |
                              typeof ResolveGame | typeof OnyxGame | typeof AltaGame |
                              typeof HulaGame | typeof KonaneGame | typeof BlastRadiusGame |
                              typeof FramesGame | typeof LoggerGame | typeof SubdivisionGame |
                              typeof PylonGame | typeof MoonSquadGame | typeof JacynthGame |
                              typeof Pigs2Game | typeof TerraceGame | typeof CubeoGame |
                              typeof StorisendeGame | typeof TraxGame | typeof AmoebaGame |
                              typeof YavalathGame | typeof ConspirateursGame | typeof CatapultGame |
                              typeof BasaltGame | typeof ChurnGame | typeof PenguinGame |
                              typeof OwlmanGame | typeof SquaredanceGame | typeof MegGame |
                              typeof YonmoqueGame | typeof ChameleonGame | typeof KachitGame |
                              typeof GyveGame | typeof PahTumGame | typeof NakattaGame |
                              typeof OmnyGame | typeof PacruGame | typeof AzacruGame |
                              typeof CifraGame | typeof GygesGame | typeof PonteDDGame |
                              typeof SurmountGame | typeof GlissGame | typeof MorphosGame |
                              typeof AssemblyGame | typeof PaintbucketGame | typeof C1Game |
                              typeof BloqueoGame | typeof StormCGame | typeof PilastriGame |
                              typeof TessellaGame | typeof GorogoGame | typeof StibroGame |
                              typeof BiscuitGame | typeof QuincunxGame | typeof SiegeOfJGame |
                              typeof StairsGame | typeof EmuGame | typeof DeckfishGame
                >();
// Manually add each game to the following array
[
    AmazonsGame, BlamGame, CannonGame, MchessGame, HomeworldsGame, EntropyGame,
    VolcanoGame, MvolcanoGame, ChaseGame, AbandeGame, CephalopodGame, LinesOfActionGame,
    PikemenGame, OrdoGame, AttangleGame, AccastaGame, EpamGame, TaijiGame, BreakthroughGame,
    FabrikGame, ManalathGame, UrbinoGame, FendoGame, ArchimedesGame, ZolaGame, MonkeyQueenGame,
    DipoleGame, AlfredsWykeGame, RealmGame, ACityGame, FanoronaGame, FocusGame, StringsGame,
    WitchGame, ComplicaGame, PigsGame, GardenGame, OrbGame, MixtourGame, CrosswayGame, TintasGame,
    StreetcarGame, CourtesanGame, PhutballGame, ArmadasGame, FlumeGame, BoomGame,
    AgereGame, BideGame, MiradorGame, RazzleGame, DagEnNachtGame, HexYGame, MurusGame, BounceGame,
    QuagmireGame, BaoGame, AlmataflGame, SlitherGame, ScaffoldGame, ByteGame, LielowGame, ToguzGame,
    TrikeGame, FnapGame, IqishiqiGame, FurlGame, DiffusionGame, HavannahGame, HexGame,
    TumbleweedGame, MeridiansGame, ExxitGame, MattockGame, CatchupGame, BloomsGame,
    MimicGame, VeletasGame, GessGame, OnagerGame, VergeGame, TableroGame, ClusterfussGame,
    ConhexGame, FightopiaGame, HensGame, TBTGame, QueenslandGame, TaflGame, FourGame, ValleyGame,
    DameoGame, TakeGame, SympleGame, RootBoundGame, TwixtGame, ReversiGame, BlockadeGame,
    CairoCorridorGame, SaltireGame, ConnecticutGame, QuaxGame, AtollGame, HalfcutGame, NexGame,
    PenteGame, Connect6Game, GomokuGame, RenjuGame, FourInARowGame, IrenseiGame, PrudhGame,
    SponnectGame, AkronGame, MargoGame, NecklaceGame, UpperHandGame, OustGame, SusanGame, OwareGame,
    SpookGame, AyuGame, CalculusGame, StigmergyGame, PletoreGame, AnacheGame, SplineGame,
    SploofGame, SpireGame, SpreeGame, AsliGame, ConectGame, SlydeGame, UnlurGame, EntrapmentGame,
    HexentaflGame, VoloGame, StrandsGame, GonnectGame, BugGame, DragonEyesGame, AtaxxGame,
    MajoritiesGame, BukuGame, TritiumGame, CamelotGame, LifelineGame, ShiftyGame, PodsGame, LoxGame,
    QueryGame, ControlGame, BoxesGame, ConnectionsGame, ResolveGame, OnyxGame, AltaGame,
    HulaGame, StibroGame, KonaneGame, BlastRadiusGame, FramesGame, LoggerGame, SubdivisionGame,
    PylonGame, MoonSquadGame, JacynthGame, Pigs2Game, TerraceGame, CubeoGame, StorisendeGame,
    TraxGame, AmoebaGame, YavalathGame, ConspirateursGame, CatapultGame, BasaltGame, ChurnGame,
    PenguinGame, OwlmanGame, SquaredanceGame, MegGame, YonmoqueGame, ChameleonGame, KachitGame,
    GyveGame, PahTumGame, NakattaGame, OmnyGame, PacruGame, AzacruGame, CifraGame, GygesGame,
    PonteDDGame, SurmountGame, GlissGame, MorphosGame, AssemblyGame, PaintbucketGame, C1Game,
    BloqueoGame, StormCGame, PilastriGame, TessellaGame, GorogoGame, BiscuitGame, QuincunxGame,
    SiegeOfJGame, StairsGame, EmuGame, DeckfishGame,
].forEach((g) => {
    if (games.has(g.gameinfo.uid)) {
        throw new Error("Another game with the UID '" + g.gameinfo.uid + "' has already been used. Duplicates are not allowed.");
    }
    games.set(g.gameinfo.uid, g);
});
export { games };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            return new HalfcutGame(...args);
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
        case "tafl":
            return new TaflGame(...args);
        case "four":
            return new FourGame(...args);
        case "valley":
            return new ValleyGame(...args);
        case "dameo":
            return new DameoGame(...args);
        case "take":
            return new TakeGame(...args);
        case "symple":
            return new SympleGame(...args);
        case "rootbound":
            return new RootBoundGame(...args);
        case "twixt":
            return new TwixtGame(...args);
        case "reversi":
            return new ReversiGame(...args);
        case "blockade":
            return new BlockadeGame(...args);
        case "ccorridor":
            return new CairoCorridorGame(...args);
        case "saltire":
            return new SaltireGame(...args);
        case "connecticut":
            return new ConnecticutGame(...args);
        case "quax":
            return new QuaxGame(...args);
        case "atoll":
            return new AtollGame(...args);
        case "nex":
            return new NexGame(...args);
        case "pente":
            return new PenteGame(...args);
        case "connect6":
            return new Connect6Game(...args);
        case "gomoku":
            return new GomokuGame(...args);
        case "renju":
            return new RenjuGame(...args);
        case "fourinarow":
            return new FourInARowGame(...args);
        case "irensei":
            return new IrenseiGame(...args);
        case "prudh":
            return new PrudhGame(...args);
        case "sponnect":
            return new SponnectGame(...args);
        case "akron":
            return new AkronGame(...args);
        case "margo":
            return new MargoGame(...args);
        case "necklace":
            return new NecklaceGame(...args);
        case "upperhand":
            return new UpperHandGame(...args);
        case "oust":
            return new OustGame(...args);
        case "susan":
            return new SusanGame(...args);
        case "oware":
            return new OwareGame(...args);
        case "spook":
            return new SpookGame(...args);
        case "ayu":
            return new AyuGame(...args);
        case "calculus":
            return new CalculusGame(...args);
        case "stigmergy":
            return new StigmergyGame(...args);
        case "pletore":
            return new PletoreGame(...args);
        case "anache":
            return new AnacheGame(...args);
        case "spline":
            return new SplineGame(...args);
        case "sploof":
            return new SploofGame(...args);
        case "spire":
            return new SpireGame(...args);
        case "spree":
            return new SpreeGame(...args);
        case "asli":
            return new AsliGame(...args);
        case "conect":
            return new ConectGame(...args);
        case "slyde":
            return new SlydeGame(...args);
        case "unlur":
            return new UnlurGame(...args);
        case "entrapment":
            return new EntrapmentGame(...args);
        case "hexentafl":
            return new HexentaflGame(...args);
        case "volo":
            return new VoloGame(...args);
        case "strands":
            return new StrandsGame(...args);
        case "gonnect":
            return new GonnectGame(...args);
        case "bug":
            return new BugGame(...args);
        case "dragoneyes":
            return new DragonEyesGame(...args);
        case "ataxx":
            return new AtaxxGame(...args);
        case "majorities":
            return new MajoritiesGame(...args);
        case "buku":
            return new BukuGame(...args);
        case "tritium":
            return new TritiumGame(...args);
        case "camelot":
            return new CamelotGame(...args);
        case "lifeline":
            return new LifelineGame(...args);
        case "shifty":
            return new ShiftyGame(...args);
        case "pods":
            return new PodsGame(...args);
        case "lox":
            return new LoxGame(...args);
        case "query":
            return new QueryGame(...args);
        case "control":
            return new ControlGame(...args);
        case "boxes":
            return new BoxesGame(...args);
        case "connections":
            return new ConnectionsGame(...args);
        case "resolve":
            return new ResolveGame(...args);
        case "onyx":
            return new OnyxGame(...args);
        case "alta":
            return new AltaGame(...args);
        case "hula":
            return new HulaGame(...args);
        case "stibro":
            return new StibroGame(...args);
        case "konane":
            return new KonaneGame(...args);
        case "blastradius":
            return new BlastRadiusGame(...args);
        case "frames":
            return new FramesGame(...args);
        case "logger":
            return new LoggerGame(args[0]);
        case "subdivision":
            return new SubdivisionGame(args[0], ...args.slice(1));
        case "pylon":
            return new PylonGame(...args);
        case "moonsquad":
            return new MoonSquadGame(...args);
        case "jacynth":
            return new JacynthGame(args[0], ...args.slice(1));
        case "pigs2":
            return new Pigs2Game(...args);
        case "terrace":
            return new TerraceGame(...args);
        case "cubeo":
            return new CubeoGame(...args);
        case "storisende":
            return new StorisendeGame(...args);
        case "trax":
            return new TraxGame(...args);
        case "amoeba":
            return new AmoebaGame(...args);
        case "yavalath":
            return new YavalathGame(args[0]);
        case "conspirateurs":
            return new ConspirateursGame(args[0], ...args.slice(1));
        case "catapult":
            return new CatapultGame(...args);
        case "basalt":
            return new BasaltGame(...args);
        case "churn":
            return new ChurnGame(...args);
        case "penguin":
            return new PenguinGame(...args);
        case "owlman":
            return new OwlmanGame(...args);
        case "squaredance":
            return new SquaredanceGame(...args);
        case "meg":
            return new MegGame(...args);
        case "yonmoque":
            return new YonmoqueGame(...args);
        case "chameleon":
            return new ChameleonGame(...args);
        case "kachit":
            return new KachitGame(...args);
        case "gyve":
            return new GyveGame(...args);
        case "pahtum":
            return new PahTumGame(...args);
        case "nakatta":
            return new NakattaGame(...args);
        case "omny":
            return new OmnyGame(...args);
        case "pacru":
            return new PacruGame(args[0], ...args.slice(1));
        case "azacru":
            return new AzacruGame(args[0], ...args.slice(1));
        case "cifra":
            return new CifraGame(...args);
        case "gyges":
            return new GygesGame(...args);
        case "pontedd":
            return new PonteDDGame(...args);
        case "surmount":
            return new SurmountGame(...args);
        case "gliss":
            return new GlissGame(...args);
        case "morphos":
            return new MorphosGame(...args);
        case "assembly":
            return new AssemblyGame(...args);
        case "paintbucket":
            return new PaintbucketGame(...args);
        case "c1":
            return new C1Game(...args);
        case "bloqueo":
            return new BloqueoGame(...args);
        case "stormc":
            return new StormCGame(...args);
        case "pilastri":
            return new PilastriGame(...args);
        case "tessella":
            return new TessellaGame(...args);
        case "gorogo":
            return new GorogoGame(...args);
        case "biscuit":
            return new BiscuitGame(args[0], ...args.slice(1));
        case "quincunx":
            return new QuincunxGame(args[0], ...args.slice(1));
        case "siegeofj":
            return new SiegeOfJGame(...args);
        case "stairs":
            return new StairsGame(...args);
        case "emu":
            return new EmuGame(...args);
        case "deckfish":
            return new DeckfishGame(...args);
    }
    return;
}
