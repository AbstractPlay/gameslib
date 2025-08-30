import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

// Similar to PentaHexGraph but the center node only has 5 edges
export class PentaHexGraph implements IGraph {
    public readonly size: number;
    public graph: UndirectedGraph;

    constructor(size: number) {
        if (size < 2) throw new Error(`PentaHexGraph cannot be less than size 2`);
        this.size = size;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        if (y < 0 || y > this.size) throw new Error(`The x coord must be a circle inside the graph`);
        if (y == 0) return "0-0";
        let trueX = x;
        do {
            trueX += 5*y;
        } while (trueX < 0);
        return y + "-" + (trueX%(5*y));
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("-");
        const y = Number(pair[0]);
        const x = Number(pair[1]);
        if (y === undefined || isNaN(y) || x === undefined || isNaN(x)) {
            throw new Error(`The algebraic coords cannot be parsed`);
        }
        return [x,y];
    }

    private buildGraph(): UndirectedGraph {
        const graph = new UndirectedGraph();
        for (let y = 0; y < this.size; y++) {
            if (y == 0) {
                graph.addNode(this.coords2algebraic(0,0));
            }
            for (let x = 0; x < 5*y; x++) {
                graph.addNode(this.coords2algebraic(x,y));
            }
        }

        for (let y = 0; y < this.size; y++) {
            if (y == 0) {
                const cell = this.coords2algebraic(0,0);
                graph.addEdge(cell, this.coords2algebraic(0,1));
                graph.addEdge(cell, this.coords2algebraic(1,1));
                graph.addEdge(cell, this.coords2algebraic(2,1));
                graph.addEdge(cell, this.coords2algebraic(3,1));
                graph.addEdge(cell, this.coords2algebraic(4,1));
            }
            let counter = -1;
            for (let x = 0; x < 5*y; x++) {
                const cell = this.coords2algebraic(x,y);
                graph.addEdge(cell, this.coords2algebraic(x+1, y));
                if (y+1 >= this.size) continue;
                if (x % y == 0) {
                    //Three edges
                    graph.addEdge(cell, this.coords2algebraic(x+counter++, y+1));
                    graph.addEdge(cell, this.coords2algebraic(x+counter++, y+1));
                    graph.addEdge(cell, this.coords2algebraic(x+counter--, y+1));
                } else {
                    //Two edges
                    graph.addEdge(cell, this.coords2algebraic(x+counter++, y+1));
                    graph.addEdge(cell, this.coords2algebraic(x+counter--, y+1));
                }
            }
        }
        return graph;
    }

    public listCells(ordered = false): string[] | string[][] {
        if (!ordered) {
            return this.graph.nodes();
        } else {
            const result: string[][] = [];
            for (let y = 0; y < this.size; y++) {
                const node: string[] = [];
                if (y == 0) {
                    node.push(this.coords2algebraic(0,0));
                }
                for (let x = 0; x < 5*y; x++) {
                    node.push(this.coords2algebraic(x,y));
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
