/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, shuffle } from "../common";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs";
import {connectedComponents} from 'graphology-components';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    grown: boolean;
};

export interface ISympleState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SympleGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Symple",
        uid: "symple",
        playercounts: [2],
        version: "20240220",
        dateAdded: "2024-02-24",
        // i18next.t("apgames:descriptions.symple")
        description: "apgames:descriptions.symple",
        urls: [
            "https://mindsports.nl/index.php/arena/symple/",
            "https://boardgamegeek.com/boardgame/106341/symple",
        ],
        people: [
            {
                type: "designer",
                name: "Christian Freeling",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place",  "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "no-moves", "custom-randomization"],
        variants: [
            {
                uid: "p-4",
                group: "penalty"
            },
            {
                uid: "p-6",
                group: "penalty"
            },
            {
                uid: "p-10",
                group: "penalty"
            },
            {
                uid: "p-12",
                group: "penalty"
            },
        ]
    };

    private coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    private algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }
    private get pValue(): number {
        if (this.variants.includes("p-4")) {
            return 4;
        } else if (this.variants.includes("p-6")) {
            return 6;
        } else if (this.variants.includes("p-10")) {
            return 10;
        } else if (this.variants.includes("p-12")) {
            return 12;
        }
        return 8;
    }
    private get boardsize(): number {
        return 19;
    }
    private getGraph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardsize, this.boardsize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public grown = false;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ISympleState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SympleGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string,playerid>(),
                grown: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISympleState;
            }
            if (state.game !== SympleGame.gameinfo.uid) {
                throw new Error(`The Symple engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SympleGame {
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
        this.grown = state.grown;
        return this;
    }

    public randomMove(): string {
        const cells: string[] = [];

        const {groups, placements, liberties: allLiberties} = this.analyzeBoard();
        const allEmpties = [...this.getGraph().listCells(false) as string[]].filter(cell => ! this.board.has(cell));
        // one-third of the time, create a new group
        if (placements.length > 0 && (groups.length === 0 || allLiberties.size === 0 || Math.random() < 0.33) ) {
            cells.push(shuffle([...placements])[0] as string);
        }
        // otherwise grow
        else {
            let remaining = [...groups].filter(grp => grp.liberties.size > 0);
            const alreadyGrown: SympleGroup[] = [];
            while (remaining.length > 0) {
                let moveFound = false;
                for (const group of shuffle([...remaining]) as SympleGroup[]) {
                    for (const liberty of shuffle([...group.liberties]) as string[]) {
                        if (! this.board.has(liberty) && alreadyGrown.find(grp => grp.liberties.has(liberty)) === undefined) {
                            moveFound = true;
                            cells.push(liberty);
                            alreadyGrown.push(...remaining.filter(grp => grp.liberties.has(liberty)));
                            remaining = remaining.filter(grp => ! grp.liberties.has(liberty));
                            break;
                        }
                    }
                    if (moveFound) { break; }
                }
                // break if board is full
                if (cells.length === allEmpties.length) {
                    break;
                }
                if (! moveFound && cells.length === 0) {
                    throw new Error("Cannot find a move!");
                } else {
                    break;
                }
            }

            // always take advantage of balancing move if available
            if (! this.grown && this.currplayer === 2) {
                const cloned = this.clone();
                cells.forEach(cell => cloned.board.set(cell, this.currplayer));
                const {placements: newPlacements} = cloned.analyzeBoard();
                cells.push(shuffle(newPlacements)[0] as string);
            }
        }

        return cells.join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            move = move.toLowerCase();
            move = move.replace(/\s+/g, "");
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            // fresh
            if (move === "") {
                newmove = cell;
            }
            // continuation
            else {
                const cells = move.split(",");
                // clicking an existing cell removes it
                if (cells.includes(cell)) {
                    const idx = cells.findIndex(c => c === cell);
                    cells.splice(idx, 1);
                }
                // otherwise, add it
                else {
                    cells.push(cell);
                }
                newmove = cells.join(",");
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                // nondestructive
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

    public analyzeBoard(player?: playerid): {groups: SympleGroup[], liberties: Set<string>, placements: string[]} {
        if (player === undefined) {
            player = this.currplayer;
        }
        // get list of existing groups of player's pieces
        const myGraph = this.getGraph();
        for (const node of [...myGraph.listCells() as string[]]) {
            if ( (! this.board.has(node)) || (this.board.get(node) !== player) ) {
                myGraph.graph.dropNode(node);
            }
        }
        const groups = connectedComponents(myGraph.graph).map(grp => new SympleGroup(grp, this.getGraph(), this.board));

        // get list of liberties for all groups
        const liberties = new Set<string>();
        groups.forEach(grp => grp.liberties.forEach(lib => liberties.add(lib)));

        // now get list of valid placements (empty cells that are also not liberties)
        const placements = [...this.getGraph().listCells() as string[]].filter(cell => (! this.board.has(cell)) && (! liberties.has(cell)));

        return {
            groups,
            liberties,
            placements,
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.symple.INITIAL_INSTRUCTIONS");
            return result;
        }

        // get some initial information about the move and board state
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const cells = m.split(",");
        const graph = this.getGraph();
        const {groups} = this.analyzeBoard();
        let first: "place"|"grow" = "place";
        for (const n of graph.neighbours(cells[0])) {
            if (this.board.has(n) && this.board.get(n) === this.currplayer) {
                first = "grow";
                break;
            }
        }
        let last: "place"|"grow"|undefined;
        if (cells.length > 1) {
            last = "place";
            for (const n of graph.neighbours(cells[cells.length - 1])) {
                if (this.board.has(n) && this.board.get(n) === this.currplayer) {
                    last = "grow";
                    break;
                }
            }
        }

        // first do basic sanity checkis
        for (const cell of cells) {
            // valid cell
            try {
                this.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // is empty
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
        }
        // check for duplicate cells
        const cellSet = new Set<string>(cells);
        if (cellSet.size !== cells.length) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.symple.DUPLICATES");
            return result;
        }

        if (first === "place") {
            // if more than one cell, wrong
            if (cells.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.symple.TOO_LONG");
                return result;
            } else {
                // we're good
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else {
            // if balancing move, take the last cell off the list
            let lastCell: string|undefined;
            if (! this.grown && this.currplayer === 2 && last === "place") {
                lastCell = cells.pop();
            }

            // process all growth moves
            const clonedBoard = new Map(this.board);
            let remaining: SympleGroup[] = [...groups].filter(grp => grp.liberties.size > 0);
            const alreadyGrown: SympleGroup[] = [];
            for (const cell of cells) {
                // cell is a liberty
                const found = remaining.find(grp => grp.liberties.has(cell));
                if (found === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.symple.NOT_LIBERTY", {where: cell});
                    return result;
                }
                // make sure it doesn't also increase a group already grown
                const already = alreadyGrown.find(grp => grp.liberties.has(cell));
                if (already !== undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.symple.DOUBLE_GROW");
                    return result;
                }
                // add the piece to the cloned board
                clonedBoard.set(cell, this.currplayer);
                // remove any groups that share that liberty
                alreadyGrown.push(...remaining.filter(grp => grp.liberties.has(cell)))
                remaining = remaining.filter(grp => ! grp.liberties.has(cell))
            }

            // do a final check to remove any remaining groups whose only liberties encroach
            // on groups that have already grown
            remaining = remaining.filter(grp => {
                let hasLiberty = false;
                for (const cell of grp.liberties) {
                    const already = alreadyGrown.find(g => g.liberties.has(cell));
                    if (already === undefined) {
                        hasLiberty = true;
                        break;
                    }
                }
                return hasLiberty;
            });

            // if there are still groups remaining, and the board isn't full, incomplete
            if (remaining.length > 0 && this.board.size < this.boardsize*this.boardsize) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.symple.PARTIAL");
                return result;
            }

            // if balancing is possible
            if (! this.grown && this.currplayer === 2) {
                // if not given, incomplete
                if (lastCell === undefined) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.symple.CAN_BALANCE");
                    return result;
                }

                // validate final placement
                let isAdj = false;
                for (const n of graph.neighbours(lastCell)) {
                    if (clonedBoard.has(n) && clonedBoard.get(n) === this.currplayer) {
                        isAdj = true;
                        break;
                    }
                }
                if (isAdj) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.symple.BAD_PLACEMENT", {where: lastCell});
                    return result;
                }
            } else if (lastCell !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.symple.CANT_BALANCE");
                return result;
            }

            // All good!
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): SympleGame {
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
            // if (! partial && ! this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        const cells = m.split(",");
        for (const cell of cells) {
            if (cell === undefined) {
                throw new Error(`Encountered an undefined cell in the move ${m}`);
            }
            this.board.set(cell, this.currplayer);
            this.results.push({type: "place", where: cell});
            // check grown
            if (! this.grown) {
                const graph = this.getGraph();
                let growth = false;
                for (const n of graph.neighbours(cell)) {
                    if (this.board.has(n) && this.board.get(n) === this.currplayer) {
                        growth = true;
                        break;
                    }
                }
                if (growth) {
                    this.grown = true;
                }
            }
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

    public getPlayerScore(player: number): number {
        const mine = [...this.board.values()].filter(p => p === player).length;
        const graph = this.getGraph();
        for (const node of graph.graph.nodes()) {
            if ( (! this.board.has(node)) || (this.board.get(node) !== player) ) {
                graph.graph.dropNode(node);
            }
        }
        const conn = connectedComponents(graph.graph);
        const penalty = this.pValue * conn.length;
        return mine - penalty;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    protected checkEOG(): SympleGame {
        // only ends when the board is full
        const graph = this.getGraph();
        const empties = [...graph.listCells() as string[]].filter(cell => ! this.board.has(cell));
        if (empties.length === 0) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public state(): ISympleState {
        return {
            game: SympleGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SympleGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            grown: this.grown,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.getGraph().listCells(true) as string[][];
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardsize,
                height: this.boardsize,
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
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];

            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }

            if (rep.annotations.length === 0) {
                delete rep.annotations;
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
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }
        status += `**Grown?**: ${this.grown}\n\n`;

        return status;
    }

    public clone(): SympleGame {
        return Object.assign(new SympleGame(), deepclone(this) as SympleGame);
        // return new SympleGame(this.serialize());
    }
}

class SympleGroup {
    public readonly cells: string[];
    public readonly liberties: Set<string>;
    public readonly id: string;

    constructor(group: string[], graph: SquareOrthGraph, board: Map<string,playerid>) {
        this.cells = [...group];
        const sorted = [...group].sort();
        this.id = sorted.join(",");
        this.liberties = new Set<string>();
        for (const cell of this.cells) {
            const neighbours = graph.neighbours(cell);
            for (const n of neighbours) {
                if (! board.has(n)) {
                    this.liberties.add(n);
                }
            }
        }
    }
}
