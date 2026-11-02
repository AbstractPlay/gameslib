/* eslint-disable no-console */
import { writeFileSync } from "node:fs";
import { CubeoGame } from "../src/games/cubeo.js";
import type { ICubeoState } from "../src/games/cubeo.js";

function trimState(g: CubeoGame, variants: string[]): ICubeoState {
    const s = g.state();
    const top = s.stack.at(-1)!;
    return {
        game: "cubeo",
        numplayers: 2,
        variants,
        gameover: s.gameover,
        winner: [...s.winner],
        stack: [top],
    };
}

function replay(variants: string[], moves: string[]): ICubeoState | null {
    let g = new CubeoGame(undefined, variants);
    for (const m of moves) {
        const list = g.moves();
        if (!list.includes(m)) {
            console.log("replay failed", variants, m, "list size", list.length);
            return null;
        }
        g = g.move(m, { trusted: true });
    }
    return trimState(g, variants);
}

const gapMoves = [
    "+-1,0", "+1,1", "+-1,-1", "+1,-1", "1,-1,-1+>-1,0", "1,1,-1->0,-1", "2,-1,0->1,2",
    "+-1,-1", "+2,2", "1,-1,-1->-1,0", "1,2,2+>1,2", "+-1,-1", "+2,2", "1,-1,-1+>-1,0",
    "+3,2", "2,-1,0->0,2", "1,3,2->2,1", "+0,3", "1,2,1+>2,2", "1,0,3->1,3", "2,2,2+>1,2",
    "+2,1", "+-1,0", "1,0,-1->-1,-1", "+-1,1",
];

const stdReplay = replay([], gapMoves);
console.log("stdReplay dice", stdReplay?.stack[0]?.board);

function greedyPlayout(variant: "d10" | "d12", maxPlies: number): { state: ICubeoState; plies: number; moveCount: number } {
    let g = new CubeoGame(undefined, [variant]);
    let best: { state: ICubeoState; plies: number; moveCount: number } | undefined;
    for (let i = 0; i < maxPlies && !g.gameover; i++) {
        const moveCount = g.moves().length;
        const dice = g.board.getDiceOf(1).length + g.board.getDiceOf(2).length;
        if (moveCount >= 8 && dice >= 8) {
            best = { state: trimState(g, [variant]), plies: g.stack.length - 1, moveCount };
        }
        const sorted = [...g.moves()].sort((a, b) => a.localeCompare(b));
        const m = sorted[Math.min(1, sorted.length - 1)] ?? sorted[0];
        if (m === undefined) {
            break;
        }
        g = g.move(m, { trusted: true });
    }
    if (best === undefined) {
        best = {
            state: trimState(g, [variant]),
            plies: g.stack.length - 1,
            moveCount: g.moves().length,
        };
    }
    return best;
}

const d10 = greedyPlayout("d10", 30);
const d12 = greedyPlayout("d12", 36);
console.log("d10 plies", d10.plies, "dice", (d10.state.stack[0]!.board as { _dice: unknown[] })._dice.length, "|moves|", d10.moveCount);
console.log("d12 plies", d12.plies, "dice", (d12.state.stack[0]!.board as { _dice: unknown[] })._dice.length, "|moves|", d12.moveCount);

const out = {
    d10Midgame: d10.state,
    d12Midgame: d12.state,
};

function emitStateModule(name: string, exportName: string, state: ICubeoState): void {
    const body = `import type { ICubeoState } from "../../../src/games/cubeo.js";

/** Greedy playout midgame (${exportName}); used as extended regression gate. */
export const ${exportName}: ICubeoState = ${JSON.stringify(state, null, 4)} as ICubeoState;
`;
    writeFileSync(`test/fixtures/cubeo/${name}.ts`, body, "utf8");
}

emitStateModule("d10MidgameState", "d10MidgameState", out.d10Midgame);
emitStateModule("d12MidgameState", "d12MidgameState", out.d12Midgame);
console.log("Wrote d10MidgameState.ts and d12MidgameState.ts");
