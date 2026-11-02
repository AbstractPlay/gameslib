import { expect } from "chai";
import { gameFromScenario } from "./gameFromScenario.js";
import type { CubeoScenario } from "./scenarios.js";

export { gameFromScenario } from "./gameFromScenario.js";

/** Every listed move must apply cleanly and leave a connected formation. */
export function expectListedMovesApply(scenario: CubeoScenario, moves: string[]): void {
    for (const m of moves) {
        const next = gameFromScenario(scenario).move(m, { trusted: true });
        expect(next.board.isConnected, `move ${m} disconnects`).to.equal(true);
    }
}

export function expectGoldenMovelist(scenario: CubeoScenario, expected: string[]): void {
    const g = gameFromScenario(scenario);
    expect(g.moves()).to.deep.equal(expected);
}
