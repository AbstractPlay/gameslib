import { Orientation } from "honeycomb-grid";
import { hexNeighbours } from "../../common/hexes.js";
import { StorisendeGraph } from "./graph.js";
import { StorisendeHex, type HexArgs } from "./hex.js";
import type { playerid, Tile } from "../storisende.js";
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
    private _graph!: StorisendeGraph;

    // _axial2hex is the "authoritative" source
    private _axial2hex: Map<string, StorisendeHex> = new Map();
    private _offset2hex: Map<string, StorisendeHex> = new Map();
    private _algebraic2hex: Map<string, StorisendeHex> = new Map();
    private _nationsCache: string[][] | undefined;
    private _territoriesCache: string[][] | undefined;

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
        const originHex = this.getHexAtAxial(0, 0);
        // this gets called on an empty object when deserializing/cloning
        // so just skip it all if empty
        if (originHex !== undefined) {
            const [, oRow] = this.hex2coords(originHex);
            this._graph = new StorisendeGraph(this.width, this.height, Orientation.POINTY, oRow % 2 === 0 ? 1 : -1);
            this._algebraic2hex.clear();
            // now link to algebraic coordinates, which aren't known until the board is fully populated
            this.hexes.forEach(hex => {
                this._algebraic2hex.set(this.hex2algebraic(hex), hex)
            });
        }
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

    /** Live hex for engine hot paths (do not mutate returned instance). */
    public getHexAtAlgebraicLive(cell: string): StorisendeHex|undefined {
        return this._algebraic2hex.get(cell);
    }

    public liveHexes(): IterableIterator<StorisendeHex> {
        return this._axial2hex.values();
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

    private invalidateTopologyCache(): void {
        this._nationsCache = undefined;
        this._territoriesCache = undefined;
    }

    public updateHexStack(hex: StorisendeHex, newstack: playerid[]): StorisendeHex {
        const found = this._axial2hex.get(`${hex.q},${hex.r}`);
        if (found !== undefined) {
            found.stack = [...newstack];
            this._axial2hex.set(`${found.q},${found.r}`, found);
            this._offset2hex.set(`${found.col},${found.row}`, found);
            this._algebraic2hex.set(this.hex2algebraic(found), found);
            this.invalidateTopologyCache();
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
            this._algebraic2hex.set(this.hex2algebraic(found), found);
            this.invalidateTopologyCache();
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
        return this._graph;
    }

    public hex2algebraic(hex: StorisendeHex): string {
        return this.graph.coords2algebraic(...this.hex2coords(hex));
    }

    public hex2coords(hex: StorisendeHex): [number,number] {
        return [Math.abs(this.minX! - hex.col), Math.abs(this.minY! - hex.row)];
    }

    // list of connected "territory" tiles
    public get territories(): string[][] {
        if (this._territoriesCache !== undefined) {
            return this._territoriesCache;
        }
        const g = this.graph.graph.copy();
        for (const node of g.nodes()) {
            const hex = this.getHexAtAlgebraic(node);
            if (hex === undefined || hex.tile !== "territory") {
                g.dropNode(node);
            }
        }
        this._territoriesCache = connectedComponents(g);
        return this._territoriesCache;
    }

    /**
     * Territory components touching `cell` (via neighbours that are territory tiles).
     * Matches counting distinct global territory components adjacent to `cell`.
     */
    public countDistinctTerritoryComponentsAdjacent(cell: string): number {
        const graph = this.graph;
        const visited = new Set<string>();
        const componentKeys = new Set<string>();

        const floodComponentKey = (start: string): string => {
            const stack = [start];
            let minKey = start;
            while (stack.length > 0) {
                const c = stack.pop()!;
                if (visited.has(c)) {
                    continue;
                }
                visited.add(c);
                if (c.localeCompare(minKey) < 0) {
                    minKey = c;
                }
                for (const n of graph.neighbours(c)) {
                    if (visited.has(n)) {
                        continue;
                    }
                    const hex = this.getHexAtAlgebraicLive(n);
                    if (hex !== undefined && hex.tile === "territory") {
                        stack.push(n);
                    }
                }
            }
            return minKey;
        };

        for (const n of graph.neighbours(cell)) {
            const hex = this.getHexAtAlgebraicLive(n);
            if (hex === undefined || hex.tile !== "territory" || visited.has(n)) {
                continue;
            }
            componentKeys.add(floodComponentKey(n));
        }

        return componentKeys.size;
    }

    // list of connected "territory" AND "virgin" tiles
    public get nations(): string[][] {
        if (this._nationsCache !== undefined) {
            return this._nationsCache;
        }
        const g = this.graph.graph.copy();
        for (const node of g.nodes()) {
            const hex = this.getHexAtAlgebraic(node);
            if (hex === undefined || hex.tile === "wall") {
                g.dropNode(node);
            }
        }
        this._nationsCache = connectedComponents(g);
        return this._nationsCache;
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
        hexes.forEach(h => cloned.add(h));
        cloned.indexHexes();
        return cloned;
    }
}
