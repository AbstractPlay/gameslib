import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

export type SnubStart = "S"|"T";
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
const number2label = (n: number): string => {
    let length = 1;
    if (n >= columnLabels.length) {
        length = Math.floor(Math.log(n) / Math.log(columnLabels.length)) + 1;
    }
    let label = "";
    let counter = n;
    for (let i = length; i > 0; i--) {
        const base = columnLabels.length ** (i - 1);
        let idx = Math.floor(counter / base);
        if (i > 1) {
            idx--;
        }
        const char = columnLabels[idx];
        if (char === undefined) {
            throw new Error(`Could not find a character at index ${idx}\nn: ${n}, length: ${length}, base: ${base}`);
        }
        label += char;
        counter = counter % base;
    }
    return label;
}
const cell2xy = (cell: string): [number,number] => {
    const match = cell.match(/^([a-z]+)(\d+)$/);
    if (match === null) {
        throw new Error(`The algebraic notation is invalid: ${cell}`);
    }
    const lets = match[1]; const nums = match[2];
    const reversed = [...lets.split("").reverse()];
    let x = 0
    for (let exp = 0; exp < reversed.length; exp++) {
        const idx = columnLabels.indexOf(reversed[exp]);
        if (idx < 0) {
            throw new Error(`The column label is invalid: ${reversed[exp]}`);
        }
        if (exp > 0) {
            x += (idx + 1) * (columnLabels.length ** exp);
        } else {
            x += (idx) * (columnLabels.length ** exp);
        }
    }
    const y = parseInt(nums, 10);
    if ( (y === undefined) || (isNaN(y)) || nums === "" ) {
        throw new Error(`The row label is invalid: ${nums}`);
    }
    return [x, y];
}

export class OnyxGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public readonly start: SnubStart;
    public graph: UndirectedGraph

    constructor(width: number, height: number, start: SnubStart = "T") {
        this.width = width;
        this.height = height;
        this.start = start;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number, validate = true): string {
        // even rows are normal snubsquare rows
        let algebraic: string;
        if (y % 2 === 0) {
            algebraic = number2label(x) + (this.height - (y/2)).toString();
        }
        // but odd ones are midpoint rows
        else {
            const prevY = (y-1) / 2;
            const nextY = (y+1) / 2;
            let prevX: number;
            let nextX: number;
            if ( (this.start === "T" && prevY % 2 === 0) || (this.start === "S" && prevY % 2 !== 0) ) {
                prevX = (x * 2) + 1;
                nextX = prevX + 1;
            } else {
                prevX = x * 2;
                nextX = prevX + 1;
            }
            algebraic = `${number2label(prevX)}${this.height - nextY}/${number2label(nextX)}${this.height - prevY}`;
        }
        if (validate && !this.graph.hasNode(algebraic)) {
            throw new Error(`${x},${y} translates to ${algebraic}, which does not exist in the current graph.`)
        }
        return algebraic;
    }

    public algebraic2coords(cell: string): [number, number] {
        if (/^([a-z]+)(\d+)\/([a-z]+)(\d+)$/.test(cell)) {
            const [bl, tr] = cell.split("/");
            const [xbl,] = cell2xy(bl);
            const [, ytr] = cell2xy(tr);
            return [Math.floor(xbl / 2), (this.height * 2) - (ytr*2) + 1];
        } else {
            const [x,y] = cell2xy(cell);
            return [x, (this.height * 2) - (y*2)];
        }
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        const graph = new UndirectedGraph();
        // Nodes
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                graph.addNode(this.coords2algebraic(col, row*2, false));
            }
        }
        // Edges
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const curr = this.coords2algebraic(col, row*2, false);
                // always connect to previous cell
                if (col > 0) {
                    graph.addEdge(curr, this.coords2algebraic(col - 1, row*2, false));
                }

                if (row > 0) {
                    // always connect to cell directly above
                    graph.addEdge(curr, this.coords2algebraic(col, row*2 - 2, false));
                    if (this.start === "S") {
                        // even row, odd columns connect as well to previous-above cell
                        if ( ( (row % 2) === 0) && ( (col % 2) !== 0) ) {
                            graph.addEdge(curr, this.coords2algebraic(col - 1, row*2 - 2, false));
                        // odd row, odd columns connect to previous-next cell
                        } else if ( ((row % 2) !== 0) && ((col % 2) !== 0) && (col < (this.width - 1)) ) {
                            graph.addEdge(curr, this.coords2algebraic(col + 1, row*2 - 2, false));
                        }
                    } else {
                        // even row, even columns > 0 connect as well to previous-above cell
                        if ( ( (row % 2) === 0) && ( (col % 2) === 0) && col > 0) {
                            graph.addEdge(curr, this.coords2algebraic(col - 1, row*2 - 2, false));
                        // odd row, even columns connect to previous-next cell
                        } else if ( ((row % 2) !== 0) && ((col % 2) === 0) && (col < (this.width - 1)) ) {
                            graph.addEdge(curr, this.coords2algebraic(col + 1, row*2 - 2, false));
                        }
                    }
                }
            }
        }

        // add midpoints
        for (let row = 0; row < this.height - 1; row++) {
            const realRow = row * 2;
            for (let col = 0; col < this.width; col+=2) {
                let tl: string; let tr: string; let bl: string; let br: string;
                if ( (this.start === "T" && row % 2 === 0) || (this.start === "S" && row % 2 !== 0) ) {
                    if (col > this.width - 3) { break; }
                    tl = this.coords2algebraic(col+1, realRow, false);
                    tr = this.coords2algebraic(col+2, realRow, false);
                    bl = this.coords2algebraic(col+1, realRow+2, false);
                    br = this.coords2algebraic(col+2, realRow+2, false);
                } else {
                    if (col > this.width - 2) { break; }
                    tl = this.coords2algebraic(col, realRow, false);
                    tr = this.coords2algebraic(col+1, realRow, false);
                    bl = this.coords2algebraic(col, realRow+2, false);
                    br = this.coords2algebraic(col+1, realRow+2, false);
                }
                const midpt = `${bl}/${tr}`;
                graph.addNode(midpt);
                for (const corner of [tl, tr, bl, br]) {
                    graph.addEdge(midpt, corner);
                }
            }
        }
        return graph;
    }

    public listCells(ordered = false): string[] | string[][] {
        if (! ordered) {
            return this.graph.nodes();
        } else {
            const result: string[][] = [];
            for (let row = 0; row < (this.height * 2) - 1; row++) {
                const node: string[] = [];
                let realWidth = this.width;
                if (row % 2 !== 0) {
                    if ((row + 1) % 4 === 0) {
                        realWidth = Math.floor(this.width / 2);
                    } else {
                        realWidth = Math.floor(this.width / 2) - 1;
                    }
                }
                for (let col = 0; col < realWidth; col++) {
                    let cell: string;
                    try {
                        cell = this.coords2algebraic(col, row);
                    } catch {
                        break;
                    }
                    node.push(cell);
                }
                result.push(node);
            }
            return result;
        }
    }

    public neighbours(node: string): string[] {
        return this.graph.neighbors(node);
    }

    public path(from: string, to: string): string[] | null {
        return bidirectional(this.graph, from, to);
    }
}
