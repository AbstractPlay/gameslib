import type { playerid, Pips } from "../cubeo";

export class CubeoDie {
    private readonly _x: number;
    private readonly _y: number;
    private readonly _pips: Pips;
    private readonly _owner: playerid;

    constructor(opts: {x: number, y: number, pips: Pips, owner: playerid}) {
        this._x = opts.x;
        this._y = opts.y;
        this._pips = opts.pips;
        this._owner = opts.owner;
    }

    public get uid(): string {
        return [this.owner, this.pips, this.x, this.y].join(",");
    }

    public get coords(): [number, number] {
        return [this._x, this._y];
    }

    public get x(): number {
        return this._x;
    }

    public get y(): number {
        return this._y
    }

    public get pips(): Pips {
        return this._pips;
    }

    public get owner(): playerid {
        return this._owner;
    }

    public clone(): CubeoDie {
        return new CubeoDie({x: this.x, y: this.y, owner: this.owner, pips: this.pips});
    }

    public static deserialize(die: CubeoDie): CubeoDie {
        return new CubeoDie({x: die._x, y: die._y, owner: die._owner, pips: die._pips});
    }
}
