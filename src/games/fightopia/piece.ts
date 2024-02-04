export interface IPieceArgs {
    owner: 1|2;
    tlx: number;
    tly: number;
    width?: number;
    height?: number
}

export interface IRendered {
    glyph: string;
    row: number;
    col: number;
    height?: number;
    width?: number;
}

export class Piece {
    public readonly owner: 1|2;
    public tlx: number;
    public tly: number;
    public width: number;
    public height: number;

    public get size(): number {
        return this.width * this.height;
    }

    public get id(): string {
        return [this.owner, this.tlx, this.tly, this.width, this.height].join("|");
    }

    public get facing(): "NS"|"EW"|undefined {
        if (this.size !== 2) {
            return undefined;
        } else if (this.width === 2) {
            return "EW";
        } else {
            return "NS";
        }
    }

    constructor(args: IPieceArgs) {
        this.owner = args.owner;
        this.tlx = args.tlx;
        this.tly = args.tly;
        this.width = args.width || 1;
        this.height = args.height || 1;
    }

    public clone(): Piece {
        return new Piece(this);
    }

    public rotate(): Piece {
        const swap = this.height;
        this.height = this.width;
        this.width = swap;
        return this;
    }

    public includes(x: number, y: number): boolean {
        if (y >= this.tly && y < this.tly + this.height && x >= this.tlx && x < this.tlx + this.width) {
            return true;
        }
        return false;
    }

    public cells(): [number,number][] {
        const cells: [number,number][] = [];
        for (let yOffset = 0; yOffset < this.height; yOffset++) {
            for (let xOffset = 0; xOffset < this.width; xOffset++) {
                cells.push([this.tlx + xOffset, this.tly + yOffset]);
            }
        }
        return cells;
    }

    public render(): IRendered {
        return {
            glyph: this.owner === 1 ? "A" : "B",
            col: this.tlx,
            row: this.tly,
            width: this.width,
            height: this.height,
        };
    }
}
