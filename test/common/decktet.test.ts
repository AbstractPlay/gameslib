/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
//import { Card, Deck, cardSortAsc, cardSortDesc, cardsBasic, cardsExtended } from "../../src/common/decktet";
import { Deck, cardsBasic, cardsExtended } from "../../src/common/decktet";

describe("Decktets", () => {
    it ("Still makes a single decktet", () => {
        const mydeck = new Deck([...cardsBasic, ...cardsExtended]);
        expect(mydeck.size).eq(45);
        const card = mydeck.draw(1).map(c => c.uid)[0];
        expect(card).eq("1M");
        expect(mydeck.size).eq(44);

        mydeck.shuffle();
        expect(mydeck.size).eq(44);
        expect(mydeck.remove("1K")).to.have.deep.property("size", 43);
    });
    
    it ("Now makes a double decktet", () => {
        const mydeck = new Deck([...cardsBasic, ...cardsExtended],2);
        expect(mydeck.size).eq(90);
        expect(mydeck.draw(1).map(c => c.uid)[0]).eq("1M1");
        expect(mydeck.size).eq(89);
        expect(mydeck.draw(1).map(c => c.plain)[0]).eq("Ace Suns");
        expect(mydeck.size).eq(88);
        
        mydeck.shuffle();
        expect(mydeck.size).eq(88);
        expect(mydeck.remove("1K1")).to.have.deep.property("size", 87);
        expect(mydeck.remove("1K2")).to.have.deep.property("size", 86);
        expect(mydeck.removeAll("1Y")).to.have.deep.property("size", 84);

    });
    
    it ("Doesn't blow up when the deck is out", () => {
        const mydeck = new Deck([...cardsBasic, ...cardsExtended],3);
        expect(mydeck.size).eq(135);
        mydeck.draw(134);
        expect(mydeck.size).eq(1);
        expect(mydeck.draw(1).map(c => c.plain)[0]).eq("Court Suns Waves Wyrms");
        expect(mydeck.size).eq(0);
        const [card] = mydeck.draw(1);
        expect(card).eq(undefined);
        
    });
});
