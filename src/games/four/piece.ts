import { Polypiece, type Polymatrix} from "@abstractplay/renderer/build/schemas/schema"

export class Piece implements Polypiece {
    public col: number;
    public row: number;
    public matrix: Polymatrix;
    private _z?: number;
    private readonly _id?: string;

    public get width(): number {
        if (this.matrix.length > 0) {
            return this.matrix[0].length;
        }
        return 0;
    }

    public get height(): number {
        return this.matrix.length;
    }

    public get size(): number {
        if (this.matrix.length > 0) {
            return this.width * this.height;
        }
        return 0;
    }

    public get id(): string {
        if (this._id !== undefined) {
            return this._id;
        }
        return [this.col, this.row, JSON.stringify(this.matrix)].join("|");
    }

    public get z(): number {
        if (this._z !== undefined) {
            return this._z;
        }
        return 0;
    }

    constructor(args: Polypiece) {
        this._id = args.id;
        this._z = args.z;
        this.col = args.col;
        this.row = args.row;
        this.matrix = args.matrix.map(lst => [...lst]);
    }

    public clone(): Piece {
        return new Piece(this);
    }

    // The coordinate system here is typical four-quadrant, not just quadrant IV
    public includes(x: number, y: number): boolean {
        if (y <= this.row && y > this.row - this.height && x >= this.col && x < this.col + this.width) {
            const localX = x - this.col;
            const localY = this.row - y;
            if (this.matrix[localY][localX] !== 0 && this.matrix[localY][localX] !== null) {
                return true;
            }
        }
        return false;
    }

    // The coordinate system here is typical four-quadrant, not just quadrant IV
    public cells(): [number,number][] {
        const cells: [number,number][] = [];
        for (let yOffset = 0; yOffset < this.height; yOffset++) {
            for (let xOffset = 0; xOffset < this.width; xOffset++) {
                if (this.matrix[yOffset][xOffset] !== 0 && this.matrix[yOffset][xOffset] !== null) {
                    cells.push([this.col + xOffset, this.row - yOffset]);
                }
            }
        }
        return cells;
    }

    // this function has to translate the four-quadrant coordinates to SVG quadrant IV
    public render(columnLabels: string[], rowLabels: string[]): Polypiece {
        return {
            id: this._id !== undefined ? this._id : undefined,
            z: this._z !== undefined ? this._z : undefined,
            col: columnLabels.findIndex(l => l === this.col.toString()),
            row: rowLabels.findIndex(l => l === this.row.toString()),
            matrix: this.matrix,
        };
    }
}
