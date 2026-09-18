/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { IcePalaceGame } from "../../src/games/icepalace";
import { PieceId, sizeOf } from "../../src/games/icepalace/rules";

const countOfSize = (hand: PieceId[], size: 1 | 2 | 3): number =>
    hand.filter(p => sizeOf(p) === size).length;

/** Pins hands and Pool so a dealt game stops being random. */
const rig = (g: IcePalaceGame, hands: PieceId[][], pool?: PieceId[]): IcePalaceGame => {
    g.hands = hands.map(h => [...h]);
    if (pool !== undefined) {
        g.pool = [...pool];
    }
    return g;
};

/** A Pool with plenty of everything, so replenishing never ends the game mid-test. */
const fatPool = (): PieceId[] => {
    const pool: PieceId[] = [];
    for (let i = 0; i < 12; i++) {
        pool.push("1S", "1M", "1L");
    }
    return pool;
};

describe("Ice Palace: setup", () => {
    it("deals every player two pyramids of each size", () => {
        for (const n of [3, 4, 5, 6]) {
            const g = new IcePalaceGame(n);
            expect(g.hands.length).to.equal(n);
            for (const hand of g.hands) {
                expect(hand.length).to.equal(6);
                expect(countOfSize(hand, 1)).to.equal(2);
                expect(countOfSize(hand, 2)).to.equal(2);
                expect(countOfSize(hand, 3)).to.equal(2);
            }
        }
    });

    it("guarantees each player one of each size in their own colour", () => {
        const g = new IcePalaceGame(4);
        for (let p = 1; p <= 4; p++) {
            for (const size of ["S", "M", "L"]) {
                expect(g.hands[p - 1]).to.include(`${p}${size}`);
            }
        }
    });

    it("puts the rest of every stash plus Black and White into the Pool", () => {
        for (const n of [3, 4, 5, 6]) {
            const g = new IcePalaceGame(n);
            // Stashes total 15 each for n players plus Black and White, less six per hand.
            expect(g.pool.length).to.equal(15 * (n + 2) - 6 * n);
            for (const size of [1, 2, 3] as const) {
                expect(countOfSize(g.pool, size)).to.equal(3 * n + 10);
            }
        }
    });

    it("refuses player counts the game does not support", () => {
        expect(() => new IcePalaceGame(2)).to.throw();
        expect(() => new IcePalaceGame(7)).to.throw();
    });
});

describe("Ice Palace: playing a hand", () => {
    it("will not let the lead pass", () => {
        const g = rig(new IcePalaceGame(3), [["1L"], ["2L"], ["3L"]]);
        expect(g.validateMove("pass").valid).to.be.false;
        expect(() => g.move("pass")).to.throw();
    });

    it("lets the lead place anything anywhere", () => {
        const g = rig(new IcePalaceGame(3), [["BS"], ["2L"], ["3L"]]);
        g.move("BS@0,0");
        expect(g.topOfCell("yard", "0,0")).to.equal("BS");
        expect(g.currplayer).to.equal(2);
    });

    it("stacks bigger over smaller regardless of colour", () => {
        const g = rig(new IcePalaceGame(3), [["1S"], ["BM"], ["3S"]]);
        g.move("1S@0,0");
        // Black stacks fine; only its colour matching is crippled.
        g.move("BM@0,0");
        expect(g.topOfCell("yard", "0,0")).to.equal("BM");
        // Nothing may go under, and a small cannot cover a medium.
        expect(g.validateMove("3S@0,0").valid).to.be.false;
    });

    it("refuses to stack anything over a large", () => {
        const g = rig(new IcePalaceGame(3), [["1L"], ["2L"], ["3S"]]);
        g.move("1L@0,0");
        expect(g.validateMove("2L@0,0").valid).to.be.false;
    });

    it("founds a new stack only next to a matching top", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S", "2S"], ["3S"]]);
        g.move("1M@0,0");
        expect(g.validateMove("2S@1,0").valid).to.be.false;
        expect(g.validateMove("1S@1,0").valid).to.be.true;
    });

    it("treats White as wild and Black as matching nothing", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["WS", "BS"], ["3S"]]);
        g.move("1M@0,0");
        expect(g.validateMove("WS@1,0").valid).to.be.true;
        expect(g.validateMove("BS@1,0").valid).to.be.false;
    });

    it("rejects diagonal placements", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]]);
        g.move("1M@0,0");
        expect(g.validateMove("1S@1,1").valid).to.be.false;
        expect(g.validateMove("1S@0,1").valid).to.be.true;
    });

    it("ends the hand only after every player has passed in a row", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("hand");
        // Back to the player who placed, who must also decline before the hand closes.
        expect(g.currplayer).to.equal(1);
        g.move("pass");
        expect(g.phase).to.equal("build");
        expect(g.currplayer).to.equal(1);
    });

    it("lets the last placer keep extending instead of closing the hand", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("1L@0,0");
        expect(g.phase).to.equal("hand");
        expect(g.passes).to.equal(0);
    });

    it("hands the build to whoever placed last", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("1S@0,1");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        expect(g.currplayer).to.equal(2);
    });
});

