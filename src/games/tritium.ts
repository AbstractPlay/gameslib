import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

/**
 * Every new game must define what the rest of the system is going to store as "state."
 * The base class defines the minimum requirements, but your game must add whatever it specifically needs.
 * The `ITritiumState` is the top-level state and contains information that doesn't change a lot.
 * It also contains `stack`, which is a list of all the `IMoveState`s representing each individual turn in a game.
 * The first item in that stack represents the initial game state, and a new state is appended to the stack after every turn.
 * Anything your game needs to remember between turns needs to be here.
 */
export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ITritiumState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

/**
 * Each game is its own class that inherits and extends GameBase (or GameBaseSimultaneous).
 * The base object defines the required functions and provides sensible defaults for the rest.
 */
export class TritiumGame extends GameBase {

    /**
     * This describes the game's metadata used by the front end and other tools.
     * It's essential that this be correct. See the `api.md` file for details.
     */
    public static readonly gameinfo: APGamesInformation = {
        name: "Tritium",
        uid: "tritium",
        playercounts: [2],
        version: "20241015",
        description: "apgames:descriptions.Tritium",
        urls: [""],
        people: [
            {
                type: "designer",
                name: "Noé Falzon",
            },
        ],
        flags: []
    };

    /**
     * For me personally, I like using algebraic notation and x,y coordinates, so I routinely convert between the two. The base object offers a default version that requires the board's height. For simplicity, if there's only one board size for a game, I create a game-specific version with the height baked in. This is one of those "flexibility" points. You are free to represent your game board and state in whatever way makes sense to you. You could delete and ignore these functions entirely, if you wanted.
     */
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
    }

    /**
     * Basic TypeScript class boilerplate. You need to define your class's data.
     */
    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    /**
     * This is where you create a new game or load in an existing state handed to you by the front end. This is where you'd track variants, initialize your board, whatever else you need to do.
     */
    constructor(state?: ITritiumState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: TritiumGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITritiumState;
            }
            if (state.game !== TritiumGame.gameinfo.uid) {
                throw new Error(`The Tritium engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    /**
     * This is how the front end loads particular states within a game's timeline. Anything you defined up in `IMoveState` will need to be mentioned here. This is also the place to process any side effects, like deriving the board size or initializing certain helper functions (not shown here).
     */
    public load(idx = -1): TritiumGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    /**
     * This should generate a full list of valid moves from the current game state. If it is not reasonable for your game to generate such a list, you can remove this function and add the `no-moves` flag to the game's metadata. If you *can* efficiently generate a move list, though, I highly recommend it. It's helpful to players, and it makes your life easier later.
     */
    public moves(): string[] {
        if (this.gameover) { return []; }
        return ["a","b","c","d"];
    }

    /**
     * This is a helper function only needed for local testing, and only useful if you have a `moves()` function.
     */
    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /**
     * This takes information about the move in progress and the click the user just made and needs to return an updated move string and some description of how valid and complete the move is.
     * - `valid` must be either true or false. As long as the move is even partially valid, it should return true. False tells the front end that it's wholly and unsalvageably invalid.
     * - `complete` has three states: -1, 0, and 1. -1 means the move is for absolutely sure NOT complete. More input is needed. 0 means the move *could* be complete and submitted now, but further moves are possible. And 1 means the move is absolutely complete and no further input should be expected.
     * - `canrender` is for games where the moves consist of multiple steps and need to be rendered as you go. If `canrender` is true, then even if `complete` is -1, it will be send to the renderer for updating.
     * - `message` is a translatable string explaining what the user should do next.
     */
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = TritiumGame.coords2algebraic(col, row);
            const newmove = cell[0];
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    /**
     * This goes hand in hand with `handleClick()` and can be leveraged in other areas of the code as well. It accepts a move string and then returns a description of the move's condition. See description of `handleClick()` for details.
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.Tritium.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (! ["a","b","c","d"].includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * This is where you actually execute a move. You can use `validateMove()` and `moves()` to make triple sure you've received a valid move, and that frees you from excessive error checking and handling in your execution code. More comments below.
     */
    public move(m: string, {trusted = false} = {}): TritiumGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        /**
         * This validates the move and then does a failsafe check to make sure the move is also found by the move generator. You don't necessarily need both, but it's useful when first testing a game.
         */
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // The front end often needs to make moves that it knows are valid, so to save time, it can pass `trusted: true` to skip the validation step.
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        /**
         * This is where the actual game logic gets handled.
         * The `results` is a structured way of telling users what actually happened during a turn.
         * It can be included in a final game report and can also be helpful when rendering the board state.
         */
        this.results = [];
        let placed = false;
        for (const row of [1,2,3,4,5,6,7]) {
            const cell = m + row.toString();
            if (! this.board.has(cell)) {
                this.board.set(cell, this.currplayer);
                this.results.push({type: "place", where: cell});
                if (row < 7) {
                    this.results.push({type: "move", from: `${m}7`, to: cell});
                }
                placed = true;
                break;
            }
        }
        // push column down
        if (! placed) {
            for (let row = 1; row <= 6; row++) {
                const lower = m + row.toString();
                const upper = m + (row + 1).toString();
                this.board.set(lower, this.board.get(upper)!);
            }
            this.results.push({type: "move", from: `${m}6`, to: `${m}1`});
            this.board.set(`${m}7`, this.currplayer);
            this.results.push({type: "place", where: `${m}7`});
    }

        /**
         * This is also where you have to tell the front end whose turn it is now.
         */
        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        /**
         * This function also needs to check to see if the game has ended and then save the current game state to the stack.
         */
        this.checkEOG();
        this.saveState();
        return this;
    }

    /**
     * This is an example of a helper function. You can have as many functions as you need to help make your life easier. In this case, it just checks to see if a player has four in a row anywhere.
     */
    private hasFours(player: playerid): boolean {
        const grid = new RectGrid(4,7);
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 4; x++) {
                for (const dir of ["W","SW","S","SE","E"] as const) {
                    const ray = [[x,y] as [number,number], ...grid.ray(x, y, dir)].map(node => TritiumGame.coords2algebraic(...node));
                    if (ray.length >= 4) {
                        let four = true;
                        for (const cell of ray.slice(0,4)) {
                            if ( (! this.board.has(cell)) || (this.board.get(cell)! !== player) ) {
                                four = false;
                                break;
                            }
                        }
                        if (four) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    /**
     * This is the code that actually checks whether the game is over or not, and specifies who the winners are if so.
     */
    protected checkEOG(): TritiumGame {
        const conn1 = this.hasFours(1);
        const conn2 = this.hasFours(2);
        // only one person has four in a row
        if ( (conn1 || conn2) && (conn1 !== conn2) ) {
            this.gameover = true;
            if (conn1) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    /**
     * Anything up in your ITritiumState definition needs to be here.
     */
    public state(): ITritiumState {
        return {
            game: TritiumGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    /**
     * And same here for IMoveState. The base object uses these to save things.
     * If you're new to TypeScript, you will want to familiarize yourself with the difference between reference types and value types. There's a reason you can't just say `board: this.board` in the below. You need to actually create a fresh map that duplicates `this.board`.
     */
    public moveState(): IMoveState {
        return {
            _version: TritiumGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    /**
     * And this is how you turn a game state into something people can see and interact with.
     * The system tries to abstract things as much as possible. You don't have to know anything about computer graphics. You just need to be able to get the rendering engine to do what you want.
     * To learn that, you will want to visit <http://renderer.dev.abstractplay.com> and learn how the renderer works. Basically you need to choose a board, load your pieces, populate the board, and then annotate any recent moves.
     * You will see a fair bit of `// @ts-ignore`. This is not good practice generally, but I have found them necessary here. The type system is very strict, and sometimes that gets in the way. As long as your render actually works in the playground, you're OK, regardless of what type errors are thrown here.
     */
    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 4; col++) {
                const cell = TritiumGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{4}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 4,
                height: 7,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = TritiumGame.algebraic2coords(move.from);
                    const [toX, toY] = TritiumGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = TritiumGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    /**
     * This function is only for the local playground.
     */
    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    /**
     * This is for rendering each move in the front end's chat log.
     * For simple games, you can start by deleting this and going with the defaults.
     * And then, if you need something special, it might be simpler just to ask for direction in the Discord. But basically you can customize the chat message for your specific game.
     */
    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                resolved = true;
                break;
        }
        return resolved;
    }

    /**
     * Just leave this. You very, very rarely need to do anything here.
     */
    public clone(): TritiumGame {
        return new TritiumGame(this.serialize());
    }
}
