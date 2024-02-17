import { Ruleset } from "./ruleset";

// 1 is attacker, 2 is defender
type playerid = 1 | 2;

export class TaflSettings {
    public ruleset: Ruleset;
    public boardSize;
    public boardSetup;
    public firstPlayer;
    public setupStrings;

    constructor(variant: string) {
        const [ruleset, boardSize, boardSetup, firstPlayer] = variant.split("-");
        switch (ruleset) {
            case "historical":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Historical",
                    uid: "historical",
                    urls: [
                        "http://aagenielsen.dk/historical_hnefatafl_rules.php",
                    ],
                });
                break;
            case "linnaean":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Linnaean",
                    uid: "linnaean",
                    throne: { emptyRestrictedTo: "all", linnaeanCapture: true },
                });
                break;
            case "simple":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Simple",
                    uid: "simple",
                    urls: [
                        "http://aagenielsen.dk/simple_hnefatafl_rules.php",
                    ],
                    pieces: { king: { strength: "weak" } },
                    throne: { type: "no-throne" },
                });
                break;
            case "fetlar":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Fetlar",
                    uid: "fetlar",
                    urls: [
                        "http://aagenielsen.dk/fetlar_rules_en.php",
                    ],
                    escapeType: "corner",
                    pieces: { king: { strength: "strong" } },
                });
                break;
            case "copenhagen":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Copenhagen",
                    uid: "copenhagen",
                    urls: [
                        "http://aagenielsen.dk/copenhagen_rules.php",
                    ],
                    escapeType: "corner",
                    pieces: { king: { strength: "strong" } },
                    corner: { type: "corner" },
                    hasShieldWalls: true,
                    hasExitForts: true,
                });
                break;
            case "old":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Old",
                    uid: "old",
                    escapeType: "corner",
                    pieces: { king: { strength: "strong" } },
                    corner: { type: "corner" },
                    edge: { anvilTo: "king-only" },
                });
                break;
            case "seabattle":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Sea Battle",
                    uid: "seabattle",
                    urls: [
                        "http://aagenielsen.dk/seabattle_rules.php",
                    ],
                    pieces: { king: { strength: "strong", power: "unarmed" } },
                    throne: { type: "no-throne" },
                });
                break;
            case "berserk":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Berserk",
                    uid: "berserk",
                    urls: [
                        "http://aagenielsen.dk/berserk_rules.php",
                    ],
                    escapeType: "corner",
                    pieces: { king: { strength: "strong", jump: "jump-enemy-taflmen-to-from-restricted", berserkEscape: true } },
                    throne: { emptyAnvilTo: "all-piercing"},
                    corner: { type: "corner", anvilTo: "men-only-piercing" },
                    berserkCapture: true,
                    enclosureWin: false,
                });
                break;
            case "tyr":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Tyr",
                    uid: "tyr",
                    urls: [
                        "http://aagenielsen.dk/tyr_rules.pdf",
                    ],
                    escapeType: "edge",
                    pieces: { king: { strength: "weak", berserkEscape: true }, knight: { jump: "jump-taflmen" } },
                    throne: { type: "no-throne" },
                    berserkCapture: true,
                    enclosureWin: false,
                });
                break;
            case "magpie":
                this.ruleset = TaflSettings.createRuleset({
                    name: "Magpie",
                    uid: "magpie",
                    urls: [
                        "http://tafl.cyningstan.com/download/968/magpie-leaflet",
                    ],
                    escapeType: "corner",
                    pieces: { king: { strength: "strong", movement: "rook-1" } },
                    corner: { type: "corner" },
                    edge: { anvilTo: "king-only" },
                });
                break;
            default:
                throw new Error(`The ruleset ${ruleset} is not supported.`);
        }
        this.boardSize = parseInt(boardSize, 10);
        this.boardSetup = boardSetup;
        this.firstPlayer = firstPlayer === "w" ? 2 : 1 as playerid;
        this.setupStrings = this.getSetupStrings();
    }

    private getSetupStrings(): string[] {
        switch (this.boardSize) {
            case 7:
                switch (this.boardSetup) {
                    case "cross":
                        return [
                            "___t___",
                            "___t___",
                            "___T___",
                            "ttTKTtt",
                            "___T___",
                            "___t___",
                            "___t___",
                        ];
            }
            case 9:
                switch (this.boardSetup) {
                    case "tcross":
                        return [
                            "___ttt___",
                            "____t____",
                            "____T____",
                            "t___T___t",
                            "ttTTKTTtt",
                            "t___T___t",
                            "____T____",
                            "____t____",
                            "___ttt___",
                        ];
                    case "starsquare":
                        return [
                            "____t____",
                            "_t__t__t_",
                            "__t___t__",
                            "___TTT___",
                            "tt_TKT_tt",
                            "___TTT___",
                            "__t___t__",
                            "_t__t__t_",
                            "____t____",
                        ];
            }
            case 11:
                switch (this.boardSetup) {
                    case "tdiamond":
                        return [
                            "___ttttt___",
                            "_____t_____",
                            "___________",
                            "t____T____t",
                            "t___TTT___t",
                            "tt_TTKTT_tt",
                            "t___TTT___t",
                            "t____T____t",
                            "___________",
                            "_____t_____",
                            "___ttttt___",
                        ];
                    case "belldiamond":
                        return [
                            "____ttt____",
                            "____t_t____",
                            "_____t_____",
                            "_____T_____",
                            "tt__TTT__tt",
                            "t_tTTKTTt_t",
                            "tt__TTT__tt",
                            "_____T_____",
                            "_____t_____",
                            "____t_t____",
                            "____ttt____",
                        ];
                    case "tcross":
                        return [
                            "___ttttt___",
                            "_____t_____",
                            "_____T_____",
                            "t____T____t",
                            "t____T____t",
                            "ttTTTKTTTtt",
                            "t____T____t",
                            "t____T____t",
                            "_____T_____",
                            "_____t_____",
                            "___ttttt___",
                        ];
                    case "lewiscross":
                        return [
                            "____ttt____",
                            "____ttt____",
                            "_____T_____",
                            "_____T_____",
                            "tt___T___tt",
                            "ttTTTKTTTtt",
                            "tt___T___tt",
                            "_____T_____",
                            "_____T_____",
                            "____ttt____",
                            "____ttt____",
                        ];
                    case "tdiamondberserk":
                        return [
                            "___ttttt___",
                            "_____c_____",
                            "___________",
                            "t____T____t",
                            "t___NTT___t",
                            "tc_TTKTT_ct",
                            "t___TTT___t",
                            "t____T____t",
                            "___________",
                            "_____c_____",
                            "___ttttt___",
                        ];
                    case "tyr":
                        return [
                            "t__t___t__t",
                            "___________",
                            "__t__t__t__",
                            "t__t_T_t__t",
                            "____TTT____",
                            "__tTTKTTt__",
                            "____TTT____",
                            "t__t_T_t__t",
                            "__t__t__t__",
                            "___________",
                            "t__t___t__t",
                        ];
                }
            case 15:
                switch (this.boardSetup) {
                    case "tyr":
                        return [
                            "t__t___t___t__t",
                            "_______________",
                            "__t__t___t__t__",
                            "t__t__t_t__t__t",
                            "____T__T__T____",
                            "__t___T_T___t__",
                            "___t_T_T_T_t___",
                            "t___T_TKT_T___t",
                            "___t_T_T_T_t___",
                            "__t___T_T___t__",
                            "____T__T__T____",
                            "t__t__t_t__t__t",
                            "__t__t___t__t__",
                            "_______________",
                            "t__t___t___t__t",
                        ];
                }
        }
        throw new Error(`The board setup ${this.boardSetup} is not supported.`);
    }

    private static createRuleset(ruleset: Ruleset): Ruleset {
        // If anything is not defined, set it to the default value.
        // It is defined here because `Ruleset` is a generated interface.
        // The default values should match "historical".
        // Otherwise "fetlar" for properties that are turned off for "historical".
        // Corner and throne are hostile, and edge is not by default.
        ruleset.escapeType ??= "edge";
        ruleset.pieces ??= {};
        ruleset.pieces.king ??= {};
        ruleset.pieces.king.strength ??= "strong-near-throne";
        ruleset.pieces.king.power ??= "armed";
        ruleset.pieces.king.jump ??= "no-jump";
        ruleset.pieces.king.movement ??= "rook";
        ruleset.pieces.king.berserkEscape ??= false;
        ruleset.pieces.taflman ??= {};
        ruleset.pieces.taflman.strength ??= "weak";
        ruleset.pieces.taflman.power ??= "armed";
        ruleset.pieces.taflman.jump ??= "no-jump";
        ruleset.pieces.taflman.movement ??= "rook";
        ruleset.pieces.knight ??= {};
        ruleset.pieces.knight.strength ??= "weak";
        ruleset.pieces.knight.power ??= "armed";
        ruleset.pieces.knight.jump ??= "jump-capture-enemy-taflmen";
        ruleset.pieces.knight.movement ??= "rook";
        ruleset.pieces.commander ??= {};
        ruleset.pieces.commander.strength ??= "weak";
        ruleset.pieces.commander.power ??= "piercing";
        ruleset.pieces.commander.jump ??= "jump-enemy-taflmen";
        ruleset.pieces.commander.movement ??= "rook";
        ruleset.throne ??= {};
        ruleset.throne.type ??= "centre";
        ruleset.throne.emptyRestrictedTo ??= "king-only";
        ruleset.throne.emptyAnvilTo ??= "all";
        ruleset.throne.emptyPassableBy ??= "all";
        ruleset.throne.linnaeanCapture ??= false;
        ruleset.corner ??= {};
        ruleset.corner.type ??= "no-corner";
        ruleset.corner.restrictedTo ??= "king-only";
        ruleset.corner.anvilTo ??= "all";
        ruleset.edge ??= {};
        ruleset.edge.anvilTo ??= "none";
        ruleset.hasShieldWalls ??= false;
        ruleset.hasExitForts ??= false;
        ruleset.berserkCapture ??= false;
        ruleset.enclosureWin ??= true;
        return ruleset;
    }
}
