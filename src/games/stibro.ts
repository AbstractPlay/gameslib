/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError, StackSet } from "../common";
import { bfsFromNode } from 'graphology-traversal';
import i18next from "i18next";


export type playerid = 1|2;
export type cellcontent = playerid;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontent>;
    lastmove?: string;
    winningLoop: string[];
}

export interface IStibroState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StibroGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Stibro",
        uid: "stibro",
        playercounts: [2],
        version: "1.0",
        // i18next.t("apgames:descriptions.stibro")
        description: "apgames:descriptions.stibro",
        urls: ["https://boardgamegeek.com/boardgame/430591/stibro"],
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
        flags: ["pie"],
        dateAdded: "2025-04-20",
        categories: ["goal>connect", "mechanic>place", "board>shape>hex", "components>simple>3c"],
        variants: [
            {uid: "size-6", group: "board"},
            {uid: "size-8", group: "board"}
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontent>;
    public boardsize = 7;
    public graph: HexTriGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public outerRing: Set<string> = new Set();

    public winningLoop: string[] = [];

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, this.boardsize * 2 - 1);
    }

    public setRegions() {

        this.outerRing = new Set();

        for(const cell of this.graph.listCells() as string[]) {
            const numNeighbours = this.graph.neighbours(cell).length;
            switch(numNeighbours) {
                case 4:
                case 3:
                    this.outerRing.add(cell);
                    break;
            }
        }
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
    }

    public applyVariants(variants?: string[]) {
        this.variants = (variants !== undefined) ? [...variants] : [];
        for(const v of this.variants) {
            if(v.startsWith("size")) {
                const [,size] = v.split("-");
                this.boardsize = parseInt(size, 10);
                this.graph = this.getGraph();
            }
        }
        this.setRegions();
    }

    constructor(state?: IStibroState | string, variants?: string[]) {
        super();

        if (state === undefined) {
            this.applyVariants(variants);

            const fresh: IMoveState = {
                _version: StibroGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, cellcontent>(),
                winningLoop: []
            };
            this.stack = [fresh];

        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStibroState;
            }
            if (state.game !== StibroGame.gameinfo.uid) {
                throw new Error(`The Tritium engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.applyVariants(state.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): StibroGame {
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
        this.winningLoop = [...state.winningLoop];

        return this;
    }

    public moves(): string[] {
        const moves: string[] = [];
        if (this.gameover) { return moves; }

        for (const cell of this.graph.listCells(false) as string[]) {
            if (!this.board.has(cell)) {
                moves.push(cell);
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
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if(this.graph.graph.nodes().includes(cell)) {
                newmove = cell;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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
            result.message = i18next.t("apgames:validation.lifeline.INITIAL_INSTRUCTIONS")
            return result;
        }

        const cell = m;

        if (!this.graph.graph.hasNode(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result
        }

        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): StibroGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        this.results = [];

        const cell = m;

        const piece = this.currplayer;

        this.board.set(cell, piece);
        this.results.push({type: "place", where: cell});

        this.lastmove = m;

        this.checkEOG();
        this.currplayer = this.otherPlayer();

        this.saveState();
        return this;
    }

    private isLoopAround(group: Set<string>, center: string): boolean {
        const graph = this.getGraph();
        if (group.has(center)) {
            return false;
        }
        let reachedOuter = false;
        bfsFromNode(graph.graph, center, (cell) => {
            if (group.has(cell)) {
                return true;
            }
            else if (this.outerRing.has(cell)) {
                reachedOuter = true;
            }
            return false;
        });
        return !reachedOuter;
    }

    private isLoop(group: Set<string>, laststone: string): boolean {
        /* Check whether the group is a loop. For all neighbours of the last-added
        stone, check whether the path to the edge is blocked by the current group. */
        const neighbours = this.graph.neighbours(laststone);
        let isLoop = false;
        for (const neighbour of neighbours) {
            if (this.isLoopAround(group, neighbour)){
                isLoop = true;
                break;
            }
        }
        return isLoop;
    }

    private allShortestCycles(group: Set<string>, source: string): string[][] {
        /* Adapted from Graphology's allSimplePaths. Finds the shortest winning cycle,
        and any other cycles (if existing) of the same length, then returns them in
        an array.
        */
        const groupGraph = this.getGraph();
        for (const cell of this.graph.graph.nodes()) {
            if (!group.has(cell)) { groupGraph.graph.dropNode(cell); }
        }
        const graph = groupGraph.graph;

        let found = false;
        /* Iterative deepening dfs */
        for(let maxDepth = 6; maxDepth <= group.size; maxDepth++){
            const stack = [graph.outboundNeighbors(source)];
            const visited = StackSet.of(source, true);

            const paths: string[][] = [];
            let p: string[];
            let children;
            let child;

            while (stack.length !== 0) {
                children = stack[stack.length - 1];
                child = children.pop();

                if (!child) {
                    stack.pop();
                    visited.pop();
                } else {
                    if (visited.has(child)) continue;

                    /* Check whether the last three nodes of the path form a triangle,
                    if so we can skip the rest of this branch, because the shortest loop
                    will never contain an acute angle. */
                    p = visited.path(child);
                    const tri = p.slice(-3);
                    if(graph.hasEdge(tri[0], tri[1]) && graph.hasEdge(tri[1], tri[2]) &&
                        graph.hasEdge(tri[2], tri[0])){
                        continue;
                    }

                    if (child === source) {
                        if(this.isLoop(new Set(p), child)){
                            paths.push(p);
                            found = true;
                        }
                    }

                    visited.push(child);

                    if (!visited.has(source) && stack.length < maxDepth) {
                        stack.push(graph.outboundNeighbors(child));
                    } else {
                        visited.pop();
                    }
                }
            }
            if(found){
                return paths;
            }
        }
        return [];
    }

    public getWinningLoop(player: playerid, lastmove: string): string[] {
        /*
        Do a BFS to find all possible paths emanating from the placed stone, for each check if it's a winning loop.
        Since it is a BFS the shortest one will be found first.
        Could be sped up by not taking sharp-angled steps in the BFS.
        */
        const graph = this.getGraph(); // The board, including center cell

        // Find the current group of player stones
        const currentGroup = new Set<string>();

        bfsFromNode(graph.graph, lastmove, (cell) => {
            const value = this.board.get(cell);
            if (value === player) {
                currentGroup.add(cell);
                return false;
            } else {
                return true;
            }
        });

        // First check if there's a winning loop at all (i.e. path from center to edge is blocked by player stones)
        if (!this.isLoop(currentGroup, lastmove)) { return []; };

        const cycles = this.allShortestCycles(currentGroup, lastmove);

        return cycles[0]; // Arbitrary choice, all shortest cycles are equally winning
    }

    protected checkEOG(): StibroGame {
        /* Check for a loop of the current player */
        const currloop = this.getWinningLoop(this.currplayer, this.lastmove!)
        if (currloop.length > 0) {
            this.winner.push(this.currplayer);
            this.winningLoop = currloop;
        }

        this.gameover = this.winner.length > 0;
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IStibroState {
        return {
            game: StibroGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        const state = {
            _version: StibroGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningLoop: [...this.winningLoop]
        };
        return state;
    }

    public render(): APRenderRep {

        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                const piece: string[] = [];
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;

                    if (player === 1) { piece.push("A"); }
                    else { piece.push("B"); }
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        // Build rep

        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardsize,
                maxWidth: this.boardsize * 2 - 1,
                alternatingSymmetry: false
            },
            legend: {
                A: {name: "piece", colour: 1},
                B: {name: "piece", colour: 2}
            },
            pieces: pstr as [string[][], ...string[][][]]
        };

        rep.annotations = [];
        for (const move of this.stack.at(-1)!._results) {
            if (move.type === "place") {
                const [x, y] = this.graph.algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
            }
        }
        if (this.winningLoop.length > 0) {
            const targets: RowCol[] = [];
            for (const cell of this.winningLoop) {
                const [x, y] = this.graph.algebraic2coords(cell);
                targets.push({row: y, col: x})
            }
            rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        return rep;
    }

    public clone(): StibroGame {
        return new StibroGame(this.serialize());
    }
};
