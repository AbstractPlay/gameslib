import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, RectGrid, reviver, UserFacingError } from "../common";
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

export interface IHalfcutState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

interface ICrossCut {
    yours: [string,string];
    theirs: [string,string];
}

interface ICrossCutExtended {
    yours: string[][];
    theirs: string[][];
}

export class HalfcutGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Halfcut",
        uid: "clearcut",
        playercounts: [2],
        version: "20230725",
        dateAdded: "2023-07-31",
        // i18next.t("apgames:descriptions.clearcut")
        description: "apgames:descriptions.clearcut",
        urls: ["https://www.marksteeregames.com/Halfcut_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "size-15", group: "board" },
            { uid: "clearcut", group: "ruleset" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie", "automove"]
    };
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
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
    private boardSize = 0;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: IHalfcutState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: HalfcutGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHalfcutState;
            }
            if (state.game !== HalfcutGame.gameinfo.uid) {
                throw new Error(`The Halfcut engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): HalfcutGame {
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
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.coords2algebraic(x, 0);
            const S = this.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.coords2algebraic(this.boardSize-1, y);
            const W = this.coords2algebraic(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN, lineS], [lineE, lineW]];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 19;
    }


    public getCrosscuts(cell: string, player?: playerid): ICrossCut[] {
        if (player === undefined) {
            player = this.board.get(cell);
            if (player === undefined) {
                throw new Error("If player is undefined, then the cell must be occupied.");
            }
        }
        const crosscuts: ICrossCut[] = [];
        const [x,y] = this.algebraic2coords(cell);
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const nonos: [Direction,Direction][] = [["N","E"],["S","E"],["S","W"],["N","W"]];
        for (const [left,right] of nonos) {
            let matchLeft = false;
            const rayLeft = grid.ray(x, y, left).map(n => this.coords2algebraic(...n));
            if (rayLeft.length > 0) {
                if ( (this.board.has(rayLeft[0])) && (this.board.get(rayLeft[0])! !== player) ) {
                    matchLeft = true;
                }
            }
            let matchRight = false;
            const rayRight = grid.ray(x, y, right).map(n => this.coords2algebraic(...n));
            if (rayRight.length > 0) {
                if ( (this.board.has(rayRight[0])) && (this.board.get(rayRight[0])! !== player) ) {
                    matchRight = true;
                }
            }
            const dirDiag = (left + right) as Direction;
            let matchDiag = false;
            const rayDiag = grid.ray(x, y, dirDiag).map(n => this.coords2algebraic(...n));
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
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const player = this.board.get(start)!;
        const toVisit: string[] = [start];
        const visited = new Set<string>();
        const extension = new Set<string>();
        while (toVisit.length > 0) {
            const cell = toVisit.pop()!;
            visited.add(cell);
            extension.add(cell);
            const [x,y] = this.algebraic2coords(cell);
            const adj = grid.adjacencies(x, y, false).map(n => this.coords2algebraic(...n));
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
        this.board.set(cell, player);
        const crosses = this.getCrosscuts(cell);
        if (this.variants.includes("clearcut")) {
            const extended = this.extendCrosscuts(crosses);
            const yours = extended.yours.find(lst => lst.includes(cell))!;
            for (const ext of extended.theirs) {
                if (yours.length <= ext.length) {
                    this.board.delete(cell);
                    return false;
                }
            }
            this.board.delete(cell);
            return true;
        } else {
            const yours = this.extendCell(cell);
            for (const cross of crosses) {
                // Placed group is longer than at least one of their group.
                let longer = false;
                for (const p of cross.theirs) {
                    if (yours.length > this.extendCell(p).length) {
                        longer = true;
                        break;
                    }
                }
                if (!longer) {
                    this.board.delete(cell);
                    return false;
                }
            }
            this.board.delete(cell);
            return true;
        }
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];

        // can place on any empty space as long as you don't cross paths
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = this.coords2algebraic(x, y);
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
            const cell = this.coords2algebraic(col, row);
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
            this.algebraic2coords(m);
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
            if (this.variants.includes("clearcut")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.clearcut.BAD_CROSSING_CLEARCUT")
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.clearcut.BAD_CROSSING")
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): HalfcutGame {
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
        if (this.variants.includes("clearcut")) {
            for (const cross of this.getCrosscuts(m, this.currplayer)) {
                // I can already assume that all crosscuts are valid, so just capture the opposing pieces
                for (const cell of cross.theirs) {
                    this.board.delete(cell);
                    this.results.push({type: "capture", where: cell});
                }
            }
        } else {
            const crosses = this.getCrosscuts(m);
            const yours = this.extendCell(m);
            const toDeletes: string[] = [];
            for (const cross of crosses) {
                for (const p of cross.theirs) {
                    if (yours.length > this.extendCell(p).length) {
                        toDeletes.push(p);
                    }
                }
            }
            for (const toDelete of toDeletes) {
                if (!this.board.has(toDelete)) { continue; }
                this.board.delete(toDelete);
                this.results.push({type: "capture", where: toDelete});
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
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = this.algebraic2coords(node);
            // diagonal connections are not relevant
            const neighbours = grid.adjacencies(x,y,false).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): HalfcutGame {
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

    public state(): IHalfcutState {
        return {
            game: HalfcutGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HalfcutGame.gameinfo.version,
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
                const cell = this.coords2algebraic(col, row);
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

        const markers: Array<any> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
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
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})                ;
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
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

    public clone(): HalfcutGame {
        return new HalfcutGame(this.serialize());
    }
}
