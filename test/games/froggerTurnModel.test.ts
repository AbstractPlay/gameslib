import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { FroggerGame } from "../../src/games/frogger";
import {
    sequencedSkiptoPlyActor,
    sequencedSkiptoShouldCloseRound,
} from "../../src/games/_turn-sequenced-skipto";
import { plyOrderedMovesFromRounds } from "../fixtures/turnModel/helpers";

describe("Frogger refills turn model (Phase 6)", () => {
    const emptyDeckRefills = `{"game":"frogger","numplayers":2,"variants":["freeswim","refills"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[{"type":"move","from":"g3","to":"f3","what":"2MK","how":"back"},{"type":"move","from":"f3","to":"e2","what":"6MV","how":"back"},{"type":"move","from":"e2","to":"d3","what":"NS","how":"back"}],"_timestamp":"2026-01-08T20:08:26.404Z","currplayer":2,"lastmove":"g3-f3,2MK/f3-e2,6MV/e2-d3,NS/","board":{"dataType":"Map","value":[["b4","3MV"],["c4","4YK"],["d4","NY"],["e4","PVLY"],["f4","5SV"],["g4","5YK"],["h4","PMSL"],["i4","PMYK"],["j4","NM"],["k4","4VL"],["l4","PSVK"],["m4","4MS"],["a3","X1-5"],["a2","X2-5"],["c3","X2"],["d3","X1"]]},"closedhands":[["5ML","8VL","3LY"],["2VL","9VY","7SK"]],"hands":[["1Y","6LK","9LK","NK","8YK","2SY","1K","2MK","6MV","NS"],["9MS","1L","7VY","1S","6SY","1M","NL","1V","3SK","7ML"]],"market":["NV"],"discards":[],"nummoves":3}]}`;

    it("uses sequenced turn model when refills variant is active", () => {
        const g = new FroggerGame(emptyDeckRefills);
        expect(g.turnModel()).to.equal("sequenced");
    });

    it("uses sequential turn model without refills variant", () => {
        const g = new FroggerGame(`{"game":"frogger","numplayers":2,"variants":["advanced"],"gameover":false,"winner":[],"stack":[{"_version":"20251229","_results":[],"_timestamp":"2026-01-27T00:12:42.159Z","currplayer":1,"board":{"dataType":"Map","value":[["b4","4YK"],["c4","4MS"],["d4","PSVK"],["e4","NM"],["f4","PMSL"],["g4","8VL"],["h4","PVLY"],["i4","3MV"],["j4","3LY"],["k4","PMYK"],["a3","X1-6"],["a2","X2-6"]]},"closedhands":[["1M","6SY","1L","7ML"],["8MS","NY","5ML","7VY"]],"hands":[[],[]],"market":["NS","1V","1S","2VL","4VL","5YK"],"discards":[],"nummoves":3}]}`);
        expect(g.turnModel()).to.equal("sequential");
    });

    it("groups refill follow-up plies in one seat cycle before closing the round", () => {
        const g = new FroggerGame(emptyDeckRefills);
        g.move("c3-b3,NV!/");
        g.move("pass");
        g.move("b3-a2,8MS/");

        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([2, 1, 2]);
        expect(plies.map((p) => p.round)).to.deep.equal([0, 0, 0]);
        expect(g.getRounds()).to.have.length(3);
        expect(plyOrderedMovesFromRounds(g.getRounds())).to.deep.equal(plies.map((p) => p.move));
    });

    it("exports one sparse row per ply with sequence when play order differs from seating", () => {
        const g = new FroggerGame(emptyDeckRefills);
        g.move("c3-b3,NV!/");
        g.move("pass");
        g.move("b3-a2,8MS/");

        const rounds = g.getRounds();
        expect(rounds[0]![1]).to.deep.include({ move: "c3-b3,NV!/", sequence: 1 });
        expect(rounds[1]![0]).to.deep.include({ move: "pass", sequence: 2 });
        expect(rounds[2]![1]).to.deep.include({ move: "b3-a2,8MS/", sequence: 3 });
    });

    it("sequencedSkiptoPlyActor respects skipto on supplemental refill turns", () => {
        const g = new FroggerGame(emptyDeckRefills);
        g.move("c3-b3,NV!/");
        g.move("pass");
        expect(sequencedSkiptoPlyActor(g, g.stack.length - 1)).to.equal(1);
    });

    it("does not close a round while skipto is still pending", () => {
        const g = new FroggerGame(emptyDeckRefills);
        g.move("c3-b3,NV!/");
        const plies = g.getPlies();
        const stackIndex = plies[plies.length - 1]!.stackIndex;
        expect(sequencedSkiptoShouldCloseRound(g, plies, stackIndex)).to.equal(false);
    });
});

