/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { IPoint, RectGrid, reviver, shuffle, SquareDiagGraph, SquareGraph, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
import { UndirectedGraph } from "graphology";
import { linesIntersect } from "../common/plotting";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    bridges: [string,string][];
    lastmove?: string;
    triggered?: boolean;
};

export interface IPonteDDState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PonteDDGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Ponte del Diavolo",
        uid: "pontedd",
        playercounts: [2],
        version: "20250310",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.pontedd")
        description: "apgames:descriptions.pontedd",
        urls: ["https://boardgamegeek.com/boardgame/27172/ponte-del-diavolo"],
        people: [
            {
                type: "designer",
                name: "Martin Ebel",
                urls: ["https://boardgamegeek.com/boardgamedesigner/431/martin-ebel"],
            },
        ],
        variants: [
            {uid: "size-12", group: "board"},
        ],
        categories: ["goal>score>eog", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["experimental", "pie", "scores", "no-moves", "custom-randomization", "custom-buttons"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public bridges!: [string,string][];
    public triggered?: boolean;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private dots: string[] = [];

    constructor(state?: IPonteDDState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: PonteDDGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                bridges: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPonteDDState;
            }
            if (state.game !== PonteDDGame.gameinfo.uid) {
                throw new Error(`The PonteDD engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PonteDDGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid>;
        this.bridges = deepclone(state.bridges) as [string,string][];
        this.triggered = state.triggered;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public get boardsize(): number {
        if (this.variants.includes("size-12")) {
            return 12;
        }
        return 10;
    }
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }
    //     return ["a","b","c","d"];
    // }

    private randomBridge(): string|null {
        if (this.bridges.length < 15) {
            const mine = [...this.board.entries()].filter(([,v]) => v === this.currplayer).map(([k,]) => k);
            const shuffled = shuffle(mine) as string[];
            for (let i = 0; i < shuffled.length; i++) {
                const start = shuffled[i];
                const rest = shuffled.slice(i+1);
                for (const end of rest) {
                    const mv = [start, end].join("-");
                    const result = this.validateMove(mv);
                    if (result.valid && result.complete === 1) {
                        return mv;
                    }
                }
            }
        }
        return null;
    }

    private randomPlace(): string|null {
        if (this.inhand() > 0) {
            const g = new SquareGraph(this.boardsize, this.boardsize);
            const empty = g.graph.nodes().filter(c => !this.board.has(c));
            const shuffled = shuffle(empty) as string[];
            for (let i = 0; i < shuffled.length; i++) {
                const start = shuffled[i];
                const rest = shuffled.slice(i+1);
                for (const end of rest) {
                    const mv = [start, end].join(",")
                    const result = this.validateMove(mv);
                    if (result.valid && result.complete === 1) {
                        return mv;
                    }
                }
            }
        }
        return null;
    }

    public randomMove(): string {
        const placement = this.randomPlace();
        const bridge = this.randomBridge();
        const r = Math.random();
        // bridges
        if (r >= 0.5 && bridge !== null) {
            return bridge;
        } else if (placement !== null) {
            return placement;
        }
        return "pass";
    }

    public getButtons(): ICustomButton[] {
        if (this.randomPlace() === null) return [{ label: "pass", move: "pass" }];
        return [];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove: string;

            // empty move
            if (move === "") {
                newmove = cell;

                // if starting a bridge, autocomplete if there's only one option
                if (this.board.has(cell)) {
                    const conns = this.getBridgeConnections(cell);
                    if (conns.length === 1) {
                        newmove = cell + "-" + conns[0];
                    }
                }
            }
            // extending move
            else {
                // if clicking the same cell twice, deselect
                if (cell === move) {
                    newmove = "";
                }
                // if first click was empty cell, placing
                if (!this.board.has(move)) {
                    newmove = [move, cell].join(",");
                }
                // otherwise bridge
                else {
                    newmove = [move, cell].join("-");
                }
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

    private getBlocked(a: string, b: string): string[] {
        const blocked: string[] = [];
        const [x1, y1] = this.algebraic2coords(a);
        const [x2, y2] = this.algebraic2coords(b);
        if (RectGrid.isOrth(x1, y1, x2, y2) || RectGrid.isDiag(x1, y1, x2, y2)) {
            const between = RectGrid.between(x1, y1, x2, y2);
            for (const c of between) {
                blocked.push(this.coords2algebraic(...c));
            }
        } else {
            const gOrth = new SquareOrthGraph(this.boardsize, this.boardsize);
            const gDiag = new SquareDiagGraph(this.boardsize, this.boardsize);
            const orth1 = gOrth.neighbours(a);
            const diag1 = gDiag.neighbours(a);
            for (const dn of gDiag.neighbours(b)) {
                if (orth1.includes(dn)) {
                    blocked.push(dn);
                    break;
                }
            }
            for (const on of gOrth.neighbours(b)) {
                if (diag1.includes(on)) {
                    blocked.push(on);
                    break;
                }
            }
        }
        return blocked;
    }

    public get blocked(): string[] {
        const blocked: string[] = [];
        for (const [cell1, cell2] of this.bridges) {
            blocked.push(...this.getBlocked(cell1, cell2));
        }
        return blocked;
    }

    public inhand(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        const onboard = [...this.board.values()].filter(v => v === p).length
        return 40 - onboard;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // console.log(`validating ${m}`);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pontedd.INITIAL_INSTRUCTIONS", {context: this.stack.length > 3 ? "play": "setup"});
            return result;
        }

        if (m === "pass") {
            if (this.randomPlace() !== null) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pontedd.BAD_PASS");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        // placements
        if (m.includes(",") || (m.length <= 3 && !this.board.has(m))) {
            if (this.inhand() === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pontedd.NO_TILES");
                return result;
            }
            const cells = m.split(",");
            if (cells.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pontedd.TOO_MANY");
                return result;
            }
            const cloned = this.clone();
            for (const cell of cells) {
                // must be empty
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                    return result;
                }

                // add cell to cloned board
                cloned.board.set(cell, this.currplayer);

                // get islands & sandbars
                const conn = cloned.getGroups(this.currplayer);

                const group = conn.find(grp => grp.includes(cell))!;
                // can't be larger than four cells
                if (group.length > 4) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.TOO_BIG");
                    return result;
                }
                // Check all groups for islands with diagonal adjacencies
                const gDiag = new SquareDiagGraph(this.boardsize, this.boardsize);
                for (const cluster of conn) {
                    if (cluster.length === 4) {
                        for (const c of cluster) {
                            for (const n of gDiag.neighbours(c)) {
                                // if digonal neighbour is not in the group and has a tile of same colour, error
                                if (!cluster.includes(n) && cloned.board.has(n) && cloned.board.get(n)! === this.currplayer) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.pontedd.TOO_CLOSE");
                                    return result;
                                }
                            }
                        }
                    }
                }

                // can't place tiles on blocked cells
                if (this.blocked.includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.BLOCKED", {cell});
                    return result;
                }
            }

            // we're good
            result.valid = true;
            result.complete = cells.length === 2 ? 1 : 0;
            result.canrender = true;
            result.message = cells.length === 2 ?
                i18next.t("apgames:validation._general.VALID_MOVE") :
                i18next.t("apgames:validation.pontedd.PARTIAL_PLACE");
            return result;
        }
        // bridges
        else if (m.includes("-") || (m.length <= 3 && this.board.has(m))) {
            if (this.bridges.length === 15) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pontedd.NO_BRIDGES");
                return result;
            }
            const cells = m.split("-");
            // if only one cell, can't validate, just return partial
            if (cells.length === 1) {
                // has to be your own colour
                if (this.board.get(cells[0]) !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_OWNER");
                    return result;
                }

                // must be at least one valid connection
                const conns = this.getBridgeConnections(cells[0]);
                if (conns.length < 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_NONE", {cell: cells[0]});
                    return result;
                }

                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.pontedd.PARTIAL_BRIDGE");
                return result;
            }

            if (!this.board.has(cells[0]) || !this.board.has(cells[1]) || this.board.get(cells[0])! !== this.currplayer || this.board.get(cells[1])! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_COLOUR");
                return result;
            }

            const [x1, y1] = this.algebraic2coords(cells[0]);
            const [x2, y2] = this.algebraic2coords(cells[1]);
            const dist = Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
            if (dist !== 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_DISTANCE");
                return result;
            }

            for (const blocked of this.getBlocked(cells[0], cells[1])) {
                if (this.board.has(blocked)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_BLOCKED");
                    return result;
                }
            }

            // no double bridges
            const bridgeCells = this.bridges.flat();
            for (const cell of cells) {
                if (bridgeCells.includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_DOUBLE");
                    return result;
                }
            }

            // TODO: No crossed bridges
            const p1: IPoint = {x: x1, y: y1};
            const q1: IPoint = {x: x2, y: y2};
            for (const [p, q] of this.bridges) {
                const [px, py] = this.algebraic2coords(p);
                const [qx, qy] = this.algebraic2coords(q);
                const p2: IPoint = {x: px, y: py};
                const q2: IPoint = {x: qx, y: qy};
                if (linesIntersect(p1, q1, p2, q2)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pontedd.BAD_BRIDGE_CROSSED");
                    return result;
                }
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        result.valid = false;
        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): PonteDDGame {
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
            // if (! this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        this.dots = [];

        if (m === "pass") {
            this.triggered = true;
            this.results.push({type: "pass"});
        } else {
            const cells = m.split(/[,-]/);
            let isPlace = false;
            // placement (could be partial)
            if (m.includes(",") || (m.length <= 3 && !this.board.has(cells[0]))) {
                isPlace = true;
                for (const cell of cells) {
                    this.board.set(cell, this.currplayer);
                    this.results.push({type: "place", where: cell});
                }
            }
            // bridge (must be complete)
            else if (m.includes("-")) {
                this.bridges.push(cells as [string,string]);
                this.results.push({type: "connect", p1: cells[0], p2: cells[1]});
            }
            if (partial) {
                // highlight potential bridge completions if relevant
                if (cells.length === 1 && !isPlace) {
                    this.results.push({type: "place", where: cells[0]});
                    const conns = this.getBridgeConnections(cells[0]);
                    this.dots.push(...conns);
                }

                // return early;
                return this;
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

    private getBridgeConnections(start: string): string[] {
        const player = this.board.get(start);
        if (player === undefined) { return []; }
        const mine = [...this.board.entries()].filter(([,v]) => v === this.currplayer).map(([k,]) => k);
        const conns: string[] = [];
        for (const cell of mine) {
            if (cell === start) { continue; }
            const mv = start + "-" + cell;
            const result = this.validateMove(mv);
            if (result.valid === true && result.complete === 1) {
                conns.push(cell);
            }
        }
        return conns;
    }

    private getGroups(p?: playerid): string[][] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = new SquareOrthGraph(this.boardsize, this.boardsize).graph;
        for (const node of [...g.nodes()]) {
            if (!this.board.has(node) || this.board.get(node)! !== p) {
                g.dropNode(node);
            }
        }
        const islands = connectedComponents(g);
        return islands;
    }

    private getIslands(p?: playerid): string[][] {
        const groups = this.getGroups(p);
        return groups.filter(grp => grp.length === 4);
    }

    public getPlayerScore(player: number): number {
        const g = new UndirectedGraph();
        const groups = this.getGroups(player as playerid);
        for (const grp of groups) {
            const id = grp.join(",");
            g.addNode(id);
        }
        for (const [cell1, cell2] of this.bridges) {
            const i1 = groups.find(grp => grp.includes(cell1));
            const i2 = groups.find(grp => grp.includes(cell2));
            if (i1 !== undefined && i2 !== undefined) {
                const id1 = i1.join(",");
                const id2 = i2.join(",");
                if (!g.hasUndirectedEdge(id1, id2)) {
                    g.addUndirectedEdge(id1, id2);
                }
            }
        }
        const conn = connectedComponents(g);

        let score = 0;
        for (const network of conn) {
            let numIslands = 0;
            for (const node of network) {
                const cells = node.split(",");
                if (cells.length === 4) {
                    numIslands++;
                }
            }
            if (numIslands === 1) {
                score += 1;
            } else if (numIslands === 2) {
                score =+ 3;
            } else if (numIslands === 3) {
                score =+ 6;
            } else if (numIslands === 4) {
                score =+ 10;
            } else if (numIslands === 5) {
                score =+ 15;
            } else if (numIslands === 6) {
                score =+ 21;
            } else if (numIslands === 7) {
                score =+ 28;
            } else if (numIslands > 7) {
                score =+ 36;
            }
        }
        return score;
    }

    private countIslands(p?: playerid): number {
        return this.getIslands(p).length;
    }

    private countBridges(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        let num = 0;
        for (const [cell,] of this.bridges) {
            if (this.board.get(cell) === p) {
                num++;
            }
        }
        return num;
    }

    protected checkEOG(): PonteDDGame {
        let reason = "";
        if (this.triggered && this.currplayer === 1) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            reason = "score";
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                reason = "islands";
                const i1 = this.countIslands(1);
                const i2 = this.countIslands(2);
                if (i1 > i2) {
                    this.winner = [1];
                } else if (i2 > i1) {
                    this.winner = [2];
                } else {
                    reason = "bridges";
                    const b1 = this.countBridges(1);
                    const b2 = this.countBridges(2);
                    if (b1 > b2) {
                        this.winner = [1];
                    } else if (b2 > b1) {
                        this.winner = [2];
                    } else {
                        this.winner = [1,2];
                    }
                }
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IPonteDDState {
        return {
            game: PonteDDGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PonteDDGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()]),
            bridges: this.bridges.map(b => [...b] as [string,string]),
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showVertex = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "vertex-board") {
                showVertex = true;
            }
        }

        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: showVertex ? "vertex" : "squares-beveled",
                width: this.boardsize,
                height: this.boardsize,
            },
            legend: {
                A: {
                    name: "piece-square-borderless",
                    colour: 1
                },
                B: {
                    name: "piece-square-borderless",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // add bridges
        if (this.bridges.length > 0) {
            rep.annotations = [];
            for (const [left, right] of this.bridges) {
                const [lx, ly] = this.algebraic2coords(left);
                const [rx, ry] = this.algebraic2coords(right);
                rep.annotations.push({
                    type: "line",
                    targets: [{row: ly, col: lx}, {row: ry, col: rx}],
                    arrow: false,
                    strokeWidth: 0.25,
                });
            }
        }

        // Add annotations
        if (this.results.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const move of this.results) {
                if (move.type === "connect") {
                    for (const cell of [move.p1, move.p2]) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
                    }
                } else if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // add dots
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const dot of this.dots) {
                const [x, y] = this.algebraic2coords(dot);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "connect":
                node.push(i18next.t("apresults:CONNECT.pontedd", {player, left: r.p1, right: r.p2}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PonteDDGame {
        const cloned = Object.assign(new PonteDDGame(), deepclone(this) as PonteDDGame);
        return cloned;
    }
}
