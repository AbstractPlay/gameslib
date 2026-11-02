import type { Pips, playerid } from "../cubeo.js";
import { CubeoDie } from "./die.js";
import { matrixRectRot90, SquareGraph } from "../../common/index.js";
import { connectedComponents } from "graphology-components";
import {
    buildCubeoFormationGraph,
} from "./formation-graph.js";
import { CubeoSlideTopology } from "./slide-topology.js";

export class CubeoBoard {
    private _dice: CubeoDie[];

    constructor() {
        this._dice = [];
    }

    public add(die: CubeoDie, connCheck = true): void {
        // no overlaps allowed
        const found = this.getDieAt(die.x, die.y);
        if (found !== undefined) {
            throw new Error(`The coordinates ${die.x},${die.y} are already occupied by a die.`);
        }
        this._dice.push(die);
        if (connCheck) {
            // must always be connected
            if (!this.isConnected) {
                throw new Error(`Adding a die at ${die.x},${die.y} disconnects the board.`);
            }
        }
    }

    public replaceDieAt(x: number, y: number, newval: Pips): void {
        const idx = this._dice.findIndex(d => d.x === x && d.y === y);
        if (idx === -1) {
            throw new Error(`Could not find a die at ${x},${y}.`);
        }
        const oldDie = this._dice[idx];
        this._dice.splice(idx, 1, new CubeoDie({x, y, pips: newval, owner: oldDie.owner}));
    }

    public removeDie(die: CubeoDie): void {
        const idx = this._dice.findIndex(d => d.x === die.x && d.y === die.y && d.owner === die.owner && d.pips === die.pips);
        if (idx === -1) {
            throw new Error(`Could not find the requested die:\n${JSON.stringify(die)}`);
        }
        this._dice.splice(idx, 1);
        // must always be connected
        if (!this.isConnected) {
            throw new Error(`Removing the die at ${die.x},${die.y} disconnects the board.`);
        }
    }

    public removeDieAt(x: number, y: number): void {
        const idx = this._dice.findIndex(d => d.x === x && d.y === y);
        if (idx === -1) {
            throw new Error(`Could not find a die at ${x},${y}.`);
        }
        this._dice.splice(idx, 1);
        // must always be connected
        if (!this.isConnected) {
            throw new Error(`Removing the die at ${x},${y} disconnects the board.`);
        }
    }

    public get isConnected(): boolean {
        const g = this.graph().graph.copy();
        // drop all diagonal edges
        for (const edge of g.edges()) {
            if (g.hasEdgeAttribute(edge, "type") && g.getEdgeAttribute(edge, "type") === "diag") {
                g.dropEdge(edge);
            }
        }
        // drop all empty nodes
        for (const node of g.nodes()) {
            if (!g.hasNodeAttribute(node, "contents")) {
                g.dropNode(node);
            }
        }
        const conn = connectedComponents(g);
        return (conn.length === 1);
    }

    public getDieAt(x: number, y: number): CubeoDie|undefined {
        return this._dice.find(d => d.x === x && d.y === y);
    }

    public getDiceOf(p: playerid): CubeoDie[] {
        return this._dice.filter(d => d.owner === p);
    }

    public get dice(): CubeoDie[] {
        return this._dice.map(d => d.clone())
    }

    public get minX(): number {
        return Math.min(...this._dice.map(d => d.x));
    }

    public get minY(): number {
        return Math.min(...this._dice.map(d => d.y));
    }

    public get maxX(): number {
        return Math.max(...this._dice.map(d => d.x));
    }

    public get maxY(): number {
        return Math.max(...this._dice.map(d => d.y));
    }

    public get width(): number {
        return this.maxX - this.minX + 1;
    }

    public get height(): number {
        return this.maxY - this.minY + 1;
    }

    public get dimensions(): {height: number, width: number, minX: number, maxX: number, minY: number, maxY: number} {
        return {
            height: this.height,
            width: this.width,
            maxX: this.maxX,
            maxY: this.maxY,
            minX: this.minX,
            minY: this.minY,
        };
    }

    // returns a graph representing the dice and orthogonally adjacent empty spaces
    // removes diagonal edges you can't actually slide a die through
    // and removes diagonal edges describing "moves through space" and not along the formation
    public graph(ignore?: string): SquareGraph {
        return buildCubeoFormationGraph(this, ignore);
    }

