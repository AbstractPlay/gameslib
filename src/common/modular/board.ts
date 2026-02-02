import { Direction, Grid, Orientation, rectangle, type HexOffset } from "honeycomb-grid";
import { hexNeighbours } from "../../common/hexes";
import { ModularGraph } from "./graph";
import { createModularHex, ModularHex, type HexArgs } from "./hex";

type BoardArgs = {
    centres?: {q: number; r: number}[];
    hexes?: {q: number; r: number}[];
    orientation?: Orientation;
    offset?: HexOffset;
};
type AddArgs = HexArgs & {overwrite?: boolean};

export class ModularBoard {
    private _minX: number|undefined;
    private _maxX: number|undefined;
    private _minY: number|undefined;
    private _maxY: number|undefined;
    private _shiftX = 0;
    private _shiftY = 0;
    private _graph!: ModularGraph;
    private orientation: Orientation;
    private offset: HexOffset;
    private hexClass: ReturnType<typeof createModularHex>;

    // _axial2hex is the "authoritative" source
    private _axial2hex: Map<string, ModularHex> = new Map();
    private _offset2hex: Map<string, ModularHex> = new Map();
    private _algebraic2hex: Map<string, ModularHex> = new Map();

    constructor(args?: BoardArgs) {
        this.orientation = args?.orientation ?? Orientation.POINTY;
        this.offset = args?.offset ?? 1;
        this.hexClass = createModularHex(this.orientation, this.offset);
        // populate from given centre points if requested
        if (args?.centres !== undefined) {
            for (const {q, r} of args.centres) {
                const ctr = this.add({q, r, overwrite: true});
                for (const {q: nq, r: nr} of hexNeighbours(ctr)) {
                    this.add({q: nq, r: nr, overwrite: true});
                }
            }
        }
        if (args?.hexes !== undefined) {
            for (const {q, r} of args.hexes) {
                this.add({q, r, overwrite: true});
            }
        }
        this.indexHexes();
    }

    private indexHexes() {
        // Determine shifts to normalize coordinates while preserving parity
        // This ensures that the grid structure (odd/even rows/cols) remains consistent
        // with the fixed offset/orientation.
        this._shiftX = 0;
        this._shiftY = 0;

        if (this.orientation === Orientation.POINTY) {
            if (this._minY !== undefined) {
                // For pointy, row parity matters.
                // If minY is odd, shift by minY - 1 (even amount) to keep it odd (1).
                // If minY is even, shift by minY (even amount) to keep it even (0).
                this._shiftY = this._minY % 2 !== 0 ? this._minY - 1 : this._minY;
                this._shiftX = this._minX ?? 0;
            }
        } else {
            if (this._minX !== undefined) {
                // For flat, col parity matters.
                this._shiftX = this._minX % 2 !== 0 ? this._minX - 1 : this._minX;
                this._shiftY = this._minY ?? 0;
            }
        }

        // this gets called on an empty object when deserializing/cloning
        // so just skip it all if empty
        if (this._axial2hex.size > 0) {
            this._graph = new ModularGraph(this.width, this.height, this.orientation, this.offset);
            this._algebraic2hex.clear();
            // now link to algebraic coordinates, which aren't known until the board is fully populated
            this.hexes.forEach(hex => {
                this._algebraic2hex.set(this.hex2algebraic(hex), hex)
            });
        }
    }

    // private because it should only be used by the constructor the one time
    private add(args: AddArgs): ModularHex {
        let overwrite = false;
        if (args.overwrite !== undefined) {
            overwrite = args.overwrite;
        }
        // no duplicates
        const newhex = this.hexClass.create(args);
        const found = this._axial2hex.get(`${args.q},${args.r}`);
        if (found && !overwrite) {
            throw new Error(`A hex at ${args.q},${args.r} already exists.`);
        }
            this._axial2hex.set(`${args.q},${args.r}`, newhex);
            this._offset2hex.set(`${newhex.col},${newhex.row}`, newhex);
            if (this._minX === undefined) {
                this._minX = newhex.col;
            } else {
                this._minX = Math.min(this._minX, newhex.col);
            }
            if (this._maxX === undefined) {
                this._maxX = newhex.col;
            } else {
                this._maxX = Math.max(this._maxX, newhex.col);
            }
            if (this._minY === undefined) {
                this._minY = newhex.row;
            } else {
                this._minY = Math.min(this._minY, newhex.row);
            }
            if (this._maxY === undefined) {
                this._maxY = newhex.row;
            } else {
                this._maxY = Math.max(this._maxY, newhex.row);
            }
        return newhex;
    }

