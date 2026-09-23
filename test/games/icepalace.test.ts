/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import {
    IcePalaceGame,
    PieceId,
    Structure,
    cellOf,
    legalCellsFor,
    legalPalacePlacement,
    maximumBuild,
    placeInto,
    sizeOf,
} from "../../src/games/icepalace";

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

    it("falls back to three players for a count it does not offer", () => {
        // The front previews every multi-count game with two players.
        expect(new IcePalaceGame(2).numplayers).to.equal(3);
        expect(new IcePalaceGame(7).numplayers).to.equal(3);
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

describe("Ice Palace: move lists and auto-passing", () => {
    it("offers a stuck player nothing but a pass, which is what triggers auto-pass", () => {
        // A small Black cannot be played at all: nothing is smaller for it to cover, and
        // Black matches no colour, so it can never found a stack either.
        const g = rig(new IcePalaceGame(3), [["1M"], ["BS"], ["3S"]], fatPool());
        g.move("1M@0,0");
        expect(g.moves()).to.deep.equal(["pass"]);
    });

    it("keeps pass on offer for a player who could place instead", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        const moves = g.moves();
        expect(moves).to.include("pass");
        expect(moves.length).to.be.greaterThan(1);
    });

    it("never offers the lead a pass", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["1S"], ["3S"]], fatPool());
        expect(g.moves()).to.not.include("pass");
    });

    it("does not enumerate builds, but still supplies one on request", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2L"], ["3L"]], fatPool());
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("1L@0,0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        expect(g.buildMin).to.be.greaterThan(0);
        // Offering a single worked build in the dropdown would imply it were the only one.
        expect(g.moves()).to.be.empty;
        const suggested = g.randomMove();
        const check = g.validateMove(suggested);
        expect(check.valid, check.message).to.be.true;
        expect(check.complete).to.equal(0);
    });

    it("declares autopass and does not declare no-moves", () => {
        const flags = IcePalaceGame.gameinfo.flags ?? [];
        expect(flags).to.include("autopass");
        expect(flags).to.not.include("no-moves");
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
    type Rep = {
        renderer?: string;
        board?: { width: number; height: number; stackOffset?: number };
        legend?: { [k: string]: { name?: string; opacity?: number } };
        pieces: string[][][];
        areas?: { type?: string; pieces?: string[]; stash?: string[][] }[];
        annotations?: { type: string; targets: { row: number; col: number }[] }[];
    };

    /** Board row and column at which a cell's stack is drawn. */
    const drawnAt = (rep: Rep, piece: string): [number, number] => {
        for (let row = 0; row < rep.pieces.length; row++) {
            for (let col = 0; col < rep.pieces[row].length; col++) {
                if (rep.pieces[row][col].includes("p" + piece)) {
                    return [row, col];
                }
            }
        }
        throw new Error(`${piece} is not drawn anywhere`);
    };

    it("maps a click on a drawn stack back to its cell", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L"], ["3S"]], fatPool());
        g.move("1M@0,0");
        const [row, col] = drawnAt(g.render() as Rep, "1M");
        // stacking-3D reports a click on a stacked pyramid with its stack index.
        const click = g.handleClick("2L", row, col, "0");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("2L@0,0");
    });

    it("offers frontier space to found new stacks into", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        const [row, col] = drawnAt(g.render() as Rep, "1M");
        // The cell to the right is empty padding, and an empty-cell click carries "".
        const click = g.handleClick("1S", row, col + 1, "");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("1S@1,0");
    });

    it("refuses clicks on the Palace while a hand is being played", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.palace = new Map([["0,0", ["2L"]]]);
        g.move("1M@0,0");
        const [row, col] = drawnAt(g.render() as Rep, "2L");
        const click = g.handleClick("1S", row, col, "0");
        expect(click.valid).to.be.false;
    });

    it("selects a pyramid when its entry in the pieces area is clicked", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L", "2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        // The pieces area passes the legend key, which carries a letter prefix.
        const click = g.handleClick("", -1, -1, "p2L");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("2L");
    });

    it("offers the current hand while a hand is played, and the stock while building", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2L", "2S"], ["3L"]], fatPool());
        g.move("1M@0,0");
        expect((g.render() as Rep).areas?.[0].pieces).to.deep.equal(["p2L", "p2S"]);
        g.move("pass");
        g.move("pass");
        g.move("1L@0,0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        expect(g.phase).to.equal("build");
        expect((g.render() as Rep).areas?.[0].pieces.sort()).to.deep.equal(["p1L", "p1M"]);
    });

    it("stacks pyramids the way Volcano does, one index above the last", () => {
        // The -3D glyphs put a small's base on the cell at index 0, a medium's one rise-step
        // lower and a large's two lower. Volcano sits each piece one index above the last
        // and spends "-" placeholders only to keep a base from sinking below the ground.
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        // The lone medium is a colour no other stack holds, so drawnAt finds only it.
        g.palace = new Map([["0,0", ["1L", "2M", "3S"]], ["1,0", ["2L"]], ["2,0", ["3M"]]]);
        g.yard = new Map([["0,0", ["1S", "2M", "3L"]]]);
        const rep = g.render() as Rep & { board: { stackOffset?: number }; legend: Record<string, { nudge?: unknown }> };
        expect(rep.board.stackOffset).to.equal(0.15);
        expect(rep.legend.p1L.nudge).to.be.undefined;
        // A Palace tower: the large is lifted onto the ground, then each piece sits one up.
        const [tr, tc] = drawnAt(rep, "3S");
        expect(rep.pieces[tr][tc]).to.deep.equal(["-", "-", "p1L", "p2M", "p3S"]);
        // Lone pieces need only enough lift to reach the ground.
        const [lr, lc] = drawnAt(rep, "2L");
        expect(rep.pieces[lr][lc]).to.deep.equal(["-", "-", "p2L"]);
        const [mr, mc] = drawnAt(rep, "3M");
        expect(rep.pieces[mr][mc]).to.deep.equal(["-", "p3M"]);
        // A Yard stack grows upward in size, so every base already clears the ground.
        const [yr, yc] = drawnAt(rep, "3L");
        expect(rep.pieces[yr][yc]).to.deep.equal(["p1S", "p2M", "p3L"]);
    });

    it("keeps a minimum footprint around the origin and two columns between structures", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        // Before the lead only the empty Yard shows: a five-cell box plus padding each side.
        let rep = g.render() as Rep;
        expect(rep.pieces.length).to.equal(7);
        expect(rep.pieces[0].length).to.equal(7);
        // The lead goes in the middle, wherever in the empty region it is clicked.
        const click = g.handleClick("1M", 0, 0, "");
        expect(click.move).to.equal("1M@0,0");
        g.move("1M@0,0");
        // With a Palace as well, both regions show, two empty columns apart.
        g.palace = new Map([["0,0", ["2L"]]]);
        rep = g.render() as Rep;
        expect(rep.pieces.length).to.equal(7);
        expect(rep.pieces[0].length).to.equal(7 + 2 + 7);
        // The Yard sits on the left and the Palace on the right.
        expect(drawnAt(rep, "1M")[1]).to.equal(3);
        expect(drawnAt(rep, "2L")[1]).to.equal(7 + 2 + 3);
        // Growing past the minimum extends the board only in that direction.
        g.yard.set("4,0", ["1S"]);
        rep = g.render() as Rep;
        expect(rep.pieces[0].length).to.equal(7 + 2 + 9);
    });

    it("shows the Pool below the hand for reference, and ignores clicks on it", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["2S", "1L", "WM", "1S"]);
        const rep = g.render() as Rep & { areas: { type?: string; pieces?: string[]; label?: { textKey?: string } }[] };
        expect(rep.areas).to.have.length(2);
        expect(rep.areas[1].type).to.equal("pieces");
        expect(rep.areas[1].label?.textKey).to.equal("apgames:icepalace.POOL");
        expect(rep.areas[1].pieces).to.deep.equal(["b1S", "b1L", "b2S", "bWM"]);
        // A click on the Pool changes nothing, whether or not a pyramid is picked.
        let click = g.handleClick("", -1, -1, "b1S");
        expect(click.valid).to.be.false;
        expect(click.move).to.equal("");
        click = g.handleClick("1M", -1, -1, "bWM");
        expect(click.valid).to.be.false;
        expect(click.move).to.equal("1M");
        // An empty Pool shows no area at all.
        g.pool = [];
        expect((g.render() as Rep).areas).to.have.length(1);
    });

    it("counts the pyramids placed so far against the number to build", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("1S@1,0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        const placed = () => g.sidebarStatuses().find(st =>
            typeof st.key === "object" && st.key !== null && "textKey" in st.key && st.key.textKey === "apgames:status.icepalace.PLACED")!.value;
        expect(placed()).to.deep.equal(["0 / 2"]);
        const tmp = g.clone();
        tmp.move("1M@0,0", { partial: true });
        expect(tmp.sidebarStatuses().find(st =>
            typeof st.key === "object" && st.key !== null && "textKey" in st.key && st.key.textKey === "apgames:status.icepalace.PLACED")!.value)
            .to.deep.equal(["1 / 2"]);
    });

    it("lists every hand in the status panel, with the button beside the lead's", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2S"], ["3L", "3M", "3S"]], fatPool());
        const statuses = g.sidebarStatuses();
        expect(statuses.length).to.be.greaterThan(3);
        // Seat 1 leads the first hand, so its row starts with the button.
        expect(statuses[0].value.length).to.equal(3);
        expect(statuses[0].value[0]).to.deep.equal({ glyph: "piece", colour: 7 });
        expect(statuses[1].value.length).to.equal(1);
        // The front reads a status glyph's name from `glyph`, as Catapult's dagger does.
        expect(statuses[1].value[0]).to.deep.equal({ glyph: "pyramid-up-small-3D", colour: 2 });
        expect(statuses[2].value.length).to.equal(3);
        g.lead = 2;
        expect(g.sidebarStatuses()[0].value.length).to.equal(2);
        expect(g.sidebarStatuses()[1].value[0]).to.deep.equal({ glyph: "piece", colour: 7 });
    });

    it("dots the legal cells once a pyramid is picked, and only then", () => {
        const dotted = (rep: Rep): string[] => {
            const cells: string[] = [];
            rep.pieces.forEach((line, row) => line.forEach((stack, col) => {
                if (stack.includes("dot")) {
                    cells.push(`${row},${col}`);
                }
            }));
            return cells.sort();
        };
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L", "1S"], ["3S"]], fatPool());
        // Nothing picked, nothing dotted; the empty Yard offers only the origin.
        expect(dotted(g.render() as Rep)).to.deep.equal([]);
        g.move("1M", { partial: true });
        expect(dotted(g.render() as Rep)).to.deep.equal(["3,3"]);
        g.move("1M@0,0");
        // A large of the wrong colour can only go on top of the medium at the origin, so
        // the dot rides on that stack rather than replacing it.
        g.move("2L", { partial: true });
        const rep = g.render() as Rep;
        expect(dotted(rep)).to.deep.equal(["3,3"]);
        expect(rep.pieces[3][3]).to.deep.equal(["-", "p1M", "dot"]);
        // A matching small cannot climb onto the medium, so it founds a stack beside it.
        g.move("1S", { partial: true });
        expect(dotted(g.render() as Rep)).to.deep.equal(["2,3", "3,2", "3,4", "4,3"]);
        // Completing the placement clears the dots.
        g.move("1S@1,0");
        expect(dotted(g.render() as Rep)).to.deep.equal([]);
    });
});

