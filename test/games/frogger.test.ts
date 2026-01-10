/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { FroggerGame } from '../../src/games';

describe("Frogger", () => {
    const g = new FroggerGame(2);
    it ("Parses single moves", () => {
        // parsing good moves
        expect(g.parseMove("8MS:a3-b3")).to.deep.equal({
            card: "8MS",
            forward: true,
            from: "a3",
            incomplete: false,
            to: "b3",
            refill: false,
            valid: true
        });
        expect(g.parseMove("c2-b3,8MS")).to.deep.equal({
            card: "8MS",
            forward: false,
            from: "c2",
            incomplete: false,
            to: "b3",
            refill: false,
            valid: true
        });
        expect(g.parseMove("c2-b3,1M!")).to.deep.equal({
            card: "1M",
            forward: false,
            from: "c2",
            incomplete: false,
            to: "b3",
            refill: true,
            valid: true
        });
        expect(g.parseMove("c2")).to.deep.equal({
            forward: false,
            from: "c2",
            incomplete: true,
            refill: false,
            valid: true
        });
        expect(g.parseMove("8MS")).to.deep.equal({
            card: "8MS",
            forward: false,
            incomplete: false,
            refill: false,
            valid: true
        });
    });

    it ("Does character validation on parse", () => {
        const g = new FroggerGame(2);
        expect(g.parseMove("7MSaaa:c5")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS:n5-n6!")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS:n5-o4")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS:b5-cc4!")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS:b55-c4")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MSPQRS:b5-c4!")).to.have.deep.property("valid", false);
        expect(g.parseMove("M7SLST")).to.have.deep.property("valid", false);
        expect(g.parseMove("d2-e2,7MSPQRS")).to.have.deep.property("valid", false);
    });

    it ("Does structural validation on parse", () => {
        const g = new FroggerGame(2);
        expect(g.parseMove("7MS:m5-m6,6MS!")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS,m5-m6,6MS!")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS:m5-m6:6MS")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS;m5*m6")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS;m5-n6")).to.have.deep.property("valid", false);
        expect(g.parseMove("7MS-m5")).to.have.deep.property("valid", false);
        expect(g.parseMove("c2-,1M!")).to.have.deep.property("valid", false);
        expect(g.parseMove("c2,1M!")).to.have.deep.property("valid", false);
        expect(g.parseMove("c2-d2-e2")).to.have.deep.property("valid", false);
    });

    it ("Does character validation on validate", () => {
        const g = new FroggerGame(2);
        expect(g.validateMove("7MSaaa:c5")).to.have.deep.property("valid", false);
        expect(g.validateMove("7MS:n5-n6!")).to.have.deep.property("valid", false);
        expect(g.validateMove("7MS:n5-o4")).to.have.deep.property("valid", false);
        expect(g.validateMove("7MS:b5-cc4!")).to.have.deep.property("valid", false);
        expect(g.validateMove("7MS:b55-c4")).to.have.deep.property("valid", false);
        expect(g.validateMove("7MSPQRS:b5-c4!")).to.have.deep.property("valid", false);
        expect(g.validateMove("M7SLST")).to.have.deep.property("valid", false);
        expect(g.validateMove("d2-e2,7MSPQRS")).to.have.deep.property("valid", false);
    });

    it ("Does structural validation on validate", () => {
        const g = new FroggerGame(2);
        expect(g.validateMove("8MS:m2-n3,9MS!")).to.have.deep.property("valid", false);
        expect(g.validateMove("8MS,m2-n3,9MS!")).to.have.deep.property("valid", false);
        expect(g.validateMove("8MS:m2-n3:9MS")).to.have.deep.property("valid", false);
        expect(g.validateMove("8MS;m2*n3")).to.have.deep.property("valid", false);
        expect(g.validateMove("8MS;m2-n3")).to.have.deep.property("valid", false);
        expect(g.validateMove("8MS-m5")).to.have.deep.property("valid", false);
        expect(g.validateMove("c2-,1M!")).to.have.deep.property("valid", false);
        expect(g.validateMove("c2,1M!")).to.have.deep.property("valid", false);
        expect(g.validateMove("c2-d2-e2")).to.have.deep.property("valid", false);
    });

    it ("Does semantic validation on validate", () => {
        const g = new FroggerGame(2);
        //This is only semantic in that non-existent cards won't be in anyone's hand.
        expect(g.validateMove("7MS:b2-c3")).to.have.deep.property("valid", false);
        //Non-existent cards also won't be in the market.
        expect(g.validateMove("d2-c3,9MV")).to.have.deep.property("valid", false);
        //Set up a 2p base game, so cells a4-n4 are disallowed.
        expect(g.validateMove("8MS:f2-g4")).to.have.deep.property("valid", false);
        //Cells a5-n5 are off the board.
        expect(g.validateMove("8MS:f2-g5")).to.have.deep.property("valid", false);
        /*      //Structural issue with a refill request (default refill variant on).
                expect(g.validateMove("f2-e3,1M!//")).to.have.deep.property("valid", false);
                //Structural issue with a refill request (default refill variant on).
                expect(g.validateMove("f2-e3,1M!/e3-b1,2MK")).to.have.deep.property("valid", false);
                //Structural issue with a refill request (default refill variant on).
                expect(g.validateMove("f2-e3,1M!")).to.have.deep.property("valid", false);*/
    });

    it ("Handles multi-part moves", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-27T20:25:46.174Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PVLY"],["c4","4YK"],["d4","2MK"],["e4","9VY"],["f4","7VY"],["g4","PMYK"],["h4","5YK"],["i4","6MV"],["j4","PSVK"],["k4","PMSL"],["l4","NV"],["m4","1L"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["4VL","2SY","1Y","8YK"],["NY","6SY","1K","5ML"]],"hands":[[],[]],"market":["6LK","3MV","1S","1V","7SK","9LK"],"discards":[],"nummoves":3}]}`);

        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-a3,7MK/")).to.have.deep.property("valid", false);  //Not a real card.
        expect(g.validateMove("8YK:a3-c2/c2-d2,1S/b2-a3,7SK/")).to.have.deep.property("valid", false);  //Wrong direction.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S!/b2-a3,7SK/")).to.have.deep.property("valid", false); //Can't refill.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-a3,7SK/")).to.have.deep.property("valid", true);   //A legal sequence.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-a3,7SK/")).to.have.deep.property("complete", 1);   //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-a3,7SK")).to.have.deep.property("complete", 1);   //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-a3")).to.have.deep.property("complete", 0);        //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-")).to.have.deep.property("complete", -1);         //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/")).to.have.deep.property("complete", 0);              //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S")).to.have.deep.property("complete", 0);              //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-b2")).to.have.deep.property("complete", 0);     //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/c2-")).to.have.deep.property("complete", -1);      //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2/")).to.have.deep.property("complete", 0);           //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-c2")).to.have.deep.property("complete", 0);           //A legal sequence, for completeness.
        expect(g.validateMove("8YK:a3-")).to.have.deep.property("complete", -1);            //A legal sequence, for completeness.
        expect(g.validateMove("8YK:")).to.have.deep.property("complete", -1);               //A legal sequence, for completeness.
        g.move("8YK:a3-c2/c2-b2,1S/b2-a3,7SK/");
        expect(g.validateMove("8YK:a3-c2/c2-b2,1S/b2-a3,7SK/")).to.have.deep.property("valid", false);  //No longer legal.

        expect(g.validateMove("6SY:a2-j3/1K:j3-n2!/")).to.have.deep.property("valid", false); //Can't refill.
        expect(g.validateMove("6SY:a2-j3/1K:j3-n1/")).to.have.deep.property("valid", false);  //Other player's home invasion.
        expect(g.validateMove("6SY:a2-j3/1K:j3-p2/")).to.have.deep.property("valid", false);  //Off the board.
        expect(g.validateMove("6SY:a2-j3/1K:j3-n0/")).to.have.deep.property("valid", false);  //Offsides.
        expect(g.validateMove("6SY:a2-j3/1K:j3-n2/")).to.have.deep.property("valid", true);   //A legal sequence.
        g.move("6SY:a2-j3/1K:j3-n2/");
        expect(g.validateMove("6SY:a2-j3/1K:j3-n2/")).to.have.deep.property("valid", false);  //No longer legal.

        expect(g.validateMove("2SY:a3-j3/NY:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", false);  //Steal other player's card.
        expect(g.validateMove("2SY:a3-j3/4VL:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", false); //Use own wrong card.
        expect(g.validateMove("2SY:a3-j3/2SY:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", false); //Steal own discard.
        expect(g.validateMove("2SY:a3-j3/6SY:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", false); //Steal other discard.
        expect(g.validateMove("2SY:a3-j3/3VY:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", false); //Steal deck card.
        expect(g.validateMove("2SY:a3-j3/1Y:j3-n3/3SK:a3-j3/")).to.have.deep.property("valid", false); //Steal another deck card.
        expect(g.validateMove("2SY:a3-j3/1Y:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", true);   //A legal sequence.
        g.move("2SY:a3-j3/1Y:j3-n3/1S:a3-j3/");
        expect(g.validateMove("2SY:a3-j3/1Y:j3-n3/1S:a3-j3/")).to.have.deep.property("valid", false);  //No longer legal.
    });

    it ("Handles the blocked position", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-27T20:25:46.174Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PVLY"],["c4","4YK"],["d4","2MK"],["e4","9VY"],["f4","7VY"],["g4","PMYK"],["h4","5YK"],["i4","6MV"],["j4","PSVK"],["k4","PMSL"],["l4","NV"],["m4","1L"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["4VL","2SY","1Y","8YK"],["NY","6SY","1K","5ML"]],"hands":[[],[]],"market":["6LK","3MV","1S","1V","7SK","9LK"],"discards":[],"nummoves":3}]}`);
        g.move("8YK:a3-c2/c2-b2,1S/b2-a3,7SK/");
        g.move("6SY:a2-j3/1K:j3-n2/");
        g.move("2SY:a3-j3/1Y:j3-n3/1S:a3-j3/");
        
        //Some setup to block player 1.
        expect(g.validateMove("5ML:a2-d3")).to.have.deep.property("valid", true);   //A legal sequence.
        g.move("5ML:a2-d3");
        expect(g.validateMove("4VL:j3-k1/7SK:k1-n3/")).to.have.deep.property("valid", true);   //A legal sequence.
        g.move("4VL:j3-k1/7SK:k1-n3/");
        expect(g.validateMove("NY:a2-b1")).to.have.deep.property("valid", true);   //A legal sequence.
        g.move("NY:a2-b1");

        expect(g.validateMove("a1")).to.have.deep.property("valid", false);    //Partial frog start.
        expect(g.validateMove("a1-e1")).to.have.deep.property("valid", false); //Bad frog forward.
        expect(g.validateMove("e1-a1")).to.have.deep.property("valid", false); //Bad frog back.
        expect(g.validateMove("n1")).to.have.deep.property("valid", false);    //Partial home frog start.
        expect(g.validateMove("n1-m1")).to.have.deep.property("valid", false); //No return from home.
        
        expect(g.validateMove("NY//")).to.have.deep.property("valid", false);  //Steal other player's card.
        expect(g.validateMove("4VL//")).to.have.deep.property("valid", false); //Use own wrong card.
        expect(g.validateMove("2SY//")).to.have.deep.property("valid", false); //Steal own discard.
        expect(g.validateMove("6SY//")).to.have.deep.property("valid", false); //Steal other discard.
        expect(g.validateMove("3LY//")).to.have.deep.property("valid", false); //Steal deck card.
        expect(g.validateMove("6LY//")).to.have.deep.property("valid", false); //Invent a card.
        
        expect(g.validateMove("1V//")).to.have.deep.property("valid", true);   //A legal sequence (market card).
        expect(g.validateMove("1V/")).to.have.deep.property("valid", true);    //A legal sequence (market card).
        expect(g.validateMove("1V")).to.have.deep.property("valid", true);     //A legal sequence (market card).
        expect(g.validateMove("1V//")).to.have.deep.property("complete", 1);   //A legal sequence (market card).
        expect(g.validateMove("1V/")).to.have.deep.property("complete", 1);    //A legal sequence (market card).
        expect(g.validateMove("1V")).to.have.deep.property("complete", 1);     //A legal sequence (market card).
        g.move("1V");

        expect(g.validateMove("3MV//")).to.have.deep.property("valid", false); //Player 2 isn't blocked.
        
    }); 
    
    it ("Enacts a double bounce", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-27T20:25:46.174Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PVLY"],["c4","4YK"],["d4","2MK"],["e4","9VY"],["f4","7VY"],["g4","PMYK"],["h4","5YK"],["i4","6MV"],["j4","PSVK"],["k4","PMSL"],["l4","NV"],["m4","1L"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["4VL","2SY","1Y","8YK"],["NY","6SY","1K","5ML"]],"hands":[[],[]],"market":["6LK","3MV","1S","1V","7SK","9LK"],"discards":[],"nummoves":3}]}`);
        g.move("8YK:a3-c2/c2-b2,1S/b2-a3,7SK/");
        g.move("6SY:a2-j3/1K:j3-n2/");
        g.move("2SY:a3-j3/1Y:j3-n3/1S:a3-j3/");
        g.move("5ML:a2-d3");
        g.move("4VL:j3-k1/7SK:k1-n3/");
        g.move("NY:a2-b1");
        g.move("1V");
        
        //set up the bounce
        expect(g.validateMove("d3-c3,3MV/c3-b2")).to.have.deep.property("valid", true);
        g.move("d3-c3,3MV/c3-b2");

        //Check 
        expect(g.board.get("a2")).to.equal("X2-3");
        expect(g.validateMove("1V:a3-b3/")).to.have.deep.property("valid", true); //The bouncing move.
        g.move("1V:a3-b3/");
        expect(g.board.get("a2")).to.equal("X2-5");
    });
    
    it ("Implements crocodiles and continuous market variants", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["crocodiles","continuous"],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-28T02:33:17.187Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PMSL"],["b3","X0"],["c4","PSVK"],["c3","X0"],["d4","NV"],["e4","PVLY"],["e3","X0"],["f4","9VY"],["g4","8MS"],["h4","PMYK"],["h3","X0"],["i4","NL"],["j4","1Y"],["k4","2MK"],["l4","2VL"],["m4","8VL"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["1M","7SK","1L","1K"],["5SV","4MS","3MV","9LK"]],"hands":[[],[]],"market":["6SY","6LK","4VL"],"discards":[],"nummoves":3}]}`);
        expect(g.board.get("b3")).to.equal("X0");
        expect(g.board.get("c3")).to.equal("X0");
        expect(g.board.get("e3")).to.equal("X0");
        expect(g.board.get("h3")).to.equal("X0");
        expect(g.market.length).to.equal(3);

        expect(g.validateMove("1M:a3-g3/g3-f3,6LK/6LK:f3-i3/")).to.have.deep.property("valid", true); //A legal sequence.
        g.move("1M:a3-g3/g3-f3,6LK/6LK:f3-i3/");
        expect(g.board.get("b3")).to.equal("X0"); //Crocodiles haven't moved.
        expect(g.market.length).to.equal(3);

        expect(g.board.get("a2")).to.equal("X2-6");
        expect(g.validateMove("5SV:a2-c2!/")).to.have.deep.property("valid", false); //No manual refills allowed.
        expect(g.validateMove("5SV:a2-c2/")).to.have.deep.property("valid", true);   //About to get chomped.
        g.move("5SV:a2-c2/");
        //expect(g.board.get("a2")).to.equal("X2-5");  //The move happens, but too fast to test before chomping.
        expect(g.board.get("b2")).to.equal("X0"); //Crocodiles have moved.  End of round 1.
        expect(g.board.get("c2")).to.equal("X0");
        expect(g.board.get("e2")).to.equal("X0");
        expect(g.board.get("h2")).to.equal("X0");
        expect(g.board.get("a2")).to.equal("X2-6");  //Chomped frog is back where we started.
        expect(g.market.length).to.equal(3);

        //Cycle croc and possibly market using random moves.
        g.move(g.randomMove());
        expect(g.board.get("c2")).to.equal("X0"); //Crocodiles haven't moved.
        expect(g.market.length).to.equal(3);

        g.move(g.randomMove());
        expect(g.board.get("c1")).to.equal("X0"); //Crocodiles have moved.   End of round 2.
        expect(g.market.length).to.equal(3);
        
        //Cycle crocs to top and possibly market using random moves.
        g.move(g.randomMove());
        expect(g.board.get("e1")).to.equal("X0"); //Crocodiles haven't moved.
        expect(g.market.length).to.equal(3);

        g.move(g.randomMove());
        expect(g.board.get("e3")).to.equal("X0"); //Crocodiles have moved.   End of round 3.
        expect(g.market.length).to.equal(3);
        
        //One more cycle of crocs and possibly market using random moves.  
        g.move(g.randomMove());
        expect(g.board.get("h3")).to.equal("X0"); //Crocodiles haven't moved.
        expect(g.market.length).to.equal(3);

        g.move(g.randomMove());
        expect(g.board.get("h2")).to.equal("X0"); //Crocodiles have moved.   End of round 4.
        expect(g.market.length).to.equal(3);

    });

    it ("Implements basic suit movement rules", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["courts","#market"],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-29T03:38:17.329Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","7VY"],["c4","PVLY"],["d4","PMSL"],["e4","2MK"],["f4","3LY"],["g4","PMYK"],["h4","5ML"],["i4","8YK"],["j4","NY"],["k4","PSVK"],["l4","1L"],["m4","6MV"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["TSLK","NM","9LK","TMLY"],["9MS","7SK","1K","2VL"]],"hands":[[],[]],"market":["NS","3SK","TMVK","5YK","TSVY","NV"],"discards":[],"nummoves":3}]}`);

        //Can move to first occurrence of only suit.
        expect(g.validateMove("NM:a3-d3")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of only suit.
        expect(g.validateMove("NM:a3-e3")).to.have.deep.property("valid", false);

        //Can move to first occurrence of first suit.
        expect(g.validateMove("9LK:a3-c2")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of first suit.
        expect(g.validateMove("9LK:a3-d1")).to.have.deep.property("valid", false);
        //Can move to first occurrence of second suit.
        expect(g.validateMove("9LK:a3-e2")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of second suit.
        expect(g.validateMove("9LK:a3-i2")).to.have.deep.property("valid", false);

        //Can move to first occurrence of first suit.
        expect(g.validateMove("TSLK:a3-d2")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of first suit.
        expect(g.validateMove("TSLK:a3-k3")).to.have.deep.property("valid", false);
        //Can move to first occurrence of second suit.
        expect(g.validateMove("TSLK:a3-c2")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of second suit.
        expect(g.validateMove("TSLK:a3-d1")).to.have.deep.property("valid", false);
        //Can move to first occurrence of third suit.
        expect(g.validateMove("TSLK:a3-e2")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of third suit.
        expect(g.validateMove("TSLK:a3-k1")).to.have.deep.property("valid", false);

    });

    it ("Implements advanced suit movement rules", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["advanced","courts"],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-29T04:01:17.728Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PSVK"],["c4","PMYK"],["d4","9LK"],["e4","7VY"],["f4","9VY"],["g4","NL"],["h4","PMSL"],["i4","9MS"],["j4","5ML"],["k4","PVLY"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["6LK","8YK","TMLY","1L"],["8MS","7SK","NM","5SV"]],"hands":[[],[]],"market":["NK","1Y","2VL","NV","NS","1K"],"discards":[],"nummoves":3}]}`);

        //Can move to first occurrence of only suit. (Ace/Crown rule unchanged.)
        expect(g.validateMove("1L:a3-d3")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of only suit.
        expect(g.validateMove("1L:a3-h1")).to.have.deep.property("valid", false);  //TODO: better message?

        //Can move to first occurrence of the first occuring suit.
        expect(g.validateMove("6LK:a3-b1")).to.have.deep.property("valid", true);
        //Can't move to first occurrence of the other suit.
        expect(g.validateMove("6LK:a3-d3")).to.have.deep.property("valid", false);
        //Can't move to subsequent occurrences of first suit.
        expect(g.validateMove("6LK:a3-g3")).to.have.deep.property("valid", false);
        //Can't move to subsequent occurrences of second suit.
        expect(g.validateMove("6LK:a3-d2")).to.have.deep.property("valid", false);

        //Can move to first occurrence of first suit. (Pawn/Court rule unchanged.)
        expect(g.validateMove("TMLY:a3-c3")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of first suit.
        expect(g.validateMove("TMLY:a3-h3")).to.have.deep.property("valid", false);
        //Can move to first occurrence of second suit.
        expect(g.validateMove("TMLY:a3-d3")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of second suit.
        expect(g.validateMove("TMLY:a3-h1")).to.have.deep.property("valid", false);
        //Can move to first occurrence of third suit.
        expect(g.validateMove("TMLY:a3-c2")).to.have.deep.property("valid", true);
        //Can't move to subsequent occurrences of third suit.
        expect(g.validateMove("TMLY:a3-k1")).to.have.deep.property("valid", false);

    });

    it ("Implements the no-refills market variant", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["courts","#market"],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-29T03:38:17.329Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","7VY"],["c4","PVLY"],["d4","PMSL"],["e4","2MK"],["f4","3LY"],["g4","PMYK"],["h4","5ML"],["i4","8YK"],["j4","NY"],["k4","PSVK"],["l4","1L"],["m4","6MV"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["TSLK","NM","9LK","TMLY"],["9MS","7SK","1K","2VL"]],"hands":[[],[]],"market":["NS","3SK","TMVK","5YK","TSVY","NV"],"discards":[],"nummoves":3}]}`);
        //Setup.
        g.move("NM:a3-d3/9LK:a3-c2/TSLK:a3-d2/");
        g.move("9MS:a2-k3/7SK:a2-n2/1K:k3-n2/");
        g.move("d3-c3,5YK/c2-b2,TMVK/d2-c2,TSVY/");
        g.move("2VL:a2-d1/d1-c1,3SK/c1-b3,NS/");
        //Player one attempts to refill the market.
        expect(g.validateMove("5YK:b2-e2/e2-d2,NV!/")).to.have.deep.property("valid", false);
        expect(g.validateMove("5YK:b2-e2/e2-d2,NV/")).to.have.deep.property("valid", true);

    });

    it ("Implements the refills market variant", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["courts","#market","refills"],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-29T03:38:17.329Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","7VY"],["c4","PVLY"],["d4","PMSL"],["e4","2MK"],["f4","3LY"],["g4","PMYK"],["h4","5ML"],["i4","8YK"],["j4","NY"],["k4","PSVK"],["l4","1L"],["m4","6MV"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["TSLK","NM","9LK","TMLY"],["9MS","7SK","1K","2VL"]],"hands":[[],[]],"market":["NS","3SK","TMVK","5YK","TSVY","NV"],"discards":[],"nummoves":3}]}`);
        //Setup.
        g.move("NM:a3-d3/9LK:a3-c2/TSLK:a3-d2/");
        g.move("9MS:a2-k3/7SK:a2-n2/1K:k3-n2/");
        g.move("d3-c3,5YK/c2-b2,TMVK/d2-c2,TSVY/");
        g.move("2VL:a2-d1/d1-c1,3SK/c1-b3,NS/");
        //Player one attempts to refill the market.
        expect(g.validateMove("5YK:b2-e2/e2-d2,NV!/")).to.have.deep.property("valid", true);

        //Eat double refill clicks.
        expect(g.handleClick("5YK:b2-e2/e2-d2,NV/", -1, -1, "refill")).to.have.deep.property("move", "5YK:b2-e2/e2-d2,NV!/");
        expect(g.handleClick("5YK:b2-e2/e2-d2,NV!/", -1, -1, "refill")).to.have.deep.property("move", "5YK:b2-e2/e2-d2,NV!/");

    });

    it ("Implements the original market rules", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["courtpawns"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[],"_timestamp":"2025-12-31T23:44:13.590Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","3SK"],["c4","7VY"],["d4","TSVY"],["e4","5YK"],["f4","2SY"],["g4","8MS"],["h4","3LY"],["i4","TSLK"],["j4","1Y"],["k4","TMLY"],["l4","1S"],["m4","TMVK"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["1L","1K","6LK","6SY"],["NY","1V","NS","NM"]],"hands":[[],[]],"market":["9LK","NK","9VY","8YK","2MK","6MV"],"discards":[],"nummoves":3}]}`);
        
        expect(g.validateMove("1L:a3-h3/h3-g3/")).to.have.deep.property("valid", true);
        expect(g.validateMove("1L:a3-h3/h3-g3,6MV")).to.have.deep.property("valid", false);
        expect(g.validateMove("1L:a3-h3/h3-g3,2MK/")).to.have.deep.property("valid", false);
        expect(g.validateMove("1L:a3-h3/h3-g3,8YK/")).to.have.deep.property("valid", true);
        g.move("1L:a3-h3/h3-g3,8YK/");

        //Second move is back to the Excuse.
        expect(g.validateMove("NY:a2-c2/c2-b2,NK/b2-a2,9LK/")).to.have.deep.property("valid", false);
        expect(g.validateMove("NY:a2-c2/c2-b2,9VY/b2-a2,NK/")).to.have.deep.property("valid", true);

    });
    
    it ("Implements the free swim variant", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["courtpawns","freeswim"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[],"_timestamp":"2025-12-31T23:44:13.590Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","3SK"],["c4","7VY"],["d4","TSVY"],["e4","5YK"],["f4","2SY"],["g4","8MS"],["h4","3LY"],["i4","TSLK"],["j4","1Y"],["k4","TMLY"],["l4","1S"],["m4","TMVK"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["1L","1K","6LK","6SY"],["NY","1V","NS","NM"]],"hands":[[],[]],"market":["9LK","NK","9VY","8YK","2MK","6MV"],"discards":[],"nummoves":3}]}`);
        
        expect(g.validateMove("1L:a3-h3/h3-g3/")).to.have.deep.property("valid", true);
        expect(g.validateMove("1L:a3-h3/h3-g3,6MV")).to.have.deep.property("valid", true);
        expect(g.validateMove("1L:a3-h3/h3-g3,2MK/")).to.have.deep.property("valid", true);
        expect(g.validateMove("1L:a3-h3/h3-g3,8YK/")).to.have.deep.property("valid", true);
        g.move("1L:a3-h3/h3-g3,2MK/");

        //Second move is back to the Excuse.
        expect(g.validateMove("NY:a2-c2/c2-b2,NK/b2-a2,9LK/")).to.have.deep.property("valid", true);
        expect(g.validateMove("NY:a2-c2/c2-b2,9LK/b2-a2,NK/")).to.have.deep.property("valid", true);
    });
    
    it ("Autocompletes a la Arimaa", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["advanced","courts"],"gameover":false,"winner":[],"stack":[{"_version":"20251220","_results":[],"_timestamp":"2025-12-29T04:01:17.728Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PSVK"],["c4","PMYK"],["d4","9LK"],["e4","7VY"],["f4","9VY"],["g4","NL"],["h4","PMSL"],["i4","9MS"],["j4","5ML"],["k4","PVLY"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["6LK","8YK","TMLY","1L"],["8MS","7SK","NM","5SV"]],"hands":[[],[]],"market":["NK","1Y","2VL","NV","NS","1K"],"discards":[],"nummoves":3}]}`);

        //Can move to first occurrence of only suit. (Ace/Crown rule unchanged.)
        expect(g.validateMove("1L:")).to.have.deep.property("autocomplete", "1L:a3-");
        expect(g.validateMove("1L:a3-")).to.have.deep.property("autocomplete", "1L:a3-d3/");

        //Can move to first occurrence of the first occuring suit.
        expect(g.validateMove("6LK:a3-")).to.have.deep.property("autocomplete", "6LK:a3-b1/");

        //Return valid false when user tries to move back from the Excuse.
        expect(g.validateMove("a3-")).to.have.deep.property("valid", false);
        
        //Special autocompletion case to reparse a "bad" handleClick result.
        expect(g.validateMove("TMLY:a3-d3/d3-c2,6LK")).to.have.deep.property("autocomplete", "TMLY:a3-d3/d3-c2/6LK:");
        //Same result when passing through handleClick.
        expect(g.handleClick("TMLY:a3-d3/d3-c2", -1, -1, "c6LK")).to.have.deep.property("move", "TMLY:a3-d3/d3-c2/6LK:");

        //OK to autocorrect to a bad value b/c during the game it gets revalidated.
        expect(g.validateMove("TMLY:a3-d3/d3-c2/c2-b3,6LK")).to.have.deep.property("autocomplete", "TMLY:a3-d3/d3-c2/c2-b3/6LK:");
        expect(g.validateMove("TMLY:a3-d3/d3-c2/c2-b3/6LK:")).to.have.deep.property("valid", false);
        //Same result when passing through handleClick.
        expect(g.handleClick("TMLY:a3-d3/d3-c2/c2-b3", -1, -1, "c6LK")).to.have.deep.property("move", "TMLY:a3-d3/d3-c2/c2-b3/6LK:");

    });

    it ("Double autocompletes", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["continuous","advanced"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[],"_timestamp":"2025-12-30T15:56:10.049Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","PMYK"],["c4","PMSL"],["d4","1M"],["e4","PVLY"],["f4","NL"],["g4","PSVK"],["h4","NK"],["i4","1Y"],["j4","3SK"],["k4","NS"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["","","",""],["8MS","7ML","9VY","8YK"]],"hands":[[],[]],"market":["6LK","6SY","9LK"],"discards":[],"nummoves":3},{"_version":"20251229","_results":[{"type":"move","from":"a3","to":"e3","what":"NV","how":"forward"},{"type":"move","from":"e3","to":"g3","what":"2SY","how":"forward"},{"type":"move","from":"g3","to":"l3","what":"1V","how":"forward"}],"_timestamp":"2025-12-31T20:57:34.367Z","currplayer":2,"lastmove":"NV:a3-e3/2SY:e3-g3/1V:g3-l3/","board":{"dataType":"Map","value":[["b4","PMYK"],["c4","PMSL"],["d4","1M"],["e4","PVLY"],["f4","NL"],["g4","PSVK"],["h4","NK"],["i4","1Y"],["j4","3SK"],["k4","NS"],["a3","X1-5"],["a2","X2-6"],["l3","X1-1"]]},"closedhands":[[""],["8MS","7ML","9VY","8YK"]],"hands":[[],[]],"market":["6LK","6SY","9LK"],"discards":["NV","2SY","1V"],"nummoves":3},{"_version":"20251229","_results":[{"type":"move","from":"a2","to":"b2","what":"8YK","how":"forward"},{"type":"move","from":"a2","to":"e3","what":"9VY","how":"forward"},{"type":"move","from":"e3","to":"d3","what":"6SY","how":"back"},{"type":"deckDraw"}],"_timestamp":"2026-01-01T03:11:03.580Z","currplayer":1,"lastmove":"8YK:a2-b2/9VY:a2-e3/e3-d3,6SY/","board":{"dataType":"Map","value":[["b4","PMYK"],["c4","PMSL"],["d4","1M"],["e4","PVLY"],["f4","NL"],["g4","PSVK"],["h4","NK"],["i4","1Y"],["j4","3SK"],["k4","NS"],["a3","X1-5"],["a2","X2-4"],["l3","X1-1"],["b2","X2"],["d3","X2"]]},"closedhands":[[""],["8MS","7ML"]],"hands":[[],["6SY"]],"market":["4YK","4VL","3LY"],"discards":["NV","2SY","1V","8YK","9VY"],"nummoves":3},{"_version":"20251229","_results":[{"type":"move","from":"a3","to":"b1","what":"1K","how":"forward"},{"type":"eject","from":"b2","to":"a2","what":"a Crown or Ace"},{"type":"move","from":"b1","to":"a3","what":"4VL","how":"back"},{"type":"deckDraw"}],"_timestamp":"2026-01-01T13:48:53.017Z","currplayer":2,"lastmove":"1K:a3-b1/b1-a3,4VL/","board":{"dataType":"Map","value":[["b4","PMYK"],["c4","PMSL"],["d4","1M"],["e4","PVLY"],["f4","NL"],["g4","PSVK"],["h4","NK"],["i4","1Y"],["j4","3SK"],["k4","NS"],["a3","X1-5"],["a2","X2-5"],["l3","X1-1"],["d3","X2"]]},"closedhands":[[],["8MS","7ML"]],"hands":[["4VL"],["6SY"]],"market":["NM","8VL","5YK"],"discards":["NV","2SY","1V","8YK","9VY","1K"],"nummoves":3}]}`);

        //Setup, with testing of single completes.
        expect(g.handleClick("8MS:d3-g3/", -1, -1, "c7ML")).to.have.deep.property("move", "8MS:d3-g3/7ML:");

        expect(g.validateMove("8MS:d3-g3/7ML:g3-")).to.have.deep.property("autocomplete", "8MS:d3-g3/7ML:g3-l2/");
        //Same result when passing through handleClick.
        expect(g.handleClick("8MS:d3-g3/7ML:", 1, 6, "X2")).to.have.deep.property("move", "8MS:d3-g3/7ML:g3-l2/");

        g.move("8MS:d3-g3/7ML:g3-l2/");

        //The actual double autocomplete.
        expect(g.validateMove("4VL:")).to.have.deep.property("autocomplete", "4VL:a3-");
        expect(g.validateMove("4VL:a3-")).to.have.deep.property("autocomplete", "4VL:a3-c1/");
        //The double validation happens in handleClick.
        expect(g.handleClick("", -1, -1, "c4VL")).to.have.deep.property("move", "4VL:a3-c1/");

    });

    it ("Handles an empty deck/pool situation", () => {
        //This is an artificial starting state trimmed off of a game long enough to exhaust the deck.
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["freeswim","refills"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[{"type":"move","from":"g3","to":"f3","what":"2MK","how":"back"},{"type":"move","from":"f3","to":"e2","what":"6MV","how":"back"},{"type":"move","from":"e2","to":"d3","what":"NS","how":"back"}],"_timestamp":"2026-01-08T20:08:26.404Z","currplayer":2,"lastmove":"g3-f3,2MK/f3-e2,6MV/e2-d3,NS/","board":{"dataType":"Map","value":[["b4","3MV"],["c4","4YK"],["d4","NY"],["e4","PVLY"],["f4","5SV"],["g4","5YK"],["h4","PMSL"],["i4","PMYK"],["j4","NM"],["k4","4VL"],["l4","PSVK"],["m4","4MS"],["a3","X1-5"],["a2","X2-5"],["c3","X2"],["d3","X1"]]},"closedhands":[["5ML","8VL","3LY"],["2VL","9VY","7SK"]],"hands":[["1Y","6LK","9LK","NK","8YK","2SY","1K","2MK","6MV","NS"],["9MS","1L","7VY","1S","6SY","1M","NL","1V","3SK","7ML"]],"market":["NV"],"discards":[],"nummoves":3}]}`);
        expect(g.validateMove("c3-b3,NV!/")).to.have.deep.property("valid", true);
        g.move("c3-b3,NV!/");
        g.move("pass"); //refill pass

        expect(g.getTrueDeckSize() + g.market.length).eq(1);
        //This should be false because there is nothing to refill,
        //and we don't want to do the refill dance in that situation.
        //However, we're not showing the refill button so not a big risk.
        expect(g.validateMove("b3-a2,8MS!/")).to.have.deep.property("valid", false);
        expect(g.validateMove("b3-a2,8MS/")).to.have.deep.property("valid", true);
        g.move("b3-a2,8MS/");
        expect(g.getTrueDeckSize() + g.market.length).eq(0);
    });

    it ("Handles the rare corner case of blocked with no pool", () => {
        //This is another artificial starting state.
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["freeswim","refills"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[{"type":"pass"}],"_timestamp":"2026-01-09T16:55:28.415Z","currplayer":2,"skipto":2,"lastmove":"pass","board":{"dataType":"Map","value":[["b4","3MV"],["c4","4YK"],["d4","NY"],["e4","PVLY"],["f4","5SV"],["g4","5YK"],["h4","PMSL"],["i4","PMYK"],["j4","NM"],["k4","4VL"],["l4","PSVK"],["m4","4MS"],["a3","X1-6"],["a2","X2-5"],["b3","X2"]]},"closedhands":[[],["5ML","8VL","3LY","2VL","9VY","7SK"]],"hands":[[],["1Y","6LK","9LK","NK","8YK","2SY","1K","2MK","6MV","NS","9MS","1L","7VY","1S","6SY","1M","NL","1V","3SK","7ML","NV"]],"market":["8MS"],"discards":[],"nummoves":2},{"_version":"20251229","_results":[{"type":"move","from":"b3","to":"a2","what":"8MS","how":"back"},{"type":"deckDraw","what":"not"}],"_timestamp":"2026-01-09T16:55:40.553Z","currplayer":1,"lastmove":"b3-a2,8MS/","board":{"dataType":"Map","value":[["b4","3MV"],["c4","4YK"],["d4","NY"],["e4","PVLY"],["f4","5SV"],["g4","5YK"],["h4","PMSL"],["i4","PMYK"],["j4","NM"],["k4","4VL"],["l4","PSVK"],["m4","4MS"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[[],["5ML","8VL","3LY","2VL","9VY","7SK"]],"hands":[[],["1Y","6LK","9LK","NK","8YK","2SY","1K","2MK","6MV","NS","9MS","1L","7VY","1S","6SY","1M","NL","1V","3SK","7ML","NV","8MS"]],"market":[],"discards":[],"nummoves":3}]}`);

        expect(g.getTrueDeckSize() + g.market.length).eq(0);
        expect(g.validateMove("pass")).to.have.deep.property("valid", true);
        g.move("pass");
        expect(g.getTrueDeckSize() + g.market.length).eq(0);

    });

});
