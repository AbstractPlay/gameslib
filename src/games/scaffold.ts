/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface IScaffoldState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

export class ScaffoldGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Scaffold",
        uid: "scaffold",
        playercounts: [2],
        version: "20231209",
        // i18next.t("apgames:descriptions.scaffold")
        description: "apgames:descriptions.scaffold",
        urls: ["https://boardgamegeek.com/boardgame/360432/scaffold"],
        people: [
            {
                type: "designer",
                name: "Andrew Lannan",
            }
        ],
        flags: ["experimental", "pie", "automove", "multistep", "rotate90"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 0;
    private grid: RectGrid;
    private lines: [PlayerLines,PlayerLines];
    private dots: string[] = [];

    constructor(state?: IScaffoldState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: ScaffoldGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IScaffoldState;
            }
            if (state.game !== ScaffoldGame.gameinfo.uid) {
                throw new Error(`The Scaffold engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
        this.lines = this.getLines();
    }

    public load(idx = -1): ScaffoldGame {
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
        this.connPath = [...state.connPath];
        this.boardSize = 19;
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = GameBase.coords2algebraic(x, 0, this.boardSize);
            const S = GameBase.coords2algebraic(x, this.boardSize-1, this.boardSize);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = GameBase.coords2algebraic(this.boardSize-1, y, this.boardSize);
            const W = GameBase.coords2algebraic(0, y, this.boardSize);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS],[lineE,lineW]];
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = ScaffoldGame.coords2algebraic(x, y, this.boardSize);
                if (! this.board.has(cell)) {
                    for (const movesList of this.traverseFollowups([cell], player)) {
                        moves.push(movesList.join(","));
                    }
                }
            }
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    private traverseFollowups(cells: string[], player: playerid, ): string[][] {
        const followups = this.followupMoves(cells, player);
        if (followups.length === 0) {
            return [cells];
        }
        const possible: string[][] = [];
        for (const followup of followups) {
            possible.push(...this.traverseFollowups([...cells, followup], player));
        }
        return possible;
    }

    private followupMoves(cells: string[], player: playerid): string[] {
        // `cells` is the original chosen cell, plus any cell to be hypothetically filled.
        const toChecks: Set<string> = new Set();
        for (const cell of cells) {
            for (const neighbour of this.getNeighbours(cell)) {
                if (!this.board.has(neighbour)) {
                    toChecks.add(neighbour);
                }
            }
        }
        const followups: string[] = [];
        for (const toCheck of toChecks) {
            if (this.forcedPlacement(toCheck, cells, player)) {
                followups.push(toCheck);
            }
        }
        return followups;
    }

    private forcedPlacement(toCheck: string, cells: string[], player: playerid): boolean {
        // Check to see if any adjacent cell is connected to the group of placed `cells`.
        const startPoints = this.getNeighbours(toCheck).filter(n => this.board.has(n) && this.board.get(n) === player && !cells.includes(n));
        outer:
        for (const startPoint of startPoints) {
            const seen: Set<string> = new Set();
            const todo = [startPoint];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                seen.add(cell);
                for (const n of this.getNeighbours(cell)) {
                    if (cells.includes(n)) {
                        continue outer;
                    }
                    if (this.board.has(n) && this.board.get(n) === player) {
                        todo.push(n);
                    }
                }
            }
            return true;
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = ScaffoldGame.coords2algebraic(col, row, this.boardSize);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else {
                newmove = move + `,${cell}`;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.scaffold.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const moves = m.split(",");

        // valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                ScaffoldGame.algebraic2coords(move, this.boardSize);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }

        // is empty
        let notEmpty;
        for (const move of moves) {
            if (this.board.has(move)) { notEmpty = move; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: notEmpty});
            return result;
        }
        // correctness of multistep moves
        if (moves.length > 1) {
            let valid = true
            for (let i = 1; i < moves.length; i++) {
                if (! this.followupMoves(moves.slice(0, i), this.currplayer).includes(moves[i])) {
                    valid = false;
                    break;
                }
            }
            if (! valid) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.scaffold.INVALID_MOVES", {moves: m});
                return result;
            }
        }

        // partial
        if (this.followupMoves(moves, this.currplayer).length !== 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.scaffold.INCOMPLETE");
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNeighbours(cell: string): string[] {
        const [x,y] = ScaffoldGame.algebraic2coords(cell, this.boardSize);
        return this.grid.adjacencies(x, y, false).map(n => ScaffoldGame.coords2algebraic(...n, this.boardSize));
    }

    public move(m: string, {partial = false, trusted = false} = {}): ScaffoldGame {
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
            // all partial moves should still be in the move list
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const moves = m.split(",");
        for (const move of moves) {
            this.board.set(move, this.currplayer);
            this.results.push({type: "place", where: move});
        }

        if (partial) {
            this.dots = [...this.followupMoves(moves, this.currplayer)];
            return this;
        } else {
            this.dots = [];
        }

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

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = ScaffoldGame.algebraic2coords(node, this.boardSize);
            const neighbours = this.grid.adjacencies(x,y,false).map(n => ScaffoldGame.coords2algebraic(...n, this.boardSize));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ScaffoldGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        const graph = this.buildGraph(prevPlayer);
        const [sources, targets] = this.lines[prevPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevPlayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) {
                break;
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

    public state(): IScaffoldState {
        return {
            game: ScaffoldGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ScaffoldGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = ScaffoldGame.coords2algebraic(col, row, this.boardSize);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
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
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers: [
                    {type:"edge", edge: "N", colour:1},
                    {type:"edge", edge: "S", colour:1},
                    {type:"edge", edge: "E", colour:2},
                    {type:"edge", edge: "W", colour:2},
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = ScaffoldGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = ScaffoldGame.algebraic2coords(cell, this.boardSize);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
            }
        }

        // add dots if provided
        if ( (this.dots !== undefined) && (this.dots.length > 0) ) {
            const points: {row: number; col: number}[] = [];
            for (const dot of this.dots) {
                const [x, y] = ScaffoldGame.algebraic2coords(dot, this.boardSize);
                points.push({row: y, col: x});
            }
            if (points.length > 0) {
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
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

    public clone(): ScaffoldGame {
        return new ScaffoldGame(this.serialize());
    }
}
