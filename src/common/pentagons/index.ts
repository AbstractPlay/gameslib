import { Graph } from "./Graph.js";
import { Vertex } from "./Vertex.js";
import { Edge } from "./Edge.js";

export { Vertex, Edge, Graph };

export const pentagonalBoard = (size: number): Graph => new Graph(size);
