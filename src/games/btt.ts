import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult, IStashEntry } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, DirectionCardinal, RectGrid, reviver, oppositeDirections, orthDirections, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs";
import {connectedComponents} from 'graphology-components';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

interface ILegendObj {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
}

export type playerid = 1 | 2 | 3 | 4;
export type Size = 1 | 2 | 3;
export type CellContents = [playerid, Size, DirectionCardinal] | "NULL" | "ROOT";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    scores: number[];
    stashes: Map<playerid, [number, number, number]>; // sizes 1,2,3
};

export interface IBTTState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface IBTTMove {
    cell: string;
    piece?: string;
    size?: number;
    direction?: string;
    incomplete?: boolean;
    valid: boolean;
}

export class BTTGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Branches and Twigs and Thorns",
        uid: "btt",
        playercounts: [2, 3, 4, 5, 6],
        version: "20260308",
        dateAdded: "2026-03-08",
        // i18next.t("apgames:descriptions.btt")
        description: "apgames:descriptions.btt",
        urls: [
            "https://boardgamegeek.com/boardgame/17298/branches-and-twigs-and-thorns",
            "https://www.eblong.com/zarf/barsoom-go.html"
        ],
        people: [
            {
                type: "designer",
                name: "Andrew Plotkin",
                urls: ["https://www.eblong.com"]
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        variants: [
            { uid: "arcade", group: "setup" },
            { uid: "martian-go", group: "setup" }
        ],
        categories: ["goal>score>eog", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>pyramids", "other>2+players"],
        flags: ["player-stashes", "scores", "experimental"]
    };

    public numplayers!: number;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public stashes!: Map<playerid, [number, number, number]>;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlight?: IBTTMove;

    constructor(state: number | IBTTState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            
            const fresh: IMoveState = {
                _version: BTTGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [],
                stashes: new Map()
            };
            if ( this.variants.includes("martian-go") && this.numplayers < 5 ) {
                //There are no nulls, and the roots are prefab.
                fresh.board.set("d4", "ROOT");
                fresh.board.set("e4", "ROOT");
                if (this.numplayers === 3) {
                    fresh.board.set("d3", "ROOT");
                } else if (this.numplayers === 4) {
                    fresh.board.set("d5", "ROOT");
                    fresh.board.set("e5", "ROOT");
                }
            }

            for (let pid = 1; pid <= state; pid++) {
                fresh.scores.push(0);
                if ( this.variants.includes("arcade") )
                    fresh.stashes.set(pid as playerid, [3,3,3]);
                else
                    fresh.stashes.set(pid as playerid, [5,5,5]);
            }

            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBTTState;
            }
            if (state.game !== BTTGame.gameinfo.uid) {
                throw new Error(`The BTT engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.variants = state.variants;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BTTGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ((idx < 0) || (idx >= this.stack.length)) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        this.stashes = deepclone(state.stashes) as Map<playerid, [number, number, number]>;
        this.results = [...state._results];
        return this;
    }

    public get boardHeight(): number {
        if ( this.variants.includes("arcade") )
            return this.numplayers < 6 ? 5 : 10;
        else 
            return this.numplayers * 2;
    }

    public get boardWidth(): number {
        if (this.variants.includes("arcade"))
            return this.numplayers < 6 ? this.numplayers * 2 : 6;
        else
            return 8;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardHeight);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardHeight);
    }


    /* helper functions */

    private checkNull(cell: string): boolean {
        //Determine whether a second (or third) null is legal
        // (that is, it doesn't isolate any squares).
        //Also returns true if there is no first null.
        const firstNull = [...this.board.values()].filter(c => c === "NULL");
        if ( firstNull === undefined || firstNull.length === 0 )
            return true;

        //Because of the 6p case, make a graph in order to check
        // that there aren't multiple connected components.
        const gEmpties = this.getGraph();
        for (const node of gEmpties.graph.nodes()) {
            if (this.board.has(node))
                gEmpties.graph.dropNode(node);
            if (node === cell)
                gEmpties.graph.dropNode(node);
        }

        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);

        return emptyAreas.length < 2;
    }

    private getGraph(): SquareOrthGraph { // just orthogonal connections
        return new SquareOrthGraph(this.boardWidth, this.boardHeight);
    }

    private getNeighborDir(cell: string): Direction {
        //Returns a single direction if the move is unambiguous.
        const nadirs = this.getNeighborDirs(cell);
        if (nadirs.length === 1)
            return nadirs[0];
        else
            return "NE";
    }

    private getNeighborDirs(cell: string): DirectionCardinal[] {
        const grid = new RectGrid(this.boardWidth, this.boardHeight);
        const [x, y] = this.algebraic2coords(cell);
        const neighdirs: DirectionCardinal[] = [];

        orthDirections.forEach((d) => {
            const [xNext, yNext] = RectGrid.move(x, y, d);
            if (grid.inBounds(xNext, yNext)) {
                const neicell = this.coords2algebraic(xNext, yNext);
                if ( this.board.has(neicell) && this.board.get(neicell) !== "NULL" )
                    neighdirs.push(d);
            }
        });

        return neighdirs;
    }

    private getNextPyramid(previous: number): number {
        //Gets the next size from the player's stash.
        //The weirdness comes from size vs. stash index.
        const stash = this.stashes.get(this.currplayer)!;
        if (stash[previous % 3] > 0)
            return previous % 3 + 1;
        else
            return this.getNextPyramid( previous + 1 )
    }

    //TODO: these get called alot; add a list of nulls/roots to the state instead?
    private needNull(): boolean {
        if ( this.variants.includes("martian-go") && this.numplayers < 5 )
            return false;
        const nulls = [...this.board.values()].filter(c => c === "NULL").length;
        return nulls < Math.floor(this.numplayers / 2);
    }

    private needRoot(): boolean {
        const roots = [...this.board.values()].filter(c => c === "ROOT").length;
        return roots < Math.ceil(this.numplayers / 2);
    }

    public parseMove(move: string): IBTTMove {
        //Parse a move into an IBTTMove object.
        //Does only structural validation.
        //Expects at leat a cell.

        //Pretreat.
        move = move.toUpperCase();
        move = move.replace(/\s+/g, "");
     
        //Regexes.
        const illegalChars = /[^A-JLNORSTUW0-9-]/;
        const cellex = /^[a-j][1-9][0-2]?$/;
        const sizex = /^[123]$/;
        const direx = /^[NESW]$/;
        
        const mm: IBTTMove = {
            cell: "",
            incomplete: true,
            valid: false
        }

        //Check for legal characters.
        if (move === "" || illegalChars.test(move)) {
            mm.valid = false;
            return mm;
        }

        const parts = move.split("-");
        //Test for length.
        if (parts.length > 2) {
            mm.valid = false;
            return mm;
        }

        const cell = parts.shift()!.toLowerCase();
        if (! cellex.test(cell) ) {
            //Malformed cell.
            mm.valid = false;
            return mm;
        } else {
            mm.cell = cell;
            mm.valid = true;
        }

        if ( parts.length > 0 ) {
            const pisces = parts.shift();
            if (! pisces || pisces === "") {
                //Malformed piece.
                mm.valid = false;
                return mm;
            } else if ( pisces === "ROOT" || pisces === "NULL" ) {
                mm.piece = pisces;
                mm.incomplete = false;
                return mm;
            } else {
                //Pisces has a length and is not root/null.
                const size = pisces.charAt(0);
                if (! sizex.test(size) ) {
                    //Malformed piece.
                    mm.valid = false;
                    return mm;
                } else {
                    mm.size = Number(size);
                }
                if ( pisces.length > 1 ) {
                    //Pisces has a direction.
                    const dir = pisces.substring(1);
                    mm.direction = dir;
                    mm.incomplete = false;
                    if (! direx.test(dir) ) {
                        //Permit a bad direction for the highlight pyramid.
                        mm.valid = false;
                    }
                    return mm;
                } else {
                    //No direction.
                    mm.incomplete = true;
                    return mm;
                }
            }
        } else {
            //No piece.
            mm.incomplete = true;
            return mm;
        }

        return mm;
    }
    
    public pickleMove(pm: IBTTMove): string {
        if ( ! pm.cell || pm.cell === "" ) {
            throw new Error("Could not pickle the move because it included no cell.");
        }
        
        const move = [pm.cell];
        
        if (pm.piece)
            move.push(pm.piece);
        else if (pm.size) {
            if ( pm.direction )
                move.push(pm.size.toString() + pm.direction);
            else
                move.push(pm.size.toString());
        }
        
        return move.join("-");
    }


    /* end helper functions */

    public moves(player?: playerid): string[] {
        const moves: string[] = [];
        
        if (this.gameover) {
            return moves;
        }
        
        if ( this.needNull() ) {
            
            for (let y = 0; y < this.boardHeight; y++) {
                for (let x = 0; x < this.boardWidth; x++) {
                    const cell = this.coords2algebraic(x, y);
                    if ( this.board.has(cell) )
                        continue;
                    if (! this.checkNull(cell) ) {
                        continue;
                    }
                    moves.push(`${cell}-NULL`);
                }
            }
            return moves;
            
        } else if ( this.needRoot() ) {
            
            for (let y = 0; y < this.boardHeight; y++) {
                for (let x = 0; x < this.boardWidth; x++) {
                    const cell = this.coords2algebraic(x, y);
                    if (! this.board.has(cell) ) {
                        moves.push(`${cell}-ROOT`);
                    }
                }
            }
            return moves;

        } else {

            if (player === undefined)
                player = this.currplayer;
            
            // Normal placement phase
            const stashes = this.stashes.get(player)!;
            const sizes: Size[] = [];

            for (let n = 0; n < 3; n++)
                if (stashes[n] > 0)
                    sizes.push((n + 1) as Size);

            const grid = new RectGrid(this.boardWidth, this.boardHeight);

            for (const [cell, contents] of this.board.entries()) {
                if (contents === "NULL") continue;

                const [x, y] = this.algebraic2coords(cell);

                for (const dir of orthDirections) {

                    const [nx, ny] = RectGrid.move(x, y, dir);
                    if ( grid.inBounds(nx, ny) ) {
                        const nextCell = this.coords2algebraic(nx, ny);
                        if (!this.board.has(nextCell)) {
                            const oppDir = oppositeDirections.get(dir);
                            for (const size of sizes) {
                                moves.push(`${nextCell}-${size}${oppDir}`);
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            //Preliminary move format: cell-NULL|ROOT
            //Preliminary move format: cell|cell|cell-size-direction
            //Final move format: cell-size-direction
            const cell = this.coords2algebraic(col, row);

            let newmove = "";

            if ( this.needNull() ) {
                newmove = `${cell}-NULL`;
            } else if ( this.needRoot() ) {
                newmove = `${cell}-ROOT`;
            } else {
                if (move === "") {
                    // Test if the cell is empty.
                    if ( this.board.has(cell) )
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.btt.OCCUPIED", { cell: cell })
                        }
                    //Else start with the cell and the player's smallest pyramid size.
                    const firstsize = this.getNextPyramid(0);
                    newmove = `${cell}-${firstsize}`;

                    //We always make the user click a direction to show that the pyramid is the intended size.
                    //But we guess the direction for display purposes (see move()).
                } else {
                    const mm = this.parseMove(move);
                    if ( mm.cell === cell ) {
                        // We clicked on the same cell, change pyramid size.
                        const newsize = mm.size ? this.getNextPyramid(mm.size) : 1;
                        mm.size = newsize;
                        //This should work regardless of whether the move was already complete:
                        newmove = this.pickleMove(mm);
                     } else {
                        // We clicked on an adjacent piece (at col, row).
                        const [cx, cy] = this.algebraic2coords(mm.cell);
                        const bearing = RectGrid.bearing(cx, cy, col, row);
                        if (bearing && bearing.length === 2) {
                            return {
                                move,
                                valid: false,
                                message: i18next.t("apgames:validation.btt.NO_DIAGONALS", { cell: cell })
                            }
                        } else if (bearing) {
                            //This should work regardless of whether the move was already complete:
                            mm.direction = bearing;
                            newmove = this.pickleMove(mm);
                        } else {
                            newmove = move; // Do nothing.
                        }
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(mo: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        mo = mo.replace(/\s+/g, "");

        const nn = this.needNull();
        const nr = this.needRoot();

        if (mo.length === 0) {
            result.valid = true;
            result.complete = -1;
            if ( nn )
                result.message = i18next.t("apgames:validation.btt.NULL_INSTRUCTIONS");
            else if ( nr )
                result.message = i18next.t("apgames:validation.btt.ROOT_INSTRUCTIONS");
            else
                result.message = i18next.t("apgames:validation.btt.INITIAL_INSTRUCTIONS");
            return result;
        }

        const m = mo.toLowerCase();

        //First, sanity test.
        const movex = /^[a-j][1-9]?[0-2]?-?([123]?[nesw]?|null|root)?$/;
        if (!movex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.btt.MALFORMED_MOVE", { move: mo });
            return result;
        }
        
        const mm = this.parseMove(m);

        if (! mm.valid ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: mo });
            return result;
        }

        if ( this.board.has(mm.cell) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { cell: mm.cell });
            return result;
        }

        if ( nn ) {
            if (! mm.piece || mm.piece !== "NULL" ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.btt.NULL_INSTRUCTIONS");
                return result;
            } else if (! this.checkNull(mm.cell) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.btt.BAD_NULL");
                return result;                
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else if ( nr ) {
            if (! mm.piece || mm.piece !== "ROOT" ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.btt.ROOT_INSTRUCTIONS");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else if ( mm.piece !== undefined ) {
            //Too unlikely an error for its own message.
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: mo });
            return result;
        }
        
        if (! mm.size ) {
            result.valid = true;
            result.complete = -1;
            //Don't think we can render this case, but it doesn't happen IRL.
            result.message = i18next.t("apgames:validation.btt.PARTIAL_MOVE");
            return result;
        } else {
            const stash = this.stashes.get(this.currplayer)!;
            if ( stash[mm.size - 1] === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.btt.NO_STASH");
                return result;
            }
        }

        if (! mm.direction ) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.btt.PARTIAL_MOVE");
            return result;
        }

        //Now we can check for an appropriate target in the direction.
        const grid = new RectGrid(this.boardWidth, this.boardHeight);

        const [cx, cy] = this.algebraic2coords(mm.cell);
        const [tx, ty] = RectGrid.move(cx, cy, mm.direction as Direction);
        if ( grid.inBounds(tx, ty) ) {
            const tcell = this.coords2algebraic(tx, ty);
            if ( this.board.has(tcell) ) {
                const target = this.board.get(tcell);
                if ( target === "NULL" ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.btt.NULL_TARGET");
                    return result;
                } else {
                    //valid!
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.btt.NO_TARGET");
                return result;
            }
        } else {
            result.valid = false;
            result.message = i18next.t("apgames:validation.btt.OUT_OF_BOUNDS");
            return result;
        }
    }

    public move(m: string, { partial = false, trusted = false } = {}): BTTGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        this.results = [];

        const mm = this.parseMove(m);
        if ( mm.valid === false )
            return this;
        
        if ( mm.piece ) {// "NULL" || "ROOT"
            this.board.set(mm.cell, mm.piece as CellContents);
            this.results.push({ type: "place", where: mm.cell, what: mm.piece });
        } else {
            const size = mm.size as Size;
            if ( mm.direction ) {
                const dir = mm.direction as DirectionCardinal;

                const stash = this.stashes.get(this.currplayer)!;
                stash[size - 1]--;
                this.stashes.set(this.currplayer, stash);
                this.board.set(mm.cell, [this.currplayer, size, dir]);
                this.results.push({ type: "place", where: mm.cell, what: size.toString(), how: dir });

                // Handle pointing penalties
                const grid = new RectGrid(this.boardWidth, this.boardHeight);
                const [cx, cy] = this.algebraic2coords(mm.cell);
                const [px, py] = RectGrid.move(cx, cy, dir);
                
                if ( grid.inBounds(px, py) ) {
                    const pcell = this.coords2algebraic(px, py);
                    const pcontents = this.board.get(pcell);
                    if (pcontents && Array.isArray(pcontents)) {
                        const opponent = pcontents[0];
                        if (opponent !== this.currplayer) {
                            const oppSize = pcontents[1];
                            if (! this.variants.includes("martian-go") ) {
                                this.scores[opponent - 1] += size;
                                this.results.push({ type: "deltaScore", delta: size, who: opponent });
                            }
                            this.scores[this.currplayer - 1] -= oppSize;
                            this.results.push({ type: "deltaScore", delta: -oppSize, who: this.currplayer });
                        }
                    }
                }
            } else {
                //Pick a direction for the highlight.
                this.highlight = deepclone(mm);
                this.highlight!.direction =  this.getNeighborDir(mm.cell);
            }
        }

        if (partial) { return this; }

        this.highlight = undefined;

        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BTTGame {
        const maxPieces = this.numplayers * 16;

        if (this.board.size === maxPieces) {
            this.gameover = true;
        } else if (this.moves().length === 0) {
            this.gameover = true;
        }

        if (this.gameover === true) {
            const maxScore = Math.max(...this.scores);
            for (let i = 0; i < this.numplayers; i++) {
                if (this.scores[i] === maxScore) {
                    this.winner.push((i + 1) as playerid);
                }
            }
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }

        return this;
    }

    public state(): IBTTState {
        return {
            game: BTTGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BTTGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            scores: [...this.scores],
            stashes: deepclone(this.stashes) as Map<playerid, [number, number, number]>
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        let hX = -1;
        let hY = -1;

        if ( this.highlight !== undefined ) {
            [hX, hY] = this.algebraic2coords(this.highlight.cell);
        }
        
        for (let row = 0; row < this.boardHeight; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardWidth; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === "NULL") {
                        pieces.push("X");
                    } else if (contents === "ROOT") {
                        pieces.push("R");
                    } else {
                        const [player, size, dir] = contents;
                        pieces.push("P" + player.toString() + size.toString() + dir);
                    }
                } else if (hX === col && hY === row) {
                    pieces.push("H" + this.highlight!.size + this.highlight!.direction);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const token: [Glyph, ...Glyph[]] =  [
            { name: "piece-borderless", colour: "_context_fill", scale: 0.5 },
            { name: "piece-borderless", colour: "_context_background", scale: 0.3 }
        ]

        const tokens: [Glyph, ...Glyph[]] = [
            {
                name: "piece-square-borderless",
                colour: "_context_background",
                opacity: 0
            }
        ];

        const nudges: [number,number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

        nudges.forEach( nudge => {
            tokens.push({
                name: "piece-borderless",
                colour: "_context_fill",
                scale: 0.5,
                nudge: {
                    dx: nudge[0] * 225,
                    dy: nudge[1] * 225,
                }
            });
            tokens.push({
                name: "piece-borderless",
                colour: "_context_background",
                scale: 0.3,
                nudge: {
                    dx: nudge[0] * 375,
                    dy: nudge[1] * 375,
                }
             });
        });

        const myLegend: ILegendObj = {
            "X": token,
            "R": tokens
        };

        const rotations: Map<string, number> = new Map([
            ["N", 0],
            ["E", 90],
            ["S", 180],
            ["W", -90],
        ]);
        const sizeNames = ["small", "medium", "large"];
        for (let player = 1; player <= this.numplayers; player++) {
            for (const size of [1, 2, 3]) {
                for (const [dir, angle] of rotations.entries()) {
                    const pyraglyph: Glyph = {
                        name: "pyramid-flat-" + sizeNames[size - 1],
                        colour: player,
                        rotate: angle,
                    };
                    myLegend["P" + player.toString() + size.toString() + dir] = pyraglyph;
                }
            }
        }

        if (this.highlight !== undefined) {
            //The shadow pyramid knows...
            myLegend["H" + this.highlight.size!.toString() + this.highlight.direction] = {
                name: "pyramid-flat-" + sizeNames[this.highlight.size! - 1],
                colour: this.currplayer,
                rotate: rotations.has(this.highlight.direction!) ? rotations.get(this.highlight.direction!) : 45,
                opacity: 0.2
            };
        }

        // Build rep
        const rep: APRenderRep = {
            board: {
                style: "squares-checkered",
                width: this.boardWidth,
                height: this.boardHeight,
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations for the last move
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place" || move.type === "move") {
                    const mSafe = move as { where?: string; to?: string };
                    const [x, y] = this.algebraic2coords(mSafe.where || mSafe.to!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Stashes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.stashes.get(n as playerid);
            if (stash) {
                status += `Player ${n}: ${stash[0]} small, ${stash[1]} medium, ${stash[2]} large\n\n`;
            }
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.scores[n - 1];
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: this.scores }]
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const stash = this.stashes.get(player as playerid);
        if (stash !== undefined) {
            return [
                { count: stash[0], glyph: { name: "pyramid-flat-small", colour: player }, movePart: "1" },
                { count: stash[1], glyph: { name: "pyramid-flat-medium", colour: player }, movePart: "2" },
                { count: stash[2], glyph: { name: "pyramid-flat-large", colour: player }, movePart: "3" }
            ];
        }
        return;
    }

    protected getMoveList(): APMoveResult[] {
        return this.getMovesAndResults(["move", "capture", "orient", "eog", "winners"]) as APMoveResult[];
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "deltaScore":
                if ( r.delta === 1 )
                    node.push(i18next.t("apresults:DELTASCORE.btt_opponent_one", {player, delta: r.delta }));
                else if ( r.delta! > 0 )
                    node.push(i18next.t("apresults:DELTASCORE.btt_opponent", {player, delta: r.delta! }));
                else if ( r.delta === -1 )
                    node.push(i18next.t("apresults:DELTASCORE.btt_default_one", {player, delta: r.delta! * -1}));         
                else if ( r.delta! < 0 )
                    node.push(i18next.t("apresults:DELTASCORE.btt_default", {player, delta: r.delta! * -1}));         
                resolved = true;
                break;
        }
        switch (r.type) {
            case "place":
                if (r.what === "1")
                    node.push(i18next.t("apresults:PLACE.btt_small", {player, what: r.what, where: r.where, how: r.how}));
                else if (r.what === "2")
                    node.push(i18next.t("apresults:PLACE.btt_medium", {player, what: r.what, where: r.where, how: r.how}));
                else if (r.what === "3")
                    node.push(i18next.t("apresults:PLACE.btt_large", {player, what: r.what, where: r.where, how: r.how}));
                else
                    node.push(i18next.t("apresults:PLACE.btt", {player, what: r.what!.toLowerCase(), where: r.where, how: r.how}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BTTGame {
        return new BTTGame(this.serialize());
    }
}
