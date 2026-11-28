/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { ClearPathGame, cpConnects, cpEdgeChain, cpHasWinningPath, cpLegalPlacements, cpPossibleConnection, cpVitalPoints } from "../../src/games/clearpath";
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
function dotsOf(g: ClearPathGame): Array<{colour: number | string | undefined; size: number | undefined; points: string[]}> {
    const board = g.render().board as {markers?: Array<{type: string; colour?: number | string; size?: number; points?: Array<{row: number; col: number}>}>};
    return (board.markers ?? [])
        .filter(m => m.type === "dots")
        .map(m => ({colour: m.colour, size: m.size, points: m.points!.map(p => g.coords2algebraic(p.col, p.row))}));
}

const RED_DOT = 1;
const BLUE_DOT = 2;
const BOTH_DOT = "#800080";   // a point vital to both players: purple and larger

/** The dots expected for the given vital points: red, blue, both (each list in row-major order, empty lists omitted). */
function expectedDots(red: string[], blue: string[], both: string[]): Array<{colour: number | string; size: number; points: string[]}> {
    const out: Array<{colour: number | string; size: number; points: string[]}> = [];
    if (red.length > 0) { out.push({colour: RED_DOT, size: 0.35, points: red}); }
    if (blue.length > 0) { out.push({colour: BLUE_DOT, size: 0.35, points: blue}); }
    if (both.length > 0) { out.push({colour: BOTH_DOT, size: 0.45, points: both}); }
    return out;
}

/** The winning path drawn as a solid line at the end of the game, in algebraic notation. */
function lineOf(g: ClearPathGame): string[] {
    const annotations = (g.render().annotations ?? []) as Array<{type: string; style?: string; targets?: Array<{row: number; col: number}>}>;
    const line = annotations.find(a => a.type === "line" && a.style !== "dashed");
    if (line === undefined) {
        return [];
    }
    return line.targets!.map(p => g.coords2algebraic(p.col, p.row));
}

/** The possible connection drawn as a dashed line after a cut-off, in algebraic notation. */
function dashedOf(g: ClearPathGame): string[] {
    const annotations = (g.render().annotations ?? []) as Array<{type: string; style?: string; targets?: Array<{row: number; col: number}>}>;
    const line = annotations.find(a => a.type === "line" && a.style === "dashed");
    if (line === undefined) {
        return [];
    }
    return line.targets!.map(p => g.coords2algebraic(p.col, p.row));
}

