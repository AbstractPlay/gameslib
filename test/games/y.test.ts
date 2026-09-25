/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { YGame } from "../../src/games/y.js";
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

describe("Y star board", () => {
    it("uses StarGraph at size-11", () => {
        const g = new YGame(undefined, ["size-11", "star"]);
        const star = g.getGraph() as StarGraph;
        expect(starFrequencyFromWidth(11)).to.equal(10);
        expect(star.graph.order).to.equal(276);
        expect(g.moves()).to.include("k1");
    });

    it("detects a Y win on sides 0, 2, and 4", () => {
        const g = new YGame(undefined, ["size-11", "star"]);
        const star = g.getGraph() as StarGraph;
        const sides = starOuterSides(star);
        const anchors = [sides[0]![0]!, sides[2]![0]!, sides[4]![0]!];
        const cells = connectCells(star, anchors);
        for (const cell of cells) {
            g.board.set(cell, 1);
        }
        expect(g.isConnected(1)).to.equal(true);
        expect(g.connPath.length).to.be.greaterThan(0);
    });

    it("detects a Y win on sides 0, 1, and 3", () => {
        const g = new YGame(undefined, ["size-11", "star"]);
        const star = g.getGraph() as StarGraph;
        const sides = starOuterSides(star);
        const anchors = [sides[0]![0]!, sides[1]![0]!, sides[3]![0]!];
        const cells = connectCells(star, anchors);
        for (const cell of cells) {
            g.board.set(cell, 1);
        }
        expect(g.isConnected(1)).to.equal(true);
    });

    it("does not win on three consecutive sides alone", () => {
        expect(starHasYWin([0, 1, 2])).to.equal(false);
        const g = new YGame(undefined, ["size-11", "star"]);
        const sides = starOuterSides(g.getGraph() as StarGraph);
        g.board.set(midCell(sides[0]!), 1);
        g.board.set(midCell(sides[1]!), 1);
        g.board.set(midCell(sides[2]!), 1);
        expect(g.isConnected(1)).to.equal(false);
    });

    it("wins when four distinct sides are touched", () => {
        const g = new YGame(undefined, ["size-11", "star"]);
        const star = g.getGraph() as StarGraph;
        const sides = starOuterSides(star);
        const anchors = [sides[0]![0]!, sides[1]![0]!, sides[2]![0]!, sides[3]![0]!];
        const cells = connectCells(star, anchors);
        for (const cell of cells) {
            g.board.set(cell, 1);
        }
        expect(g.isConnected(1)).to.equal(true);
    });

    it("can win with a stone on the centre", () => {
        const g = new YGame(undefined, ["size-11", "star"]);
        const star = g.getGraph() as StarGraph;
        const sides = starOuterSides(star);
        const cells = connectCells(star, [sides[0]![0]!, "k1", sides[2]![0]!, sides[4]![0]!]);
        for (const cell of cells) {
            g.board.set(cell, 1);
        }
        expect(g.isConnected(1)).to.equal(true);
    });

    it("handleClick maps renderer row/col to star algebraic cells", () => {
        const g = new YGame(undefined, ["size-11", "star"]);
        const grid = (g.getGraph() as StarGraph).listCells(true) as string[][];
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
