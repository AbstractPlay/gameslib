import type { Pips, playerid } from "../cubeo";
import { CubeoDie } from "./die";
import { matrixRectRot90, SquareGraph, SquareOrthGraph } from "../../common";
import { connectedComponents } from "graphology-components";
import type { EdgeData } from "../../common/graphs/square";

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
        const g = this.graph.graph.copy();
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
    public get graph(): SquareGraph {
        const g = new SquareGraph(this.width + 2, this.height + 2);
        const gOrth = new SquareOrthGraph(this.width + 2, this.height + 2);
        for (const node of g.graph.nodes()) {
            const [relx, rely] = g.algebraic2coords(node);
            const die = this.getDieAt(...this.rel2abs(relx, rely));
            if (die === undefined) {
                // if node is not orthogonally adjacent to a real die, drop it
                let isAdj = false;
                for (const n of gOrth.neighbours(node)) {
                    const [relnx, relny] = g.algebraic2coords(n);
                    if (this.getDieAt(...this.rel2abs(relnx, relny)) !== undefined) {
                        isAdj = true;
                        break;
                    }
                }
                if (!isAdj) {
                    g.graph.dropNode(node);
                }
            } else {
                g.graph.setNodeAttribute(node, "contents", die);
            }
        }

        /**
         * Clean up edges:
         * - Get rid of diagonal edges between two dice (you can't merge diagonally).
         * - Drop diagonal edges that include an empty cell if there are dice on both sides.
         * - Drop diagonal edges that include an empty cell if *both* side cells are empty.
         */
        const todrop: string[] = [];
        for (const edge of g.graph.edgeEntries()) {
            const {edge: eid, attributes, source, target, sourceAttributes, targetAttributes} = edge;
            // ignore orthogonal edges
            if ((attributes as EdgeData).type === "orth") {
                continue;
            }
            // drop diagonal edges when both ends are occupied
            if ("contents" in sourceAttributes && "contents" in targetAttributes) {
                todrop.push(eid);
                continue;
            }

            // at this point, we should only be seeing edges where at least one end is empty
            const [sx, sy] = g.algebraic2coords(source);
            const [tx, ty] = g.algebraic2coords(target);
            // calculate left and right nodes (remember we're in quadrant-IV space)
            let left: string;
            let right: string;
            // rightward slant
            if (tx > sx) {
                // upward
                if (ty < sy) {
                    // straight up
                    left = g.coords2algebraic(sx, sy-1);
                    // straight right
                    right = g.coords2algebraic(sx+1, sy);
                }
                // downward
                else {
                    // straight down
                    left = g.coords2algebraic(sx, sy+1);
                    // straight right
                    right = g.coords2algebraic(sx+1, sy);

                }
            }
            // leftward slant
            else {
                // upward
                if (ty < sy) {
                    // straight up
                    left = g.coords2algebraic(sx, sy-1);
                    // straight left
                    right = g.coords2algebraic(sx-1, sy);
                }
                // downward
                else {
                    // straight down
                    left = g.coords2algebraic(sx, sy+1);
                    // straight left
                    right = g.coords2algebraic(sx-1, sy);

                }
            }
            // if both are occupied, drop the edge
            // if both are empty, drop the edge
            // if one of the nodes doesn't exist, then we're at the edge of the board and
            // can keep the edge
            if (g.graph.hasNode(left) && g.graph.hasNodeAttribute(left, "contents") &&
                g.graph.hasNode(right) && g.graph.hasNodeAttribute(right, "contents")) {
                todrop.push(eid);
            } else if (
                g.graph.hasNode(left) && !g.graph.hasNodeAttribute(left, "contents") &&
                g.graph.hasNode(right) && !g.graph.hasNodeAttribute(right, "contents")) {
                todrop.push(eid);
            }
        }
        // execute the drop
        todrop.forEach(eid => g.graph.dropEdge(eid));

        return g;
    }

    // given a die, return a graph representing valid places it can go
    // don't do die checking; sometimes you need it for an empty space
    public moveGraphFor(x: number, y: number): SquareGraph {
        const die = this.getDieAt(x, y);
        let startCell: string|undefined;
        // start with the basic graph
        const g = this.graph;
        const gOrth = this.graphOrth;
        // If we started from a die, remove any spaces that are orthogonally adjacent *only*
        // to the moving die
        if (die !== undefined) {
            startCell = g.coords2algebraic(...this.abs2rel(x, y)!);
            const empties = g.graph.nodes().filter(node => !g.graph.hasNodeAttribute(node, "contents"))
            for (const node of empties) {
                const ndice: CubeoDie[] = [];
                for (const n of gOrth.neighbours(node)) {
                    if (g.graph.hasNode(n) && g.graph.hasNodeAttribute(n, "contents")) {
                        ndice.push(CubeoDie.deserialize(g.graph.getNodeAttribute(n, "contents") as CubeoDie));
                    }
                }
                if (ndice.length === 1 && ndice[0].uid === die.uid) {
                    g.graph.dropNode(node);
                }
            }
        }
        // To deal with "jumping the gap" scenarios, we have to delete edges where the destination
        // node is neither adjacent to one of the same dice it was before nor adjacent to one of
        // the source node's orthogonal neighbours.
        for (const edge of g.graph.edges()) {
            const [left, right] = g.graph.extremities(edge);
            // ignore edges that include dice that are not the moving die
            if ( (g.graph.hasNodeAttribute(left, "contents") && left !== startCell) || (g.graph.hasNodeAttribute(right, "contents") && right !== startCell) ) {
                continue;
            }
            const nLeft = new Set<string>(gOrth.graph.neighbors(left).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")));
            const nRight = new Set<string>(gOrth.graph.neighbors(right).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")));
            let shared = new Set<string>([...nLeft].filter(n => nRight.has(n)));
            // if both nodes are adjacent to a shared die, then this is a valid edge
            if (shared.size > 0) {
                continue;
            }
            // generate a list of dice orthogonally adjacent to each of the original neighbours
            const nnLeft = new Set<string>();
            nLeft.forEach(n => gOrth.graph.neighbors(n).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")).forEach(nn => nnLeft.add(nn)));
            const nnRight = new Set<string>();
            nRight.forEach(n => gOrth.graph.neighbors(n).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")).forEach(nn => nnRight.add(nn)));
            shared = new Set<string>([...nnLeft, ...nLeft].filter(n => nnRight.has(n) || nRight.has(n)));
            // if the two nodes share a neighbour, it's a valid edge
            if (shared.size > 0) {
                continue;
            }
            // otherwise, drop this edge
            // console.log(`Dropping the edge between ${left} and ${right} when developing the move graph for ${x},${y}`);
            // console.log(`nLeft: ${JSON.stringify([...nLeft])}`);
            // console.log(`nnLeft: ${JSON.stringify([...nnLeft])}`);
            // console.log(`nRight: ${JSON.stringify([...nRight])}`);
            // console.log(`nnRight: ${JSON.stringify([...nnRight])}`);
            g.graph.dropEdge(edge);
        }

        // now drop all nodes occupied by dice except the moving die (if we started with a die)
        for (const node of g.graph.nodes()) {
            if (g.graph.hasNodeAttribute(node, "contents")) {
                const other = CubeoDie.deserialize(g.graph.getNodeAttribute(node, "contents") as CubeoDie);
                if (die === undefined || other.uid !== die.uid) {
                    g.graph.dropNode(node);
                }
            }
        }
        // now drop all nodes that don't have a path to the target node
        const target = g.coords2algebraic(...this.abs2rel(x, y)!);
        for (const node of g.graph.nodes()) {
            if (g.path(node, target) === null) {
                g.graph.dropNode(node);
            }
        }
        return g;
    }

    public get graphOrth(): SquareGraph {
        const g = this.graph;
        // drop all diagonal edges
        for (const edge of g.graph.edges()) {
            if (g.graph.getEdgeAttribute(edge, "type") === "diag") {
                g.graph.dropEdge(edge);
            }
        }
        return g;
    }

    // null means there is no die at the given coordinates
    public isPinned(x: number, y: number): boolean|null {
        const found = this.getDieAt(x, y);
        if (found === undefined) {
            return null;
        } else {
            const cloned = this.clone();
            try {
                cloned.removeDieAt(x, y);
            } catch {
                return true;
            }
            return false;
        }
    }

    // A die can slide in or out of a spot if its associated move graph
    // can reach the outside. Since the board is always surrounded by
    // a layer of empty cells, it's enough to ensure the move graph
    // includes a `0` in it (top row or left column).
    public canSlide(x: number, y: number): boolean {
        const g = this.moveGraphFor(x, y);
        const coords = g.graph.nodes().map(n => g.algebraic2coords(n)).flat();
        return coords.includes(0);
    }

    public get arrayRep(): string[][] {
        const g = this.graph;
        const rep: string[][] = [];
        for (const row of g.listCells(true) as string[][]) {
            const lst: string[] = [];
            for (const node of row) {
                const [relx, rely] = g.algebraic2coords(node);
                const die = this.getDieAt(...this.rel2abs(relx, rely));
                if (die === undefined) {
                    lst.push("-");
                } else {
                    lst.push([die.owner, die.pips].join(""))
                }
            }
            rep.push(lst);
        }
        return rep;
    }

    public isEquivalent(other: CubeoBoard): boolean {
        // get the current board rep
        const lstThis = this.arrayRep;
        // get the other board rep and all rotations
        const lstOther = other.arrayRep;
        const lstsOther: string[][][] = [];
        lstsOther.push(lstOther);
        let rotated = [...lstOther.map(r => [...r])];
        let flipx = [...lstOther.map(r => [...r])].reverse();
        let flipy = [...lstOther.map(r => [...r])].map(r => [...r].reverse());
        lstsOther.push(rotated, flipx, flipy);
        for (let i = 0; i < 3; i++) {
            rotated = matrixRectRot90(rotated) as string[][];
            flipx = [...rotated.map(r => [...r])].reverse();
            flipy = [...rotated.map(r => [...r])].map(r => [...r].reverse());
            lstsOther.push(rotated, flipx, flipy);
        }
        // if any permutation matches current board rep, return true
        return lstsOther.map(lst => lst.map(r => r.join("|")).join("\n")).includes(lstThis.map(r => r.join("|")).join("\n"));
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
