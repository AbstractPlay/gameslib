import { IGraph } from "./IGraph";

export interface IGraph3D extends IGraph {
    elevation(cell: string|[number,number]): number;
}