import { SquareDirectedGraph, SquareOrthGraph } from "../../common";
import { QuincunxCard } from "./card";

export class QuincunxBoard {
    private _cards: QuincunxCard[];

    constructor() {
        this._cards = [];
    }

    public add(card: QuincunxCard): void {
        // no overlaps allowed
        const found = this.getCardAt(card.x, card.y);
        if (found !== undefined) {
            throw new Error(`The coordinates ${card.x},${card.y} are already occupied by a card.`);
        }
        this._cards.push(card);
    }

    public getCardAt(x: number, y: number): QuincunxCard|undefined {
        return this._cards.find(d => d.x === x && d.y === y);
    }

    public get cards(): QuincunxCard[] {
        return this._cards.map(d => d.clone())
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

    public get graph(): SquareDirectedGraph {
        const { height, width } = this.dimensions;
        const g = new SquareDirectedGraph(width < 5 ? width + 2 : 5, height < 5 ? height + 2 : 5);
        return g;
    }

    public get graphOcc(): SquareDirectedGraph {
        const { height, width } = this.dimensions;
        const g = new SquareDirectedGraph(width < 5 ? width + 2 : 5, height < 5 ? height + 2 : 5);
        for (const node of [...g.graph.nodes()]) {
            const [relx, rely] = g.algebraic2coords(node);
            const [absx, absy] = this.rel2abs(relx, rely);
            if (this.getCardAt(absx, absy) === undefined) {
                g.graph.dropNode(node);
            }
        }
        return g;
    }

    public get graphOrth(): SquareOrthGraph {
        const { height, width } = this.dimensions;
        const g = new SquareOrthGraph(width < 5 ? width + 2 : 5, height < 5 ? height + 2 : 5);
        return g;
    }

    // Returns a list of absolute x,y coordinates where card may be placed
    public get empties(): [number,number][] {
        const g = this.graphOrth;
        const nodes = new Set<string>();
        for (const card of this._cards) {
            const node = g.coords2algebraic(...this.abs2rel(card.x, card.y)!);
            for (const n of g.neighbours(node)) {
                const [absx, absy] = this.rel2abs(...g.algebraic2coords(n));
                if (this.getCardAt(absx, absy) === undefined) {
                    nodes.add(n);
                }
            }
        }
        return [...nodes].map(n => this.rel2abs(...g.algebraic2coords(n)));
    }

    // Takes an absolute coordinate and translates it to the relative version
    // of the (potentially) expanded board, for annotations and markers.
    // Returns undefined if the absolute coordinates don't map to a realistic
    // relative coordinate (fits in known boundaries of quadrant-IV space).
    public abs2rel(absx: number, absy: number): [number,number]|undefined {
        const { width, height } = this.dimensions
        let relx: number;
        let rely: number;

        if (absx < this.minX) {
            relx = 1 - Math.abs(this.minX - absx);
        } else if (absx > this.maxX) {
            relx = this.width + Math.abs(this.maxX - absx)
        } else {
            if (width < 5) {
                relx = 1 + Math.abs(this.minX - absx);
            } else {
                relx = Math.abs(this.minX - absx);
            }
        }
        if (absy < this.minY) {
            rely = this.height + Math.abs(this.minY - absy)
        } else if (absy > this.maxY) {
            rely = 1 - Math.abs(this.maxY - absy);
        } else {
            if (height < 5) {
                rely = 1 + Math.abs(this.maxY - absy);
            } else {
                rely = Math.abs(this.maxY - absy);
            }
        }

        if (relx < 0 || relx >= 5 || rely < 0 || rely >= 5) {
            return undefined;
        }
        return [relx, rely];
    }

    // Takes a relative coordinate from the (potentially) expanded board and returns the absolute equivalent
    public rel2abs(relx: number, rely: number): [number,number] {
        const { width, height } = this.dimensions;
        const absx = this.minX + (width < 5 ? relx-1 : relx);
        const absy = this.maxY - (height < 5 ? rely-1 : rely);
        return [absx, absy];
    }

    public clone(): QuincunxBoard {
        const cloned = new QuincunxBoard();
        this._cards.forEach(d => cloned.add(d));
        return cloned;
    }

    public static deserialize(board: QuincunxBoard): QuincunxBoard {
        const cloned = new QuincunxBoard();
        board._cards.forEach(d => cloned.add(QuincunxCard.deserialize(d)));
        return cloned;
    }

}
