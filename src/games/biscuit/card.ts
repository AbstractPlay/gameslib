import { Card } from "../../common/decktet";

export class BiscuitCard {
    private readonly _x: number;
    private readonly _y: number;
    private readonly _card: Card;

    constructor(opts: {x: number, y: number, card: Card}) {
        this._x = opts.x;
        this._y = opts.y;
        this._card = opts.card;
    }

    public get uid(): string {
        return [this.card.uid, this.x, this.y].join(",");
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

    public get card(): Card {
        return this._card;
    }

    public clone(): BiscuitCard {
        return new BiscuitCard({x: this.x, y: this.y, card: this.card});
    }

    public static deserialize(card: BiscuitCard): BiscuitCard {
        return new BiscuitCard({x: card._x, y: card._y, card: Card.deserialize(card._card)!});
    }
}
