import {  GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IStatus, IValidationResult, IHandleClickUi, IRenderOpts, type ChatLogCollectContext, type ChatLogLine, type FlagContext, type GameFlag } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AreaPieces, BoardBasic, Colourfuncs, Glyph, PaintEntry } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";
import { isArrow, isLegacy, isLower, isMark, normalize, parseMove, pc2name, pieceChar, tokenText, NotationError, type ParsedMove, type Token } from "./arimaa/notation.js";
import { STRENGTH, display, hasAnyMove, inferred, isAlone, isFrozen, resolve, serializeTurn, sqName, turnFromSteps, type Turn } from "./arimaa/turns.js";
import { castDie, type IDie } from "./arimaa/dice.js";
import { ARIMAA_CAPTURE_CHOICE, ARIMAA_SPARE_CHOICE, captureAlternatives, captureChoices, declared, inputClick, pendingPush, type InputClick } from "./arimaa/input.js";
import { baseMove, classify, validateLegacyMovement, type StepKind } from "./arimaa/legacy.js";
import { endlessEndgame, fillRabbits, placing, setupClick, standardSetup, validateSetup } from "./arimaa/setup.js";
export const gameApgamesEn = {
    inputModes: {
        "#entry": {
            name: "Basic",
            description: "Move only pieces you explicitly select, in the order you enter them. Every completed click sequence has an unambiguous result.",
        },
        advanced: {
            name: "Advanced",
            description: "Select by origin or target, and use inferred movements and trap-capture controls.",
        },
    },
    validation: {
        BACKWARDS: "You may not move your own rabbits backwards.",
        FROZEN: "The piece at {{where}} is frozen. It cannot move on its own.",
        HOME_ROW: "You may only place pieces on the two ranks closest to you.",
        INITIAL_INSTRUCTIONS_place: "Select a piece from your hand to place on the board.",
        INITIAL_INSTRUCTIONS_play: "Select a piece, then its destination. Select additional pieces to move them as a chain. Advanced mode also supports target clicks and inferred moves.",
        INVALID_PUSH: "Pushes must be immediately completed by moving the pushing piece into the space vacated by the pushed enemy piece.",
        INVALID_PUSHPULL: "You may only move enemy pieces when completing a pull or starting a push. Neither seem to apply in this case.",
        LABEL_STASH: "{{player}}'s stash",
        NOPASS: "You may not make a move that does not change the board state (no passing).",
        NOPIECE: "Trying to place a piece you don't have in your hand: {{piece}}.",
        NOT_ADJ: "Pieces may only move one space orthogonally.",
        PARTIAL_one: "You may make {{count}} more move, or click Complete Move to end your turn.",
        PARTIAL_other: "You may make {{count}} more moves, or click Complete Move to end your turn.",
        PARTIAL_MOVE: "Select the destination.",
        PARTIAL_PLACE: "Click an empty cell to place the piece.",
        PARTIAL_PLAY: "Continue placing your pieces.",
        PARTIAL_PUSH: "Complete the push by clicking on the piece doing the pushing.",
        PARTIAL_RABBITS: "The rest of your setup area will be filled with rabbits.",
        PARTIAL_FREE: "You may continue placing pieces, or click Complete Move to end your turn.",
        PARTIAL_FREE_NO: "You may continue placing pieces, but you must place at least one rabbit, and you may not place any rabbits on the goal row.",
        REPEAT: "You may not repeat a given position a third time.",
        TOO_MANY: "You may only take up to {{num}} actions this turn.",
        WARN_BALANCE: "Balance your four strongest pieces east to west.",
        WARN_FILE: "Don't put your elephant in the same file as the opposing elephant.",
        WARN_HIDE: "Don't hide stronger pieces behind weaker pieces (except cats behind rabbits).",
        WARNINGS: "Your setup is complete, but there are some things for new players to consider. You can click Complete Move to ignore, or you can read the following advice:",
        PARSE: "Could not read \"{{token}}\".",
        NO_MOVE: "No legal move matches what you have drawn.",
        NO_MOVE_CHAIN: "One arrow per piece, from where it starts to where it ends: {{first}} and {{second}} together are {{combined}}.",
        NO_MOVE_ENEMY: "The piece on {{from}} is your opponent's, and none of your pieces can push or pull it as drawn within {{num}} steps.",
        NO_MOVE_FROZEN: "The piece on {{from}} is frozen, and nothing can free it in time.",
        NO_MOVE_REACH: "The piece on {{from}} cannot get to {{to}} within {{num}} steps.",
        NO_MOVE_TOGETHER: "Each of those works on its own, but not all of them within {{num}} steps.",
        AMBIGUOUS: "That fits {{count}} different moves, and the one shown is the one that will be played. Say where another piece ends up to choose another.",
        IDLE: "Nothing moves yet. Say where a piece ends up.",
        INFERRED: "Also moving: {{pieces}}.",
        INCOMPLETE: "A piece is selected. Click a square to send it there.",
        TOO_LONG: "What you have drawn needs more than {{num}} steps.",
        DIE_one: "The die allows a single step this turn.",
        DIE_other: "The die allows up to {{count}} steps this turn.",
    },
    variants: {
        "#setup": {
            name: "Standard setup",
            description: "Array your 16 pieces on your closest two ranks in any way you wish",
        },
        eee: {
            name: "Endless endgame",
            description: "Randomly generated setup with reduced army size. Devised by clyring.",
        },
        free: {
            name: "Free placement",
            description: "Lets players place as many pieces as they want wherever they want, including creating illegal or otherwise broken positions. Players should communicate clearly before starting. These games cannot be rated.",
        },
        dicey: {
            name: "Dicey Moves",
            description: "A die determines how many steps you can take each turn.",
        },
    },
    buttons: {
        gold99: "Quick setup",
        silver99e7: "Quick setup, elephant e7",
        silver99d7: "Quick setup, elephant d7",
    },
    status: {
        HARLOG: "Harlog",
        ROLL_MEAN: "Average roll",
        ROLL_TOTAL: "Rolls total",
    },
};
export const gameApresultsEn = {
    ANNOUNCE: {
        default: "This position has occurred before. Further repeats of this position are forbidden.",
    },
    DESTROY: {
        default: "A {{colour}} {{what}} was trapped at {{where}}.",
    },
    ROLL_one: "{{player}}'s die shows 1: a single step this turn.",
    ROLL_other: "{{player}}'s die shows {{count}}: up to {{count}} steps this turn.",
};



export type playerid = 1|2;
export type Piece = "E" | "M" | "H" | "D" | "C" | "R";
export type CellContents = [Piece, playerid];