    public getHexAtOffset(col: number, row: number): ModularHex|undefined {
        const found = this._offset2hex.get(`${col},${row}`);
        // const found = this._hexes.find(h => h.col === col && h.row === row);
        if (found !== undefined) {
            return found.dupe();
        } else {
            return undefined;
        }
    }

    public getHexAtAxial(q: number, r: number): ModularHex|undefined {
        const found = this._axial2hex.get(`${q},${r}`);
        // const found = this._hexes.find(h => h.q === q && h.r === r);
        if (found !== undefined) {
            return found.dupe();
        } else {
            return undefined;
        }
    }

    public getHexAtAlgebraic(cell: string): ModularHex|undefined {
        const found = this._algebraic2hex.get(cell);
        if (found !== undefined) {
            return found.dupe();
        } else {
            return undefined;
        }
        // const [relx, rely] = this.graph.algebraic2coords(cell);
        // const absCol = this.minX + relx;
        // const absRow = this.minY + rely;
        // return this.getHexAtOffset(absCol, absRow);
    }

    public get hexes(): ModularHex[] {
        return [...this._axial2hex.values()].map(h => h.dupe());
    }

    public get minX(): number|undefined {
        return this._minX;
    }

    public get maxX(): number|undefined {
        return this._maxX;
    }

    public get minY(): number|undefined {
        return this._minY;
    }

    public get maxY(): number|undefined {
        return this._maxY;
    }

    public get height(): number {
        if (this.maxY === undefined || this.minY === undefined) {
            return 0;
        }
        return this.maxY - this._shiftY + 1;
    }

    public get width(): number {
        if (this.maxX === undefined || this.minX === undefined) {
            return 0;
        }
        return this.maxX - this._shiftX + 1;
    }

    public get graph(): ModularGraph {
        return this._graph;
    }

    public hex2algebraic(hex: ModularHex): string {
        return this.graph.coords2algebraic(...this.hex2coords(hex));
    }

    public hex2coords(hex: ModularHex): [number,number] {
        return [hex.col - this._shiftX, hex.row - this._shiftY];
    }

    public clone(): ModularBoard {
        const cloned = new ModularBoard({orientation: this.orientation});
        this.hexes.forEach(h => cloned.add(h));
        cloned.indexHexes();
        return cloned;
    }

    public serialize(): ModularHex[] {
        return this.hexes;
    }

    public static deserialize(hexes: ModularHex[]): ModularBoard {
        const orientation = hexes.length > 0 ? hexes[0].orientation : Orientation.FLAT;
        const cloned = new ModularBoard({orientation});
        hexes.forEach(h => cloned.add(h));
        cloned.indexHexes();
        return cloned;
    }

    public get hexesOrdered(): ModularHex[][] {
        const cells = this.graph.listCells(true) as string[][];
        const ordered: ModularHex[][] = [];
        for (const row of cells) {
            const realrow: ModularHex[] = [];
            for (const cell of row) {
                const hex = this.getHexAtAlgebraic(cell);
                if (hex !== undefined) {
                    realrow.push(hex.dupe());
                }
            }
            ordered.push(realrow);
        }
        return ordered;
    }

    public get grid(): Grid<ModularHex> {
        return new Grid(this.hexClass, rectangle({width: this.width, height: this.height}));
    }

    public castRay(from: string, dir: Direction, opts: { ignoreVoids?: boolean } = {}): string[] {
        const ray: string[] = [];
        // Use the graph's ray function which is bounded by the board dimensions
        const potentialRay = this.graph.ray(from, dir);
        for (const cell of potentialRay) {
            if (this.getHexAtAlgebraic(cell) !== undefined) {
                ray.push(cell);
            } else if (!opts.ignoreVoids) {
                break;
            }
        }
        return ray;
    }

    public get blockedCells(): string[] {
        const blocked: string[] = [];
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const cell = this.graph.coords2algebraic(x, y);
                if (this.getHexAtAlgebraic(cell) === undefined) {
                    blocked.push(cell);
                }
            }
        }
        return blocked;
    }

    public neighbours(hex: ModularHex): ModularHex[] {
        const g = this.grid;
        const ns: ModularHex[] = [];
        for (const dir of hex.directions) {
            const n = g.neighborOf(hex, dir, {allowOutside: true});
            if (this.getHexAtAxial(n.q, n.r) !== undefined) {
                ns.push(n);
            }
        }
        return ns;
    }
}
