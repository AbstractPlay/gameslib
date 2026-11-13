/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import {
    CounterflowGame, cfDistances, cfFarRow, cfGroups, cfHasWon, cfIsWall, cfMoves, cfShortestDistance, cfStart,
    type CfBoard, type playerid,
} from "../../src/games/counterflow";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { addResource } from "../../src";

// Board notation: columns a, b, c... left to right, rows 1, 2, 3... bottom to
// top.  Red (player 1) starts below the empty middle row and moves up, so
// Red's far row is the top row.  Blue (player 2) starts above the middle row
// and moves down.  Red moves first.  A move is written from-to, e.g. "a2-a3".
// Positions are written as the rows of the board from the top, separated by
// "/", with R for a red checker, B for a blue checker and "." for an
// unoccupied square.

// The figures of the rule sheet (https://www.marksteeregames.com/Counterflow_rules.pdf), all on the 5x5 board.
const FIGURE_1 = "BBBBB/BBBBB/...../RRRRR/RRRRR";  // the starting position
const FIGURE_2 = ".RRRR/BBB../.BRRB/RBRBB/RB.BR";  // Blue has won
const FIGURE_3 = "BBBBB/B.BBB/B..R./RRR.R/RRRRR";  // no red checker may move to d2
const FIGURE_4 = "B.BBB/.BBBB/BBRRR/RRR.R/RR.R.";  // distances to the opening d2; Red's only legal move is c2-d2
// the moves that lead from the starting position to Figure 4
const FIGURE_4_MOVES = ["d2-d3", "c4-b3", "e1-c3", "a4-a3", "c1-e3", "b5-c4"];
// Blue to move wins at once with e3-e2, e3-d3 or c3-d3; Red has no legal move
const WINNING_MOVES = "RRRRR/...RR/BBB.B/BBBB./RRRBB";

// A complete game on the 5x5 board.  At ply 6 Blue has no legal move (d4 would
// complete a wall, everything else is blocked) and the turn is skipped.  At
// ply 8 Blue moves sideways.  Red wins at ply 13.
const GAME_5 = ["a2-a3", "d4-d3", "b2-c3", "c5-e3", "b1-b3", "pass", "a1-a2", "c4-d4", "b3-c4", "b4-b1", "a3-c5", "b5-b3", "c1-b2"];
const GAME_5_SKIP = "BB.BB/BBB.B/RRRBB/..RRR/R.RRR";
const GAME_5_END = "B.RBB/B.RBB/.BRBB/RRRRR/.B.RR";

// A complete game on the 7x7 board with three skipped turns of Red.  Blue wins
// at ply 48 with a sideways move that is legal only because it wins: the
// shortest distance is 0 before the move.
const GAME_7 = [
    "e3-e4", "a5-a4", "c3-c4", "c5-d4", "c4-c5", "b5-c4", "c2-c3", "e5-f4", "g3-g4", "f4-e3", "g2-g3", "b6-b4",
    "f3-f4", "a6-b5", "e4-e5", "d5-e4", "c1-c2", "d6-d5", "c5-b6", "e7-c5", "e2-f3", "c7-d6", "g1-g2", "a7-a6",
    "b6-c7", "e3-e2", "pass", "a6-a5", "pass", "e4-e3", "d3-e4", "b7-b6", "d2-d3", "e3-d2", "d1-c1", "e2-d1",
    "f1-e2", "d4-e3", "d3-d4", "c4-d3", "c3-c4", "b4-c3", "b3-b4", "a4-b3", "pass", "a5-a4", "b4-a5", "a4-b4",
];
const GAME_7_END = "..RB.BB/.BBBBBB/RBBBRBB/.BRRRRR/RBBBBRR/RRRBRRR/RRRBR..";

