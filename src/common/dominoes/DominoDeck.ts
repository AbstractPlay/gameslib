import { Domino, IDominoData } from "./Domino";

interface IDeckItem {
    domino: Domino;
    faceUp: boolean;
}

export class DominoDeck {
    private _dominoes: IDeckItem[];

    public get dominoes(): Domino[] {
        return this._dominoes.map((d) => d.domino);
    }

    public get size(): number {
        return this._dominoes.length;
    }

    constructor(dominoes: Domino[] = []) {
        this._dominoes = dominoes.map((d) => ({ domino: d.clone(), faceUp: false }));
    }

    public static fromDouble(n: number): DominoDeck {
        const dominoes: Domino[] = [];
        for (let i = 0; i <= n; i++) {
            for (let j = i; j <= n; j++) {
                dominoes.push(new Domino(i, j));
            }
        }
        return new DominoDeck(dominoes);
    }

    public shuffle(justFaceDown = false): void {
        if (justFaceDown) {
            const indices: number[] = [];
            this._dominoes.forEach((d, i) => {
                if (!d.faceUp) {
                    indices.push(i);
                }
            });
            for (let i = indices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const idxI = indices[i];
                const idxJ = indices[j];
                [this._dominoes[idxI].domino, this._dominoes[idxJ].domino] = [this._dominoes[idxJ].domino, this._dominoes[idxI].domino];
            }
        } else {
            this._dominoes.forEach((d) => (d.faceUp = false));
            for (let i = this._dominoes.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this._dominoes[i], this._dominoes[j]] = [this._dominoes[j], this._dominoes[i]];
            }
        }
    }

    public draw(): Domino | undefined {
        const item = this._dominoes.pop();
        return item?.domino;
    }

    public add(domino: Domino, faceUp = true): void {
        this._dominoes.push({ domino, faceUp });
    }

    public remove(dominoes: Domino[]): void {
        for (const target of dominoes) {
            const idx = this._dominoes.findIndex((item) => (item.domino.l === target.l && item.domino.r === target.r));
            if (idx !== -1) {
                this._dominoes.splice(idx, 1);
            }
        }
    }

    public revealAll(): void {
        this._dominoes.forEach((d) => (d.faceUp = true));
    }

    public clone(): DominoDeck {
        const newDeck = new DominoDeck();
        newDeck._dominoes = this._dominoes.map((d) => ({ domino: d.domino.clone(), faceUp: d.faceUp }));
        return newDeck;
    }

    public serialize(): string {
        return JSON.stringify(this._dominoes.map((d) => ({ l: d.domino.l, r: d.domino.r, faceUp: d.faceUp })));
    }

    public static deserialize(json: string): DominoDeck {
        const data = JSON.parse(json) as (IDominoData & { faceUp?: boolean })[];
        const deck = new DominoDeck();
        deck._dominoes = data.map((d) => ({
            domino: new Domino(d.l, d.r),
            faceUp: d.faceUp ?? false,
        }));
        return deck;
    }
}
