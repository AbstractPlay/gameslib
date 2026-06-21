import { Point } from "./lattice";

export class Vertex {
    private _id: number;
    private _isOuter: boolean;
    private _pt: Point|undefined;
    private _nbors: Set<number>;
    private _edges: Set<number>;

    constructor(id: number, isOuter: boolean) {
        this._id = id;
        this._isOuter = isOuter;
        this._nbors = new Set<number>();
        this._edges = new Set<number>();
    }

    public get id(): number {
        return this._id;
    }
    public get isOuter(): boolean {
        return this._isOuter;
    }
    public get pt(): Point|undefined {
        return this._pt;
    }
    public get nbors(): number[] {
        return [...this._nbors];
    }
    public get edges(): number[] {
        return [...this._edges];
    }

    public addEdge(edge: number) {
        this._edges.add(edge);
    }
    public addNbor(nbor: number) {
        this._nbors.add(nbor);
    }
    public setPoint(x: number, y: number) {
        this._pt = {x, y};
    }
    public setOuter(isOuter: boolean) {
        this._isOuter = isOuter;
    }

    public toString = (): string => {
        return `V${this.id} at ${this.pt?.x.toFixed(3)},${this.pt?.y.toFixed(3)}, N=${this.nbors.join(",")}, E=${this.edges.join(",")}, isOuter? ${this.isOuter}`;
    }

}
