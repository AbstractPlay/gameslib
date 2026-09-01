import "mocha";
import { expect } from "chai";
import { GameFactory } from "../../src/games";
import { LinesOfActionGame } from "../../src/games/loa";
import { DruidGame } from "../../src/games/druid";
import {
    assertChallengeVariantSelection,
    assertChallengeVariants,
} from "../../src/games/_gameinfo-filter";
import { UserFacingError } from "../../src/common/errors";

describe("variant constraint pilots", () => {
    describe("LOA", () => {
        it("drops scrambled when hex5 is selected on fresh init", () => {
            const g = GameFactory("loa", undefined, ["hex5", "scrambled"]);
            expect(g!.variants).to.deep.equal(["hex5"]);
        });

        it("keeps scrambled with classic board", () => {
            const g = GameFactory("loa", undefined, ["classic", "scrambled"]);
            expect(g!.variants).to.include.members(["classic", "scrambled"]);
        });

        it("allvariants includes enabledWhen metadata", () => {
            const engine = LinesOfActionGame.create();
            const scrambled = engine.allvariants()?.find((v) => v.uid === "scrambled");
            expect(scrambled?.enabledWhen).to.deep.equal({ board: ["#board", "classic"] });
        });

        it("assertChallengeVariantSelection rejects hex5 + scrambled", () => {
            expect(() =>
                assertChallengeVariantSelection(LinesOfActionGame.gameinfo, ["hex5", "scrambled"]),
            ).to.throw(UserFacingError, "INVALID_VARIANT_COMBINATION");
        });
    });

    describe("Druid", () => {
        it("drops walk on hex board fresh init", () => {
            const g = GameFactory("druid", undefined, ["hex-5", "walk"]);
            expect(g.variants).to.deep.equal(["hex-5"]);
        });

        it("keeps walk on rect board", () => {
            const g = GameFactory("druid", undefined, ["size-8", "walk"]);
            expect(g.variants).to.deep.equal(["size-8", "walk"]);
        });

        it("allvariants includes enabledWhen on walk", () => {
            const engine = DruidGame.create();
            const walk = engine.allvariants()?.find((v) => v.uid === "walk");
            expect(walk?.enabledWhen?.board).to.include.members(["#board", "size-8", "size-12"]);
        });
    });

    describe("assertChallengeVariants", () => {
        it("accepts valid LOA selection", () => {
            assertChallengeVariants(LinesOfActionGame.gameinfo, ["classic", "scrambled"]);
        });
    });
});