describe("Ice Palace: expanding display", () => {
    type Rep = {
        renderer?: string;
        board?: { width: number; height: number; stackOffset?: number } | null;
        legend?: { [k: string]: { name?: string; opacity?: number } };
        pieces: string[][][] | null;
        areas?: { type?: string; pieces?: string[]; stash?: string[][]; stack?: string[] }[];
    };
    const expanding = (g: IcePalaceGame): Rep => g.render({ altDisplay: "expanding" }) as unknown as Rep;

    it("is declared, and turns rotation off for both displays", () => {
        expect(IcePalaceGame.gameinfo.displays).to.deep.equal([{ uid: "expanding", group: "stack" }]);
        expect(IcePalaceGame.gameinfo.flags).to.include("stacking-expanding");
        expect(IcePalaceGame.gameinfo.flags).to.include("custom-rotation");
        expect(new IcePalaceGame(3).getCustomRotation()).to.equal(0);
    });

    it("looks straight down at the same footprint, with translucent stacks and no placeholders", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1L"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("1S@1,0");
        g.palace = new Map([["0,0", ["2L", "1M"]]]);
        const flat = expanding(g);
        const deep = g.render() as unknown as Rep;
        expect(flat.renderer).to.equal("stacking-expanding");
        expect(flat.board).to.deep.include({ width: deep.board!.width, height: deep.board!.height });
        expect(flat.board!.stackOffset).to.be.undefined;
        for (const line of flat.pieces!) {
            for (const stack of line) {
                expect(stack).to.not.include("-");
            }
        }
        // The Palace stack is listed bottom first, drawn from above.
        expect(flat.pieces![3][7 + 2 + 3]).to.deep.equal(["p2L", "p1M"]);
        expect(flat.legend!.p2L).to.deep.equal({ name: "pyramid-up-large-upscaled", colour: 2, opacity: 0.75 });
        expect(flat.legend!.p1M).to.deep.equal({ name: "pyramid-up-medium-upscaled", colour: 1, opacity: 0.75 });
    });

    it("offers the hand, then the stock, as nests of one colour each below the board", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S", "1L", "2L", "WS", "2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        let rep = expanding(g);
        // The hand, then the Pool.
        expect(rep.areas).to.have.length(2);
        expect(rep.areas![0].type).to.equal("localStash");
        // Player 2's hand: a nest per colour, largest at the bottom, in colour order.
        expect(rep.areas![0].stash).to.deep.equal([["s1L"], ["s2L", "s2S", "s2S"], ["sWS"]]);
        expect(rep.legend!.s2L).to.deep.equal({ name: "pyramid-flattened-large", colour: 2 });
        expect(rep.legend!.sWS).to.deep.equal({ name: "pyramid-flattened-small", colour: "#ffffff" });
        // A click on a nested pyramid picks it, like a click in the pieces area.
        expect(g.handleClick("", -1, -1, "s2S").move).to.equal("2S");
        // During the build the stock is offered the same way.
        g.phase = "build";
        g.currplayer = 1;
        g.stock = ["3M", "1S", "3L"];
        g.buildMin = 0;
        rep = expanding(g);
        expect(rep.areas![0].type).to.equal("localStash");
        expect(rep.areas![0].stash).to.deep.equal([["s1S"], ["s3L", "s3M"]]);
    });

    it("accepts the display as a list of active uids, as the front now sends it", () => {
        const g = new IcePalaceGame(3);
        expect((g.render({ altDisplays: ["expanding"] }) as unknown as Rep).renderer).to.equal("stacking-expanding");
        expect((g.render({ altDisplays: [] }) as unknown as Rep).renderer).to.equal("stacking-3D");
    });

    it("shows the Pool below the hand as one stack per colour", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["2S", "1L", "WM", "1S", "1L"]);
        const rep = expanding(g);
        const pool = rep.areas![1];
        expect(pool.type).to.equal("localStash");
        expect(pool.stash).to.deep.equal([["b1L", "b1L", "b1S"], ["b2S"], ["bWM"]]);
        expect(rep.legend!.b1L).to.deep.equal({ name: "pyramid-flattened-large", colour: 1 });
    });

    it("still dots the legal cells once a pyramid is picked", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("1S", { partial: true });
        const rep = expanding(g);
        const dotted: string[] = [];
        rep.pieces!.forEach((line, row) => line.forEach((stack, col) => {
            if (stack.includes("dot")) {
                dotted.push(`${row},${col}`);
            }
        }));
        expect(dotted.sort()).to.deep.equal(["2,3", "3,2", "3,4", "4,3"]);
    });

    it("lays out the hovered stack beside the board, bottom first, from the side", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1L"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("1S@1,0");
        g.palace = new Map([["0,0", ["2L", "1M"]]]);
        // The Yard's origin sits at the centre of the left region.
        let rep = g.renderColumn(3, 3) as unknown as Rep;
        expect(rep.renderer).to.equal("stacking-expanding");
        expect(rep.board).to.be.null;
        expect(rep.areas).to.deep.equal([{ type: "expandedColumn", stack: ["c1M"] }]);
        expect(rep.legend!.c1M).to.deep.equal({ name: "pyramid-flat-medium", colour: 1 });
        // The Palace can be looked into during a hand too.
        rep = g.renderColumn(7 + 2 + 3, 3) as unknown as Rep;
        expect(rep.areas).to.deep.equal([{ type: "expandedColumn", stack: ["c2L", "c1M"] }]);
        expect(Object.keys(rep.legend!).sort()).to.deep.equal(["c1M", "c2L"]);
        // An empty cell, and the gap between the structures, show nothing.
        expect((g.renderColumn(0, 0) as unknown as Rep).areas).to.deep.equal([{ type: "expandedColumn", stack: [] }]);
        expect((g.renderColumn(7, 3) as unknown as Rep).areas).to.deep.equal([{ type: "expandedColumn", stack: [] }]);
    });
});

