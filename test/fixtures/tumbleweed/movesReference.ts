import { expect } from "chai";
import type { HexTriGraph } from "../../../src/common/graphs/hextri.js";
import { TumbleweedGame, type playerid } from "../../../src/games/tumbleweed.js";

type directions = "NE" | "E" | "SE" | "SW" | "W" | "NW";
const allDirections: directions[] = ["NE", "E", "SE", "SW", "W", "NW"];

function getBoardSize(g: TumbleweedGame): number {
    if (g.variants.length > 0 && g.variants[0] !== undefined && g.variants[0].length > 0) {
        const sizeVariants = g.variants.filter(v => v.includes("size"));
        if (sizeVariants.length > 0) {
            const size = sizeVariants[0].match(/\d+/);
            return parseInt(size![0], 10);
        }
    }
    return 8;
}

function getGraph(g: TumbleweedGame): HexTriGraph {
    if (g.graph === undefined) {
        throw new Error("TumbleweedGame graph is not built.");
    }
    return g.graph;
}

function listCells(g: TumbleweedGame): string[] {
    return getGraph(g).listCells() as string[];
}

function getCentre(g: TumbleweedGame): string {
    const boardSize = getBoardSize(g);
    return getGraph(g).coords2algebraic(boardSize - 1, boardSize - 1);
}

/** Cell-centric LOS — frozen copy of pre-refactor getLosCount semantics. */
export function getLosCountReference(
    board: Map<string, [playerid, number]>,
    graph: HexTriGraph,
    cell: string,
    player: playerid,
): number {
    let losCount = 0;
    const [x, y] = graph.algebraic2coords(cell);
    for (const dir of allDirections) {
        const ray = graph.ray(x, y, dir).map(c => graph.coords2algebraic(c[0], c[1]));
        for (const c of ray) {
            if (board.has(c)) {
                if (board.get(c)![0] === player) {
                    losCount++;
                }
                break;
            }
        }
    }
    return losCount;
}

/**
 * Pre-refactor moves(): cell-centric LOS plus current branching rules.
 * Used as the regression oracle for the optimized implementation.
 */
export function movesReference(g: TumbleweedGame, player?: playerid): string[] {
    if (g.gameover) {
        return [];
    }
    const mover = player ?? g.currplayer;
    const moves: string[] = [];
    const graph = getGraph(g);
    const board = g.board;

    if (g.stack.length === 1) {
        if (g.variants.includes("free-neutral")) {
            return ["No movelist in opening"];
        }
        const centre = getCentre(g);
        for (const cell of listCells(g)) {
            for (const cell2 of listCells(g)) {
                if (cell === cell2 || cell === centre || cell2 === centre) {
                    continue;
                }
                moves.push(`${cell},${cell2}`);
            }
        }
        return moves;
    }
    if (g.stack.length === 2 && mover === 2) {
        return ["pass"];
    }

    const lm = g.lastmove!;
    const suffixLastMove: string | undefined = lm[lm.length - 1] === "+" || lm[lm.length - 1] === "x"
        ? lm[lm.length - 1]
        : undefined;
    const withoutSuffixLastMove = suffixLastMove !== undefined ? lm.slice(0, lm.length - 1) : lm;

    for (const cell of listCells(g)) {
        const losCount = getLosCountReference(board, graph, cell, mover);
        if (losCount === 0 || board.has(cell) && board.get(cell)![1] >= losCount) {
            continue;
        }
        if (g.variants.includes("capture-delay") && withoutSuffixLastMove === cell) {
            continue;
        }
        if (g.stack[0]._version !== "20231229") {
            if (board.has(cell)) {
                if (board.get(cell)![0] === mover) {
                    moves.push(cell + "+");
                } else {
                    moves.push(cell + "x");
                }
            } else {
                moves.push(cell);
            }
        } else {
            moves.push(cell);
        }
    }
    if (g.stack.length !== 3) {
        moves.push("pass");
    }
    return moves;
}

export function sortedMoves(moves: string[]): string[] {
    return [...moves].sort();
}

export function expectMovesMatchReference(g: TumbleweedGame, player?: playerid): void {
    const actual = sortedMoves(g.moves(player));
    const expected = sortedMoves(movesReference(g, player));
    expect(actual).to.deep.equal(expected);
}
