import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, SquareOrthGraph } from "../common";
import { connectedComponents } from "graphology-components";
import i18next from "i18next";

type playerid = 1 | 2; // regarding pieces: 1 is the ball, 2 are the walls

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ITanboState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TanboGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Tanbo",
        uid: "tanbo",
        playercounts: [2],
        version: "20260521",
        dateAdded: "2026-05-27",
        // i18next.t("apgames:descriptions.tanbo")
        description: "apgames:descriptions.tanbo",
        notes: "apgames:notes.tanbo",
        urls: [
            "https://www.marksteeregames.com/Tanbo_rules.pdf",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>annihilate", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        variants: [
            { uid: "#board", }, // 7x7
            { uid: "size-11", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        flags: []
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private boardSize = this.getBoardSize();
    private grid: RectGrid;

    constructor(state?: ITanboState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const sz = this.getBoardSize();
            const g = new SquareOrthGraph(sz, sz);

            for (let x=0; x<sz; x+=2) {
                for (let y=0; y<sz; y+=2) {
                    const cell = g.coords2algebraic(x, y);
                    const owner: playerid = x%4 === y%4 ? 1 : 2;
                    board.set(cell, owner);
                }
            }
            const fresh: IMoveState = {
                _version: TanboGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITanboState;
            }
            if (state.game !== TanboGame.gameinfo.uid) {
                throw new Error(`The Tanbo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.getBoardSize(), this.getBoardSize());
    }

    public load(idx = -1): TanboGame {
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
        this.boardSize = this.getBoardSize();
        this.results = [...state._results];
        return this;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public getBoardSize(): number {
        // Get board size from variants.
        if (this.variants    !== undefined && this.variants.length > 0 &&
            this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 7;
    }

    public get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    // return the list of orthogonal neighbors of 'cell'
    private orthNeighbours(cell: string): string[] {
        const [x, y] = this.algebraic2coords(cell);
        const neighbours = this.grid.adjacencies(x, y, false);
        return neighbours.map(n => this.coords2algebraic(...n));
    }

    // return how many of the player's stones are adjacent to 'cell'
    private nFriends(cell: string, player: playerid): number {
        return this.orthNeighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === player).length;
    }

    // get the group associated with stone at 'cell', and the liberties of its group
    // requires: cell must be occupied
    private getGroupLiberties(cell: string, player?: playerid): [Set<string>, number] {
        if (player === undefined) { player = this.board.get(cell); }
        const seen: Set<string> = new Set();
        const liberties = new Set<string>(); // this probably can be just a counter
        const todo: string[] = [cell]

        while (todo.length > 0) {
            const cell1 = todo.pop()!;
            if (seen.has(cell1)) { continue; }
            seen.add(cell1);
            for (const neigh of this.orthNeighbours(cell1)) {
                if (!this.board.has(neigh) && this.nFriends(neigh, player!) === 1) {
                    liberties.add(neigh);
                    continue;
                }
                if (this.board.has(neigh) && this.board.get(neigh) === player) {
                    todo.push(neigh);
                }
            }
        }
        return [seen, liberties.size];
    }

    // return all the groups/roots of a given player
    private getGroups(player?: playerid): string[][] {
        if (player === undefined) { player = this.currplayer; }
        const pieces = [...this.board.entries()].filter(([,owner]) => owner === player).map(pair => pair[0]);
        const g = this.graph;

        for (const node of g.graph.nodes()) {
            if (!pieces.includes(node)) { // remove intersections/nodes not occupied by the player
                g.graph.dropNode(node);
            }
        }

        const groups : Array<Array<string>> = connectedComponents(g.graph);
        const res: string[][] = [];
        for (const group of groups) {
            res.push( group );
        }
        return res;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const g = this.graph;
        const moves = [];

        for (const cell of g.graph.nodes()) {
            // only valid to place on an empty cell adjacent to exactly one of the player's stones
            if (!this.board.has(cell) && this.nFriends(cell, player) === 1) {
                moves.push(cell);
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const newmove = this.graph.coords2algebraic(col, row);
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
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
            result.canrender = true;
            result.message = i18next.t("apgames:validation.tanbo.INITIAL_INSTRUCTIONS");
            return result;
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tanbo.INVALID_MOVE");
            return result
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): TanboGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.board.set(m, this.currplayer);
        this.results.push({ type: "place", where: m });

        // now we need to check captures
        // 1st) if the current cell's group/root is bounded (if it has no liberty) it is captured
        const [group, nLiberties] = this.getGroupLiberties(m);
        if ( nLiberties === 0 ) {
            for (const cell of group) {
                this.board.delete(cell);
            }
            this.results.push({ type: "capture", where: [...group].join(), count: group.size });
        } else {
            // 2nd) otherwise, if any other group is without liberty, it is captured
            const friendGroups: string[][] = this.getGroups(this.currplayer);
            const enemyGroups: string[][] = this.getGroups(this.currplayer % 2 + 1 as playerid);
            const allGroups = [...friendGroups, ...enemyGroups];
            const toDelete: string[] = []
            for (const aGroup of allGroups) {
                const [, n] = this.getGroupLiberties(aGroup[0]);
                if ( n === 0 ) {
                    for (const cell of aGroup) {
                        toDelete.push(cell); // need to delete all at the same time, so for now just save them
                    }
                }
            }
            for (const deleteCell of toDelete) {
                this.board.delete(deleteCell);
                this.results.push({ type: "capture", where: deleteCell, count: 1 });
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): TanboGame {
        const p1Pieces = [...this.board.entries()].filter(([,owner]) => owner === 1).map(pair => pair[0]);
        const p2Pieces = [...this.board.entries()].filter(([,owner]) => owner === 2).map(pair => pair[0]);

        if (p1Pieces.length === 0 || p2Pieces.length === 0) {
            this.gameover = true;
            this.winner = p1Pieces.length === 0 ? [2] : [1];
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ITanboState {
        return {
            game: TanboGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TanboGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "place") {
                const [toX, toY] = g.algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
            } else if (move.type === "capture") {
                for (const cell of move.where!.split(",")) {
                    const [x, y] = g.algebraic2coords(cell);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                }
            }
        }

        return rep;
    }

    public clone(): TanboGame {
        return new TanboGame(this.serialize());
    }
}
