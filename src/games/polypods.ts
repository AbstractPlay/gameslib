
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, BoardBasic, Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";
import { dfsFromNode } from 'graphology-traversal';
import { IGraph, SnubSquareGraph } from "../common/graphs/index.js";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Place a piece on an empty space.",
        DEADPOLYPOD: "Invalid placement: the resulting polypod would have more cores than feet.",
        ENEMYCORE: "You may not place next to an opponent core.",
        NOFOLLOWUP: "Energized Polypods: when eating a remains marker, a valid bonus move must be available next to the same polypod.",
        BONUS: "Energized: you must make an additional placement on an empty cell adjacent to the active polypod.",
        BONUS_INVALID: "Not a valid second action: ",
        BONUSNOREMAINS: "The second placement of a multi-action turn may not be on a remains marker.",
        BONUS_NOT_ADJACENT: "The second placement of must be adjacent to the active polypod.",
        MUSTEAT: "The first placement of a multi-action turn must be on a remains marker.",
        SCAVENGING_MARKER: "Scavenging: you may only place on a remains marker if no attack would occur.",
        SELECTREMAINS: "Scavenging: after a non-attacking move, select an adjacent remains marker to remove (if available).",
        SELECTREMAINSINVALID: "Scavenging: you must select one of the remains markers adjacent to the placed piece.",
        SCAVENGEDOUBLE: "Scavenging: a double move can only happen when not attacking, and then eating an adjacent remains marker."
    },
    variants: {
        "size-6": {
            name: "6x6 board",
        },
        "size-7": {
            name: "7x7 board",
        },
        "#size": {
            name: "8x8 board",
        },
        "size-9": {
            name: "9x9 board",
        },
        "size-10": {
            name: "10x10 board",
        },
        "size-11": {
            name: "11x11 board",
        },
        "size-12": {
            name: "12x12 board",
        },
        "#variant": {
            description: "Directly attacked feet leave permanent remains.",
            name: "Polypods Base Game"
        },
        "stoney-footed": {
            description: "All removed feet leave permanent remains.",
            name: "Stoney-footed Polypods"
        },
        "energized": {
            description: "Eating remains gives a double move.",
            name: "Energized Polypods"
        },
        "scavenging": {
            description: "Every removed piece leaves remains. Placing next to (or on) a remains marker eats one, but a move that eats can't also attack.",
            name: "Scavenging Polypods"
        },
    },
};


export type playerid = 1|2;
export type piecetype = "core"|"foot";
export type cellcontent = {
    player: playerid,
    type: piecetype
};
export type board = Map<string, cellcontent>;
export type remains = Set<string>;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: board;
    remains: remains;
    lastmove?: string;
};

