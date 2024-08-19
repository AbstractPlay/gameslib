/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import { Glyph } from "@abstractplay/renderer";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type tileid = 1|2|3;
export type playerid = 1|2;
export type cellcontent = [tileid,playerid?];

const tilecolors: string[] = ["", "orange", "purple", "green"];
const tilecolorscodes: number[] = [0, 6, 5, 3];

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
    board: Map<string, cellcontent>;
    lastmove?: string;
    preparedflags: number[];
    remainingtiles: number[];
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
        flags: [],
        dateAdded: "2024-10-15",
        categories: ["board>shape>hex"]
    };

    /**
     * For me personally, I like using algebraic notation and x,y coordinates, so I routinely convert between the two. The base object offers a default version that requires the board's height. For simplicity, if there's only one board size for a game, I create a game-specific version with the height baked in. This is one of those "flexibility" points. You are free to represent your game board and state in whatever way makes sense to you. You could delete and ignore these functions entirely, if you wanted.
     */
    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }
    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    /**
     * Basic TypeScript class boilerplate. You need to define your class's data.
     */
    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontent>;
    public boardsize = 5;
    public graph: HexTriGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public preparedflags: number[] = [];
    public remainingtiles: number[] = [];

    /**
     * This is where you create a new game or load in an existing state handed to you by the front end. This is where you'd track variants, initialize your board, whatever else you need to do.
     */
    constructor(state?: ITritiumState | string) {
        super();
        const tilesOfEachColor = this.boardsize * (this.boardsize - 1);

        if (state === undefined) {
            const fresh: IMoveState = {
                _version: TritiumGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, cellcontent>(),
                preparedflags: [0, 1, 1],
                remainingtiles: [0, tilesOfEachColor, tilesOfEachColor, tilesOfEachColor]
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
        this.board = deepclone(state.board) as Map<string, cellcontent>;
        this.lastmove = state.lastmove;
        this.preparedflags = [...state.preparedflags];
        this.remainingtiles = [...state.remainingtiles];

        return this;
    }

    public getGraph(): HexTriGraph {
        const graph = new HexTriGraph(this.boardsize, this.boardsize * 2 - 1);
        const center = graph.coords2algebraic(this.boardsize - 1, this.boardsize - 1);
        graph.graph.dropNode(center);
        return graph;
    }

    public tileAt(cell: string): tileid | undefined {
        return this.board.get(cell)?.[0];
    }

    public flaggedCells(start?: string): Set<string> {
        const flagged = new Set<string>();
        const queue: string[] = [];

        if(start !== undefined) {
            flagged.add(start);
            queue.push(start);
        } else {
            for (const [cell, content] of this.board) {
                if (content[1] !== undefined) {
                    flagged.add(cell);
                    queue.push(cell);
                }
            }
        }

        while (queue.length > 0) {
            const cell = queue.pop()!;
            for(const neighbour of this.graph.neighbours(cell)) {
                if (!flagged.has(neighbour)) {
                    if (this.tileAt(cell) === this.tileAt(neighbour)) {
                        flagged.add(neighbour);
                        queue.push(neighbour);
                    }
                }
            }
        }

        return flagged;
    }

    /**
     * This should generate a full list of valid moves from the current game state. If it is not reasonable for your game to generate such a list, you can remove this function and add the `no-moves` flag to the game's metadata. If you *can* efficiently generate a move list, though, I highly recommend it. It's helpful to players, and it makes your life easier later.
     */
    public moves(): string[] {
        const moves: string[] = [];
        if (this.gameover) { return moves; }

        const flagged = this.flaggedCells();

        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell) && !flagged.has(cell) && this.preparedflags[this.currplayer] > 0) {
                moves.push("flag-" + cell);
            } else if (!this.board.has(cell)) {
                for(let i = 1; i <= 3; i++) {
                    if (this.remainingtiles[i] > 0) {
                        moves.push(tilecolors[i] + "-" + cell);
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
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
            let newmove = "";
            if(move.length === 0) {
                const str = piece ?? "";
                if (tilecolors.includes(str) || str === "flag") {
                    newmove = str;
                }
            }
            else {
                const cell = this.graph.coords2algebraic(col, row);
                if(this.graph.graph.nodes().includes(cell)) {
                    newmove = `${move}-${cell}`;
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tritium.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (m === "flag" && this.preparedflags[this.currplayer] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tritium.NO_PREPARED_FLAG");
            return result;
        }

        if (tilecolors.includes(m) || m === "flag") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tritium.INITIAL_INSTRUCTIONS2")
            return result;
        }

        const parts = m.split("-");
        const piece = parts[0];
        const cell = parts[1];

        if(tilecolors.includes(piece)) {
            if(this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tritium.NON_EMPTY", {cell});
                return result;
            }
        }
        else if (piece === "flag") {
            if(!this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tritium.EMPTY", {cell});
                return result;
            }
            else {
                const flagged = this.flaggedCells();
                if (flagged.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tritium.NON_FREE_REGION", {cell});
                    return result;
                }
            }
        }

        if (!this.moves().includes(m)) {
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

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        const parts = m.split("-");
        const piece = parts[0];
        const cell = parts[1];

        if (piece === "pass") {
            this.results.push({type: "pass"});

        } else if (piece === "flag") {

            const prev = this.board.get(cell)!;
            this.board.set(cell, [prev[0], this.currplayer]);
            this.preparedflags[this.currplayer]--;

            if (this.preparedflags[1] === 0 && this.preparedflags[2] === 0) {
                this.preparedflags[1] = 1;
                this.preparedflags[2] = 1;
            }

            this.results.push({type: "place", where: cell});

        } else {
            const tile = tilecolors.indexOf(piece) as tileid;
            this.board.set(cell, [tile]);
            this.remainingtiles[tile]--;

            this.results.push({type: "place", where: cell});
        }

        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;

        this.checkEOG();
        this.saveState();
        return this;
    }

    /**
     * This is the code that actually checks whether the game is over or not, and specifies who the winners are if so.
     */
    protected checkEOG(): TritiumGame {

        if (this.lastmove === "pass" && this.stack.at(-1)!.lastmove === "pass") {
            this.gameover = true;
            const scores = this.getPlayersScores()[0].scores;

            if(scores[0] > scores[1]) {this.winner = [1];}
            else if(scores[1] > scores[0]) {this.winner = [2];}
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
        const state = {
            _version: TritiumGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, cellcontent>,
            preparedflags: [...this.preparedflags],
            remainingtiles: [...this.remainingtiles]
        };
        return state;
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                const piece: string[] = [];
                if (this.board.has(cell)) {
                    const content = this.board.get(cell)!;
                    piece.push(`T${content[0]}`)
                    if(content[1] !== undefined) {
                        piece.push(`P${content[1]}`)
                    }
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        // Side bar

        const sidebar = [];
        const tiles: Glyph[][] = [];
        tiles.push([]);

        for(let i = 1; i <= 3; i++) {
            tiles.push([{
                name: "hex-pointy",
                colour: tilecolorscodes[i],
                scale: 1,
            },
            {
                text: this.remainingtiles[i].toString(),
                scale: 0.75
            }]);

            if (this.remainingtiles[i] > 0) {
                sidebar.push({name: "", piece: `K${i}`, value: tilecolors[i]});
            }
        }

        for(const p of [1,2]) {
            for(let i = 1; i <= this.preparedflags[p]; i++) {
                sidebar.push({name: "", piece: `P${p}`, value: "flag"});
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "default",
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: this.boardsize * 2 - 1,
                blocked: [{row: this.boardsize - 1, col: this.boardsize - 1}],
                alternatingSymmetry: false
            },
            legend: {
                T1: {
                    name: "hex-pointy",
                    colour: tilecolorscodes[1]
                },
                T2: {
                    name: "hex-pointy",
                    colour: tilecolorscodes[2]
                },
                T3: {
                    name: "hex-pointy",
                    colour: tilecolorscodes[3]
                },
                P1: {
                    name: "piece",
                    scale: 0.3,
                    colour: "#000"
                },
                P2: {
                    name: "piece",
                    scale: 0.3,
                    colour: "#fff"
                },
                K1: tiles[1] as [Glyph, ...Glyph[]],
                K2: tiles[2] as [Glyph, ...Glyph[]],
                K3: tiles[3] as [Glyph, ...Glyph[]],
            },
            pieces: pstr as [string[][], ...string[][][]],
            areas: [
                {
                    type: "key",
                    height: 1,
                    list: sidebar,
                    clickable: true
                }
            ],
        };

        return rep;
    }

    public getPlayersScores(): IScores[] {
        const flagcounts = new Map<string, [number,number,number]>();

        for (const cell of this.graph.listCells(false) as string[]) {
            flagcounts.set(cell, [0,0,0]);
        }

        // @ts-ignore
        for (const [cell, [,flag]] of this.board) {
            if (flag !== undefined) {
                for(const connected of this.flaggedCells(cell)) {
                    const counts = flagcounts.get(connected)!;
                    counts[flag]++;
                    flagcounts.set(connected, counts);
                }
            }
        }

        const scores = [0,0];
        for(const [,counts] of flagcounts) {
            if (counts[1] > counts[2]) {scores[0]++;}
            else if (counts[2] > counts[1]) {scores[1]++;}
        }

        return [
            { name: i18next.t("apgames:status.SCORES"), scores }
        ]
    }

    /**
     * This function is only for the local playground.
     */
    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
            status += "**Scores**: " + this.getPlayersScores()[0].scores.join(",") + "\n\n";
        }

        return status;
    }

    /**
     * Just leave this. You very, very rarely need to do anything here.
     */
    public clone(): TritiumGame {
        return new TritiumGame(this.serialize());
    }
}
