import { Graph } from "./Graph";
import { Vertex } from "./Vertex";
import { Edge } from "./Edge";

export { Vertex, Edge, Graph };

export const pentagonalBoard = (size: number): Graph => new Graph(size);
