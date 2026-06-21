import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { bentTriBoard, Graph as BentTriTopology, type BentTriOptions } from "../bentTri";
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

const ringLetter = (ring: number): string => {
    const letter = columnLabels[ring];
    if (letter === undefined) {
        throw new Error(`Ring index out of range: ${ring}`);
    }
    return letter;
};

const parseAlgebraic = (cell: string): [number, number] => {
    const match = cell.match(/^([a-z]+)(\d+)$/);
    if (match === null) {
        throw new Error(`Invalid algebraic notation: ${cell}`);
    }
    const ring = columnLabels.indexOf(match[1]);
    if (ring < 0) {
        throw new Error(`Invalid ring label: ${match[1]}`);
    }
    const pos = parseInt(match[2], 10) - 1;
    if (isNaN(pos) || pos < 0) {
        throw new Error(`Invalid position: ${match[2]}`);
    }
    return [ring, pos];
};

export type BentTriNodeData = {
    id: number;
    ring: number;
    pos: number;
    isOuter: boolean;
};

export class BentTriGraph implements IGraph {
    public readonly frequency: number;
    public readonly topo: BentTriTopology;
    public graph: UndirectedGraph;
    private readonly vidToLabel = new Map<number, string>();
    private readonly labelToVid = new Map<string, number>();

    constructor(frequency: number, opts?: BentTriOptions) {
        this.frequency = frequency;
        this.topo = bentTriBoard(frequency, opts);
        this.buildLabelMaps();
        this.graph = this.buildGraph();
    }

    /** Rings outside-in (a, b, c, …); position 1-based clockwise from the north apex. */
    private buildLabelMaps(): void {
        for (let ring = 0; ring < this.topo.gridLayers.length; ring++) {
            const layer = this.topo.gridLayers[ring];
            const letter = ringLetter(ring);
            for (let pos = 0; pos < layer.length; pos++) {
                const label = letter + (pos + 1).toString();
                const vid = layer[pos].id;
                this.vidToLabel.set(vid, label);
                this.labelToVid.set(label, vid);
            }
        }
    }

    private buildGraph(): UndirectedGraph {
        const g = new UndirectedGraph();
        for (const vertex of this.topo.vertices) {
            const nodeId = this.vidToLabel.get(vertex.id);
            if (nodeId === undefined) {
                throw new Error(`Missing algebraic label for vertex ${vertex.id}`);
            }
            const [ring, pos] = parseAlgebraic(nodeId);
            g.addNode(nodeId, {
                id: vertex.id,
                ring,
                pos,
                isOuter: vertex.isOuter,
            } as BentTriNodeData);
        }
        for (const edge of this.topo.edges) {
            const a = this.vidToLabel.get(edge.vidA);
            const b = this.vidToLabel.get(edge.vidB);
            if (a === undefined || b === undefined) {
                throw new Error(`Could not map edge endpoints ${edge.vidA} or ${edge.vidB} to labels.`);
            }
            g.addUndirectedEdgeWithKey(`${a}>${b}`, a, b);
        }
        return g;
    }

    /** x = ring index (0 = outer), y = clockwise position index within the ring. */
    public coords2algebraic(x: number, y: number): string {
        return ringLetter(x) + (y + 1).toString();
    }

    public algebraic2coords(cell: string): [number, number] {
        return parseAlgebraic(cell);
    }

    public listCells(ordered = false): string[] | string[][] {
        if (!ordered) {
            return this.graph.nodes();
        }
        return this.topo.gridLayers.map((layer, ring) =>
            layer.map((_, pos) => this.coords2algebraic(ring, pos)),
        );
    }

    public neighbours(node: string): string[] {
        return this.graph.neighbors(node);
    }

    public path(from: string, to: string): string[] | null {
        return bidirectional(this.graph, from, to);
    }
}
