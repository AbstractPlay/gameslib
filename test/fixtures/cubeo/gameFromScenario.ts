import { CubeoGame } from "../../../src/games/cubeo.js";
import type { CubeoScenario } from "./scenarios.js";

export function gameFromScenario(scenario: CubeoScenario): CubeoGame {
    if (scenario.state === "fresh") {
        return new CubeoGame(undefined, scenario.variants);
    }
    return new CubeoGame(scenario.state);
}
