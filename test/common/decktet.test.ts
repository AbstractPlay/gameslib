import "mocha";
import { expect } from "chai";
//import { Card, Deck, cardSortAsc, cardSortDesc, cardsBasic, cardsExtended } from "../../src/common/decktet";
import { Card, Deck, Multicard, Multideck, cardsBasic, cardsExtended } from "../../src/common/decktet";

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
        const mydeck = new Multideck([...cardsBasic, ...cardsExtended],2);
        expect(mydeck.size).eq(90);
        const card = mydeck.draw(1);
        //console.log(card);
        expect(card.map(c => (c as Multicard).cuid)[0]).eq("1M");
        expect(card.map(c => c.uid)[0]).eq("1M1");
        expect(mydeck.size).eq(89);
        expect(mydeck.draw(1).map(c => c.plain)[0]).eq("Ace Suns");
        expect(mydeck.size).eq(88);
        
        mydeck.shuffle();
        expect(mydeck.size).eq(88);
        expect(mydeck.remove("1K1")).to.have.deep.property("size", 87);
        expect(mydeck.remove("1K2")).to.have.deep.property("size", 86);
        expect(mydeck.removeAll("1Y")).to.have.deep.property("size", 84);
    });
    
    it ("Initializes an empty deck", () => {
        const mydeck = new Deck([]);
        expect(mydeck.size).eq(0);
        mydeck.add("0");
        expect(mydeck.size).eq(1);
      
        const mmdeck = new Multideck([],2);
        expect(mmdeck.size).eq(0);
        mmdeck.add("01");
        expect(mmdeck.size).eq(1);
    });
    
    it ("Doesn't blow up when the deck is out", () => {
        const mydeck = new Multideck([...cardsBasic, ...cardsExtended],3);
        expect(mydeck.size).eq(135);
        mydeck.draw(134);
        expect(mydeck.size).eq(1);
        expect(mydeck.draw(1).map(c => c.plain)[0]).eq("Court Suns Waves Wyrms");
        expect(mydeck.size).eq(0);
        const [card] = mydeck.draw(1);
        expect(card).eq(undefined);
        
    });
    
    it ("Deserializes", () => {
        expect(Card.deserialize("0")).to.have.deep.property("name", "The Excuse");
        expect(Multicard.deserialize("01")).to.have.deep.property("_deck", 1);
         expect(Multicard.deserialize("3LY1")).to.have.deep.property("_name", "The Savage");
        expect(Multicard.deserialize("PSVK5")).to.have.deep.property("_deck", 5);
    });
    
    it ("Handles a degenerate case in any deck size", () => {
        const mydeck = new Deck([...cardsBasic, ...cardsExtended]);
        mydeck.draw(4);
        const [mycard] = mydeck.draw(1);
        expect(mycard.sharesSuitWith(mycard)).eq(true);

        const myDeckCount = Math.ceil(Math.random() * 8) + 1;
        const mymultideck = new Multideck([...cardsBasic, ...cardsExtended], myDeckCount);
        expect(mymultideck.size).eq(45 * myDeckCount);
        mymultideck.draw(4);
        const [mymulticard] = mymultideck.draw(1);
        expect(mymulticard.sharesSuitWith(mymulticard)).eq(true);
    });

    it ("Implements other deck methods", () => {
        const mydeck = new Deck([...cardsBasic, ...cardsExtended]);
        
        expect(mydeck.cards.length).eq(45);
        expect(mydeck.empty.length).eq(0);
        
        const myotherdeck = new Deck([...cardsBasic]);
        expect(myotherdeck.cards.length).eq(36);
        expect(myotherdeck.empty.length).eq(0);
        myotherdeck.add("0");
        expect(myotherdeck.cards.length).eq(37);
        
    });
    
    it ("Implements other multideck methods", () => {
        const mydeck = new Multideck([...cardsBasic, ...cardsExtended], 2);
        
        expect(mydeck.cards.length).eq(90);
        expect(mydeck.empty.length).eq(0);
        
        const myotherdeck = new Multideck([...cardsBasic],2);
        expect(myotherdeck.cards.length).eq(72);
        expect(myotherdeck.empty.length).eq(0);

        myotherdeck.add("01");
        expect(myotherdeck.cards.length).eq(73);
        myotherdeck.remove("01");
        expect(myotherdeck.cards.length).eq(72);

        myotherdeck.addOne("PVLY", 1);
        expect(myotherdeck.cards.length).eq(73);
        myotherdeck.removeOne("PVLY", 1);
        expect(myotherdeck.cards.length).eq(72);

        myotherdeck.addAll("PSVK");
        expect(myotherdeck.cards.length).eq(74);
        myotherdeck.removeAll("PSVK");
        expect(myotherdeck.cards.length).eq(72);
        
    });
});
