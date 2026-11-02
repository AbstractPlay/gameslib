import type { ICubeoState } from "../../../src/games/cubeo.js";
import { d10MidgameState } from "./d10MidgameState.js";
import { d12MidgameState } from "./d12MidgameState.js";
import { gapJumpState } from "./gapJumpState.js";

export type CubeoScenarioTier = "core" | "extended";

export type CubeoScenario =
    | {
          id: string;
          description: string;
          tier: CubeoScenarioTier;
          state: "fresh";
          variants: string[];
      }
    | {
          id: string;
          description: string;
          tier: CubeoScenarioTier;
          state: ICubeoState;
          variants?: string[];
      };

export const gapJumpStrictState: ICubeoState = {
    ...gapJumpState,
    variants: ["strict"],
};

export const CUBEO_SCENARIOS: CubeoScenario[] = [
    {
        id: "opening",
        description: "Default d6 start, player 1 to move",
        tier: "core",
        state: "fresh",
        variants: [],
    },
    {
        id: "gapJump",
        description: "Gap-jump regression board (standard rules)",
        tier: "core",
        state: gapJumpState,
    },
    {
        id: "gapJumpStrict",
        description: "Gap-jump board with strict movement variant",
        tier: "core",
        state: gapJumpStrictState,
    },
    {
        id: "d10Midgame",
        description: "d10 greedy playout, 20 dice on board (extended gate)",
        tier: "extended",
        state: d10MidgameState,
    },
    {
        id: "d12Midgame",
        description: "d12 greedy playout, 24 dice on board (extended gate)",
        tier: "extended",
        state: d12MidgameState,
    },
];

export const CUBEO_CORE_SCENARIOS = CUBEO_SCENARIOS.filter((s) => s.tier === "core");
export const CUBEO_EXTENDED_SCENARIOS = CUBEO_SCENARIOS.filter((s) => s.tier === "extended");

/** Must remain legal after any move-gen refactor (gap-jump fix). */
export const GAP_JUMP_MOVE = "2,0,2->-1,2";
