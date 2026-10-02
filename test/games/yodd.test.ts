/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { YoddGame } from "../../src/games";
import { HexTriGraph } from "../../src/common/graphs/index.js";

function emptyHexCell(size = 6): string {
    const g = new HexTriGraph(size, size * 2 - 1);
    return (g.listCells(false) as string[])[0]!;
}

describe("Yodd", () => {
    it("rejects two stones on the opening turn", () => {
        const cells = (() => {
            const g = new HexTriGraph(6, 11);
            return g.listCells(false) as string[];
        })();
        const g = new YoddGame(undefined, ["hex-6"]);
        const bad = g.validateMove(`1${cells[0]!},2${cells[1]!}`);
        expect(bad.valid).to.be.false;
    });

    it("accepts a single opening stone leaving an odd number of groups", () => {
        const cell = emptyHexCell();
        const g = new YoddGame(undefined, ["hex-6"]);
        const ok = g.validateMove(`1${cell}`);
        expect(ok.valid).to.be.true;
        expect(ok.complete).to.equal(0);
        g.move(`1${cell}`);
        expect(g.board.size).to.equal(1);
        expect(g.currplayer).to.equal(2);
    });

    it("does not allow pass on an empty board", () => {
        const g = new YoddGame(undefined, ["hex-6"]);
        const pass = g.validateMove("pass");
        expect(pass.valid).to.be.false;
    });

    it("allows pass when the total group count is odd", () => {
        const cell = emptyHexCell();
        const g = new YoddGame(undefined, ["hex-6"]);
        g.move(`1${cell}`);
        const pass = g.validateMove("pass");
        expect(pass.valid).to.be.true;
        g.move("pass");
        expect(g.currplayer).to.equal(1);
    });

    it("completes a turn with one stone after the opening", () => {
        const cells = (() => {
            const g = new HexTriGraph(6, 11);
            return g.listCells(false) as string[];
        })();
        const g = new YoddGame(undefined, ["hex-6"]);
        const start = cells[0]!;
        g.move(`1${start}`);
        g.move("pass");
        const neighbour = new HexTriGraph(6, 11).neighbours(start).find(c => !g.board.has(c));
        expect(neighbour).to.be.a("string");
        g.move(`1${neighbour!}`);
        expect(g.stack.length).to.equal(4);
        expect(g.currplayer).to.equal(2);
    });

    it("ends on two consecutive passes and scores by group count", () => {
        const cell = emptyHexCell();
        const g = new YoddGame(undefined, ["hex-6"]);
        g.move(`1${cell}`);
        g.move("pass");
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.countGroups(1)).to.equal(1);
        expect(g.countGroups(2)).to.equal(0);
        expect(g.winner).to.deep.equal([2]);
    });

    it("ends when the board is full without consecutive passes", () => {
        const cells = new HexTriGraph(6, 11).listCells(false) as string[];
        const g = new YoddGame(undefined, ["hex-6"]);
        for (const cell of cells) {
            g.board.set(cell, 1);
        }
        (g as unknown as { checkEOG(): YoddGame }).checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.countGroups(1)).to.equal(1);
        expect(g.winner).to.deep.equal([2]);
    });

    it("rejects placements that leave an even total group count", () => {
        const cells = (() => {
            const g = new HexTriGraph(6, 11);
            return g.listCells(false) as string[];
        })();
        const g = new YoddGame(undefined, ["hex-6"]);
        g.move(`1${cells[0]!}`);
        // Two isolated stones of different colours → two groups (even).
        const bad = g.validateMove(`1${cells[1]!},2${cells[2]!}`);
        expect(bad.valid).to.be.false;
    });

    it("cycles placement colour then removes the stone on further clicks", () => {
        const cell = emptyHexCell();
        const g = new YoddGame(undefined, ["hex-6"]);
        const [x, y] = new HexTriGraph(6, 11).algebraic2coords(cell);
        let click = g.handleClick("", y, x);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal(`1${cell}`);
        expect(click.complete).to.equal(0);

        click = g.handleClick(click.move, y, x);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal(`2${cell}`);
        expect(click.complete).to.equal(0);

        click = g.handleClick(click.move, y, x);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("");
        expect(click.complete).to.equal(-1);
    });

    it("randomMove returns a legal complete turn", () => {
        const g = new YoddGame(undefined, ["hex-6"]);
        const m = g.randomMove();
        expect(g.validateMove(m).valid).to.be.true;
        const stackBefore = g.stack.length;
        g.move(m);
        expect(g.stack.length).to.equal(stackBefore + 1);
    });

    it("uses hex-of-tri by default and vertex grid for square variants", () => {
        const hex = new YoddGame(undefined, ["hex-6"]);
        expect(hex.render().board.style).to.equal("hex-of-tri");

        const square = new YoddGame(undefined, ["square-9"]);
        expect(square.render().board.style).to.equal("vertex");
    });

    it("keeps canrender for the retained partial after a rejected extension click", () => {
        const graph = new HexTriGraph(6, 11);
        const cells = graph.listCells(false) as string[];
        const g = new YoddGame(undefined, ["hex-6"]);
        g.move(`1${cells[0]!}`);
        const first = cells[1]!;
        const second = cells[2]!;
        const [x1, y1] = graph.algebraic2coords(first);
        const [x2, y2] = graph.algebraic2coords(second);
        let click = g.handleClick("", y1, x1);
        expect(click.valid).to.be.true;
        expect(click.canrender).to.be.true;
        click = g.handleClick(click.move, y2, x2);
        expect(click.valid).to.be.false;
        expect(click.move).to.equal(`2${first}`);
        expect(click.canrender).to.be.true;
    });

    it("does not offer pass while an opening placement is in progress", () => {
        const cell = emptyHexCell();
        const g = new YoddGame(undefined, ["hex-6"]);
        expect(g.getButtons()).to.deep.equal([]);
        g.move(`1${cell}`, { partial: true });
        expect(g.getButtons()).to.deep.equal([]);
        expect(g.validateMove("pass").valid).to.be.false;
    });

    it("offers pass after the opening when the group count is odd", () => {
        const cell = emptyHexCell();
        const g = new YoddGame(undefined, ["hex-6"]);
        g.move(`1${cell}`);
        expect(g.getButtons()).to.deep.equal([{ label: "apgames:buttons.pass", move: "pass" }]);
    });

    describe("Yopp/Xopp variant", () => {
        it("rejects opponent-colour placements", () => {
            const cells = (() => {
                const g = new HexTriGraph(6, 11);
                return g.listCells(false) as string[];
            })();
            const g = new YoddGame(undefined, ["hex-6", "yopp"]);
            g.move(`1${cells[0]!}`);
            expect(g.currplayer).to.equal(2);
            const bad = g.validateMove(`1${cells[1]!}`);
            expect(bad.valid).to.be.false;
        });

        it("does not allow pass while valid own-colour placements exist", () => {
            const cell = emptyHexCell();
            const g = new YoddGame(undefined, ["hex-6", "yopp"]);
            g.move(`1${cell}`);
            expect(g.validateMove("pass").valid).to.be.false;
            expect(g.moves()).to.not.include("pass");
        });

        it("cycles own colour then remove without switching to the other colour", () => {
            const cell = emptyHexCell();
            const g = new YoddGame(undefined, ["hex-6", "yopp"]);
            const [x, y] = new HexTriGraph(6, 11).algebraic2coords(cell);
            let click = g.handleClick("", y, x);
            expect(click.move).to.equal(`1${cell}`);

            click = g.handleClick(click.move, y, x);
            expect(click.valid).to.be.true;
            expect(click.move).to.not.equal(`2${cell}`);
            expect(click.move).to.equal("");
        });

        it("randomMove returns a legal complete turn", () => {
            const g = new YoddGame(undefined, ["hex-6", "yopp"]);
            const m = g.randomMove();
            expect(g.validateMove(m).valid).to.be.true;
        });

        it("rejects pass via handleClick without throwing", () => {
            const g = new YoddGame({
                game: "yodd",
                numplayers: 2,
                variants: ["yopp"],
                gameover: false,
                winner: [],
                stack: [
                    {
                        _version: "20260930",
                        _results: [],
                        _timestamp: new Date(),
                        currplayer: 1,
                        board: new Map(),
                    },
                    {
                        _version: "20260930",
                        _results: [{ type: "place", where: "j8" }],
                        _timestamp: new Date(),
                        currplayer: 2,
                        lastmove: "1j8",
                        board: new Map([["j8", 1]]),
                    },
                    {
                        _version: "20260930",
                        _results: [
                            { type: "place", where: "i6" },
                            { type: "place", where: "i9" },
                        ],
                        _timestamp: new Date(),
                        currplayer: 1,
                        lastmove: "2i6,2i9",
                        board: new Map([["j8", 1], ["i6", 2], ["i9", 2]]),
                    },
                ],
            });
            expect(g.validateMove("pass").valid).to.be.false;
            const click = g.handleClick("", -1, -1, "_btn_pass");
            expect(click.valid).to.be.false;
            expect(click.move).to.equal("");
        });
    });
});