describe("Ice Palace: building the Palace", () => {
    const toBuild = (hands: PieceId[][], lead: string, rest: string[] = []): IcePalaceGame => {
        const g = rig(new IcePalaceGame(3), hands, fatPool());
        g.move(lead);
        for (const m of rest) {
            g.move(m);
        }
        while (g.phase === "hand") {
            g.move("pass");
        }
        return g;
    };

    it("discards Black and White on the way out of the Yard", () => {
        const g = toBuild([["BL"], ["2L"], ["3L"]], "BL@0,0");
        expect(g.phase).to.equal("build");
        expect(g.stock).to.be.empty;
        expect(g.buildMin).to.equal(0);
    });

    it("auto-resolves a build with nothing placeable", () => {
        const g = toBuild([["BL"], ["2L"], ["3L"]], "BL@0,0");
        expect(g.moves()).to.deep.equal(["pass"]);
        g.move("pass");
        expect(g.phase).to.equal("hand");
    });

    it("reports the maximum the builder must reach", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0,0", ["pass", "pass", "1L@0,0"]);
        expect(g.stock.sort()).to.deep.equal(["1L", "1M"]);
        expect(g.buildMin).to.equal(2);
    });

    it("refuses a build that stops short of the maximum", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0,0", ["pass", "pass", "1L@0,0"]);
        const short = g.validateMove("1L@0,0");
        expect(short.valid).to.be.true;
        expect(short.complete).to.equal(-1);
    });

    it("never auto-commits a completed build", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0,0", ["pass", "pass", "1L@0,0"]);
        const full = g.validateMove("1L@0,0;1M@0,0");
        expect(full.valid).to.be.true;
        expect(full.complete).to.equal(0);
    });

    it("applies a build and starts the next hand with the token moved on", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0,0", ["pass", "pass", "1L@0,0"]);
        g.move("1L@0,0;1M@0,0");
        expect(g.phase).to.equal("hand");
        expect(g.lead).to.equal(2);
        expect(g.currplayer).to.equal(2);
        expect(g.palace.get("0,0")).to.deep.equal(["1L", "1M"]);
    });

    it("refuses a build that breaks the Palace code", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0,0", ["pass", "pass", "1L@0,0"]);
        // Small over large is fine, large over medium is not.
        expect(g.validateMove("1M@0,0;1L@0,0").valid).to.be.false;
    });
});

describe("Ice Palace: scoring and ending", () => {
    it("scores each stack for whoever is on top", () => {
        const g = new IcePalaceGame(3);
        g.palace = new Map([
            ["0,0", ["1L", "2M", "3S"]],
            ["1,0", ["2L", "1M"]],
            ["2,0", ["3L"]],
        ]);
        expect(g.getPlayerScore(1)).to.equal(2);
        expect(g.getPlayerScore(2)).to.equal(0);
        expect(g.getPlayerScore(3)).to.equal(4);
    });

    it("ends the game when the Pool cannot replenish every hand", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L"], ["3L"]], []);
        g.palace = new Map([["5,5", ["1L", "2M"]]]);
        g.move("1M@0,0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        g.move(g.moves()[0]);
        expect(g.gameover).to.be.true;
    });

    it("declares every top scorer a winner, which AP shows as a draw", () => {
        // A Black lead is discarded rather than built, so the rigged Palace is the final one.
        const g = rig(new IcePalaceGame(3), [["BL"], ["2L"], ["3L"]], []);
        // Two stacks of equal height topped by different players.
        g.palace = new Map([
            ["5,5", ["2L", "1M"]],
            ["6,5", ["2L", "3M"]],
        ]);
        g.move("BL@0,0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        g.move(g.moves()[0]);
        expect(g.gameover).to.be.true;
        expect(g.winner.length).to.be.greaterThan(1);
    });
});

describe("Ice Palace: board interaction", () => {
    /**
     * The freespace renderer reports clicks as continuous coordinates, so the layout maths
     * has to invert cleanly. This checks the arithmetic only; the renderer JSON itself is
     * not verified here.
     */
    it("maps a click at a cell's drawn position back to that cell", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L"], ["3S"]], fatPool());
        g.move("1M@0,0");
        const rep = g.render() as { pieces: { x: number; y: number; id: string }[] };
        const drawn = rep.pieces.find(p => p.id === "y:0,0");
        expect(drawn, "the placed pyramid should be drawn").to.not.be.undefined;
        // A large covers a medium, and colour is irrelevant when stacking.
        const click = g.handleClick("2L", drawn!.y, drawn!.x, "_field");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("2L@0,0");
    });

    it("offers frontier space to found new stacks into", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        const rep = g.render() as { pieces: { x: number; y: number; id: string }[]; board: { width: number; height: number } };
        const drawn = rep.pieces.find(p => p.id === "y:0,0")!;
        // One cell to the right of the only stack. Columns are pitched at the renderer's
        // own cellsize, which is what freespace scales pieces to.
        const CELL = 50;
        const click = g.handleClick("1S", drawn.y, drawn.x + CELL, "_field");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("1S@1,0");
    });

    it("selects a cell when an existing pyramid is clicked", () => {
        const g = rig(new IcePalaceGame(3), [["1S", "1L"], ["1S"], ["3S"]], fatPool());
        g.move("1S@0,0");
        g.move("pass");
        g.move("pass");
        const click = g.handleClick("1L", 0, 0, "y:0,0");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("1L@0,0");
    });
});

describe("Ice Palace: serialization", () => {
    it("survives a round trip through its own state", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1L"], ["WS"], ["3S"]], fatPool());
        g.move("1M@0,0");
        // White is wild, so it may found beside the player-1 medium.
        g.move("WS@0,1");
        const clone = g.clone();
        expect(clone.phase).to.equal(g.phase);
        expect(clone.currplayer).to.equal(g.currplayer);
        expect(clone.hands).to.deep.equal(g.hands);
        expect([...clone.yard.entries()]).to.deep.equal([...g.yard.entries()]);
        expect(clone.pool.length).to.equal(g.pool.length);
    });
});
