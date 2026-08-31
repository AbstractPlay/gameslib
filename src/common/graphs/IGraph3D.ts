import { IGraph } from "./IGraph.js";

export interface IGraph3D extends IGraph {
    elevation(cell: string|[number,number]): number;
}