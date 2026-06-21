import {
    Edge,
    Graph as PentGraph,
    Vertex,
} from "../pentagons";
import { buildGridLayers } from "./gridLayers";

/**
 * Pentagonal vertex-mesh topology for the Star board (pieces on intersections).
 *
 * `frequency` is the number of segments along each outer edge (50 pericells when
 * frequency is 10). Pass `width - 1` when the schema uses space-style width 11.
 */
export class Graph {
    public readonly topology: PentGraph;
    public readonly frequency: number;
    /** Center vertex plus the inner pentagon ring — connectivity only, no placement. */
    public readonly bridgeIds: ReadonlySet<number>;
    /** The five corner pericells. */
    public readonly quarkIds: ReadonlySet<number>;
    /** All perimeter vertices (includes quarks). */
    public readonly pericellIds: ReadonlySet<number>;
    /** Playable rings outside-in (row 0 = perimeter from top quark, clockwise). */
    public readonly gridLayers: Vertex[][];

    constructor(frequency: number) {
        if (frequency < 1) {
            throw new Error(`Star board frequency must be at least 1 (got ${frequency}).`);
        }
        this.frequency = frequency;
        this.topology = new PentGraph(frequency);
        this.bridgeIds = Graph.bridgeVertexIds(this.topology);
        this.quarkIds = Graph.quarkVertexIds(this.topology);
        this.pericellIds = new Set(
            this.topology.vertices.filter(vertex => vertex.isOuter).map(vertex => vertex.id),
        );
        this.gridLayers = buildGridLayers(this.topology.layers, frequency);
    }

    public get vertices(): Vertex[] {
        return this.topology.vertices;
    }

    public get edges(): Edge[] {
        return this.topology.edges;
    }

    /** Concentric rings from center outward (same layout as {@link pentagonalBoard}). */
    public get layers(): Vertex[][][] {
        return this.topology.layers;
    }

    private static bridgeVertexIds(topology: PentGraph): ReadonlySet<number> {
        const ids = new Set<number>([topology.vertices[0]!.id]);
        for (const side of topology.layers[1]!) {
            for (const vertex of side) {
                ids.add(vertex.id);
            }
        }
        return ids;
    }

    private static quarkVertexIds(topology: PentGraph): ReadonlySet<number> {
        const outer = topology.layers[topology.layers.length - 1]!;
        return new Set(outer.map(side => side[0]!.id));
    }
}
