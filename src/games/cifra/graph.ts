import { Direction, SquareDirectedGraph } from "../../common";
import { type Shade } from "../cifra";
import { type EdgeData } from "../../common/graphs/square-directed";

export type WeightedEdgeData = EdgeData & {cost: number};
export type NodeData = {shade?: Shade};

export class CifraGraph extends SquareDirectedGraph {
    constructor(order: Shade[], perspective: Shade) {
        const size = order.length === 76 ? 9 : 5;
        super(size, size);

        // assign ownership
        const neutrals = size === 5 ? ["c3"] : ["e9", "a5", "e5", "i5", "e1"];
        const copy = [...order];
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const cell = this.coords2algebraic(col, row);
                if (!neutrals.includes(cell)) {
                    const shade = copy.shift();
                    if (shade === undefined) {
                        throw new Error("Not enough cells were passed to the constructor.");
                    }
                    this.graph.setNodeAttribute(cell, "shade", shade);
                }
            }
        }
        if (copy.length > 0) {
            throw new Error("Too many cells were passed to the constructor.");
        }
        // assign weights
        for (const {edge, sourceAttributes, targetAttributes} of [...this.graph.edgeEntries()]) {
            const o1 = (sourceAttributes as NodeData).shade;
            const o2 = (targetAttributes as NodeData).shade;
            // I DO NOT UNDERSTAND!
            // o1 will never *strictly* equal perspective
             
            if (o1 == perspective && o1 === o2) {
                this.graph.setEdgeAttribute(edge, "cost", 0);
            } else {
                this.graph.setEdgeAttribute(edge, "cost", 1);
            }
        }
    }

    public weightedRay(start: string, dir: Direction): string[] {
        const cells = this.ray(start, dir, true)
        // calculate costs
        const costs: number[] = [];
        for (let i = 1; i < cells.length; i++) {
            const edge = this.graph.edge(cells[i-1], cells[i])!;
            const cost = this.graph.getEdgeAttribute(edge, "cost") as number;
            costs.push(cost);
        }
        const valid: string[] = [];
        for (let i = 1; i <= costs.length; i++) {
            const sum = costs.slice(0, i).reduce((acc, curr) => acc + curr, 0);
            if (sum <= 1) {
                valid.push(cells[i]);
            }
        }
        return valid;
    }
}
