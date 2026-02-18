import { Card, Params } from "./Card";

export class Multicard extends Card {
    private readonly _deck: number|undefined;

    constructor(params: Params, deck: number|undefined) {
        super(params);
        this._deck = deck;
    }

    public get deck(): number|undefined {
        return this._deck;
    }

    public get cuid(): string {
        return super.uid;
    }

    public get uid(): string {
        return this._deck ? `${super.uid}${this._deck}` : super.uid;
    }

    public static deserialize(mcard: string): Multicard|undefined {
        mcard = mcard.trim();
        if (mcard.length < 2 && mcard !== "0")
            return undefined;

        const last = mcard.charAt(mcard.length - 1);
        if (!/\d/.test(last) || mcard === "0")
            return Card.deserialize(mcard) as Multicard;

        const deck = parseInt(last, 10);
        const cardStr = mcard.slice(0, -1);
        
        const cardObj = Card.deserialize(cardStr);
        if (!cardObj)
            return undefined;

        return new Multicard(cardObj, deck);
    }
}
