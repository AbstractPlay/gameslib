import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Direction } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;

const dirsForward: Direction[][] = [["W", "NW", "N", "NE", "E"], ["E", "SE", "S", "SW", "W"]];
const dirsBackward: Direction[][] = [["SW", "S", "SE"], ["NE", "N", "NW"]];
const dirsOrthForward: Direction[] = ["N", "S"];
const dirsOrthBackward: Direction[] = ["S", "N"];
// Brought over from Perl code
// Doing the cells in this order lets us only look for ordos North and East
const cellsByDist = ["a1","a2","b1","b2","a3","b3","c1","c2","c3","a4","b4","c4","d1","d2","d3","d4","a5","b5","c5","d5","e1","e2","e3","e4","e5","a6","b6","c6","d6","e6","f1","f2","f3","f4","f5","f6","a7","b7","c7","d7","e7","f7","g1","g2","g3","g4","g5","g6","g7","a8","b8","c8","d8","e8","f8","g8","h1","h2","h3","h4","h5","h6","h7","h8","i1","i2","i3","i4","i5","i6","i7","i8","j1","j2","j3","j4","j5","j6","j7","j8"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IOrdoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OrdoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Ordo",
        uid: "ordo",
        playercounts: [2],
        version: "20211114",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.ordo")
        description: "apgames:descriptions.ordo",
        urls: [
            "https://spielstein.com/games/ordo",
            "https://boardgamegeek.com/boardgame/41006/ordo",
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
        categories: ["goal>breakthrough", "mechanic>capture",  "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "limited-pieces"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IOrdoState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const cols = [[2,3,6,7], [0,1,2,3,4,5,6,7,8,9], [0,1,4,5,8,9]];
            const rows = [[7, 6, 5], [0, 1, 2]];
            for (const player of [1, 2] as const) {
                const rowset = rows[player - 1];
                for (let i = 0; i < rowset.length; i++) {
                    const row = rowset[i];
                    for (const col of cols[i]) {
                        board.set(OrdoGame.coords2algebraic(col, row), player)
                    }
                }
            }
            const fresh: IMoveState = {
                _version: OrdoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOrdoState;
            }
            if (state.game !== OrdoGame.gameinfo.uid) {
                throw new Error(`The Ordo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OrdoGame {
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
        this.results = [...state._results];
        return this;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public moves(player?: playerid, permissive = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const playerPieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        if (playerPieces.length === 0) { return []; }
        const grid = new RectGrid(10, 8);
        const connected = this.isConnected(player);

        // Single moves first
        const dirsSingle = [...dirsForward[player - 1]];
        if (! connected) {
            dirsSingle.push(...dirsBackward[player - 1]);
        }
        for (const cell of playerPieces) {
            const [xStart, yStart] = OrdoGame.algebraic2coords(cell);
            for (const dir of dirsSingle) {
                const ray = grid.ray(xStart, yStart, dir);
                for (const [xNext, yNext] of ray) {
                    const next = OrdoGame.coords2algebraic(xNext, yNext);
                    if (! this.board.has(next)) {
                        moves.push(`${cell}-${next}`);
                    } else {
                        if (! playerPieces.includes(next)) {
                            moves.push(`${cell}x${next}`);
                        }
                        break;
                    }
                }
            }
        }

        // Horizontal ordos
        for (const start of cellsByDist) {
            if (! playerPieces.includes(start)) { continue; }
            const [xStart, yStart] = OrdoGame.algebraic2coords(start);
            const ray = grid.ray(xStart, yStart, "E");
            for (let len = 0; len < ray.length; len++) {
                const [xNext, yNext] = ray[len];
                const next = OrdoGame.coords2algebraic(xNext, yNext);
                if (! playerPieces.includes(next)) { break; }
                const ordo: [number, number][] = [[xStart, yStart], ...ray.slice(0, len + 1)];
                const dirs: Direction[] = [dirsOrthForward[player - 1]];
                if (! connected) {
                    dirs.push(dirsOrthBackward[player - 1]);
                }
                for (const dir of dirs) {
                    const rays = ordo.map(p => grid.ray(...p, dir));
                    for (let dist = 0; dist < rays[0].length; dist++) {
                        let blocked = false;
                        for (const r of rays) {
                            if (this.board.has(OrdoGame.coords2algebraic(...r[dist]))) {
                                blocked = true;
                                break;
                            }
                        }
                        if (! blocked) {
                            const dest = OrdoGame.coords2algebraic(...rays[0][dist]);
                            moves.push(`${start}:${next}-${dest}`);
                            if (permissive) {
                                const otherDest = OrdoGame.coords2algebraic(...rays[rays.length - 1][dist]);
                                moves.push(`${next}:${start}-${otherDest}`);
                            }
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Vertical ordos
        for (const start of cellsByDist) {
            if (! playerPieces.includes(start)) { continue; }
            const [xStart, yStart] = OrdoGame.algebraic2coords(start);
            const ray = grid.ray(xStart, yStart, "N");
            for (let len = 0; len < ray.length; len++) {
                const [xNext, yNext] = ray[len];
                const next = OrdoGame.coords2algebraic(xNext, yNext);
                if (! playerPieces.includes(next)) { break; }
                const ordo: [number, number][] = [[xStart, yStart], ...ray.slice(0, len + 1)];
                const dirs: Direction[] = ["E", "W"];
                for (const dir of dirs) {
                    const rays = ordo.map(p => grid.ray(...p, dir));
                    for (let dist = 0; dist < rays[0].length; dist++) {
                        let blocked = false;
                        for (const r of rays) {
                            if (this.board.has(OrdoGame.coords2algebraic(...r[dist]))) {
                                blocked = true;
                                break;
                            }
                        }
                        if (! blocked) {
                            const dest = OrdoGame.coords2algebraic(...rays[0][dist]);
                            moves.push(`${start}:${next}-${dest}`);
                            if (permissive) {
                                const otherDest = OrdoGame.coords2algebraic(...rays[rays.length - 1][dist]);
                                moves.push(`${next}:${start}-${otherDest}`);
                            }
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Test each move to make sure the group is still connected
        return moves.filter(m => {
            if (m.includes(":")) {
                const [cell1, cell2, right] = m.split(/[:-]/);
                const ordoStart = this.getOrdo(cell1, cell2);
                const ordoEnd = this.getMovedOrdo(cell1, cell2, right);
                if ( (ordoStart === undefined) || (ordoEnd === undefined) ) {
                    throw new Error("An error occurred while calculating ordos.");
                }
                const cloned: OrdoGame = Object.assign(new OrdoGame(), deepclone(this) as OrdoGame);
                for (const cell of ordoStart) {
                    cloned.board.delete(cell);
                }
                for (const cell of ordoEnd) {
                    cloned.board.set(cell, this.currplayer);
                }
                return cloned.isConnected(this.currplayer);
            } else {
                const [from, to] = m.split(/[-x]/);
                const cloned: OrdoGame = Object.assign(new OrdoGame(), deepclone(this) as OrdoGame);
                cloned.board.delete(from);
                cloned.board.set(to, this.currplayer);
                return cloned.isConnected(this.currplayer);
            }
        });
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private isOrdo(cell1: string, cell2: string): boolean {
        // both cells must exist and can't be the same
        if ( (! this.board.has(cell1)) || (! this.board.has(cell2)) || (cell1 === cell2) ) {
            return false;
        }

        // both must be owned by the same player
        const owner1 = this.board.get(cell1)!;
        const owner2 = this.board.get(cell2)!;
        if (owner1 !== owner2) {
            return false;
        }

        const [x1, y1] = OrdoGame.algebraic2coords(cell1);
        const [x2, y2] = OrdoGame.algebraic2coords(cell2);
        const bearing = RectGrid.bearing(x1, y1, x2, y2);
        // Must be orthogonal to each other
        if ( (bearing === undefined) || (bearing.length > 1) ) {
            return false;
        }
        const between = RectGrid.between(x1, y1, x2, y2).map(pt => OrdoGame.coords2algebraic(...pt));
        // each cell in between must exist and belong to the same player
        for (const next of between) {
            if (next === cell2) { break; }
            if ( (! this.board.has(next)) || (this.board.get(next)! !== owner1) ) {
                return false;
            }
        }

        return true;
    }

    private getOrdo(cell1: string, cell2: string): string[] | undefined {
        // both cells must exist and can't be the same
        if ( (! this.board.has(cell1)) || (! this.board.has(cell2)) || (cell1 === cell2) ) {
            return;
        }

        // both must be owned by the same player
        const owner1 = this.board.get(cell1)!;
        const owner2 = this.board.get(cell2)!;
        if (owner1 !== owner2) {
            return;
        }

        const [x1, y1] = OrdoGame.algebraic2coords(cell1);
        const [x2, y2] = OrdoGame.algebraic2coords(cell2);
        const bearing = RectGrid.bearing(x1, y1, x2, y2);
        // Must be orthogonal to each other
        if ( (bearing === undefined) || (bearing.length > 1) ) {
            return;
        }
        const between = RectGrid.between(x1, y1, x2, y2).map(pt => OrdoGame.coords2algebraic(...pt));
        // each cell in between must exist and belong to the same player
        for (const next of between) {
            if (next === cell2) { break; }
            if ( (! this.board.has(next)) || (this.board.get(next)! !== owner1) ) {
                return;
            }
        }

        return [cell1, ...between, cell2];
    }

    // assumes ordo is valid
    private getMovedOrdo(ordo1: string, ordo2: string, destination: string): string[] | undefined {
        const [x1, y1] = OrdoGame.algebraic2coords(ordo1);
        const [x2, y2] = OrdoGame.algebraic2coords(ordo2);
        const between = RectGrid.between(x1, y1, x2, y2);
        const ordoCoords: [number,number][] = [[x1,y1], ...between, [x2,y2]];
        // find the ordo cell that is directly orthogonal to the destination
        const [xDest, yDest] = OrdoGame.algebraic2coords(destination);
        const orth = ordoCoords.find(pt => RectGrid.isOrth(...pt, xDest, yDest));
        if (orth === undefined) {
            return;
        }
        // get the bearing between those cells
        const bearing = RectGrid.bearing(...orth, xDest, yDest);
        if ( (bearing === undefined) || (bearing.length > 1) ) {
            return;
        }
        // get the distance
        const distance = RectGrid.distance(...orth, xDest, yDest);

        // assumes the board is regular, so if the destination is in bounds, all other destinations will be in bounds
        const newordo: string[] = [];
        const grid = new RectGrid(10, 8);
        for (const cell of ordoCoords) {
            const ray = grid.ray(...cell, bearing).slice(0, distance).map(pt => OrdoGame.coords2algebraic(...pt));
            newordo.push(ray[ray.length - 1]);
        }
        return newordo;
    }

    private canOrdoMove(ordo1: string, ordo2: string, destination: string): boolean {
        // must be a valid ordo
        if (! this.isOrdo(ordo1, ordo2)) {
            return false;
        }
        // destination must be empty
        if (this.board.has(destination)) {
            return false;
        }

        const [x1, y1] = OrdoGame.algebraic2coords(ordo1);
        const [x2, y2] = OrdoGame.algebraic2coords(ordo2);
        const between = RectGrid.between(x1, y1, x2, y2);
        const ordoCoords: [number,number][] = [[x1,y1], ...between, [x2,y2]];
        // find the ordo cell that is directly orthogonal to the destination
        const [xDest, yDest] = OrdoGame.algebraic2coords(destination);
        const orth = ordoCoords.find(pt => RectGrid.isOrth(...pt, xDest, yDest));
        if (orth === undefined) {
            return false;
        }
        // get the bearing between those cells
        const bearing = RectGrid.bearing(...orth, xDest, yDest);
        if ( (bearing === undefined) || (bearing.length > 1) ) {
            return false;
        }
        // get the distance
        const distance = RectGrid.distance(...orth, xDest, yDest);

        // draw a ray from each ordo cell in the direction for the distance and make sure there are no obstructions
        // assumes the board is regular, so if the destination is in bounds, all other destinations will be in bounds
        const grid = new RectGrid(10, 8);
        for (const cell of ordoCoords) {
            const ray = grid.ray(...cell, bearing).slice(0, distance).map(pt => OrdoGame.coords2algebraic(...pt));
            for (const next of ray) {
                if (this.board.has(next)) {
                    return false;
                }
            }
        }

        return true;
    }

    // Assumes you've already validated the move
    // This simply ensures that the destination is expressed relative to the first ordo cell
    private organizeMove(move: string): string | undefined {
        if (! /^[a-z]\d:[a-z]\d-[a-z]\d$/.test(move)) {
            return;
        }
        const [ordo1, ordo2, destination] = move.split(/[:-]/);
        const [x1, y1] = OrdoGame.algebraic2coords(ordo1);
        const [x2, y2] = OrdoGame.algebraic2coords(ordo2);
        const between = RectGrid.between(x1, y1, x2, y2);
        const ordoCoords: [number,number][] = [[x1,y1], ...between, [x2,y2]];
        // find the ordo cell that is directly orthogonal to the destination
        const [xDest, yDest] = OrdoGame.algebraic2coords(destination);
        const orth = ordoCoords.find(pt => RectGrid.isOrth(...pt, xDest, yDest));
        if (orth === undefined) {
            return;
        }
        // get the bearing between those cells
        const bearing = RectGrid.bearing(...orth, xDest, yDest);
        if ( (bearing === undefined) || (bearing.length > 1) ) {
            return;
        }
        // get the distance
        const distance = RectGrid.distance(...orth, xDest, yDest);

        // Get the destination based on `ordo1`
        const grid = new RectGrid(10, 8);
        const ray = grid.ray(x1, y1, bearing).slice(0, distance);
        const newdest = OrdoGame.coords2algebraic(...ray[ray.length - 1]);
        return `${ordo1}:${ordo2}-${newdest}`;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = OrdoGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length > 0) {
                const [left,] = move.split(/[x-]/);
                // if there's an ordo move on the left
                if (left.includes(":")) {
                    const [ordo1, ordo2] = left.split(":");
                    // if you click on one of those cells, reset
                    if ( (ordo1 === cell) || (ordo2 === cell) ) {
                        newmove = cell;
                    // if you click on another cell you own, set `ordo2` to it
                    } else if ( (this.board.has(cell)) && (this.board.get(cell)! === this.currplayer) ) {
                        newmove = `${ordo1}:${cell}`;
                    // if you click on an empty cell, assume you want to move there
                    } else if (! this.board.has(cell)) {
                        const organized = this.organizeMove(`${left}-${cell}`);
                        if (organized !== undefined) {
                            newmove = organized;
                        }
                    }
                // otherwise it must just be a single cell on the left
                } else {
                    // If you click on it again, clear the move
                    if (left === cell) {
                        return {move: "", message: ""} as IClickResult;
                    }
                    // If it's your own piece, assume an ordo
                    if ( (this.board.has(cell)) && (this.board.get(cell)! === this.currplayer) ) {
                        newmove = `${left}:${cell}`;
                    // if it's an enemy piece, it's a capture
                    } else if (this.board.has(cell)) {
                        newmove = `${left}x${cell}`;
                    // otherwise it's a move
                    } else {
                        newmove = `${left}-${cell}`;
                    }
                }
            } else {
                if ( (! this.board.has(cell)) || (this.board.get(cell)! !== this.currplayer) ) {
                    return {move: "", message: ""} as IClickResult;
                }
                newmove = cell;
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

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.ordo.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [left, right] = m.split(/[-x]/);
        // is left-hand an ordo
        if (left.includes(":")) {
            if (m.includes("x")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.ordo.NO_ORDO_CAPTURE", {where: left});
                return result;
            }
            const [cell1, cell2] = left.split(":");
            // valid cells
            for (const cell of [cell1, cell2]) {
                try {
                    OrdoGame.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }
            // valid ordo
            if (! this.isOrdo(cell1, cell2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.ordo.INVALID_ORDO", {ordo: left});
                return result;
            }
            // your ordo
            if (this.board.get(cell1)! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // if there's no `right`, then valid partial
            if (right === undefined) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.ordo.PARTIAL");
                return result;
            } else {
                // valid cell
                try {
                    OrdoGame.algebraic2coords(right);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: right});
                    return result;
                }
                // move is "organized"
                if (! RectGrid.isOrth(...OrdoGame.algebraic2coords(cell1), ...OrdoGame.algebraic2coords(right)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ordo.DISORGANIZED", {move: m});
                    return result;
                }
                // can the ordo move there (it's not obstructed)
                if (! this.canOrdoMove(cell1, cell2, right)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ordo.INVALID_ORDO_MOVE", {ordo: left, destination: right});
                    return result;
                }
                // direction is correct
                const dirs: Direction[] = ["E", "W"]; // E/W movement always allowed
                dirs.push(dirsOrthForward[this.currplayer - 1]); // as is forward motion
                if (! this.isConnected(this.currplayer)) {
                    dirs.push(dirsOrthBackward[this.currplayer - 1]); // only if disconnected
                }
                const bearing = RectGrid.bearing(...OrdoGame.algebraic2coords(cell1), ...OrdoGame.algebraic2coords(right));
                if ( (bearing === undefined) || (! dirs.includes(bearing)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ordo.WRONG_DIRECTION", {from: cell1, to: right});
                    return result;
                }
                // connection test
                const ordoStart = this.getOrdo(cell1, cell2);
                const ordoEnd = this.getMovedOrdo(cell1, cell2, right);
                if ( (ordoStart === undefined) || (ordoEnd === undefined) ) {
                    throw new Error("An error occurred while calculating ordos.");
                }
                const cloned: OrdoGame = Object.assign(new OrdoGame(), deepclone(this) as OrdoGame);
                for (const cell of ordoStart) {
                    cloned.board.delete(cell);
                }
                for (const cell of ordoEnd) {
                    cloned.board.set(cell, this.currplayer);
                }
                if (! cloned.isConnected(this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ordo.DISCONNECTED");
                    return result;
                }

                // valid complete move
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

        // otherwise it's a single cell
        } else {
            // valid cell
            try {
                OrdoGame.algebraic2coords(left);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: left});
                return result;
            }
            // occupied
            if (! this.board.has(left)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: left});
                return result;
            }
            // yours
            if (this.board.get(left)! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // if no `right`, valid partial
            if (right === undefined) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.ordo.PARTIAL");
                return result;
            } else {
                // valid cell
                try {
                    OrdoGame.algebraic2coords(right);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: right});
                    return result;
                }
                // correct operator used
                if ( (m.includes("x")) && (! this.board.has(right)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: right});
                    return result;
                }
                if ( (m.includes("-")) && (this.board.has(right)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: right});
                    return result;
                }
                // enemy piece
                if ( (this.board.has(right)) && (this.board.get(right)! === this.currplayer) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }
                // Orthogonal or diagonal
                if (! RectGrid.isOrth(...OrdoGame.algebraic2coords(left), ...OrdoGame.algebraic2coords(right)) && ! RectGrid.isDiag(...OrdoGame.algebraic2coords(left), ...OrdoGame.algebraic2coords(right))) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NOT_ORTH_OR_DIAG", {from: left, to: right});
                    return result;
                }
                // direction is correct
                const dirs: Direction[] = [...dirsForward[this.currplayer - 1]];
                if (! this.isConnected(this.currplayer)) {
                    dirs.push(...dirsBackward[this.currplayer - 1]);
                }
                const bearing = RectGrid.bearing(...OrdoGame.algebraic2coords(left), ...OrdoGame.algebraic2coords(right));
                if ( (bearing === undefined) || (! dirs.includes(bearing)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ordo.WRONG_DIRECTION", {from: left, to: right});
                    return result;
                }
                // no obstructions
                const [x1, y1] = OrdoGame.algebraic2coords(left);
                const [x2, y2] = OrdoGame.algebraic2coords(right);
                const between = RectGrid.between(x1, y1, x2, y2).map(pt => OrdoGame.coords2algebraic(...pt));
                for (const next of between) {
                    if (this.board.has(next)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {obstruction: next, from: left, to: right});
                        return result;
                    }
                }
                // connection test
                const cloned: OrdoGame = Object.assign(new OrdoGame(), deepclone(this) as OrdoGame);
                cloned.board.delete(left);
                cloned.board.set(right, this.currplayer);
                if (! cloned.isConnected(this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ordo.DISCONNECTED");
                    return result;
                }

                // valid move
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
    }

    // The partial flag enables dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, {partial = false, trusted = false} = {}): OrdoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves(undefined, true).includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            } else if ( (partial) && (this.moves(undefined, true).filter(x => x.startsWith(m)).length < 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        // Single moves first
        if (! m.includes(":")) {
            const [from, to] = m.split(/[-x]/);
            this.results.push({type: "move", from, to});
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            if (m.includes("x")) {
                this.results.push({type: "capture", where: to});
            }
        } else {
            const [start, end, dest] = m.split(/[:-]/);
            const [xStart, yStart] = OrdoGame.algebraic2coords(start);
            const [xEnd, yEnd] = OrdoGame.algebraic2coords(end);
            const [xDest, yDest] = OrdoGame.algebraic2coords(dest);
            const ptsOrdo: [number, number][] = [[xStart, yStart], ...RectGrid.between(xStart, yStart, xEnd, yEnd), [xEnd, yEnd]];
            const ordo = ptsOrdo.map(p => OrdoGame.coords2algebraic(...p));
            const bearing = RectGrid.bearing(xStart, yStart, xDest, yDest);
            const distance = RectGrid.distance(xStart, yStart, xDest, yDest);
            const ptsTargets = ptsOrdo.map(p => RectGrid.move(...p, bearing!, distance));
            const targets = ptsTargets.map(p => OrdoGame.coords2algebraic(...p));
            for (let i = 0; i < ordo.length; i++) {
                const from = ordo[i];
                const to = targets[i];
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results.push({type: "move", from, to});
            }
        }

        // Stop here if only requesting partial processing
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

    protected checkEOG(): OrdoGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // Current player has no moves (nothing they can do to reconnect their group)
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        // Previous player has a piece on their opponent's home row
        } else {
            const targetRows = ["8", "1"];
            const homePieces = [...this.board.entries()].filter(e => e[0].endsWith(targetRows[prevPlayer - 1]) && e[1] === prevPlayer);
            if (homePieces.length > 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    public isConnected(player: playerid): boolean {
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const grid = new RectGrid(10, 8);
        const seen: Set<string> = new Set();
        const todo: string[] = [pieces[0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            seen.add(cell!);
            const [x, y] = OrdoGame.algebraic2coords(cell!);
            const neighbours = grid.adjacencies(x, y);
            for (const n of neighbours) {
                const nCell = OrdoGame.coords2algebraic(...n);
                if (pieces.includes(nCell)) {
                    if (! seen.has(nCell)) {
                        todo.push(nCell);
                    }
                }
            }
        }
        return seen.size === pieces.length;
    }

    public state(): IOrdoState {
        return {
            game: OrdoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OrdoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
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
            for (let col = 0; col < 10; col++) {
                const cell = OrdoGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
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
        pstr = pstr.replace(/-{10}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 10,
                height: 8,
                markers: [
                    {
                        type: "shading",
                        colour: 2,
                        points: [
                            {row: 0, col: 0},
                            {row: 0, col: 10},
                            {row: 1, col: 10},
                            {row: 1, col: 0}
                        ]
                    },
                    {
                        type: "shading",
                        colour: 1,
                        points: [
                            {row: 7, col: 0},
                            {row: 7, col: 10},
                            {row: 8, col: 10},
                            {row: 8, col: 0}
                        ]
                    }
                ]
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
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = OrdoGame.algebraic2coords(move.from);
                    const [toX, toY] = OrdoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = OrdoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

        return status;
    }

    public clone(): OrdoGame {
        return new OrdoGame(this.serialize());
    }
}
