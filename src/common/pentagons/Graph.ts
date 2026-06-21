import { Edge } from "./Edge";
import { Vertex } from "./Vertex";

export class Graph {
    public vertices: Vertex[] = [];
    public edges: Edge[] = [];
    public layers: Vertex[][][] = [];

    constructor(size: number) {
        this.vertices = [];
        this.edges = [];
        this.makeLayersAndVertices(size);
        this.makeEdges(size);
    }

    private makeLayersAndVertices(size: number): void {
        this.layers = [];

        // add central vertex
        this.vertices.push(new Vertex(0, false));

        // make vertices layer by layer
        for (let layer = 0; layer < size + 1; layer++) {
            const curveList: Vertex[][] = [];
            this.layers.push(curveList);
            const vertsPerCurve = layer + 1;
            let startVertex: Vertex|undefined;
            for (let side = 0; side < 5; side++) {
                const curve: Vertex[] = [];
                curveList.push(curve);
                if (layer === 0) {
                    curve.push(this.vertices[0]);
                } else {
                    for (let n = 0; n < vertsPerCurve; n++) {
                        const vertex: Vertex = (layer === 0) ? this.vertices[0] : new Vertex(this.vertices.length, layer === size);
                        if (startVertex === undefined) {
                            startVertex = vertex;
                        }

                        if (side === 4 && n === vertsPerCurve - 1) {
                            curve.push(startVertex);
                        } else {
                            curve.push(vertex);
                        }

                        if (n < vertsPerCurve - 1) {
                            this.vertices.push(vertex);
                        }
                    }
                }
            }
        }
        // console.log(`Layers are:`);
        // for (let l = 0; l < this.layers.length; l++) {
        //     console.log(`Layer ${l}:`);
        //     for (let s = 0; s < this.layers[l].length; s++) {
        //         console.log(`- Side ${s}:`);
        //         for (const v of this.layers[l][s]) {
        //             console.log(`  V${v.id}`);
        //         }
        //     }
        // }
        // console.log(`vertices: ${this.vertices.map(v => v.toString()).join("\n")}`);
    }

    private makeEdges(size: number): void {
        for (let layer = 0; layer < size + 1; layer++) {
            for (let side = 0; side < 5; side++) {
                const curve = this.layers[layer][side];

                // join consecutive vertices within layer
                for (let n = 0; n < curve.length - 1; n++) {
                    const vidA = curve[n].id;
                    const vidB = curve[n+1].id;
                    this.addEdgeIfUnique(vidA, vidB);
                }

                if (layer < size) {
                    // join adjacent vertices between layers
                    const next = this.layers[layer+1][side];
                    for (let n = 0; n < curve.length; n++) {
                        const vidA = curve[n].id;
                        const vidB1 = next[n].id;
                        const vidB2 = next[n+1].id;

                        this.addEdgeIfUnique(vidA, vidB1);
                        this.addEdgeIfUnique(vidA, vidB2);
                    }
                }

            }
        }

        // set outer edges
        for (const edge of this.edges) {
            // set outer edges
            if (this.vertices[edge.vidA].isOuter && this.vertices[edge.vidB].isOuter) {
                edge.isOuter = true;
            }
        }

        // set incident edges
        for (const edge of this.edges) {
            this.vertices[edge.vidA].addEdge(edge.id);
            this.vertices[edge.vidB].addEdge(edge.id);
        }

        // set vertex nbors
        for (const edge of this.edges) {
            this.vertices[edge.vidA].addNbor(this.vertices[edge.vidB].id);
            this.vertices[edge.vidB].addNbor(this.vertices[edge.vidA].id);
        }
    }

    private addEdgeIfUnique(vidA: number, vidB: number): void {
        for (const edge of this.edges) {
            if (edge.vidA === vidA && edge.vidB === vidB) {
                return;
            }
        }
        this.edges.push(new Edge(this.edges.length, vidA, vidB));
    }

    public toString = (): string => {
        let str = "";

        if (this.vertices.length === 0) {
            return "Graph has no vertices.";
        }

        str += `${this.vertices.length} vertices:\n`;
        for (const vertex of this.vertices) {
            str += `- ${vertex}\n`;
        }

        if (this.edges.length === 0) {
            str += "No edges.\n";
        } else {
            str += `${this.edges.length} edges:\n`;
            for (const edge of this.edges) {
                str += `- ${edge}\n`;
            }
        }

        return str;
    }
}