describe("Frogger refills use sequenced mechanism correctly", () => {
    // Same board/hands as emptyDeckRefills above, but _version bumped.
    const sequencedRefills = `{"game":"frogger","numplayers":2,"variants":["freeswim","refills"],"gameover":false,"winner":[],"stack":[{"_version":"20260822","_results":[{"type":"move","from":"g3","to":"f3","what":"2MK","how":"back"},{"type":"move","from":"f3","to":"e2","what":"6MV","how":"back"},{"type":"move","from":"e2","to":"d3","what":"NS","how":"back"}],"_timestamp":"2026-01-08T20:08:26.404Z","currplayer":2,"lastmove":"g3-f3,2MK/f3-e2,6MV/e2-d3,NS/","board":{"dataType":"Map","value":[["b4","3MV"],["c4","4YK"],["d4","NY"],["e4","PVLY"],["f4","5SV"],["g4","5YK"],["h4","PMSL"],["i4","PMYK"],["j4","NM"],["k4","4VL"],["l4","PSVK"],["m4","4MS"],["a3","X1-5"],["a2","X2-5"],["c3","X2"],["d3","X1"]]},"closedhands":[["5ML","8VL","3LY"],["2VL","9VY","7SK"]],"hands":[["1Y","6LK","9LK","NK","8YK","2SY","1K","2MK","6MV","NS"],["9MS","1L","7VY","1S","6SY","1M","NL","1V","3SK","7ML"]],"market":["NV"],"discards":[],"nummoves":3}]}`;

    it("a refill request sets refillPending, not skipto", () => {
        const g = new FroggerGame(sequencedRefills);
        g.move("c3-b3,NV!/");
        expect(g.currplayer).to.equal(2);
        expect(g.refillPending).to.equal(2);
        expect(g.skipto).to.equal(undefined);
    });

    it("the supplemental submit doesn't involve forced passes", () => {
        const g = new FroggerGame(sequencedRefills);
        g.move("c3-b3,NV!/");
        // No intervening g.move("pass") - the other seat is never prompted.
        g.move("b3-a2,8MS/");
        expect(g.refillPending).to.equal(undefined);
        expect(g.currplayer).to.equal(1);
    });

    it("getPlies groups both plies under the same actor and round, with no passes", () => {
        const g = new FroggerGame(sequencedRefills);
        g.move("c3-b3,NV!/");
        g.move("b3-a2,8MS/");

        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([2, 2]);
        expect(plies.map((p) => p.round)).to.deep.equal([0, 0]);
        expect(g.getRounds()).to.have.length(2);
        expect(plyOrderedMovesFromRounds(g.getRounds())).to.deep.equal(plies.map((p) => p.move));
    });

    it("chatLog names the refilling player correctly", () => {
        // Regression test for the shared GameBase.chatLog().
        addResource("en");
        const g = new FroggerGame(sequencedRefills);
        g.move("c3-b3,NV!/");
        const [, message] = g.chatLog(["Alice", "Bob"])[0];
        expect(message).to.include("Bob"); // player 2, who announced - not "Alice"
    });
});
