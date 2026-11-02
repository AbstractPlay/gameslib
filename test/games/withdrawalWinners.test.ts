import "mocha";
import { expect } from "chai";
import { HomeworldsGame } from "../../src/games/homeworlds";
import { PacruGame } from "../../src/games/pacru";
import { PigsGame } from "../../src/games/pigs";
import { YavalathGame } from "../../src/games/yavalath";
import { buildArmadasThreePlayerPreResignProd } from "../fixtures/armadas/threePlayerPreResignProd";

describe("winnersAfterWithdrawal", () => {
    describe("Armadas", () => {
        it("sole remaining fleet on resign", () => {
            const g = buildArmadasThreePlayerPreResignProd();
            g.resign(1);
            expect(g.winner).to.deep.equal([2]);
        });
    });

    describe("Pacru", () => {
        it("excludes shipless seats when one chevron holder remains", () => {
            const g = new PacruGame(3);
            g.board.clear();
            g.board.set("a9", { chevron: { owner: 1, facing: "SE" } });
            g.board.set("i1", { chevron: { owner: 2, facing: "NW" } });
            g.resign(1);
            expect(g.winner).to.deep.equal([2]);
        });
    });

    describe("Pigs", () => {
        it("excludes eliminated robots on resign", () => {
            const g = new PigsGame(3);
            g.damage = [0, 0, 5];
            g.board.set("a1", [1, "N"]);
            g.board.set("h8", [2, "S"]);
            g.resign(1);
            expect(g.winner).to.deep.equal([2]);
        });
    });

    describe("Homeworlds", () => {
        it("keeps early 4p co-win on resign", () => {
            const g = new HomeworldsGame(4);
            g.move("homeworld g3 b2 y3");
            g.move("homeworld g2 b1 r3");
            g.move("homeworld g2 b3 r3");
            g.move("homeworld g3 b1 y3");
            g.resign(3);
            expect(g.winner).to.have.members([1, 2, 4]);
        });
    });

    describe("Yavalath", () => {
        it("excludes eliminated seat on resign", () => {
            const g = new YavalathGame(3);
            g.eliminated = 2;
            g.resign(1);
            expect(g.winner).to.deep.equal([3]);
        });

        it("co-wins all non-resigners when nobody is eliminated", () => {
            const g = new YavalathGame(3);
            g.resign(3);
            expect(g.winner).to.have.members([1, 2]);
        });
    });
});
