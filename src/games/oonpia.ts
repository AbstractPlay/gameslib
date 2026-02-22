import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, BoardBasic } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import { Glyph } from "@abstractplay/renderer";

export type playerid = 1|2|3; // 3 is neutral
export type tileid = 1|2;
const tileNames = ["plain", "dotted"];  // For tileid 1 and 2

// Moves are always represented from the perspective of the current player (so we don't need
// to store the stone colour). All fields are optional, so we can use undefined to represent partial
// or partially parsed moves.
type Move = {
    tile?: tileid;
    cell?: string;
    iscapture?: boolean;
    pass?: boolean;
    komi?: number;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, tileid]>;
    lastmove?: string;
    prison: [number,number];
};

export interface IOonpiaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OonpiaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Oonpia",
        uid: "oonpia",
        playercounts: [2],
        version: "20251216",
        dateAdded: "2025-12-16",
        // i18next.t("apgames:descriptions.oonpia")
        description: "apgames:descriptions.oonpia",
        // i18next.t("apgames:notes.oonpia")
        notes: "apgames:notes.oonpia",
        urls: ["https://boardgamegeek.com/thread/3251219/oonpia-new-4-colour-hexagonal-go-like"],
        people: [
            {
                type: "designer",
                name: "Hoembla",
                urls: ["https://boardgamegeek.com/boardgamedesigner/148212/hoembla"],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        flags: ["experimental", "pie", "custom-buttons", "no-moves", "custom-randomization", "custom-colours"],
        categories: ["mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>hex", "board>connect>hex", "components>simple>2per"],
        variants: [
            { uid: "size-5", group: "board" },
            { uid: "#board", },
            { uid: "size-7", group: "board" },
            { uid: "size-8", group: "board" },
            { uid: "size-9", group: "board" },
            { uid: "size-10", group: "board" },
            { uid: "size-11", group: "board" },
            { uid: "size-12", group: "board" }
        ],
        displays: [ // default: palette_no_blocked_yes
            {uid: "palette_no_blocked_no"},
            {uid: "palette_yes_blocked_yes"},
            {uid: "palette_yes_blocked_no"},
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public neutral: playerid = 3;
    public board!: Map<string, [playerid, tileid]>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public prison: [number, number] = [0, 0];
    private boardSize = 0;
    private usePalette = false;

    constructor(state?: IOonpiaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: OonpiaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                prison: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOonpiaState;
            }
            if (state.game !== OonpiaGame.gameinfo.uid) {
                throw new Error(`The Oonpia engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OonpiaGame {
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
        this.prison = [...state.prison];
        this.boardSize = this.getBoardSize();
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 6;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): OonpiaGame {
        this.graph = this.getGraph();
        return this;
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
    }

    public getButtons(): ICustomButton[] {
        /* Only show pass button if there's enemy stones in the prison */
        if (this.prison[this.otherPlayer() - 1] > 0) {
            return [{ label: "pass", move: "pass" }];
        }
        return [];
    }

    /* Too slow */
    // public moves(player?: playerid): string[] {
    //     if (this.gameover) { return []; }
    //     if (player === undefined) {
    //         player = this.currplayer;
    //     }

    //     const moves: string[] = [];
    //     const empties = (this.graph.listCells() as string[]).filter(c => ! this.board.has(c)).sort();
    //     const blocked = this.blockedCells();
    //     for (const cell of empties) {
    //         if (!blocked[1].has(cell)) {
    //             if (this.isValidPlace(cell, 1)) {
    //                 moves.push(this.move2string({tile: 1, iscapture: false, cell: cell}));
    //             }
    //             if (this.isValidCapture(cell, 1)) {
    //                 moves.push(this.move2string({tile: 1, iscapture: true, cell: cell}));
    //             }
    //         }
    //         if (!blocked[2].has(cell)) {
    //             if (this.isValidPlace(cell, 2)) {
    //                 moves.push(this.move2string({tile: 2, iscapture: false, cell: cell}));
    //             }
    //             if (this.isValidCapture(cell, 2)) {
    //                 moves.push(this.move2string({tile: 2, iscapture: true, cell: cell}));
    //             }
    //         }
    //     }
    //     return moves;
    // }

    public randomMove(): string {
        if (this.stack.length === 1) {
            return randomInt(10).toString();
        }
        // Simulate a random click, it's not exhaustive but will give reasonable moves
        const blocked = this.blockedCells();
        const empties = new Set((this.graph.listCells() as string[]).filter(c => (
            !this.board.has(c) &&
            !(
                blocked[1].has(c) &&
                blocked[2].has(c)
            )
        )));
        while (empties.size) {
            const i = Math.floor(Math.random() * empties.size);
            const cell = [...empties][i];
            const [col, row] = this.graph.algebraic2coords(cell);
            const clickResult = this.handleClick("", row, col);
            if (clickResult.valid) {
                return clickResult.move
            }
            empties.delete(cell);
        }
        if (this.prison[this.otherPlayer() - 1] > 0) {
            return "pass"
        } else {
            return "";
        }
    }

    private preferDotted(cell: string): boolean {
        /* Check that all adjacent friendly stones are plain, so we want to default to placing
        a dotted stone next to them */
        const friendlyTiles = new Set(
            this.graph.neighbours(cell)
            .filter(c => this.board.has(c))
            .map(c => this.board.get(c))
            .filter(piece => piece![0] === this.currplayer)
            .map(piece => piece![1])
        );
        return friendlyTiles.size === 1 && [...friendlyTiles][0] === 1
    }

    private validateMoveAsClick(move: Move, oldms: string): IClickResult {
        const newms = this.move2string(move);
        const result = this.validateMove(newms) as IClickResult;
        if (result.valid) {
            result.move = newms;
        } else {
            result.move = oldms;
        }
        return result;
    }

    public handleClick(ms: string, row: number, col: number, piece?: string): IClickResult {
        if (this.stack.length === 1) {
            return {
                move: "",
                valid: true,
                message: i18next.t("apgames:validation.oonpia.BAD_KOMI", ms)
            };
        }

        let move = this.parseMoveString(ms);
        if (move === undefined) {
            return {
                move: ms,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", ms)
            };
        }

        if (row === -1) {
            /* Always reset if player clicks the legend */
            /* Handles both piece selection and passing (clicking the prison) */
            if (piece) {
                move = this.parseMoveString(piece);
                if (move === undefined) {
                    return {
                        move: ms,
                        valid: false,
                        message: i18next.t("apgames:validation._general.GENERIC", ms)
                    };
                } else {
                    return this.validateMoveAsClick(move, ms);
                }
            }
        }

        const cell = this.validateRowColAsCell(row, col);

        if (cell === undefined) {
            return {
                move: ms,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", ms)
            };
        }

        if (move.cell === undefined && move.tile !== undefined) {
            /* player has clicked the legend previously, so try to validate this specific
            piece and capture choice */
            move.cell = cell;
            return this.validateMoveAsClick(move, ms);
        }

        if (move.cell !== undefined && move.cell !== cell) {
            /* clicked again on other cell, reset */
            return this.handleClick("", row, col);
        }

        // First we build a list of all possible tile and capture combinations at this cell,
        // in the most likely default order.
        // Then we take the first if there is no piece yet, or cycle through the list if a placed
        // piece was clicked again.

        const place: tileid[] = [];
        const otherCap: tileid[] = [];
        const selfAndOtherCap: tileid[] = [];
        const selfCap: tileid[] = [];

        const addCaps = (tile: tileid) => {
            const self = this.isSelfCapture(cell, tile);
            const other = this.isOtherCapture(cell, tile);
            if (other && !self) {
                otherCap.push(tile);
            } else if (other && self) {
                selfAndOtherCap.push(tile);
            } else if (!other && self) {
                selfCap.push(tile);
            }
        }

        // First the normal placements:
        // - If a cell is blocked for one type by the arc rule, only the other type is valid
        // - Otherwise, if both types can be placed, prefer placing a connecting type
        //   - If there is no preferred connecting type start with type 1 and then type 2
        const blocked = this.blockedCells();
        
        if (blocked[1].has(cell) && !blocked[2].has(cell)) {
            if (this.isValidPlace(cell, 2)) {
                place.push(2);
            }
            addCaps(2);
        } else if (blocked[2].has(cell) && !blocked[1].has(cell)) {
            if (this.isValidPlace(cell, 1)) {
                place.push(1);
            }
            if (this.isValidCapture(cell, 1)) {
                addCaps(1);
            }
        } else {
            /* Both tiles are valid. If there are friendly neighbouring stones and they are
            of one type only, default to placing the other type to form a connection. */
            for (const tile of (this.preferDotted(cell) ? [2, 1] : [1, 2]) as tileid[]) {
                if (this.isValidPlace(cell, tile)) {
                    place.push(tile);
                }
            }
            for (const tile of [1, 2] as tileid[]) {
                if (this.isValidCapture(cell, tile)) {
                    addCaps(tile);
                }
            }
        }

        // Ordering:
        const possibleMoves: Move[] = [];
        for (const tile of otherCap) {
            possibleMoves.push({tile: tile, iscapture: true, cell: cell});
        }
        for (const tile of selfAndOtherCap) {
            possibleMoves.push({tile: tile, iscapture: true, cell: cell});
        }
        for (const tile of place) {
            possibleMoves.push({tile: tile, iscapture: false, cell: cell});
        }
        for (const tile of selfCap) {
            possibleMoves.push({tile: tile, iscapture: true, cell: cell});
        }


        if (possibleMoves.length === 0) {
            return {
                valid: false,
                message: i18next.t("apgames:validation.oonpia.INVALID_BOTH", {where: cell}),
                move: ms
            }
        }

        if (move.cell === undefined) {
            /* place a piece for the first time */
            return this.validateMoveAsClick(possibleMoves[0], ms);
        } else if (cell === move.cell) {
            /* clicked again on placed piece, cycle through types */
            let i = 0;
            for (; i < possibleMoves.length; i++) {
                if (possibleMoves[i].tile === move.tile && possibleMoves[i].iscapture === move.iscapture) {
                    break;
                }
            }
            const newi = (i + 1) % possibleMoves.length;
            return this.validateMoveAsClick(possibleMoves[newi], ms);
        }

        /* this shouldn't happen but the compiler doesn't know it */
        return this.validateMoveAsClick({tile: 1, iscapture: false, cell: cell}, ms);
    }

    private validateCell(ms: string): string | undefined {
        try {
            this.graph.algebraic2coords(ms);
            return ms;
        } catch {
            return undefined
        }
    }

    private validateRowColAsCell(row: number, col: number): string | undefined {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            return this.validateCell(cell);
        } catch {
            return undefined
        }
    }

    private parseKomiString(ms: string): Move | undefined {
        const komi = parseInt(ms);
        if (isNaN(komi) || komi < 0 || (! /^\d+$/.test(ms)) || komi > this.graph.graph.nodes().length) {
            return undefined;
        }
        return {komi: komi};
    }

    private parseMoveString(ms: string, move: Move = {}): Move | undefined {
        // the stone type (1 or 2) comes before the coordinate, e.g. 1c3 or 2c3
        // After that an 'X' if it's a capture using neutral stone, e.g. 1Xc3, 2Xc3
        // Return a Move object if it's valid, undefined if the string is invalid
        // This checks that a cell exists on the board, but not if it's occupied etc...
        if (ms === "" || ms === undefined) {
            return move;
        }
        if (ms === "pass") {
            return {pass: true};
        }
        if (move.tile === undefined) {
            const ts = ms.slice(0, 1);
            const rest = ms.slice(1);
            let tile: tileid;
            if (ts === "1") {
                tile = 1;
            } else if (ts === "2") {
                tile = 2;
            } else {
                return undefined;
            }
            return this.parseMoveString(rest, {tile: tile});
        }
        if (move.iscapture === undefined) {
            if (ms.startsWith("X")) {
                const rest = ms.slice(1);
                move.iscapture = true;
                return this.parseMoveString(rest, move);
            } else {
                move.iscapture = false;
                return this.parseMoveString(ms, move);
            }
        }
        if (move.cell === undefined) {
            const coords = this.validateCell(ms);
            if (coords === undefined) {
                return undefined;
            } else {
                move.cell = ms;
                return move;
            }
        }
        return undefined;
    }

    private move2string(move: Move): string {
        if (move.pass === true) {
            return "pass";
        } else {
            return `${move.tile || ''}${move.iscapture ? 'X' : ''}${move.cell || ''}`
        }
    }

    public validateMove(m: string): IValidationResult {
        if (this.stack.length === 1) { // Make a komi offer
            if (m === "") {
                return {
                    valid: true,
                    complete: -1,
                    message: i18next.t("apgames:validation.oonpia.INITIAL_INSTRUCTIONS_komi"),
                }
            }
            const move = this.parseKomiString(m);
            if (move === undefined) {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation.oonpia.BAD_KOMI")
                }
            } else {
                return {
                    valid: true,
                    complete: 1,
                    canrender: true,
                    message: i18next.t("apgames:validation._general.VALID_MOVE"),
                }
            }
        }

        const move = this.parseMoveString(m);
        if (move === undefined) {
            return {
                valid: false,
                message: i18next.t("apgames:validation._general.INVALID_MOVE", { move: m })
            }
        }
        if (move.pass === true) {
            if (this.prison[this.otherPlayer() - 1] === 0) {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation.asli.BAD_PASS")
                }
            } else {
                return {
                    valid: true,
                    complete: 1,
                    canrender: true,
                    message: i18next.t("apgames:validation._general.VALID_MOVE"),
                }
            }
        }
        if (move.tile === undefined) {
            return {
                valid: true,
                complete: -1,
                canrender: true,
                message: i18next.t("apgames:validation.oonpia.INITIAL_INSTRUCTIONS"),
            }
        }
        if (move.iscapture === undefined || move.cell === undefined) {
            return {
                valid: true,
                complete: -1,
                canrender: false,
                message: i18next.t("apgames:validation.oonpia.DESTINATION")
            }
        }

        /* from here on out we know that the move string is valid and complete */

        if (this.board.has(move.cell)) {
            return {
                valid: false,
                message: i18next.t("apgames:validation._general.OCCUPIED", {where: move.cell})
            }
        }
        const blockedCells = this.blockedCells();
        if (blockedCells[move.tile].has(move.cell)) {
            return {
                valid: false,
                message: i18next.t("apgames:validation.oonpia.ARC")
            }
        }

        if (move.iscapture) {
            if (this.isValidCapture(move.cell, move.tile)) {
                return {
                    valid: true,
                    complete: 1,
                    message: i18next.t("apgames:validation._general.VALID_MOVE")
                }
            } else {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation.oonpia.INVALID_CAPTURE")
                }
            }
        } else {
            if (this.isValidPlace(move.cell, move.tile)) {
                return {
                    valid: true,
                    complete: 1,
                    message: i18next.t("apgames:validation._general.VALID_MOVE")
                }
            } else {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation.oonpia.INVALID_PLACE")
                }
            }
        }
    }

    public move(ms: string, { partial = false, trusted = false } = {}): OonpiaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (!trusted) {
            const result = this.validateMove(ms);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        if (this.stack.length === 1) { // Make komi offer
            const move = this.parseKomiString(ms);
            if (move === undefined) {
                throw new UserFacingError("VALIDATION_GENERAL", "Invalid movestring encountered.");
            }
            if (move.komi === undefined) { return this; } // Partial move
            this.prison[1] = move.komi;
            this.results.push({type: "komi", value: move.komi});
        } else {
            const move = this.parseMoveString(ms);
            
            if (move === undefined) {
                throw new UserFacingError("VALIDATION_GENERAL", "Invalid movestring encountered.");
            }

            if (move.pass === true) {
                this.prison[this.otherPlayer() - 1] -= 1;
                this.results.push({type: "pass"});
            } else {
                if (move.cell === undefined || move.tile === undefined) { return this; } // Partial move

                this.results = [];
                this.board.set(move.cell, [move.iscapture ? this.neutral : this.currplayer, move.tile]);
                this.results.push({type: "place", where: move.cell, what: move.tile === 1 ? tileNames[0] : tileNames[1]});

                
                // First capture other player's groups, then your own (if any)
                if (move.iscapture) {
                    for (const group of this.deadGroups(this.otherPlayer())) {
                        for (const cell of group) {
                            this.board.delete(cell);
                        }
                        this.results.push({type: "capture", where: Array.from(group).join(","), count: group.size});
                        this.prison[this.otherPlayer() - 1] += group.size;
                    }
                    
                    for (const group of this.deadGroups(this.currplayer)) {
                        for (const cell of group) {
                            this.board.delete(cell);
                        }
                        this.results.push({type: "capture", where: Array.from(group).join(","), count: group.size});
                        this.prison[this.currplayer - 1] += group.size;
                    }
                }
            }
        }
        
        this.reducePrison();

        if (partial) { return this; }
        
        this.lastmove = ms;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private pieces(player: playerid, board = this.board): string[] {
        // Get all pieces owned by `player`
        return [...board.entries()].filter(e => (e[1][0] === player)).map(e => e[0]);
    }

    private getGroups(player: playerid, board = this.board): Set<string>[] {
        // In oonpia only alternating types are connected, so dotted pieces only connect with undotted, and vice versa.

        // Get groups of cells that are connected to `cell` and owned by `player`.
        const groups: Set<string>[] = [];
        const pieces = this.pieces(player, board);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                const myTile = board.get(cell)![1];
                for (const n of neighbours) {
                    if (pieces.includes(n) && board.get(n)![1] != myTile) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    private blockedCells(board = this.board): {1: Set<string>, 2: Set<string>} {
        // Return all cells blocked for playing plain resp. dotted stones (by the placement restriction
        // that no 4-arc of same-type stones may occur)

        // - Iterate over all cells
        // - For each cell look at the neighbours in clockwise direction
        // - For each of these neighbours check whether it forms an arc together with the previous
        //    and/or subsequent neighbours

        const cells = this.graph.listCells() as string[];
        const blockedPlain: Set<string> = new Set();
        const blockedDotted: Set<string> = new Set();
        for (const cell of cells) {
            const neighbours = this.graph.neighbours(cell);
            if (neighbours.length < 4 || neighbours.filter(n => board.has(n)).length < 3) {
                continue;
            }
            for (const type of [1, 2] as tileid[]){
                for (const [baseI, baseDir] of HexTriGraph.directions.entries()) {
                    const nbCoords = this.graph.move(...this.graph.algebraic2coords(cell), baseDir);
                    if (nbCoords === undefined) { continue; }
                    const nb = this.graph.coords2algebraic(...nbCoords);
                    if (board.has(nb)) { continue; }
                    // Checking for 4-arcs in the circular (clockwise) neighbours around this cell at all offsets
                    let arc = false;
                    for (let offsetI = 3; offsetI <= 6; offsetI++) { // going from 3 to 6 instead of -3 to 0, because modulo of negative numbers in js is bugged
                        let arcAtOffset = true;
                        for (let i = 0; i < 4; i++) {
                            const iterDir = HexTriGraph.directions[(baseI + offsetI + i) % 6];
                            if (iterDir === baseDir) { continue; }
                            const offsetNbCoords = this.graph.move(...this.graph.algebraic2coords(cell), iterDir);
                            if (offsetNbCoords === undefined) {
                                arcAtOffset = false;
                                break;
                            } else {
                                const iCell = this.graph.coords2algebraic(...offsetNbCoords);
                                if (!board.has(iCell) || board.get(iCell)![1] !== type) {
                                    arcAtOffset = false;
                                    break;
                                }
                            }
                        }
                        if (arcAtOffset) {
                            arc = true;
                            break;
                        }
                    }
                    if (arc) {
                        (type === 1 ? blockedPlain : blockedDotted).add(nb);
                    }
                }
            }
        }
        return {1: blockedPlain, 2: blockedDotted};
    }

    private deadGroups(player: playerid, board = this.board): Set<string>[] {
        // Get all groups owned by `player` that are captured.
        const captured: Set<string>[] = [];
        const groups = this.getGroups(player, board);
        const blocked = this.blockedCells(board);
        loop:
        for (const group of groups) {
            for (const cell of group) {
                for (const n of this.graph.neighbours(cell)) {
                    if (!board.has(n)) {
                        const myTile = board.get(cell)![1];
                        const needTile = myTile === 1 ? 2 : 1;
                        if (!blocked[needTile].has(n)) {
                            continue loop;
                        }
                    }
                }
            }
            captured.push(group);
        }
        return captured;
    }

    private isValidPlace(cell: string, tile: tileid): boolean {
        // It's a valid placement of a player (non-blue) stone, i.e. no groups will be captured
        const tmpboard = new Map(this.board);
        tmpboard.set(cell, [this.currplayer, tile]);
        const result = (
            this.deadGroups(this.otherPlayer(), tmpboard).length === 0 &&
            this.deadGroups(this.currplayer, tmpboard).length === 0
        )
        return result;
    }

    private isValidCapture(cell: string, tile: tileid): boolean {
        // It's a valid capture (i.e. blue stone placement), at least one stone (friendly or not) 
        // will be captured
        const tmpboard = new Map(this.board);
        tmpboard.set(cell, [this.neutral, tile]);
        return (
            this.deadGroups(this.otherPlayer(), tmpboard).length > 0 ||
            this.deadGroups(this.currplayer, tmpboard).length > 0
        )
    }
    
    private isSelfCapture(cell: string, tile: tileid): boolean {
        const tmpboard = new Map(this.board);
        tmpboard.set(cell, [this.neutral, tile]);
        for (const group of this.deadGroups(this.otherPlayer(), tmpboard)) {
            for (const cell of group) {
                tmpboard.delete(cell);
            }
        }
        return this.deadGroups(this.currplayer, tmpboard).length > 0
    }

    private isOtherCapture(cell: string, tile: tileid): boolean {
        const tmpboard = new Map(this.board);
        tmpboard.set(cell, [this.neutral, tile]);
        return this.deadGroups(this.otherPlayer(), tmpboard).length > 0
    }

    private reducePrison(): void {
        const min = Math.min(...this.prison);
        this.prison = this.prison.map(n => n - min) as [number,number];
    }

    protected checkEOG(): OonpiaGame {
        // Bluestone rules: "If you move to the prison the last enemy group on
        // the board, you win. Otherwise, if you move to the prison the last
        // friendly group on the board, you lose."
        if (this.stack.length > 2) {
            const friendly = this.pieces(this.currplayer).length;
            const enemy = this.pieces(this.otherPlayer()).length;
            if (enemy === 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            } else if (friendly === 0) {
                this.gameover = true;
                this.winner = [this.otherPlayer()];
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

    public state(): IOonpiaState {
        return {
            game: OonpiaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OonpiaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            prison: [...this.prison],
        };
    }


    public getPlayerColour(p: playerid): number|string {
        // previous versions, just return the player id
        if (this.usePalette) {
            return p;
        } else {
            return {1: "#eeeeee", 2: "#252525", 3: "#0165fc"}[p] // colours from besogo viewer
        }
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let highlightBlocked = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "palette_no_blocked_no") {
                this.usePalette = false;
                highlightBlocked = false;
            }
            if (altDisplay === "palette_yes_blocked_yes") {
                this.usePalette = true;
                highlightBlocked = true;
            }
            if (altDisplay === "palette_yes_blocked_no") {
                this.usePalette = true;
                highlightBlocked = false;
            }
        }

        const p1 = this.getPlayerColour(1);
        const p2 = this.getPlayerColour(2);
        const p3 = this.getPlayerColour(3);

        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, tile] = this.board.get(cell)!;
                    if (player === 1) {
                        if (tile === 1) {
                            pieces.push("A");
                        } else {
                            pieces.push("B");
                        }
                    } else if (player === 2) {
                        if (tile === 1) {
                            pieces.push("C");
                        } else {
                            pieces.push("D");
                        }
                    } else {
                        if (tile === 1) {
                            pieces.push("E");
                        } else {
                            pieces.push("F");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const s = this.boardSize - 1;
        const boardcol = this.usePalette ? 4 : "#e0bb6c";
        const boardEdgeW = 55;

        const hasPrison = this.prison.reduce((prev, curr) => prev + curr, 0) > 0;
        const prisonPiece: Glyph[] = [];
        if (hasPrison) {
            prisonPiece.push({
                name: "piece-borderless",
                colour: this.prison[0] > 0 ? p1 : p2,
                scale: 0.85,
            });
            prisonPiece.push({
                text: this.prison[0] > 0 ? this.prison[0].toString() : this.prison[1].toString(),
                colour: {
                            func: "bestContrast",
                            bg: this.prison[0] > 0 ? p1 : p2,
                            fg: ["#000000", "#ffffff"],
                        },
                scale: 0.7,
                rotate: null,
            });
        } else {
            prisonPiece.push({
                name: "piece-borderless",
                colour: "_context_background",
                scale: 0.85,
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                strokeWeight: 0.5,
                markers: [
                    {
                        type: "shading",
                        belowGrid: true,
                        points: [
                            { row: 0, col: 0 },
                            { row: 0, col: s },
                            { row: s, col: s*2 },
                            { row: s*2, col: s },
                            { row: s*2, col: 0 },
                            { row: s, col: 0 },
                        ],
                        colour: boardcol,
                        opacity: 1,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: 0, col: 0 },
                            { row: 0, col: s}
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: 0, col: s },
                            { row: s, col: s*2 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s, col: s*2 },
                            { row: s*2, col: s },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s*2, col: s },
                            { row: s*2, col: 0 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s*2, col: 0 },
                            { row: s, col: 0 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s, col: 0 },
                            { row: 0, col: 0 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    }
                ]
            },
            legend: {
                A: {name: "piece-borderless", colour: p1, scale: 1.1},
                B: [
                    {name: "piece-borderless", colour: p1, scale: 1.1},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: p1,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.363, opacity: 0.5}
                ],
                C: {name: "piece-borderless", colour: p2, scale: 1.1},
                D: [
                    {name: "piece-borderless", colour: p2, scale: 1.1},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: p2,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.363, opacity: 0.5}
                ],
                E: {name: "piece-borderless", colour: p3, scale: 1.1},
                F: [
                    {name: "piece-borderless", colour: p3, scale: 1.1},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: p3,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.33, opacity: 0.5}
                ],
                G: {name: "piece-borderless", colour: p1, scale: 1.0}, // G-K are just for the key
                H: [
                    {name: "piece-borderless", colour: p1, scale: 1.0},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: p1,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.33, opacity: 0.5}
                ],
                I: {name: "piece-borderless", colour: p2, scale: 1.0},
                J: [
                    {name: "piece-borderless", colour: p2, scale: 1.0},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: p2,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.33, opacity: 0.5}
                ],
                K: {name: "piece-borderless", colour: p3, scale: 1.0},
                L: [
                    {name: "piece-borderless", colour: p3, scale: 1.0},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: p3,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.33, opacity: 0.5}
                ],
                P: prisonPiece as [Glyph, ...Glyph[]],
                Q: {
                    name: "piece-borderless",
                    colour: "_context_background",
                    scale: 0.85,
                }
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        if (this.stack.length !== 1) {
            // Add key so the user can click to select the color to place
            const key: AreaKey = {
                type: "key",
                position: "left",
                height: 0.7,
                list: [
                    { piece: "P", name: "", value: "pass"},
                    { piece: "Q", name: ""},
                    { piece: this.currplayer === 1 ? "G" : "I", name: "", value: "1" },
                    { piece: this.currplayer === 1 ? "H" : "J", name: "", value: "2" },
                    { piece: "K", name: "", value: "1X" },
                    { piece: "L", name: "", value: "2X" },
                ],
                clickable: true,
            };
            rep.areas = [key];
        }

        if (highlightBlocked) {
            const {1: blockedPlain, 2: blockedDotted} = this.blockedCells();
            for (const cell of blockedPlain) {
                const [x, y] = this.graph.algebraic2coords(cell);
                if ("markers" in (rep.board! as BoardBasic)) { // make the compiler happy
                    ((rep.board! as BoardBasic).markers!).push({
                                type: "dots",
                                points: [{row: y, col: x}],
                                colour: "#000",
                                opacity: 0.2,
                                size: 0.3
                            })
                }
            }
            for (const cell of blockedDotted) {
                const [x, y] = this.graph.algebraic2coords(cell);
                if ("markers" in (rep.board! as BoardBasic)) { // make the compiler happy
                    ((rep.board! as BoardBasic).markers!).push({
                                type: "dots",
                                points: [{row: y, col: x}],
                                colour: "#000",
                                opacity: 0.2,
                                size: 0.9
                            })
                }
            }
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const targets: {row: number, col: number}[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
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
        status += "**Prison**: " + this.prison.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.oonpia", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.oonpia", {player, count: r.count, what: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): OonpiaGame {
        return new OonpiaGame(this.serialize());
    }
}
