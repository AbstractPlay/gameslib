import { BiscuitCard } from "./card";

export class BiscuitBoard {
    private _cards: BiscuitCard[];

    constructor() {
        this._cards = [];
    }

    public add(card: BiscuitCard): void {
        // no overlaps allowed
        const found = this.getCardAt(card.x, card.y);
        if (found !== undefined) {
            throw new Error(`The coordinates ${card.x},${card.y} are already occupied by a card.`);
        }
        this._cards.push(card);
    }

    public getCardAt(x: number, y: number): BiscuitCard|undefined {
        return this._cards.find(d => d.x === x && d.y === y);
    }

    public get cards(): BiscuitCard[] {
        return this._cards.map(d => d.clone())
    }

    // returns the mainline sorted from left to right
    // and the cross lines sorted from top to bottom
    public get lines(): {main: BiscuitCard[], cross: BiscuitCard[][], idxs: number[]} {
        const root = this.getCardAt(0, 0)!;
        const mainline = this.cards.filter(c => c.y === 0).sort((a,b) => a.x - b.x);
        const crossColIdxs = mainline.filter(c => c.x !== 0 && c.card.rank.uid === root.card.rank.uid).map(c => c.x);
        const crossCols: BiscuitCard[][] = [];
        for (const idx of crossColIdxs) {
            const cross = this.cards.filter(c => c.x === idx).sort((a,b) => b.y - a.y);
            crossCols.push(cross);
        }
        return {
            main: mainline,
            cross: crossCols,
            idxs: crossColIdxs
        };
    }

    public get minX(): number {
        return Math.min(...this._cards.map(d => d.x));
    }

    public get minY(): number {
        return Math.min(...this._cards.map(d => d.y));
    }

    public get maxX(): number {
        return Math.max(...this._cards.map(d => d.x));
    }

    public get maxY(): number {
        return Math.max(...this._cards.map(d => d.y));
    }

    public get width(): number {
        return this.maxX - this.minX + 1;
    }

    public get height(): number {
        return this.maxY - this.minY + 1;
    }

    public get dimensions(): {height: number, width: number, minX: number, maxX: number, minY: number, maxY: number} {
        return {
            height: this.height,
            width: this.width,
            maxX: this.maxX,
            maxY: this.maxY,
            minX: this.minX,
            minY: this.minY,
        };
    }

    // Takes an absolute coordinate and translates it to the relative version
    // of the expanded board, for annotations and markers.
    // Returns undefined if the absolute coordinates don't map to a realistic
    // relative coordinate (fits in known boundaries of quadrant-IV space).
    public abs2rel(absx: number, absy: number): [number,number]|undefined {
        let relx: number;
        let rely: number;

        if (absx < this.minX) {
            relx = 1 - Math.abs(this.minX - absx);
        } else if (absx > this.maxX) {
            relx = this.width + Math.abs(this.maxX - absx)
        } else {
            relx = 1 + Math.abs(this.minX - absx);
        }
        if (absy < this.minY) {
            rely = this.height + Math.abs(this.minY - absy)
        } else if (absy > this.maxY) {
            rely = 1 - Math.abs(this.maxY - absy);
        } else {
            rely = 1 + Math.abs(this.maxY - absy);
        }

        if (relx < 0 || relx >= this.width + 2 || rely < 0 || rely >= this.height + 2) {
            return undefined;
        }
        return [relx, rely];
    }

    // Takes a relative coordinate from the expanded board and returns the absolute equivalent
    public rel2abs(relx: number, rely: number): [number,number] {
        const absx = this.minX + (relx-1);
        const absy = this.maxY - (rely-1);
        return [absx, absy];
    }

    public clone(): BiscuitBoard {
        const cloned = new BiscuitBoard();
        this._cards.forEach(d => cloned.add(d));
        return cloned;
    }

    public static deserialize(board: BiscuitBoard): BiscuitBoard {
        const cloned = new BiscuitBoard();
        board._cards.forEach(d => cloned.add(BiscuitCard.deserialize(d)));
        return cloned;
    }

}