/** The points shown with a faint stone (still to be placed on the drawn possible connection), in algebraic notation. */
function faintOf(g: ClearPathGame): string[] {
    const rows = (g.render().pieces as string).split("\n");
    const out: string[] = [];
    for (let row = 0; row < rows.length; row++) {
        if (rows[row] === "_") { continue; }
        for (let col = 0; col < rows[row].length; col++) {
            if (rows[row][col] === "C" || rows[row][col] === "D") {
                out.push(g.coords2algebraic(col, row));
            }
        }
    }
    return out;
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

        it("marks the vital point with a dot in its owner's colour, whoever is to move", () => {
            const g = play(5, wall);
            // c3 is vital to Blue; Red has several disjoint possible connections, so no point is vital to Red
            expect(dotsOf(g)).to.deep.equal(expectedDots([], ["c3"], []));
            const asBlue = g.clone();
            asBlue.currplayer = 2;
            expect(dotsOf(asBlue)).to.deep.equal(expectedDots([], ["c3"], []));
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
            // b3, c3 and d3 are vital to Blue (every Blue path crosses column
            // c at c3 and enters and leaves it through b3 and d3), so all three
            // carry a blue dot, c3 included although Red may win there.  Red
            // has other possible connections (down column a and b, say), so no
            // point is vital to Red.
            expect(dotsOf(g)).to.deep.equal(expectedDots([], ["b3", "c3", "d3"], []));
            g.move("c3");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.moves()).to.deep.equal([]);
            // nothing is dotted once the game is over, the winning path is drawn and nothing else
            expect(dotsOf(g)).to.deep.equal([]);
            expect(lineOf(g)).to.deep.equal(["c5", "c4", "c3", "c2", "c1"]);
            expect(dashedOf(g)).to.deep.equal([]);
            expect(faintOf(g)).to.deep.equal([]);
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
            // a point vital to both players carries the larger purple dot, for either player to move
            expect(dotsOf(g)).to.deep.equal(expectedDots([], [], ["c3"]));
            const asBlue = g.clone();
            asBlue.currplayer = 2;
            expect(asBlue.moves()).to.include("c3");
            expect(dotsOf(asBlue)).to.deep.equal(expectedDots([], [], ["c3"]));
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
        it("dots a point vital to the opponent even where the player to move may win on it", () => {
            // 7x7, Red to move.  Every possible Blue connection runs through
            // a1, b1 and c1, so all three are vital to Blue and carry a blue
            // dot.  A red stone on b1 completes Red's winning path, so b1 is
            // legal for Red all the same; a1 and c1 are not.  Red has a
            // possible connection down the empty g column among others, so
            // no point is vital to Red.
            const g = play(7, ["d7", "e6", "e7", "e5", "d6", "f5", "d5", "d4", "c5", "f4", "c4", "c3", "b4", "f3", "b3", "c2", "b2", "e3"]);
            expect(g.currplayer).to.equal(1);
            const cells = cellsOf(g);
            const vitalBlue = cpVitalPoints(cells, 7, 7, 2);
            const vital = ["a1", "b1", "c1"].map(c => { const [x, y] = g.algebraic2coords(c); return vitalBlue[y * 7 + x]; });
            expect(vital).to.deep.equal([1, 1, 1]);
            expect(g.moves()).to.include("b1");
            expect(g.moves()).to.not.include("a1");
            expect(g.moves()).to.not.include("c1");
            expect(dotsOf(g)).to.deep.equal(expectedDots([], ["a1", "b1", "c1"], []));
            g.move("b1");
            expect(g.winner).to.deep.equal([1]);
        });

        it("dots every empty point when the player to move has no legal placement", () => {
            const g = play(4, cutOffTurn);
            expect(g.moves()).to.deep.equal(["pass"]);
            // all four empty points are vital to Blue; Red's possible connections
            // (a4 a3 b3 b2 b1, c4 c3 b3 b2 b1, c4 c3 d3 d2 d1) share no point
            expect(dotsOf(g)).to.deep.equal(expectedDots([], ["a4", "b3", "c3", "d3"], []));
        });

        it("shows the vital points of both players at once, in three colours", () => {
            // 5x5, Red to move.  Red: c1, a5, d5, c3, d4.  Blue: d3, c2, b4, e2, a3.
            // Every possible Red connection runs c4 c3 b3 b2 and then b1 or a2 a1,
            // so c4, b3 and b2 are vital to Red.  Every possible Blue connection
            // reaches c2 through b2 and leaves it through d2, so b2 and d2 are
            // vital to Blue.  b2 is vital to both.
            const g = play(5, ["c1", "d3", "a5", "c2", "d5", "b4", "c3", "e2", "d4", "a3"]);
            expect(g.currplayer).to.equal(1);
            const cells = cellsOf(g);
            const at = (mask: Uint8Array, cell: string) => { const [x, y] = g.algebraic2coords(cell); return mask[y * 5 + x]; };
            const vitalRed = cpVitalPoints(cells, 5, 5, 1);
            const vitalBlue = cpVitalPoints(cells, 5, 5, 2);
            expect(["c4", "b3", "b2"].map(c => at(vitalRed, c))).to.deep.equal([1, 1, 1]);
            expect(["b2", "d2"].map(c => at(vitalBlue, c))).to.deep.equal([1, 1]);
            expect(at(vitalRed, "d2")).to.equal(0);
            expect(at(vitalBlue, "c4")).to.equal(0);
            const dots = expectedDots(["c4", "b3"], ["d2"], ["b2"]);
            expect(dotsOf(g)).to.deep.equal(dots);
            // the same dots on Blue's turn
            const asBlue = g.clone();
            asBlue.currplayer = 2;
            expect(dotsOf(asBlue)).to.deep.equal(dots);
            // and the placements they forbid: a point vital to the opponent alone
            expect(g.moves()).to.not.include("d2");
            expect(g.moves()).to.include.members(["b2", "c4", "b3"]);
            expect(asBlue.moves()).to.not.include.members(["c4", "b3"]);
            expect(asBlue.moves()).to.include.members(["b2", "d2"]);
        });

        it("marks every point vital to both players, there can be more than one", () => {
            // 3x3, Blue to move.  Red: a2, c3, a1.  Blue: a3, c2.  Every possible
            // Red connection runs c3 b3 b2, every possible Blue connection runs
            // a3 b3 b2, so b3 and b2 are both vital to both players.
            const g = play(3, ["a2", "a3", "c3", "c2", "a1"]);
            expect(g.currplayer).to.equal(2);
            expect(dotsOf(g)).to.deep.equal(expectedDots([], [], ["b3", "b2"]));
            expect(g.moves()).to.include.members(["b3", "b2"]);
            // Blue takes b2: Red has no possible connection left, so Blue wins at once
            g.move("b2");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(cpConnects(cellsOf(g), 3, 3, 1, true)).to.be.false;
            expect(dotsOf(g)).to.deep.equal([]);
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

        it("shows a remaining possible connection of the winner as a dashed line", () => {
            const g = play(7, [...before, "d3"]);
            // Red's chain b7 b6 b5 c4 d3 e2 f1 steps diagonally, so it is not drawn.
            // Red's possible connection needing the fewest further stones fills
            // in the staircase: b7 b6 b5 c5 c4 d4 d3 e3 e2 f2 f1, four stones
            // still to be placed (c5, d4, e3, f2).
            expect(lineOf(g)).to.deep.equal([]);
            expect(dotsOf(g)).to.deep.equal([]);
            const dashed = dashedOf(g);
            expect(dashed).to.deep.equal(["b7", "b6", "b5", "c5", "c4", "d4", "d3", "e3", "e2", "f2", "f1"]);
            expect(faintOf(g)).to.deep.equal(["c5", "d4", "e3", "f2"]);
            // orthogonal steps only, edge to edge, every point a red stone or unoccupied
            const cells = cellsOf(g);
            for (let i = 1; i < dashed.length; i++) {
                const [x1, y1] = g.algebraic2coords(dashed[i - 1]);
                const [x2, y2] = g.algebraic2coords(dashed[i]);
                expect(Math.abs(x1 - x2) + Math.abs(y1 - y2)).to.equal(1);
            }
            expect(g.algebraic2coords(dashed[0])[1]).to.equal(0);
            expect(g.algebraic2coords(dashed[dashed.length - 1])[1]).to.equal(6);
            for (const c of dashed) {
                const [x, y] = g.algebraic2coords(c);
                expect(cells[y * 7 + x]).to.not.equal(2);
            }
            // the faint stones are exactly the unoccupied points of the drawn route
            expect([...faintOf(g)].sort()).to.deep.equal(dashed.filter(c => !g.board.has(c)).sort());
            // the chain that cuts Blue off still exists, diagonal steps allowed, but is not drawn
            const chain = cpEdgeChain(cells, 7, 7, 1, true).map(idx => g.coords2algebraic(idx % 7, Math.floor(idx / 7)));
            expect(chain).to.deep.equal(["b7", "b6", "b5", "c4", "d3", "e2", "f1"]);
        });

        it("handles the position of the November 2026 bug report", () => {
            // 7x7.  The player connecting left and right (player 2) sealed the
            // other player off with g1.  Player 2 has no completed path (the
            // sealing chain passes the crosscut d4, e3 / d3, e4), so the win
            // is by cut-off, and the sealing stones are ringed, not joined.
            const g = play(7, ["b7", "a7", "e7", "c7", "c6", "b6", "g6", "d6", "a5", "e6", "c5", "f6", "d5", "b5", "e5", "c4", "f5", "d4", "g5", "a3", "a4", "b3", "b4", "c3", "e4", "e3", "g4", "c2", "d3", "d2", "g3", "f2", "b2", "e1", "e2", "f1", "g2"]);
            expect(g.gameover).to.be.false;
            expect(g.currplayer).to.equal(2);
            // g1 is vital to both players, so player 2 may take it
            expect(g.moves()).to.include("g1");
            g.move("g1");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            const cells = cellsOf(g);
            expect(cpHasWinningPath(cells, 7, 7, 2)).to.be.false;
            expect(cpConnects(cells, 7, 7, 1, true)).to.be.false;
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([
                {type: "place", where: "g1"},
                {type: "eog", reason: "cutoff"},
                {type: "winners", players: [2]},
            ]);
            expect(lineOf(g)).to.deep.equal([]);
            // the drawn possible connection needs one more stone, at d1
            expect(dashedOf(g)).to.deep.equal(["a3", "b3", "c3", "c2", "d2", "d1", "e1", "f1", "g1"]);
            expect(faintOf(g)).to.deep.equal(["d1"]);
            // the chain that cut player 1 off (diagonal steps allowed) is not drawn
            expect(cpEdgeChain(cells, 7, 7, 2, true).map(idx => g.coords2algebraic(idx % 7, Math.floor(idx / 7)))).to.deep.equal(["a3", "b3", "c4", "d4", "e3", "f2", "g1"]);
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
            expect(last.lines[1].textParams).to.deep.equal({player: "Blue player", winner: "Red player"});
            const formatted = g.chatLog(names);
            const lastFormatted = formatted[formatted.length - 1];
            expect(lastFormatted).to.include("Blue player no longer has any possible connection, so Red player cannot be stopped. The dashed line shows one of the possible connections still open to Red player.");
            assertChatLogParity(g, names);
        });

        it("counts a winning placement as a win by connection, not a cut-off", () => {
            const g = play(5, ["c1", "a1", "c2", "a2", "c4", "e1", "c5", "e2", "c3"]);
            expect(g.winner).to.deep.equal([1]);
            expect(g.stack[g.stack.length - 1]._results.some(r => r.type === "eog" && r.reason === "cutoff")).to.be.false;
        });
    });

    describe("Possible connections", () => {
        it("finds the possible connection needing the fewest further stones", () => {
            // 5x5, Red: stones a5 and a1 only.  Column a needs a4, a3, a2 (three stones);
            // every other route needs at least four.
            const g = play(5, ["a5", "e5", "a1", "e4"]);
            const route = cpPossibleConnection(cellsOf(g), 5, 5, 1).map(idx => g.coords2algebraic(idx % 5, Math.floor(idx / 5)));
            expect(route).to.deep.equal(["a5", "a4", "a3", "a2", "a1"]);
            // a cut-off player has none
            const h = play(5, ["a5", "a1", "b4", "b2", "d2", "d4", "e1", "e5", "c3"]);
            expect(h.winner).to.deep.equal([1]);
            expect(cpPossibleConnection(cellsOf(h), 5, 5, 2)).to.deep.equal([]);
            expect(cpPossibleConnection(cellsOf(h), 5, 5, 1).length).to.be.greaterThan(1);
        });
    });

    describe("Random play", () => {
        it("always ends with exactly one winner, by connection or by cut-off", function () {
            this.timeout(20_000);   // the dots are recomputed at every position of every game
            let cutoffs = 0;
            for (let i = 0; i < 30; i++) {
                const g = new ClearPathGame(undefined, ["size-7"]);
                let plies = 0;
                while (!g.gameover) {
                    const moves = g.moves();
                    expect(moves.length).to.be.greaterThan(0);
                    // the dots are the vital points of both players, whoever is to move
                    const cells = cellsOf(g);
                    const vitalRed = cpVitalPoints(cells, 7, 7, 1);
                    const vitalBlue = cpVitalPoints(cells, 7, 7, 2);
                    const red: string[] = [], blue: string[] = [], both: string[] = [];
                    for (let idx = 0; idx < 49; idx++) {
                        const c = g.coords2algebraic(idx % 7, Math.floor(idx / 7));
                        if (vitalRed[idx] === 1 && vitalBlue[idx] === 1) { both.push(c); } else if (vitalRed[idx] === 1) { red.push(c); } else if (vitalBlue[idx] === 1) { blue.push(c); }
                    }
                    const expected = expectedDots(red, blue, both);
                    expect(dotsOf(g)).to.deep.equal(expected);
                    const other = g.clone();
                    other.currplayer = g.currplayer === 1 ? 2 : 1;
                    expect(dotsOf(other)).to.deep.equal(expected);
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
                // a winning path is drawn as a solid line; after a cut-off a possible
                // connection of the winner is drawn dashed, with faint stones on its
                // unoccupied points; never both
                if (byCutoff) {
                    const dashed = dashedOf(g);
                    expect(dashed.length).to.be.greaterThan(1);
                    expect(lineOf(g)).to.deep.equal([]);
                    // (faint stones are listed row by row, the route edge to edge)
                    expect([...faintOf(g)].sort()).to.deep.equal(dashed.filter(c => !g.board.has(c)).sort());
                    expect(faintOf(g).length).to.be.greaterThan(0);
                } else {
                    expect(lineOf(g).length).to.be.greaterThan(1);
                    expect(dashedOf(g)).to.deep.equal([]);
                    expect(faintOf(g)).to.deep.equal([]);
                }
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
