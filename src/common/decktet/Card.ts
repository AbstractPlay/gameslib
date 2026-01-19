import { Component, ranks, suits } from "./Component";
import { Colourfuncs, Glyph } from "@abstractplay/renderer/src/schemas/schema";

type Params = {
    name: string;
    rank: Component;
    suits: Component[];
    personality?: boolean;
    event?: boolean;
    location?: boolean;
    deck?: number;
};

export const cardSortAsc = (a: Card, b: Card): number => {
    if (a.rank.seq === b.rank.seq) {
        if (a.suits.length === b.suits.length) {
            for (let i = 0; i < a.suits.length; i++) {
                if (a.suits[i].seq !== b.suits[i].seq) {
                    return a.suits[i].seq - b.suits[i].seq;
                }
            }
            return 0;
        } else {
            return a.suits.length - b.suits.length;
        }
    } else {
        return a.rank.seq - b.rank.seq;
    }
}

export const cardSortDesc = (a: Card, b: Card): number => {
    if (a.rank.seq === b.rank.seq) {
        if (a.suits.length === b.suits.length) {
            for (let i = 0; i < a.suits.length; i++) {
                if (a.suits[i].seq !== b.suits[i].seq) {
                    return b.suits[i].seq - a.suits[i].seq;
                }
            }
            return 0;
        } else {
            return b.suits.length - a.suits.length;
        }
    } else {
        return b.rank.seq - a.rank.seq;
    }
}

export class Card {
    private readonly _name: string;
    private readonly _rank: Component;
    private readonly _suits: Component[];
    private readonly _personality: boolean = false;
    private readonly _event: boolean = false;
    private readonly _location: boolean = false;
    private readonly _deck: number = 0;
    private _plain: string|undefined;

    constructor(params: Params) {
        this._name = params.name;
        this._rank = params.rank;
        this._suits = [...params.suits];
        if (params.personality !== undefined) {
            this._personality = params.personality;
        }
        if (params.event !== undefined) {
            this._event = params.event;
        }
        if (params.location !== undefined) {
            this._location = params.location;
        }
        if (params.deck !== undefined) {
            this._deck = params.deck;
        }
    }

    public get name(): string {
        return this._name;
    }
    public get rank(): Component {
        return new Component(this._rank);
    }
    public get suits(): Component[] {
        return [...this._suits.map(s => new Component(s))];
    }
    public get personality(): boolean {
        return this._personality;
    }
    public get event(): boolean {
        return this._event;
    }
    public get location(): boolean {
        return this._location;
    }
    public get deck(): number {
        return this._deck;
    }

    public get uid(): string {
        return [this.rank.uid, ...this.suits.map(s => s.uid), (this._deck > 0 ? this._deck : "")].join("");
    }

    public setPlain(plain: string|undefined): Card {
        this._plain = plain;
        return this;
    }

    public get plain(): string {
        if (this._plain !== undefined) {
            return this._plain;
        }
        return [this.rank.name, ...this.suits.map(s => s.name)].join(" ");
    }

    public sharesSuitWith(other: Card): boolean {
        const otherSuits = new Set<string>(other.suits.map(s => s.uid));
        let hasMatch = false;
        for (const suit of this.suits) {
            if (otherSuits.has(suit.uid)) {
                hasMatch = true;
                break;
            }
        }
        return hasMatch;
    }

    public toGlyph(opts: {border?: boolean; fill?: string|number|Colourfuncs, opacity?: number} = {}): [Glyph, ...Glyph[]] {
        let border = false;
        if (opts !== undefined && opts.border !== undefined) {
            border = opts.border;
        }
        let opacity = 0;
        if (opts !== undefined && opts.opacity !== undefined) {
            opacity = opts.opacity;
        }
        let fill: string|number|Colourfuncs|undefined;
        if (opts !== undefined && opts.fill !== undefined) {
            fill = opts.fill;
        }
        const glyph: [Glyph, ...Glyph[]] = [
            {
                name: border ? "piece-square" : "piece-square-borderless",
                scale: border? 1.1 : 1,
                colour: fill,
                opacity: opacity === undefined ? 0 : opacity,
            },
        ];
        // rank
        if (this.rank.glyph !== undefined) {
            glyph.push({
                name: this.rank.glyph,
                scale: 0.5,
                colour: "_context_strokes",
                nudge: {
                    dx: 250,
                    dy: -250,
                }
            });
        }
        const nudges: [number,number][] = [[-250, -250], [-250, 250], [250, 250]];
        for (let i = 0; i < this.suits.length; i++) {
            const suit = this.suits[i];
            const nudge = nudges[i];
            glyph.push({
                name: suit.glyph,
                scale: 0.5,
                nudge: {
                    dx: nudge[0],
                    dy: nudge[1],
                }
            });
        }
        return glyph;
    }

    public clone(): Card {
        return new Card({name: this.name, rank: this.rank, suits: [...this.suits.map(s => s.clone())], personality: this.personality, location: this.location, event: this.event, deck: this.deck});
    }

    public cloneForDeck(deck: number): Card {
        return new Card({name: this.name, rank: this.rank, suits: [...this.suits.map(s => s.clone())], personality: this.personality, location: this.location, event: this.event, deck: deck});
    }

