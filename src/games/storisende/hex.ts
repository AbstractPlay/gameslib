import { defineHex, Orientation } from "honeycomb-grid";
import type { playerid, Tile } from "../storisende";

export type HexArgs = {q: number; r: number; tile?: Tile; stack?: playerid[]};

export class StorisendeHex extends defineHex({ offset: 1, orientation: Orientation.POINTY }) {
    tile: Tile;
    stack!: playerid[];

    public get uid(): string {
        return `${this.q},${this.r}`;
    }

    public get col(): number {
        return this.q + (this.r + (this.r & 1)) / 2;
    }

    public get row(): number {
        return this.r;
    }

    static create(args: HexArgs) {
        const hex = new StorisendeHex({q: args.q, r: args.r});
        hex.tile = "virgin";
        if (args.tile !== undefined) {
            hex.tile = args.tile;
        }
        hex.stack = [];
        if (args.stack !== undefined) {
            hex.stack = [...args.stack];
        }
        return hex;
    }

    public dupe(): StorisendeHex {
        return StorisendeHex.create({q: this.q, r: this.r, tile: this.tile, stack: this.stack});
    }

    public static deserialize(hex: StorisendeHex): StorisendeHex {
        return StorisendeHex.create({q: hex.q, r: hex.r, tile: hex.tile, stack: hex.stack === undefined ? undefined : [...hex.stack]});
    }
}
