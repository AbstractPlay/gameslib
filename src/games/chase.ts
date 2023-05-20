/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Direction, Grid, rectangle, defineHex, Orientation, Hex } from "honeycomb-grid";
import { GameBase, IAPGameState, IClickResult, IIndividualState, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;
type Speed = 1|2|3|4|5|6;
type CellContents = [playerid, Speed];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface IChaseState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface IVector {
    vector: [number, number][];
    finalDir: Direction;
}

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
// const hexDirs = ["NE", "E", "SE", "SW", "W", "NW"];

const string2dir = (dir: string): Direction|undefined => {
    dir = dir.toUpperCase();
    switch (dir) {
        case "NE":
            return Direction.NE;
        case "E":
            return Direction.E;
        case "SE":
            return Direction.SE;
        case "SW":
            return Direction.SW;
        case "W":
            return Direction.W;
        case "NW":
            return Direction.NW;
        default:
            return undefined;
    }
}

const dir2string = (dir: Direction): string|undefined => {
    switch (dir) {
        case Direction.NE:
            return "NE";
        case Direction.E:
            return "E";
        case Direction.SE:
            return "SE";
        case Direction.SW:
            return "SW";
        case Direction.W:
            return "W";
        case Direction.NW:
            return "NW";
        default:
            return undefined;
    }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const myHex = defineHex({
    offset: 1,
    orientation: Orientation.POINTY
});
const hexGrid = new Grid(myHex, rectangle({width: 9, height: 9}));
const leftDirs: Map<Direction, Direction> = new Map([
    [Direction.SW, Direction.E],
    [Direction.W, Direction.SE],
    [Direction.NW, Direction.S],
    [Direction.NE, Direction.W],
    [Direction.E, Direction.NW],
    [Direction.SE, Direction.NE]
]);
const rightDirs: Map<Direction, Direction> = new Map([
    [Direction.SW, Direction.NW],
    [Direction.W, Direction.NE],
    [Direction.NW, Direction.E],
    [Direction.NE, Direction.SE],
    [Direction.E, Direction.SW],
    [Direction.SE, Direction.W]
]);
const chamberExits: Map<Direction, [string, string]> = new Map([
    [Direction.SW, ["e6", "f5"]],
    [Direction.W, ["d6", "f6"]],
    [Direction.NW, ["d5", "e6"]],
    [Direction.NE, ["e4", "d6"]],
    [Direction.E, ["f5", "d5"]],
    [Direction.SE, ["f6", "e4"]]
]);

export class ChaseGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Chase",
        uid: "chase",
        playercounts: [2],
        version: "20211009",
        // i18next.t("apgames:descriptions.chase")
        description: "apgames:descriptions.chase",
        urls: ["https://en.wikipedia.org/wiki/Chase_(board_game)", "https://boardgamegeek.com/boardgame/316/chase"],
        people: [
            {
                type: "designer",
                name: "Tom Krusezewski"
            },
            {
                type: "publisher",
                name: "TSR"
            }
        ],
        flags: ["perspective"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return columnLabels[9 - y - 1] + (x + 1).toString();
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
        return [x - 1, 9 - y - 1];
    }

    /**
     * Returns the list of hexes a piece would pass through from the given start space,
     * in the given direction, at the given speed. Takes into consideration wraparound and richochets.
     * Does not include the start cell in the returned list, nor does it do any validation.
     * The `moves` function has to make sure the movement rules are ultimately followed.
     *
     * @private
     * @param {number} x
     * @param {number} y
     * @param {Direction} dir
     * @param {number} distance
     * @returns {[number, number][]}
     * @memberof ChaseGame
     */
     public static vector(x: number, y: number, dir: Direction, distance = 1): IVector {
        // if (! hexDirs.includes(dir)) {
            // throw new Error(`Invalid direction passed for a pointy hex: ${dir}`);
        if (dir === undefined) {
            throw new Error(`Undefined direction passed.`);
        }
        if ( (x < 0) || (x >= 9) || (y < 0) || (y >= 9) ) {
            throw new Error(`Invalid coordinates for a Chase board: ${x},${y}`);
        }
        if ( (distance < 0) || (distance > 6) ) {
            throw new Error(`Invalid distance for a Chase game: ${distance}`);
        }
        const cells: [number, number][] = [];
        let hex = hexGrid.getHex({col: x, row: y});
        if (hex === undefined) {
            throw new Error(`Invalid starting hex ${x},${y}`);
        }
        while (distance > 0) {
            // First use the library to find a neighbour
            // If it's valid, we're good.
            const neighbour: Hex|undefined = hexGrid.neighborOf(hex, dir, { allowOutside: false });
            if (neighbour !== undefined) {
                hex = neighbour;
                cells.push([hex.col, hex.row]);
            // Otherwise, check for richochet (have to check for richochet before wraparound or things break)
            } else if ( (hex.row === 0) && (dir === Direction.NE) ) {
                hex = hexGrid.getHex({col: (hex.col + 1) % 9, row: hex.row + 1});
                if (hex === undefined) {
                    throw new Error("Error calculating richochet NE from row 0.");
                }
                cells.push([hex.col, hex.row]);
                dir = Direction.SE;
            } else if ( (hex.row === 0) && (dir === Direction.NW) ) {
                hex = hexGrid.getHex({col: hex.col, row: hex.row + 1});
                if (hex === undefined) {
                    throw new Error("Error calculating richochet NW from row 0.");
                }
                cells.push([hex.col, hex.row]);
                dir = Direction.SW;
            } else if ( (hex.row === 8) && (dir === Direction.SE) ) {
                hex = hexGrid.getHex({col: (hex.col + 1) % 9, row: hex.row - 1});
                if (hex === undefined) {
                    throw new Error("Error calculating richochet SE from row 8.");
                }
                cells.push([hex.col, hex.row]);
                dir = Direction.NE;
            } else if ( (hex.row === 8) && (dir === Direction.SW) ) {
                hex = hexGrid.getHex({col: hex.col, row: hex.row - 1});
                if (hex === undefined) {
                    throw new Error("Error calculating richochet SW from row 8.");
                }
                cells.push([hex.col, hex.row]);
                dir = Direction.NW;
            // Then check for wraparound
            } else if ( (hex.col === 0) && (dir === Direction.W) ) {
                hex = hexGrid.getHex({col: 8, row: hex.row});
                if (hex === undefined) {
                    throw new Error("Error calculating wraparound W from column 0.");
                }
                cells.push([hex.col, hex.row])
            } else if ( (hex.col === 0) && (dir === Direction.NW) ) {
                hex = hexGrid.getHex({col: 8, row: hex.row - 1});
                if (hex === undefined) {
                    throw new Error("Error calculating wraparound NW from column 0.");
                }
                cells.push([hex.col, hex.row])
            } else if ( (hex.col === 0) && (dir === Direction.SW) ) {
                hex = hexGrid.getHex({col: 8, row: hex.row + 1});
                if (hex === undefined) {
                    throw new Error("Error calculating wraparound SW from column 0.");
                }
                cells.push([hex.col, hex.row])
            } else if ( (hex.col === 8) && (dir === Direction.E) ) {
                hex = hexGrid.getHex({col: 0, row: hex.row});
                if (hex === undefined) {
                    throw new Error("Error calculating wraparound E from column 8.");
                }
                cells.push([hex.col, hex.row]);
            } else if ( (hex.col === 8) && (dir === Direction.NE) ) {
                hex = hexGrid.getHex({col: 0, row: hex.row - 1});
                if (hex === undefined) {
                    throw new Error("Error calculating wraparound NE from column 8.");
                }
                cells.push([hex.col, hex.row]);
            } else if ( (hex.col === 8) && (dir === Direction.SE) ) {
                hex = hexGrid.getHex({col: 0, row: hex.row + 1});
                if (hex === undefined) {
                    throw new Error("Error calculating wraparound SE from column 8.");
                }
                cells.push([hex.col, hex.row]);
            } else {
                throw new Error(`Something went horribly wrong while calculating a movement vector. This should never happen.\nStart: ${x},${y}, Curr: ${hex.toString()}, Dir: ${dir}, Distance: ${distance}`);
            }
            distance--;
        }
        return {
            vector: cells,
            finalDir: dir
        };
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];

    constructor(state?: IChaseState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IChaseState;
            }
            if (state.game !== ChaseGame.gameinfo.uid) {
                throw new Error(`The Chase game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: ChaseGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map([
                    ["a1", [1, 1]],
                    ["a2", [1, 2]],
                    ["a3", [1, 3]],
                    ["a4", [1, 4]],
                    ["a5", [1, 5]],
                    ["a6", [1, 4]],
                    ["a7", [1, 3]],
                    ["a8", [1, 2]],
                    ["a9", [1, 1]],
                    ["i1", [2, 1]],
                    ["i2", [2, 2]],
                    ["i3", [2, 3]],
                    ["i4", [2, 4]],
                    ["i5", [2, 5]],
                    ["i6", [2, 4]],
                    ["i7", [2, 3]],
                    ["i8", [2, 2]],
                    ["i9", [2, 1]],
                ])
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): ChaseGame {
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
       return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) {return [];}

        const moves: string[] = [];

        // Balancing moves always first
        const balanceMoves: string[][] = this.recurseBalance(player);

        if (balanceMoves.length > 0) {
            // For each balance move, execute it and then check for other moves
            for (const balances of balanceMoves) {
                const cloned: ChaseGame = Object.assign(new ChaseGame(), deepclone(this) as ChaseGame);
                const playerPieces = [...cloned.board.entries()].filter(e => e[1][0] === player);
                const speed: number = playerPieces.map(p => p[1][1] as number).reduce((a, b) => a + b);
                let delta  = 25 - speed;
                for (const cell of balances) {
                    const piece = cloned.board.get(cell);
                    if (piece![1] + delta > 6) {
                        delta -= 6 - piece![1];
                        piece![1] = 6;
                    } else {
                        piece![1] += delta;
                        delta = 0;
                    }
                }
                const bstr = "{" + balances.join(",") + "}";
                moves.push(...cloned.movesExchanges(player).map(m => bstr + m));
                moves.push(...cloned.movesMoves(player).map(m => bstr + m));
            }
        } else {
            // If speed is not 25, then we're done
            const playerPieces = [...this.board.entries()].filter(e => e[1][0] === player).sort((a, b) => a[1][1] - b[1][1]);
            const speed: number = playerPieces.map(p => p[1][1] as number).reduce((a, b) => a + b);
            if (speed === 25) {
                moves.push(...this.movesExchanges(player));
                moves.push(...this.movesMoves(player));
            }
        }

        return moves;
    }

    public neighbours(x: number, y: number): [number, number][] {
        const neighbours: [number, number][] = [];
        if ( (x === 0) || (x === 8) ) {
            // manually look for neighbours to account for wraparound, accounting for duplicates
            const possible: Set<string> = new Set();
            for (const dir of [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW]) {
                const v = ChaseGame.vector(x, y, dir).vector;
                if (v.length !== 1) {
                    throw new Error("Something went wrong finding a neighbour cell.");
                }
                possible.add(`${v[0][0]},${v[0][1]}`);
            }
            neighbours.push(...[...possible.values()].map(v => v.split(",").map(n => parseInt(n, 10))).map(p => [p[0], p[1]] as [number, number]));
        } else {
            // otherwise, just use the library function
            const target = hexGrid.getHex({col: x, row: y});
            if (target !== undefined) {
                for (const dir of [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW]) {
                    const n = hexGrid.neighborOf(target, dir, { allowOutside: false});
                    if (n !== undefined) {
                        neighbours.push([n.col, n.row]);
                    }
                }
            }
        }
        return neighbours;
    }

    private movesExchanges(player: playerid): string[] {
        const moves: string[] = [];
        const playerPieces = [...this.board.entries()].filter(e => e[1][0] === player);
        for (const piece of playerPieces) {
            const [x, y] = ChaseGame.algebraic2coords(piece[0]);
            const neighbours = this.neighbours(x, y);
            for (const n of neighbours) {
                const exs: [string, number][][] = [];
                const nCell = ChaseGame.coords2algebraic(...n);
                if (this.board.has(nCell)) {
                    const nPiece = this.board.get(nCell);
                    if (nPiece![0] === player) {
                        // add first
                        let aSpeed = piece[1][1];
                        let bSpeed = nPiece![1];
                        while (aSpeed < 6) {
                            aSpeed++;
                            bSpeed--;
                            if ( (aSpeed <= 6) && (bSpeed > 0) ) {
                                exs.push([[piece[0], aSpeed], [nCell, bSpeed]]);
                            }
                        }
                        // then subtract
                        aSpeed = piece[1][1];
                        bSpeed = nPiece![1];
                        while (aSpeed > 1) {
                            aSpeed--;
                            bSpeed++;
                            if ( (aSpeed > 0) && (bSpeed <= 6) ) {
                                exs.push([[piece[0], aSpeed], [nCell, bSpeed]]);
                            }
                        }
                    }
                }
                moves.push(...exs.map(e => e.map(half => half.join("=")).join(",")));
            }
        }
        return moves;
    }

    private movesMoves(player: playerid): string[] {
        const moves: string[] = [];
        const playerPieces = [...this.board.entries()].filter(e => e[1][0] === player);
        for (const piece of playerPieces) {
            const start = piece[0];
            const [startX, startY] = ChaseGame.algebraic2coords(start);
            const speed = piece[1][1];
            for (const dir of [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW]) {
                // Skip silly ricochets of pieces starting at board ends
                if ( ( (startY === 0) && (dir === Direction.NE) ) ||
                     ( (startY === 0) && (dir === Direction.NW) ) ||
                     ( (startY === 8) && (dir === Direction.SE) ) ||
                     ( (startY === 8) && (dir === Direction.SW) ) ) {
                    continue;
                }
                const v = ChaseGame.vector(startX, startY, dir, speed).vector;
                // Make sure intermediate spaces are clear
                const middle = v.slice(0, v.length - 1);
                let valid = true;
                for (const mid of middle) {
                    const midCell = ChaseGame.coords2algebraic(...mid);
                    if ( (midCell === "e5") || (this.board.has(midCell)) ) {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    const final = v[v.length - 1];
                    const finalCell = ChaseGame.coords2algebraic(...final);
                    // if final cell is empty, it's a move
                    if (! this.board.has(finalCell)) {
                        moves.push(`${start}-${finalCell}${dir2string(dir)}`);
                    } else {
                        const occ = this.board.get(finalCell);
                        // If occupied by friendly, it's a move
                        if (occ![0] === player) {
                            moves.push(`${start}-${finalCell}${dir2string(dir)}`);
                        // otherwise it's a capture
                        } else {
                            moves.push(`${start}x${finalCell}${dir2string(dir)}`);
                        }
                    }
                }
            }
        }
        return moves;
    }

    private recurseBalance(player: playerid, sofar: string[] = []): string[][] {
        const moves: string[][] = []
        const playerPieces = [...this.board.entries()].filter(e => e[1][0] === player).sort((a, b) => a[1][1] - b[1][1]);
        const speed: number = playerPieces.map(p => p[1][1] as number).reduce((a, b) => a + b);
        if ( (speed < 25) && (playerPieces.length > 4) ) {
            const delta = 25 - speed;
            const lowest: number = playerPieces[0][1][1];
            const allLowest = playerPieces.filter(p => p[1][1] === lowest);
            for (const l of allLowest) {
                if (l[1][1] + delta <= 6) {
                    moves.push([...sofar, l[0]])
                } else {
                    const clone = Object.assign(new ChaseGame(), deepclone(this) as ChaseGame);
                    const piece = clone.board.get(l[0])!;
                    piece[1] = 6;
                    moves.push(...clone.recurseBalance(player, [...sofar, l[0]]))
                }
            }
        }
        return moves;
    }

    private totalSpeed(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        return [...this.board.entries()]
            .filter(e => e[1][0] === player)
            .map(p => p[1][1] as number)
            .reduce((a, b) => a + b);
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cloned: ChaseGame = Object.assign(new ChaseGame(), deepclone(this) as ChaseGame);
            const cell = ChaseGame.coords2algebraic(col, row);
            let newmove = "";
            const speed = cloned.totalSpeed();
            if (move === "") {
                if (! cloned.board.has(cell)) {
                    return {move: "", message: ""} as IClickResult;
                } else {
                    if (speed < 25) {
                        newmove = `{${cell}}`;
                    } else {
                        newmove = cell;
                    }
                }
            } else {
                // if move contains balancing
                let balancing = false;
                if (move.includes("{")) {
                    balancing = true;
                    // See if given balance move is complete
                    const match = move.match(/^\{(\S+)\}/);
                    if (match !== null) {
                        const balance = match[1];
                        const allBalances = cloned.recurseBalance(cloned.currplayer).map(lst => lst.join(","));
                        if (allBalances.includes(balance)) {
                            balancing = false;
                            cloned.executeBalance(balance.split(","));
                        }
                    }
                }
                if (balancing) {
                    const match = move.match(/^\{(\S+)\}/);
                    if (match !== null) {
                        const balance = match[1];
                        const cells = balance.split(",");
                        newmove = `{${[...cells, cell].join(",")}}`;
                    }
                } else {
                    let balance = "";
                    let sofar = move;
                    if (move.includes("}")) {
                        [balance, sofar] = move.split("}");
                        balance += "}";
                    }
                    // fresh move
                    if ( (sofar === undefined) || (sofar.length === 0) ) {
                        // You can only click your own pieces to start
                        if ( (cloned.board.has(cell)) && (cloned.board.get(cell)![0] === cloned.currplayer) ) {
                            newmove = balance + cell;
                        } else {
                            return {move: "", message: ""} as IClickResult;
                        }
                    // you've only clicked on a single cell so far
                    } else if (sofar.length === 2) {
                        // if you've clicked on the same cell twice, go into exchange mode
                        if (sofar === cell) {
                            newmove = `${balance}${cell}=${cloned.board.get(cell)![1] - 1}`;
                        // if you clicked on an enemy piece, capture
                        } else if ( (cloned.board.has(cell)) && (cloned.board.get(cell)![0] !== cloned.currplayer) ) {
                            newmove = `${balance}${sofar}x${cell}`;
                        // otherwise, it's a move
                        } else {
                            newmove = `${balance}${sofar}-${cell}`;
                        }
                    // if it's a move or capture
                    } else if ( (sofar.includes("-")) || (sofar.includes("x")) ) {
                        const [left,] = sofar.split(/[x-]/);
                        // if you clicked on an enemy piece, capture
                        if ( (cloned.board.has(cell)) && (cloned.board.get(cell)![0] !== cloned.currplayer) ) {
                            newmove = `${balance}${left}x${cell}`;
                        // otherwise, it's a move
                        } else {
                            newmove = `${balance}${left}-${cell}`;
                        }
                    // if it's an exchange move
                    } else if (sofar.includes("=")) {
                        // if we have just one equals sign
                        if (sofar.split("=").length === 2) {
                            // You can only select your own cells at this point
                            if ( (cloned.board.has(cell)) && (cloned.board.get(cell)![0] === cloned.currplayer) ) {
                                const prevcell = sofar.slice(0, 2);
                                const left = sofar.split("=")[1].split(",")[0];
                                let newspeed = parseInt(left, 10);
                                if (cell === prevcell) {
                                    newspeed--;
                                    if (newspeed === 0) {
                                        newspeed = cloned.board.get(cell)![1] - 1;
                                    }
                                    newmove = `${balance}${prevcell}=${newspeed}`;
                                } else {
                                    const prevspeed = cloned.board.get(prevcell)![1];
                                    const thisspeed = cloned.board.get(cell)![1];
                                    newmove = `${balance}${prevcell}=${newspeed},${cell}=${prevspeed + thisspeed - newspeed}`;
                                }
                            } else {
                                return {move: "", message: ""} as IClickResult;
                            }
                        }
                    // unknown, so just reject the click
                    } else {
                        return {move: "", message: ""} as IClickResult;
                    }
                }
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
        const cloned: ChaseGame = Object.assign(new ChaseGame(), deepclone(this) as ChaseGame);

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        let delta = 25 - cloned.totalSpeed();
        if (m === "") {
            result.valid = true;
            result.complete = -1;
            if (delta > 0) {
                result.message = i18next.t("apgames:validation.chase.INITIAL_INSTRUCTIONS", {context: "imbalanced", delta});
            } else {
                result.message = i18next.t("apgames:validation.chase.INITIAL_INSTRUCTIONS", {context: "balanced"});
            }
            return result;
        }

        let balance = "";
        let rest = m;
        if (delta > 0) {
            if (!m.startsWith("{")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.chase.MUST_BALANCE", {delta});
                return result;
            }
            if (m.includes("}")) {
                [balance, rest] = m.split("}");
                balance = balance.slice(1);
            } else {
                rest = "";
                balance = m.slice(1);
            }
        } else if (m.startsWith("{")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.chase.NO_BALANCE");
            return result;
        }

        // validate any balances
        if ( (balance !== undefined) && (balance.length > 0) ) {
            const cells = balance.split(",");
            for (const cell of cells) {
                if (delta === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.chase.NO_BALANCE_LEFT", {where: cell});
                    return result;
                }
                // valid cell
                try {
                    ChaseGame.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
                // contains your piece
                if (! cloned.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }
                if (cloned.board.get(cell)![0] !== cloned.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {cell});
                    return result;
                }
                // is one of the lowest speed pieces
                const minspeed = Math.min(...[...cloned.board.entries()].filter(e => e[1][0] === cloned.currplayer).map(e => e[1][1]));
                const mincells = [...cloned.board.entries()].filter(e => e[1][0] === cloned.currplayer && e[1][1] === minspeed).map(e => e[0]);
                if (! mincells.includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.chase.BALANCE_LOWEST", {where: cell});
                    return result;
                }
                // apply this specific balance before continuing
                const val = cloned.board.get(cell)!;
                if (val[1] + delta > 6) {
                    delta -= 6 - val[1];
                    val[1] = 6;
                } else {
                    val[1] += delta;
                    delta = 0;
                }
                cloned.board.set(cell, val);
            }
            if (delta > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.chase.PARTIAL_BALANCE", {delta});
                return result;
            }
            if (!m.includes("}")) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.chase.PARTIAL_BALANCE_PARENTHESIS", {delta});
                return result;
            }

            // if this is it, valid partial
            if ( (rest === undefined) || (rest.length === 0) ) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.chase.INITIAL_INSTRUCTIONS", {context: "balanced"});
                return result;
            }
        }

        // Is this an exchange move
        if (rest.includes("=")) {
            if (! rest.includes(",")) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.chase.PARTIAL_EXCHANGE");
                return result;
            }
            const [left, right] = rest.split(",");
            const [lCell, lSpeedStr] = left.split("=");
            const lSpeed = parseInt(lSpeedStr, 10);
            const [rCell, rSpeedStr] = right.split("=");
            const rSpeed = parseInt(rSpeedStr, 10);
            const totalSpeed = lSpeed + rSpeed;

            if (lSpeed < 1 || lSpeed > 6) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.chase.INVALID_SPEED", {cell: lCell, speed: lSpeed});
                return result;
            }
            if (rSpeed < 1 || rSpeed > 6) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.chase.INVALID_SPEED", {cell: rCell, speed: rSpeed});
                return result;
            }
            for (const cell of [lCell, rCell]) {
                // valid cell
                try {
                    ChaseGame.algebraic2coords(cell);
                 } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
                // occupied
                if (! cloned.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }
                // yours
                if (cloned.board.get(cell)![0] !== cloned.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            }
            // cells are adjacent
            const neighbours = this.neighbours(...ChaseGame.algebraic2coords(lCell)).map(pt => ChaseGame.coords2algebraic(...pt));
            if (! neighbours.includes(rCell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.chase.DISTANT_EXCHANGE", {left: lCell, right: rCell});
                return result;
            }

            const lOrigSpeed: number = cloned.board.get(lCell)![1];
            const rOrigSpeed: number = cloned.board.get(rCell)![1];
            const origTotalSpeed = lOrigSpeed + rOrigSpeed
            if (origTotalSpeed !== totalSpeed) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.chase.UNEQUAL_EXCHANGE", {original: origTotalSpeed, proposed: totalSpeed});
                return result;
            }
            if ( (lSpeed === lOrigSpeed) || (rSpeed === rOrigSpeed) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.chase.NOCHANGE_EXCHANGE");
                return result;
            }

            // valid move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        // it must be a move or capture
        } else {
            const [from, right] = rest.split(/[-x]/);
            // valid cell
            try {
                ChaseGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // occupied
            if (! cloned.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // yours
            if (cloned.board.get(from)![0] !== cloned.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            if ( (right === undefined) || (right.length === 0) ) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.chase.PARTIAL_MOVE");
                return result;
            }

            let to = right;
            let dir: Direction | undefined;
            if (right.length > 2) {
                to = right.slice(0, 2);
                dir = string2dir(right.slice(2));
            }

            // valid cell
            try {
                ChaseGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // correct operator
            if ( (m.includes("-")) && (cloned.board.has(to)) && (cloned.board.get(to)![0] !== cloned.currplayer) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                return result;
            }
            if ( (m.includes("x")) && ( (! cloned.board.has(to)) || (cloned.board.get(to)![0] === cloned.currplayer) ) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                return result;
            }

            const speed = cloned.board.get(from)![1];
            // if a direction was given, that's the only thing to validate
            if (dir !== undefined) {
                const path = ChaseGame.vector(...ChaseGame.algebraic2coords(from), dir, speed).vector.map(v => ChaseGame.coords2algebraic(...v));
                if (path[path.length - 1] !== to) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.chase.NOPATH", {from, to});
                    return result;
                }
                for (const cell of path.slice(0, path.length - 1)) {
                    if (cloned.board.has(cell) || cell === "e5") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                        return result;
                    }
                }

                // valid move
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            // otherwise calculate all possible targets and paths for this piece
            } else {
                const paths: string[][] = [];
                for (const d of [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW]) {
                    paths.push(ChaseGame.vector(...ChaseGame.algebraic2coords(from), d, speed).vector.map(v => ChaseGame.coords2algebraic(...v)))
                }
                const validPaths = paths.filter(p => p[p.length - 1] === to && p.slice(0, p.length - 1).every(c => ! cloned.board.has(c) && c !== "e5"));
                if (validPaths.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.chase.NOPATH", {from, to});
                    return result;
                }
                const uniquePaths = new Set(validPaths.map(p => p.join("")));
                if (uniquePaths.size > 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.chase.MULTIPLE_PATHS", {from, to});
                    return result;
                }
                const path = validPaths[0];
                for (const cell of path.slice(0, path.length - 1)) {
                    if (cloned.board.has(cell) || cell === "e5") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                        return result;
                    }
                }

                // valid move
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
    }

    // This should only be called on cloned objects. It's for convenience only and does no validation or reporting.
    private executeBalance(cells: string[]): ChaseGame {
        for (const cell of cells) {
            const delta = 25 - this.totalSpeed();
            if (delta > 0) {
                const val = this.board.get(cell);
                if (val === undefined) {
                    throw new Error("You tried to balance an empty cell.");
                }
                if (val[1] + delta > 6) {
                    val[1] = 6;
                } else {
                    val[1] += delta;
                }
                this.board.set(cell, val);
            } else {
                break;
            }
        }
        return this;
    }

    public move(m: string, partial = false): ChaseGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/([a-z]+)$/, (match) => {return match.toUpperCase();});

        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        const moves = this.moves();
        // Add direction if missing and unambiguous
        const check = moves.filter(x => x.startsWith(m));
        if (check.length === 1) {
            m = check[0];
        }

        if ( (! partial) && (! moves.includes(m)) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        } else if ( partial ) {
            if (m.endsWith("}")) {
                if ( moves.filter(x => x.startsWith(m.substring(0, m.length - 1))).length < 1 ) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
            } else {
                if ( this.moves().filter(x => x.startsWith(m)).length < 1) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
            }
        }

        let working = m;
        this.results = [];

        // Move valid, so change the state
        // Look for balancing moves first
        if (working.startsWith("{")) {
            const match = working.match(/^{(\S+)}/);
            let balances;
            if (match === null) {
                balances = working.slice(1).split(",");
                working = "";
            } else {
                balances = match[1].split(",");
                working = working.replace(match[0], "");
            }
            const playerPieces = [...this.board.entries()].filter(e => e[1][0] === this.currplayer);
            const speed: number = playerPieces.map(p => p[1][1] as number).reduce((a, b) => a + b);
            let delta  = 25 - speed;
            for (const cell of balances) {
                const piece = this.board.get(cell);
                if (piece![1] + delta > 6) {
                    this.results.push({type: "convert", what: piece![1].toString(), into: "6", where: cell});
                    delta -= 6 - piece![1];
                    piece![1] = 6;
                } else {
                    this.results.push({type: "convert", what: piece![1].toString(), into: (piece![1] + delta).toString(), where: cell});
                    piece![1] += delta;
                    delta = 0;
                }
            }
            if (! partial && delta !== 0) {
                throw new Error("Something went horribly wrong balancing speed.");
            }
        }

        // Exchanges next
        if (working.includes("=")) {
            if ( (partial) && (! working.includes(",")) ) { return this; }
            const [left, right] = working.split(",");
            const [lcell, lval] = left.split("=");
            const [rcell, rval] = right.split("=");
            if ( (! this.board.has(lcell)) || (! this.board.has(rcell)) ) {
                throw new Error("Attempting to exchange between unoccupied cells.");
            }
            if ( (isNaN(parseInt(lval, 10))) || (isNaN(parseInt(rval, 10))) ) {
                throw new Error("Invalid exchange values encountered.");
            }
            const lpiece = this.board.get(lcell);
            const rpiece = this.board.get(rcell);
            this.results.push(
                {type: "convert", what: lpiece![1].toString(), into: lval, where: lcell},
                {type: "convert", what: rpiece![1].toString(), into: rval, where: rcell},
            );
            lpiece![1] = parseInt(lval, 10) as Speed;
            rpiece![1] = parseInt(rval, 10) as Speed;
        // otherwise, movement/capture
        } else {
            if ( (partial) && (! working.includes("-")) && (! working.includes("x")) ) { return this; }
            const match = working.match(/^([a-z][0-9])[-x]([a-z][0-9])([NESW]+)$/);
            if (match === null) {
                throw new Error(`Error occurred extracting the various parts of the move: ${working}.`);
            }
            const from = match[1];
            const to = match[2];
            const dir = string2dir(match[3]);
            const [xFrom, yFrom] = ChaseGame.algebraic2coords(from);
            const [xTo, yTo] = ChaseGame.algebraic2coords(to);
            const pFrom = this.board.get(from);
            if (pFrom === undefined) {
                throw new Error("Could not find the piece on the board");
            }
            // Reconstruct the move vector so you can show each step in the movement, for clarity
            const {vector: v, finalDir} = ChaseGame.vector(xFrom, yFrom, dir!, pFrom[1]);
            if ( (v[v.length - 1][0] !== xTo) || (v[v.length - 1][1] !== yTo) ) {
                throw new Error(`Could not reconstruct movement vector.\nMove: ${m}, From: ${from}, xFrom: ${xFrom}, yFrom: ${yFrom}, To: ${to}, Dir: ${dir}, Dist: ${pFrom[1]}, V: ${v.join("|")}\nState: ${this.serialize()}`);
            }
            for (let i = 0; i < v.length; i++) {
                const cell = v[i];
                let prevx = xFrom;
                let prevy = yFrom;
                if (i > 0) {
                    [prevx, prevy] = v[i-1];
                }
                this.results.push({type: "move", from: ChaseGame.coords2algebraic(prevx, prevy), to: ChaseGame.coords2algebraic(...cell)});
                // if ( (Math.abs(prevx - cell[0]) <= 1) && (Math.abs(prevy - cell[1]) <= 1) ) {
            }

            // Create a stack of moves to account for chain reactions
            // The first piece has to be picked up to avoid an infinite loop
            this.board.delete(from);
            this.recurseMove(to, [...pFrom], finalDir);
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

    // Handle chamber moves here
    private recurseMove(cell: string, piece: CellContents, dir: Direction) {
        // Captures and bumps
        if (this.board.has(cell)) {
            const nPiece = this.board.get(cell);
            // If it doesn't belong to us, we're done
            // Remove the piece, and exit, which will lead to applying the stack
            if (nPiece![0] !== this.currplayer) {
                this.board.delete(cell);
                this.results.push({type: "capture", what: nPiece![1].toString(), where: cell});
                this.board.set(cell, piece);
            // Otherwise, recurse
            } else {
                this.board.set(cell, piece);
                const result: APMoveResult = {type: "eject", what: nPiece![1].toString(), from: cell, to: ""};
                const [x, y] = ChaseGame.algebraic2coords(cell);
                const {vector: chainv, finalDir: d} = ChaseGame.vector(x, y, dir);
                const [xNext, yNext] = chainv[0];
                const cellNext = ChaseGame.coords2algebraic(xNext, yNext);
                result.to = cellNext;
                this.results.push(result);
                this.recurseMove(cellNext, [...nPiece!], d);
            }
        // Chamber moves
        } else if (cell === "e5") {
            const [lcell, rcell] = chamberExits.get(dir)!;
            // If the player already has 10 pieces (9, actually, because we're in the middle of a move), just eject the piece
            if ([...this.board.values()].filter(p => p[0] === this.currplayer).length === 9) {
                this.results.push({type: "move", from: "e5", to: lcell});
                this.recurseMove(lcell, [...piece], leftDirs.get(dir)!)
            // If it's a 1, just eject the piece
            } else if (piece[1] === 1) {
                this.results.push({type: "move", from: "e5", to: lcell});
                this.recurseMove(lcell, [...piece], leftDirs.get(dir)!)
            // Otherwise, split and eject
            } else {
                const currSpeed = piece[1]!;
                const lspeed = Math.ceil(currSpeed / 2);
                const rspeed = Math.floor(currSpeed / 2);
                this.results.push(
                    {type: "take", what: currSpeed.toString(), from: "e5"},
                    {type: "place", what: lspeed.toString(), where: lcell},
                    {type: "place", what: rspeed.toString(), where: rcell},
                );
                this.recurseMove(lcell, [this.currplayer, lspeed] as CellContents, leftDirs.get(dir)!);
                this.recurseMove(rcell, [this.currplayer, rspeed] as CellContents, rightDirs.get(dir)!);
            }
        // Regular move
        } else {
            this.board.set(cell, piece);
        }
    }

    private normalizeMove(m: string): string {
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/([a-z]+)$/, '');
        let balance = "";
        let rest = m;
        if (m.includes("}")) {
            [balance, rest] = m.split("}");
            balance = balance + "}";
        }
        if (rest.includes("=")) {
            const [left, right] = rest.split(",");
            if (left > right)
                rest = `${right},${left}`;
        }
        return `${balance}${rest}`;
    }

    public sameMove(move1: string, move2: string): boolean {
        return this.normalizeMove(move1) === this.normalizeMove(move2);
    }

    protected checkEOG(): ChaseGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            this.results.push({type: "eog"});
            if (this.currplayer === 1) {
                this.winner = [2];
            } else {
                this.winner = [1];
            }
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IChaseState {
        return {
            game: ChaseGame.gameinfo.uid,
            numplayers: 2,
            variants: [],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ChaseGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        const letters = "AB";
        for (let row = 0; row < 9; row++) {
            const node: string[] = [];
            for (let col = 0; col < 9; col++) {
                const cell = ChaseGame.coords2algebraic(col, row);
                if (cell === "e5") {
                    node.push("X");
                } else if (this.board.has(cell)) {
                    const [owner, speed] = this.board.get(cell)!;
                    node.push(`${letters[owner - 1]}${speed}`);
                } else {
                    node.push("");
                }
            }
            pieces.push(node);
        }
        let pstr: string = pieces.map(r => r.join(",")).join("\n");
        pstr = pstr.replace(/\n,{8}\n/g, "\n_\n");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-even-p",
                width: 9,
                height: 9
            },
            legend: {
                A1: {
                    name: "d6-1",
                    player: 1
                },
                A2: {
                    name: "d6-2",
                    player: 1
                },
                A3: {
                    name: "d6-3",
                    player: 1
                },
                A4: {
                    name: "d6-4",
                    player: 1
                },
                A5: {
                    name: "d6-5",
                    player: 1
                },
                A6: {
                    name: "d6-6",
                    player: 1
                },
                B1: {
                    name: "d6-1",
                    player: 2
                },
                B2: {
                    name: "d6-2",
                    player: 2
                },
                B3: {
                    name: "d6-3",
                    player: 2
                },
                B4: {
                    name: "d6-4",
                    player: 2
                },
                B5: {
                    name: "d6-5",
                    player: 2
                },
                B6: {
                    name: "d6-6",
                    player: 2
                },
                X: {
                    name: "piecepack-number-void",
                    colour: "#000"
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = ChaseGame.algebraic2coords(move.from);
                    const [toX, toY] = ChaseGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", arrow: false, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "eject") {
                    const [fromX, fromY] = ChaseGame.algebraic2coords(move.from);
                    const [toX, toY] = ChaseGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = ChaseGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const [x, y] = ChaseGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "convert") {
                    const [x, y] = ChaseGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        const speed = this.totalSpeed();
        if (speed < 25) {
            const delta = 25 - speed;
            status += `**Current player is imbalanced by ${delta} speed.**\n\n`;
        }

        return status;
    }

    public statuses(): IStatus[] {
        const speed = this.totalSpeed();
        if (speed < 25) {
            const delta = 25 - speed;
            return [{ key: i18next.t("apgames:status.chase.BALANCE"), value: [i18next.t("apgames:status.chase.IMBALANCE", {delta})] }];
        } else
            return [];
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, convert, capture, eject, move, take, place
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }

                const moves = state._results.filter(r => r.type === "move");
                if (moves.length > 0) {
                    const first = moves[0];
                    const last = moves[moves.length - 1];
                    const rest = moves.slice(0, moves.length - 1);
                    if ( moves.length > 2) {
                        // @ts-ignore
                        node.push(i18next.t("apresults:MOVE.chase", {player: name, from: first.from as string, to: last.to as string, through: rest.map(r => r.to as string).join(", ")}));
                    } else {
                        // @ts-ignore
                        node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: first.from as string, to: last.to as string}));
                    }
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.complete", {player: name, what: r.what, where: r.where}));
                            break;
                        case "eject":
                            node.push(i18next.t("apresults:MOVE.push", {what: r.what, from: r.from, to: r.to}));
                            break;
                        case "convert":
                            node.push(i18next.t("apresults:CONVERT.complete", {player: name, what: r.what, into: r.into, where: r.where}));
                            break;
                        case "take":
                            node.push(i18next.t("apresults:TAKE.chase", {what: r.what}));
                            break;
                        case "place":
                            node.push(i18next.t("apresults:PLACE.chase", {what: r.what, where: r.where}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                        case "resigned":
                            let rname = `Player ${r.player}`;
                            if (r.player <= players.length) {
                                rname = players[r.player - 1]
                            }
                            node.push(i18next.t("apresults:RESIGN", {player: rname}));
                            break;
                        case "winners":
                            const names: string[] = [];
                            for (const w of r.players) {
                                if (w <= players.length) {
                                    names.push(players[w - 1]);
                                } else {
                                    names.push(`Player ${w}`);
                                }
                            }
                            node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                        }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): ChaseGame {
        return new ChaseGame(this.serialize());
    }
}
