import { Component, ranks, suits } from "./Component";
import { Glyph } from "@abstractplay/renderer/src/schemas/schema";

type Params = {
    name: string;
    rank: Component;
    suits: Component[];
    personality?: boolean;
    event?: boolean;
    location?: boolean;
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

    public get uid(): string {
        return [this.rank.uid, ...this.suits.map(s => s.uid)].join("");
    }

    public get plain(): string {
        return [this.rank.name, ...this.suits.map(s => s.name)].join(" ");
    }

    public sharesSuitWith(other: Card): boolean {
        const otherSuits = new Set<string>(...other._suits.map(s => s.uid));
        let hasMatch = false;
        for (const suit of this._suits) {
            if (otherSuits.has(suit.uid)) {
                hasMatch = true;
                break;
            }
        }
        return hasMatch;
    }

    public toGlyph(): [Glyph, ...Glyph[]] {
        const glyph: [Glyph, ...Glyph[]] = [
            {
                name: "piece-square-borderless",
                opacity: 0,
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
        return new Card({name: this.name, rank: this.rank, suits: [...this.suits.map(s => s.clone())], personality: this.personality, location: this.location, event: this.event});
    }

    public static deserialize(card: Card|string): Card|undefined {
        if (typeof card === "string") {
            return [...cardsBasic, ...cardsExtended].find(c => c.uid === card.toUpperCase());
        }
        return new Card({name: card._name, rank: Component.deserialize(card._rank)!, suits: [...card._suits.map(s => Component.deserialize(s)!)], personality: card._personality, location: card._location, event: card._event});
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
