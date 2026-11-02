/**
 * Slide topology must match uncached formation-graph reference (Track 2).
 * Not part of default `npm test` — run locally: `npm run test:cubeo-gates`.
 */

import "mocha";
import { expect } from "chai";
import type { UndirectedGraph } from "graphology";
import { CubeoBoard } from "../../src/games/cubeo/board.js";
import { CubeoDie } from "../../src/games/cubeo/die.js";
import { buildCubeoMoveGraph } from "../../src/games/cubeo/formation-graph.js";
import { CubeoSlideTopology, moveEndNodesOnGraph } from "../../src/games/cubeo/slide-topology.js";
import { CUBEO_SCENARIOS, GAP_JUMP_MOVE } from "../fixtures/cubeo/scenarios.js";
import { gameFromScenario } from "../fixtures/cubeo/helpers.js";

/** Uncached move-graph builder (reference for parity). */
function referenceCanSlide(board: CubeoBoard, x: number, y: number): boolean {
    const g = buildCubeoMoveGraph(board, x, y);
    const coords = g.graph.nodes().map(n => g.algebraic2coords(n)).flat();
    return coords.includes(0);
}

function referenceMoveEndAbsKeys(board: CubeoBoard, die: CubeoDie): Set<string> {
    const gMove = buildCubeoMoveGraph(board, die.x, die.y);
    const rel = board.abs2rel(die.x, die.y);
    if (rel === undefined) {
        return new Set();
    }
    const start = gMove.coords2algebraic(...rel);
    const relCells = moveEndNodesOnGraph(gMove.graph as UndirectedGraph, start, die.pips);
    const out = new Set<string>();
    for (const cell of relCells) {
        const [relx, rely] = gMove.algebraic2coords(cell);
        const [absx, absy] = board.rel2abs(relx, rely);
        out.add(`${absx},${absy}`);
    }
    return out;
}

function slideProbeCells(board: CubeoBoard, currplayer: 1 | 2): Array<{ x: number; y: number }> {
    const keys = new Set<string>();
    const g = board.graph();
    for (const node of g.graph.nodes()) {
        if (!g.graph.hasNodeAttribute(node, "contents")) {
            const [absx, absy] = board.rel2abs(...g.algebraic2coords(node));
            keys.add(`${absx},${absy}`);
        }
    }
    for (const d of board.getDiceOf(currplayer)) {
        keys.add(`${d.x},${d.y}`);
    }
    return [...keys].map(k => {
        const [x, y] = k.split(",").map(n => parseInt(n, 10));
        return { x, y };
    });
}

describe("Cubeo slide topology parity", () => {
    for (const scenario of CUBEO_SCENARIOS) {
        it(`${scenario.id} — canSlide matches reference`, () => {
            const g = gameFromScenario(scenario);
            const board = g.board;
            const topo = CubeoSlideTopology.fromBoard(board);
            for (const { x, y } of slideProbeCells(board, g.currplayer)) {
                expect(topo.canSlideAt(x, y), `canSlide at ${x},${y}`).to.equal(referenceCanSlide(board, x, y));
            }
        });

        it(`${scenario.id} — move endpoints match reference`, () => {
            const g = gameFromScenario(scenario);
            const board = g.board;
            const topo = CubeoSlideTopology.fromBoard(board);
            for (const die of board.getDiceOf(g.currplayer)) {
                if (board.isPinned(die.x, die.y)) {
                    continue;
                }
                expect(topo.moveEndAbsKeys(die), `endpoints for die at ${die.x},${die.y}`).to.deep.equal(
                    referenceMoveEndAbsKeys(board, die),
                );
            }
        });
    }

    it("gapJump — GAP_JUMP_MOVE destination is a move endpoint", () => {
        const scenario = CUBEO_SCENARIOS.find(s => s.id === "gapJump")!;
        const g = gameFromScenario(scenario);
        const die = g.board.getDieAt(0, 2)!;
        expect(die.pips).to.equal(2);
        const topo = CubeoSlideTopology.fromBoard(g.board);
        expect(topo.moveEndAbsKeys(die).has("-1,2")).to.equal(true);
        expect(GAP_JUMP_MOVE).to.equal("2,0,2->-1,2");
    });

    it("inline — hollow square: parity and no diagonal shortcut across gap", () => {
        const board = new CubeoBoard();
        board.add(new CubeoDie({ x: 0, y: 0, owner: 1, pips: 2 }), false);
        board.add(new CubeoDie({ x: 2, y: 0, owner: 1, pips: 1 }), false);
        board.add(new CubeoDie({ x: 0, y: 1, owner: 1, pips: 1 }), false);
        board.add(new CubeoDie({ x: 2, y: 1, owner: 1, pips: 1 }), false);
        const mover = board.getDieAt(0, 0)!;
        const topo = CubeoSlideTopology.fromBoard(board);
        const legacy = referenceMoveEndAbsKeys(board, mover);
        expect(topo.moveEndAbsKeys(mover)).to.deep.equal(legacy);
        expect(legacy.has("2,0")).to.equal(false);
    });
});