export { pc2name };
// the order the free setup has always reported its captures in
const traps = ["f3", "f6", "c3", "c6"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    hands?: [Piece[], Piece[]];
    /**
     * Dicey Moves: the die for the turn starting here; absent during setup and
     * in other variants. A move that ends the game clears it, as no turn
     * follows, but a resignation, timeout or agreed draw keeps it, since it
     * may have informed that decision.
     */
    die?: IDie;
};

export interface IArimaaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

/** `inputMode` is the mode a click was made in, as `handleClick` returns it in its result's `opts`. */
interface IArimaaRenderOpts extends IRenderOpts {
    inputMode?: string;
}


export class ArimaaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Arimaa",
        uid: "arimaa",
        playercounts: [2],
        version: "20251223",
        dateAdded: "2026-01-23",
        description: "The pieces are animals of various strengths jockeying for position, trying to get one of their rabbits to the far row. But watch out for traps!",
        notes: "Made available under section 3 of the [Arimaa public license](https://arimaa.com/arimaa/license/).\n\nControl Inputs: Click on an empty square to mark the move complete. Click on an opposing piece to undo the last move token.\n\nBasic Input Mode (default): Click on pieces and where you want to move them in the order they must move as per the rules. This mode is intended to be in line with other AP games in terms of intuitiveness and ease of use. See the AP Wiki for more details.\n\nAdvanced Input Mode: Click on pieces and where you want them to end up at the end of the turn. For sending a piece to a trap square, a filled triangle means to capture the piece if possible, an empty triangle means to avoid capturing the piece if possible, and clicking elsewhere on the trap square tries the other/default, which is almost always what you want. Click on certain empty squares to expedite certain sets of steps (cf, AP Wiki: Target Clicks). The system heavily infers steps necessary to make your input legal. This mode is intended to strive for click-efficiency without being too unintuitive once you're used to it. See the AP Wiki for more details (highly recommended).\n\nMoves are recorded in Lightvector notation, which is modeled after algebraic chess notation, albeit more flexible (and using lowercase letters to denote silver pieces). It's backwards-compatible with the Arimaa Gameroom Notation, and the legacy AP notation is still accepted. See the AP Wiki for more details.\n\nHarlog is a method for estimating material advantage. The color of the icon indicates who it favors. The hard range for standard setup is ±112, but in practice ±20 is a very strong advantage.\n\nIn Dicey Moves, a player whose die allows a single step has no move (and loses), if only pushes and pulls remain.\n\nBecause we can't generate comprehensive lists of moves, the system cannot detect the rare cases where your only available moves are illegal due to position repetition. The system won't let you make those illegal repetitions, and you'll have to resign manually.",
        urls: [
            "https://arimaa.com/arimaa/",
            "https://arimaa.com/arimaa/learn/rulesIntro.html",
            "https://boardgamegeek.com/boardgame/4616/arimaa",
        ],
        bggid: "4616",
        people: [
            {
                type: "designer",
                name: "Aamir Syed",
            },
            {
                type: "designer",
                name: "Omar Syed"
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "eee",
                group: "setup",
                fans: true,
                people: [
                    {
                        type: "designer",
                        name: "clyring",
                    },
                ],
            },
            { uid: "free", group: "setup", unrated: true },
            { uid: "dicey", experimental: false },
        ],
        customizations: [
            {
                num: 1,
                default: "#bf9212",
                explanation: "Colour of player 1 (Gold)",
                player: 1
            },
            {
                num: 2,
                default: "#989898",
                explanation: "Colour of player 2 (Silver)",
                player: 2
            },
            {
                num: 3,
                default: "35% opacity",
                explanation: "Colour of Gold's frozen pieces"
            },
            {
                num: 4,
                default: "35% opacity",
                explanation: "Colour of Silver's frozen pieces"
            },
            {
                num: 5,
                default: "black/white",
                explanation: "Gold piece stroke colour"
            },
            {
                num: 6,
                default: "black/white",
                explanation: "Silver piece stroke colour"
            },
            {
                name: "fill",
                explanation: "Traps are the `fill` colour at 50% opacity"
            },
        ],
        inputModes: [
            {uid: "#entry", group: "entry"},
            {uid: "advanced", group: "entry"},
        ],
        categories: ["goal>breakthrough", "goal>cripple", "goal>immobilize", "mechanic>capture", "mechanic>move", "mechanic>coopt", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>chess"],
        flags: ["perspective", "no-moves", "custom-buttons", "random-start", "custom-colours"]
    };
    public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
        const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
        // a Dicey Moves turn opens with a roll nobody has seen yet, so there
        // is no position beyond the current one to explore
        if (context.variants?.includes("dicey")) {
            flags.push("no-explore");
        }
        return flags;
    }
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }
    public static strength(piece: Piece): number {
        return STRENGTH[piece];
    }
    public static EEE(): {gold: [Piece, string][], silver: [Piece, string][]} {
        return endlessEndgame();
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public hands?: [Piece[], Piece[]];
    // Dicey Moves: the die for the turn in progress
    public die?: IDie;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _selected: string|undefined;
    private _selections: string[]|undefined;
    private _entryMove: string|undefined;
    // the player's arrows, kept for drawing when they do not yet resolve to a move
    private _arrows: Array<[string, string]>|undefined;
    // the squares of the player's capture marks, drawn whether or not the move resolves
    private _marks: string[]|undefined;

    constructor(state?: IArimaaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const board = new Map<string, CellContents>();
            let hands: [Piece[], Piece[]]|undefined;
            if (this.variants.includes("eee")) {
                const {gold, silver} = ArimaaGame.EEE();
                for (const [pc, cell] of gold) {
                    board.set(cell, [pc, 1]);
                }
                for (const [pc, cell] of silver) {
                    board.set(cell, [pc, 2]);
                }
            } else if (this.variants.includes("free")) {
                hands = [["E", "M", "H", "D", "C", "R"], ["E", "M", "H", "D", "C", "R"]]
            } else {
                hands = [
                    ["E", "M", "H", "H", "D", "D", "C", "C", "R", "R", "R", "R", "R", "R", "R", "R"],
                    ["E", "M", "H", "H", "D", "D", "C", "C", "R", "R", "R", "R", "R", "R", "R", "R"]
                ];
            }

            // Dicey Moves: only Endless endgame opens with a move, and that move
            // is half a turn; the other setups cast their first die in move()
            // once the pieces are down
            const die = this.variants.includes("dicey") && this.variants.includes("eee") ? castDie(board, "opening") : undefined;

            const fresh: IMoveState = {
                _version: ArimaaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands,
                die,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IArimaaState;
            }
            if (state.game !== ArimaaGame.gameinfo.uid) {
                throw new Error(`The Arimaa engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ArimaaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = cloneState(state.board);
        this.lastmove = state.lastmove;
        this.hands = cloneState(state.hands);
        this.die = cloneState(state.die);
        this.results = [...state._results];
        // what a turn did is drawn from its results; anything left over from a
        // partial move belongs to the entry being typed, not to this state
        this._selected = undefined;
        this._selections = undefined;
        this._entryMove = undefined;
        this._arrows = undefined;
        this._marks = undefined;
        return this;
    }

    public getButtons(): ICustomButton[] {
        // base game, gold setup
        if (standardSetup(this.variants) && this.stack.length === 1) {
            return [
                {
                    label: "apgames:buttons.arimaa.gold99",
                    move: "Ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2"
                }
            ];
        }
        // base game, silver setup
        else if (standardSetup(this.variants) && this.stack.length === 2) {
            return [
                {
                    label: "apgames:buttons.arimaa.silver99e7",
                    move: "ee7,md7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7"
                },
                {
                    label: "apgames:buttons.arimaa.silver99d7",
                    move: "ed7,me7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7"
                },
            ];
        }
        return [];
    }

    // what each step of a legacy step list is (see arimaa/legacy.ts)
    public static classify(player: playerid, moves: string[]): StepKind[] {
        return classify(player, moves);
    }

    // chains together a random series of moves
    // won't always take the maximum number of legal moves
    // public randomMove(): string {
    //     const moves = this.moves();
    //     return moves[Math.floor(Math.random() * moves.length)];
    // }

    public handleClick(move: string, row: number, col: number, piece?: string, ui?: IHandleClickUi): IClickResult {
        try {
            // placing pieces:
            // - either still pieces in hand
            // - or we're in standard setup and ply 1 or 2, no matter the hands
            const setup = placing(this.hands, this.currplayer) ||
                (standardSetup(this.variants) && this.stack.length <= 2);
            const advanced = this.resolveActiveInputMode(ui?.inputMode) === "advanced";
            // The custom SVG triangle is an ordinary clickable renderer
            // piece. Its reserved keys (one per way it is drawn) distinguish
            // its click from a click on the trap square itself, without
            // affecting actual board pieces.
            const square = row >= 0 && row < 8 && col >= 0 && col < 8 ?
                ArimaaGame.coords2algebraic(col, row) : undefined;
            const isCaptureChoice = piece === ARIMAA_CAPTURE_CHOICE || piece === ARIMAA_SPARE_CHOICE;
            const alternativeCapture = !setup && isCaptureChoice &&
                advanced && square !== undefined &&
                captureAlternatives(this.board, this.currplayer, this.maxSteps(), move).includes(square);
            // render() is not told the input mode and runs on a fresh game
            // object, but clients hand a click's `opts` on to it: that is how
            // the preview of an Advanced entry gets its trap controls.
            const withMode = (r: IClickResult): IClickResult => {
                if (advanced && !setup && r.move.length > 0) {
                    const opts: IArimaaRenderOpts = {inputMode: "advanced"};
                    r.opts = opts;
                }
                return r;
            };
            // a control that is not on offer does nothing, and neither does
            // a click off the board once the pieces are down
            if ((isCaptureChoice && !alternativeCapture) || (!setup && square === undefined)) {
                return withMode({...this.validateMove(move), move});
            }
            const input: InputClick = setup ? setupClick(this, move, row, col, piece) :
                inputClick(this.board, this.currplayer, this.maxSteps(), move, square!,
                    advanced ? "advanced" : "basic", alternativeCapture);
            const newmove = input.move;
            let result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if (result.autocomplete !== undefined) {
                    const automove = result.autocomplete;
                    result = this.validateMove(automove) as IClickResult;
                    result.move = automove;
                } else {
                    result.move = newmove;
                }
                if (input.complete && result.valid && result.complete === 0) {
                    result.complete = 1;
                } else if (input.oneOf !== undefined && result.valid && result.complete === 0) {
                    // the click had more than one equally good way to go
                    result.message = `${result.message} ${i18next.t("apgames:validation.arimaa.AMBIGUOUS", {count: input.oneOf})}`;
                }
            }
            return withMode(result);
        } catch (e) {
            // console.log(e);
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const setup = placing(this.hands, this.currplayer);
        // placement and legacy step lists ignore whitespace; the notation is space-delimited
        if (setup || isLegacy(m)) {
            m = m.replace(/\s+/g, "");
        } else {
            m = normalize(m);
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            // if in the setup phase, we need canrender, otherwise don't
            result.canrender = false;
            if (!this.variants.includes("eee") && this.stack.length <= 2) {
                result.canrender = true;
            }
            result.canrender = true;
            result.message = i18next.t("apgames:validation.arimaa.INITIAL_INSTRUCTIONS", {context: placing(this.hands, this.currplayer) ? "place" : "play"});
            // Dicey Moves: lead with what the die allows
            if (this.die !== undefined) {
                result.message = [i18next.t("apgames:validation.arimaa.DIE", {count: this.die.steps}), result.message].join(" ");
            }
            return result;
        }

        if (setup) {
            return validateSetup(this.board, this.hands![this.currplayer - 1], this.currplayer, this.variants, m);
        }
        if (isLegacy(m)) {
            return validateLegacyMovement(this, m, this.maxSteps());
        }
        return this.validateNotation(m);
    }

    // Steps the mover may take this turn: what the die says in Dicey Moves,
    // two for the opening move of Endless endgame, otherwise four.
    private maxSteps(): number {
        if (this.die !== undefined) {
            return this.die.steps;
        }
        if (this.variants.includes("eee") && this.stack.length === 1) {
            return 2;
        }
        return 4;
    }

    // Steps the player's arrows must take at the very least. A piece ending on
    // a square needs a step for each square between the one it was seen on and
    // that one; pieces ending on distinct squares are distinct, so their steps
    // add up, but arrows onto one square may all describe a single piece that
    // visited every one of their squares (`Ed4g4 Ee4g4` is three steps by one
    // elephant), so a destination costs only its longest arrow. An enemy piece
    // needs two steps per square, but its partner's steps may be an arrowed
    // own piece's own steps (a pusher that follows it), so that price stands
    // alone rather than being added.
    private static arrowBudget(tokens: Token[], player: playerid): number {
        const longest = new Map<string, number>();
        let enemy = 0;
        for (const t of tokens) {
            if (t.prop.kind !== "dest" || t.spec.square === undefined || t.spec.owner === undefined) {
                continue;
            }
            const [fx, fy] = ArimaaGame.algebraic2coords(t.spec.square);
            const [tx, ty] = ArimaaGame.algebraic2coords(t.prop.square);
            const dist = Math.abs(fx - tx) + Math.abs(fy - ty);
            longest.set(t.prop.square, Math.max(longest.get(t.prop.square) ?? 0, dist));
            if (t.spec.owner !== player) {
                enemy = Math.max(enemy, 2 * dist);
            }
        }
        let sum = 0;
        for (const dist of longest.values()) {
            sum += dist;
        }
        return Math.max(sum, enemy);
    }

    private describeTrajectory(tr: Turn["trajectories"][number]): string {
        const pc = pieceChar(tr.type, tr.owner);
        if (tr.captured) {
            return `${pc}${sqName(tr.start)}x`;
        }
        return `${pc}${sqName(tr.start)}${sqName(tr.final)}`;
    }

    // Lightvector notation: find the turn the tokens are shown as and report:
    // invalid for unreadable or unsatisfiable input; -1 while nothing moves
    // yet, a piece is only selected, or the position would repeat; otherwise
    // 0, so that the move stays open to editing until the player completes it.
    private validateNotation(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        let parsed: ParsedMove;
        try {
            parsed = parseMove(m, true);
        } catch (e) {
            result.message = i18next.t("apgames:validation.arimaa.PARSE", {token: e instanceof NotationError ? e.token : m});
            return result;
        }
        const maxMoves = this.maxSteps();
        if (ArimaaGame.arrowBudget(parsed.tokens, this.currplayer) > maxMoves) {
            result.message = i18next.t("apgames:validation.arimaa.TOO_LONG", {num: maxMoves});
            return result;
        }
        // a push entered step by step waits for the piece that pushes
        const awaitsPusher = (shown: Map<string, CellContents>): boolean =>
            pendingPush(shown, this.currplayer, parsed.selections ?? []) !== undefined;
        // only a selected piece so far
        if (parsed.tokens.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t(awaitsPusher(this.board) ? "apgames:validation.arimaa.PARTIAL_PUSH" : "apgames:validation.arimaa.PARTIAL_MOVE");
            return result;
        }
        const d = display(this.board, this.currplayer, maxMoves, parsed.tokens);
        if (d.status === "unsatisfiable") {
            result.message = this.explainUnsatisfiable(parsed.tokens, maxMoves);
            return result;
        }
        result.valid = true;
        result.canrender = true;
        const messages: string[] = [];
        let shown = this.board;
        if (d.status === "idle") {
            // pieces are only held where they stand: there is no move to submit yet
            result.complete = -1;
            messages.push(i18next.t("apgames:validation.arimaa.IDLE"));
        } else {
            // the move is known; repetition is checked only now
            const cloned = this.clone();
            cloned.applyTurn(d.turn);
            shown = cloned.board;
            if (cloned.numRepeats() >= 2) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.arimaa.REPEAT");
                return result;
            }
            result.complete = 0;
            const used = d.turn.steps.length;
            if (used === maxMoves) {
                messages.push(i18next.t("apgames:validation._general.VALID_MOVE"));
            } else {
                messages.push(i18next.t("apgames:validation.arimaa.PARTIAL", {count: maxMoves - used}));
            }
            // an entry that ends with the steps of its turn names every piece in them: what else it says is what was asked for
            const extra = inferred(d.turn, declared(parsed.tokens, d.turn));
            if (extra.length > 0) {
                messages.push(i18next.t("apgames:validation.arimaa.INFERRED", {pieces: extra.map(tr => this.describeTrajectory(tr)).join(", ")}));
            }
            if (d.by === "choice") {
                // what is shown is one of several moves the entry fits, and it is the one a submission plays
                messages.push(i18next.t("apgames:validation.arimaa.AMBIGUOUS", {count: d.positions}));
            }
        }
        if (parsed.pending !== undefined) {
            // a selection is dropped on submission; the hint says what a click does
            messages.push(i18next.t(awaitsPusher(shown) ? "apgames:validation.arimaa.PARTIAL_PUSH" : "apgames:validation.arimaa.INCOMPLETE"));
        }
        result.message = messages.join(" ");
        return result;
    }

    // Why nothing matches what was drawn. Two arrows chained through one
    // square are the old step list typed with spaces; otherwise the first
    // token that cannot be met on its own is named with the reason a player
    // can act on, and when each token can be met alone it is the combination
    // that does not fit. Only ever runs on a rejection.
    private explainUnsatisfiable(tokens: Token[], maxMoves: number): string {
        const dest = (t: Token): string|undefined => t.prop.kind === "dest" ? t.prop.square : undefined;
        for (const a of tokens) {
            const to = dest(a);
            if (to === undefined || a.spec.square === undefined || a.spec.piece === undefined) {
                continue;
            }
            const b = tokens.find(t => t !== a && t.spec.square === to && dest(t) !== undefined && (t.spec.piece === undefined || (t.spec.piece === a.spec.piece && t.spec.owner === a.spec.owner)));
            if (b !== undefined) {
                const pc = pieceChar(a.spec.piece, a.spec.owner!);
                return i18next.t("apgames:validation.arimaa.NO_MOVE_CHAIN", {first: tokenText(a), second: tokenText(b), combined: `${pc}${a.spec.square}${dest(b)}`});
            }
        }
        const culprit = tokens.length === 1 ? tokens[0] : tokens.find(t => resolve(this.board, this.currplayer, maxMoves, [t], true).status === "unsatisfiable");
        if (culprit === undefined) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_TOGETHER", {num: maxMoves});
        }
        const from = culprit.spec.square;
        const occupant = from === undefined ? undefined : this.board.get(from);
        if (from === undefined || occupant === undefined || (culprit.spec.piece !== undefined && (occupant[0] !== culprit.spec.piece || occupant[1] !== culprit.spec.owner))) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE");
        }
        if (occupant[1] !== this.currplayer) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_ENEMY", {from, num: maxMoves});
        }
        const to = dest(culprit);
        if (to !== undefined && to !== from && occupant[0] === "R" && (this.currplayer === 1 ? to[1] < from[1] : to[1] > from[1])) {
            return i18next.t("apgames:validation.arimaa.BACKWARDS");
        }
        if (isFrozen(this.board, from)) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_FROZEN", {from});
        }
        if (to !== undefined && to !== from) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_REACH", {from, to, num: maxMoves});
        }
        return i18next.t("apgames:validation.arimaa.NO_MOVE");
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): ArimaaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        const setup = placing(this.hands, this.currplayer);
        if (setup || isLegacy(m)) {
            m = m.replace(/\s+/g, "");
        } else {
            m = normalize(m);
        }
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }
        // top up a standard setup with the rabbits the player didn't place
        // (a no-op on a setup that's already complete, so replays are unaffected)
        if (!partial) {
            m = fillRabbits(this.board, this.hands, this.currplayer, this.variants, m);
        }

        const initial = this.clone(); // used to triple check that the board state changes
        const lastmove: string[] = [];
        this.results = [];
        // Dicey Moves: the die that governs this turn heads its results, which
        // is how the roll reaches the move log and the game record
        if (this.die !== undefined) {
            this.results.push({type: "roll", values: [this.die.steps]});
        }
        this._selected = undefined;
        this._selections = undefined;
        this._entryMove = undefined;
        this._arrows = undefined;
        this._marks = undefined;
        if (m.length > 0) {
            if (setup) {
                lastmove.push(...this.applySetup(m));
            } else if (isLegacy(m)) {
                const {steps, legacy} = this.applyLegacy(m);
                if (!partial) {
                    // a move only the legacy validator allows keeps the legacy notation
                    lastmove.push(serializeTurn(initial.board, this.currplayer, this.maxSteps(), turnFromSteps(initial.board, this.currplayer, steps)) ?? legacy.join(", "));
                }
            } else {
                const turn = this.applyNotation(m, partial);
                if (turn !== undefined && !partial) {
                    lastmove.push(serializeTurn(initial.board, this.currplayer, this.maxSteps(), turn) ?? turn.steps.map(st => `${pieceChar(st.piece, st.owner)}${sqName(st.from)}${st.dir}`).join(" "));
                }
            }
        }

        if (partial) {
            return this;
        }

        // failsafe checks
        // except for "free" variant, nobody should have pieces in hand at the end of the turn
        if (!this.variants.includes("free")) {
            if (placing(this.hands, this.currplayer)) {
                throw new Error("Players should only have empty hands at the end of the turn.");
            }
        }
        // board position must change
        if (initial.signature() === this.signature()) {
            throw new Error("The board state must change by the end of the turn.");
        }
        // three-time repeats should not make it this far
        if (this.numRepeats() >= 2) {
            throw new Error("Three-time repeats should not make it this far.");
        }
        // but we should let players know if this position is a repeat
        if (this.numRepeats() === 1) {
            this.results.push({type: "announce", payload: ["repeat"]});
        }

        // clear hands when both are empty
        if (
            (this.hands !== undefined && this.hands[0].length === 0 && this.hands[1].length === 0) ||
            (this.variants.includes("free") && this.stack.length === 2)
        ) {
            this.hands = undefined;
        }

        // After free setup, activate all traps
        if (this.variants.includes("free") && this.stack.length === 2) {
            for (const trap of traps) {
                if (this.board.has(trap) && isAlone(this.board, trap)) {
                    const [trapPc, trapOwner] = this.board.get(trap)!;
                    this.board.delete(trap);
                    this.results.push({type: "destroy", what: trapOwner === 1 ? trapPc : trapPc.toLowerCase(), where: trap});
                    lastmove.push(`x${trapOwner === 1 ? trapPc : trapPc.toLowerCase()}${trap}`);
                }
            }
        }

        // update currplayer
        this.lastmove = lastmove.join(", ");
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        // Dicey Moves: cast the die for the turn about to start, once setup is
        // over and no hands are left. It comes before the game-over checks,
        // which need its allowance to tell whether the next player can move
        // at all. If the rules have ended the game, no turn follows, so the
        // die goes. Resignations, timeouts and agreed draws end the game in
        // GameBase instead and keep the die, since it may have informed the
        // decision. Partial moves have already returned, so the die never
        // changes while a move is entered.
        //
        // The front end previews a complete move under `emulation` before it
        // is submitted. The next die is cast on submission alone, so the
        // preview keeps showing this turn's die, where it was and as it fell,
        // and the game-over checks assume a full allowance: a roll nobody has
        // seen cannot decide them.
        const shown = this.die;
        this.die = this.variants.includes("dicey") && this.hands === undefined && !emulation ? castDie(this.board) : undefined;
        this.checkEOG();
        if (this.gameover) {
            this.die = undefined;
        } else if (emulation) {
            this.die = shown;
        }
        this.saveState();
        return this;

    }


    // One step of the turn: move the piece, then resolve the traps.
    private applyStep(from: string, to: string): void {
        const moved = this.board.get(from)!;
        this.board.set(to, moved);
        this.board.delete(from);
        this.results.push({type: "move", from, to});
        for (const trap of traps) {
            if (this.board.has(trap) && isAlone(this.board, trap)) {
                const [trapPc, trapOwner] = this.board.get(trap)!;
                this.board.delete(trap);
                this.results.push({type: "destroy", what: trapOwner === 1 ? trapPc : trapPc.toLowerCase(), where: trap});
            }
        }
    }

    // Play out a resolved turn step by step.
    private applyTurn(turn: Turn): void {
        for (const st of turn.steps) {
            this.applyStep(sqName(st.from), sqName(st.to));
        }
    }

    // Placement: returns the notation for each piece placed.
    private applySetup(m: string): string[] {
        const parts: string[] = [];
        const steps = m.split(",").filter(Boolean).filter(mv => !mv.startsWith("x")).map(mv => baseMove(mv));
        for (let i = 0; i < steps.length; i++) {
            const [pc, , from] = steps[i];
            if (from !== undefined) {
                this.board.set(from, [pc, this.currplayer]);
                this.results.push({type: "place", what: pc, where: from});
                // update hand
                if (!this.variants.includes("free")) {
                    this.hands![this.currplayer - 1].splice(this.hands![this.currplayer - 1].indexOf(pc), 1);
                }
                parts.push(`${this.currplayer === 1 ? pc : pc.toLowerCase()}${from}`);
            } else if (i !== steps.length - 1) {
                throw new Error("Invalid placement detected in the middle of the move.");
            }
        }
        return parts;
    }

    // Legacy step list: returns the steps taken, for serialization, and each
    // step written as the pre-notation engine did (with its captures).
    private applyLegacy(m: string): {steps: Array<{from: string; to: string}>; legacy: string[]} {
        const taken: Array<{from: string; to: string}> = [];
        const legacy: string[] = [];
        const steps = m.split(",").filter(Boolean).map(mv => baseMove(mv));
        for (let i = 0; i < steps.length; i++) {
            const [pc, owner, from, to] = steps[i];
            if (from !== undefined && to !== undefined) {
                const before = this.results.length;
                this.applyStep(from, to);
                taken.push({from, to});
                const captures = this.results.slice(before).filter(r => r.type === "destroy").map(r => `(x${r.what}${r.where})`).join("");
                legacy.push(`${owner === 1 ? pc : pc.toLowerCase()}${from}${to}${captures}`);
            } else if (from !== undefined) {
                this._selected = from;
            } else if (i !== steps.length - 1) {
                throw new Error("Invalid move detected in the middle of the move.");
            }
        }
        return {steps: taken, legacy};
    }

    // Lightvector notation: play the turn the tokens are shown as. Returns
    // nothing when a partial move does not (yet) denote one; the arrows are
    // kept for drawing.
    private applyNotation(m: string, partial: boolean): Turn|undefined {
        // a selection never blocks a submission: it is simply dropped
        const parsed = parseMove(m, true);
        this._selected = parsed.pending;
        this._selections = parsed.selections;
        this._entryMove = m;
        if (parsed.tokens.length === 0) {
            this.drawPendingPush(parsed);
            return undefined;
        }
        const d = display(this.board, this.currplayer, this.maxSteps(), parsed.tokens);
        if (d.status !== "turn") {
            if (!partial) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t(d.status === "idle" ? "apgames:validation.arimaa.NOPASS" : "apgames:validation.arimaa.NO_MOVE"));
            }
            // the move does not yet denote a turn, so draw what was entered
            this._arrows = parsed.tokens.filter(isArrow).map(t => [t.spec.square!, (t.prop as {square: string}).square]);
            this._marks = parsed.tokens.filter(isMark).map(t => t.spec.square!);
            if (d.status === "idle") {
                this.drawPendingPush(parsed);
            }
            return undefined;
        }
        this.applyTurn(d.turn);
        if (partial) {
            this.drawPendingPush(parsed);
        }
        return d.turn;
    }

    // The enemy piece's step of a push entered step by step is drawn as an
    // arrow while the pusher's step is still to come.
    private drawPendingPush(parsed: ParsedMove): void {
        const push = pendingPush(this.board, this.currplayer, parsed.selections ?? []);
        if (push !== undefined) {
            this._arrows = [...(this._arrows ?? []), [push.from, push.to]];
        }
    }

    protected checkEOG(): ArimaaGame {
        const prevPlayer: playerid = this.currplayer === 1 ? 2 : 1;
        const prevGoal = prevPlayer === 1 ? 8 : 1;
        const currGoal = this.currplayer === 1 ? 8 : 1;

        // no checking as long as setup is in progress
        if (this.hands !== undefined && this.hands.flat().length > 0) {
            return this;
        }

        // Check if a rabbit of prevPlayer reached goal. If so prevPlayer wins.
        const prevRabbits = [...this.board.entries()].filter(e => e[1][1] === prevPlayer && e[1][0] === "R").map(e => e[0]).filter(cell => cell.endsWith(prevGoal.toString()));
        if (prevRabbits.length > 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        // Check if a rabbit of currplayer reached goal. If so currplayer wins.
        if (!this.gameover) {
            const currRabbits = [...this.board.entries()].filter(e => e[1][1] === this.currplayer && e[1][0] === "R").map(e => e[0]).filter(cell => cell.endsWith(currGoal.toString()));
            if (currRabbits.length > 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        }
        // Check if currplayer lost all rabbits. If so prevPlayer wins.
        if (!this.gameover) {
            const currRabbits = [...this.board.entries()].filter(e => e[1][1] === this.currplayer && e[1][0] === "R");
            if (currRabbits.length === 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
            }
        }
        // Check if prevPlayer lost all rabbits. If so currplayer wins.
        if (!this.gameover) {
            const prevRabbits = [...this.board.entries()].filter(e => e[1][1] === prevPlayer && e[1][0] === "R");
            if (prevRabbits.length === 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        }
        // Check if currplayer has no possible move (all pieces are frozen or have no place to move,
        // or in Dicey Moves a single step is all the die allows and only pushes and pulls remain). If so prevPlayer wins.
        if (!this.gameover) {
            if (!hasAnyMove(this.board, this.currplayer, this.maxSteps())) {
                this.gameover = true;
                this.winner = [prevPlayer];
            }
        }

        // NOTE: Because we can't generate full move lists, we can't automatically detect when
        // the *only* moves that remain are illegal due to repetition. The player will just have
        // to resign. The game won't let them make the illegal move regardless.

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IArimaaState {
        return {
            game: ArimaaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ArimaaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            hands: cloneState(this.hands),
            die: cloneState(this.die),
        };
    }

    public render(opts: IArimaaRenderOpts = {}): APRenderRep {
        // Build piece string
        const plst: string[] = [];
        for (let row = 0; row < 8; row++) {
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = ArimaaGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [pc, owner] = this.board.get(cell)!;
                    pieces.push(`${pc}${owner}${isFrozen(this.board, cell) ? "x" : ""}`);
                } else {
                    pieces.push("-");
                }
            }
            plst.push(pieces.join(","));
        }
        let pstr = plst.join("\n");
        pstr = pstr.replace(/-,-,-,-,-,-,-,-/g, "_");

        // build legend
        const legend: ILegendObj = {
            "T": {
                name: "piece",
                colour: "_context_fill",
                opacity: 0.5,
                scale: 0.75,
            }
        };
        for (const pc of pc2name.keys()) {
            const name = "arimaa-" + pc2name.get(pc)!.toLowerCase();
            for (const colour of [1, 2] as const) {
                legend[`${pc}${colour}`] = {
                    name,
                    colour: this.getPlayerColour(colour),
                    colour2: {
                        func: "custom",
                        default: {
                            func: "bestContrast",
                            bg: this.getPlayerColour(colour),
                            fg: [
                                "#fff",
                                "#000",
                            ]
                        },
                        palette: 4 + colour,
                    },
                    flipx: colour === 2 ? true : false,
                    orientation: "vertical",
                };
                legend[`${pc}${colour}x`] = [
                    {
                        name,
                        colour: {
                            func: "custom",
                            default: {
                                func: "flatten",
                                fg: this.getPlayerColour(colour),
                                bg: "_context_board",
                                opacity: 0.375,
                            },
                            palette: 2 + colour,
                        },
                        colour2: {
                            func: "custom",
                            default: {
                                func: "bestContrast",
                                bg: this.getPlayerColour(colour),
                                fg: [
                                    "#fff",
                                    "#000",
                                ]
                            },
                            palette: 4 + colour,
                        },
                        flipx: colour === 2 ? true : false,
                        orientation: "vertical",
                    },
                ];
            }
        }

        // add an area if the current player has pieces to place
        let areas: AreaPieces[]|undefined;
        if (placing(this.hands, this.currplayer)) {
            // add pieces to legend with wider click boxes to the legend
            for (const [key, pc] of [...Object.entries(legend)]) {
                if (key !== "T" && !Array.isArray(pc)) {
                    const newkey = `p${key}`;
                    legend[newkey] = [
                        {
                            name: "piece-square-borderless",
                            colour: "_context_background",
                        },
                        {...pc} as Glyph,
                    ];
                }
            }
            const pcs = this.hands[this.currplayer - 1].sort((a, b) => ArimaaGame.strength(b) - ArimaaGame.strength(a)).map(pc => `${pc}${this.currplayer}`);
            areas = [
                {
                    type: "pieces",
                    pieces: pcs.map(pc => `p${pc}`) as [string, ...string[]],
                    label: this.seatAreaLabel(this.currplayer, "apgames:validation.arimaa.LABEL_STASH"),
                }
            ];
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 8,
                height: 8,
                markers: [
                    {
                        type: "glyph",
                        glyph: "T",
                        points: [
                            {
                                col: 2,
                                row: 2
                            },
                            {
                                col: 5,
                                row: 2
                            },
                            {
                                col: 2,
                                row: 5
                            },
                            {
                                col: 5,
                                row: 5
                            }
                        ]
                    },
                    {
                        type: "edge",
                        colour: this.getPlayerColour(1),
                        edge: "S",
                    },
                    {
                        type: "edge",
                        colour: this.getPlayerColour(2),
                        edge: "N",
                    }
                ]
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Dicey Moves: the turn's die, one of the renderer's d6 faces, drawn as
        // a board marker so that a piece moving onto its square covers it. The
        // body stays hollow, and the outline and pips are both drawn in
        // whichever of black and white contrasts best with the board colour,
        // so the die shows on light and dark boards alike.
        if (this.die !== undefined) {
            const ink: PaintEntry = {
                colour: {func: "bestContrast", bg: "_context_board", fg: ["#000", "#fff"]},
                opacity: 0.75,
            };
            legend.DIE = {
                name: `d6-${this.die.steps}`,
                paint: {border: ink, detail: ink},
                scale: 0.6,
            };
            const [dx, dy] = ArimaaGame.algebraic2coords(this.die.square);
            (rep.board as BoardBasic).markers!.push({
                type: "glyph",
                glyph: "DIE",
                points: [{row: dy, col: dx}],
            });
        }

        // Advanced trap capture control: one custom SVG triangle is both the
        // visible control and its hit shape. Unlike an ordinary shading
        // marker, the renderer gives board pieces a click handler. The
        // triangle is filled where clicking it has the piece captured, and
        // a thick outline where it keeps the piece alive; the outline's
        // interior is painted fully transparent so that it is still hit.
        if (opts.inputMode === "advanced" && this._entryMove !== undefined && this._selected !== undefined) {
            const original = this.stack[this.stack.length - 1].board;
            const choices = captureChoices(original, this.currplayer, this.maxSteps(), this._entryMove);
            if (choices.size > 0) {
                rep.glyphDefs = {};
                // Board pieces normally have a 0.85 placement inset. Cancel it
                // to align the polygon exactly to the grid: x=[0.5,1], y=[0,0.5]
                // of the trap cell.
                const paint = {func: "flatten", fg: "_context_fill", bg: "_context_board", opacity: 0.5} as const;
                if ([...choices.values()].includes(true)) {
                    rep.glyphDefs["arimaa-trap-choice"] = {
                        viewBox: [0, 0, 100, 100],
                        markup: '<polygon points="50,0 100,0 100,50" fill="#ffffff" data-slot-fill="fill"/>',
                    };
                    legend[ARIMAA_CAPTURE_CHOICE] = {def: "arimaa-trap-choice", orientation: "vertical", scale: 1 / 0.85, paint: {fill: paint}};
                }
                if ([...choices.values()].includes(false)) {
                    rep.glyphDefs["arimaa-trap-spare"] = {
                        viewBox: [0, 0, 100, 100],
                        markup: '<polygon points="62,5 95,5 95,38" fill="#ffffff" fill-opacity="0" stroke="#ffffff" stroke-width="10" stroke-linejoin="round" data-slot-stroke="fill"/>',
                    };
                    legend[ARIMAA_SPARE_CHOICE] = {def: "arimaa-trap-spare", orientation: "vertical", scale: 1 / 0.85, paint: {fill: paint}};
                }
                // This is a render-only extra layer. The actual game board,
                // saved moves and the mode-independent pieces stay unchanged.
                const layers = plst.map(line => line.split(",").map(key => key === "-" ? [] : [key]));
                for (const [trap, captured] of choices) {
                    const [x, y] = ArimaaGame.algebraic2coords(trap);
                    layers[y][x].push(captured ? ARIMAA_CAPTURE_CHOICE : ARIMAA_SPARE_CHOICE);
                }
                rep.pieces = [layers[0], ...layers.slice(1)];
            }
        }

        // Add annotations: one arrow per piece from where it started the turn
        // to where it ended up, the enter glyph for a piece back where it began,
        // and the exit glyph on a trap that claimed a piece
        rep.annotations = [];
        const point = (cell: string): {row: number; col: number} => {
            const [x, y] = ArimaaGame.algebraic2coords(cell);
            return {row: y, col: x};
        };
        const exited = new Set<string>();
        for (const tr of ArimaaGame.trajectoriesFromResults(this.results)) {
            if (tr.start !== tr.final) {
                rep.annotations.push({type: "move", targets: [point(tr.start), point(tr.final)]});
            }
            if (tr.captured) {
                rep.annotations.push({type: "exit", targets: [point(tr.final)]});
                exited.add(tr.final);
            } else if (tr.start === tr.final) {
                rep.annotations.push({type: "enter", targets: [point(tr.start)]});
            }
        }
        for (const r of this.results) {
            if (r.type === "place") {
                rep.annotations.push({type: "enter", targets: [point(r.where!)]});
            }
        }
        // arrows that do not yet denote a move are still shown
        if (this._arrows !== undefined) {
            for (const [from, to] of this._arrows) {
                rep.annotations.push({type: "move", targets: [point(from), point(to)]});
            }
        }
        // capture marks are drawn as the piece leaving
        if (this._marks !== undefined) {
            for (const sq of this._marks) {
                if (!exited.has(sq)) {
                    rep.annotations.push({type: "exit", targets: [point(sq)]});
                    exited.add(sq);
                }
            }
        }
        // A chain can have several selected pieces. Highlight each square,
        // including an enemy which is about to be pushed or pulled.
        for (const square of this._selections ?? (this._selected === undefined ? [] : [this._selected])) {
            const [x, y] = ArimaaGame.algebraic2coords(square);
            (rep.board as BoardBasic).markers!.push({
                type: "flood",
                colour: this.getPlayerColour(this.currplayer),
                opacity: 0.25,
                points: [{row: y, col: x}],
            });
        }
        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    public harlog(): number {
        let score = 0;

        const Q = 1.447530126;
        const G = 0.6314442034;
        const C = 7.995516184;

        const gold = [...this.board.entries()].filter(e => e[1][1] === 1).map(e => ArimaaGame.strength(e[1][0]));
        const silver = [...this.board.entries()].filter(e => e[1][1] === 2).map(e => ArimaaGame.strength(e[1][0]));

        for (const colour of ["gold", "silver"]) {
            const mine = colour === "gold" ? gold : silver;
            const theirs = colour === "gold" ? silver : gold;
            for (const str of [2,3,4,5,6]) {
                const num = mine.filter(n => n === str).length;
                const stronger = theirs.filter(n => n > str).length;
                if (stronger === 0) {
                    score += ((2 / Q) * num) * (colour === "gold" ? 1 : -1);
                } else {
                    score += ((1 / (Q + stronger)) * num) * (colour === "gold" ? 1 : -1);
                }
            }
            const rabbits = mine.filter(n => n === 1).length;
            score += (G * Math.log(rabbits * mine.length)) * (colour === "gold" ? 1 : -1);
        }

        return score * C;
    }

    public sidebarStatuses(): IStatus[] {
        const key = this.neutralAreaLabel("apgames:status.arimaa.HARLOG");
        const harlog = this.harlog();
        const magnitude = Math.abs(harlog).toFixed(2);
        // The glyph's colour stands in for the sign, so omit it when the displayed value is all zeros
        if (Number.isNaN(harlog) || Number(magnitude) === 0) {
            return [{ key, value: [magnitude] }];
        }
        const glyph = this.statusSheetGlyph("piece", this.getPlayerColour(harlog > 0 ? 1 : 2));
        return [{ key, value: [glyph, magnitude] }];
    }

    // Dicey Moves: how the die has been rolling for each player, from the
    // rolls heading the turns played and the die waiting for the turn in
    // progress. Steps a player left unused do not enter into it. The opening
    // move of Endless endgame is half a turn, so its roll counts double
    // towards the mean, which keeps it comparable, but as rolled towards the
    // total.
    public sidebarScores(): IScores[] {
        if (!this.variants.includes("dicey")) {
            return [];
        }
        const totals: [number, number] = [0, 0];
        const weighted: [number, number] = [0, 0];
        const turns: [number, number] = [0, 0];
        const tally = (player: playerid, steps: number, opening: boolean): void => {
            totals[player - 1] += steps;
            weighted[player - 1] += opening ? steps * 2 : steps;
            turns[player - 1]++;
        };
        const eee = this.variants.includes("eee");
        // a roll heads the results of the turn played from the state before
        for (let i = 1; i < this.stack.length; i++) {
            for (const r of this.stack[i]._results) {
                if (r.type === "roll") {
                    tally(this.stack[i - 1].currplayer, r.values[0], eee && i === 1);
                }
            }
        }
        // the die waiting for the turn in progress, read from the top of the
        // stack alone: a resignation, timeout or agreed draw carries it onto
        // one more state, but no turn was played to record its roll
        const top = this.stack[this.stack.length - 1];
        if (top.die !== undefined) {
            tally(top.currplayer, top.die.steps, eee && this.stack.length === 1);
        }
        if (turns[0] + turns[1] === 0) {
            return [];
        }
        const means = weighted.map((sum, i) => turns[i] === 0 ? "-" : (sum / turns[i]).toFixed(2));
        return [
            { name: this.neutralAreaLabel("apgames:status.arimaa.ROLL_MEAN"), scores: means, spoiler: true },
            { name: this.neutralAreaLabel("apgames:status.arimaa.ROLL_TOTAL"), scores: totals, spoiler: true },
        ];
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PLACE.complete", {what: pc2name.get(r.what! as Piece)!, where: r.where!});
                return true;
            case "move":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.MOVE.nowhat", {from: r.from!, to: r.to!});
                return true;
            case "destroy":
                this.pushNeutralChatLine(lines, "apresults:arimaa.DESTROY.default", {colour: isLower(r.what!) ? "silver" : "gold", what: pc2name.get(r.what!.toUpperCase() as Piece)!, where: r.where!});
                return true;
            case "announce":
                this.pushNeutralChatLine(lines, "apresults:arimaa.ANNOUNCE.default");
                return true;
            case "roll":
                // Dicey Moves: the die that governed the turn
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:arimaa.ROLL", {count: r.values[0]});
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public clone(): ArimaaGame {
        const cloned = Object.assign(new ArimaaGame(), cloneState(this) as ArimaaGame);
        return cloned;
    }

    // reduce a board position to a unique string representation for comparison
    public signature(board?: Map<string, CellContents>): string {
        if (board === undefined) {
            board = this.board;
        }
        let sig = "";
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = ArimaaGame.coords2algebraic(col, row);
                if (board.has(cell)) {
                    const [pc, owner] = board.get(cell)!;
                    sig += owner === 1 ? pc : pc.toLowerCase();
                } else {
                    sig += "-";
                }
            }
        }
        return sig;
    }

    // tells you how many times the current, UNPUSHED board position has been
    // repeated in the stack
    public numRepeats(): number {
        let num = 0;
        const sigCurr = this.signature();
        const parityCurr = this.stack.length % 2 === 0 ? "even" : "odd";
        for (let i = 0; i < this.stack.length; i++) {
            const parity = i % 2 === 0 ? "even" : "odd";
            const sig = this.signature(this.stack[i].board);
            if (sig === sigCurr && parity === parityCurr) {
                num++;
            }
        }
        return num;
    }

    // Many spellings denote one move, and case carries colour, so compare the
    // positions the two strings reach from the state before move1. Both are
    // moves that were played, so they are replayed trusted: a recorded move
    // the rules no longer allow still has to compare equal to itself.
    public sameMove(move1: string, move2: string): boolean {
        const norm = (m: string): string => m.replace(/\s+/g, "");
        if (norm(move1) === norm(move2)) {
            return true;
        }
        const cloned = this.clone();
        cloned.stack.pop();
        cloned.load(-1);
        cloned.gameover = false;
        cloned.winner = [];
        try {
            cloned.move(move2, {trusted: true});
        } catch {
            return false;
        }
        return cloned.signature() === this.signature() && JSON.stringify(cloned.hands) === JSON.stringify(this.hands);
    }

    // Follow each piece through the per-step results of a turn.
    public static trajectoriesFromResults(results: APMoveResult[]): Array<{start: string; final: string; captured: boolean}> {
        const where = new Map<string, string>();
        const out = new Map<string, {start: string; final: string; captured: boolean}>();
        for (const r of results) {
            if (r.type === "move") {
                const key = where.get(r.from) ?? r.from;
                where.delete(r.from);
                where.set(r.to, key);
                out.set(key, {start: key, final: r.to, captured: false});
            } else if (r.type === "destroy" && r.where !== undefined) {
                const key = where.get(r.where) ?? r.where;
                where.delete(r.where);
                out.set(key, {start: key, final: r.where, captured: true});
            }
        }
        return [...out.values()];
    }

    public getStartingPosition(): string {
        if (this.variants.includes("eee")) {
            const pcs: string[] = [];
            const board = this.stack[0].board;
            for (const [cell, [pc, owner]] of board.entries()) {
                pcs.push(`${owner === 1 ? pc : pc.toLowerCase()}${cell}`);
            }
            return pcs.join(",");
        } else {
            return "";
        }
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return {
                func: "custom",
                default: "#bf9212",
                palette: 1
            };
        } else {
            return {
                func: "custom",
                default: "#989898",
                palette: 2
            };
        }
    }

}

