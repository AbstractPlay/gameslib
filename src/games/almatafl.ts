/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import { DirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { allSimplePaths } from "graphology-simple-path";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerID = 1|2;
type Piece = "piece"|"king";
type CellContents = [playerID, Piece];

export interface IMoveState extends IIndividualState {
    currplayer: playerID;
    board: Map<string, CellContents[]>;
    lastmove?: string;
};

export interface IAlmataflState extends IAPGameState {
    winner: playerID[];
    stack: Array<IMoveState>;
};

export class AlmataflGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "AlmaTafl",
        uid: "almatafl",
        playercounts: [2],
        version: "20231204",
        // i18next.t("apgames:descriptions.almatafl")
        description: "apgames:descriptions.almatafl",
        urls: ["https://boardgamegeek.com/boardgame/401367/almatafl"],
        people: [
            {
                type: "designer",
                name: "Paschalis Antoniou",
                urls: ["https://boardgamegeek.com/boardgamedesigner/153526/paschalis-antoniou"]
            }
        ],
        variants: [{uid: "advanced"}],
        flags: ["custom-colours", "multistep"]
    };

    public static blocked = ["a1","a2","a5","a6","b1","b7","e1","e10","f1","f11","g1","g10","j1","j7","k1","k2","k5","k6"];
    public static exits = ["k3", "k4", "h1", "i1", "i8", "h9", "d1", "c1", "c8", "d9", "a3", "a4"];

    public numplayers = 2;
    public currplayer: playerID = 1;
    public board!: Map<string, CellContents[]>;
    public graph!: HexTriGraph;
    public gameover = false;
    public winner: playerID[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAlmataflState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AlmataflGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, CellContents[]>([
                    ["j2", [[1, "piece"]]],
                    ["j3", [[1, "piece"]]],
                    ["j4", [[1, "piece"]]],
                    ["j5", [[1, "piece"]]],
                    ["j6", [[1, "piece"]]],
                    ["i2", [[1, "piece"]]],
                    ["i7", [[1, "piece"]]],
                    ["h2", [[1, "piece"]]],
                    ["h8", [[1, "piece"]]],
                    ["g2", [[1, "piece"]]],
                    ["g9", [[1, "piece"]]],
                    ["f2", [[1, "piece"]]],
                    ["f10", [[1, "piece"]]],
                    ["e2", [[1, "piece"]]],
                    ["e9", [[1, "piece"]]],
                    ["d2", [[1, "piece"]]],
                    ["d8", [[1, "piece"]]],
                    ["c2", [[1, "piece"]]],
                    ["c7", [[1, "piece"]]],
                    ["b2", [[1, "piece"]]],
                    ["b3", [[1, "piece"]]],
                    ["b4", [[1, "piece"]]],
                    ["b5", [[1, "piece"]]],
                    ["b6", [[1, "piece"]]],

                    ["h5", [[2, "piece"]]],
                    ["g4", [[2, "piece"]]],
                    ["g5", [[2, "piece"]]],
                    ["g6", [[2, "piece"]]],
                    ["g7", [[2, "piece"]]],
                    ["f5", [[2, "piece"]]],
                    ["f6", [[2, "king"]]],
                    ["f7", [[2, "piece"]]],
                    ["e4", [[2, "piece"]]],
                    ["e5", [[2, "piece"]]],
                    ["e6", [[2, "piece"]]],
                    ["e7", [[2, "piece"]]],
                    ["d5", [[2, "piece"]]],
                ]),
            };
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAlmataflState;
            }
            if (state.game !== AlmataflGame.gameinfo.uid) {
                throw new Error(`The Almatafl engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AlmataflGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents[]>;
        this.lastmove = state.lastmove;
        this.buildGraph();
        return this;
    }

    private buildGraph(): AlmataflGame {
        this.graph = new HexTriGraph(6, 11);
        return this;
    }

    public moves(permissive = false, player?: playerID): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const mine = [...this.board.entries()].filter(([,stack]) => stack[stack.length - 1][0] === player).map(([cell,]) => cell);
        // only do regular piece movements for now
        for (const cell of mine) {
            const [x, y] = this.graph.algebraic2coords(cell);
            const stack = this.board.get(cell)!;
            if (stack[stack.length - 1][1] !== "piece") {
                continue;
            }
            const dist = stack.length;
            for (const dir of HexTriGraph.directions) {
                const ray = this.graph.ray(x, y, dir).map(c => this.graph.coords2algebraic(...c));
                if (ray.length >= dist) {
                    const dest = ray[dist - 1];
                    if ( (! this.board.has(dest)) || (this.board.get(dest)!.length < 3) ) {
                        // defender can't stack on top of the king
                        if ( (player === 2) && (this.board.get(dest)?.map(c => c[1]).includes("king"))) {
                            continue;
                        }
                        // can't move onto a blocked cell or the throne
                        if ( (AlmataflGame.blocked.includes(dest)) || (dest === "f6") ) {
                            continue;
                        }
                        // Can't move onto exits unless advanced variant and king is there
                        if (AlmataflGame.exits.includes(dest)) {
                            if ( (! this.variants.includes("advanced")) || (! this.board.has(dest)) || (! this.board.get(dest)!.map(c => c[1]).includes("king")) ) {
                                continue;
                            }
                        }

                        moves.push(`${cell}-${dest}`);
                    }
                }
            }
        }

        // now do king movement if it's p2's turn
        if (player === 2) {
            const kings = [...this.board.entries()].filter(([,stack]) => stack[stack.length - 1][1] === "king").map(([cell,]) => cell);
            if (kings.length > 0) {
                const start = kings[0];
                const graph = this.buildGraphFrom(start);
                const paths: string[][] = [];
                for (const node of graph.nodes()) {
                    if (node === start) { continue; }
                    if (permissive) {
                        paths.push(...allSimplePaths(graph, start, node));
                    } else {
                        paths.push(bidirectional(graph, start, node)!);
                    }
                }
                for (const path of paths) {
                    moves.push(path.join("-"));
                }
            }
        }

        moves.sort();
        return moves;
    }

    public buildGraphFrom(start: string): DirectedGraph {
        if (! this.board.has(start)) {
            throw new Error(`There's no piece at ${start}, so targets cannot be found.`);
        }

        const grid = new HexTriGraph(6, 11);
        const graph = new DirectedGraph();
        graph.addNode(start);
        const toVisit = [start];
        const visited = new Set<string>();
        while (toVisit.length > 0) {
            const cell = toVisit.pop()!;
            if (visited.has(cell)) { continue; }
            visited.add(cell);
            const [x,y] = grid.algebraic2coords(cell);
            const stack = this.board.get(cell);
            // empty cells are dead ends
            if (stack === undefined) {
                continue;
            }
            // stacks topped with our own pieces are also dead ends
            if ( (cell !== start) && (stack[stack.length - 1][0] === 2) ) {
                continue;
            }
            // the distance we want to travel is equal to the current stack height plus the bouncing king
            let dist = stack.length + 1;
            // but if we're looking at the start space, don't add one
            if (cell === start) {
                dist--;
            }
            for (const dir of HexTriGraph.directions) {
                const ray = grid.ray(x, y, dir).map(node => grid.coords2algebraic(...node));
                if (ray.length >= dist) {
                    const dest = ray[dist - 1];
                    // king can't move to blocked cells
                    if (AlmataflGame.blocked.includes(dest)) {
                        continue;
                    }
                    // as long as the destination has fewer than three pieces already, we can reach it
                    const destStack = this.board.get(dest);
                    if ( (destStack === undefined) || (destStack.length < 3) ) {
                        if (! graph.hasNode(dest)) {
                            graph.addNode(dest);
                        }
                        graph.addDirectedEdge(cell, dest);
                        toVisit.push(dest);
                    }
                } // if ray.length >= dist
            } // foreach dir
        }
        return graph;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else {
                newmove = `${move}-${cell}`;
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
            result.message = i18next.t("apgames:validation.almatafl.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [start, ...rest] = m.split("-");
        // Invalid cell
        try {
            this.graph.algebraic2coords(start);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: start});
            return result;
        }
        const stackStart = this.board.get(start);
        if (stackStart === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: start});
            return result;
        }
        if (stackStart[stackStart.length - 1][0] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        if (rest.length === 0) {
            result.valid = true;
            result.complete = -1
            result.message = i18next.t("apgames:validation.almatafl.PARTIAL");
            return result;
        }
        if ( (rest.length > 1) && (stackStart[stackStart.length - 1][1] !== "king") ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.almatafl.BOUNCE_KING");
            return result;
        }

        // check each cell for validity
        for (let i = 0; i < rest.length; i++) {
            const cell = rest[i];
            // Invalid cell
            try {
                this.graph.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            if (AlmataflGame.blocked.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            const stack = this.board.get(cell);
            // only kings on the throne
            if ( (cell === "f6") && (stackStart[stackStart.length - 1][1] !== "king") ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.almatafl.KING_ONLY");
                return result;
            }
            // only kings on exits
            if ( (AlmataflGame.exits.includes(cell)) && (stackStart[stackStart.length - 1][1] !== "king") ) {
                // in advanced mode, though, can move here if king is already here
                if ( (! this.variants.includes("advanced")) || (stack === undefined) || (! stack.map(c => c[1]).includes("king")) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.almatafl.KING_ONLY");
                    return result;
                }
            }
            // stack height
            if ( (stack !== undefined) && (stack.length >= 3) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.almatafl.TOO_HIGH");
                return result;
            }
            // defender on king
            if ( (stackStart[stackStart.length - 1][0] === 2) && (stack?.map(c => c[1]).includes("king")) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.almatafl.FRIENDLY_FIRE");
                return result;
            }
            // if the king is moving, and not on the last jump, top piece must be invader
            if ( (stackStart[stackStart.length - 1][1] !== "king") && (i < rest.length - 1) && (stack !== undefined) && (stack[stack.length - 1][0] !== 1) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.almatafl.BOUNCE_INVADER");
                return result;
            }
        }

        // check distances and los
        const cells = m.split("-");
        for (let i = 0; i < cells.length - 1; i++) {
            const from = cells[i];
            const fStack = this.board.get(from) || [];
            const to = cells[i+1];
            const [fx, fy] = this.graph.algebraic2coords(from);
            let hasLos = false;
            let inRange = false;
            let dist = fStack.length + 1;
            if (i === 0) {
                dist--;
            }
            for (const dir of HexTriGraph.directions) {
                const ray = this.graph.ray(fx, fy, dir).map(c => this.graph.coords2algebraic(...c));
                if (ray.includes(to)) {
                    hasLos = true;
                    if ( (ray.length >= dist) && (ray[dist - 1] === to) ) {
                        inRange = true;
                    }
                    break;
                }
            }
            if (! hasLos) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOLOS", {from, to});
                return result;
            }
            if (! inRange) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.almatafl.BAD_DISTANCE");
                return result;
            }
        }

        // if there's only one move that matches, we're complete
        const matches = this.moves(true).filter(mv => mv.startsWith(m));
        if (matches.length === 1) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): AlmataflGame {
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
            if ( (! partial) && (! this.moves(true).includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const cells = m.split("-");
        const stackStart = this.board.get(cells[0])!;
        const pc = stackStart.pop()!;
        if (stackStart.length > 0) {
            this.board.set(cells[0], stackStart);
        } else {
            this.board.delete(cells[0]);
        }
        const stackEnd = this.board.get(cells[cells.length - 1]);
        if (stackEnd === undefined) {
            this.board.set(cells[cells.length - 1], [pc]);
        } else {
            this.board.set(cells[cells.length - 1], [...stackEnd, pc]);
        }
        for (let i = 0; i < cells.length - 1; i++) {
            this.results.push({type: "move", from: cells[i], to: cells[i+1]});
        }

        if (partial) { return this; }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerID;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): AlmataflGame {
        // is king stacked
        const kingStack = [...this.board.values()].filter(stack => stack.map(s => s[1]).includes("king"))[0];
        if (kingStack[kingStack.length - 1][1] !== "king") {
            this.gameover = true;
            this.winner = [1];
        }

        // are there still defenders left
        if (! this.gameover) {
            const defs = [...this.board.values()].filter(stack => stack[stack.length - 1][0] === 2 && stack[stack.length - 1][1] === "piece")
            if (defs.length === 0) {
                this.gameover = true;
                this.winner = [1];
            }
        }

        // is the king on an escape space
        if (! this.gameover) {
            if ( (! this.variants.includes("advanced")) || (this.currplayer === 2) ) {
                for (const exit of AlmataflGame.exits) {
                    if (this.board.has(exit)) {
                        const stack = this.board.get(exit)!;
                        if (stack[stack.length - 1][1] === "king") {
                            this.gameover = true;
                            this.winner = [2];
                        }
                    }
                }
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

    public state(): IAlmataflState {
        return {
            game: AlmataflGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AlmataflGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents[]>,
        };
    }

    public render(): APRenderRep {
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
                    let str = "";
                    for (const pc of this.board.get(cell)!) {
                        if (pc[0] === 1) {
                            str += "A";
                        } else {
                            if (pc[1] === "piece") {
                                str += "B";
                            } else {
                                str += "C";
                            }
                        }
                    }
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            // @ts-ignore
            board: {
                style: "hex-of-tri",
                minWidth: 6,
                maxWidth: 11,
                blocked: [{"row":0,"col":0},{"row":0,"col":1},{"row":0,"col":4},{"row":0,"col":5},{"row":1,"col":0},{"row":1,"col":6},{"row":4,"col":0},{"row":4,"col":9},{"row":5,"col":0},{"row":5,"col":10},{"row":6,"col":0},{"row":6,"col":9},{"row":9,"col":0},{"row":9,"col":6},{"row":10,"col":0},{"row":10,"col":1},{"row":10,"col":4},{"row":10,"col":5}],
                markers: [{"type":"dots","colour":"#888","size":0.33,"points":[{"row":0,"col":2},{"row":0,"col":3},{"row":3,"col":0},{"row":2,"col":0},{"row":2,"col":7},{"row":3,"col":8},{"row":7,"col":0},{"row":8,"col":0},{"row":8,"col":7},{"row":7,"col":8},{"row":10,"col":2},{"row":10,"col":3},{"row":5,"col":5}]}],
            },
            legend: {
                A: {
                    name: "piece",
                    colour: "#666"
                },
                B: {
                    name: "piece",
                    colour: "#fff"
                },
                C: {
                    name: "piece",
                    player: 1
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
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

        return status;
    }

    public getPlayerColour(p: playerID): number|string {
        if (p === 1) {
            return "#666";
        } else {
            return "#fff";
        }
    }

    public clone(): AlmataflGame {
        return new AlmataflGame(this.serialize());
    }
}
