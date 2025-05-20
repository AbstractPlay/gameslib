import { Card } from "../../common/decktet";

export class QuincunxCard {
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

    public clone(): QuincunxCard {
        return new QuincunxCard({x: this.x, y: this.y, card: this.card});
    }

    public static deserialize(card: QuincunxCard): QuincunxCard {
        return new QuincunxCard({x: card._x, y: card._y, card: Card.deserialize(card._card)!});
    }
}
