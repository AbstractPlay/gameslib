import { Direction, Grid, rectangle, defineHex, Orientation } from "honeycomb-grid";
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, shuffle } from "../common";
import i18next from "i18next";
import { generateField, IHexCoord } from "../common/hexes";
import { ModularBoard } from "../common/modular/board";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

type playerid = 1|2;
type CellContents = 1|2|3|4|5|6|7;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    pawnPos: string|undefined;
    lastmove?: string;
    captured: [CellContents[], CellContents[]];
}

export interface ITintasState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    startpos: string;
    // only needed for the modular board
    ctrs?: IHexCoord[];
};

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

const myHex = defineHex({
    offset: 1,
    orientation: Orientation.FLAT
});
const hexGrid = new Grid(myHex, rectangle({width: 9, height: 8}));
const allHexDirs = [Direction.N, Direction.NE, Direction.SE, Direction.S, Direction.SW, Direction.NW];

export class TintasGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Tintas",
        uid: "tintas",
        playercounts: [2],
        version: "20230627",
        dateAdded: "2023-07-01",
        // i18next.t("apgames:descriptions.tintas")
        description: "apgames:descriptions.tintas",
        urls: [
            "https://spielstein.com/games/tintas/rules",
            "https://boardgamegeek.com/boardgame/207951/tintas",
        ],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                apid: "e7f53920-5be9-406a-9d5c-baa0316ab4f4",
                urls: ["https://spielstein.com/"]
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
                uid: "modular",
                group: "board",
            }
        ],
        categories: ["goal>set", "mechanic>set",  "mechanic>move", "mechanic>share", "mechanic>random>setup", "board>shape>other", "board>connect>hex", "components>simple>7c"],
        flags: ["check", "pie", "automove", "shared-pieces", "random-start", "custom-rotation"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return columnLabels[8 - y - 1] + (x + 1).toString();
    }

    public static algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const y = columnLabels.indexOf(pair[0]);
        if ( (y === undefined) || (y < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const x = parseInt(num, 10);
        if ( (x === undefined) || (isNaN(x)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x - 1, 8 - y - 1];
    }

    public static blockedCells: string[] = ["h1","h2","h6","h8","h9","g1","g2","g9","f9","d1","c1","c9","b1","b8","b9","a1","a2","a3","a4","a5","a7","a8","a9"];

    public static colourNames: string[] = ["RED", "BLUE", "GREEN", "YELLOW", "PURPLE", "ORANGE", "BROWN"];

    /**
     * Returns a list of algebraic cells from a starting cell in a given direction.
     * Does not include the starting cell, and stops at the edge of the board.
     *
     * @static
     * @param {string} from
     * @param {Direction} dir
     * @returns {string[]}
     * @memberof TintasGame
     */
    public static castRay(from: string, dir: Direction): string[] {
        const ray: string[] = [];

        const [col, row] = TintasGame.algebraic2coords(from);
        let fHex = hexGrid.getHex({row, col})!;
        let nHex = hexGrid.neighborOf(fHex, dir, {allowOutside: false});
        while (nHex !== undefined) {
            const nCell = TintasGame.coords2algebraic(nHex.col, nHex.row);
            if (TintasGame.blockedCells.includes(nCell)) {
                break;
            }
            ray.push(nCell);
            fHex = nHex;
            nHex = hexGrid.neighborOf(fHex, dir, {allowOutside: false});
        }
        return ray;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public pawnPos: string|undefined;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;
    public captured!: [CellContents[],CellContents[]];
    public ctrs?: IHexCoord[];
    private tboard?: ModularBoard = new ModularBoard();

    constructor(state?: ITintasState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITintasState;
            }
            if (state.game !== TintasGame.gameinfo.uid) {
                throw new Error(`The Tintas game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.startpos = state.startpos;
            this.variants = [...state.variants];
            this.ctrs = deepclone(state.ctrs) as IHexCoord[]|undefined;
        } else {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const bag = shuffle("1111111222222233333334444444555555566666667777777".split("").map(n => parseInt(n, 10) as CellContents)) as CellContents[];
            this.startpos = bag.join("");
            const board: Map<string, CellContents> = new Map<string, CellContents>();
            if (this.variants.includes("modular")) {
                this.ctrs = generateField(7);
                const tboard = new ModularBoard({centres: this.ctrs, orientation: Orientation.FLAT});
                const cells = tboard.hexesOrdered.flat().map(h => tboard.hex2algebraic(h));
                for (let i = 0; i < cells.length; i++) {
                    const pc = bag.pop();
                    if (pc === undefined) {
                        throw new Error(`Not enough pieces for the board!`);
                    }
                    board.set(cells[i], pc)
                }
            } else {
                for (let y = 0; y < 8; y++) {
                    for (let x = 0; x < 9; x++) {
                        const cell = TintasGame.coords2algebraic(x, y);
                        if (TintasGame.blockedCells.includes(cell)) {
                            continue;
                        }
                        const piece = bag.pop()!;
                        board.set(cell, piece);
                    }
                }
            }
            if (bag.length !== 0) {
                throw new Error("There are still pieces in the bag! This should never happen!");
            }
            const fresh: IMoveState = {
                _version: TintasGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pawnPos: undefined,
                captured: [[],[]],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): TintasGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.pawnPos = state.pawnPos;
        this.captured = [[...state.captured[0]], [...state.captured[1]]];
        if (this.ctrs !== undefined) {
            this.tboard = new ModularBoard({centres: this.ctrs, orientation: Orientation.FLAT});
        }
       return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) {return [];}

        const moves: string[] = [];

        // if no pawn, place it anywhere
        if (this.pawnPos === undefined) {
            if (this.variants.includes("modular")) {
                const cells = this.tboard!.hexes.map(h => this.tboard!.hex2algebraic(h));
                cells.forEach(cell => moves.push(cell));
            } else {
                for (let y = 0; y < 8; y++) {
                    for (let x = 0; x < 9; x++) {
                        const cell = TintasGame.coords2algebraic(x, y);
                        if (! TintasGame.blockedCells.includes(cell)) {
                            moves.push(cell);
                        }
                    }
                }
            }
        }
        // otherwise cast rays
        else {
            const toExplore: string[] = this.findMoves().map(to => `${this.pawnPos!}-${to}`);
            while (toExplore.length > 0) {
                const sofar = toExplore.pop()!;
                moves.push(sofar);
                const cells = sofar.split("-");
                const colour = this.board.get(cells[1])!;
                const cloned = this.clone();
                for (const cell of cells) {
                    cloned.board.delete(cell);
                }
                cloned.pawnPos = cells[cells.length - 1];
                toExplore.push(...cloned.findMoves(colour).map(to => `${sofar}-${to}`));
            }
        }

        // if no moves available, then move to any occupied spot
        if (moves.length === 0) {
            moves.push(...[...this.board.keys()].map(to => `${this.pawnPos!}-${to}`));
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public findMoves(colour?:CellContents): string[] {
        const moves: string[] = [];
        let castRay = TintasGame.castRay;
        if (this.variants.includes("modular")) {
            castRay = this.tboard!.castRay.bind(this.tboard);
        }

        for (const dir of allHexDirs) {
            const ray = castRay(this.pawnPos!, dir);
            let next: string|undefined;
            for (const cell of ray) {
                if (this.board.has(cell)) {
                    next = cell;
                    break;
                }
            }
            if (next !== undefined) {
                const contents = this.board.get(next)!;
                if ( (colour !== undefined) && (contents !== colour) ) {
                    continue;
                }
                moves.push(next);
            }
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        let coords2algebraic = TintasGame.coords2algebraic;
        if (this.variants.includes("modular")) {
            coords2algebraic = this.tboard!.graph.coords2algebraic.bind(this.tboard!.graph);
        }
        try {
            const cell = coords2algebraic(col, row);
            let newmove = "";

            if (move.length === 0) {
                // if there is no pawn, assume you're placing it
                if (this.pawnPos === undefined) {
                    newmove = cell;
                } else {
                    // if you've clicked on the pawn, seed the move
                    if (this.pawnPos === cell) {
                        newmove = cell;
                    }
                    // otherwise, just assume you're moving
                    else {
                        newmove = `${this.pawnPos}-${cell}`;
                    }
                }
            } else {
                newmove = move + `-${cell}`;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        let algebraic2coords = TintasGame.algebraic2coords;
        if (this.variants.includes("modular")) {
            algebraic2coords = this.tboard!.graph.algebraic2coords.bind(this.tboard!.graph);
        }
        let castRay = TintasGame.castRay;
        if (this.variants.includes("modular")) {
            castRay = this.tboard!.castRay.bind(this.tboard);
        }
        let blockedCells = TintasGame.blockedCells;
        if (this.variants.includes("modular")) {
            blockedCells = this.tboard!.blockedCells;
        }

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            if (this.pawnPos === undefined) {
                result.message = i18next.t("apgames:validation.tintas.INITIAL_INSTRUCTIONS", {context: "needpawn"});
            } else {
                result.message = i18next.t("apgames:validation.tintas.INITIAL_INSTRUCTIONS", {context: "movepawn"});
            }
            return result;
        }

        if (this.pawnPos === undefined) {
            // move must be a valid cell
            try {
                algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            if (blockedCells.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }

            // don't need to check if space is occupied
            if (! this.board.has(m)) {
                throw new Error("Trying to place the pawn on an empty space.");
            }

            // valid move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const cells = m.split("-");

        // first cell must be the pawn location
        if (cells[0] !== this.pawnPos) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tintas.PAWN_START");
            return result;
        }

        // if only the pawn is indicated, it's a valid partial
        if (cells.length === 1) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }

        // check for rare occurrence of no visible pieces
        let canSee = false;
        for (const dir of allHexDirs) {
            const ray = castRay(this.pawnPos, dir);
            for (const r of ray) {
                if (this.board.has(r)) {
                    canSee = true;
                    break;
                }
            }
            if (canSee) { break; }
        }

        if (! canSee) {
            // target cell is valid
            try {
                algebraic2coords(cells[1])
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: cells[1]});
                return result;
            }
            // target is occupied
            if (! this.board.has(cells[1])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED_MOVE");
                return result;
            }

            // valid, complete move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const cloned = this.clone();
        let lastPiece: CellContents|undefined;
        for (const cell of cells.slice(1)) {
            // cell is valid
            try {
                algebraic2coords(cell)
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            const ray = this.findRay(cloned.pawnPos!, cell);
            // is there a straightline connection at all
            if (ray.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tintas.STRAIGHT_LINE", {from: cloned.pawnPos, to: cell});
                return result;
            }
            // are all intervening spaces empty
            for (const r of ray) {
                if (r === cell) { break; }
                if (cloned.board.has(r)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: cloned.pawnPos, to: cell, obstruction: r});
                    return result;
                }
            }
            // target cell has a piece
            if (! this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tintas.OCCUPIED_MOVE");
                return result;
            }
            // if a piece has already been collected this move, make sure the next one is the same
            const contents = this.board.get(cell)!
            if ( (lastPiece !== undefined) && (contents !== lastPiece) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tintas.SAME_COLOUR");
                return result;
            }

            // execute the move and validate the next cell
            cloned.pawnPos = cell;
            lastPiece = contents;
            cloned.board.delete(cell);
        } // foreach move

        // determine if more moves are possible
        // at this point, `cloned` is up to date
        let complete: 0|1|-1|undefined = 1;
        for (const dir of allHexDirs) {
            const ray = castRay(cloned.pawnPos!, dir);
            for (const r of ray) {
                if (cloned.board.has(r)) {
                    const contents = cloned.board.get(r)!;
                    if ( (lastPiece !== undefined) && (lastPiece === contents) ) {
                        complete = 0;
                    }
                    break;
                }
            }
            if (complete === 0) { break; }
        }

        // looks good!
        result.valid = true;
        result.complete = complete;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * If `to` is visible from `from`, returns the straightline path.
     * Does not include the starting cell.
     * Returns empty array if no line of sight.
     *
     * @param {string} from
     * @param {string} to
     * @returns {string[]}
     * @memberof TintasGame
     */
    public findRay(from: string, to: string): string[] {
        let castRay = TintasGame.castRay;
        if (this.variants.includes("modular")) {
            castRay = this.tboard!.castRay.bind(this.tboard);
        }
        for (const dir of allHexDirs) {
            const ray = castRay(from, dir);
            if (ray.includes(to)) {
                return ray;
            }
        }
        return [];
    }

    public move(m: string, {partial = false, trusted = false} = {}): TintasGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }

            // all partial moves should still be in the move list
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        // check for pawn placement
        if (this.pawnPos === undefined) {
            this.pawnPos = m;
            this.results.push({type: "place", where: m});
            const contents = this.board.get(m)!;
            this.captured[this.currplayer - 1].push(contents);
            this.results.push({type: "capture", "what": TintasGame.colourNames[contents - 1], where: m});
            this.board.delete(m);
        }
        // normal movement
        else {
            const moves = m.split("-");
            for (let i = 1; i < moves.length; i++) {
                const from = moves[i-1];
                const to = moves[i];
                const contents = this.board.get(to)!;
                this.results.push({type: "move", from, to});
                this.results.push({type: "capture", what: TintasGame.colourNames[contents - 1], where: to});
                this.captured[this.currplayer - 1].push(contents);
                this.board.delete(to);
                this.pawnPos = to;
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public isSevenPossible(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        for (const colour of [1,2,3,4,5,6,7] as CellContents[]) {
            if (! this.captured[player % 2].includes(colour)) {
                return true;
            }
        }
        return false;
    }

    public hasSeven(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        for (const colour of [1,2,3,4,5,6,7] as CellContents[]) {
            const filtered = this.captured[player - 1].filter(n => n === colour);
            if (filtered.length === 7) {
                return true;
            }
        }
        return false;
    }

    public hasFourOfFour(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        let numFour = 0;
        for (const colour of [1,2,3,4,5,6,7] as CellContents[]) {
            const filtered = this.captured[player - 1].filter(n => n === colour);
            if (filtered.length >= 4) {
                numFour++;
            }
        }
        if (numFour >= 4) {
            return true;
        }
        return false;
    }

    protected checkEOG(): TintasGame {
        const hasSeven1 = this.hasSeven(1);
        const hasSeven2 = this.hasSeven(2);
        const canSeven1 = this.isSevenPossible(1);
        const canSeven2 = this.isSevenPossible(2);
        if (hasSeven1 || hasSeven2) {
            this.gameover = true;
            if (hasSeven1) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
        } else if ( (! canSeven1) || (! canSeven2) ) {
            const hasFour1 = this.hasFourOfFour(1);
            const hasFour2 = this.hasFourOfFour(2);
            if ( (hasFour1 && (! canSeven2)) || (hasFour2 && (! canSeven1)) ) {
                this.gameover = true;
                if (hasFour1) {
                    this.winner = [1];
                } else {
                    this.winner = [2];
                }
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

    public state(): ITintasState {
        return {
            game: TintasGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            startpos: this.startpos,
            ctrs: deepclone(this.ctrs) as IHexCoord[]|undefined,
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: TintasGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            pawnPos: this.pawnPos,
            captured: [[...this.captured[0]],[...this.captured[1]]],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        const letters = "ABCDEFG";
        let height = 8;
        let width = 9;
        let blockedCells = TintasGame.blockedCells;
        let coords2algebraic = TintasGame.coords2algebraic;
        let algebraic2coords = TintasGame.algebraic2coords;
        // let style: "hex-even-f" | "hex-odd-f" = "hex-odd-f";
        if (this.variants.includes("modular")) {
            height = this.tboard!.height;
            width = this.tboard!.width;
            blockedCells = this.tboard!.blockedCells;
            coords2algebraic = this.tboard!.graph.coords2algebraic.bind(this.tboard!.graph);
            algebraic2coords = this.tboard!.graph.algebraic2coords.bind(this.tboard!.graph);
            // if (this.tboard!.graph.offset === 1) {
            //      style = "hex-even-f";
            // }
        }
        for (let row = 0; row < height; row++) {
            const node: string[] = [];
            for (let col = 0; col < width; col++) {
                const cell = coords2algebraic(col, row);
                if ( (blockedCells.includes(cell)) || (! this.board.has(cell)) ) {
                    node.push("-");
                } else if (this.board.has(cell)) {
                    const colour = this.board.get(cell)!;
                    node.push(letters[colour - 1]);
                }
            }
            pieces.push(node);
        }
        const pstr: string = pieces.map(r => r.join("")).join("\n");
        // pstr = pstr.replace(/-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-even-f",
                width,
                height,
                blocked: blockedCells.map(hex => algebraic2coords(hex)).map(([col, row]) => ({row, col})) as [RowCol, ...RowCol[]],
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
                C: {
                    name: "piece",
                    colour: 3
                },
                D: {
                    name: "piece",
                    colour: 4
                },
                E: {
                    name: "piece",
                    colour: 5
                },
                F: {
                    name: "piece",
                    colour: 6
                },
                G: {
                    name: "piece",
                    colour: 7
                },
                X: {
                    name: "chess-queen-outline-montreal",
                    colour: "_context_strokes"
                },
            },
            pieces: pstr
        };

        if (this.pawnPos !== undefined) {
            const [col, row] = algebraic2coords(this.pawnPos);
            (rep.board as BoardBasic).markers = [{
                type: "glyph",
                glyph: "X",
                points: [{row, col}],
            }];
        }

        rep.areas = [];
        for (const player of [1,2] as playerid[]) {
            if (this.captured[player - 1].length > 0) {
                // Put any inhand pieces in the bar
                const captured = this.captured[player - 1].sort((a,b) => a - b).map(n => letters[n - 1]);
                rep.areas.push({
                    type: "pieces",
                    pieces: [...captured] as [string, ...string[]],
                    label: i18next.t("apgames:validation.tintas.CAPTURED_LABEL", {playerNum: player}) || "local"
                });
            }
        }
        if (rep.areas.length === 0) {
            delete rep.areas;
        }

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = algebraic2coords(move.from);
                    const [toX, toY] = algebraic2coords(move.to);
                    rep.annotations.push({type: "move", arrow: false, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public inCheck(): number[] {
        const checked: number[] = [];
        for (const p of [1,2] as playerid[]) {
            let otherPlayer: playerid = 1;
            if (p === 1) {
                otherPlayer = 2;
            }
            const moves = this.moves(otherPlayer);
            for (const m of moves) {
                const cloned = this.clone();
                cloned.currplayer = otherPlayer;
                cloned.move(m, {trusted: true});
                if ( (cloned.gameover) && (cloned.winner.includes(otherPlayer)) ) {
                    checked.push(p);
                    break;
                }
            }
        }
        return checked;
    }

    public getStartingPosition(): string {
        if ( (this.startpos !== undefined) && (this.startpos.length > 0) ) {
            return this.startpos;
        }
        let height = 8;
        let width = 9;
        let blockedCells = TintasGame.blockedCells;
        let coords2algebraic = TintasGame.coords2algebraic;
        if (this.variants.includes("modular")) {
            height = this.tboard!.height;
            width = this.tboard!.width;
            blockedCells = this.tboard!.blockedCells;
            coords2algebraic = this.tboard!.graph.coords2algebraic.bind(this.tboard!.graph);
        }
        const board = this.stack[0].board;
        const colours = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const cell = coords2algebraic(x, y);
                if (blockedCells.includes(cell)) {
                    continue;
                }
                colours.push(board.get(cell)!);
            }
        }
        return colours.join("");
    }

    public getCustomRotation(): number | undefined {
        return 0;
    }

    public clone(): TintasGame {
        return new TintasGame(this.serialize());
    }
}
