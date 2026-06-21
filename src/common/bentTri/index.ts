/**
 * Bent equilateral-triangle board topology.
 *
 * Merged graph of three overlapped triangular-lattice copies (the commercial
 * "bent Y" board). Display bowing lives in the renderer; this module only
 * builds the playable adjacency graph.
 */

import { Graph, type BentTriOptions } from "./Graph";
import { Vertex } from "./Vertex";
import { Edge } from "./Edge";
import { overlapRowsFor } from "./lattice";

export { Vertex, Edge, Graph, overlapRowsFor };
export type { BentTriOptions };

export const bentTriBoard = (frequency: number, opts?: BentTriOptions): Graph => {
    return new Graph(frequency, opts);
};
