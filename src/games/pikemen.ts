/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export type playerid = 1|2;
export type Size = 1|2|3;
export type Facing = "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"|"U";
export type CellContents = [playerid, Size, Facing];

const orientations = ["N","NE","E","SE","S","SW","W","NW","U"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    scores: number[];
};

export interface IPikemenState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PikemenGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pikemen",
        uid: "pikemen",
        playercounts: [2],
        version: "20211114",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.pikemen")
        description: "apgames:descriptions.pikemen",
        urls: ["http://playagaingames.com/games/pikemen/"],
        people: [
            {
                type: "designer",
                name: "Jacob Davenport",
                urls: ["http://brightestbulb.net/"]
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
                uid: "15pts",
                group: "eog"
            }
        ],
        categories: ["goal>score>race", "mechanic>capture",  "mechanic>move", "mechanic>block", "board>shape>rect", "board>connect>rect", "components>pyramids"],
        flags: ["scores", "perspective"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IPikemenState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: PikemenGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map([
                    ["a8", [2, 3, "U"]], ["b8", [2, 3, "U"]], ["c8", [2, 3, "U"]], ["d8", [2, 2, "U"]], ["e8", [2, 1, "U"]],
                    ["a7", [2, 3, "U"]], ["b7", [2, 2, "U"]], ["c7", [2, 2, "U"]], ["d7", [2, 1, "U"]],
                    ["a6", [2, 3, "U"]], ["b6", [2, 2, "U"]], ["c6", [2, 1, "U"]],
                    ["a5", [2, 2, "U"]], ["b5", [2, 1, "U"]],
                    ["a4", [2, 1, "U"]],
                    ["h1", [1, 3, "U"]], ["g1", [1, 3, "U"]], ["f1", [1, 3, "U"]], ["e1", [1, 2, "U"]], ["d1", [1, 1, "U"]],
                    ["h2", [1, 3, "U"]], ["g2", [1, 2, "U"]], ["f2", [1, 2, "U"]], ["e2", [1, 1, "U"]],
                    ["h3", [1, 3, "U"]], ["g3", [1, 2, "U"]], ["f3", [1, 1, "U"]],
                    ["h4", [1, 2, "U"]], ["g4", [1, 1, "U"]],
                    ["h5", [1, 1, "U"]],
                ]),
                scores: [0, 0]
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "15pts") ) {
                this.variants = ["15pts"];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPikemenState;
            }
            if (state.game !== PikemenGame.gameinfo.uid) {
                throw new Error(`The Pikemen engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PikemenGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        this.results = [...state._results];
        return this;
    }


    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const allmoves: string[] = [];
        const grid = new RectGrid(8, 8);
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player);
        for (const [cell, piece] of pieces) {
            // You're always allowed to do nothing but reorient, so add just the current cell to the move list
            const moves: string[] = [cell];
            const [xStart, yStart] = PikemenGame.algebraic2coords(cell);
            // If you're not facing up, you're also allowed to move/capture
            if (piece[2] !== "U") {
                const ray = grid.ray(xStart, yStart, piece[2]);
                for (const [xNext, yNext] of ray) {
                    const next = PikemenGame.coords2algebraic(xNext, yNext);
                    if (! this.board.has(next)) {
                        moves.push(`${cell}-${next}`);
                    } else {
                        const contents = this.board.get(next);
                        if (contents![0] !== player) {
                            if ( (contents![2] !== "U") || (contents![1] < piece[1]) ) {
                                moves.push(`${cell}x${next}`);
                            }
                        }
                        break;
                    }
                }
            }
            // Now add all possible reorientations to each of the valid moves
            const reos = orientations.filter(o => o !== piece[2]);
            for (const m of moves) {
                // movement/capture moves don't have to reorient if you don't want to
                if (m.length > 2) {
                    allmoves.push(m);
                }
                for (const reo of reos) {
                    allmoves.push(`${m}(${reo})`);
                }
            }
        }

        return allmoves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = PikemenGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                // only if it's your own piece
                if ( (this.board.has(cell)) && (this.board.get(cell)![0] === this.currplayer) ) {
                    // if it's upright, go straight to reorientation
                    if (this.board.get(cell)![2] === "U") {
                        newmove = `${cell}()`;
                    // otherwise, wait for signal
                    } else {
                        newmove = cell;
                    }
                } else {
                    return {move: "", message: ""} as IClickResult;
                }
            } else {
                const [from, to] = move.split(/[-x]/);
                let last = from;
                if (to !== undefined) {
                    last = to;
                }
                // if in reorientation mode
                if (last.endsWith(")")) {
                    const start = move.slice(0, 2);
                    // if clicking on yourself, stand up
                    if (cell === start) {
                        last = `${start}(U)`;
                    } else {
                        const [xStart, yStart] = PikemenGame.algebraic2coords(start);
                        const bearing = RectGrid.bearing(xStart, yStart, col, row)!;
                        last = `${start}(${bearing.toString()})`;
                    }
                }

                // If there is no `to`
                if (to === undefined) {
                    // If we reoriented, we're done
                    if (last.endsWith(")")) {
                        newmove = last;
                    // Otherwise, we must be moving/capturing/reorienting
                    } else {
                        if (cell === last) {
                            newmove = `${last}()`;
                        } else if (! this.board.has(cell)) {
                            newmove = `${last}-${cell}`;
                        } else if (this.board.get(cell)![0] !== this.currplayer) {
                            newmove = `${last}x${cell}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    }

                // If there is a `to`
                } else {
                    // If we reoriented, replace `to` and we're done
                    if (last.endsWith(")")) {
                        if (move.includes("-")) {
                            newmove = `${from}-${last}`;
                        } else {
                            newmove = `${from}x${last}`;
                        }
                    // Otherwise, something is wrong
                    } else {
                        // if you clicked on the target cell, you want to reorient
                        if (cell === to) {
                            newmove = `${move}(U)`;
                        } else {
                            const [xStart, yStart] = PikemenGame.algebraic2coords(to);
                            const bearing = RectGrid.bearing(xStart, yStart, col, row)!;
                            newmove = `${move}(${bearing.toString()})`;
                        }
                    }
                }
            }
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pikemen.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [from, to] = m.split(/[-x]/);
        const fromCell = from.slice(0, 2);
        // valid cell
        try {
            PikemenGame.algebraic2coords(fromCell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: fromCell});
            return result;
        }
        // cell is occupied
        if (! this.board.has(fromCell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: fromCell});
            return result;
        }
        // piece is yours
        if (this.board.get(fromCell)![0] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // just a reorientation or partial
        if (to === undefined) {
            // complete reorientation
            if ( (from.endsWith(")")) && (! from.endsWith("()")) ) {
                // valid facing
                const match = from.match(/\(([NESWU]+)\)$/);
                if ( (match === null) || (! orientations.includes(match[1])) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pikemen.BAD_FACING", {segment: from});
                    return result;
                }
                const facing = match[1] as Facing;
                // facing is different than existing
                if (facing === this.board.get(fromCell)![2]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pikemen.USELESS_ORIENTATION");
                    return result;
                }

                // we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            // partial
            } else {
                if (from.endsWith("()")) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.pikemen.PARTIAL_ORIENT");
                    return result;
                } else {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.pikemen.PARTIAL_PREMOVE");
                    return result;
                }
            }

        // movement/capture, possibly partial
        } else {
            const toCell = to.slice(0, 2);
            // valid cell
            try {
                PikemenGame.algebraic2coords(toCell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: toCell});
                return result;
            }
            // piece isn't upright
            const facing = this.board.get(fromCell)![2];
            if (facing === "U") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pikemen.UPRIGHT_MOVEMENT");
                return result;
            }
            // piece can see the target cell
            const grid = new RectGrid(8, 8);
            const ray = grid.ray(...PikemenGame.algebraic2coords(fromCell), facing as Direction).map(pt => PikemenGame.coords2algebraic(...pt));
            if (! ray.includes(toCell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOLOS", {from: fromCell, to: toCell});
                return result;
            }
            // no obstructions
            for (const cell of ray) {
                if (cell === toCell) {break;}
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: fromCell, to: toCell, obstruction: cell});
                    return result;
                }
            }
            // target isn't yours
            const contents = this.board.get(toCell);
            if ( (contents !== undefined) && (contents[0] === this.currplayer) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                return result;
            }
            // correct operator was used
            if ( (m.includes("-")) && (this.board.has(toCell)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: toCell});
                return result;
            }
            if ( (m.includes("x")) && (! this.board.has(toCell)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: toCell});
                return result;
            }
            // if capture, check legality
            if (m.includes("x")) {
                if (contents![2] === "U") {
                    if (this.board.get(fromCell)![1] <= contents![1]) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pikemen.TOOSMALL");
                        return result;
                    }
                }
            }

            // we're good
            // if contains reorientation, we're completely done
            if (m.endsWith(")")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            // otherwise, give partial message and `complete` 0
            } else {
                result.valid = true;
                result.complete = 0;
                result.message = i18next.t("apgames:validation.pikemen.PARTIAL_FINAL");
                return result;
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): PikemenGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/\([a-z]+\)$/, (match) => {return match.toUpperCase();});
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // if ( (! partial) && (! this.moves().includes(m)) ) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        const [move, reo] = m.split("(");
        let target = move;
        // check for movement/capture first
        if (move.length > 2) {
            const [from, to] = move.split(/[-x]/);
            const fContents = this.board.get(from);
            this.results.push({type: "move", what: fContents![1].toString(), from, to});
            if (this.board.has(to)) {
                const tContents = this.board.get(to);
                this.scores[this.currplayer - 1] += tContents![1];
                this.results.push(
                    {type: "capture", what: tContents![1].toString(), where: to},
                    {type: "deltaScore", delta: tContents![1]}
                )
            }
            this.board.delete(from);
            this.board.set(to, [...fContents!])
            target = to;
        }
        // Now reorient
        if ( (reo !== undefined) && (reo !== "") ) {
            const dir = reo.slice(0, reo.length - 1);
            const contents = this.board.get(target);
            contents![2] = dir as Facing;
            this.results.push({type: "orient", where: target, facing: dir});
        }

        if (partial) { return this; }

        // update currplayer
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

    protected checkEOG(): PikemenGame {
        let target = 12;
        if (this.variants.includes("15pts")) {
            target = 15;
        }
        if ( (this.scores[0] >= target) || (this.scores[1] >= target)) {
            this.gameover = true;
            if (this.scores[0] > this.scores[1]) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IPikemenState {
        return {
            game: PikemenGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PikemenGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            scores: [...this.scores]
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = PikemenGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    let owner = "X";
                    if (contents[0] === 2) {
                        owner = "Y";
                    }
                    pieces.push(owner + contents[1].toString() + contents[2]);
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\n,{7}\n/g, "\n_\n");

        const myLegend: ILegendObj = {};
        const rotations: Map<string, number> = new Map([
            ["N", 0],
            ["NE", 45],
            ["E", 90],
            ["SE", 135],
            ["S", 180],
            ["SW", -135],
            ["W", -90],
            ["NW", -45],
        ]);
        const playerNames = ["X", "Y"];
        const sizeNames = ["small", "medium", "large"]
        for (const player of [1, 2]) {
            for (const size of [1, 2, 3]) {
                for (const dir of rotations.entries()) {
                    // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
                    const node: Glyph = {
                        name: "pyramid-flat-" + sizeNames[size - 1],
                        colour: player,
                        rotate: dir[1],
                    };
                    myLegend[playerNames[player - 1] + size.toString() + dir[0]] = node;
                }
                const node: Glyph = {
                    name: "pyramid-up-" + sizeNames[size - 1],
                    colour: player,
                };
                myLegend[playerNames[player - 1] + size.toString() + "U"] = node;
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = PikemenGame.algebraic2coords(move.from);
                    const [toX, toY] = PikemenGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = PikemenGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
            // Only if there were no moves or captures do I want to signal a reorientation
            if (rep.annotations.length === 0) {
                for (const move of this.results) {
                    if (move.type === "orient") {
                        const [x, y] = PikemenGame.algebraic2coords(move.where!);
                        rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                    }
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

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture", "orient", "eog", "winners"]);
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public clone(): PikemenGame {
        return new PikemenGame(this.serialize());
    }
}
