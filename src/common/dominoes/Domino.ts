export interface IDominoData {
    l: number;
    r: number;
}

export class Domino {
    public readonly l: number;
    public readonly r: number;

    constructor(l: number, r: number) {
        this.l = l;
        this.r = r;
    }

    public clone(): Domino {
        return new Domino(this.l, this.r);
    }

    public serialize(): string {
        return JSON.stringify({l: this.l, r: this.r});
    }

    public static deserialize(json: string): Domino {
        const data = JSON.parse(json) as IDominoData;
        return new Domino(data.l, data.r);
    }
}