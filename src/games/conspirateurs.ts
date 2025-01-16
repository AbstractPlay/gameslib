import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, shuffle, UserFacingError, SquareDirectedGraph } from "../common";
import i18next from "i18next";
import { DirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

export type playerid = 1|2|3|4;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IConspirateursState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ConspirateursGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Conspirateurs",
        uid: "conspirateurs",
        playercounts: [2, 3, 4],
        version: "20250114",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.conspirateurs")
        description: "apgames:descriptions.conspirateurs",
        // i18next.t("apgames:notes.conspirateurs")
        notes: "apgames:notes.conspirateurs",
        urls: ["https://en.wikipedia.org/wiki/Conspirateurs"],
        variants: [{uid: "quick", group: "setup"}, {uid: "strict", group: "movement"}],
        categories: ["goal>evacuate", "mechanic>traditional", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "no-moves", "custom-randomization", "scores"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private dots: string[] = [];

    constructor(state: IConspirateursState | string | number, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const board = new Map<string, playerid>();
            if (this.variants.includes("quick")) {
                const pieces: (playerid|null)[] = [];
                for (let i = 1; i <= this.numplayers; i++) {
                    const lst = Array.from({length: this.numplayers === 2 ? 20 : this.numplayers === 3 ? 14 : 10}, () => i as playerid)
                    pieces.push(...lst);
                }
                while (pieces.length < 45) {
                    pieces.push(null);
                }
                const shuffled = shuffle(pieces) as (playerid|null)[];
                const zone = this.dropZone;
                for (let i = 0; i < zone.length; i++) {
                    if (shuffled[i] !== null) {
                        board.set(zone[i], shuffled[i]!)
                    }
                }
            }

            const fresh: IMoveState = {
                _version: ConspirateursGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConspirateursState;
            }
            if (state.game !== ConspirateursGame.gameinfo.uid) {
                throw new Error(`The Conspirateurs engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ConspirateursGame {
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
        return this;
    }

    public get graph(): SquareDirectedGraph {
        const g = new SquareDirectedGraph(17, 17);
        // if strict movement, drop all outgoing edges from sanctuary spaces
        if (this.variants.includes("strict")) {
            for (const sanct of this.sanctuaries) {
                for (const edge of g.graph.outEdges(sanct)) {
                    g.graph.dropEdge(edge);
                }
            }
        }
        return g;
    }

    public get dropZone(): string[] {
        const g = this.graph;
        const cells: string[] = [];
        for (const row of [6, 7, 8, 9, 10]) {
            for (const col of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
                cells.push(g.coords2algebraic(col, row));
            }
        }
        return cells;
    }

    public get sanctuaries(): Set<string> {
        // can't use `this.graph` because of circular dependency
        const g = new SquareDirectedGraph(17, 17);
        const pattern = [0, 1, 3, 5, 7, 8, 9, 11, 13, 15, 16];
        const cells = new Set<string>();
        for (const row of [0, 16]) {
            for (const col of pattern) {
                cells.add(g.coords2algebraic(col, row));
                cells.add(g.coords2algebraic(row, col));
            }
        }
        if (this.numplayers !== 3) {
            cells.delete("i1");
        }
        return cells;
    }

    public toDrop(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        const start = this.numplayers === 2 ? 20 : this.numplayers === 3 ? 14 : 10;
        const pieces = [...this.board.values()].filter(n => n === p);
        return start - pieces.length;
    }

    public buildBaseJumpGraph(): DirectedGraph {
        // look at each empty cell on the board and look for an occupied neighbour
        // if the cell after that is empty, then it's a possible jump
        const g = new DirectedGraph();
        const gFull = this.graph;
        const grid = new RectGrid(17, 17);
        const sanctuaries = this.sanctuaries;
        const empties = gFull.graph.nodes().filter(c => !this.board.has(c));
        for (const cell of empties) {
            // if strict movement, there's no leaving a sanctuary cell
            if (this.variants.includes("strict") && sanctuaries.has(cell)) {
                continue;
            }
            const [x, y] = gFull.algebraic2coords(cell);
            for (const dir of allDirections) {
                const ray = grid.ray(x, y, dir).map(c => gFull.coords2algebraic(...c));
                if (ray.length >= 2) {
                    if (this.board.has(ray[0]) && !this.board.has(ray[1])) {
                        if (!g.hasNode(cell)) {
                            g.addNode(cell);
                        }
                        if (!g.hasNode(ray[1])) {
                            g.addNode(ray[1]);
                        }
                        if (!g.hasEdge(cell, ray[1])) {
                            g.addEdge(cell, ray[1]);
                        }
                        if (this.variants.includes("strict")) {
                            // if the next cell is not a sanctuary, then add a reciprocal edge
                            if (!sanctuaries.has(ray[1]) && !g.hasEdge(ray[1], cell)) {
                                g.addEdge(ray[1], cell);
                            }
                        } else if (!g.hasEdge(ray[1], cell)) {
                            g.addEdge(ray[1], cell);
                        }
                    }
                }
            }
        }
        return g;
    }

    public buildPieceJumpGraph(baseGraph: DirectedGraph, cell: string): DirectedGraph {
        const gFull = this.graph;
        const grid = new RectGrid(17, 17);
        const g = baseGraph.copy();
        if (!g.hasNode(cell)) {
            g.addNode(cell);
        }

        const sanctuaries = this.sanctuaries;
        const [x, y] = gFull.algebraic2coords(cell);
        for (const dir of allDirections) {
            const ray = grid.ray(x, y, dir).map(c => gFull.coords2algebraic(...c));
            if (ray.length >= 2) {
                if (this.board.has(ray[0]) && !this.board.has(ray[1])) {
                    if (!g.hasNode(ray[1])) {
                        g.addNode(ray[1]);
                    }
                    if (!g.hasEdge(cell, ray[1])) {
                        g.addEdge(cell, ray[1]);
                    }
                    // if the next cell is not a sanctuary, then add a reciprocal edge
                    if (!sanctuaries.has(ray[1]) && !g.hasEdge(ray[1], cell)) {
                        g.addEdge(ray[1], cell);
                    }
                }
            }
        }
        return g;
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }

    //     const moves: string[] = [];

    //     const g = this.graph;
    //     const inhand = this.toDrop();
    //     if (inhand > 0) {
    //         const empties = this.dropZone.filter(c => !this.board.has(c));
    //         moves.push(...empties);
    //     } else {
    //         const sanctuaries = this.sanctuaries;
    //         const mine = [...this.board.entries()].filter(([,n]) => n === this.currplayer).map(([c,]) => c).filter(c => !sanctuaries.has(c));
    //         const gBase = this.buildBaseJumpGraph();
    //         for (const cell of mine) {
    //             // simple moves first
    //             for (const n of g.neighbours(cell)) {
    //                 if (!this.board.has(n)) {
    //                     moves.push(`${cell}-${n}`);
    //                 }
    //             }
    //             // now jumps
    //             const gJump = this.buildPieceJumpGraph(gBase, cell);
    //             for (const node of gJump.nodes()) {
    //                 if (node === cell) { continue; }
    //                 moves.push(...allSimplePaths(gJump, cell, node).map(path => path.join("-")));
    //             }
    //         }
    //     }

    //     return moves.sort((a,b) => a.localeCompare(b));
    // }

    public randomMove(): string {
        if (this.toDrop(this.currplayer) > 0) {
            const cells = this.dropZone.filter(c => !this.board.has(c));
            return (shuffle(cells) as string[])[0];
        } else {
            const g = this.graph;
            const gBase = this.buildBaseJumpGraph();
            const sanct = [...this.sanctuaries].filter(c => !this.board.has(c) && gBase.hasNode(c));
            const mine = shuffle([...this.board.entries()].filter(([,p]) => p === this.currplayer).map(([c,]) => c)) as string[];
            for (const from of mine) {
                const gMove = this.buildPieceJumpGraph(gBase, from);
                // if a sanctuary is reachable, go there
                for (const cell of sanct) {
                    const path = bidirectional(gMove, from, cell);
                    if (path !== null) {
                        return path.join("-");
                    }
                }
                // otherwise, find the first empty space this piece can move to
                const empties = shuffle(gBase.nodes()) as string[];
                for (const cell of empties) {
                    const path = bidirectional(gMove, from, cell);
                    if (path !== null) {
                        return path.join("-");
                    }
                }
                // if this piece can't jump, can it move
                const nextEmpties = shuffle(g.neighbours(from).filter(c => !this.board.has(c))) as string[];
                return [from, nextEmpties[0]].join("-");
            }
        }
        if (this.numplayers === 4) {
            return "pass";
        } else {
            throw new Error("Unable to generate a move from the current state!");
        }
    }

    public hasMoves(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const sancts = this.sanctuaries;
        const mine = [...this.board.entries()].filter(([c,p]) => !sancts.has(c) && p === player).map(([c,]) => c);
        // you must have pieces in danger
        if (mine.length === 0) {
            return false;
        }
        const g = this.graph;
        const gBase = this.buildBaseJumpGraph();
        for (const pc of mine) {
            const nEmpties = g.graph.outNeighbors(pc).filter(c => !this.board.has(c));
            if (nEmpties.length > 0) {
                return true;
            }
            const gMove = this.buildPieceJumpGraph(gBase, pc);
            if (gMove.outEdges(pc).length > 0) {
                return true;
            }
        }
        return false;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove:string;

            if (move === "" || this.board.has(cell)) {
                newmove = cell;
            } else {
                const sofar = move.split("-");
                newmove = [...sofar, cell].join("-");
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.conspirateurs.INITIAL_INSTRUCTIONS", {context: this.toDrop() > 0 ? "drop" : "move"})
            return result;
        }

        if (m === "pass") {
            if (this.numplayers !== 4 || this.hasMoves()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.conspirateurs.BAD_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // drop or start of move
        if (!m.includes("-")) {
            if (this.toDrop() > 0) {
                // must be empty
                if (this.board.has(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                    return result;
                }
                // must be in the drop zone
                if (!this.dropZone.includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.conspirateurs.BAD_PLACE");
                    return result;
                }
                // Looks good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                // must be occupied
                if (!this.board.has(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                    return result;
                }
                // must be yours
                if (this.board.get(m)! !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
                // may not be in a sanctuary
                if (this.sanctuaries.has(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.conspirateurs.SAFE");
                    return result;
                }
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            }
        } else {
            const cells = m.split("-");
            let isSimple = false;
            if (cells.length === 2) {
                const g = this.graph;
                const neighbours = g.graph.outNeighbors(cells[0]).filter(c => !this.board.has(c));
                if (neighbours.includes(cells[1])) {
                    isSimple = true;
                }
            }
            if (!isSimple) {
                const start = cells[0]
                const gBase = this.buildBaseJumpGraph();
                const gJump = this.buildPieceJumpGraph(gBase, start);
                for (let i = 0; i < cells.length - 1; i++) {
                    const from = cells[i];
                    const to = cells[i+1];
                    if (!gJump.outNeighbors(from).includes(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.conspirateurs.BAD_MOVE", {from, to});
                        return result;
                    }
                }
            }

            // Looks good
            result.valid = true;
            result.complete = isSimple ? 1 : 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): ConspirateursGame {
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
        }

        this.results = [];
        this.dots = [];

        // if partial, populate dots and get out
        if (partial) {
            const cells = m.split("-");
            // if just starting, add simple moves
            if (cells.length === 1) {
                const g = this.graph;
                this.dots.push(...g.graph.outNeighbors(cells[0]).filter(c => !this.board.has(c)));
            }
            // now add jumps
            const gBase = this.buildBaseJumpGraph();
            const gMove = this.buildPieceJumpGraph(gBase, cells[0]);
            this.dots.push(...gMove.outNeighbors(cells[cells.length - 1]));

            // go ahead and move the piece so the display updates
            this.board.delete(cells[0]);
            this.board.set(cells[cells.length - 1], this.currplayer);
            return this;
        }

        if (m.includes("-")) {
            const steps = m.split("-");
            const from = steps[0];
            const to = steps[steps.length - 1];
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            for (let i = 0; i < steps.length-1; i++) {
                this.results.push({type: "move", from: steps[i], to: steps[i+1]});
            }
        } else {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
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

    public numToCatch(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        const sanctuaries = this.sanctuaries;
        return [...this.board.entries()].filter(([c,p]) => !sanctuaries.has(c) && p === player).length;
    }

    protected checkEOG(): ConspirateursGame {
        let toDrop = 0;
        for (let p = 1; p <= this.numplayers; p++) {
            toDrop += this.toDrop(p as playerid);
        }

        if (toDrop === 0) {
            if (this.numplayers !== 4) {
                for (let p = 1; p <= this.numplayers; p++) {
                    if (this.numToCatch(p as playerid) === 0) {
                        this.gameover = true;
                        this.winner = [p as playerid];
                        break;
                    }
                }
            } else {
                const t1 = this.numToCatch(1) + this.numToCatch(2);
                const t2 = this.numToCatch(3) + this.numToCatch(4);
                if (t1 === 0 || t2 === 0) {
                    this.gameover = true;
                    if (t1 === 0) {
                        this.winner = [1,2];
                    } else {
                        this.winner = [3,4];
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

    public getPlayersScores(): IScores[] {
        const toDrop: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            toDrop.push(this.toDrop(p as playerid));
        }
        if (toDrop.reduce((prev, curr) => prev + curr, 0) > 0) {
            return [{ name: i18next.t("apgames:status.conspirateurs.TO_PLACE"), scores: toDrop}];
        } else {
            const inDanger: number[] = [];
            for (let p = 1; p <= this.numplayers; p++) {
                inDanger.push(this.numToCatch(p as playerid));
            }
            return [{ name: i18next.t("apgames:status.conspirateurs.IN_DANGER"), scores: inDanger}];
        }
    }

    public state(): IConspirateursState {
        return {
            game: ConspirateursGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ConspirateursGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        const sanctuaries = this.sanctuaries;
        const labels = ["A", "B", "C", "D"];
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 17; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 17; col++) {
                const cell = g.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    let pc = labels[contents-1];
                    if (sanctuaries.has(cell)) {
                        pc += "X";
                    }
                    pieces.push(pc);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        type Legend = {
            [key: string]: Glyph|[Glyph, ...Glyph[]];
        }
        const legend: Legend = {};
        for (let p = 1; p <= this.numplayers; p++) {
            legend[labels[p-1]] = {
                name: "piece",
                colour: p,
            }
            legend[labels[p-1] + "X"] = {
                name: "piece",
                colour: {
                    func: "lighten",
                    colour: p,
                    ds: 3,
                    dl: 1,
                },
            }
        }

        // mark sanctuaries
        const markers: MarkerFlood[] = [];
        const marker: MarkerFlood = {
            type: "flood",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.25,
            },
            points: [...this.sanctuaries].map(cell => {
                const [x, y] = g.algebraic2coords(cell);
                return {row: y, col: x};
            }) as [RowCol, ...RowCol[]],
        };

        // mark drop zone if pieces are left to place
        let toDrop = 0;
        for (let p = 1; p <= this.numplayers; p++) {
            toDrop += this.toDrop(p as playerid);
        }
        if (toDrop > 0) {
            marker.points.push(...this.dropZone.map(cell => {
                const [x, y] = g.algebraic2coords(cell);
                return {row: y, col: x};
            }));
        }
        markers.push(marker);

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 17,
                height: 17,
                markers,
            },
            legend,
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this.dots.length > 0) {
            if (!("annotations" in rep) || rep.annotations === undefined) {
                rep.annotations = [];
            }
            rep.annotations.push({
                type: "dots",
                targets: this.dots.map(cell => {
                    const [x, y] = g.algebraic2coords(cell);
                    return {row: y, col: x};
                }) as [RowCol, ...RowCol[]],
            });
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

    // public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
    //     let resolved = false;
    //     switch (r.type) {
    //         case "place":
    //             node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
    //             resolved = true;
    //             break;
    //         case "move":
    //             resolved = true;
    //             break;
    //     }
    //     return resolved;
    // }

    public clone(): ConspirateursGame {
        return new ConspirateursGame(this.serialize());
    }
}
