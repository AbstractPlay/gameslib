/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface IClearcutState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];
const lineN: string[] = [];
const lineS: string[] = [];
for (let x = 0; x < 19; x++) {
    const N = GameBase.coords2algebraic(x, 0, 19);
    const S = GameBase.coords2algebraic(x, 18, 19);
    lineN.push(N);
    lineS.push(S);
}
const lineE: string[] = [];
const lineW: string[] = [];
for (let y = 0; y < 19; y++) {
    const E = GameBase.coords2algebraic(18, y, 19);
    const W = GameBase.coords2algebraic(0, y, 19);
    lineE.push(E);
    lineW.push(W);
}
const lines: [PlayerLines,PlayerLines] = [[lineN,lineS],[lineE,lineW]];

interface ICrossCut {
    yours: [string,string];
    theirs: [string,string];
}

interface ICrossCutExtended {
    yours: string[][];
    theirs: string[][];
}

export class ClearcutGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Clearcut",
        uid: "clearcut",
        playercounts: [2],
        version: "20230725",
        dateAdded: "2023-07-31",
        // i18next.t("apgames:descriptions.clearcut")
        description: "apgames:descriptions.clearcut",
        urls: ["https://www.marksteeregames.com/Clearcut_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            }
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["pie", "automove"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 19);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 19);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IClearcutState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: ClearcutGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IClearcutState;
            }
            if (state.game !== ClearcutGame.gameinfo.uid) {
                throw new Error(`The Clearcut engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ClearcutGame {
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
        return this;
    }

    public getCrosscuts(cell: string, player?: playerid): ICrossCut[] {
        if (player === undefined) {
            player = this.board.get(cell);
            if (player === undefined) {
                throw new Error("If player is undefined, then the cell must be occupied.");
            }
        }
        const crosscuts: ICrossCut[] = [];
        const [x,y] = ClearcutGame.algebraic2coords(cell);
        const grid = new RectGrid(19,19);
        const nonos: [Directions,Directions][] = [["N","E"],["S","E"],["S","W"],["N","W"]];
        for (const [left,right] of nonos) {
            let matchLeft = false;
            const rayLeft = grid.ray(x, y, left).map(n => ClearcutGame.coords2algebraic(...n));
            if (rayLeft.length > 0) {
                if ( (this.board.has(rayLeft[0])) && (this.board.get(rayLeft[0])! !== player) ) {
                    matchLeft = true;
                }
            }
            let matchRight = false;
            const rayRight = grid.ray(x, y, right).map(n => ClearcutGame.coords2algebraic(...n));
            if (rayRight.length > 0) {
                if ( (this.board.has(rayRight[0])) && (this.board.get(rayRight[0])! !== player) ) {
                    matchRight = true;
                }
            }
            const dirDiag = (left + right) as Directions;
            let matchDiag = false;
            const rayDiag = grid.ray(x, y, dirDiag).map(n => ClearcutGame.coords2algebraic(...n));
            if (rayDiag.length > 0) {
                if ( (this.board.has(rayDiag[0])) && (this.board.get(rayDiag[0])! === player) ) {
                    matchDiag = true;
                }
            }
            if (matchLeft && matchRight && matchDiag) {
                crosscuts.push({
                    yours: [cell, rayDiag[0]],
                    theirs: [rayLeft[0], rayRight[0]],
                });
            }
        }
        return crosscuts;
    }

    public extendCell(start: string): string[] {
        if (! this.board.has(start)) {
            throw new Error("Can only extend an occupied cell.");
        }
        const grid = new RectGrid(19, 19);
        const player = this.board.get(start)!;
        const toVisit: string[] = [start];
        const visited = new Set<string>();
        const extension = new Set<string>();
        while (toVisit.length > 0) {
            const cell = toVisit.pop()!;
            visited.add(cell);
            extension.add(cell);
            const [x,y] = ClearcutGame.algebraic2coords(cell);
            const adj = grid.adjacencies(x, y, false).map(n => ClearcutGame.coords2algebraic(...n));
            for (const next of adj) {
                if (this.board.has(next)) {
                    const contents = this.board.get(next)!;
                    if ( (contents === player) && (! visited.has(next)) ) {
                        toVisit.push(next);
                    }
                }
            }
        }
        return [...extension];
    }

    public extendCrosscuts(crosses: ICrossCut[]): ICrossCutExtended {
        const extended: ICrossCutExtended = {yours: [], theirs: []};
        for (const cross of crosses) {
            for (const cell of cross.yours) {
                const ext = this.extendCell(cell);
                extended.yours.push([...ext]);
            }
            for (const cell of cross.theirs) {
                const ext = this.extendCell(cell);
                extended.theirs.push([...ext]);
            }
        }
        return extended;
    }

    public canPlace(cell: string, player: playerid): boolean {
        const cloned: ClearcutGame = Object.assign(new ClearcutGame(), deepclone(this) as ClearcutGame);
        cloned.board.set(cell, player);
        const crosses = cloned.getCrosscuts(cell);
        const extended = cloned.extendCrosscuts(crosses);
        const yours = extended.yours.find(lst => lst.includes(cell))!;
        for (const ext of extended.theirs) {
            if (yours.length <= ext.length) {
                return false;
            }
        }
        return true;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];

        // can place on any empty space as long as you don't cross paths
        for (let y = 0; y < 19; y++) {
            for (let x = 0; x < 19; x++) {
                const cell = ClearcutGame.coords2algebraic(x, y);
                if (! this.board.has(cell)) {
                    if (this.canPlace(cell, this.currplayer)) {
                        moves.push(cell);
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = ClearcutGame.coords2algebraic(col, row);
            const newmove = cell;
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
            result.message = i18next.t("apgames:validation.clearcut.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            if (! this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
                return result;
            }
        }

        // valid cell
        try {
            ClearcutGame.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
            return result;
        }

        // is empty
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m})
            return result;
        }

        // doesn't break the rule
        if (! this.canPlace(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.clearcut.BAD_CROSSING")
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): ClearcutGame {
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
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
        }
        for (const cross of this.getCrosscuts(m, this.currplayer)) {
            // I can already assume that all crosscuts are valid, so just capture the opposing pieces
            for (const cell of cross.theirs) {
                this.board.delete(cell);
                this.results.push({type: "capture", where: cell});
            }
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
        const grid = new RectGrid(19,19);
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = ClearcutGame.algebraic2coords(node);
            // diagonal connections are not relevant
            const neighbours = grid.adjacencies(x,y,false).map(n => ClearcutGame.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ClearcutGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        const graph = this.buildGraph(prevPlayer);
        const [sources, targets] = lines[prevPlayer - 1];
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

    public state(): IClearcutState {
        return {
            game: ClearcutGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ClearcutGame.gameinfo.version,
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
        for (let row = 0; row < 19; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 19; col++) {
                const cell = ClearcutGame.coords2algebraic(col, row);
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
        pstr = pstr.replace(/-{19}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "go",
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
                    const [x, y] = ClearcutGame.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "capture") {
                    const [x, y] = ClearcutGame.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = ClearcutGame.algebraic2coords(cell);
                    targets.push({row: y, col: x})                ;
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
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

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["place", "pass", "eog", "winners"]);
    }

    public clone(): ClearcutGame {
        return new ClearcutGame(this.serialize());
    }
}
