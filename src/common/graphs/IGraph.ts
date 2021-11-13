export interface IGraph {
    coords2algebraic(x: number, y: number): string;
    algebraic2coords(cell: string): [number, number];
    listCells(ordered?: boolean): string[] | string[][];
    neighbours(node: string): string[];
    path(from: string, to: string): string[] | null;
}