describe("Ice Palace: event log", () => {
    before(() => {
        addResource("en");
    });
    const names = ["Alice", "Bob", "Carol"];
    const lastLines = (g: IcePalaceGame) => {
        const entries = g.chatLogEntries(names);
        return entries[entries.length - 1].lines;
    };

    it("announces the build with the count and one legal way to do it", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        const lines = lastLines(g);
        const announce = lines.find(l => l.textKey === "apresults:ANNOUNCE.icepalace_build")!;
        expect(announce).to.not.be.undefined;
        expect(announce.textParams).to.include({ count: 1, move: "1M@0,0" });
        // The suggested move is a complete, legal build as it stands.
        const check = g.validateMove(announce.textParams!.move as string);
        expect(check.valid).to.be.true;
        expect(check.complete).to.equal(0);
        // It is quoted for copying, and the line is attributed to the builder.
        const text = g.chatLog(names).flat().join("\n");
        expect(text).to.include("Alice won the hand");
        expect(text).to.include("`1M@0,0`");
        assertChatLogParity(g, names);
    });

    it("says so when nothing from the Yard can be built", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.palace = new Map([["0,0", ["2S"]]]);
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.buildMin).to.equal(0);
        expect(g.moves()).to.deep.equal(["pass"]);
        const keys = lastLines(g).map(l => l.textKey);
        expect(keys).to.include("apresults:ANNOUNCE.icepalace_nobuild");
        expect(keys).to.include("apresults:PASS.icepalace");
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

    it("revives the whole stack, Maps included, from serialized JSON mid-build", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.palace = new Map([["0,0", ["2L"]]]);
        g.lead = 2;
        g.currplayer = 2;
        g.move("1S@0,0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        const stockBefore = [...g.stock];
        const palaceBefore = [...g.palace.entries()].map(([cell, stack]) => [cell, [...stack]]);
        g.move("1S@0,0", { partial: true });
        const json = g.serialize();
        expect(json).to.be.a("string");
        const revived = new IcePalaceGame(json);
        expect(revived.phase).to.equal("build");
        expect(revived.buildMin).to.equal(g.buildMin);
        expect(revived.lead).to.equal(2);
        expect(revived.currplayer).to.equal(2);
        expect(revived.stock).to.deep.equal(stockBefore);
        expect(revived.palace).to.be.instanceOf(Map);
        expect([...revived.palace.entries()]).to.deep.equal(palaceBefore);
        expect(revived.yard).to.be.instanceOf(Map);
        expect(revived.stack.length).to.equal(g.stack.length);
        expect(revived.stack[revived.stack.length - 1]._results).to.deep.equal(g.stack[g.stack.length - 1]._results);
        // The partial placement was never committed, so it is not in the saved state.
        expect(revived.palace.get("0,0")).to.deep.equal(["2L"]);
    });
});

