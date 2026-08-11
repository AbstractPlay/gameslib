import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import {
    buildFracturedFlatAdjacency,
    fracturedFlatCellLabel,
    parseLabel,
    prepareFracturedFlatPolys,
    vertsToTierLetter,
} from "../fracturedFlat";
import { IGraph } from "./IGraph";

export type FracturedFlatNodeData = {
    verts: number;
    tier: number;
    index: number;
};

export class FracturedFlatGraph implements IGraph {
    public readonly polys = prepareFracturedFlatPolys();
    public readonly labels: string[][];
    public graph: UndirectedGraph;

    constructor() {
        this.labels = this.polys.map((row, tier) =>
            row.map((_poly, index) => fracturedFlatCellLabel(tier, index)),
        );
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        const row = this.labels[y];
        if (row === undefined) {
            throw new Error(`Tier row ${y} does not exist.`);
        }
        const label = row[x];
        if (label === undefined) {
            throw new Error(`Column ${x} does not exist in tier row ${y}.`);
        }
        return label;
    }

    public algebraic2coords(cell: string): [number, number] {
        const { verts, indexInTier } = parseLabel(cell);
        const tier = verts - 3;
        const row = this.labels[tier];
        if (row === undefined || row[indexInTier] !== cell) {
            throw new Error(`The algebraic notation is invalid: ${cell}`);
        }
        return [indexInTier, tier];
    }

    private buildGraph(): UndirectedGraph {
        const adjacency = buildFracturedFlatAdjacency(this.polys);
        const graph = new UndirectedGraph();

        for (let tier = 0; tier < this.polys.length; tier++) {
            const row = this.polys[tier];
            for (let index = 0; index < row.length; index++) {
                const verts = row[index].points.length;
                const label = fracturedFlatCellLabel(tier, index);
                graph.addNode(label, {
                    verts,
                    tier,
                    index,
                } as FracturedFlatNodeData);
            }
        }

        for (const [label, neighbours] of adjacency) {
            for (const nbor of neighbours) {
                if (!graph.hasEdge(label, nbor)) {
                    graph.addEdge(label, nbor);
                }
            }
        }

        return graph;
    }

    public listCells(ordered = false): string[] | string[][] {
        if (!ordered) {
            return this.graph.nodes();
        }
        return this.labels.map((row) => [...row]);
    }

    public neighbours(node: string): string[] {
        return this.graph.neighbors(node);
    }

    public path(from: string, to: string): string[] | null {
        return bidirectional(this.graph, from, to);
    }

    /** Vertex-count tier letter for a grid row (row 0 → A, row 1 → B, …). */
    public tierLetterForRow(row: number): string {
        return vertsToTierLetter(row + 3);
    }
}
