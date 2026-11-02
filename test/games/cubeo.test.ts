import "mocha";
import { expect } from "chai";
import { CUBEO_CORE_SCENARIOS, GAP_JUMP_MOVE, type CubeoScenario } from "../fixtures/cubeo/scenarios.js";
import { CUBEO_GOLDEN_MOVELISTS } from "../fixtures/cubeo/goldenMovelists.js";
import { expectGoldenMovelist, expectListedMovesApply, gameFromScenario } from "../fixtures/cubeo/helpers.js";

describe("Cubeo", () => {
    describe("golden movelists (core)", () => {
        for (const scenario of CUBEO_CORE_SCENARIOS) {
            it(scenario.id, () => {
                expectGoldenMovelist(scenario, CUBEO_GOLDEN_MOVELISTS[scenario.id]!);
                expectListedMovesApply(scenario, CUBEO_GOLDEN_MOVELISTS[scenario.id]!);
            });
        }
    });

    it("gap-jump move stays legal on gapJump fixture", () => {
        const scenario = CUBEO_CORE_SCENARIOS.find((s) => s.id === "gapJump") as CubeoScenario;
        const g = gameFromScenario(scenario);
        expect(g.moves()).to.include(GAP_JUMP_MOVE);
    });
});