describe("Ice Palace: sequenced turn model and record export", () => {
    const played = (): IcePalaceGame => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        g.move("1M@0,0");
        return g;
    };

    it("refuses to commit an incomplete move", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        expect(() => g.move("1M")).to.throw("FAILSAFE");
        g.move("1M@0,0");
        g.move("pass");
        g.move("pass");
        g.move("1S@1,0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        expect(g.buildMin).to.equal(2);
        expect(() => g.move("1M@0,0;1S")).to.throw("FAILSAFE");
        expect(() => g.move("1M@0,0")).to.throw("FAILSAFE");
        g.move("1M@0,0;1S@0,0");
        expect(g.phase).to.equal("hand");
    });

    it("exports one sparse row per ply, with the hand winner acting twice in a row", () => {
        const g = played();
        expect(g.turnModel()).to.equal("sequenced");
        const plies = g.getPlies();
        expect(plies.map(p => p.actor)).to.deep.equal([1, 2, 3, 1, 1]);
        const rounds = g.getRounds();
        expect(rounds).to.have.length(5);
        for (const row of rounds) {
            expect(row).to.have.length(3);
            expect(row.filter(slot => slot !== null)).to.have.length(1);
        }
        expect(rounds[3][0]).to.not.be.null;
        expect(rounds[4][0]).to.not.be.null;
        expect(rounds[4][1]).to.be.null;
    });

    it("keeps the build announcement out of the published record", () => {
        const g = played();
        const record = (g as unknown as { getMoveList(): (string | { result?: { type: string }[] } | null)[][] }).getMoveList();
        const types = record.flat().flatMap(slot => slot !== null && typeof slot === "object" ? (slot.result ?? []).map(r => r.type) : []);
        expect(types).to.include("place");
        expect(types).to.not.include("announce");
        // The chat log still carries it.
        const keys = g.chatLogEntries(["A", "B", "C"]).flatMap(e => e.lines.map(l => l.textKey));
        expect(keys).to.include("apresults:ANNOUNCE.icepalace_build");
    });
});