    public static deserialize(card: Card|string, allowCustom = false): Card|undefined {
        if (typeof card === "string") {
            const found = [...cardsBasic, ...cardsExtended].find(c => c.uid === card.toUpperCase());
            if (allowCustom && found === undefined) {
                let [strRank, ...strSuits] = card.split("");
                let strDeck: number = 0;
                if (card.length > 1 && card.charAt(card.length - 1).match(/\d/)) {
                    strDeck = parseInt(card.charAt(card.length - 1),10);
                    [strRank, ...strSuits] = card.substring(0,card.length - 2).split("");
                }
                const rank = Component.deserialize(strRank);
                const suits = strSuits.map(s => Component.deserialize(s));
                if (rank === undefined || suits.includes(undefined)) {
                    return undefined;
                }
                return new Card({name: "_custom", rank, suits: (suits as Component[]).sort((a,b) => a.seq - b.seq), deck: strDeck});
            }
            return found;
        }
        return new Card({name: card._name, rank: Component.deserialize(card._rank)!, suits: [...card._suits.map(s => Component.deserialize(s)!)], personality: card._personality, location: card._location, event: card._event, deck: card._deck});
    }
}

const [moons, suns, waves, leaves, wyrms, knots] = suits;
const [zero, one, two, three, four, five, six, seven, eight, nine, pawn, court, crown] = ranks;

export const cardsBasic: Card[] = [
    new Card({name: "Ace of Moons", rank: one, suits: [moons]}),
    new Card({name: "Ace of Suns", rank: one, suits: [suns]}),
    new Card({name: "Ace of Waves", rank: one, suits: [waves]}),
    new Card({name: "Ace of Leaves", rank: one, suits: [leaves]}),
    new Card({name: "Ace of Wyrms", rank: one, suits: [wyrms]}),
    new Card({name: "Ace of Knots", rank: one, suits: [knots]}),
    new Card({name: "The Author", rank: two, suits: [moons, knots], personality: true}),
    new Card({name: "The Desert", rank: two, suits: [suns, wyrms], location: true}),
    new Card({name: "The Origin", rank: two, suits: [waves, leaves], event: true, location: true}),
    new Card({name: "The Painter", rank: three, suits: [suns, knots], personality: true}),
    new Card({name: "The Savage", rank: three, suits: [leaves, wyrms], personality: true}),
    new Card({name: "The Journey", rank: three, suits: [moons, waves], event: true}),
    new Card({name: "The Battle", rank: four, suits: [wyrms, knots], event: true}),
    new Card({name: "The Sailor", rank: four, suits: [waves, leaves], personality: true}),
    new Card({name: "The Mountain", rank: four, suits: [moons, suns], location: true}),
    new Card({name: "The Discovery", rank: five, suits: [suns, waves], event: true}),
    new Card({name: "The Soldier", rank: five, suits: [wyrms, knots], personality: true}),
    new Card({name: "The Forest", rank: five, suits: [moons, leaves], location: true}),
    new Card({name: "The Penitent", rank: six, suits: [suns, wyrms], personality: true}),
    new Card({name: "The Lunatic", rank: six, suits: [moons, waves], personality: true}),
    new Card({name: "The Market", rank: six, suits: [leaves, knots], event: true, location: true}),
    new Card({name: "The Castle", rank: seven, suits: [suns, knots], location: true}),
    new Card({name: "The Chance Meeting", rank: seven, suits: [moons, leaves], event: true}),
    new Card({name: "The Cave", rank: seven, suits: [waves, wyrms], location: true}),
    new Card({name: "The Betrayal", rank: eight, suits: [wyrms, knots], event: true}),
    new Card({name: "The Diplomat", rank: eight, suits: [moons, suns], personality: true}),
    new Card({name: "The Mill", rank: eight, suits: [waves, leaves], location: true}),
    new Card({name: "The Pact", rank: nine, suits: [moons, suns], event: true}),
    new Card({name: "The Merchant", rank: nine, suits: [leaves, knots], personality: true}),
    new Card({name: "The Darkness", rank: nine, suits: [waves, wyrms], location: true}),
    new Card({name: "The Huntress", rank: crown, suits: [moons], personality: true}),
    new Card({name: "The Bard", rank: crown, suits: [suns], personality: true}),
    new Card({name: "The Sea", rank: crown, suits: [waves], location: true}),
    new Card({name: "The End", rank: crown, suits: [leaves], event: true, location: true}),
    new Card({name: "The Calamity", rank: crown, suits: [wyrms], event: true}),
    new Card({name: "The Windfall", rank: crown, suits: [knots], event: true}),
];

export const cardsExtended: Card[] = [
    new Card({name: "The Excuse", rank: zero, suits: []}),
    new Card({name: "The Watchman", rank: pawn, suits: [moons, wyrms, knots], personality: true}),
    new Card({name: "The Borderland", rank: pawn, suits: [waves, leaves, wyrms], location: true}),
    new Card({name: "The Harvest", rank: pawn, suits: [moons, suns, leaves], event: true}),
    new Card({name: "The Light Keeper", rank: pawn, suits: [suns, waves, knots], personality: true}),
    new Card({name: "The Consul", rank: court, suits: [moons, waves, knots], personality: true}),
    new Card({name: "The Rite", rank: court, suits: [moons, leaves, wyrms], event: true}),
    new Card({name: "The Window", rank: court, suits: [suns, leaves, knots], location: true}),
    new Card({name: "The Island", rank: court, suits: [suns, waves, wyrms], location: true}),
];