    // null means there is no die at the given coordinates
    public isPinned(x: number, y: number): boolean|null {
        const found = this.getDieAt(x, y);
        if (found === undefined) {
            return null;
        }
        if (this._dice.length <= 1) {
            return false;
        }

        const occupied = new Set(this._dice.map(d => `${d.x},${d.y}`));
        occupied.delete(`${x},${y}`);

        const others = this._dice.filter(d => d.x !== x || d.y !== y);
        const start = others[0]!;
        const seen = new Set<string>([`${start.x},${start.y}`]);
        const stack = [`${start.x},${start.y}`];

        while (stack.length > 0) {
            const k = stack.pop()!;
            const [cx, cy] = k.split(",").map(n => parseInt(n, 10));
            for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
                const nk = `${nx},${ny}`;
                if (occupied.has(nk) && !seen.has(nk)) {
                    seen.add(nk);
                    stack.push(nk);
                }
            }
        }
        return seen.size !== others.length;
    }

    // A die can slide in or out of a spot if its associated move graph
    // can reach the outside. Since the board is always surrounded by
    // a layer of empty cells, it's enough to ensure the move graph
    // includes a `0` in it (top row or left column).
    public canSlide(x: number, y: number): boolean {
        return CubeoSlideTopology.fromBoard(this).canSlideAt(x, y);
    }

    public get arrayRep(): string[][] {
        const g = this.graph();
        const rep: string[][] = [];
        for (const row of g.listCells(true) as string[][]) {
            const lst: string[] = [];
            for (const node of row) {
                const [relx, rely] = g.algebraic2coords(node);
                const die = this.getDieAt(...this.rel2abs(relx, rely));
                if (die === undefined) {
                    lst.push("-");
                } else {
                    lst.push([die.owner, die.pips.toString(16)].join(""))
                }
            }
            rep.push(lst);
        }
        return rep;
    }

    /** Minimum string among the eight dihedral images of a formation matrix (strict-move symmetry). */
    public static matrixCanonicalKey(matrix: string[][]): string {
        const variants: string[][][] = [];
        let rotated = matrix.map(r => [...r]);
        let flipx = [...rotated.map(r => [...r])].reverse();
        let flipy = [...rotated.map(r => [...r])].map(r => [...r].reverse());
        variants.push(rotated, flipx, flipy);
        for (let i = 0; i < 3; i++) {
            rotated = matrixRectRot90(rotated) as string[][];
            flipx = [...rotated.map(r => [...r])].reverse();
            flipy = [...rotated.map(r => [...r])].map(r => [...r].reverse());
            variants.push(rotated, flipx, flipy);
        }
        const keys = variants.map(lst => lst.map(r => r.join("|")).join("\n"));
        keys.sort((a, b) => a.localeCompare(b));
        return keys[0]!;
    }

    public formationCanonicalKey(): string {
        return CubeoBoard.matrixCanonicalKey(this.arrayRep);
    }

    /** Shape key after moving one die (connectivity not re-checked; caller only uses legal slide targets). */
    public formationCanonicalKeyAfterMove(die: CubeoDie, newx: number, newy: number): string {
        const temp = new CubeoBoard();
        for (const d of this._dice) {
            if (d.x === die.x && d.y === die.y && d.owner === die.owner && d.pips === die.pips) {
                continue;
            }
            temp.add(d.clone(), false);
        }
        temp.add(new CubeoDie({x: newx, y: newy, owner: die.owner, pips: die.pips}), false);
        return temp.formationCanonicalKey();
    }

    public isEquivalent(other: CubeoBoard): boolean {
        return this.formationCanonicalKey() === other.formationCanonicalKey();
    }

    // Takes an absolute coordinate and translates it to the relative version
    // of the expanded board, for annotations and markers.
    // Returns undefined if the absolute coordinates don't map to a realistic
    // relative coordinate (fits in known boundaries of quadrant-IV space).
    public abs2rel(absx: number, absy: number): [number,number]|undefined {
        let relx: number;
        let rely: number;

        if (absx < this.minX) {
            relx = 1 - Math.abs(this.minX - absx);
        } else if (absx > this.maxX) {
            relx = this.width + Math.abs(this.maxX - absx)
        } else {
            relx = 1 + Math.abs(this.minX - absx);
        }
        if (absy < this.minY) {
            rely = this.height + Math.abs(this.minY - absy)
        } else if (absy > this.maxY) {
            rely = 1 - Math.abs(this.maxY - absy);
        } else {
            rely = 1 + Math.abs(this.maxY - absy);
        }

        if (relx < 0 || relx >= this.width + 2 || rely < 0 || rely >= this.height + 2) {
            return undefined;
        }
        return [relx, rely];
    }

    // Takes a relative coordinate from the expanded board and returns the absolute equivalent
    public rel2abs(relx: number, rely: number): [number,number] {
        const absx = this.minX + (relx-1);
        const absy = this.maxY - (rely-1);
        return [absx, absy];
    }

    public clone(): CubeoBoard {
        const cloned = new CubeoBoard();
        this._dice.forEach(d => cloned.add(d, false));
        return cloned;
    }

    public static deserialize(board: CubeoBoard): CubeoBoard {
        const cloned = new CubeoBoard();
        board._dice.forEach(d => cloned.add(CubeoDie.deserialize(d), false));
        return cloned;
    }

}

/** Dedupes formation graph / slide topology / pin queries within one `moves()` pass. */
export class CubeoBoardMoveCache {
    private readonly topology: CubeoSlideTopology;
    private readonly pinnedByCell = new Map<string, boolean>();
    private readonly slideByCell = new Map<string, boolean>();

    public constructor(private readonly board: CubeoBoard) {
        this.topology = CubeoSlideTopology.fromBoard(board);
    }

    public graph(): SquareGraph {
        return this.topology.formationGraph();
    }

    public isPinned(x: number, y: number): boolean {
        const key = `${x},${y}`;
        let pinned = this.pinnedByCell.get(key);
        if (pinned === undefined) {
            pinned = this.board.isPinned(x, y) ?? true;
            this.pinnedByCell.set(key, pinned);
        }
        return pinned;
    }

    public canSlide(x: number, y: number): boolean {
        const key = `${x},${y}`;
        let slide = this.slideByCell.get(key);
        if (slide === undefined) {
            slide = this.topology.canSlideAt(x, y);
            this.slideByCell.set(key, slide);
        }
        return slide;
    }

    /** Move endpoints as absolute `"x,y"` keys (includes start). */
    public moveEndAbsKeys(die: CubeoDie): Set<string> {
        return this.topology.moveEndAbsKeys(die);
    }
}
