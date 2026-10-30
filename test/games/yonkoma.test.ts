/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { YonkomaGame, ykCheckerMarkup, ykDestinations, ykDistance, ykIsCrosscut, type Pos } from "../../src/games/yonkoma";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { addResource } from "../../src";

// Board notation: columns a-j (a-l on the 12x12 board) left to right, rows 1-10
// bottom to top.  Red (player 1) starts on a1 and j10, Blue (player 2) on a10
// and j1.  Red moves first.  A move is written from-to, e.g. "a1-c3".

// A complete game on the 10x10 board.  Red has no legal move at ply 15 and the
// turn is skipped; at ply 17 Red completes the crosscut d8 e9 (red) / d9 e8
// (blue) and loses.
const FULL_GAME = ["a1-c3", "a10-b9", "j10-g7", "j1-c8", "c3-d4", "c8-d9", "g7-f8", "d9-e8", "d4-f6", "e8-f7", "f8-e9", "b9-c10", "f6-e7", "c10-d9", "pass", "f7-e8", "e7-d8"];

function play(moves: string[], variants: string[] = []): YonkomaGame {
    const g = new YonkomaGame(undefined, variants);
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

/** Cells of the annotations of the given type, in algebraic notation. */
function annotated(g: YonkomaGame, type: string, opts?: {altDisplays?: string[]}): string[][] {
    const annotations = (g.render(opts).annotations ?? []) as Array<{type: string; targets?: Array<{row: number; col: number}>}>;
    return annotations.filter(a => a.type === type).map(a => a.targets!.map(t => g.coords2algebraic(t.col, t.row)).sort());
}

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

describe("Yonkoma", () => {
    describe("Rules", () => {
        it("measures distance in king moves", () => {
            expect(ykDistance([0, 0], [3, 1])).to.equal(3);
            expect(ykDistance([2, 5], [2, 1])).to.equal(4);
            expect(ykDistance([1, 1], [1, 1])).to.equal(0);
        });

        it("reproduces Figure 2 of the rule sheet on a 6x6 board", () => {
            // Red a1 b2, Blue c4 f1.  The b2 checker is at distances 2 and 4
            // from the blue checkers, a sum of 6, and at distance 1 from a1.
            const red: [Pos, Pos] = [[0, 0], [1, 1]];
            const blue: [Pos, Pos] = [[2, 3], [5, 0]];
            const dests = ykDestinations(red, blue, 1, 6).map(p => `${p[0]},${p[1]}`).sort();
            // c3 and d4 lower the sum to 4; c1 and e5 keep it at 6 but move away from a1
            expect(dests).to.deep.equal(["2,0", "2,2", "3,3", "4,4"]);
            // a1 is boxed in by b2
            expect(ykDestinations(red, blue, 0, 6)).to.deep.equal([]);
        });

        it("recognises a crosscut only when both pairs sit on the diagonals of one 2x2 block", () => {
            // Figure 3: Red d4 e3, Blue d3 e4
            expect(ykIsCrosscut([[3, 3], [4, 2]], [[3, 2], [4, 3]])).to.be.true;
            expect(ykIsCrosscut([[3, 2], [4, 3]], [[3, 3], [4, 2]])).to.be.true;
            // four checkers in a 2x2 block that is not a crosscut (red in one column)
            expect(ykIsCrosscut([[3, 2], [3, 3]], [[4, 2], [4, 3]])).to.be.false;
            // not within a 2x2 block
            expect(ykIsCrosscut([[0, 0], [1, 1]], [[0, 1], [2, 2]])).to.be.false;
            expect(ykIsCrosscut([[0, 0], [9, 9]], [[0, 9], [9, 0]])).to.be.false;
        });
    });

    describe("Setup", () => {
        it("starts with the checkers in the corners of a 10x10 board, Red to move", () => {
            const g = new YonkomaGame();
            expect(g.boardsize).to.equal(10);
            expect(g.currplayer).to.equal(1);
            expect(g.checkers(1)).to.deep.equal(["a1", "j10"]);
            expect(g.checkers(2)).to.deep.equal(["a10", "j1"]);
            // each red checker may slide along its diagonal up to the square before the other red checker
            expect(g.moves().length).to.equal(16);
            expect(g.destinations("a1")).to.deep.equal(["b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9"]);
        });

        it("honours the 12x12 variant", () => {
            const g = new YonkomaGame(undefined, ["size-12"]);
            expect(g.boardsize).to.equal(12);
            expect(g.checkers(1)).to.deep.equal(["a1", "l12"]);
            expect(g.checkers(2)).to.deep.equal(["a12", "l1"]);
            expect(g.moves().length).to.equal(20);
        });

        it("exposes the designer's colours as the defaults of the player palette", () => {
            const g = new YonkomaGame();
            expect(g.getPlayerColour(1)).to.deep.equal({func: "custom", default: "#e65049", palette: 1});
            expect(g.getPlayerColour(2)).to.deep.equal({func: "custom", default: "#5c6fb7", palette: 2});
            expect(YonkomaGame.gameinfo.flags).to.include("custom-colours");
            expect(YonkomaGame.gameinfo.flags).to.include("autopass");
        });
    });

    describe("Moves", () => {
        it("plays a full game, skipping a turn and ending in a crosscut", () => {
            const g = play(FULL_GAME.slice(0, 14));
            // Red (c3 route) has no legal move: the turn is skipped
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.deep.equal(["pass"]);
            expect(g.validateMove("pass").valid).to.be.true;
            expect(g.validateMove("pass").complete).to.equal(1);
            expect(g.validateMove("e9-f10").valid).to.be.false;
            g.move("pass");
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([{type: "pass"}]);
            expect(g.currplayer).to.equal(2);
            expect(g.validateMove("pass").valid).to.be.false;
            g.move("f7-e8");
            expect(g.gameover).to.be.false;
            g.move("e7-d8");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(g.crosscut()).to.deep.equal(["d8", "d9", "e8", "e9"]);
            expect(g.moves()).to.deep.equal([]);
            expect(() => g.move("e9-f10")).to.throw();
            expect(g.stack[g.stack.length - 1]._results).to.deep.equal([
                {type: "move", from: "e7", to: "d8"},
                {type: "eog", reason: "crosscut"},
                {type: "winners", players: [2]},
            ]);
        });

        it("rejects moves that break the rules, with the right explanation", () => {
            addResource("en");
            const g = new YonkomaGame();
            // Red a1 b2, Blue c4 f1 (Figure 2 of the rule sheet, on the 10x10 board)
            g.board = new Map([["a1", 1], ["b2", 1], ["c4", 2], ["f1", 2]]);
            expect(g.moves()).to.deep.equal(["b2-c1", "b2-c3", "b2-d4", "b2-e5"]);
            expect(g.validateMove("a1").valid).to.be.false;
            expect(g.validateMove("a1").message).to.equal(i18next.t("apgames:validation._general.NO_MOVES", {where: "a1"}));
            expect(g.validateMove("c4").message).to.equal(i18next.t("apgames:validation._general.UNCONTROLLED"));
            expect(g.validateMove("c5").message).to.equal(i18next.t("apgames:validation._general.NONEXISTENT", {where: "c5"}));
            expect(g.validateMove("b2-b5").message).to.equal(i18next.t("apgames:validation.yonkoma.NOT_DIAGONAL", {from: "b2", to: "b5"}));
            expect(g.validateMove("b2-f6").message).to.equal(i18next.t("apgames:validation.yonkoma.DISTANCE", {from: "b2", to: "f6"}));
            expect(g.validateMove("b2-a3").message).to.equal(i18next.t("apgames:validation.yonkoma.DISTANCE", {from: "b2", to: "a3"}));
            expect(g.validateMove("b2-c4").message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "c4"}));
            expect(g.validateMove("b2-z9").valid).to.be.false;
            expect(g.validateMove("pass").message).to.equal(i18next.t("apgames:validation.yonkoma.NO_PASS"));
            expect(() => g.move("b2-f6")).to.throw();
            expect(() => g.move("pass")).to.throw();
            // a checker cannot pass through another checker
            g.board = new Map([["a1", 1], ["j10", 1], ["c3", 2], ["j1", 2]]);
            expect(g.validateMove("a1-d4").message).to.equal(i18next.t("apgames:validation.yonkoma.NOT_DIAGONAL", {from: "a1", to: "d4"}));
            expect(g.moves().filter(m => m.startsWith("a1"))).to.deep.equal(["a1-b2"]);
        });

        it("builds moves from clicks", () => {
            const g = new YonkomaGame();
            const click = (move: string, cell: string) => {
                const [x, y] = g.algebraic2coords(cell);
                return g.handleClick(move, y, x);
            };
            // an empty square or an enemy checker does nothing before a checker is selected
            expect(click("", "e5").valid).to.be.false;
            expect(click("", "e5").move).to.equal("");
            expect(click("", "a10").valid).to.be.false;
            // select a checker
            const first = click("", "a1");
            expect(first.valid).to.be.true;
            expect(first.move).to.equal("a1");
            expect(first.complete).to.equal(-1);
            expect(first.canrender).to.be.true;
            // clicking it again deselects it
            expect(click("a1", "a1").move).to.equal("");
            // the other checker can be selected instead
            expect(click("a1", "j10").move).to.equal("j10");
            // an illegal destination keeps the selection
            const bad = click("a1", "a2");
            expect(bad.valid).to.be.false;
            expect(bad.move).to.equal("a1");
            // a legal destination completes the move
            const done = click("a1", "c3");
            expect(done.valid).to.be.true;
            expect(done.move).to.equal("a1-c3");
            expect(done.complete).to.equal(1);
        });

        it("serializes and clones with the history intact", () => {
            const g = play(FULL_GAME);
            const again = new YonkomaGame(g.serialize());
            expect(again.stack.length).to.equal(FULL_GAME.length + 1);
            expect(again.gameover).to.be.true;
            expect(again.winner).to.deep.equal([2]);
            expect(again.checkers(1)).to.deep.equal(g.checkers(1));
            const c = g.clone();
            expect(c.moves()).to.deep.equal([]);
            expect(c.crosscut()).to.deep.equal(g.crosscut());
            // an earlier state can be loaded
            again.load(3);
            expect(again.currplayer).to.equal(2);
            expect(again.checkers(1)).to.deep.equal(["c3", "g7"]);
        });
    });

    describe("Chat log", () => {
        it("names the player who completed the crosscut", () => {
            addResource("en");
            const g = play(FULL_GAME);
            const names = ["Red player", "Blue player"];
            const entries = g.chatLogEntries(names);
            const last = entries[entries.length - 1];
            expect(last.lines.map(l => l.textKey)).to.deep.equal([
                "apresults:_general.MOVE.nowhat",
                "apresults:yonkoma.EOG.crosscut",
                "apresults:_general.WINNERS",
            ]);
            expect(last.lines[1].textParams).to.deep.equal({player: "Red player"});
            const skipped = entries[14];
            expect(skipped.lines.map(l => l.textKey)).to.deep.equal(["apresults:_general.PASS.simple"]);
            assertChatLogParity(g, names);
        });
    });

    describe("Rendering", () => {
        it("uses the felt board by default and the standard board as an alternative", () => {
            const g = new YonkomaGame();
            const felt = g.render();
            expect((felt.board as {style: string}).style).to.equal("squares");
            expect(felt.glyphDefs).to.have.all.keys("checker", "target");
            expect(felt.legend).to.have.all.keys("A", "B", "H");
            expect((felt.legend!.A as {def: string}).def).to.equal("checker");
            const markers = (felt.board as {markers: Array<{type: string; points?: Array<{row: number; col: number}>}>}).markers;
            const floods = markers.filter(m => m.type === "flood");
            expect(floods.length).to.equal(2);
            expect(floods[0].points!.length + floods[1].points!.length).to.equal(100);
            // a1 (bottom left) is a dark square
            expect(floods[0].points!.some(p => p.row === 9 && p.col === 0)).to.be.true;
            expect(markers.filter(m => m.type === "line").length).to.equal(4);
            expect(felt.pieces).to.equal("B--------A\n_\n_\n_\n_\n_\n_\n_\n_\nA--------B");
            const plain = g.render({altDisplays: ["plain"]});
            expect((plain.board as {style: string}).style).to.equal("squares-checkered");
            expect(plain.glyphDefs).to.be.undefined;
            expect((plain.legend!.A as {name: string}).name).to.equal("piece");
        });

        it("keeps the custom checker within the renderer's markup limits", () => {
            const markup = ykCheckerMarkup();
            expect(markup).to.equal(ykCheckerMarkup());
            expect(markup.length).to.be.lessThan(65536);
            const elements = markup.match(/<[a-z]+/g)!;
            expect(elements.length).to.be.lessThan(256);
            expect(new Set(elements)).to.have.all.keys("<ellipse", "<circle", "<path");
            expect(markup).to.include("data-slot-fill=\"fill\"");
            expect(markup).to.include("data-slot-fill=\"side\"");
        });

        it("marks the selected checker and its destinations while a move is entered", () => {
            const g = new YonkomaGame();
            g.move("a1", {partial: true});
            expect(annotated(g, "enter")).to.deep.equal([["a1"]]);
            expect(annotated(g, "glyph")).to.deep.equal([["b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9"]]);
            expect(annotated(g, "glyph", {altDisplays: ["plain"]})).to.deep.equal([]);
            expect(annotated(g, "dots", {altDisplays: ["plain"]})).to.deep.equal([["b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9"]]);
            // the partial move changes nothing on the board
            expect(g.checkers(1)).to.deep.equal(["a1", "j10"]);
            expect(g.stack.length).to.equal(1);
            g.move("a1-c3");
            expect(annotated(g, "glyph")).to.deep.equal([]);
            expect(annotated(g, "move")).to.deep.equal([["a1", "c3"]]);
        });

        it("outlines the crosscut at the end of the game", () => {
            const g = play(FULL_GAME);
            expect(annotated(g, "enter")).to.deep.equal([["d8", "d9", "e8", "e9"]]);
            expect(annotated(g, "move")).to.deep.equal([["d8", "e7"]]);
            expect(annotated(play(FULL_GAME.slice(0, 5)), "enter")).to.deep.equal([]);
        });
    });

    describe("Random play", () => {
        it("always ends in a crosscut completed by the loser, on both boards", () => {
            const rnd = seededRandom(2026);
            for (const variants of [[], ["size-12"]]) {
                for (let n = 0; n < 15; n++) {
                    const g = new YonkomaGame(undefined, variants);
                    let plies = 0;
                    while (!g.gameover) {
                        const moves = g.moves();
                        expect(moves.length).to.be.greaterThan(0);
                        if (moves[0] === "pass") {
                            expect(moves).to.deep.equal(["pass"]);
                            // the other player can always move
                            expect(g.moves(g.currplayer === 1 ? 2 : 1).length).to.be.greaterThan(0);
                        }
                        const mover = g.currplayer;
                        g.move(moves[Math.floor(rnd() * moves.length)]);
                        plies++;
                        expect(plies).to.be.lessThan(500);
                        if (g.gameover) {
                            expect(g.crosscut().length).to.equal(4);
                            expect(g.winner).to.deep.equal([mover === 1 ? 2 : 1]);
                        }
                    }
                }
            }
        });
    });
});
