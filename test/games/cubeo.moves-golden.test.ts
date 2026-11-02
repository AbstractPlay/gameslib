/**
 * Extended Cubeo regression gates (d10/d12 midgames, all scenarios).
 * Run locally during move-gen work:
 *   npm run test:cubeo-gates
 * Also runs under full `npm test`.
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