const palaceOf = (stacks: Record<string, PieceId[]>): Structure => {
    const struct: Structure = new Map();
    for (const [cell, stack] of Object.entries(stacks)) {
        struct.set(cell, [...stack]);
    }
    return struct;
};

/** Replays a plan against the building code so a reported maximum is never taken on trust. */
const replay = (palace: Structure, pieces: PieceId[], plan: ReturnType<typeof maximumBuild>): void => {
    const struct: Structure = new Map();
    for (const [cell, stack] of palace.entries()) {
        struct.set(cell, [...stack]);
    }
    const pool = [...pieces];
    for (const { piece, cell } of plan.sequence) {
        const idx = pool.indexOf(piece);
        expect(idx, `plan used ${piece}, which was not in the Yard`).to.be.greaterThan(-1);
        pool.splice(idx, 1);
        expect(
            legalPalacePlacement(struct, piece, cell),
            `plan placed ${piece} illegally at ${cell}`,
        ).to.be.true;
        placeInto(struct, piece, cell);
    }
    expect(plan.sequence.length).to.equal(plan.max);
};

const check = (palace: Structure, pieces: PieceId[], expected: number): void => {
    const plan = maximumBuild(palace, pieces);
    replay(palace, pieces, plan);
    expect(plan.max).to.equal(expected);
};

