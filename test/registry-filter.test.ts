import { expect } from "chai";
import { MinefieldGame } from "../src/games/minefield";
import { RealmGame } from "../src/games/realm";
import {
    filterGameinfoForProduction,
    allowedChallengeVariantUids,
    assertAllowedChallengeVariants,
    assertChallengeVariantSelection,
} from "../src/games/_gameinfo-filter";
import { LinesOfActionGame } from "../src/games/loa";
import { UserFacingError } from "../src/common/errors";
import { EXPERIMENTAL_VARIANT_UIDS_BY_GAME } from "../src/games/_registry-filter.generated";
import { APGAMES_PRODUCTION } from "../src/games/_build-flags.generated";

describe("registry experimental variant filtering", () => {
    it("discovers experimental variants for minefield and realm in generated map", () => {
        expect(EXPERIMENTAL_VARIANT_UIDS_BY_GAME.minefield).to.include.members(["size-8", "size-9", "cartwheel"]);
        expect(EXPERIMENTAL_VARIANT_UIDS_BY_GAME.realm).to.include("TEST");
    });

    it("filterGameinfoForProduction is a no-op when APGAMES_PRODUCTION is false", () => {
        if (APGAMES_PRODUCTION) {
            return;
        }
        const info = MinefieldGame.gameinfo;
        const filtered = filterGameinfoForProduction(info);
        expect(filtered.variants?.map((v) => v.uid)).to.deep.equal(info.variants?.map((v) => v.uid));
    });

    it("filterGameinfoForProduction strips experimental variants when APGAMES_PRODUCTION is true", () => {
        if (!APGAMES_PRODUCTION) {
            return;
        }
        const filtered = filterGameinfoForProduction(MinefieldGame.gameinfo);
        const uids = filtered.variants?.map((v) => v.uid) ?? [];
        expect(uids).to.not.include("size-8");
        expect(uids).to.not.include("size-9");
        expect(uids).to.not.include("cartwheel");
        expect(uids).to.include("size-15");
        expect(uids).to.include("#board");

        const realmFiltered = filterGameinfoForProduction(RealmGame.gameinfo);
        expect(realmFiltered.variants?.map((v) => v.uid)).to.not.include("TEST");
    });

    it("allowedChallengeVariantUids matches filtered gameinfo variants", () => {
        const allowed = allowedChallengeVariantUids(MinefieldGame.gameinfo);
        const filteredUids = filterGameinfoForProduction(MinefieldGame.gameinfo).variants?.map((v) => v.uid) ?? [];
        expect([...allowed].sort()).to.deep.equal(filteredUids.sort());
    });

    it("assertAllowedChallengeVariants rejects disallowed uids in production", () => {
        if (!APGAMES_PRODUCTION) {
            return;
        }
        try {
            assertAllowedChallengeVariants(MinefieldGame.gameinfo, ["cartwheel"]);
            expect.fail("expected assertAllowedChallengeVariants to throw");
        } catch (err: unknown) {
            expect((err as Error).message).to.equal("INVALID_VARIANTS");
        }
        assertAllowedChallengeVariants(MinefieldGame.gameinfo, ["size-15"]);
    });

    it("challengeVariants matches allvariants in dev and is subset in production", () => {
        const engine = MinefieldGame.create();
        const all = engine.allvariants() ?? [];
        const challenge = engine.challengeVariants() ?? [];
        if (APGAMES_PRODUCTION) {
            expect(challenge.map((v) => v.uid)).to.not.include("cartwheel");
            expect(challenge.length).to.be.lessThan(all.length);
        } else {
            expect(challenge.map((v) => v.uid)).to.deep.equal(all.map((v) => v.uid));
        }
    });

    it("assertChallengeVariantSelection rejects invalid LOA combinations", () => {
        expect(() =>
            assertChallengeVariantSelection(LinesOfActionGame.gameinfo, ["hex5", "scrambled"]),
        ).to.throw(UserFacingError, "INVALID_VARIANT_COMBINATION");
        assertChallengeVariantSelection(LinesOfActionGame.gameinfo, ["classic", "scrambled"]);
    });
});
