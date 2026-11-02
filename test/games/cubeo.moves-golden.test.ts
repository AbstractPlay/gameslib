/**
 * Extended Cubeo regression gates (d10/d12 midgames, slide-topology parity).
 * Not part of default `npm test` — run locally: `npm run test:cubeo-gates`.
 */

import "mocha";
import { CUBEO_SCENARIOS } from "../fixtures/cubeo/scenarios.js";
import { CUBEO_GOLDEN_MOVELISTS } from "../fixtures/cubeo/goldenMovelists.js";
import { expectGoldenMovelist, expectListedMovesApply } from "../fixtures/cubeo/helpers.js";

describe("Cubeo movelist gates", () => {
    for (const scenario of CUBEO_SCENARIOS) {
        it(`${scenario.id} — ${scenario.description}`, () => {
            expectGoldenMovelist(scenario, CUBEO_GOLDEN_MOVELISTS[scenario.id]!);
            expectListedMovesApply(scenario, CUBEO_GOLDEN_MOVELISTS[scenario.id]!);
        });
    }
});
