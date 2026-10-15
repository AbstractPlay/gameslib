/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { ClearPathGame, cpConnects, cpEdgeChain, cpHasWinningPath, cpLegalPlacements, cpVitalPoints } from "../../src/games/clearpath";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { addResource } from "../../src";

// Board notation: columns a-e left to right, rows 1-5 bottom to top.
// Red (player 1) connects the top and bottom rows.  Blue (player 2) connects
// the left and right columns.

function play(size: number, moves: string[]): ClearPathGame {
    const g = new ClearPathGame(undefined, [`size-${size}`]);
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

function cellsOf(g: ClearPathGame): Uint8Array {
    const n = g.boardsize;
    const cells = new Uint8Array(n * n);
    for (const [cell, who] of g.board) {
        const [x, y] = g.algebraic2coords(cell);
        cells[y * n + x] = who;
    }
    return cells;
}

/** The dot markers of the rendered board, with the points in algebraic notation. */
function dotsOf(g: ClearPathGame): Array<{colour: number | string | undefined; points: string[]}> {
    const board = g.render().board as {markers?: Array<{type: string; colour?: number | string; points?: Array<{row: number; col: number}>}>};
    return (board.markers ?? [])
        .filter(m => m.type === "dots")
        .map(m => ({colour: m.colour, points: m.points!.map(p => g.coords2algebraic(p.col, p.row))}));
}

/** The chain drawn at the end of the game, in algebraic notation. */
function chainOf(g: ClearPathGame): string[] {
    const annotations = (g.render().annotations ?? []) as Array<{type: string; targets?: Array<{row: number; col: number}>}>;
    const move = annotations.find(a => a.type === "move");
    if (move === undefined) {
        return [];
    }
    return move.targets!.map(p => g.coords2algebraic(p.col, p.row));
}

describe("Clear Path", () => {
    describe("Setup", () => {
        it("defaults to a 9x9 board and honours size variants", () => {
            expect(new ClearPathGame().boardsize).to.equal(9);
            expect(new ClearPathGame(undefined, ["size-13"]).boardsize).to.equal(13);
            const g = new ClearPathGame(undefined, ["size-7"]);
            expect(g.moves().length).to.equal(49);
        });

        it("offers the pie swap only after the first placement", () => {
            const g = new ClearPathGame(undefined, ["size-7"]);
            expect(g.isPieTurn()).to.be.false;
            g.move("d4");
            expect(g.isPieTurn()).to.be.true;
            g.move("c3");
            expect(g.isPieTurn()).to.be.false;
        });

        it("rejects bad input", () => {
            const g = play(7, ["d4"]);
            expect(g.validateMove("").valid).to.be.true;
            expect(g.validateMove("").complete).to.equal(-1);
            expect(g.validateMove("z9").valid).to.be.false;
            expect(g.validateMove("d4").valid).to.be.false;
            expect(g.validateMove("pass").valid).to.be.false;
            expect(() => g.move("pass")).to.throw();
        });
    });

    describe("Vital points", () => {
        // Red stones a5, b4, d2, e1 form a diagonal wall with a gap at c3.
        // Every possible Blue connection passes through c3, so c3 is vital
        // to Blue.  Red has other possible connections (column d, say), so c3
        // is not vital to Red, and a red stone there would not complete a
        // winning path.  So Red may not place there.
        const wall = ["a5", "a1", "b4", "e5", "d2", "a2", "e1", "e4"];

        it("forbids a placement on a point vital only to the opponent", () => {
            const g = play(5, wall);
            expect(g.currplayer).to.equal(1);
            const cells = cellsOf(g);
            const vitalBlue = cpVitalPoints(cells, 5, 5, 2);
            const vitalRed = cpVitalPoints(cells, 5, 5, 1);
            const [cx, cy] = g.algebraic2coords("c3");
            expect(vitalBlue[cy * 5 + cx]).to.equal(1);
            expect(vitalRed[cy * 5 + cx]).to.equal(0);
            expect(g.moves()).to.not.include("c3");
            expect(g.moves()).to.include("c4");
            const result = g.validateMove("c3");
            expect(result.valid).to.be.false;
            expect(() => g.move("c3")).to.throw();
        });

        it("marks the illegal placement with a dot in the opponent's colour", () => {
            const g = play(5, wall);
            expect(dotsOf(g)).to.deep.equal([{colour: 2, points: ["c3"]}]);
        });

        it("lets the other player use their own vital point", () => {
            const g = play(5, [...wall, "c4"]);
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.include("c3");
        });

        it("allows a placement on the opponent's vital point when it wins", () => {
            // Red column c1, c2, c4, c5: c3 is vital to Blue and not to Red,
            // but a red stone there completes a winning path.
            const g = play(5, ["c1", "a1", "c2", "a2", "c4", "e1", "c5", "e2"]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("c3");
            // c3 is legal for Red (it wins), so it gets no dot.  b3 and d3
            // are also vital to Blue (every Blue path through c3 enters and
            // leaves through them) and illegal for Red, so they are dotted.
            expect(dotsOf(g)).to.deep.equal([{colour: 2, points: ["b3", "d3"]}]);
            g.move("c3");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.moves()).to.deep.equal([]);
            // nothing is dotted once the game is over, and the winning path is drawn
            expect(dotsOf(g)).to.deep.equal([]);
            expect(chainOf(g)).to.deep.equal(["c5", "c4", "c3", "c2", "c1"]);
            const results = g.stack[g.stack.length - 1]._results;
            expect(results).to.deep.equal([
                {type: "place", where: "c3"},
                {type: "eog"},
                {type: "winners", players: [1]},
            ]);
        });

        it("allows either player to take a point vital to both", () => {
            // Red diagonal a5, b4, _, d2, e1 and Blue diagonal a1, b2, _, d4, e5
            // share the gap c3, which is therefore vital to both players.
            const g = play(5, ["a5", "a1", "b4", "b2", "d2", "d4", "e1", "e5"]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("c3");
            // a point vital to both is legal, so it gets no dot
            expect(dotsOf(g)).to.deep.equal([]);
            const asBlue = g.clone();
            asBlue.currplayer = 2;
            expect(asBlue.moves()).to.include("c3");
            // Red takes it: Blue has no possible connecting path left, so Red wins at once
            g.move("c3");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(cpConnects(cellsOf(g), 5, 5, 2, true)).to.be.false;
            // Blue takes it instead: Blue wins at once
            asBlue.move("c3");
            expect(asBlue.gameover).to.be.true;
            expect(asBlue.winner).to.deep.equal([2]);
        });
    });

    describe("Dots", () => {
        it("dots only the placements that are illegal for the player to move", () => {
            // 7x7, Red to move.  Every possible Blue connection runs through
            // a1, b1 and c1, so all three are vital to Blue and none is vital
            // to Red.  A red stone on b1 completes Red's winning path, so b1
            // is legal for Red and must not be dotted.  a1 and c1 are not.
            const g = play(7, ["d7", "e6", "e7", "e5", "d6", "f5", "d5", "d4", "c5", "f4", "c4", "c3", "b4", "f3", "b3", "c2", "b2", "e3"]);
            expect(g.currplayer).to.equal(1);
            const cells = cellsOf(g);
            const vitalBlue = cpVitalPoints(cells, 7, 7, 2);
            const vital = ["a1", "b1", "c1"].map(c => { const [x, y] = g.algebraic2coords(c); return vitalBlue[y * 7 + x]; });
            expect(vital).to.deep.equal([1, 1, 1]);
            expect(g.moves()).to.include("b1");
            expect(g.moves()).to.not.include("a1");
            expect(g.moves()).to.not.include("c1");
            expect(dotsOf(g)).to.deep.equal([{colour: 2, points: ["a1", "c1"]}]);
            g.move("b1");
            expect(g.winner).to.deep.equal([1]);
        });

        it("dots every empty point when the player to move has no legal placement", () => {
            const g = play(4, cutOffTurn);
            expect(g.moves()).to.deep.equal(["pass"]);
            expect(dotsOf(g)).to.deep.equal([{colour: 2, points: ["a4", "b3", "c3", "d3"]}]);
        });
    });

    // 4x4, Red to move.  Both players still have possible connections, but
    // every empty point (a4, b3, c3, d3) lies on every possible Blue
    // connection and on no vital point of Red, and none of them completes
    // a red path, so Red has no legal placement.
    const cutOffTurn = ["a3", "a1", "b1", "a2", "b2", "b4", "c4", "c1", "d1", "c2", "d2", "d4"];

    describe("Skipped turns", () => {
        it("offers only a pass when there is no legal placement", () => {
            const g = play(4, cutOffTurn);
            expect(g.currplayer).to.equal(1);
            expect(g.gameover).to.be.false;
            const cells = cellsOf(g);
            expect(cpConnects(cells, 4, 4, 1, true)).to.be.true;
            expect(cpConnects(cells, 4, 4, 2, true)).to.be.true;
            expect(Array.from(cpLegalPlacements(cells, 4, 4, 1)).every(v => v === 0)).to.be.true;
            expect(g.moves()).to.deep.equal(["pass"]);
            expect(g.validateMove("pass").valid).to.be.true;
            expect(g.validateMove("b3").valid).to.be.false;
        });

        it("records the pass and hands the turn over", () => {
            const g = play(4, [...cutOffTurn, "pass"]);
            expect(g.currplayer).to.equal(2);
            expect(g.gameover).to.be.false;
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([{type: "pass"}]);
            expect(g.moves()).to.include("b3");
        });
    });

    describe("Cut-off", () => {
        // 7x7.  Red's stones b7, b6, b5, c4, e2, f1 leave the single gap d3
        // in a chain from the top edge to the bottom edge.  Blue's only
        // possible connections run through d3.
        const before = ["b7", "e5", "d7", "f5", "b6", "g5", "b5", "e4", "c4", "a2", "e2", "b2", "f1", "c2"];

        it("ends the game when a placement leaves the opponent without any possible connection", () => {
            const g = play(7, before);
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("d3");
            g.move("d3");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            const cells = cellsOf(g);
            expect(cpHasWinningPath(cells, 7, 7, 1)).to.be.false;
            expect(cpConnects(cells, 7, 7, 2, true)).to.be.false;
            expect(g.moves()).to.deep.equal([]);
            expect(() => g.move("a1")).to.throw();
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([
                {type: "place", where: "d3"},
                {type: "eog", reason: "cutoff"},
                {type: "winners", players: [1]},
            ]);
        });

        it("draws the chain of stones that cuts the opponent off", () => {
            const g = play(7, [...before, "d3"]);
            expect(chainOf(g)).to.deep.equal(["b7", "b6", "b5", "c4", "d3", "e2", "f1"]);
            expect(dotsOf(g)).to.deep.equal([]);
            // the chain is a chain of red stones, orthogonal or diagonal steps, edge to edge
            const chain = cpEdgeChain(cellsOf(g), 7, 7, 1, true).map(idx => g.coords2algebraic(idx % 7, Math.floor(idx / 7)));
            expect(chain).to.deep.equal(["b7", "b6", "b5", "c4", "d3", "e2", "f1"]);
        });

        it("explains the ending in the move log", () => {
            addResource("en");
            const g = play(7, [...before, "d3"]);
            const names = ["Red player", "Blue player"];
            const entries = g.chatLogEntries(names);
            const last = entries[entries.length - 1];
            const keys = last.lines.map(l => l.textKey);
            expect(keys).to.deep.equal([
                "apresults:_general.PLACE.nowhat",
                "apresults:clearpath.EOG.cutoff",
                "apresults:_general.WINNERS",
            ]);
            expect(last.lines[1].textParams).to.deep.equal({player: "Blue player"});
            assertChatLogParity(g, names);
        });

        it("counts a winning placement as a win by connection, not a cut-off", () => {
            const g = play(5, ["c1", "a1", "c2", "a2", "c4", "e1", "c5", "e2", "c3"]);
            expect(g.winner).to.deep.equal([1]);
            expect(g.stack[g.stack.length - 1]._results.some(r => r.type === "eog" && r.reason === "cutoff")).to.be.false;
        });
    });

    describe("Random play", () => {
        it("always ends with exactly one winner, by connection or by cut-off", () => {
            let cutoffs = 0;
            for (let i = 0; i < 30; i++) {
                const g = new ClearPathGame(undefined, ["size-7"]);
                let plies = 0;
                while (!g.gameover) {
                    const moves = g.moves();
                    expect(moves.length).to.be.greaterThan(0);
                    g.move(moves[Math.floor(Math.random() * moves.length)]);
                    plies++;
                    expect(plies).to.be.lessThan(200);
                }
                expect(g.winner.length).to.equal(1);
                const cells = cellsOf(g);
                const winner = g.winner[0];
                const loser = winner === 1 ? 2 : 1;
                const results = g.stack[g.stack.length - 1]._results;
                const byCutoff = results.some(r => r.type === "eog" && r.reason === "cutoff");
                if (byCutoff) {
                    cutoffs++;
                    expect(cpHasWinningPath(cells, 7, 7, winner)).to.be.false;
                    expect(cpConnects(cells, 7, 7, loser, true)).to.be.false;
                } else {
                    expect(cpHasWinningPath(cells, 7, 7, winner)).to.be.true;
                }
                // the loser never has a possible connection left, and the winner's chain is drawn
                expect(cpConnects(cells, 7, 7, loser, true)).to.be.false;
                expect(chainOf(g).length).to.be.greaterThan(1);
                expect(dotsOf(g)).to.deep.equal([]);
                // serialisation round trip
                const g2 = new ClearPathGame(g.serialize());
                expect(g2.board.size).to.equal(g.board.size);
                expect(g2.winner).to.deep.equal(g.winner);
                expect(g2.gameover).to.be.true;
            }
            expect(cutoffs).to.be.greaterThan(0);
        });
    });
});
