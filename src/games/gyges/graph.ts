import type { EdgeData } from "../../common/graphs/square-directed";
import { Direction, SquareDirectedGraph } from "../../common";
import type { playerid } from "../gyges";

type GygesDirection = Direction|"any";
type GygesEdgeData = EdgeData & {direction: GygesDirection; uid: string};

export class GygesGraph extends SquareDirectedGraph {
    constructor(p?: playerid) {
        super(6, 8);

        // remove all diagonal connections
        for (const {edge, attributes} of [...this.graph.edgeEntries()]) {
            if ((attributes as EdgeData).type === "diag") {
                this.graph.dropEdge(edge);
            }
        }

        // drop top/bottom cells
        for (let col = 0; col < 6; col++) {
            const cell1 = this.coords2algebraic(col, 0);
            const cell2 = this.coords2algebraic(col, 7);
            this.graph.dropNode(cell1);
            this.graph.dropNode(cell2);
        }

        // add goal cells with connections
        if (p === undefined || p !== 2) {
            this.graph.addNode("d8");
            for (let col = 0; col < 6; col++) {
                const node = this.coords2algebraic(col, 1);
                this.graph.addDirectedEdge(node, "d8", {direction: "any"} as GygesEdgeData);
            }
        }
        if (p === undefined || p !== 1) {
            this.graph.addNode("c1");
            for (let col = 0; col < 6; col++) {
                const node = this.coords2algebraic(col, 6);
                this.graph.addDirectedEdge(node, "c1", {direction: "any"} as GygesEdgeData);
            }
        }

        // give each edge a uniform ID for detecting reuse of an edge
        for (const edge of this.graph.edges()) {
            const [c1, c2] = this.graph.extremities(edge);
            const uid = [c1, c2].sort((a,b) => a.localeCompare(b)).join("|");
            this.graph.setEdgeAttribute(edge, "uid", uid);
        }
    }

    // override move function to account for "any" direction
    public move(from: string, dir: Direction, dist = 1): string|undefined {
        let interim = from;
        for (let i = 0; i < dist; i++) {
            // find the edge going in the right direction (or "any" direction)
            const edge = this.graph.outEdges(interim).find(e => this.graph.getEdgeAttribute(e, "direction") === dir || this.graph.getEdgeAttribute(e, "direction") === "any");
            // return the next cell or undefined
            if (edge === undefined) {
                return undefined;
            }
            const next = this.graph.extremities(edge).find(n => n !== from);
            if (next === undefined) {
                return undefined;
            }
            interim = next;
        }
        return interim;
    }
}
