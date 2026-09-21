/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { KillAllGoGame } from "../../src/games";
import { GameFactory } from "../../src/games";
import { addResource } from "../../src";
import i18next from "i18next";

const RED = 1;
const BLUE = 2;

const play = (g: KillAllGoGame, moves: string[]): KillAllGoGame => {
    for (const m of moves) {
        g.move(m);
    }
    return g;
};

/** Player 1 takes the Attacker stones at once: Player 2 is the Defender and moves first on an empty board. */
const attackerIsPlayerOne = (variants: string[] = ["size-9"]): KillAllGoGame => {
    const g = new KillAllGoGame(undefined, variants);
    g.move("attacker");
    return g;
};

describe("Kill-All Go", () => {
    before(() => { addResource("en"); });
    after(() => {
        i18next.removeResourceBundle("en", "apgames");
        i18next.removeResourceBundle("en", "apresults");
    });

    describe("classic opening", () => {
        it("sets up the 17 traditional stones with the Defender (Player 1) to move", () => {
            const g = new KillAllGoGame(undefined, ["classic"]);
            const expected = ["j18", "c17", "q17", "d16", "j16", "p16", "b10", "d10", "j10", "p10", "r10", "d4", "j4", "p4", "c3", "q3", "j2"];
            expect(g.board.size).to.equal(17);
            for (const cell of expected) {
                expect(g.board.get(cell)).to.equal(RED);
            }
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.redSeat).to.equal(2);
            expect(g.getPlayerColour(1)).to.equal(2);
            expect(g.getPlayerColour(2)).to.equal(1);
            const moves = g.moves();
            expect(moves).to.include("pass");
            expect(moves.filter((m) => m !== "pass")).to.have.length(361 - 17);
        });

        it("is only available on the 19x19 board", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "classic"]);
            expect(g.variants).to.deep.equal(["size-9"]);
            expect(g.phase).to.equal("alt-place");
            expect(g.board.size).to.equal(0);
        });
    });

    describe("alternating placement (default opening)", () => {
        it("keeps the colours undecided until someone takes the Attacker side", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            expect(g.phase).to.equal("alt-place");
            expect(g.getPlayerColour(1)).to.equal("#999999");
            expect(g.getPlayerColour(2)).to.equal("#999999");
            g.move("d4");
            expect(g.board.get("d4")).to.equal(RED);
            expect(g.currplayer).to.equal(2);
            expect(g.stack[g.stack.length - 1]._results[0]).to.deep.include({ type: "place", where: "d4", what: "setup" });
            g.move("f6");
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("attacker");
            expect(g.moves()).to.not.include("d4");
        });

        it("hands the first move to the other player as the Defender", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9"]), ["d4", "attacker"]);
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.getPlayerColour(1)).to.equal(2);
            expect(g.getPlayerColour(2)).to.equal(1);
            g.move("e5");
            expect(g.board.get("e5")).to.equal(BLUE);
            expect(g.currplayer).to.equal(2);
            g.move("e4");
            expect(g.board.get("e4")).to.equal(RED);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1, 2]);
        });

        it("lets Player 1 take the Attacker side at once", () => {
            const g = attackerIsPlayerOne();
            expect(g.redSeat).to.equal(1);
            expect(g.currplayer).to.equal(2);
            expect(g.phase).to.equal("play");
        });

        it("does not allow passing or stones with the claim", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            expect(g.validateMove("pass").valid).to.be.false;
            expect(g.validateMove("attacker:a1").valid).to.be.false;
            expect(() => g.move("pass")).to.throw();
        });

        it("offers the take-the-Attacker button and translates board clicks", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            const rep = g.render();
            expect(rep.areas).to.have.length(1);
            expect(rep.areas![0].type).to.equal("buttonBar");
            const click = g.handleClick("", 0, 0, "_btn_attacker");
            expect(click.valid).to.be.true;
            expect(click.move).to.equal("attacker");
            const cell = g.handleClick("", 8, 0);
            expect(cell.valid).to.be.true;
            expect(cell.move).to.equal("a1");
        });
    });

    describe("handicap opening", () => {
        it("makes Player 1 set the handicap within [1, floor(p/2)]", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
            expect(g.phase).to.equal("hand-n");
            expect(g.validateMove("0").valid).to.be.false;
            expect(g.validateMove("41").valid).to.be.false;
            expect(g.validateMove("abc").valid).to.be.false;
            expect(g.validateMove("40").valid).to.be.true;
            expect(g.validateMove("1").valid).to.be.true;
            expect(g.moves()).to.have.length(40);
            expect(g.handleClick("", 0, 0).valid).to.be.false;
            g.move("3");
            expect(g.setup?.handicap).to.equal(3);
            expect(g.phase).to.equal("alt-place");
            expect(g.currplayer).to.equal(2);
        });

        it("makes Player 2 place the handicap stones when they take the Attacker side", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["3"]);
            expect(g.moves()).to.not.include("attacker");
            expect(g.validateMove("attacker").complete).to.equal(-1);
            expect(g.validateMove("attacker:a1,b1").complete).to.equal(-1);
            expect(g.validateMove("attacker:a1,b1,c1,d1").valid).to.be.false;
            expect(g.validateMove("attacker:a1,a1,c1").valid).to.be.false;
            expect(() => g.move("attacker:a1,b1")).to.throw();
            g.move("attacker:a1,b1,c1");
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.board.size).to.equal(3);
        });

        it("lets Player 1 take the Attacker side without extra stones", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["3", "e5", "attacker"]);
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(2);
            expect(g.board.size).to.equal(1);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1]);
        });
    });

    describe("simple pie", () => {
        it("lets Player 1 place any number of stones, then Player 2 take the Attacker side", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "pie"]);
            expect(g.phase).to.equal("pie-slice");
            expect(g.validateMove("c3,g7").complete).to.equal(0);
            g.move("c3,g7");
            expect(g.board.size).to.equal(2);
            expect(g.phase).to.equal("pie-choose");
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.include("attacker");
            expect(g.moves()).to.include("defender:e5");
            g.move("attacker");
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
        });

        it("lets Player 2 choose the Defender side by placing the first stone", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), ["pass"]);
            expect(g.board.size).to.equal(0);
            expect(g.phase).to.equal("pie-choose");
            expect(g.validateMove("defender").complete).to.equal(-1);
            const click = g.handleClick("defender", 4, 4);
            expect(click.move).to.equal("defender:e5");
            g.move("defender:e5");
            expect(g.redSeat).to.equal(1);
            expect(g.board.get("e5")).to.equal(BLUE);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2]);
        });
    });

    describe("generalized Hoctaph's pie", () => {
        it("validates the batch sizes", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "hoctaph"]);
            expect(g.phase).to.equal("hoc-slice");
            expect(g.validateMove("0,1").valid).to.be.false;
            expect(g.validateMove("1,3").valid).to.be.false;
            expect(g.validateMove("40,40").valid).to.be.false;
            expect(g.validateMove("39,40").valid).to.be.true;
            expect(g.validateMove("2,3").valid).to.be.true;
            expect(g.validateMove("2,").valid).to.be.true;
            expect(g.validateMove("2,").complete).to.equal(-1);
            g.move("2,3");
            expect(g.setup).to.deep.equal({ a: 2, b: 3 });
            expect(g.phase).to.equal("hoc-option");
            expect(g.currplayer).to.equal(2);
        });

        it("option 2: the Slicer places the first batch and the Chooser picks the Defender side", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "youplace"]);
            expect(g.phase).to.equal("hoc-batch-a");
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("a1").complete).to.equal(-1);
            expect(g.validateMove("a1,b1,c1").valid).to.be.false;
            g.move("a1,b1");
            expect(g.phase).to.equal("hoc-choose");
            expect(g.currplayer).to.equal(2);
            g.move("defender");
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("hoc-batch-b");
            expect(g.currplayer).to.equal(1);
            g.move("c1,d1,e1");
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(2);
            expect(g.board.size).to.equal(5);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1, 2, 1]);
        });

        it("option 1: the Chooser places the first batch and the Slicer takes the Attacker side", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1"]);
            expect(g.phase).to.equal("hoc-choose");
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("attacker").complete).to.equal(-1);
            g.move("attacker:c1,d1,e1");
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(2);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1]);
        });

        it("option 1: the Slicer picks the Defender side and the Chooser places the second batch", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1", "defender"]);
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("hoc-batch-b");
            expect(g.currplayer).to.equal(2);
            g.move("c1,d1,e1");
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1, 2]);
        });

        it("builds batches by clicking", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3"]);
            const first = g.handleClick("", 8, 0);
            expect(first.move).to.equal("iplace:a1");
            const second = g.handleClick(first.move, 8, 1);
            expect(second.move).to.equal("iplace:a1,b1");
            expect(second.complete).to.equal(1);
            const undo = g.handleClick(second.move, 8, 1);
            expect(undo.move).to.equal("iplace:a1");
        });
    });

    describe("play", () => {
        it("ends at once when a Defender string becomes pass-alive", () => {
            const g = attackerIsPlayerOne();
            play(g, ["a2", "pass", "b2", "pass", "c2", "pass", "d2", "pass", "d1", "pass"]);
            expect(g.gameover).to.be.false;
            g.move("b1");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(g.alive!.sort()).to.deep.equal(["a2", "b1", "b2", "c2", "d1", "d2"]);
            const results = g.stack[g.stack.length - 1]._results;
            expect(results).to.deep.include({ type: "eog", reason: "pass-alive" });
            const rep = g.render();
            const enters = rep.annotations!.filter((a) => a.type === "enter");
            expect(enters.some((a) => (a as { targets: unknown[] }).targets.length === 6)).to.be.true;
        });

        it("ends with an Attacker win after two consecutive passes", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a9", "pass"]);
            expect(g.gameover).to.be.false;
            expect(g.validateMove("pass").message).to.not.equal("");
            g.move("pass");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "double-pass" });
        });

        it("does not treat a pass followed by a stone as consecutive passes", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "pass", "e6", "pass"]);
            expect(g.gameover).to.be.false;
            expect(g.currplayer).to.equal(2);
        });

        it("forbids recreating an earlier position (positional superko)", () => {
            const g = attackerIsPlayerOne();
            // Blue: c5, b4, c3 around c4; Red: d5, e4, d3 around d4; Red throws in at c4, Blue captures with d4.
            play(g, ["c5", "d5", "b4", "e4", "c3", "d3", "a1", "c4", "d4"]);
            expect(g.board.has("c4")).to.be.false;
            expect(g.board.get("d4")).to.equal(BLUE);
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("c4").valid).to.be.false;
            expect(g.moves()).to.not.include("c4");
            play(g, ["a9", "b9"]);
            expect(g.validateMove("c4").valid).to.be.true;
            g.move("c4");
            expect(g.board.has("d4")).to.be.false;
        });

        it("applies a multi-stone suicide (Tromp-Taylor clearing)", () => {
            const g = attackerIsPlayerOne();
            // Red walls off a1 and b1 with a2, b2, c1. Blue plays a1 (one liberty at b1), then b1: both stones are removed.
            play(g, ["e5", "a2", "e6", "b2", "e7", "c1", "a1", "f5"]);
            expect(g.validateMove("b1").valid).to.be.true;
            g.move("b1");
            expect(g.board.has("a1")).to.be.false;
            expect(g.board.has("b1")).to.be.false;
            const results = g.stack[g.stack.length - 1]._results;
            expect(results).to.deep.include({ type: "capture", where: "b1,a1", count: 2, how: "suicide" });
            expect(g.currplayer).to.equal(1);
        });

        it("rejects a single-stone suicide because the position would repeat", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a2", "e6", "b1"]);
            expect(g.validateMove("a1").valid).to.be.false;
            expect(g.moves()).to.not.include("a1");
            expect(g.moves()).to.include("c1");
        });

        it("reports its statuses with structured labels", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            const statuses = g.sidebarStatuses();
            expect(statuses[0].key).to.deep.include({ textKey: "apgames:status.killallgo.ATTACKER" });
            expect(statuses[0].value[0]).to.deep.include({ textKey: "apgames:status.killallgo.UNDECIDED" });
            g.move("attacker");
            const after = g.sidebarStatuses();
            expect(after[0].value[0]).to.deep.include({ textKey: "apgames:status._player", actor: { kind: "seat", seat: 1 } });
            expect(after[1].value[0]).to.deep.include({ actor: { kind: "seat", seat: 2 } });
        });
    });

    describe("life claims", () => {
        const withClaim = (marks: string): KillAllGoGame => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a9", "e6", "b9"]);
            g.move(marks.length === 0 ? "claim:e5" : `claim:e5:${marks}`);
            return g;
        };

        it("lets only the Defender claim one of their own strings", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a9"]);
            expect(g.validateMove("claim:e5").valid).to.be.true;
            expect(g.validateMove("claim:a9").valid).to.be.false;
            expect(g.validateMove("claim:e5:a9").valid).to.be.false;
            expect(g.validateMove("claim:e5:e4,e4").valid).to.be.false;
            expect(g.validateMove("claim:e5:e4").complete).to.equal(0);
            g.move("e6");
            expect(g.validateMove("claim:e5").valid).to.be.false;
        });

        it("is built by clicking a stone and then the protected points", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a9"]);
            const start = g.handleClick("", 4, 4);
            expect(start.move).to.equal("claim:e5");
            const mark = g.handleClick(start.move, 5, 4);
            expect(mark.move).to.equal("claim:e5:e4");
            const unmark = g.handleClick(mark.move, 5, 4);
            expect(unmark.move).to.equal("claim:e5");
            const cancel = g.handleClick(mark.move, 4, 4);
            expect(cancel.move).to.equal("");
        });

        it("records the claim and hands the refutation to the Attacker", () => {
            const g = withClaim("e4,f5");
            expect(g.phase).to.equal("refute");
            expect(g.currplayer).to.equal(1);
            expect(g.claim).to.deep.equal({ stone: "e5", stones: ["e5", "e6"], marks: ["e4", "f5"] });
            expect(g.stack[g.stack.length - 1]._results[0]).to.deep.include({ type: "claim", how: "life", where: "e5", what: "e4,f5" });
            expect(g.getButtons()).to.deep.equal([]);
            const rep = g.render();
            expect(rep.areas![0].type).to.equal("buttonBar");
            expect(rep.annotations!.some((a) => a.type === "dots")).to.be.true;
            const resumed = GameFactory("killallgo", g.serialize()) as KillAllGoGame;
            expect(resumed.phase).to.equal("refute");
            expect(resumed.claim).to.deep.equal(g.claim);
        });

        it("is refuted when the claimed string is captured", () => {
            const g = withClaim("");
            expect(g.validateMove("e4,d5,f5,d6,f6").complete).to.equal(-1);
            expect(g.validateMove("e4,d5,f5,d6,f6,e7").complete).to.equal(1);
            expect(g.validateMove("e4,d5,f5,d6,f6,e7,a1").valid).to.be.false;
            g.move("e4,d5,f5,d6,f6,e7");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.board.has("e5")).to.be.false;
            expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "claim-refuted" });
            expect(g.stack[g.stack.length - 1].interim).to.have.length(5);
        });

        it("is upheld when the Attacker concedes", () => {
            const g = withClaim("e4");
            expect(g.moves()).to.include("concede");
            expect(g.moves()).to.include("e4");
            expect(g.moves()).to.not.include("d5");
            const click = g.handleClick("d5", 0, 0, "_btn_concede");
            expect(click.move).to.equal("d5,concede");
            g.move("d5,concede");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(g.alive!.sort()).to.deep.equal(["e5", "e6"]);
            expect(g.board.get("d5")).to.equal(RED);
        });

        it("continues normal play after the Attacker ends on a protected point", () => {
            const g = withClaim("e4");
            expect(g.validateMove("e4,d5").valid).to.be.false;
            expect(g.validateMove("d5").complete).to.equal(-1);
            g.move("d5,f5,e4");
            expect(g.gameover).to.be.false;
            expect(g.phase).to.equal("play");
            expect(g.claim).to.be.undefined;
            expect(g.currplayer).to.equal(2);
            expect(g.board.get("d5")).to.equal(RED);
            expect(g.board.get("f5")).to.equal(RED);
            expect(g.board.get("e4")).to.equal(RED);
            expect(g.stack[g.stack.length - 1].interim).to.have.length(2);
            expect(g.validateMove("claim:e5:d6").valid).to.be.true;
        });

        it("cannot be claimed by the Attacker and cannot include passes in a refutation", () => {
            const g = withClaim("e4");
            expect(g.validateMove("pass").valid).to.be.false;
            expect(g.validateMove("d5,pass").valid).to.be.false;
        });
    });

    describe("records and chat", () => {
        it("writes structured chat lines for the protocol actions", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1", "attacker:c1,d1,e1", "e5", "a9", "claim:e5:e4", "d5,e4"]);
            const entries = g.chatLogEntries(["Alice", "Bob"]);
            const keys = entries.flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:ANNOUNCE.killallgo_slice");
            expect(keys).to.include("apresults:SELECT.killallgo_iplace");
            expect(keys).to.include("apresults:CLAIM.killallgo_attacker");
            expect(keys).to.include("apresults:PLACE.killallgo_setup");
            expect(keys).to.include("apresults:CLAIM.killallgo_life");
            const text = g.chatLog(["Alice", "Bob"]).flat().join("\n");
            expect(text).to.include("Alice chose to play as the Attacker.");
            expect(text).to.include("Bob claimed that the string at e5 is alive unless the Attacker plays at e4.");
        });

        it("round-trips through serialization in every phase", () => {
            const games = [
                new KillAllGoGame(undefined, ["size-9"]),
                play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["2"]),
                play(new KillAllGoGame(undefined, ["size-9", "pie"]), ["c3"]),
                play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "youplace"]),
                play(attackerIsPlayerOne(), ["e5", "a9", "claim:e5:e4"]),
            ];
            for (const g of games) {
                const copy = new KillAllGoGame(g.serialize());
                expect(copy.phase).to.equal(g.phase);
                expect(copy.currplayer).to.equal(g.currplayer);
                expect(copy.redSeat).to.equal(g.redSeat);
                expect(copy.setup).to.deep.equal(g.setup);
                expect(copy.claim).to.deep.equal(g.claim);
                expect([...copy.board.entries()]).to.deep.equal([...g.board.entries()]);
                expect(copy.moves()).to.deep.equal(g.moves());
            }
        });
    });
});