describe("Ice Palace: maximum build", () => {
    it("places nothing when the Yard held only Black and White", () => {
        check(palaceOf({ "0,0": ["1L"] }), [], 0);
    });

    it("stacks a whole large-medium-small tower into an empty Palace", () => {
        check(new Map(), ["1L", "2M", "3S"], 3);
    });

    it("cannot place a second medium with no large left to cover", () => {
        // Seed the large, cover it with one medium, and the other medium is stranded:
        // nothing larger is left to stack onto and its colour tops nothing.
        check(new Map(), ["1L", "2M", "3M"], 2);
    });

    it("finds the ordering that beats a greedy build", () => {
        // Covering the large with the small first strands the medium. The medium has to
        // go down first so the small has a medium to sit on.
        check(palaceOf({ "0,0": ["1L"] }), ["2S", "3M"], 2);
    });

    it("spends the only large top on one colour and strands the other", () => {
        check(palaceOf({ "0,0": ["1L"] }), ["2M", "3M"], 1);
    });

    it("regrows a large top by founding, enabling a second colour", () => {
        // Colour 2 is enabled off the existing large, then its own large is founded as a
        // fresh large top, which colour 3's medium can then use.
        check(palaceOf({ "0,0": ["1L"] }), ["2M", "2L", "3M"], 3);
    });

    it("founds without limit once a colour is enabled", () => {
        const pieces: PieceId[] = [];
        for (let i = 0; i < 12; i++) {
            pieces.push("1S");
        }
        check(palaceOf({ "0,0": ["1L"] }), pieces, 12);
    });

    it("strands colours that are absent when every open top is small", () => {
        check(palaceOf({ "0,0": ["1L", "1M", "1S"] }), ["2S", "2M", "3L"], 0);
    });

    it("places a large only when its own colour is already on an open top", () => {
        check(palaceOf({ "0,0": ["1L", "1M", "1S"] }), ["1L", "1L"], 2);
    });

    it("chains large to medium to small across three new colours", () => {
        check(palaceOf({ "0,0": ["1L"] }), ["2M", "3S"], 2);
    });

    it("opens an empty Palace with a medium when that beats leading with the large", () => {
        // Seeding the large only reaches four. Seeding 2M, covering it with 1S to enable
        // colour 1, then founding 1L as a fresh large top, carries 3M and 4S as well.
        check(new Map(), ["1L", "1S", "2M", "3M", "4S"], 5);
    });

    it("uses every pyramid when each colour has something small enough", () => {
        check(palaceOf({ "0,0": ["1L"], "1,0": ["1L"] }), ["2M", "2S", "3M", "3S"], 4);
    });

    it("keeps the Palace connected and never buries a small", () => {
        const palace = palaceOf({ "0,0": ["1L"] });
        const pieces: PieceId[] = ["1M", "1S", "1L", "2M"];
        const plan = maximumBuild(palace, pieces);
        replay(palace, pieces, plan);
        expect(plan.max).to.equal(4);
    });

    it("does not mutate the Palace it was handed", () => {
        const palace = palaceOf({ "0,0": ["1L"] });
        maximumBuild(palace, ["2M", "2S"]);
        expect(palace.size).to.equal(1);
        expect(palace.get(cellOf(0, 0))).to.deep.equal(["1L"]);
    });
});

