import { shuffle } from "../shuffle";
import { Card, cardsBasic, cardsExtended } from "./Card";
import { Deck } from "./Deck";
import { Multicard } from "./Multicard";

export class Multideck {
    private _cards: Multicard[];
    private _decks: number;
    private _isSingle: boolean;
    private _singleDeck?: Deck; //Wraps a single deck.

    constructor(cards: Card[], decks: number) {
        if (decks < 1 || decks > 9) {
            throw new Error("Only one to nine decktet decks are supported.");
        }
        this._cards = [];
        this._decks = decks;
        this._isSingle = decks === 1;
        if ( this._isSingle )
            this._singleDeck = new Deck(cards);
        else
            for (let d = 1; d <= decks; d++) {
                cards.forEach(c => {
                    this._cards.push(new Multicard(new Card(c), d));
                });
            }
    }

    public get cards(): (Card | Multicard)[] {
        return this._isSingle ? this._singleDeck!.cards as Card[] : this._cards.map(m => new Multicard(new Card(m), m.deck)) as Multicard[]; 
    }

    public get decks(): number {
        return this._isSingle ? 1 : this._decks ;
    }

    public get size(): number {
        return this._isSingle ? this._singleDeck!.size : this._cards.length ;
    }

    public shuffle(): Multideck {
        if (this._isSingle)
            this._singleDeck!.shuffle();
        else
            this._cards = shuffle(this._cards) as Multicard[];
        return this;
    }

    public add(uid: string): Multideck {
        //Add a card by multicard uid.
        if ( this._isSingle ) {
            this._singleDeck!.add(uid);
        } else {
            const found = Multicard.deserialize(uid);
            if (found === undefined) {
                throw new Error(`Could not find a Decktet card with the uid "${uid}" to add.`);
        }
            this._cards.push(found);
            this.shuffle();
        }
        return this;
    }
    
    public addAll(cuid: string): Multideck {
        //Add all copies of a card by base card uid.
        if ( this._isSingle ) {
            this._singleDeck!.add(cuid);
        } else {
            const found = [...cardsBasic, ...cardsExtended].find(c => c.uid === cuid);
            if (found === undefined) {
                throw new Error(`Could not find a Decktet card with the uid "${cuid}" to add all.`);
            }
            for (let d=1; d <= this._decks; d++) {
                this._cards.push(new Multicard(found, d));
            }
            this.shuffle();
        }
        return this;
    }

    public addOne(cuid: string, deck: number): Multideck {
        //Add one copy of a card by base card uid and deck number.
        if ( this._isSingle ) {
            this._singleDeck!.add(cuid);
        } else {
            const found = [...cardsBasic, ...cardsExtended].find(c => c.uid === cuid);
            if (found === undefined) {
                throw new Error(`Could not find a Decktet card with the uid "${cuid}" to add one.`);
            }
            this._cards.push(new Multicard(found, deck));
            this.shuffle();
        }
        return this;
    }
    
    public remove(uid: string): Multideck {
        //Remove a card by multicard uid.
        if ( this._isSingle ) {
            this._singleDeck!.remove(uid);
        } else {
            const idx = this._cards.findIndex(m => m.uid === uid);
            if (idx < 0) {
                throw new Error(`Could not find a card in the deck with the uid "${uid}" to remove.`);
            }
            this._cards.splice(idx, 1);
        }
        return this;
    }

    public removeAll(cuid: string): Multideck {
        //Remove all identical cards by card uid.
        if ( this._isSingle ) {
            this._singleDeck!.remove(cuid);
        } else {
            let idx = this._cards.findIndex(c => c.cuid === cuid);
            while (idx > -1) {
                this._cards.splice(idx, 1);
                idx = this._cards.findIndex(c => c.cuid === cuid);
            }
        }
        return this;
    }

    public removeOne(cuid: string, deck: number): Multideck {
        //Remove one card by base card uid and deck number.
        if ( this._isSingle ) {
            this._singleDeck!.remove(cuid);
        } else {
            const muid = [cuid,deck].join("");
            const idx = this._cards.findIndex(c => c.uid === muid);
            if (idx < 0) {
                throw new Error(`Could not find a card in the deck with the uid "${muid}" to remove one.`);
            }
            this._cards.splice(idx, 1);
        }
        return this;
    }

    public draw(count = 1): (Card | Multicard)[] {
        if ( this._isSingle )
            return this._singleDeck!.draw(count);

        const drawn: Multicard[] = [];
        const limit = Math.min(count, this._cards.length);
        for (let i = 0; i < limit; i++) {
            drawn.push(this._cards.shift()!)
        }
        return drawn;
    }

    public empty(): Multideck {
        if ( this._isSingle )
            this._singleDeck!.empty();
        else
            this._cards = [];
        return this;
    }

    public clone(): Multideck {
        if (this.decks === 1)
            return new Multideck(this._singleDeck!.cards, this.decks);

        const cloned = new Multideck([], this._decks);
        cloned._cards = this._cards.map(m => new Multicard(new Card(m), m.deck));
        return cloned;
    }

    public static deserialize(deck: Multideck): Multideck {
        if ( deck.decks === 1 )
            return new Multideck(deck.cards, 1);

        const des = new Multideck([], deck.decks);
        des._cards = deck._cards.map(m => new Multicard(new Card(m), m.deck));
        return des;
    }

}
