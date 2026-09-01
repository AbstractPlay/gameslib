import "mocha";
import { expect } from "chai";
import { GameFactory } from "../../src/games";
import { MagnateGame } from "../../src/games/magnate";
import { MinefieldGame } from "../../src/games/minefield";
import { TaijiGame } from "../../src/games/taiji";
import { assertChallengeVariantSelection } from "../../src/games/_gameinfo-filter";
import { UserFacingError } from "../../src/common/errors";

describe("variant constraint migrations", () => {
    describe("Magnate", () => {
        it("drops stacked without mega on fresh init", () => {
            const g = GameFactory("magnate", undefined, ["stacked"]);
            expect(g.variants).to.not.include("stacked");
        });

        it("keeps stacked with mega", () => {
            const g = GameFactory("magnate", undefined, ["mega", "stacked"]);
            expect(g.variants).to.include.members(["mega", "stacked"]);
        });

        it("allvariants includes requires on stacked", () => {
            const stacked = MagnateGame.create().allvariants()?.find((v) => v.uid === "stacked");
            expect(stacked?.requires).to.deep.equal(["mega"]);
        });

        it("assertChallengeVariantSelection rejects stacked without mega", () => {
            expect(() =>
                assertChallengeVariantSelection(MagnateGame.gameinfo, ["stacked"]),
            ).to.throw(UserFacingError, "INVALID_VARIANT_COMBINATION");
        });
    });

    describe("Minefield", () => {
        it("does not keep pinwheel and cartwheel together", () => {
            const g = GameFactory("minefield", undefined, ["size-15", "pinwheel", "cartwheel"]);
            const tileModes = g.variants.filter((v) => v === "pinwheel" || v === "cartwheel");
            expect(tileModes.length).to.be.at.most(1);
        });

        it("allvariants includes conflictsWith on pinwheel", () => {
            const pinwheel = MinefieldGame.create().allvariants()?.find((v) => v.uid === "pinwheel");
            expect(pinwheel?.conflictsWith).to.deep.equal(["cartwheel"]);
        });

        it("assertChallengeVariantSelection rejects pinwheel with cartwheel", () => {
            expect(() =>
                assertChallengeVariantSelection(MinefieldGame.gameinfo, ["size-15", "pinwheel", "cartwheel"]),
            ).to.throw(UserFacingError, "INVALID_VARIANT_COMBINATION");
        });
    });

    describe("Taiji", () => {
        it("keeps one board variant when two are passed", () => {
            const g = GameFactory("taiji", undefined, ["7x7", "11x11", "squares"]);
            const boardUids = g.variants.filter((v) => v === "7x7" || v === "11x11");
            expect(boardUids).to.have.length(1);
            expect(boardUids[0]).to.equal("11x11");
            expect(g.variants).to.include("squares");
        });

        it("keeps one scoring variant when two are passed", () => {
            const g = GameFactory("taiji", undefined, ["squares", "products"]);
            const scoring = g.variants.filter((v) => v === "squares" || v === "products");
            expect(scoring).to.deep.equal(["products"]);
        });

        it("assertChallengeVariantSelection rejects duplicate board groups", () => {
            expect(() =>
                assertChallengeVariantSelection(TaijiGame.gameinfo, ["7x7", "11x11"]),
            ).to.throw(UserFacingError, "INVALID_VARIANT_COMBINATION");
        });
    });

    describe("Zola", () => {
        it("accepts 8x8 on fresh init", () => {
            const g = GameFactory("zola", undefined, ["8x8"]);
            expect(g.variants).to.deep.equal(["8x8"]);
            expect(g.boardSize).to.equal(8);
        });
    });
});
