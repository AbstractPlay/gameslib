/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { AgereGame } from "../../src/games/agere.js";
import {
    StarGraph,
    starFrequencyFromWidth,
    starOuterSides,
    starHasYWin,
} from "../../src/common";

const connectCells = (star: StarGraph, cells: string[]): Set<string> => {
    const placed = new Set<string>();
    const addPath = (from: string, to: string) => {
        const path = star.path(from, to);
        expect(path).to.not.be.null;
        for (const cell of path!) {
            placed.add(cell);
        }
    };
    for (let i = 0; i < cells.length - 1; i++) {
        addPath(cells[i]!, cells[i + 1]!);
    }
    return placed;
};

const midCell = (side: string[]): string => side[Math.floor(side.length / 2)]!;

describe("Adere star-11", () => {
    it("builds the star graph at width 11", () => {
        new AgereGame(undefined, ["star-11"]);
        const graph = AgereGame.buildGraph("star11");
        expect(starFrequencyFromWidth(11)).to.equal(10);
        expect(graph.order).to.equal(276);
    });

    it("checkEOGStar detects a legal Y connection", () => {
        const g = new AgereGame(undefined, ["star-11"]);
        const star = new StarGraph(starFrequencyFromWidth(11));
        const sides = starOuterSides(star);
        const anchors = [sides[0]![0]!, sides[2]![0]!, sides[4]![0]!];
        const cells = connectCells(star, anchors);
        for (const cell of cells) {
            g.board.set(cell, [1]);
        }
        g.currplayer = 2;
        expect(g.checkEOGStar(1, true)).to.equal(true);
        expect(g.connPath.length).to.be.greaterThan(0);
    });

    it("checkEOGStar rejects three consecutive sides on disconnected stones", () => {
        expect(starHasYWin([0, 1, 2])).to.equal(false);
        const g = new AgereGame(undefined, ["star-11"]);
        const sides = starOuterSides(new StarGraph(starFrequencyFromWidth(11)));
        g.board.set(midCell(sides[0]!), [1]);
        g.board.set(midCell(sides[1]!), [1]);
        g.board.set(midCell(sides[2]!), [1]);
        expect(g.checkEOGStar(1)).to.equal(false);
    });

    it("a quark alone does not win (two sides only)", () => {
        const g = new AgereGame(undefined, ["star-11"]);
        const sides = starOuterSides(new StarGraph(starFrequencyFromWidth(11)));
        g.board.set(sides[0]![0]!, [1]);
        expect(g.checkEOGStar(1)).to.equal(false);
    });

    it("handleClick maps renderer row/col to star algebraic cells", () => {
        const g = new AgereGame(undefined, ["star-11"]);
        const grid = new StarGraph(starFrequencyFromWidth(11)).listCells(true) as string[][];
        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < grid[row]!.length; col++) {
                const cell = grid[row]![col]!;
                const result = g.handleClick("", row, col);
                expect(result.valid).to.equal(true);
                expect(result.move).to.equal(cell);
            }
        }
    });
});
