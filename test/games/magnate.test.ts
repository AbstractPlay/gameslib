import "mocha";
import { expect } from "chai";
import { MagnateGame } from '../../src/games';
//import { Multicard } from '../../src/common/decktet';

describe("Magnate", () => {
    const g = new MagnateGame();
    it ("Parses buys", () => {

        expect(g.parseMove("B:8MS,a")).to.deep.equal({
            card: "8MS",
            district: "a",
            incomplete: true,
            type: "B",
            valid: true
        });
        expect(g.parseMove("B:8MS1,a")).to.deep.equal({
            card: "8MS1",
            district: "a",
            incomplete: true,
            type: "B",
            valid: true
        });
        expect(g.parseMove("B:8MS1,a,")).to.deep.equal({
            card: "8MS1",
            district: "a",
            incomplete: true,
            type: "B",
            valid: true
        });
        expect(g.parseMove("B:8MS3,a,M3")).to.deep.equal({
            type: "B",
            valid: false
        });
        expect(g.parseMove("B:8MS,a,M3")).to.deep.equal({
            card: "8MS",
            district: "a",
            incomplete: false,
            spend: [3,0,0,0,0,0],
            type: "B",
            valid: true
        });
        expect(g.parseMove("B:8MS,a,M,M,M")).to.deep.equal({
            card: "8MS",
            district: "a",
            incomplete: false,
            spend: [3,0,0,0,0,0],
            type: "B",
            valid: true
        });
        expect(g.parseMove("B:8MS1,a,M3")).to.deep.equal({
            card: "8MS1",
            district: "a",
            incomplete: false,
            spend: [3,0,0,0,0,0],
            type: "B",
            valid: true
        });
        expect(g.parseMove("B:8MS1,a,M3,")).to.deep.equal({
            card: "8MS1",
            district: "a",
            type: "B",
            valid: false
        });
        expect(g.parseMove("B:1L1,a,M3,S5")).to.deep.equal({
            card: "1L1",
            district: "a",
            incomplete: false,
            spend: [3,5,0,0,0,0],
            type: "B",
            valid: true
        });
        expect(g.parseMove("BB:1L1,a,M3,S5")).to.deep.equal({
            type: "E",
            valid: false
        });

    });
    it ("Parses deeds", () => {

        expect(g.parseMove("D:TMLY")).to.deep.equal({
            card: "TMLY",
            incomplete: true,
            type: "D",
            valid: true
        });
        expect(g.parseMove("D:TMLY1")).to.deep.equal({
            card: "TMLY1",
            incomplete: true,
            type: "D",
            valid: true
        });
        expect(g.parseMove("D:TMLY2,h")).to.deep.equal({
            card: "TMLY2",
            district: "h",
            incomplete: false,
            type: "D",
            valid: true
        });
       expect(g.parseMove("D:9MS2,a")).to.deep.equal({
            card: "9MS2",
            district: "a",
            incomplete: false,
            type: "D",
            valid: true
        });
        expect(g.parseMove("D:9MS2,a,")).to.deep.equal({
            card: "9MS2",
            district: "a",
            incomplete: false,
            type: "D",
            valid: true
        });
    });
    it ("Parses sales", () => {

        expect(g.parseMove("S:9MS")).to.deep.equal({
            card: "9MS",
            incomplete: false,
            type: "S",
            valid: true
        });
        expect(g.parseMove("S:9MS2")).to.deep.equal({
            card: "9MS2",
            incomplete: false,
            type: "S",
            valid: true
        });
        expect(g.parseMove("S:9MS2,a")).to.deep.equal({
            card: "9MS2",
            incomplete: false,
            type: "S",
            valid: true
        });
        expect(g.parseMove("S:9MS2,M5,")).to.deep.equal({
            card: "9MS2",
            incomplete: false,
            type: "S",
            valid: true
        });
        expect(g.parseMove("S:M5")).to.deep.equal({
            type: "S",
            valid: false
        });
    });
    it ("Parses adds", () => {

        expect(g.parseMove("A:4MS")).to.deep.equal({
            card: "4MS",
            incomplete: true,
            type: "A",
            valid: true
        });
        expect(g.parseMove("A:4MS2")).to.deep.equal({
            card: "4MS2",
            incomplete: true,
            type: "A",
            valid: true
        });
        expect(g.parseMove("A:4MS2,M5")).to.deep.equal({
            card: "4MS2",
            incomplete: false,
            spend: [5,0,0,0,0,0],
            type: "A",
            valid: true
        });

    });
    it ("Parses trades", () => {

        expect(g.parseMove("T:Y3")).to.deep.equal({
            incomplete: true,
            spend: [0,0,0,0,3,0],
            type: "T",
            valid: true
        });
        expect(g.parseMove("T:Y3,M")).to.deep.equal({
            incomplete: false,
            spend: [0,0,0,0,3,0],
            suit: "M",
            type: "T",
            valid: true
        });
        
    });
    it ("Parses prefers", () => {
        //Note that the parser doesn't validate legal suits.
        expect(g.parseMove("P:4MS2")).to.deep.equal({
            card: "4MS2",
            incomplete: true,
            type: "P",
            valid: true
        });
        expect(g.parseMove("P:4MS,K")).to.deep.equal({
            card: "4MS",
            incomplete: false,
            suit: "K",
            type: "P",
            valid: true
        });
       expect(g.parseMove("P:4MS2,K")).to.deep.equal({
            card: "4MS2",
            incomplete: false,
            suit: "K",
            type: "P",
            valid: true
        });
       expect(g.parseMove("P:4MS2,J")).to.deep.equal({
            card: "4MS2",
            type: "P",
            valid: false
        });

    });
    it ("Parses choices", () => {
        //Note that the parser doesn't validate legal suits.
        expect(g.parseMove("C:4MS2")).to.deep.equal({
            card: "4MS2",
            incomplete: true,
            type: "C",
            valid: true
        });
        expect(g.parseMove("C:4MS,K")).to.deep.equal({
            card: "4MS",
            incomplete: false,
            suit: "K",
            type: "C",
            valid: true
        });
       expect(g.parseMove("C:4MS2,K")).to.deep.equal({
            card: "4MS2",
            incomplete: false,
            suit: "K",
            type: "C",
            valid: true
        });
       expect(g.parseMove("C:4MS2,J")).to.deep.equal({
            card: "4MS2",
            type: "C",
            valid: false
        });

    });
    it ("Unparses all", () => {
        expect(g.pickleMove(g.parseMove("B:1L1,a,M3,S5"))).eq("B:1L1,a,M3,S5");
        expect(g.pickleMove(g.parseMove("B:1L1,a,M,S4,M2,S"))).eq("B:1L1,a,M3,S5");
        
        expect(g.pickleMove(g.parseMove("D:TMLY2,h"))).eq("D:TMLY2,h");

        expect(g.pickleMove(g.parseMove("S:9MS2,M5,"))).eq("S:9MS2");

        expect(g.pickleMove(g.parseMove("A:4MS2,M5"))).eq("A:4MS2,M5");

        expect(g.pickleMove(g.parseMove("T:Y3,M"))).eq("T:Y3,M");

        expect(g.pickleMove(g.parseMove("P:4MS,K"))).eq("P:4MS,K");

        expect(g.pickleMove(g.parseMove("C:4MS2"))).eq("C:4MS2");

    });
    
    it ("Validates single moves", () => {
        // parsing good moves
        const mv = g.randomMove();
        expect(g.validateMove(mv)).to.have.deep.property("valid", true);
        g.move(mv);
    });

    it ("Renders", () => {
        g.render();
        g.move(g.randomMove());
        g.render();
    });

    it ("Plays along a bit", () => {
        const g = new MagnateGame();
        for (let x = 0; x < 25; x++) {  //27
            const mv = g.randomMove();
            g.move(mv);
        }
    });

    it ("Plays mega a bit", () => {
        const g = new MagnateGame(undefined, ["mega","taxtax"]);
        for (let x = 0; x < 25; x++) {  //27
            const mv = g.randomMove();
            g.move(mv);
        }
    });

    it ("Stacks the deck successfully", () => {
        const g = new MagnateGame(undefined, ["mega","stacked","taxtax"]);
        for (let x = 0; x < 30; x++) {
            const mv = g.randomMove();
            //console.log(mv);
            g.move(mv);
        }
    });

});
