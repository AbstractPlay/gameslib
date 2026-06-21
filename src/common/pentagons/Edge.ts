export class Edge {
    private _id: number;
    private _vidA: number; // should be lowest
    private _vidB: number; // should be highest
    private _isOuter: boolean = false;

    constructor(id: number, a: number, b: number) {
        this._id = id;
        this._vidA = a;
        this._vidB = b;
    }

    public get id(): number {
        return this._id;
    }
    public get vidA(): number {
        return this._vidA;
    }
    public get vidB(): number {
        return this._vidB;
    }
    public get isOuter(): boolean|undefined {
        return this._isOuter;
    }
    public set isOuter(val: boolean) {
        this._isOuter = val;
    }

    public toString = (): string => {
        return `E${this.id}=V${this.vidA}-V${this.vidB}, isOuter? ${this.isOuter}`;
    }
}
