export type ComponentParams = {
    uid: string;
    seq: number;
    name: string;
    glyph?: string;
};

export class Component {
    private readonly _uid: string;
    private readonly _seq: number;
    private readonly _name: string;
    private readonly _glyph?: string;

    constructor(params: ComponentParams) {
        this._uid = params.uid;
        this._seq = params.seq;
        this._name = params.name;
        this._glyph = params.glyph;
    }

    public get uid(): string {
        return this._uid;
    }
    public get seq(): number {
        return this._seq;
    }
    public get name(): string {
        return this._name;
    }
    public get glyph(): string|undefined {
        return this._glyph;
    }

    public clone(): Component {
        return new Component({uid: this.uid, seq: this.seq, name: this.name, glyph: this.glyph});
    }

    public static deserialize(comp: Component|string): Component|undefined {
        if (typeof comp === "string") {
            return [...suits, ...ranks].find(c => c.uid === comp);
        }
        return new Component({uid: comp._uid, seq: comp._seq, name: comp._name, glyph: comp._glyph});
    }

    public toString(): string {
        return this.uid;
    }
}

export const suits: Component[] = [
    new Component({uid: "M", seq: 1, name: "Moons", glyph: "decktet-moons"}),
    new Component({uid: "S", seq: 2, name: "Suns", glyph: "decktet-suns"}),
    new Component({uid: "V", seq: 3, name: "Waves", glyph: "decktet-waves"}),
    new Component({uid: "L", seq: 4, name: "Leaves", glyph: "decktet-leaves"}),
    new Component({uid: "Y", seq: 5, name: "Wyrms", glyph: "decktet-wyrms"}),
    new Component({uid: "K", seq: 6, name: "Knots", glyph: "decktet-knots"}),
];

export const ranks: Component[] = [
    new Component({uid: "0", seq: 0, name: "Excuse", glyph: "decktet-0"}),
    new Component({uid: "1", seq: 1, name: "Ace"}),
    new Component({uid: "2", seq: 2, name: "2", glyph: "decktet-2"}),
    new Component({uid: "3", seq: 3, name: "3", glyph: "decktet-3"}),
    new Component({uid: "4", seq: 4, name: "4", glyph: "decktet-4"}),
    new Component({uid: "5", seq: 5, name: "5", glyph: "decktet-5"}),
    new Component({uid: "6", seq: 6, name: "6", glyph: "decktet-6"}),
    new Component({uid: "7", seq: 7, name: "7", glyph: "decktet-7"}),
    new Component({uid: "8", seq: 8, name: "8", glyph: "decktet-8"}),
    new Component({uid: "9", seq: 9, name: "9", glyph: "decktet-9"}),
    new Component({uid: "P", seq: 9.3, name: "Pawn", glyph: "decktet-pawn"}),
    new Component({uid: "T", seq: 9.6, name: "Court", glyph: "decktet-court"}),
    new Component({uid: "N", seq: 10, name: "Crown", glyph: "decktet-crown"}),
];
