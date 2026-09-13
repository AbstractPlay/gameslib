import { expect } from "chai";
import { StorisendeGame, type playerid } from "../../../src/games/storisende.js";

/**
 * Pre-refactor moves(): naive candidates + validateMove filter.
 * Frozen oracle (ignores `player` for source selection — uses this.currplayer).
 */
export function movesReference(g: StorisendeGame, player?: playerid): string[] {
    void player;
    if (g.gameover) {
        return [];
    }

    if (g.stack.length < 3) {
        return [];
    }

    const moves: string[] = ["pass"];
    const graph = g.board.graph;
    const mine = g.board.hexes.filter(h => h.stack.includes(g.currplayer));
    for (const hex of mine) {
        for (let dist = 1; dist <= hex.stack.length; dist++) {
            const from = g.board.hex2algebraic(hex);
            for (const dir of graph.allDirs) {
                let to: string | undefined;
                const ray = graph.ray(from, dir);
                if (ray.length >= dist) {
                    to = ray[dist - 1];
                }
                if (to !== undefined) {
                    if (dist === hex.stack.length) {
                        moves.push(`${from}-${to}`);
                    } else {
                        moves.push(`${from}:${dist}-${to}`);
                    }
                }
            }
        }
    }

    const valid = moves.filter(mv => g.validateMove(mv).valid);
    return valid.sort((a, b) => a.localeCompare(b));
}

export function sortedMoves(moves: string[]): string[] {
    return [...moves].sort((a, b) => a.localeCompare(b));
}

export function expectMovesMatchReference(g: StorisendeGame, player?: playerid): void {
    const actual = sortedMoves(g.moves(player));
    const expected = sortedMoves(movesReference(g, player));
    expect(actual).to.deep.equal(expected);
}