/** Exhaustive search over every legal build order, for cross-checking small positions. */
const bruteForce = (palace: Structure, pieces: PieceId[]): number => {
    const memo = new Map<string, number>();

    const key = (struct: Structure, remaining: PieceId[]): string => {
        const cells = [...struct.keys()].map(c => {
            const parts = c.split(",");
            return [Number(parts[0]), Number(parts[1])] as [number, number];
        });
        const minX = Math.min(...cells.map(c => c[0]));
        const minY = Math.min(...cells.map(c => c[1]));
        const board = [...struct.entries()]
            .map(([c, stack]) => {
                const parts = c.split(",");
                return `${Number(parts[0]) - minX},${Number(parts[1]) - minY}:${stack.join("")}`;
            })
            .sort()
            .join("|");
        return `${board}//${[...remaining].sort().join(",")}`;
    };

    const search = (struct: Structure, remaining: PieceId[]): number => {
        if (remaining.length === 0) {
            return 0;
        }
        const memoKey = key(struct, remaining);
        const cached = memo.get(memoKey);
        if (cached !== undefined) {
            return cached;
        }
        let best = 0;
        for (const piece of new Set(remaining)) {
            for (const cell of legalCellsFor(struct, piece, legalPalacePlacement)) {
                const next: Structure = new Map();
                for (const [c, stack] of struct.entries()) {
                    next.set(c, [...stack]);
                }
                placeInto(next, piece, cell);
                const rest = [...remaining];
                rest.splice(rest.indexOf(piece), 1);
                best = Math.max(best, 1 + search(next, rest));
                if (best === remaining.length) {
                    memo.set(memoKey, best);
                    return best;
                }
            }
        }
        memo.set(memoKey, best);
        return best;
    };

    return search(palace, pieces);
};

describe("Ice Palace: maximum build matches exhaustive search", () => {
    const palaces: Record<string, Structure> = {
        "a lone large": palaceOf({ "0,0": ["1L"] }),
        "a lone small": palaceOf({ "0,0": ["1S"] }),
        "a finished tower": palaceOf({ "0,0": ["1L", "2M", "3S"] }),
        "two adjacent larges": palaceOf({ "0,0": ["1L"], "1,0": ["2L"] }),
        "a large beside a covered medium": palaceOf({ "0,0": ["1L"], "0,1": ["2L", "3M"] }),
    };

    const yards: PieceId[][] = [
        ["1S"],
        ["4L"],
        ["2M", "3M"],
        ["2M", "3S"],
        ["1S", "1M"],
        ["2L", "2S"],
        ["3M", "3S", "4M"],
        ["1M", "2S", "3L"],
        ["2S", "2S", "3M"],
    ];

    for (const [name, palace] of Object.entries(palaces)) {
        for (const yard of yards) {
            it(`${name} + [${yard.join(" ")}]`, () => {
                const plan = maximumBuild(palace, yard);
                replay(palace, yard, plan);
                expect(plan.max, "solver must never claim more than is reachable").to.equal(
                    bruteForce(palace, yard),
                );
            });
        }
    }
});
