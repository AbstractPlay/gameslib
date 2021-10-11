/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { AmazonsGame, IAmazonsState } from '../../src/games';
import { RectGrid } from "../../src/common";

describe("Amazons", () => {
    it ("Converting coordinates to algebraic format", () => {
        expect(AmazonsGame.coords2algebraic(0, 0)).to.equal("a10");
        expect(AmazonsGame.coords2algebraic(9, 9)).to.equal("j1");
        expect(AmazonsGame.coords2algebraic(5, 5)).to.equal("f5");
    });
    it ("Converting algebraic format to coordinates", () => {
        expect(AmazonsGame.algebraic2coords("a10")).to.have.members([0, 0]);
        expect(AmazonsGame.algebraic2coords("j1")).to.have.members([9, 9]);
        expect(AmazonsGame.algebraic2coords("f5")).to.have.members([5, 5]);
    });

    it ("graph builds correctly", () => {
        const grid = new RectGrid(10, 10);
        const g = new AmazonsGame();
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const cell = AmazonsGame.coords2algebraic(col, row);
                const adjsXY: Array<[number, number]> = grid.adjacencies(col, row);
                const adjs: string[] = adjsXY.map((pair) => {
                    return AmazonsGame.coords2algebraic(pair[0], pair[1]);
                });
                expect(g.graph.neighbors(cell)).to.have.members(adjs);
            }
        }
    });

    it ("isolation testing", () => {
        const newg = new AmazonsGame();
        expect(newg.areIsolated()).to.be.false;
        const b: Map<string, 0|1|2> = new Map([
            ["a10", 1],
            ["j10", 1],
            ["a1", 2],
            ["j1", 2]
        ]);
        for (let col = 0; col < 10; col++) {
            b.set(AmazonsGame.coords2algebraic(col, 5), 0);
        }
        for (let row = 0; row < 10; row++) {
            b.set(AmazonsGame.coords2algebraic(5, row), 0);
        }
        const state: IAmazonsState = {
            currplayer: 1,
            gameover: false,
            board: b,
            winner: []
        };
        const g = new AmazonsGame(state);
        expect(g.areIsolated()).to.be.true;
    });

    it ("territory checking", () => {
        const b: Map<string, 0|1|2> = new Map([
            ["a10", 1],
            ["j10", 1],
            ["a1", 2],
            ["j1", 2]
        ]);
        for (let col = 0; col < 10; col++) {
            b.set(AmazonsGame.coords2algebraic(col, 5), 0);
        }
        for (let row = 0; row < 10; row++) {
            b.set(AmazonsGame.coords2algebraic(5, row), 0);
        }
        const state: IAmazonsState = {
            currplayer: 1,
            gameover: false,
            board: b,
            winner: []
        };
        const g = new AmazonsGame(state);
        const ts = g.territory();
        expect(ts[0]).to.be.equal(43);
        expect(ts[1]).to.be.equal(34);
    });

    it ("Pieces can't move through other pieces or blocks", () => {
        const g = new AmazonsGame();
        g.board.set("d2", 0);
        expect(() => g.move("d1-d2/c2")).to.throw(Error, "Invalid move");
        expect(() => g.move("d1-d3/c2")).to.throw(Error, "Invalid move");
        expect(() => g.move("d1-g1/h1")).to.throw(Error, "Invalid move");
        expect(() => g.move("d1-h1/i1")).to.throw(Error, "Invalid move");
    });

    it ("Arrows can't move through other pieces or blocks", () => {
        const g = new AmazonsGame();
        g.board.set("d2", 0);
        g.board.set("g2", 2);
        expect(() => g.move("d1-e2/d2")).to.throw(Error, "Invalid move");
        expect(() => g.move("d1-e2/c2")).to.throw(Error, "Invalid move");
        expect(() => g.move("d1-e2/g2")).to.throw(Error, "Invalid move");
        expect(() => g.move("d1-e2/h2")).to.throw(Error, "Invalid move");
    });
});