function fromRows(rows: string): CfBoard {
    return rows.replace(/\//g, "").split("").map(ch => ch === "R" ? 1 : ch === "B" ? 2 : undefined);
}

/** The name of a square of a board `width` columns wide and `height` rows high. */
function name(sq: number, width: number, height: number): string {
    return "abcdefghijk"[sq % width] + (height - Math.floor(sq / width)).toString();
}

/** The legal moves of a player in a position, in algebraic notation and sorted. */
function movesOf(rows: string, player: playerid): string[] {
    const height = rows.split("/").length;
    const width = rows.indexOf("/");
    return cfMoves(fromRows(rows), player, width, height).map(m => `${name(m.from, width, height)}-${name(m.to, width, height)}`).sort();
}

/** The distances of the checkers of a position, by square. */
function distancesOf(rows: string): Record<string, number> {
    const height = rows.split("/").length;
    const width = rows.indexOf("/");
    const out: Record<string, number> = {};
    cfDistances(fromRows(rows), width, height).forEach((d, sq) => {
        if (d !== undefined) {
            out[name(sq, width, height)] = d;
        }
    });
    return out;
}

/** A game on the board of the position (5x5 or 7x7), set up with the position and the player to move. */
function setup(rows: string, player: playerid): CounterflowGame {
    const size = rows.split("/").length;
    const g = new CounterflowGame(undefined, size === 7 ? [] : [`size-${size}`]);
    const board = new Map<string, playerid>();
    fromRows(rows).forEach((who, sq) => {
        if (who !== undefined) {
            board.set(name(sq, size, size), who);
        }
    });
    g.board = board;
    g.currplayer = player;
    return g;
}

/** The position of a game in the notation of the fixtures. */
function rowsOf(g: CounterflowGame): string {
    const rows: string[] = [];
    for (let y = 0; y < g.boardsize; y++) {
        let row = "";
        for (let x = 0; x < g.boardsize; x++) {
            const who = g.board.get(g.coords2algebraic(x, y));
            row += who === 1 ? "R" : who === 2 ? "B" : ".";
        }
        rows.push(row);
    }
    return rows.join("/");
}

function play(moves: string[], variants: string[] = []): CounterflowGame {
    const g = new CounterflowGame(undefined, variants);
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

/** The cells of every annotation of the given type, in algebraic notation and sorted. */
function annotated(g: CounterflowGame, type: string): string[][] {
    const annotations = (g.render().annotations ?? []) as Array<{type: string; targets?: Array<{row: number; col: number}>}>;
    return annotations.filter(a => a.type === type).map(a => a.targets!.map(t => g.coords2algebraic(t.col, t.row)).sort());
}

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

describe("Counterflow", () => {
    describe("Rules", () => {
        it("starts with an empty middle row, Blue above it and Red below it", () => {
            expect(cfStart(5, 5)).to.deep.equal(fromRows(FIGURE_1));
            expect(cfFarRow(1, 5)).to.equal(0);
            expect(cfFarRow(2, 5)).to.equal(4);
            // only the front row can move, one step straight or diagonally into the middle row
            expect(movesOf(FIGURE_1, 1)).to.deep.equal(["a2-a3", "a2-b3", "b2-a3", "b2-b3", "b2-c3", "c2-b3", "c2-c3", "c2-d3", "d2-c3", "d2-d3", "d2-e3", "e2-d3", "e2-e3"]);
            expect(movesOf(FIGURE_1, 2)).to.deep.equal(["a4-a3", "a4-b3", "b4-a3", "b4-b3", "b4-c3", "c4-b3", "c4-c3", "c4-d3", "d4-c3", "d4-d3", "d4-e3", "e4-d3", "e4-e3"]);
        });

        it("is won when all of a player's groups have a checker in the far row (Figure 2)", () => {
            const board = fromRows(FIGURE_2);
            const blue = cfGroups(board, 2, 5, 5).map(g => g.map(sq => name(sq, 5, 5)).sort());
            expect(blue).to.deep.equal([["a4", "b1", "b2", "b3", "b4", "c4"], ["d1", "d2", "e2", "e3"]]);
            expect(cfHasWon(board, 2, 5, 5)).to.be.true;
            // Red has four groups, and three of them have no checker in row 5
            expect(cfGroups(board, 1, 5, 5).length).to.equal(4);
            expect(cfHasWon(board, 1, 5, 5)).to.be.false;
            // nobody has won at the start
            expect(cfHasWon(fromRows(FIGURE_1), 1, 5, 5)).to.be.false;
            expect(cfHasWon(fromRows(FIGURE_1), 2, 5, 5)).to.be.false;
        });

        it("forbids completing a wall, but lets a checker move through the square (Figure 3)", () => {
            const board = fromRows(FIGURE_3);
            expect(cfIsWall(board, 1, 4, 5)).to.be.true;
            expect(cfIsWall(board, 1, 3, 5)).to.be.false;
            const red = movesOf(FIGURE_3, 1);
            // none of the red checkers on c1, d1 and e1 may move to d2
            expect(red).to.not.include.members(["c1-d2", "d1-d2", "e1-d2"]);
            // but c1 and e1 may move through d2
            expect(red).to.include.members(["c1-e3", "e1-c3", "e1-b4"]);
            expect(red).to.deep.equal(["a2-b3", "b2-b3", "b2-b4", "b2-c3", "c1-e3", "c2-b3", "c2-c3", "e1-b4", "e1-c3", "e2-e3"]);
        });

        it("allows a wall in the far row and in the next row behind another wall of the same colour", () => {
            // Red may complete the wall in row 5, Red's far row, without winning: the group on a1-a3 stays behind
            expect(movesOf("RRRR./.R.BR/RB..R/RBBBB/RBBBB", 1)).to.deep.equal(["a3-a4", "e4-e5"]);
            // 7x7, a red wall in row 7: Red may complete a second wall in row 6, again without winning
            expect(movesOf("RRRRRRR/RRR.RRR/..RR..B/BBB.BB./BBBRBBB/RRBBBRR/BBBRBBB", 1)).to.deep.equal(["c5-d6", "d3-d4", "d5-d6"]);
            // without the wall in row 7 the same two moves are forbidden
            expect(movesOf("RRRRRR./RRR.RRR/..RR.RB/BBB.BB./BBBRBBB/RRBBBRR/BBBRBBB", 1)).to.deep.equal(["d3-d4", "f6-g7", "g6-g7"]);
        });

        it("counts as an opening every unoccupied square in the next row ahead, except where the checker's colour may not complete a wall (Figures 3 and 4)", () => {
            // Figure 3: d2 is not an opening of any red checker, although it is an opening of the blue checker on a3
            const fig3 = distancesOf(FIGURE_3);
            for (const cell of ["a1", "b1", "c1", "d1", "e1"]) {
                expect(fig3).to.not.have.property(cell);
            }
            expect(fig3.a3).to.equal(3);
            // Figure 4: the blue checkers on a3 and b3 have distances 3 and 2 to d2, although neither can move there
            expect(distancesOf(FIGURE_4)).to.deep.equal({a3: 3, b3: 2, c3: 2, d3: 3, e3: 4});
            expect(cfShortestDistance(fromRows(FIGURE_4), 5, 5)).to.equal(2);
            // an opening straight ahead is at a distance of 0
            expect(cfShortestDistance(fromRows(FIGURE_1), 5, 5)).to.equal(0);
        });

        it("allows a sideways move only if it shortens the shortest distance (Figure 5)", () => {
            // Red's only legal move is the sideways move from c2 to d2
            expect(movesOf(FIGURE_4, 1)).to.deep.equal(["c2-d2"]);
            const after = "B.BBB/.BBBB/BBRRR/RR.RR/RR.R.";
            // the unoccupied square c2 is now an opening of the blue checker on b3 at a distance of 1
            expect(distancesOf(after).b3).to.equal(1);
            expect(cfShortestDistance(fromRows(after), 5, 5)).to.equal(1);
            // with the shortest distance at 0 no sideways move is legal
            expect(cfShortestDistance(fromRows(FIGURE_3), 5, 5)).to.equal(0);
            expect(cfMoves(fromRows(FIGURE_3), 1, 5, 5).some(m => m.sideways)).to.be.false;
        });

        it("always allows a winning move, whether it completes a wall or leaves the shortest distance as it is", () => {
            const board = fromRows(WINNING_MOVES);
            // e2 is not an opening of the blue checker on e3; the shortest distance is 2 (red c1 to e2)
            expect(distancesOf(WINNING_MOVES)).to.deep.equal({a1: 4, b1: 3, c1: 2});
            const blue = cfMoves(board, 2, 5, 5).map(m => ({move: `${name(m.from, 5, 5)}-${name(m.to, 5, 5)}`, sideways: m.sideways, wins: m.wins}));
            expect(blue).to.have.deep.members([
                {move: "e3-e2", sideways: false, wins: true},   // completes a wall
                {move: "e3-d3", sideways: true, wins: true},    // leaves the shortest distance at 2
                {move: "c3-d3", sideways: true, wins: true},
                {move: "d2-e2", sideways: true, wins: false},   // shortens the shortest distance
            ]);
            // Red has no legal move in this position
            expect(cfMoves(board, 1, 5, 5)).to.deep.equal([]);
        });

        it("never leaves both players without a move, on every position of the 3x3 and 2x5 boards", () => {
            // the numbers of positions are those of the designer's own programs
            for (const [width, height, positions, skipped] of [[3, 3, 720, 16], [2, 5, 849, 94]]) {
                const key = (b: CfBoard): string => b.map(x => x ?? 0).join("");
                const mirror = (b: CfBoard): string => {
                    let out = "";
                    for (let r = 0; r < height; r++) {
                        for (let c = width - 1; c >= 0; c--) {
                            out += (b[r * width + c] ?? 0).toString();
                        }
                    }
                    return out;
                };
                const seen = new Set<string>([`${key(cfStart(width, height))}1`]);
                const counted = new Set<string>();
                const skips = new Set<string>();
                const todo: [CfBoard, playerid][] = [[cfStart(width, height), 1]];
                while (todo.length > 0) {
                    const [board, player] = todo.pop()!;
                    if (cfHasWon(board, 1, width, height) || cfHasWon(board, 2, width, height)) {
                        continue;
                    }
                    const other: playerid = player === 1 ? 2 : 1;
                    // positions are counted up to left-right mirroring
                    const canonical = (key(board) < mirror(board) ? key(board) : mirror(board)) + player.toString();
                    counted.add(canonical);
                    const next: CfBoard[] = [];
                    const list = cfMoves(board, player, width, height);
                    if (list.length === 0) {
                        expect(cfMoves(board, other, width, height).length, key(board)).to.be.greaterThan(0);
                        skips.add(canonical);
                        next.push(board);
                    }
                    for (const m of list) {
                        // a queen's move over unoccupied squares: along the row, or toward the far row straight or diagonally
                        const rows = Math.floor(m.to / width) - Math.floor(m.from / width);
                        const cols = (m.to % width) - (m.from % width);
                        expect(m.sideways).to.equal(rows === 0);
                        expect(rows === 0 ? cols !== 0 : (rows < 0) === (player === 1) && (cols === 0 || Math.abs(cols) === Math.abs(rows))).to.be.true;
                        const steps = Math.max(Math.abs(rows), Math.abs(cols));
                        for (let k = 1; k <= steps; k++) {
                            expect(board[m.from + k * (Math.sign(rows) * width + Math.sign(cols))]).to.be.undefined;
                        }
                        const b = [...board];
                        b[m.to] = b[m.from];
                        b[m.from] = undefined;
                        // only the mover can have won
                        expect(cfHasWon(b, other, width, height)).to.be.false;
                        expect(cfHasWon(b, player, width, height)).to.equal(m.wins);
                        next.push(b);
                    }
                    for (const b of next) {
                        const k = key(b) + other.toString();
                        if (!seen.has(k)) {
                            seen.add(k);
                            todo.push([b, other]);
                        }
                    }
                }
                expect(counted.size).to.equal(positions);
                expect(skips.size).to.equal(skipped);
            }
        });
    });

    describe("Setup", () => {
        it("starts on the 7x7 board with three rows of checkers each, Red to move", () => {
            const g = new CounterflowGame();
            expect(g.boardsize).to.equal(7);
            expect(g.currplayer).to.equal(1);
            expect(rowsOf(g)).to.equal("BBBBBBB/BBBBBBB/BBBBBBB/......./RRRRRRR/RRRRRRR/RRRRRRR");
            expect(g.checkers(1).length).to.equal(21);
            expect(g.checkers(2).length).to.equal(21);
            expect(g.moves().length).to.equal(19);
            expect(g.destinations("a3")).to.deep.equal(["a4", "b4"]);
            expect(g.destinations("d3").sort()).to.deep.equal(["c4", "d4", "e4"]);
            expect(g.destinations("d2")).to.deep.equal([]);
        });

        it("honours the board size variants", () => {
            for (const [variant, size] of [["size-5", 5], ["size-9", 9], ["size-11", 11]] as [string, number][]) {
                const g = new CounterflowGame(undefined, [variant]);
                expect(g.boardsize).to.equal(size);
                const filled = (size - 1) / 2;
                expect(g.checkers(1).length).to.equal(size * filled);
                expect(g.checkers(2).length).to.equal(size * filled);
                // the middle row is empty
                for (let x = 0; x < size; x++) {
                    expect(g.board.has(g.coords2algebraic(x, filled))).to.be.false;
                }
                expect(g.moves().length).to.equal(3 * size - 2);
            }
            expect(rowsOf(new CounterflowGame(undefined, ["size-5"]))).to.equal(FIGURE_1);
        });

        it("is experimental and submits skipped turns automatically", () => {
            expect(CounterflowGame.gameinfo.flags).to.include("experimental");
            expect(CounterflowGame.gameinfo.flags).to.include("autopass");
            expect(CounterflowGame.gameinfo.flags).to.not.include("pie");
        });
    });

    describe("Moves", () => {
        it("reaches Figure 4 of the rule sheet, where Red's only legal move is sideways", () => {
            const g = play(FIGURE_4_MOVES, ["size-5"]);
            expect(rowsOf(g)).to.equal(FIGURE_4);
            expect(g.currplayer).to.equal(1);
            expect(g.distance("a3")).to.equal(3);
            expect(g.distance("b3")).to.equal(2);
            expect(g.distance("c3")).to.equal(2);
            expect(g.distance("a1")).to.be.undefined;
            expect(g.shortestDistance()).to.equal(2);
            expect(g.moves()).to.deep.equal(["c2-d2"]);
            g.move("c2-d2");
            expect(g.shortestDistance()).to.equal(1);
            expect(g.distance("b3")).to.equal(1);
            expect(g.moves()).to.deep.equal(["b3-c2"]);
        });

        it("skips the turn of a player with no legal move", () => {
            const g = play(GAME_5.slice(0, 5), ["size-5"]);
            expect(rowsOf(g)).to.equal(GAME_5_SKIP);
            // Blue has no legal move: d4 would complete a wall and everything else is blocked
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.deep.equal(["pass"]);
            expect(g.validateMove("pass").valid).to.be.true;
            expect(g.validateMove("pass").complete).to.equal(1);
            expect(g.validateMove("d5-d4").valid).to.be.false;
            // the other player has a move
            expect(g.moves(1)).to.not.include("pass");
            g.move("pass");
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([{type: "pass"}]);
            expect(rowsOf(g)).to.equal(GAME_5_SKIP);
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("pass").valid).to.be.false;
            expect(() => g.move("pass")).to.throw();
        });

        it("plays a full game on the 5x5 board to a win for Red", () => {
            const g = play(GAME_5.slice(0, 12), ["size-5"]);
            expect(g.gameover).to.be.false;
            g.move("c1-b2");
            expect(rowsOf(g)).to.equal(GAME_5_END);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            // one red group, with a checker on c5 in Red's far row
            expect(g.groups(1).length).to.equal(1);
            expect(g.groups(1)[0]).to.include("c5");
            expect(g.moves()).to.deep.equal([]);
            expect(() => g.move("b5-a4")).to.throw();
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([
                {type: "move", from: "c1", to: "b2"},
                {type: "eog", reason: "groups"},
                {type: "winners", players: [1]},
            ]);
        });

        it("plays a full game on the 7x7 board to a win for Blue by a sideways move", () => {
            const g = play(GAME_7.slice(0, 47));
            expect(g.gameover).to.be.false;
            expect(GAME_7.filter(m => m === "pass").length).to.equal(3);
            // the shortest distance is 0, so the only legal sideways moves are those that win
            expect(g.currplayer).to.equal(2);
            expect(g.shortestDistance()).to.equal(0);
            expect(g.moves()).to.include("a4-b4");
            g.move("a4-b4");
            expect(rowsOf(g)).to.equal(GAME_7_END);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            for (const group of g.groups(2)) {
                expect(group.some(cell => cell.endsWith("1"))).to.be.true;
            }
        });

        it("lets a winning move complete a wall or keep the shortest distance", () => {
            for (const m of ["e3-e2", "e3-d3", "c3-d3"]) {
                const g = setup(WINNING_MOVES, 2);
                expect(g.validateMove(m).valid, m).to.be.true;
                g.move(m);
                expect(g.gameover, m).to.be.true;
                expect(g.winner).to.deep.equal([2]);
            }
            const g = setup(WINNING_MOVES, 2);
            expect(g.moves().sort()).to.deep.equal(["c3-d3", "d2-e2", "e3-d3", "e3-e2"]);
            g.move("d2-e2");
            expect(g.gameover).to.be.false;
            // Red has no legal move in the position of the fixture
            expect(setup(WINNING_MOVES, 1).moves()).to.deep.equal(["pass"]);
        });

        it("rejects moves that break the rules, with the right explanation", () => {
            addResource("en");
            const t = (key: string, params?: Record<string, string>): string => i18next.t(`apgames:validation.${key}`, params);
            // Figure 3, Red to move: the shortest distance is 0
            let g = setup(FIGURE_3, 1);
            for (const from of ["c1", "d1", "e1"]) {
                expect(g.validateMove(`${from}-d2`).valid).to.be.false;
                expect(g.validateMove(`${from}-d2`).message).to.equal(t("counterflow.WALL", {from, to: "d2"}));
            }
            expect(g.validateMove("d3-d2").message).to.equal(t("counterflow.DIRECTION", {from: "d3", to: "d2"}));
            expect(g.validateMove("b2-d3").message).to.equal(t("counterflow.DIRECTION", {from: "b2", to: "d3"}));
            expect(g.validateMove("a2-a3").message).to.equal(t("_general.OCCUPIED", {where: "a3"}));
            expect(g.validateMove("b1-b3").message).to.equal(t("counterflow.BLOCKED", {from: "b1", to: "b3"}));
            expect(g.validateMove("d3-c3").message).to.equal(t("counterflow.SIDEWAYS_ZERO", {from: "d3", to: "c3"}));
            expect(g.validateMove("a3-a2").message).to.equal(t("_general.UNCONTROLLED"));
            expect(g.validateMove("c3-c4").message).to.equal(t("_general.NONEXISTENT", {where: "c3"}));
            expect(g.validateMove("a1").message).to.equal(t("_general.NO_MOVES", {where: "a1"}));
            expect(g.validateMove("b2-z9").valid).to.be.false;
            expect(g.validateMove("b2-b3-b4").valid).to.be.false;
            expect(g.validateMove("pass").message).to.equal(t("counterflow.NO_PASS"));
            expect(() => g.move("c1-d2")).to.throw();
            expect(() => g.move("pass")).to.throw();
            // Figure 4, Red to move: the shortest distance is 2, and only c2-d2 shortens it
            g = setup(FIGURE_4, 1);
            expect(g.validateMove("e2-d2").message).to.equal(t("counterflow.SIDEWAYS", {from: "e2", to: "d2"}));
            expect(g.validateMove("c2-d2").valid).to.be.true;
            // a player with no legal move may only have the turn skipped
            g = setup(WINNING_MOVES, 1);
            expect(g.validateMove("pass").message).to.equal(t("counterflow.MUST_PASS"));
        });

        it("builds moves from clicks", () => {
            const g = new CounterflowGame(undefined, ["size-5"]);
            const click = (move: string, cell: string) => {
                const [x, y] = g.algebraic2coords(cell);
                return g.handleClick(move, y, x);
            };
            // an empty square or an enemy checker does nothing before a checker is selected
            expect(click("", "c3").valid).to.be.false;
            expect(click("", "c3").move).to.equal("");
            expect(click("", "c4").valid).to.be.false;
            // a checker without a legal move cannot be selected
            expect(click("", "c1").valid).to.be.false;
            expect(click("", "c1").move).to.equal("");
            // select a checker
            const first = click("", "c2");
            expect(first.valid).to.be.true;
            expect(first.move).to.equal("c2");
            expect(first.complete).to.equal(-1);
            expect(first.canrender).to.be.true;
            // clicking it again deselects it
            expect(click("c2", "c2").move).to.equal("");
            // another checker can be selected instead
            expect(click("c2", "d2").move).to.equal("d2");
            // an illegal destination keeps the selection
            const bad = click("c2", "c4");
            expect(bad.valid).to.be.false;
            expect(bad.move).to.equal("c2");
            // a legal destination completes the move
            const done = click("c2", "d3");
            expect(done.valid).to.be.true;
            expect(done.move).to.equal("c2-d3");
            expect(done.complete).to.equal(1);
            // a click on a checker after a complete move starts over
            expect(click("c2-d3", "b2").move).to.equal("b2");
            expect(click("c2-d3", "c3").move).to.equal("c2-c3");
        });

        it("serializes and clones with the history intact", () => {
            const g = play(GAME_5, ["size-5"]);
            const again = new CounterflowGame(g.serialize());
            expect(again.stack.length).to.equal(GAME_5.length + 1);
            expect(again.boardsize).to.equal(5);
            expect(again.gameover).to.be.true;
            expect(again.winner).to.deep.equal([1]);
            expect(rowsOf(again)).to.equal(GAME_5_END);
            const c = g.clone();
            expect(c.moves()).to.deep.equal([]);
            expect(rowsOf(c)).to.equal(GAME_5_END);
            // load() restores the position of stack[idx]
            again.load(5);
            expect(again.currplayer).to.equal(2);
            expect(rowsOf(again)).to.equal(GAME_5_SKIP);
            expect(again.lastmove).to.equal("b1-b3");
        });
    });

    describe("Chat log", () => {
        it("reports skipped turns and names the winner", () => {
            addResource("en");
            const names = ["Red player", "Blue player"];
            const g = play(GAME_5, ["size-5"]);
            const entries = g.chatLogEntries(names);
            expect(entries[0].lines.map(l => l.textKey)).to.deep.equal(["apresults:_general.MOVE.nowhat"]);
            expect(entries[0].lines[0].textParams).to.include({from: "a2", to: "a3"});
            // the skipped turn of Blue at ply 6
            expect(entries[5].lines.map(l => l.textKey)).to.deep.equal(["apresults:counterflow.PASS.skipped"]);
            expect(entries[5].lines[0].actor).to.deep.equal({kind: "seat", seat: 2});
            const last = entries[entries.length - 1];
            expect(last.lines.map(l => l.textKey)).to.deep.equal([
                "apresults:_general.MOVE.nowhat",
                "apresults:counterflow.EOG.groups",
                "apresults:_general.WINNERS",
            ]);
            expect(last.lines[1].textParams).to.deep.equal({player: "Red player"});
            assertChatLogParity(g, names);
            const t = (key: string, params?: Record<string, unknown>): string => i18next.t(key, params);
            expect(g.formatEogSummary(names, t)).to.equal(i18next.t("apresults:counterflow.EOG.groups", {player: "Red player"}));
            expect(g.chatLog(names).flat().some(line => line.includes("skipped"))).to.be.true;
            // the 7x7 game: Blue wins
            const g7 = play(GAME_7);
            expect(g7.chatLogEntries(names).slice(-1)[0].lines[1].textParams).to.deep.equal({player: "Blue player"});
            assertChatLogParity(g7, names);
        });
    });

    describe("Rendering", () => {
        it("renders the checkers on a board of one felt colour", () => {
            const g = new CounterflowGame(undefined, ["size-5"]);
            const rep = g.render();
            const board = rep.board as {style: string; width: number; height: number; checkeredLight: unknown; checkeredDark: unknown; markers?: unknown[]};
            expect(board.style).to.equal("squares-checkered");
            expect(board.width).to.equal(5);
            expect(board.height).to.equal(5);
            expect(board.checkeredLight).to.deep.equal(board.checkeredDark);
            expect(board.markers).to.be.undefined;
            expect(rep.glyphDefs).to.be.undefined;
            expect(rep.pieces).to.equal("BBBBB\nBBBBB\n_\nAAAAA\nAAAAA");
            expect((rep.legend!.A as {paint: {fill: number}}).paint.fill).to.equal(1);
            expect((rep.legend!.B as {paint: {fill: number}}).paint.fill).to.equal(2);
        });

        it("marks the checkers that have a legal move, and the squares a selected checker may move to", () => {
            const g = new CounterflowGame(undefined, ["size-5"]);
            // at the start only Red's front row can move
            for (const dots of annotated(g, "dots")) {
                expect(dots).to.deep.equal(["a2", "b2", "c2", "d2", "e2"]);
            }
            expect(annotated(g, "dots").length).to.be.greaterThan(0);
            expect(annotated(g, "glyph")).to.deep.equal([]);
            // a selected checker is marked, with the squares it may move to; the dots are gone
            g.move("c2", {partial: true});
            expect(annotated(g, "glyph")).to.have.deep.members([["c2"], ["b3", "c3", "d3"]]);
            expect(annotated(g, "dots")).to.deep.equal([]);
            // the partial move changes nothing on the board
            expect(rowsOf(g)).to.equal(FIGURE_1);
            expect(g.stack.length).to.equal(1);
        });

        it("marks the checker moved last and the square it came from", () => {
            const g = new CounterflowGame(undefined, ["size-5"]);
            g.move("c2-d3");
            // the moved checker, and nothing else, carries a glyph; the square it came from carries a dot
            expect(annotated(g, "glyph")).to.deep.equal([["d3"]]);
            expect(annotated(g, "dots")).to.deep.include(["c2"]);
            // Blue's checkers that can move are marked as well
            expect(annotated(g, "dots")).to.deep.include(["a4", "b4", "c4", "d4", "e4"]);
            // the marks of the last move stay while the next move is being entered
            g.move("c4", {partial: true});
            expect(annotated(g, "glyph")).to.have.deep.members([["d3"], ["c4"], ["b3", "c2", "c3"]]);
            expect(annotated(g, "dots")).to.deep.equal([["c2"]]);
            // a complete move that has not been submitted shows the move and no dots for the next one
            g.move("c4-c3", {partial: true});
            expect(annotated(g, "glyph")).to.deep.equal([["c3"]]);
            expect(annotated(g, "dots")).to.deep.equal([["c4"]]);
            expect(g.stack.length).to.equal(2);
        });

        it("outlines the winner's groups when the game is over", () => {
            const during = play(GAME_7.slice(0, 47));
            expect((during.render().board as {markers?: unknown[]}).markers).to.be.undefined;
            const g = play(GAME_7);
            const rep = g.render();
            expect(rep.annotations).to.be.undefined;
            const markers = (rep.board as {markers: Array<{type: string; sides: Array<{cell: {row: number; col: number}; side: string}>}>}).markers;
            expect(markers.length).to.be.greaterThan(0);
            // every side of a blue checker that does not face another blue checker, and no other side
            const expected: string[] = [];
            const rows = GAME_7_END.split("/");
            const blue = (y: number, x: number): boolean => y >= 0 && y < 7 && x >= 0 && x < 7 && rows[y][x] === "B";
            for (let y = 0; y < 7; y++) {
                for (let x = 0; x < 7; x++) {
                    if (blue(y, x)) {
                        const cell = g.coords2algebraic(x, y);
                        if (!blue(y - 1, x)) { expected.push(`${cell}N`); }
                        if (!blue(y + 1, x)) { expected.push(`${cell}S`); }
                        if (!blue(y, x - 1)) { expected.push(`${cell}W`); }
                        if (!blue(y, x + 1)) { expected.push(`${cell}E`); }
                    }
                }
            }
            for (const marker of markers) {
                const sides = marker.sides.map(s => `${g.coords2algebraic(s.cell.col, s.cell.row)}${s.side}`);
                expect(sides).to.have.members(expected);
                expect(sides.length).to.equal(expected.length);
            }
        });

        it("draws no outline when the game ends without a player reaching the goal", () => {
            const g = play(GAME_7.slice(0, 20));
            g.resign(1);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect((g.render().board as {markers?: unknown[]}).markers).to.be.undefined;
            // nor on an earlier position of a finished game
            const done = play(GAME_7);
            done.load(20);
            expect((done.render().board as {markers?: unknown[]}).markers).to.be.undefined;
            expect(annotated(done, "glyph")).to.deep.equal([["c5"]]);
        });
    });

    describe("Random play", () => {
        it("never deadlocks or repeats a position, and ends with the mover's groups in the far row, on every board", () => {
            const rnd = seededRandom(2026);
            let skippedTurns = 0;
            for (const [variants, games] of [[["size-5"], 12], [[], 4], [["size-9"], 1], [["size-11"], 1]] as [string[], number][]) {
                for (let n = 0; n < games; n++) {
                    const g = new CounterflowGame(undefined, variants);
                    const far = (player: playerid): string => (player === 1 ? g.boardsize : 1).toString();
                    const seen = new Set<string>();
                    let plies = 0;
                    while (!g.gameover) {
                        const position = `${rowsOf(g)} ${g.currplayer}`;
                        expect(seen.has(position)).to.be.false;
                        seen.add(position);
                        const moves = g.moves();
                        expect(moves.length).to.be.greaterThan(0);
                        if (moves[0] === "pass") {
                            expect(moves).to.deep.equal(["pass"]);
                            // the other player can always move
                            expect(g.moves(g.currplayer === 1 ? 2 : 1)).to.not.include("pass");
                            skippedTurns++;
                        }
                        const mover = g.currplayer;
                        g.move(moves[Math.floor(rnd() * moves.length)]);
                        plies++;
                        expect(plies).to.be.lessThan(3000);
                        if (g.gameover) {
                            expect(g.winner).to.deep.equal([mover]);
                            for (const group of g.groups(mover)) {
                                expect(group.some(cell => cell.slice(1) === far(mover))).to.be.true;
                            }
                            const loser: playerid = mover === 1 ? 2 : 1;
                            expect(g.groups(loser).every(group => group.some(cell => cell.slice(1) === far(loser)))).to.be.false;
                        }
                    }
                }
            }
            expect(skippedTurns).to.be.greaterThan(0);
        });
    });
});
