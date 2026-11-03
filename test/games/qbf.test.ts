/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { QBFGame, qbfLegalSquares, qbfNeighbours, qbfOwners, qbfSettled, type playerid } from "../../src/games/qbf";
import type { Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { addResource } from "../../src";

// Board notation: columns a-i (a-g on the 7x7 board, a-m on 13x13) left to
// right, rows 1-9 bottom to top.  Red (player 1) places the root first, then
// Blue (player 2) places, and the players alternate.  A move is the square
// the checker is placed on, e.g. "e5".

// Figures 2 and 3 of the rule sheet, on the 7x7 board: the root on c4, then
// nine placements alternating Blue and Red.  In Figure 2 Blue owns the root;
// the red checker on c7 of Figure 3 gives it back to Red.
const FIGURE_2 = ["c4", "d4", "c5", "c6", "e4", "b6", "d3", "d2", "e5", "a6"];
const FIGURE_3 = [...FIGURE_2, "c7"];

// A random 7x7 game that ends early: after f4 the owner of the root (e7)
// can no longer change, although squares are still open.
const EARLY_GAME = ["e7", "e6", "d6", "d5", "c6", "b6", "a6", "f6", "b7", "g6", "g5", "d4", "e4", "f4"];

// A random 7x7 game that runs until no square can take a checker.
const FULL_GAME = ["b7", "b6", "c7", "b5", "a6", "c5", "c4", "d5", "d7", "c3", "b3", "e7", "a3", "b2", "d3", "e3", "f3", "a4", "f4", "b1", "e5", "c1", "d1", "e1", "f2", "g3", "f7", "g7", "a1", "f6"];

function play(moves: string[], variants: string[] = ["size-7"]): QBFGame {
    const g = new QBFGame(undefined, variants);
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

/** The owners as a sorted list of "cell:owner" strings. */
function ownerList(g: QBFGame): string[] {
    return [...g.owners().entries()].map(([cell, who]) => `${cell}:${who}`).sort();
}

/** Cells of the annotations of the given type, in algebraic notation. */
function annotated(g: QBFGame, type: string): string[][] {
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

describe("QBF", () => {
    describe("Rules", () => {
        it("lists orthogonal neighbours only", () => {
            // the centre of a 3x3 board and its top left corner
            expect(qbfNeighbours(4, 3).sort()).to.deep.equal([1, 3, 5, 7]);
            expect(qbfNeighbours(0, 3).sort()).to.deep.equal([1, 3]);
        });

        it("allows any square for the root and then only squares beside exactly one checker", () => {
            const empty = new Array<boolean>(9).fill(false);
            expect(qbfLegalSquares(empty, 3)).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7, 8]);
            // a root at the centre: its four neighbours
            const centre = [...empty];
            centre[4] = true;
            expect(qbfLegalSquares(centre, 3)).to.deep.equal([1, 3, 5, 7]);
            // a second checker above it: the corners beside that checker touch it alone, the others touch the root alone
            centre[1] = true;
            expect(qbfLegalSquares(centre, 3)).to.deep.equal([0, 2, 3, 5, 7]);
        });

        it("reproduces the claims of Figures 2 and 3 of the rule sheet", () => {
            const g2 = play(FIGURE_2);
            expect(g2.root).to.equal("c4");
            expect(g2.gameover).to.be.false;
            expect(ownerList(g2)).to.deep.equal(["a6:2", "b6:2", "c4:2", "c5:2", "c6:2", "d2:2", "d3:2", "d4:1", "e4:1", "e5:1"]);
            expect(g2.rootOwner()).to.equal(2);
            const g3 = play(FIGURE_3);
            expect(ownerList(g3)).to.deep.equal(["a6:2", "b6:2", "c4:1", "c5:1", "c6:1", "c7:1", "d2:2", "d3:2", "d4:1", "e4:1", "e5:1"]);
            expect(g3.rootOwner()).to.equal(1);
            expect(g3.gameover).to.be.false;
            // Figure 1: the root on f3 with a blue checker on e3 and a red one on e4
            const g1 = play(["f3", "e3", "e4"]);
            expect(g1.legalSquares().sort()).to.deep.equal(["d3", "d4", "e2", "e5", "f2", "g3"]);
        });

        it("settles the owner of the root only when no continuation could change it, exhaustively on the 3x3 board", () => {
            // Every reachable position on the 3x3 board, from every root
            // square.  Where the structural test says the root is settled,
            // every complete continuation must end with that owner, and the
            // test must never miss a position whose every continuation
            // agrees when it is also closed everywhere.
            const size = 3;
            const other = (c: playerid): playerid => c === 1 ? 2 : 1;
            let settledCalls = 0;
            let unsound = 0;
            let decided = 0;
            let caught = 0;
            // the set of owners of the root over all complete continuations
            const outcomes = (colours: (playerid | undefined)[], root: number, toMove: playerid): Set<playerid> => {
                const occupied = colours.map(c => c !== undefined);
                const legal = qbfLegalSquares(occupied, size);
                const result = qbfSettled(colours, root, size);
                settledCalls++;
                if (legal.length === 0) {
                    const owner = qbfOwners(colours, root, size)[root]!;
                    if (result !== undefined && result !== owner) {
                        unsound++;
                    }
                    return new Set([owner]);
                }
                const all = new Set<playerid>();
                for (const sq of legal) {
                    colours[sq] = toMove;
                    for (const o of outcomes(colours, root, other(toMove))) {
                        all.add(o);
                    }
                    colours[sq] = undefined;
                }
                if (result !== undefined) {
                    if (all.size !== 1 || !all.has(result)) {
                        unsound++;
                    }
                }
                if (all.size === 1) {
                    decided++;
                    if (result !== undefined) {
                        caught++;
                    }
                }
                return all;
            };
            for (const root of [0, 1, 4]) {
                const colours: (playerid | undefined)[] = new Array<playerid | undefined>(size * size).fill(undefined);
                colours[root] = 1;
                outcomes(colours, root, 2);
            }
            expect(settledCalls).to.be.greaterThan(100);
            expect(unsound).to.equal(0);
            expect(decided).to.be.greaterThan(0);
            // the structural test catches most decided positions; the rest need parity reasoning
            expect(caught).to.be.greaterThan(decided / 2);
        });
    });

    describe("Setup", () => {
        it("starts with an empty 9x9 board, Red to place the root anywhere", () => {
            const g = new QBFGame();
            expect(g.boardsize).to.equal(9);
            expect(g.currplayer).to.equal(1);
            expect(g.root).to.be.undefined;
            expect(g.board.size).to.equal(0);
            expect(g.moves().length).to.equal(81);
            expect(g.rootOwner()).to.be.undefined;
            expect(g.settledOwner()).to.be.undefined;
        });

        it("honours the board size variants", () => {
            expect(new QBFGame(undefined, ["size-7"]).boardsize).to.equal(7);
            expect(new QBFGame(undefined, ["size-11"]).boardsize).to.equal(11);
            expect(new QBFGame(undefined, ["size-13"]).boardsize).to.equal(13);
            expect(new QBFGame(undefined, ["size-13"]).moves().length).to.equal(169);
        });

        it("is experimental, uses the pie rule and documents the felt-board palette slots", () => {
            expect(QBFGame.gameinfo.flags).to.include("experimental");
            expect(QBFGame.gameinfo.flags).to.include("pie");
            expect(QBFGame.gameinfo.flags).to.not.include("custom-colours");
            expect(QBFGame.gameinfo.customizations!.map(c => c.num)).to.deep.equal([1, 2, 3, 4, 5, 6]);
            expect(QBFGame.gameinfo.customizations![0]).to.deep.include({player: 1, default: 1});
            expect(QBFGame.gameinfo.customizations![1]).to.deep.include({player: 2, default: 2});
        });
    });

    describe("Moves", () => {
        it("plays a game that runs until no square can take a checker", () => {
            const g = play(FULL_GAME.slice(0, -1));
            expect(g.gameover).to.be.false;
            expect(g.moves().sort()).to.deep.equal(["f6", "g6"]);
            expect(g.currplayer).to.equal(2);
            g.move("f6");
            expect(g.gameover).to.be.true;
            expect(g.moves()).to.deep.equal([]);
            expect(g.legalSquares()).to.deep.equal([]);
            expect(g.winner).to.deep.equal([2]);
            expect(g.rootOwner()).to.equal(2);
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([
                {type: "place", where: "f6"},
                {type: "eog", reason: "root"},
                {type: "winners", players: [2]},
            ]);
            expect(() => g.move("a2")).to.throw();
        });

        it("ends the game as soon as the owner of the root can no longer change", () => {
            const g = play(EARLY_GAME.slice(0, -1));
            expect(g.gameover).to.be.false;
            expect(g.settledOwner()).to.be.undefined;
            g.move("f4");
            expect(g.gameover).to.be.true;
            expect(g.legalSquares().length).to.be.greaterThan(0);
            expect(g.moves()).to.deep.equal([]);
            expect(g.winner).to.deep.equal([1]);
            expect(g.rootOwner()).to.equal(1);
            expect(g.settledOwner()).to.equal(1);
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([
                {type: "place", where: "f4"},
                {type: "eog", reason: "settled"},
                {type: "winners", players: [1]},
            ]);
        });

        it("records the root and alternates the colours", () => {
            const g = play(FIGURE_2);
            expect(g.stack[1]._results).to.deep.equal([{type: "place", where: "c4", what: "root"}]);
            expect(g.stack[2]._results).to.deep.equal([{type: "place", where: "d4"}]);
            expect(g.board.get("c4")).to.equal(1);
            expect(g.board.get("d4")).to.equal(2);
            expect(g.board.get("c5")).to.equal(1);
            expect(g.currplayer).to.equal(1);
            expect(g.lastmove).to.equal("a6");
        });

        it("rejects moves that break the rules, with the right explanation", () => {
            addResource("en");
            const g = play(["f3", "e3", "e4"]);
            expect(g.validateMove("").valid).to.be.true;
            expect(g.validateMove("").complete).to.equal(-1);
            expect(g.validateMove("").message).to.equal(i18next.t("apgames:validation.qbf.INITIAL_INSTRUCTIONS"));
            expect(g.validateMove("e3").valid).to.be.false;
            expect(g.validateMove("e3").message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "e3"}));
            expect(g.validateMove("a1").valid).to.be.false;
            expect(g.validateMove("a1").message).to.equal(i18next.t("apgames:validation.qbf.NOT_ADJACENT", {where: "a1"}));
            expect(g.validateMove("f4").valid).to.be.false;
            expect(g.validateMove("f4").message).to.equal(i18next.t("apgames:validation.qbf.TOO_MANY", {where: "f4"}));
            expect(g.validateMove("z9").valid).to.be.false;
            expect(g.validateMove("z9").message).to.equal(i18next.t("apgames:validation._general.INVALIDCELL", {cell: "z9"}));
            expect(g.validateMove("d3").valid).to.be.true;
            expect(g.validateMove("d3").complete).to.equal(1);
            expect(() => g.move("f4")).to.throw();
            expect(() => g.move("a1")).to.throw();
            // before the root, any square is fine
            const fresh = new QBFGame();
            expect(fresh.validateMove("").message).to.equal(i18next.t("apgames:validation.qbf.INITIAL_INSTRUCTIONS_ROOT"));
            expect(fresh.validateMove("a1").valid).to.be.true;
            expect(fresh.validateMove("i9").valid).to.be.true;
        });

        it("builds moves from clicks", () => {
            addResource("en");
            const g = play(["f3", "e3", "e4"]);
            const click = (move: string, cell: string) => {
                const [x, y] = g.algebraic2coords(cell);
                return g.handleClick(move, y, x);
            };
            const good = click("", "d3");
            expect(good.valid).to.be.true;
            expect(good.move).to.equal("d3");
            expect(good.complete).to.equal(1);
            // an illegal square leaves nothing entered
            const bad = click("", "f4");
            expect(bad.valid).to.be.false;
            expect(bad.move).to.equal("");
            expect(bad.message).to.equal(i18next.t("apgames:validation.qbf.TOO_MANY", {where: "f4"}));
            expect(click("", "e3").valid).to.be.false;
            // a second click replaces the entered square
            expect(click("d3", "g3").move).to.equal("g3");
            expect(click("d3", "a1").move).to.equal("");
        });

        it("serializes and clones with the history intact", () => {
            const g = play(EARLY_GAME);
            const again = new QBFGame(g.serialize());
            expect(again.stack.length).to.equal(EARLY_GAME.length + 1);
            expect(again.gameover).to.be.true;
            expect(again.winner).to.deep.equal([1]);
            expect(again.root).to.equal("e7");
            expect(again.boardsize).to.equal(7);
            expect(ownerList(again)).to.deep.equal(ownerList(g));
            const c = g.clone();
            expect(c.moves()).to.deep.equal([]);
            expect(c.root).to.equal("e7");
            // load() restores stack[idx] board state; gameover/winner stay at the serialized top-level values
            again.load(3);
            expect(again.currplayer).to.equal(2);
            expect(again.board.size).to.equal(3);
            expect(again.root).to.equal("e7");
            expect(again.gameover).to.be.true;
            expect(again.winner).to.deep.equal([1]);
            expect(again.moves()).to.deep.equal([]);
        });
    });

    describe("Chat log", () => {
        it("names the root placement and the winner", () => {
            addResource("en");
            const names = ["Red player", "Blue player"];
            const g = play(EARLY_GAME);
            const entries = g.chatLogEntries(names);
            expect(entries[0].lines.map(l => l.textKey)).to.deep.equal(["apresults:qbf.PLACE.root"]);
            expect(entries[0].lines[0].textParams).to.include({where: "e7"});
            expect(entries[1].lines.map(l => l.textKey)).to.deep.equal(["apresults:_general.PLACE.nowhat"]);
            const last = entries[entries.length - 1];
            expect(last.lines.map(l => l.textKey)).to.deep.equal([
                "apresults:_general.PLACE.nowhat",
                "apresults:qbf.EOG.settled",
                "apresults:_general.WINNERS",
            ]);
            expect(last.lines[1].textParams).to.deep.equal({player: "Red player"});
            assertChatLogParity(g, names);
            expect(g.formatEogSummary(names, (key, params) => i18next.t(key, params))).to.equal(i18next.t("apresults:qbf.EOG.settled", {player: "Red player"}));
            const full = play(FULL_GAME);
            const fullLast = full.chatLogEntries(names).slice(-1)[0];
            expect(fullLast.lines[1].textKey).to.equal("apresults:qbf.EOG.root");
            expect(fullLast.lines[1].textParams).to.deep.equal({player: "Blue player"});
            assertChatLogParity(full, names);
        });
    });

    describe("Rendering", () => {
        it("renders the felt board with customizable palette slots and owner marks", () => {
            const g = play(FIGURE_2);
            const rep = g.render();
            const board = rep.board as {
                style: string;
                checkeredLight: Colourfuncs;
                checkeredDark: Colourfuncs;
            };
            expect(board.style).to.equal("squares-checkered");
            expect(board.checkeredLight).to.deep.equal({func: "custom", default: "#e8d6b2", palette: 3});
            expect(board.checkeredDark).to.deep.equal({func: "custom", default: "#b08e60", palette: 4});
            expect(rep.glyphDefs).to.be.undefined;
            expect(rep.legend).to.have.all.keys("A", "B", "C", "D", "E", "F", "H");
            expect((rep.legend!.H as {name: string; colour: Colourfuncs}).name).to.equal("piece-square-borderless");
            expect((rep.legend!.H as {colour: Colourfuncs}).colour).to.deep.equal({func: "custom", default: "#28b446", palette: 5});
            // a checker is the marbled piece with a ring and a disc on top; the root is two checkers
            const A = rep.legend!.A as Array<{name: string; paint: {fill: number | string}}>;
            expect(A.map(l => l.name)).to.deep.equal(["piece-marbled", "piece-borderless", "piece-borderless"]);
            expect(A[0].paint.fill).to.equal(1);
            expect(A[2].paint.fill).to.equal(1);
            const B = rep.legend!.B as Array<{name: string; paint: {fill: number | string}}>;
            expect(B[0].paint.fill).to.equal(1);
            expect(B[2].paint.fill).to.equal(2);
            const F = rep.legend!.F as Array<{name: string; paint: {fill: number | string}}>;
            expect(F.map(l => l.name)).to.deep.equal(["piece-marbled", "piece-marbled", "piece-borderless", "piece-borderless"]);
            expect(F[3].paint.fill).to.equal(2);
            // Figure 2: Blue owns the root and the red checkers c5 and c6, Red owns the blue checker d4
            expect(rep.pieces).to.equal("_\nCCC----\n--B-A--\n--FDA--\n---B---\n---C---\n_");
        });

        it("marks the legal squares and the last placement", () => {
            const g = new QBFGame(undefined, ["size-7"]);
            expect(g.render().annotations).to.be.undefined;
            g.move("f3");
            expect(annotated(g, "glyph")).to.deep.equal([["e3", "f2", "f4", "g3"]]);
            expect(annotated(g, "enter")).to.deep.equal([["f3"]]);
            const enter = (g.render().annotations ?? []).find(a => a.type === "enter") as {colour: Colourfuncs};
            expect(enter.colour).to.deep.equal({func: "custom", default: "#f5c542", palette: 6});
            g.move("e3");
            g.move("e4");
            expect(annotated(g, "glyph")).to.deep.equal([["d3", "d4", "e2", "e5", "f2", "g3"]]);
            expect(annotated(g, "enter")).to.deep.equal([["e4"]]);
            // the red checker on e4 is owned by Red, so the blue checker on e3 and the root belong to Red too
            expect(g.render().pieces).to.equal("_\n_\n_\n----A--\n----DE-\n_\n_");
        });

        it("shows no legal squares once the game is over", () => {
            const g = play(EARLY_GAME);
            expect(annotated(g, "glyph")).to.deep.equal([]);
            expect(annotated(g, "enter")).to.deep.equal([["f4"]]);
            expect(annotated(play(FULL_GAME), "glyph")).to.deep.equal([]);
        });
    });

    describe("Random play", () => {
        it("always ends with the owner of the root as the only winner, on every board", () => {
            const rnd = seededRandom(2026);
            let early = 0;
            for (const variants of [["size-7"], [], ["size-11"], ["size-13"]]) {
                for (let n = 0; n < 8; n++) {
                    const g = new QBFGame(undefined, variants);
                    let plies = 0;
                    while (!g.gameover) {
                        const moves = g.moves();
                        expect(moves.length).to.be.greaterThan(0);
                        g.move(moves[Math.floor(rnd() * moves.length)]);
                        plies++;
                        expect(plies).to.be.lessThan(200);
                    }
                    expect(g.winner).to.deep.equal([g.rootOwner()]);
                    const eog = g.stack[g.stack.length - 1]._results.find(r => r.type === "eog") as {reason: string};
                    if (g.legalSquares().length === 0) {
                        expect(eog.reason).to.equal("root");
                    } else {
                        expect(eog.reason).to.equal("settled");
                        expect(g.settledOwner()).to.equal(g.rootOwner());
                        early++;
                    }
                }
            }
            expect(early).to.be.greaterThan(0);
        });
    });
});
