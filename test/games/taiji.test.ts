/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { TaijiGame } from "../../src/games/taiji";
import { addResource } from "../../src";
import type { APRenderRep, Glyph } from "@abstractplay/renderer/build/schemas/schema";

// the legend entry drawn at `cell`, from a single rep
const legendAt = (game: TaijiGame, cell: string, displays?: string[]): Glyph | Glyph[] => {
    const rep = game.render({ altDisplays: displays }) as APRenderRep;
    const [x, y] = TaijiGame.algebraic2coords(cell, game.boardSize);
    const key = (rep.pieces as string).split("\n")[y][x];
    return rep.legend![key] as Glyph | Glyph[];
};
const markerText = (entry: Glyph | Glyph[]): string | undefined => {
    if (!Array.isArray(entry)) { return undefined; }
    const text = entry.find(g => "text" in g) as { text: string } | undefined;
    return text?.text;
};
const click = (game: TaijiGame, move: string, cell: string) => {
    const [x, y] = TaijiGame.algebraic2coords(cell, game.boardSize);
    return game.handleClick(move, y, x);
};

describe("Taiji", () => {
    before(() => {
        addResource("en");
    });

    it("lists the new board, group count, opening, and mirroring variants", () => {
        const uids = TaijiGame.gameinfo.variants!.map(v => v.uid);
        expect(uids).to.include.members(["15x15", "fivegroups", "#opening", "pie", "swap-2", "swap-5", "nomirror"]);
        expect(TaijiGame.gameinfo.variants!.find(v => v.uid === "15x15")!.group).to.equal("board");
        expect(TaijiGame.gameinfo.variants!.find(v => v.uid === "fivegroups")!.group).to.equal("groups");
        for (const uid of ["pie", "swap-2", "swap-5"]) {
            expect(TaijiGame.gameinfo.variants!.find(v => v.uid === uid)!.group, uid).to.equal("opening");
        }
        expect(TaijiGame.gameinfo.variants!.find(v => v.uid === "nomirror")!.group).to.be.undefined;
        expect(TaijiGame.gameinfo.displays!.map(d => d.uid)).to.include("fade-nonscoring");
    });

    it("plays on a 15x15 board", () => {
        const game = new TaijiGame(undefined, ["15x15"]);
        expect(game.boardSize).to.equal(15);
        expect((game.render() as APRenderRep).board).to.include({ width: 15, height: 15 });
        expect(game.moves()).to.include("a15,b15");
        expect(game.moves()).to.include("o1,o2");
        game.move("h8,h9");
        expect(new TaijiGame(game.serialize()).boardSize).to.equal(15);
    });

    it("uses no custom buttons and never the generic pie", () => {
        expect(TaijiGame.gameinfo.flags).to.not.include("pie");
        for (const variants of [[], ["pie"], ["swap-2"], ["swap-5"]]) {
            const flags = new TaijiGame(undefined, variants).getFlags();
            expect(flags, variants.join()).to.not.include("pie");
            // every opening decision is a pass, which gets the front end's own Pass button
            expect(flags, variants.join()).to.not.include("custom-buttons");
            expect(flags, variants.join()).to.include("custom-colours");
        }
        const game = new TaijiGame();
        game.move("a1,a2");
        for (const m of ["pass", "swap", "keep"]) {
            expect(game.moves(), m).to.not.include(m);
            expect(game.validateMove(m).valid, m).to.be.false;
        }
        expect(game.getPlayerColour(1)).to.equal(1);
    });

    it("simple pie: the second player may pass to swap colours after the first pair", () => {
        const game = new TaijiGame(undefined, ["pie"]);
        expect(game.moves()).to.not.include("pass");
        expect(game.validateMove("pass").valid).to.be.false;
        expect(game.validateMove("pass").message).to.include("choice of colours");
        game.move("a1,a2");
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.include("c1,c2");
        expect(game.validateMove("").message).to.include("pass to swap colours");
        expect(game.validateMove("pass").complete).to.equal(1);
        expect(game.validateMove("swap").valid).to.be.false;

        // declining by placing ends the offer
        const declines = new TaijiGame(game.serialize());
        declines.move("c1,c2");
        expect(declines.swapped).to.be.false;
        expect(declines.moves()).to.not.include("pass");

        game.move("pass");
        expect(game.lastmove).to.equal("pass");
        expect(game.board.get("a1")).to.equal(1);
        expect(game.swapped).to.be.true;
        expect(game.getPlayerColour(1)).to.equal(2);
        expect(game.currplayer).to.equal(1);
        expect(game.chatLog(["Alice", "Bob"]).flat().some(l => l.includes("Bob invoked the pie rule"))).to.be.true;
        // the light pair now belongs to player 2's score
        expect(game.sidebarScores()[0].scores).to.deep.equal([1, 1]);
        expect(game.getPlayerScore(2)).to.equal(1);
        expect(game.moves()).to.not.include("pass");
        game.move("c1,c2");
        expect(game.moves()).to.not.include("pass");
        expect(new TaijiGame(game.serialize()).getPlayerColour(1)).to.equal(2);
    });

    it("scores the five largest groups", () => {
        const game = new TaijiGame(undefined, ["fivegroups"]);
        // light groups of sizes 6, 5, 4, 3, 2 and 1, well apart
        const groups = [
            ["a1", "a2", "a3", "a4", "a5", "a6"],
            ["c1", "c2", "c3", "c4", "c5"],
            ["e1", "e2", "e3", "e4"],
            ["g1", "g2", "g3"],
            ["i1", "i2"],
            ["i9"],
        ];
        for (const group of groups) {
            for (const cell of group) {
                game.board.set(cell, 1);
            }
        }
        expect(game.getPlayerScore(1)).to.equal(6 + 5 + 4 + 3 + 2);
        expect(game.getPlayerScore(2)).to.equal(0);
        expect(new TaijiGame(undefined, ["threegroups"]).getPlayerScore(1)).to.equal(0);
        // after a swap the players score each other's colour
        game.swapped = true;
        expect(game.getPlayerScore(1)).to.equal(0);
        expect(game.getPlayerScore(2)).to.equal(6 + 5 + 4 + 3 + 2);
        expect(game.sidebarScores()[0].scores).to.deep.equal([0, 20]);
    });

    it("swap-2: the first player places three pairs", () => {
        const game = new TaijiGame(undefined, ["swap-2"]);
        expect(game.moves()).to.deep.equal(["No movelist in opening"]);
        expect(game.validateMove("pass").valid).to.be.false;
        let v = game.validateMove("a1");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(-1);
        v = game.validateMove("a1,a2");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(-1);
        expect(v.canrender).to.be.true;
        // a later pair can't reuse a space taken by an earlier one
        expect(game.validateMove("a1,a2;a2,a3").valid).to.be.false;
        v = game.validateMove("a1,a2;c1,c2;e1,e2");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(1);
        expect(game.validateMove("a1,a2;c1,c2;e1,e2;g1,g2").valid).to.be.false;
        // the pairs are interchangeable, so the move is normalised
        expect(game.validateMove("e1,e2;a1,a2;c1,c2").valid).to.be.false;

        // clicks build the pairs one piece at a time and keep earlier pairs on a bad click
        let r = click(game, "", "e1");
        expect(r.move).to.equal("e1");
        r = click(game, r.move, "e2");
        expect(r.move).to.equal("e1,e2");
        r = click(game, r.move, "a1");
        expect(r.move).to.equal("e1,e2;a1");
        r = click(game, r.move, "a2");
        expect(r.move).to.equal("a1,a2;e1,e2");
        r = click(game, r.move, "c1");
        r = click(game, r.move, "e2");
        expect(r.valid).to.be.false;
        expect(r.move).to.equal("a1,a2;e1,e2;c1");
        r = click(game, r.move, "c2");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        expect(r.move).to.equal("a1,a2;c1,c2;e1,e2");

        game.move(r.move);
        expect(game.board.get("a1")).to.equal(1);
        expect(game.board.get("a2")).to.equal(2);
        expect(game.board.get("e2")).to.equal(2);
        expect(game.currplayer).to.equal(2);
        expect(game.moves()).to.deep.equal(["No movelist in opening", "pass"]);
        expect(game.validateMove("").message).to.include("pass to swap colours");
    });

    it("swap-2: the second player continues, passes to swap, or places two more", () => {
        const start = new TaijiGame(undefined, ["swap-2"]);
        start.move("a1,a2;c1,c2;e1,e2");

        const continues = new TaijiGame(start.serialize());
        expect(continues.validateMove("g1,g2").complete).to.equal(0);
        continues.move("g1,g2");
        expect(continues.board.get("a1")).to.equal(1);
        expect(continues.currplayer).to.equal(1);
        expect(continues.moves()).to.not.include("pass");
        expect(continues.moves()).to.not.include("No movelist in opening");

        const swaps = new TaijiGame(start.serialize());
        swaps.move("pass");
        // the pieces stay as they are; the players now score each other's colour
        expect(swaps.board.get("a1")).to.equal(1);
        expect(swaps.board.get("a2")).to.equal(2);
        expect(swaps.swapped).to.be.true;
        expect(swaps.getPlayerColour(1)).to.equal(2);
        expect(swaps.getPlayerColour(2)).to.equal(1);
        expect(swaps.currplayer).to.equal(1);
        expect(swaps.moves()).to.not.include("pass");
        const log = swaps.chatLog(["Alice", "Bob"]).flat();
        expect(log.some(l => l.includes("Bob invoked the pie rule"))).to.be.true;
        expect(new TaijiGame(swaps.serialize()).getPlayerColour(1)).to.equal(2);

        const defers = new TaijiGame(start.serialize());
        expect(defers.validateMove("g1,g2;i1,i2").complete).to.equal(1);
        expect(defers.validateMove("g1,g2;i1,i2;a4,a5").valid).to.be.false;
        defers.move("g1,g2;i1,i2");
        expect(defers.board.get("a1")).to.equal(1);
        expect(defers.board.get("g1")).to.equal(1);
        expect(defers.board.get("g2")).to.equal(2);
        expect(defers.swapped).to.be.false;
        expect(defers.currplayer).to.equal(1);
        expect(defers.moves()).to.include("pass");
        expect(defers.moves()).to.include("a4,a5");
        expect(defers.validateMove("").message).to.include("place a pair of pieces to keep your colour");

        // passing swaps colours like any other pass: the first player takes dark and the opponent moves
        const swapsLate = new TaijiGame(defers.serialize());
        swapsLate.move("pass");
        expect(swapsLate.swapped).to.be.true;
        expect(swapsLate.getPlayerColour(1)).to.equal(2);
        expect(swapsLate.currplayer).to.equal(2);
        expect(swapsLate.results).to.deep.equal([{ type: "pie" }]);
        expect(swapsLate.moves()).to.not.include("pass");
        expect(swapsLate.chatLog(["Alice", "Bob"]).flat().some(l => l.includes("Alice invoked the pie rule"))).to.be.true;

        // placing keeps the light colour: an ordinary turn, nothing skipped
        defers.move("a4,a5");
        expect(defers.swapped).to.be.false;
        expect(defers.getPlayerColour(1)).to.equal(1);
        expect(defers.currplayer).to.equal(2);
        expect(defers.moves()).to.not.include("pass");
        expect(defers.validateMove("pass").valid).to.be.false;
    });

    it("never lets a turn skip placements, and every pass swaps colours", () => {
        // the swap-2 opening's turns of several pairs must be whole
        const game = new TaijiGame(undefined, ["swap-2"]);
        for (const m of ["a1,a2", "a1,a2;c1,c2", "a1,a2;c1,c2;e1"]) {
            expect(() => game.move(m), m).to.throw();
        }
        expect(game.stack).to.have.length(1);
        game.move("a1,a2;c1,c2;e1,e2");
        expect(() => game.move("g1")).to.throw();
        expect(() => game.move("g1,g2;i1")).to.throw();
        expect(game.stack).to.have.length(2);
        // a lone light piece is never a whole turn either
        expect(() => new TaijiGame().move("e5")).to.throw();
        // with no mirroring, a single pair that leaves the position symmetric needs a second pair
        const mirror = new TaijiGame(undefined, ["swap-2", "nomirror"]);
        mirror.move("a1,a2;e1,e2;i9,i8");
        expect(mirror.validateMove("e9,e8").complete).to.equal(-1);
        expect(() => mirror.move("e9,e8")).to.throw();
        mirror.move("c5,c6;e9,e8");
        expect(mirror.stack).to.have.length(3);
        // every pass in every opening is a swap of colours, never a plain pass
        for (const variants of [["pie"], ["swap-2"], ["swap-5"]]) {
            const g = new TaijiGame(undefined, variants);
            g.move(variants[0] === "swap-2" ? "a1,a2;c1,c2;e1,e2" : "a1,a2");
            g.move("pass");
            expect(g.results, variants.join()).to.deep.equal([{ type: "pie" }]);
            expect(g.swapped, variants.join()).to.be.true;
        }
    });

    it("swap-5: each of the first five pairs may be answered with a pass to swap", () => {
        const game = new TaijiGame(undefined, ["swap-5"]);
        expect(game.moves()).to.not.include("pass");
        game.move("a1,a2");
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.include("c1,c2");
        expect(game.validateMove("").message).to.include("pass to swap colours");
        game.move("pass");
        expect(game.board.get("a1")).to.equal(1);
        expect(game.swapped).to.be.true;
        // no swapping straight back
        expect(game.moves()).to.not.include("pass");
        game.move("c1,c2");
        expect(game.moves()).to.include("pass");
        game.move("pass");
        expect(game.swapped).to.be.false;
        game.move("e1,e2");
        game.move("g1,g2");
        game.move("i1,i2");
        // five pairs are down: one last chance to swap
        expect(game.moves()).to.include("pass");
        game.move("pass");
        expect(game.swapped).to.be.true;
        game.move("a4,a5");
        expect(game.moves()).to.not.include("pass");
        expect(game.validateMove("pass").valid).to.be.false;
    });

    it("swap-5 (no swaps taken) ends the opening after the sixth pair", () => {
        const game = new TaijiGame(undefined, ["swap-5"]);
        game.move("a1,a2");
        game.move("c1,c2");
        game.move("e1,e2");
        game.move("g1,g2");
        game.move("i1,i2");
        // five pairs are down: one last chance to swap
        expect(game.moves()).to.include("pass");
        game.move("a4,a5");
        expect(game.moves()).to.not.include("pass");
        expect(game.validateMove("pass").valid).to.be.false;
    });

    it("no mirroring: forbids moves that leave a symmetric position", () => {
        const game = new TaijiGame(undefined, ["nomirror"]);
        // a pair on the centre line is its own mirror image
        expect(game.validateMove("e4,e5").valid).to.be.false;
        expect(game.moves()).to.not.include("e4,e5");
        expect(game.moves()).to.not.include("d5,e5");
        // a light piece in the centre has no dark neighbour that avoids a symmetry
        expect(game.validateMove("e5").valid).to.be.false;
        // a pair in the corner is fine
        expect(game.validateMove("a1,a2").complete).to.equal(1);
        expect(game.moves()).to.include("a1,a2");
        game.move("a1,a2");
        // the position, not the move, is what matters: completing a mirror image is illegal
        expect(game.validateMove("i1,i2").valid).to.be.false;
        expect(game.validateMove("i9,i8").valid).to.be.false;
        expect(game.validateMove("b5,b6").valid).to.be.true;

        // colours reversed count too: in Tonga, a diagonal pair across the diagonal
        const tonga = new TaijiGame(undefined, ["nomirror", "tonga"]);
        expect(tonga.validateMove("d5,e6").valid).to.be.false;
        expect(tonga.moves()).to.not.include("d5,e6");
        // and a pair along the other diagonal is its own mirror image
        expect(tonga.validateMove("a1,b2").valid).to.be.false;
        expect(tonga.validateMove("a1,b1").valid).to.be.true;

        // without the variant the same moves are fine
        const plain = new TaijiGame();
        expect(plain.validateMove("e4,e5").valid).to.be.true;
        expect(plain.moves()).to.include("e4,e5");
    });

    it("no mirroring: applies to the swap opening too", () => {
        const game = new TaijiGame(undefined, ["nomirror", "swap-2"]);
        // three pairs that are symmetric top to bottom
        expect(game.validateMove("a1,a2;a9,a8;e5,f5").valid).to.be.false;
        expect(game.validateMove("a1,a2;a9,a8;c1,c2").complete).to.equal(1);
    });

    it("draws the long diagonals only in Tonga", () => {
        const plain = new TaijiGame();
        expect((plain.render() as APRenderRep).board).to.not.have.property("markers");
        const tonga = new TaijiGame(undefined, ["tonga"]);
        const board = (tonga.render() as APRenderRep).board as { markers?: { type: string; points: { row: number; col: number }[] }[] };
        expect(board.markers).to.have.length(2);
        for (const marker of board.markers!) {
            expect(marker.type).to.equal("line");
            expect(marker.points).to.have.length(2);
            for (const point of marker.points) {
                expect([0, 9]).to.include(point.row);
                expect([0, 9]).to.include(point.col);
            }
        }
    });

    it("marks exactly the groups that count towards the score", () => {
        const game = new TaijiGame();
        // light: groups of 3, 2, 2, and 1; dark: a single group
        for (const cell of ["a1", "a2", "a3", "c1", "c2", "e1", "e2", "i9"]) {
            game.board.set(cell, 1);
        }
        for (const cell of ["g1", "g2"]) {
            game.board.set(cell, 2);
        }
        // two groups count by default: the 3 and one of the tied 2s (nothing was ever placed,
        // so the tie falls to the first by name); the other 2 and the 1 are not marked
        for (const cell of ["a1", "a3", "c1", "c2", "g1", "g2"]) {
            expect(markerText(legendAt(game, cell)), cell).to.equal("+");
        }
        for (const cell of ["e1", "e2", "i9"]) {
            expect(markerText(legendAt(game, cell)), cell).to.be.undefined;
        }
        expect(game.render()).to.not.have.property("areas");

        const one = new TaijiGame(undefined, ["onegroup"]);
        one.board = new Map(game.board);
        expect(markerText(legendAt(one, "a1"))).to.equal("+");
        expect(markerText(legendAt(one, "c2"))).to.be.undefined;

        const products = new TaijiGame(undefined, ["products"]);
        products.board = new Map(game.board);
        expect(markerText(legendAt(products, "a1"))).to.equal("×");

        const squares = new TaijiGame(undefined, ["squares"]);
        squares.board = new Map(game.board);
        expect(markerText(legendAt(squares, "a1"))).to.equal("x²");

        // an empty board has nothing to mark
        expect(Object.keys((new TaijiGame().render() as APRenderRep).legend!)).to.have.length(2);

        // the fade display draws pieces outside the scoring groups at 75% opacity
        const opacityOf = (entry: Glyph | Glyph[]): number | undefined => (Array.isArray(entry) ? entry[0] : entry).opacity;
        expect(opacityOf(legendAt(game, "i9"))).to.be.undefined;
        expect(opacityOf(legendAt(game, "i9", ["fade-nonscoring"]))).to.equal(0.75);
        expect(opacityOf(legendAt(game, "e1", ["fade-nonscoring"]))).to.equal(0.75);
        expect(opacityOf(legendAt(game, "a1", ["fade-nonscoring"]))).to.be.undefined;
        expect(markerText(legendAt(game, "a1", ["fade-nonscoring"]))).to.equal("+");
    });

    it("breaks ties between equal groups in favour of the one that grew most recently", () => {
        const game = new TaijiGame();
        const marked = (cells: string[]) => cells.map(cell => markerText(legendAt(game, cell)) === "+");
        game.move("a1,a2");
        game.move("c1,c2");
        game.move("e1,e2");
        // three single light pieces: the two placed last are marked
        expect(marked(["a1", "c1", "e1"])).to.deep.equal([false, true, true]);
        game.move("a3,a4");
        // a newer single supplants the older of the two
        expect(marked(["a1", "c1", "e1", "a3"])).to.deep.equal([false, false, true, true]);
        // b1 joins a1 and c1 into a group of three, which counts along with the newer single
        game.move("b1,b2");
        expect(marked(["a1", "b1", "c1", "e1", "a3"])).to.deep.equal([true, true, true, false, true]);
        // dark: a2-b2-c2 counts, and of the singles the most recent (a4) does
        expect(marked(["a2", "b2", "c2", "a4", "e2"])).to.deep.equal([true, true, true, true, false]);
        // a move still being entered counts as the most recent of all
        game.move("g1", { partial: true });
        expect(marked(["b1", "g1", "a3", "e1"])).to.deep.equal([true, true, false, false]);
    });

    it("keeps exactly the counted groups marked as single-piece groups pile up", () => {
        // well-separated vertical pairs: every move adds one light single and one dark single
        const pairs = ["a1,a2", "c1,c2", "e1,e2", "g1,g2", "i1,i2", "a5,a6", "c5,c6", "e5,e6", "g5,g6", "i5,i6"];
        const markedCells = (g: TaijiGame): string[] => {
            const rows = ((g.render() as APRenderRep).pieces as string).split("\n");
            const cells: string[] = [];
            rows.forEach((row, y) => row.split("").forEach((key, x) => {
                if (key === "C" || key === "D") {
                    cells.push(TaijiGame.coords2algebraic(x, y, g.boardSize));
                }
            }));
            return cells.sort();
        };
        for (const [variant, count] of [[undefined, 2], ["onegroup", 1], ["threegroups", 3]] as const) {
            const game = new TaijiGame(undefined, variant === undefined ? [] : [variant]);
            pairs.forEach((pair, i) => {
                game.move(pair);
                // all groups are tied singles, so only the most recent `count` of each colour are marked
                const expected = pairs.slice(Math.max(0, i + 1 - count), i + 1).flatMap(p => p.split(",")).sort();
                expect(markedCells(game), `${variant ?? "default"} after ${i + 1} moves`).to.deep.equal(expected);
            });
        }
    });

    it("takes a Pass button sent as a click", () => {
        const game = new TaijiGame(undefined, ["pie"]);
        // no decision on the first move: the entry is kept and the reason given
        let r = game.handleClick("e5", -1, -1, "_btn_pass");
        expect(r.valid).to.be.false;
        expect(r.move).to.equal("e5");
        expect(r.message).to.include("choice of colours");
        game.move("a1,a2");
        r = game.handleClick("", -1, -1, "_btn_pass");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        expect(r.move).to.equal("pass");
        // a pair being entered gives way to the pass
        expect(game.handleClick("c1", -1, -1, "_btn_pass").move).to.equal("pass");
        // the swap openings pass the same way
        const swap5 = new TaijiGame(undefined, ["swap-5"]);
        swap5.move("a1,a2");
        expect(swap5.handleClick("", -1, -1, "_btn_pass").move).to.equal("pass");
        // without an opening protocol there is no pass to take
        const plain = new TaijiGame();
        plain.move("a1,a2");
        expect(plain.handleClick("", -1, -1, "_btn_pass").valid).to.be.false;
    });

    it("lets a board click replace a pass that has not been submitted", () => {
        const game = new TaijiGame(undefined, ["swap-5"]);
        game.move("a1,a2");
        const r = click(game, "pass", "c1");
        expect(r.valid).to.be.true;
        expect(r.move).to.equal("c1");
        expect(r.complete).to.equal(-1);
        expect(game.validateMove("pass").complete).to.equal(1);

        const pie = new TaijiGame(undefined, ["pie"]);
        pie.move("a1,a2");
        expect(click(pie, "pass", "c1").move).to.equal("c1");
    });

    it("still plays the base game as before", () => {
        const game = new TaijiGame();
        expect(game.validateMove("e5").complete).to.equal(-1);
        expect(game.validateMove("e5,e6").complete).to.equal(1);
        expect(game.validateMove("e5,f6").valid).to.be.false;
        expect(game.validateMove("e5,e6;a1,a2").valid).to.be.false;
        let r = click(game, "", "e5");
        expect(r.move).to.equal("e5");
        r = click(game, r.move, "e6");
        expect(r.move).to.equal("e5,e6");
        expect(r.complete).to.equal(1);
        game.move("e5,e6");
        expect(game.board.get("e5")).to.equal(1);
        expect(game.board.get("e6")).to.equal(2);
        expect(game.currplayer).to.equal(2);
        expect(game.sidebarScores()[0].scores).to.deep.equal([1, 1]);
    });
});