export interface IPolypodsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PolypodsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Polypods",
        uid: "polypods",
        playercounts: [2],
        version: "20261111",
        dateAdded: "2026-11-11",
        description: "Polypods are creatures of the snub-square grid. They are composed of connected pieces of 2 types: core and feet. Feet are the extremities, i.e. the pieces with only one similarly-colored adjacent piece, or with exactly 2 that fill the other points of a small triangle of the grid. Core are the other pieces that connect all the feet together. Cores are toxic to the feet of adjacent opponent polypods. Polypods need to have at least as many feet as cores to stay alive. The game of Polypods is about growing and protecting polypods of your colour so that you have the most polypod cores when the game ends. Some removed pieces leave remains. Variants differ in when exactly remains are generated, and how they affect further play.",
        urls: [
            "https://boardgamegeek.com/boardgame/466344/polypods"
        ],
        bggid: "466344",
        people: [
            {
                type: "designer",
                name: "Dale Walton",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1988/dale-walton"],
                apid: "1f26a119-d9a4-4ff1-bbc7-ec599c07ea1e",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        variants: [
            {
                uid: "size-6",
                group: "size"
            },
            {
                uid: "size-7",
                group: "size"
            },
            { uid: "#size" },
            {
                uid: "size-9",
                group: "size"
            },
            {
                uid: "size-10",
                group: "size"
            },
            {
                uid: "size-11",
                group: "size"
            },
            {
                uid: "size-12",
                group: "size"
            },
            { uid: "#variant" },
            {
                uid: "stoney-footed",
                group: "variant",
            },
            {
                uid: "energized",
                group: "variant",
            },
            {
                uid: "scavenging",
                group: "variant",
            },

        ],
        customizations: [
            {
                num: 1,
                default: "#007f00",
                explanation: "Player 1 colour",
                player: 1
            },
            {
                num: 2,
                default: "#ffffff",
                explanation: "Player 2 colour",
                player: 2
            },
            {
                num: 3,
                default: "#777777",
                explanation: "Colour of the remains markers"
            },
            {
                name: "board",
                default: "#cfc39e",
                explanation: "Board colour"
            }
        ],
        categories: ["goal>score>eog", "goal>majority", "mechanic>place", "board>shape>rect", "board>connect>snub"],
        flags: ["scores", "automove", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: board;
    public remains: remains = new Set<string>();
    public boardsize = 8;
    public graph: IGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public applyVariants(variants?: string[]) {
        this.variants = (variants !== undefined) ? [...variants] : [];
        for(const v of this.variants) {
            if(v.startsWith("size")) {
                const [,size] = v.split("-");
                this.boardsize = parseInt(size, 10);
                this.graph = this.getGraph();
            }
        }
    }

    constructor(state?: IPolypodsState | string, variants?: string[]) {
        super();

        if (state === undefined) {
            this.applyVariants(variants);
            const fresh: IMoveState = {
                _version: PolypodsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, cellcontent>(),
                remains: new Set<string>,
            };
            this.stack = [fresh];

        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPolypodsState;
            }
            if (state.game !== PolypodsGame.gameinfo.uid) {
                throw new Error(`The Polypods engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.applyVariants(state.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PolypodsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];

        this.currplayer = state.currplayer;
        this.board = cloneState(state.board) as board;
        this.remains = cloneState(state.remains) as remains;
        this.lastmove = state.lastmove;
        return this;
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
    }

    private getGraph(): IGraph {
        const graph = new SnubSquareGraph(this.boardsize, this.boardsize, "T");
        graph.graph.dropNode(graph.coords2algebraic(0, 0));
        if (this.boardsize % 2 === 0) {
            graph.graph.dropNode(graph.coords2algebraic(this.boardsize-1, this.boardsize-1));
        }
        return graph;
    }

    public updatePolypods(board: board): board {
        /* Set the pieces to feet or core depending on friendly connectivity */
        const newBoard = cloneState(board) as board;
        newBoard.forEach((piece, cell) => {
            const neighbours = this.graph.neighbours(cell).filter((cell) => (
                newBoard.has(cell) && newBoard.get(cell)!.player === piece.player));
            if (neighbours.length <= 1) {
                piece.type = "foot";
            } else if (neighbours.length === 2) {
                // In this case have to check if it's a small triangle
                if (this.graph.graph.hasEdge(neighbours[0], neighbours[1])) {
                    piece.type = "foot";
                } else {
                    piece.type = "core";
                }
            } else {
                piece.type = "core";
            }
        });
        return newBoard;
    }

    private polypodAt(board: board, startCell: string): Set<string> {
        /* Return the polypod that includes the given cell */
        const polypod = new Set<string>();
        if (!board.has(startCell)) {
            return polypod;
        } else {
            const thisPlayer = board.get(startCell)!.player;
            dfsFromNode(this.graph.graph, startCell, (c) => {
                if (board.has(c) && board.get(c)!.player === thisPlayer ) {
                    polypod.add(c);
                    return false;
                } else {
                    return true;
                }
            });
        }
        return polypod;
    }

    private allPolypods(board: board): Set<string>[] {
        /* Return an array of all polypods */
        const polypods: Set<string>[] = [];
        const tmpBoard = new Map(board);
        while (tmpBoard.size >= 0) {
            const anyCell = tmpBoard.keys().next().value;
            if (anyCell === undefined) { break; }
            const polypod = this.polypodAt(board, anyCell);
            polypods.push(polypod);
            polypod.forEach((c) => {tmpBoard.delete(c)});
        }
        return polypods;
    }

    private polypodAlive(board: board, polypod: Set<string>): boolean {
        /* Check if a polypod is alive i.e. has at least as many feet as cores */
        const cores = [...polypod].filter((c) => (board.get(c)!.type === "core")).length;
        const feet = [...polypod].filter((c) => (board.get(c)!.type === "foot")).length;
        return feet >= cores;
    }

    private removeDeadPolypods(board: board, remains: remains, attacked: Set<string>): [board, remains, Set<string>] {
        /* Remove polypods that have more cores than feet */
        const newBoard = cloneState(board) as board;
        let newRemains = cloneState(remains) as remains;
        const captured = new Set<string>;
        const capturedFeet = new Set<string>;
        this.allPolypods(newBoard).forEach((polypod) => {
            if (!this.polypodAlive(newBoard, polypod)) {
                polypod.forEach((c) => {
                    newBoard.delete(c);
                    captured.add(c);
                    if (this.board.get(c)!.type === "foot") {
                        capturedFeet.add(c);
                    }
                });
            }
        });

        if (this.variants.includes("stoney-footed") || this.variants.includes("energized")) {
            /* In these variants all removed feet (including downgraded cores from the same turn)
            get turned into remains */
            for (const cell of captured) {
                if (capturedFeet.has(cell)){
                    newRemains.add(cell);
                }
            }
        }
        if (this.variants.includes("energized")) {
            /* "When a polypod dies, remains must also be added to the dying core locations
            that are adjacent to the feet that were initially attacked." */
            for (const attackedFoot of attacked) {
                for (const nb of this.graph.neighbours(attackedFoot)) {
                    if (captured.has(nb) && board.get(nb)!.type === "core") { // The original board!
                        newRemains.add(nb);
                    }
                }
            }
        }
        if (this.variants.includes("scavenging")) {
            /* In this variant all removed pieces are converted to remains */
            newRemains = new Set([...newRemains, ...captured]);
        }


        return [newBoard, newRemains, captured];
    }

    private attackFeet(board: board, remains: remains): [board, remains, Set<string>] {
        /* Remove any feet which are next to enemy cores */
        const newBoard = cloneState(board) as board;
        const newRemains = cloneState(remains) as remains;
        const attacked = new Set<string>;
        board.forEach((footPiece, footCell) => {
            if (footPiece.type === "foot") {
                for (const nb of this.graph.neighbours(footCell)) {
                    if (board.has(nb) && board.get(nb)!.type === "core"
                            && board.get(nb)!.player !== footPiece.player){
                        newBoard.delete(footCell);
                        newRemains.add(footCell);
                        attacked.add(footCell);
                    }
                }
            }
        });
        return [newBoard, newRemains, attacked];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove;
            if (move === "") {
                newmove = cell;
            } else {
                newmove = move + ";" + cell;
            }
            let result = this.validateMove(newmove) as IClickResult;
            /* In the scavenging variant, if a remains marker must be selected
            and there is exactly 1 available, automatically select it */
            if (!newmove.includes(";") && this.variants.includes("scavenging") && result.complete === -1) {
                const adjRemains: string[] = [];
                for (const nb of this.graph.neighbours(cell)) {
                    if (this.remains.has(nb)) {
                        adjRemains.push(nb);
                    }
                }
                if (adjRemains.length === 1) {
                    newmove += ";" + adjRemains[0];
                    result = this.validateMove(newmove) as IClickResult;
                }
            }
            /* In the energized variant, if a bonus move must be selected
            and there is exactly 1 available, automatically select it */
            if (!newmove.includes(";") && this.variants.includes("energized") && result.complete === -1) {
                const [boardAfter, remainsAfter] = this.applyMove(newmove, this.board, this.remains);
                const activePolypod = this.polypodAt(boardAfter, newmove);
                const adjacentCells = new Set<string>;
                for (const cell of activePolypod) {
                    for (const nb of this.graph.neighbours(cell)) {
                        if (!activePolypod.has(nb)) {
                            adjacentCells.add(nb);
                        }
                    }
                }
                const bonusMoves: string[] = [];
                for (const adjCell of adjacentCells) {
                    if (this.isValidBonusMove(adjCell, boardAfter, remainsAfter).valid) {
                        bonusMoves.push(adjCell);
                    }
                }
                if (bonusMoves.length === 1) {
                    newmove += ";" + bonusMoves[0];
                }
            }

            if (! result.valid) {
                result.move = move;
                if (move !== "") {
                    result.canrender = true;
                }
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

    private polypodAliveAfter(board: board, cell: string): boolean {
        /* Check that the grown polypod is still alive */
        let boardAfter = cloneState(board) as board;
        boardAfter.set(cell, {player: this.currplayer, type: "foot"});
        boardAfter = this.updatePolypods(boardAfter);
        return this.polypodAlive(boardAfter, this.polypodAt(boardAfter, cell));
    }

    private validPlacement(cell: string, board: board, remains: remains): IValidationResult {
        /* Check whether a single placement is valid. Does not check whether a valid followup move
        is available for energized polypods. */
        if (!this.graph.graph.hasNode(cell)) {
            return {valid: false, message: i18next.t("apgames:validation._general.INVALIDCELL", {cell})};
        }

        /* In the energized variant, you may place on top of a marker under some conditions */
        if (this.variants.includes("energized")) {
            if (board.has(cell)) {
                return {valid: false, message: i18next.t("apgames:validation._general.OCCUPIED", {where: cell})};
            }
        } else if (board.has(cell) || (remains.has(cell) && !this.variants.includes("scavenging"))) {
            // In scavenging a placement may be on a remains under some conditions, this will be checked separately
            return {valid: false, message: i18next.t("apgames:validation._general.OCCUPIED", {where: cell})};
        }

        // Check placement is not next to enemy core
        for( const c of this.graph.neighbours(cell)) {
            const nb = board.get(c);
            if (nb != undefined && nb.player === this.otherPlayer() && nb.type === "core") {
                return {valid: false, message: i18next.t("apgames:validation.polypods.ENEMYCORE", {where: cell})};
            }
        }

        if (!this.polypodAliveAfter(board, cell)) {
            return {valid: false, message: i18next.t("apgames:validation.polypods.DEADPOLYPOD", {where: cell})};
        }
        
        return {valid: true, message: i18next.t("apgames:validation._general.VALID_MOVE")};
    }

    private isValidBonusMove(cell: string, board: board, remains: remains): IValidationResult {
        /* Note, does not check that the move is adjacent to the active polypod, this must be checked
        separately */
        if (!(board.has(cell) || remains.has(cell))) {
            const bonusResult = this.validPlacement(cell, board, remains);
            return bonusResult
        } else if (remains.has(cell)) {
            return {valid: false, message: i18next.t("apgames:validation.polypods.BONUSNOREMAINS")};
        } else {
            return {valid: false, message: i18next.t("apgames:validation._general.OCCUPIED", {where: cell})};
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.polypods.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const moves = m.split(";");
        if (moves.length === 2 && this.variants.includes("energized")) {
            /* First move must consume a marker */
            const firstResult = this.validateMove(moves[0]);
            if (firstResult.valid === false) {
                return firstResult;
            };
            if (firstResult.complete !== -1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.polypods.MUSTEAT");
                return result;
            }
            /* First move is valid so now validate the 2nd (bonus) move */
            const [boardAfter, remainsAfter] = this.applyMove(moves[0], this.board, this.remains);
            const activePolypod = this.polypodAt(boardAfter, moves[0]);
            const adjacentCells = new Set<string>;
            for (const cell of activePolypod) {
                for (const nb of this.graph.neighbours(cell)) {
                    if (!activePolypod.has(nb)) {
                        adjacentCells.add(nb);
                    }
                }
            }
            const bonusResult = this.isValidBonusMove(moves[1], boardAfter, remainsAfter);
            if (bonusResult.valid && adjacentCells.has(moves[1])) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else if (!adjacentCells.has(moves[1])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.polypods.BONUS_NOT_ADJACENT");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.polypods.BONUS_INVALID") + bonusResult.message;
                return result;
            }
        } else if (moves.length === 2 && this.variants.includes("scavenging")) {
            /* First move must be on an empty space and not attack */
            const firstResult = this.validateMove(moves[0]);
            if (firstResult.valid === false) {
                return firstResult;
            };
            if (firstResult.complete !== -1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.polypods.SCAVENGEDOUBLE");
                return result;
            }
            /* Second action must select an adjacent remains marker */
            if (this.remains.has(moves[1]) && this.graph.graph.hasEdge(moves[0], moves[1])) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.polypods.SELECTREMAINSINVALID");
                return result;
            }
        }else if (moves.length !== 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE");
            return result;
        }

        const cell = m;

        const placeResult = this.validPlacement(cell, this.board, this.remains);
        if (!placeResult.valid) {
            return placeResult;
        }

        if (this.variants.includes("energized") && this.remains.has(cell)) {
            // This move energizes the piece, check that a valid followup move is available
            const [boardAfter, remainsAfter] = this.applyMove(cell, this.board, this.remains);
            
            const polypod = this.polypodAt(boardAfter, cell);
            let validBonusMove = false;
            for (const cell of polypod) {
                for (const nb of this.graph.neighbours(cell)) {
                    if (this.isValidBonusMove(nb, boardAfter, remainsAfter).valid) {
                        validBonusMove = true;
                        break;
                    }
                }
                if (validBonusMove) { break; }
            }

            if (!validBonusMove) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.polypods.NOFOLLOWUP");
                return result;
            } else {
                result.valid = true;
                result.message = i18next.t("apgames:validation.polypods.BONUS");
                result.complete = -1;
                result.canrender = true;
                return result;
            }
        }

        if (this.variants.includes("scavenging")) {
            /* Four possibilities:
            - Move that doesn't attack and doesn't consume a marker (since none are around)
            - Move that doesn't attack and consumes an adjacent marker
            - Move that doesn't attack and consumes a marker at its own location
            - Move that does attack and does not consume a marker
            */
            const attack = this.isAttackingMove(cell);
            const onRemains = this.remains.has(cell);
            let remainsAround = false;
            for (const nb of this.graph.neighbours(cell)) {
                if (this.remains.has(nb)) {
                    remainsAround = true;
                    break;
                }
            }

            if (attack) {
                if (onRemains) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.polypods.SCAVENGING_MARKER");
                    return result;
                } else {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            } else {
                if (onRemains) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    if (remainsAround) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.polypods.SELECTREMAINS");
                        return result;
                    } else {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }
                }
            }
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private applyMove(cell: string, board: board, remains: remains): [board, remains, Set<string>, Set<string>] {
        let newBoard = cloneState(board) as board;
        newBoard.set(cell, {player: this.currplayer, type: "foot"});
        newBoard = this.updatePolypods(newBoard);
        let newRemains: remains
        let attacked: Set<string>;
        [newBoard, newRemains, attacked] = this.attackFeet(newBoard, remains);
        newBoard = this.updatePolypods(newBoard);
        let captured: Set<string>;
        [newBoard, newRemains, captured] = this.removeDeadPolypods(newBoard, newRemains, attacked);
        if (this.variants.includes("scavenging")) {
            newRemains.delete(cell);
        }
        return [newBoard, newRemains, attacked, captured];
    }

    private isAttackingMove(cell: string): boolean {
        let newBoard = cloneState(this.board) as board;
        newBoard.set(cell, {player: this.currplayer, type: "foot"});
        newBoard = this.updatePolypods(newBoard);
        const [_board, _remains, attacked] = this.attackFeet(newBoard, this.remains);
        return (attacked.size > 0);
    }

    public move(m: string, {partial = false, trusted = false} = {}): PolypodsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        let oldBoard: board = cloneState(this.board) as board;
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            let attacked: Set<string>;
            let captured: Set<string>;
            const moves = m.split(";");
            if (moves.length === 2 && this.variants.includes("energized")) {
                // energized double-move
                const [board1, remains1, attacked1, captured1] = this.applyMove(moves[0], this.board, this.remains);
                remains1.delete(moves[0]);
                let attacked2;
                let captured2;
                [this.board, this.remains, attacked2, captured2] = this.applyMove(moves[1], board1, remains1);
                attacked = new Set([...attacked1, ...attacked2]);
                captured = new Set([...captured1, ...captured2]);
            } else if (moves.length === 2 && this.variants.includes("scavenging")) {
                // Scavenging move that removes a marker
                [this.board, this.remains, attacked, captured] = this.applyMove(moves[0], this.board, this.remains);
                this.remains.delete(moves[1]);
            } else {
                // single placement
                [this.board, this.remains, attacked, captured] = this.applyMove(m, this.board, this.remains);
            }

            if (partial) { return this; }

            this.results.push({type: "place", where: m.replace(";", ",")});
            // Annotate feet upgraded to cores, and cores downgraded to feet.
            oldBoard.forEach((piece, cell) => {
                if (oldBoard.has(cell) && this.board.has(cell)) {
                    if (oldBoard.get(cell)!.type !== this.board.get(cell)!.type) {
                        this.results.push({type: "capture", where: cell});
                    }
                }
            });
            const allCaptured = [...attacked, ...captured];
            for (const cell of allCaptured) {
                this.results.push({type: attacked.has(cell) ? "place" : "capture", where: cell});
            }
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.otherPlayer();

        this.checkEOG();
        this.saveState();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        const moves: string[] = [];

        const validCells = new Set<string>(this.graph.graph.nodes().filter((c) => (
            !this.board.has(c) && !this.remains.has(c))));
        const nextToEnemyCore = new Set<string>; // These are always disallowed
        const nextToFriendlyPiece = new Set<string>; // These must be checked separately for polypod deaths
        this.graph.graph.nodes().forEach((cell) => {
            if (this.board.has(cell)) {
                const piece = this.board.get(cell)!;
                if (piece.player === this.otherPlayer() && piece.type === "core") {
                    for (const nb of this.graph.neighbours(cell)) {
                        validCells.delete(nb);
                        nextToEnemyCore.add(nb);
                    }
                } else if (piece.player === this.currplayer) {
                    for (const nb of this.graph.neighbours(cell)) {
                        validCells.delete(nb);
                        nextToFriendlyPiece.add(nb);
                    }
                }
            }
        });

        for (const cell of nextToFriendlyPiece) {
            if (!this.board.has(cell) && !nextToEnemyCore.has(cell) &&
            !this.remains.has(cell) && this.polypodAliveAfter(this.board, cell)) {
                validCells.add(cell);
            }
        }
        
        if (this.variants.includes("scavenging")) {
            // 1. make sets of all cells that generate a capture and that don't
            // 2. for non-captures, if there are remains adjacent, add separate moves for each of them
            // 3. if not, add the move plainly
            // 4. for each existing remains check if it can be a non-attacking move and add it

            const attacks = new Set<string>();
            const nonAttacks = new Set<string>();
            for (const cell of this.graph.graph.nodes()) {
                if (!this.board.has(cell) && !nextToEnemyCore.has(cell) && !this.remains.has(cell) &&
                this.polypodAliveAfter(this.board, cell)) {
                    if (nextToFriendlyPiece.has(cell) && this.isAttackingMove(cell)) {
                        attacks.add(cell);
                    } else {
                        nonAttacks.add(cell);
                    }
                }
            }

            moves.push(...attacks);

            for (const cell of nonAttacks) {
                const adjRemains: string[] = [];
                for (const nb of this.graph.neighbours(cell)) {
                    if (this.remains.has(nb)) {
                        adjRemains.push(nb);
                    }
                }
                if (adjRemains.length === 0) {
                    moves.push(cell);
                } else {
                    for (const adjCell of adjRemains) {
                        moves.push(cell + ";" + adjCell);
                    }
                }
            }

            for (const cell of this.remains) {
                if (!nextToEnemyCore.has(cell) && this.polypodAliveAfter(this.board, cell)
                && !this.isAttackingMove(cell)) {
                    moves.push(cell);
                }
            }

            for (const cell of validCells) {
                if (!attacks.has(cell) && !nonAttacks.has(cell)) {
                    moves.push(cell);
                }
            }
        } else {
            moves.push(...validCells);
        }

        if (this.variants.includes("energized")) {
            for (const cell of this.remains) {
                if (!nextToEnemyCore.has(cell) && this.polypodAliveAfter(this.board, cell)) {
                    const [boardAfter, remainsAfter] = this.applyMove(cell, this.board, this.remains);
                    const activePolypod = this.polypodAt(boardAfter, cell);
                    const adjacentCells = new Set<string>;
                    for (const cell of activePolypod) {
                        for (const nb of this.graph.neighbours(cell)) {
                            if (!activePolypod.has(nb)) {
                                adjacentCells.add(nb);
                            }
                        }
                    }
                    for (const adjCell of adjacentCells) {
                        const bonusResult = this.isValidBonusMove(adjCell, boardAfter, remainsAfter);
                        if (bonusResult.valid === true) {
                            moves.push(cell + ";" + adjCell);
                        }
                    }
                }
            }
        }

        moves.push("pass");
        return moves;
    }

    protected checkEOG(): PolypodsGame {
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                // Tiebreaker: player with most empty spots next to only their pieces
                let tie1 = 0;
                let tie2 = 0;
                for (const cell of this.graph.graph.nodes()) {
                    if (!this.board.has(cell) && !this.remains.has(cell)) {
                        const nbPs: Set<playerid> = new Set(this.graph.neighbours(cell).filter((nb) => (
                            this.board.has(nb))).map((nb) => (this.board.get(nb)!.player)));
                        if (nbPs.has(1) && !nbPs.has(2)) {
                            tie1++;
                        } else if (nbPs.has(2) && !nbPs.has(1)) {
                            tie2++;
                        }
                    }
                }
                if (tie1 > tie2) {
                    this.winner = [1];
                } else if (tie1 < tie2) {
                    this.winner = [2];
                } else {
                    this.winner = [1, 2];
                }
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IPolypodsState {
        return {
            game: PolypodsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PolypodsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: cloneState(this.board) as board,
            remains: cloneState(this.remains) as remains,
        };
    }

    public getPlayerColour(p: playerid): number|Colourfuncs {
        if (p === 1) {
            return {
                func: "custom",
                default: "#007f00",
                palette: 1
            }
        }
        if (p === 2) {
            return {
                func: "custom",
                default: "#ffffff",
                palette: 2
            }
        }
        return p;
    }

    public render(): APRenderRep {
    
        const p1 = this.getPlayerColour(1);
        const p2 = this.getPlayerColour(2);

        // Build piece string
        let pstr = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const c = this.board.get(cell)!;
                    if (c.player === 1 && c.type === "foot") {
                        pieces.push("A");
                    } else if (c.player === 1 && c.type === "core") {
                        pieces.push("B");
                    } else if (c.player === 2 && c.type === "foot") {
                        pieces.push("C");
                    } else if (c.player === 2 && c.type === "core") {
                        pieces.push("D");
                    }
                    if (this.variants.includes("energized") && this.remains.has(cell)) {
                        // Mark the energized piece by stacking a marker on top
                        pieces[pieces.length - 1] += "E";
                    }
                } else if (this.remains.has(cell)) {
                    pieces.push("E");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const board: BoardBasic = {
            style: "snubsquare",
            snubStart: "T",
            width: this.boardsize,
            height: this.boardsize,
            blocked: [{row: 0, col: 0}],
            backFill: {
                type: "board",
                colour: {
                    func: "custom",
                    default: "#cfc39e",
                    palette: "_context_board"
                }
            }
        };
        if (this.boardsize % 2 === 0) {
            board.blocked!.push({row: this.boardsize-1, col: this.boardsize-1});
        }
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board,
            legend: {
                A: {
                    name: "piece",
                    colour: p1,
                    scale: 0.85
                },
                B: {
                    name: "piece-chariot",
                    colour: p1,
                    scale: 1.2
                },
                C: {
                    name: "piece",
                    colour: p2,
                    scale: 0.85
                },
                D: {
                    name: "piece-chariot",
                    colour: p2,
                    scale: 1.2
                },
                E: {
                    name: "piece-borderless",
                    colour: {
                        func: "custom",
                        default: "#777777",
                        palette: 3
                    },
                    scale: 0.4
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    for (const movePart of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(movePart);
                        rep.annotations.push({type: "enter", shape: "circle", opacity: 1.0, targets: [{row: y, col: x}]});
                    }
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", shape: "circle", opacity: 0.5, targets: [{ row: y, col: x }] });
                    }
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }
        return rep;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public getPlayerScore(player: playerid): number {
        let score = [...this.board.values()].filter((c) => (c.player === player && c.type === "core")).length;
        return score;
    }

    public clone(): PolypodsGame {
        return new PolypodsGame(this.serialize());
    }
}
