import { Orientation } from "honeycomb-grid";
import { hexNeighbours } from "../../common/hexes";
import { StorisendeGraph } from "./graph";
import { StorisendeHex, type HexArgs } from "./hex";
import type { playerid, Tile } from "../storisende";
import { connectedComponents } from "graphology-components";

type BoardArgs = {
    centres?: {q: number; r: number}[];
};
type AddArgs = HexArgs & {overwrite?: boolean};

export class StorisendeBoard {
    private _minX: number|undefined;
    private _maxX: number|undefined;
    private _minY: number|undefined;
    private _maxY: number|undefined;

    // _axial2hex is the "authoritative" source
    private _axial2hex: Map<string, StorisendeHex> = new Map();
    private _offset2hex: Map<string, StorisendeHex> = new Map();
    private _algebraic2hex: Map<string, StorisendeHex> = new Map();

    constructor(args?: BoardArgs) {
        // populate from given centre points if requested
        if (args?.centres !== undefined) {
            for (const {q, r} of args.centres) {
                const ctr = this.add({q, r, tile: "virgin", stack: [], overwrite: true});
                for (const {q: nq, r: nr} of hexNeighbours(ctr)) {
                    this.add({q: nq, r: nr, tile: "virgin", stack: [], overwrite: true});
                }
            }
        }
        this.indexHexes();
    }

    private indexHexes() {
        this._offset2hex.clear();
        this._algebraic2hex.clear();
        // now link to algebraic coordinates, which aren't known until the board is fully populated
        this.hexes.forEach(hex => {
            this._offset2hex.set(`${hex.col},${hex.row}`, hex);
            this._algebraic2hex.set(this.hex2algebraic(hex), hex)
        });
    }

    // private because it should only be used by the constructor the one time
    private add(args: AddArgs): StorisendeHex {
        let overwrite = false;
        if (args.overwrite !== undefined) {
            overwrite = args.overwrite;
        }
        // no duplicates
        const newhex = StorisendeHex.create(args);
        const found = this._axial2hex.get(`${args.q},${args.r}`);
        if (found && !overwrite) {
            throw new Error(`A hex at ${args.q},${args.r} already exists.`);
        } else if (found === undefined) {
            this._axial2hex.set(`${args.q},${args.r}`, newhex);
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
        }
        return newhex;
    }

    public getHexAtOffset(col: number, row: number): StorisendeHex|undefined {
        const found = this._offset2hex.get(`${col},${row}`);
        // const found = this._hexes.find(h => h.col === col && h.row === row);
        if (found !== undefined) {
            return found.dupe();
        } else {
            return undefined;
        }
    }

    public getHexAtAxial(q: number, r: number): StorisendeHex|undefined {
        const found = this._axial2hex.get(`${q},${r}`);
        // const found = this._hexes.find(h => h.q === q && h.r === r);
        if (found !== undefined) {
            return found.dupe();
        } else {
            return undefined;
        }
    }

    public getHexAtAlgebraic(cell: string): StorisendeHex|undefined {
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

    public updateHexStack(hex: StorisendeHex, newstack: playerid[]): StorisendeHex {
        const found = this._axial2hex.get(`${hex.q},${hex.r}`);
        if (found !== undefined) {
            found.stack = [...newstack];
            this._axial2hex.set(`${found.q},${found.r}`, found);
            this._offset2hex.set(`${found.col},${found.row}`, found);
            this._algebraic2hex.set(this.hex2algebraic(found), found)
            return found.dupe();
        }
        throw new Error("Could not find a matching hex.");
    }

    public updateHexTile(hex: StorisendeHex, newtile: Tile): StorisendeHex {
        const found = this._axial2hex.get(`${hex.q},${hex.r}`);
        if (found !== undefined) {
            found.tile = newtile;
            this._axial2hex.set(`${found.q},${found.r}`, found);
            this._offset2hex.set(`${found.col},${found.row}`, found);
            this._algebraic2hex.set(this.hex2algebraic(found), found)
            return found.dupe();
        }
        throw new Error("Could not find a matching hex.");
    }

    public get hexes(): StorisendeHex[] {
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
        return this.maxY - this.minY + 1;
    }

    public get width(): number {
        if (this.maxX === undefined || this.minX === undefined) {
            return 0;
        }
        return this.maxX - this.minX + 1;
    }

    public get graph(): StorisendeGraph {
        return new StorisendeGraph(this.width, this.height, Orientation.POINTY, 1);
    }

    public hex2algebraic(hex: StorisendeHex): string {
        return this.graph.coords2algebraic(...this.hex2coords(hex));
    }

    public hex2coords(hex: StorisendeHex): [number,number] {
        return [Math.abs(this.minX! - hex.col), Math.abs(this.minY! - hex.row)];
    }

    // list of connected "territory" tiles
    public get territories(): string[][] {
        const g = this.graph.graph;
        // drop everything that's not a territory
        for (const node of g.nodes()) {
            const hex = this.getHexAtAlgebraic(node);
            if (hex === undefined || hex.tile !== "territory") {
                g.dropNode(node);
            }
        }
        return connectedComponents(g);
    }

    // list of connected "territory" AND "virgin" tiles
    public get nations(): string[][] {
        const g = this.graph.graph;
        // drop everything that's not a territory or virgin
        for (const node of g.nodes()) {
            const hex = this.getHexAtAlgebraic(node);
            if (hex === undefined || hex.tile === "wall") {
                g.dropNode(node);
            }
        }
        return connectedComponents(g);
    }

    public clone(): StorisendeBoard {
        const cloned = new StorisendeBoard();
        this.hexes.forEach(h => cloned.add(h));
        cloned.indexHexes();
        return cloned;
    }

    public serialize(): StorisendeHex[] {
        return this.hexes;
    }

    public static deserialize(hexes: StorisendeHex[]): StorisendeBoard {
        const cloned = new StorisendeBoard();
        hexes.forEach(h => cloned.add(StorisendeHex.deserialize(h)));
        cloned.indexHexes();
        return cloned;
    }
}
