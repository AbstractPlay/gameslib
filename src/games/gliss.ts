/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { DirectionCardinal, RectGrid, reviver, shuffle, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
import { DirectedGraph } from "graphology";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IGlissState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type Glider = {
    core: string,
    arm1: {dir: DirectionCardinal, cell: string},
    arm2: {dir: DirectionCardinal, cell: string},
    // the cell that would be filled by a tower when docking
    dock: string,
};

export class GlissGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Gliss",
        uid: "gliss",
        playercounts: [2],
        version: "20250316",
        dateAdded: "2024-05-13",
        // i18next.t("apgames:descriptions.gliss")
        description: "apgames:descriptions.gliss",
        urls: ["https://boardgamegeek.com/boardgame/428098/gliss"],
        people: [
            {
                type: "designer",
                name: "Corey Clark",
                urls: ["https://boardgamegeek.com/boardgamedesigner/38921/corey-clark"],
            }
        ],
        variants: [
            { uid: "size-12", group: "board" },
            { uid: "#board" },
            { uid: "size-19", group: "board" },
        ],
        categories: ["goal>annihilate", "goal>score>race", "mechanic>place", "mechanic>capture", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "no-moves", "custom-randomization"],
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private highlights: string[] = [];
    private selected: string|undefined;

    constructor(state?: IGlissState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: GlissGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGlissState;
            }
            if (state.game !== GlissGame.gameinfo.uid) {
                throw new Error(`The Gliss game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GlissGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map([...state.board.entries()]);
        this.lastmove = state.lastmove;
        return this;
    }

    protected get boardSize(): number {
        // Get board size from variants.
        const found = this.variants.find(v => v.startsWith("size-"));
        if (found !== undefined) {
            const [,nstr] = found.split("-");
            const n = parseInt(nstr, 10);
            return n;
        }
        return 12;
    }

    private get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    private isBaseValid(cell: string, player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const g = this.graph;
        const [col, row] = g.algebraic2coords(cell);
        if (col === this.boardSize - 1 || row === this.boardSize - 1) {
            return false;
        }
        const cells = [
            g.coords2algebraic(col, row),
            g.coords2algebraic(col+1, row),
            g.coords2algebraic(col, row+1),
            g.coords2algebraic(col+1, row+1),
        ];
        // none of the cells can have pieces already
        if (cells.reduce((acc, curr) => acc || this.board.has(curr), false)) {
            return false;
        }
        const neighbours: string[] = [];
        // left neighbours
        if (col > 0) {
            neighbours.push(g.coords2algebraic(col-1, row));
            neighbours.push(g.coords2algebraic(col-1, row+1));
        }
        // right neighbours
        if (col < this.boardSize - 2) {
            neighbours.push(g.coords2algebraic(col+2, row));
            neighbours.push(g.coords2algebraic(col+2, row+1));
        }
        // top neighbours
        if (row > 0) {
            neighbours.push(g.coords2algebraic(col, row-1));
            neighbours.push(g.coords2algebraic(col+1, row-1));
        }
        // bottom neighbours
        if (row < this.boardSize - 2) {
            neighbours.push(g.coords2algebraic(col, row+2));
            neighbours.push(g.coords2algebraic(col+1, row+2));
        }
        // none of the neighbours may be occupied by a friendly piece
        if (neighbours.reduce((acc, curr) => acc || (this.board.has(curr) && this.board.get(curr) === player), false)) {
            return false;
        }
        return true;
    }

    public getMovesFor(glider: Glider): string[] {
        const moves: string[] = [];
        const g = this.buildMoveGraph(glider);
        const terminals = g.nodes().filter(n => g.outEdges(n).length === 0 && g.getNodeAttribute(n, "validDestination") === true);
        for (const term of terminals) {
            moves.push(term);
        }
        return moves;
    }

    private getNext(glider: Glider, from?: string): [string,string][] {
        const next: [string,string][] = [];
        const g = this.graph;
        if (from === undefined) {
            from = glider.core;
        }
        const [xCore, yCore] = g.algebraic2coords(from);
        for (const arm of [glider.arm1, glider.arm2]) {
            const coord = g.move(xCore, yCore, arm.dir);
            if (coord === undefined) {
                throw new Error(`getNext: coord should never be undefined`);
            }
            // check for falling off the board
            const [x, y] = coord;
            if ( (arm.dir === "N" && y === 0) ||
                 (arm.dir === "E" && x === this.boardSize - 1) ||
                 (arm.dir === "S" && y === this.boardSize - 1) ||
                 (arm.dir === "W" && x === 0)
            ) {
                next.push([from, arm.dir]);
            } else {
                next.push([from, g.coords2algebraic(x, y)]);
            }
        }

        return next;
    }

    private buildMoveGraph(glider: Glider): DirectedGraph {
        const mg = new DirectedGraph();
        mg.addNode(glider.core);

        const toVisit: [string,string][] = this.getNext(glider);
        const visited = new Map<string, Set<string>>();

        while (toVisit.length > 0) {
            const [from, to] = toVisit.pop()!;
            if (!visited.has(from)) {
                visited.set(from, new Set<string>(to));
            } else {
                const curr = visited.get(from)!;
                curr.add(to);
                visited.set(from, curr);
            }
            // if `to` is a single character, it's off the board and always legal and terminal
            if (to.length === 1) {
                if (!mg.hasNode(to)) {
                    mg.addNode(to);
                }
                if (!mg.hasDirectedEdge(from, to)) {
                    mg.addDirectedEdge(from, to);
                }
                mg.setNodeAttribute(to, "validDestination", true);
            }
            // normal board spaces
            else {
                const isTerminal = this.isTerminal(glider, to);
                if (isTerminal) {
                    const canLand = this.canLand(glider, to);
                    // if terminal and can land, then add nodes and edges
                    // but do not add more cells to `toVisit`
                    if (isTerminal && canLand) {
                        if (!mg.hasNode(to)) {
                            mg.addNode(to);
                        }
                        if (!mg.hasDirectedEdge(from, to)) {
                            mg.addDirectedEdge(from, to);
                        }
                        mg.setNodeAttribute(to, "validDestination", true);
                    }
                }
                // if not terminal, then add node and edge but keep going
                else if (!isTerminal) {
                    if (!mg.hasNode(to)) {
                        mg.addNode(to);
                    }
                    mg.setNodeAttribute(to, "validDestination", false);
                    if (!mg.hasDirectedEdge(from, to)) {
                        mg.addDirectedEdge(from, to);
                    }
                    const nexts = this.getNext(glider, to);
                    for (const [f, t] of nexts) {
                        if (!visited.has(f) || !(visited.get(f)!.has(t))) {
                            toVisit.push([f,t]);
                        }
                    }
                }
            }
        }

        return mg;
    }

    private translateGlider(glider: Glider, to: string): Glider {
        const g = this.graph;
        const [x, y] = g.algebraic2coords(to);
        let xDock = x; let yDock = y;
        const arms: {dir: DirectionCardinal, cell: string}[] = [];
        for (const arm of [glider.arm1, glider.arm2]) {
            const [newx, newy] = g.move(x, y, arm.dir)!;
            if (newx < x) { xDock--; }
            if (newx > x) { xDock++; }
            if (newy < y) { yDock--; }
            if (newy > y) { yDock++; }
            const newcell = g.coords2algebraic(newx, newy);
            arms.push({dir: arm.dir, cell: newcell})
        }
        return {
            core: to,
            dock: g.coords2algebraic(xDock, yDock),
            arm1: arms[0],
            arm2: arms[1],
        };
    }

    private moveGlider(glider: Glider, to: string): void {
        const owner = this.board.get(glider.core)!;
        this.board.delete(glider.core);
        this.board.delete(glider.arm1.cell);
        this.board.delete(glider.arm2.cell);
        const newGlider = this.translateGlider(glider, to);
        for (const cell of [newGlider.core, newGlider.arm1.cell, newGlider.arm2.cell]) {
            this.board.set(cell, owner);
        }
    }

    // Only checks for enemy overlap!
    // Checking for friendly propulsion happens in `isTerminal`.
    // You need both to maximize efficency.
    private canLand(glider: Glider, to: string): boolean {
        const owner = this.board.get(glider.core)!;
        const enemyTowers = this.getGroups(owner === 1 ? 2 : 1).filter(grp => grp.length === 1).flat();
        const newGlider = this.translateGlider(glider, to);
        // // if not terminal, then you definitely can't land
        // if (!this.isTerminal(glider, to)) {
        //     return false;
        // }
        // if it *is* terminal, then you can't land if you overlap illegally
        // with enemy pieces (covering towers)
        for (const cell of [newGlider.core, newGlider.arm1.cell, newGlider.arm2.cell]) {
            if (enemyTowers.includes(cell)) {
                return false;
            }
        }
        return true;
    }

    // Only checks for friendly propulsion, meaning returns false if landing here
    // would overlap with friendly pieces or form an illegal shape with friendly pieces.
    // If no propulsion but still can't land, then may not move here.
    private isTerminal(glider: Glider, to: string): boolean {
        const startCells = [glider.core, glider.arm1.cell, glider.arm2.cell];
        const owner = this.board.get(glider.core)!;
        const newGlider = this.translateGlider(glider, to);
        // first check for friendly overlaps
        for (const cell of [newGlider.core, newGlider.arm1.cell, newGlider.arm2.cell]) {
            if (
                // it's impossible to overlap with yourself
                !startCells.includes(cell) &&
                // cell must be occupied to propel
                this.board.has(cell) &&
                // cell must be friendly to propel
                this.board.get(cell) === owner
            ) {
                return false;
            }
        }

        // we know it's not overlapping with frendlies, so
        // now check for illegal shapes with friendly pieces
        const cloned = this.clone();
        cloned.moveGlider(glider, to);
        if (!cloned.validShapes(owner)) {
            return false;
        }
        return true;
    }

    // ensures all pieces of a given colour form valid shapes
    private validShapes(p?: playerid): boolean {
        if (p === undefined) {
            p = this.currplayer;
        }
        const groups = this.getGroups(p).filter(grp => grp.length > 1);
        for (const group of groups) {
            if (group.length !== 3 && group.length !== 4) {
                return false;
            }
            if (group.length === 3 && !this.isGlider(group)) {
                return false;
            } else if (group.length === 4 && !this.isBase(group)) {
                return false;
            }
        }
        return true;
    }

    private isGlider(group: string[]): boolean {
        if (group.length !== 3) { return false; }
        const g = this.graph;
        const xSet = new Set<number>();
        const ySet = new Set<number>();
        for (const [x, y] of group.map(c => g.algebraic2coords(c))) {
            xSet.add(x);
            ySet.add(y);
        }
        if (xSet.size === 1 || ySet.size === 1) {
            return false;
        }
        return true;
    }

    private isBase(group: string[]): boolean {
        if (group.length !== 4) { return false; }
        const g = this.graph;
        const sortBase = (a: string, b: string) => {
            const [x1, y1] = g.algebraic2coords(a);
            const [x2, y2] = g.algebraic2coords(b);
            if (y1 === y2) {
                return x1 - x2;
            } else {
                return y1 - y2;
            }
        }
        group.sort(sortBase);
        const coords = group.map(c => g.algebraic2coords(c));
        if (
            (coords[0][0] - coords[1][0] !== -1)||
            (coords[0][1] !== coords[1][1]) ||
            (coords[0][0] !== coords[2][0]) ||
            (coords[0][1] - coords[2][1] !== -1) ||
            (coords[0][0] - coords[3][0] !== -1) ||
            (coords[0][1] - coords[3][1] !== -1)
        ) {
            return false;
        }
        return true;
    }

    // assumes the board is always in a valid state (no illegal shapes)
    public getGliders(p?: playerid): Glider[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = this.graph;
        const groups = this.getGroups(p).filter(grp => grp.length > 1);
        const gliders: Glider[] = [];

        const sortBase = (a: string, b: string) => {
            const [x1, y1] = g.algebraic2coords(a);
            const [x2, y2] = g.algebraic2coords(b);
            if (y1 === y2) {
                return x1 - x2;
            } else {
                return y1 - y2;
            }
        }
        // bases first
        for (const base of groups.filter(grp => grp.length === 4)) {
            base.sort(sortBase);
            gliders.push({
                core: base[0],
                dock: base[3],
                arm1: {dir: "E", cell: base[1]},
                arm2: {dir: "S", cell: base[2]},
            });
            gliders.push({
                core: base[1],
                dock: base[2],
                arm1: {dir: "W", cell: base[0]},
                arm2: {dir: "S", cell: base[3]},
            });
            gliders.push({
                core: base[2],
                dock: base[1],
                arm1: {dir: "E", cell: base[3]},
                arm2: {dir: "N", cell: base[0]},
            });
            gliders.push({
                core: base[3],
                dock: base[0],
                arm1: {dir: "W", cell: base[2]},
                arm2: {dir: "N", cell: base[1]},
            });
        }

        // standalone gliders
        for (const group of groups.filter(grp => grp.length === 3)) {
            let core: string|undefined;
            for (const cell of group) {
                const [x1, y1] = g.algebraic2coords(cell);
                const rest = group.filter(c => c !== cell).map(c => g.algebraic2coords(c));
                let isOrth = true;
                for (const [x2, y2] of rest) {
                    if (x1 !== x2 && y1 !== y2) {
                        isOrth = false;
                        break;
                    }
                }
                if (isOrth) {
                    core = cell;
                    break;
                }
            }
            if (core === undefined) {
                throw new Error("Core should never be undefined.");
            }
            const [xCore, yCore] = g.algebraic2coords(core);
            let xDock = xCore; let yDock = yCore;
            const arms: {dir: DirectionCardinal, cell: string}[] = [];
            for (const cell of group.filter(c => c !== core)) {
                const [x, y] = g.algebraic2coords(cell);
                if (x < xCore) { xDock--; }
                if (x > xCore) { xDock++; }
                if (y < yCore) { yDock--; }
                if (y > yCore) { yDock++; }
                const dir = RectGrid.bearing(xCore, yCore, x, y)! as DirectionCardinal;
                arms.push({dir, cell});
            }
            const dock = g.coords2algebraic(xDock, yDock);
            gliders.push({core, dock, arm1: arms[0], arm2: arms[1]});
        }

        return gliders;
    }

    private getTowers(p?: playerid): string[][] {
        if (p === undefined) {
            p = this.currplayer;
        }
        return this.getGroups(p).filter(grp => grp.length === 1);
    }

    private countTowers(p?: playerid): number {
        return this.getTowers(p).length;
    }

    private countBases(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        return this.getGroups(p).filter(grp => grp.length === 4).length;
    }

    private getGroups(p?: playerid): string[][] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = this.graph.graph;
        for (const node of [...g.nodes()]) {
            if (this.board.get(node) !== p) {
                g.dropNode(node);
            }
        }
        return connectedComponents(g);
    }

    private randomBasePlace(g: SquareOrthGraph): string|null {
        const empties = shuffle(g.graph.nodes().filter(c => !this.board.has(c))) as string[];
        for (const cell of empties) {
            if (this.isBaseValid(cell)) {
                return cell;
            }
        }
        return null;
    }

    public randomMove(): string {
        const g = this.graph;
        const rand = Math.random();
        // if fewer than 3 bases or one-quarter the time, build a base
        const numBases = this.countBases();
        const gliders = this.getGliders();
        const randBase = this.randomBasePlace(g);
        if (randBase !== null && (numBases < 3 || gliders.length === 0 || rand < 0.25)) {
            const empties = shuffle(g.graph.nodes().filter(c => !this.board.has(c))) as string[];
            for (const cell of empties) {
                if (this.isBaseValid(cell)) {
                    return cell;
                }
            }
        }
        // otherwise, move a glider
        else {
            const shuffled = shuffle(gliders) as Glider[];
            for (const glider of shuffled) {
                const terms = shuffle(this.getMovesFor(glider)) as string[];
                if (terms.length > 0) {
                    return `${glider.core}-${terms[0]}`;
                }
            }
        }
        throw new Error("randomMove: No moves found. This should never happen.");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            let cell: string|undefined;
            if (row !== -1 && col !== -1) {
                cell = this.graph.coords2algebraic(col, row);
            }
            // empty move, base placement or starting a move
            if (move === "") {
                if (cell !== undefined) {
                    newmove = cell;
                }
            }
            // otherwise, finishing a move
            else {
                if (cell === move) {
                    newmove = "";
                } else if (cell !== undefined) {
                    newmove = move + "-" + cell;
                } else {
                    const parts = piece!.split("_");
                    newmove = move + "-" + parts[parts.length - 1];
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.gliss.INITIAL_INSTRUCTIONS");
            return result;
        }

        const idx = m.indexOf("(");
        if (idx >= 0) {
            m = m.substring(0, idx);
        }

        // full moves first
        if (m.includes("-")) {
            let [from, to] = m.split("-");
            if (to.length === 1) { to = to.toUpperCase();}
            const glider = this.getGliders().find(gl => gl.core === from);
            if (glider === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gliss.NO_GLIDER", {where: from});
                return result;
            }
            const terms = this.getMovesFor(glider);
            if (!terms.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gliss.BAD_DEST", {from, to});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // otherwise partials and bases
        else {
            // bases
            if (!this.board.has(m)) {
                if (!this.isBaseValid(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gliss.BAD_BASE");
                    return result;
                }

                // we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // partials
            else {
                const glider = this.getGliders().find(gl => gl.core === m);
                if (glider === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gliss.NO_GLIDER", {where: m});
                    return result;
                }
                const terms = this.getMovesFor(glider);
                if (terms.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gliss.NO_MOVES", {where: m});
                    return result;
                }

                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.gliss.PARTIAL");
                return result;
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): GlissGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        this.results = [];
        this.highlights = [];
        this.selected = undefined;

        const g = this.graph;
        const idx = m.indexOf("(");
        if (idx >= 0) {
            m = m.substring(0, idx);
        }
        const cells = m.split("-");

        // if partial, show the highlights and get out
        if (partial) {
            if (this.board.has(cells[0]) && cells.length === 1) {
                const glider = this.getGliders().find(gl => gl.core === cells[0]);
                if (glider === undefined) {
                    throw new Error(`move: Error fetching the glider at ${cells[0]}`);
                }
                this.selected = cells[0];
                this.highlights = this.getMovesFor(glider).filter(mv => mv.length > 1);
            }
            return this;
        }
        this.selected = undefined;

        // bases
        if (cells.length === 1) {
            const [x, y] = g.algebraic2coords(cells[0]);
            for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) {
                const cell = g.coords2algebraic(x + dx, y + dy);
                this.board.set(cell, this.currplayer);
            }
            this.results.push({type: "place", where: cells[0]});
        }
        // glider movement
        else {
            const glider = this.getGliders().find(gl => gl.core === cells[0]);
            if (glider === undefined) {
                throw new Error(`move: Error fetching the glider at ${cells[0]}`);
            }
            // first check for moving off the board
            if (cells[1].length === 1) {
                [glider.core, glider.arm1.cell, glider.arm2.cell].forEach(cell => this.board.delete(cell));
                this.results.push({type: "remove", where: glider.core, what: [glider.core, glider.arm1.cell, glider.arm2.cell].join(",")});
                m = cells[0] + "-" + cells[1].toUpperCase();
            }
            // otherwise moving to an actual cell
            else {
                const newglider = this.translateGlider(glider, cells[1]);
                // look for captures
                const gliderCaps: Glider[] = [];
                const enemyGliders = this.getGliders(this.currplayer === 1 ? 2 : 1);
                // overlaps first
                // if core overlaps a core, that's the only valid choice
                const coreOverlap = enemyGliders.find(gl => gl.core === newglider.core);
                if (coreOverlap !== undefined && gliderCaps.find(gl => gl.core === coreOverlap.core) === undefined) {
                    gliderCaps.push(coreOverlap);
                }
                // otherwise, look for arms
                else if (coreOverlap === undefined) {
                    for (const cell of [newglider.core, newglider.arm1.cell, newglider.arm2.cell]) {
                        // if cell overlaps a core, choose it
                        const overlapped = enemyGliders.find(gl => gl.core === cell);
                        if (overlapped !== undefined) {
                            if (gliderCaps.find(gl => gl.core === overlapped.core) === undefined) {
                                gliderCaps.push(overlapped);
                            }
                        }
                        // otherwise check for overlapping arms
                        else {
                            const overlaps = enemyGliders.filter(gl => gl.arm1.cell === cell || gl.arm2.cell === cell);
                            for (const og of overlaps) {
                                if (gliderCaps.find(gl => gl.core === og.core) === undefined) {
                                    gliderCaps.push(og);
                                }
                            }
                        }
                    }
                }
                // now look for docking
                const cloned = this.clone();
                cloned.moveGlider(glider, cells[1]);
                const enemyTowers = cloned.getTowers(this.currplayer === 1 ? 2 : 1).flat();
                let conversions: string|undefined;
                if (enemyTowers.includes(newglider.dock)) {
                    conversions = newglider.dock;
                }

                // record the movement first, but don't execute yet
                this.results.push({type: "move", from: cells[0], to: cells[1]});

                // record captures & conversions
                const capped: string[] = [];
                if (gliderCaps.length > 0) {
                    capped.push(...gliderCaps.map(gl => [gl.core, gl.arm1.cell, gl.arm2.cell]).flat());
                    capped.forEach(c => this.board.delete(c));
                    this.results.push({type: "capture", where: capped.join(","), count: capped.length});
                }
                if (conversions !== undefined) {
                    if (!capped.includes(conversions)) {
                        capped.push(conversions);
                        this.board.set(conversions, this.currplayer);
                        this.results.push({type: "convert", what: this.currplayer === 1 ? "2" : "1", into: this.currplayer.toString(), where: conversions});
                    }
                }
                m = m + " (" + capped.join(", ") + ")";

                // finally, execute movement
                this.moveGlider(glider, cells[1]);
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): GlissGame {
        const lastp = this.currplayer === 1 ? 2 : 1;
        const lastb = this.countBases(lastp);
        const thisb = this.countBases(this.currplayer);

        // somebody has no bases
        if (this.stack.length >= 3 && (lastb === 0 || thisb === 0)) {
            this.gameover = true;
            if (lastb === 0 && thisb === 0) {
                this.winner = [this.currplayer];
            } else if (lastb > thisb) {
                this.winner = [lastp];
            } else {
                this.winner = [this.currplayer];
            }
        }

        // tower check
        if (!this.gameover) {
            const towers = this.countTowers();
            if (towers >= 12) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        }

        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IGlissState {
        return {
            game: GlissGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: GlissGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()]),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true) as string[][];
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

        // add board buffer if selected glider can move off the board
        let buffers: DirectionCardinal[]|undefined;
        if (this.selected !== undefined) {
            const glider = this.getGliders().find(gl => gl.core === this.selected);
            if (glider !== undefined) {
                const terms = this.getMovesFor(glider).filter(t => t.length === 1);
                if (terms.length > 0) {
                    buffers = [...terms] as DirectionCardinal[];
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                buffer: buffers === undefined ? undefined : {
                    width: 0.2,
                    pattern: "slant",
                    show: buffers,
                }
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        const g = this.graph;
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    const targets: RowCol[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = g.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", shape: "circle", targets: targets as [RowCol, ...RowCol[]]});
                } else if (move.type === "remove") {
                    const targets: RowCol[] = [];
                    for (const m of move.what!.split(",")) {
                        const [x, y] = g.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", shape: "circle", targets: targets as [RowCol, ...RowCol[]]});
                } else if (move.type === "convert") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", shape: "circle", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    if (move.to.length > 1) {
                        const [fx, fy] = g.algebraic2coords(move.from);
                        const [tx, ty] = g.algebraic2coords(move.to);
                        rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                    }
                }
            }
        }

        // add highlights
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const coords: RowCol[] = [];
            for (const dot of this.highlights) {
                const [x, y] = g.algebraic2coords(dot);
                coords.push({row: y, col: x});
            }
            rep.annotations!.push({type: "enter", colour: this.currplayer, shape: "circle", targets: coords as [RowCol, ...RowCol[]]});
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
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.group", { player, count: r.count, cells: r.where }));
                resolved = true;
                break;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.simple", { player, where: r.where }));
                resolved = true;
                break;
            case "remove":
                node.push(i18next.t("apresults:REMOVE.gliss", { player, where: r.where }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): GlissGame {
        return Object.assign(new GlissGame(), deepclone(this) as GlissGame);
    }
}
