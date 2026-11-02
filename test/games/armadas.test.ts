/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { ArmadasGame } from "../../src/games/armadas";
import { Ship } from "../../src/games/armadas/ship";
import {
    ARMADAS_PROD_PRE_RESIGN_GAME_ID,
    buildArmadasThreePlayerPreResignProd,
    playersWithShips,
} from "../fixtures/armadas/threePlayerPreResignProd";

function checkEOG(g: ArmadasGame): void {
    (g as unknown as { checkEOG: () => void }).checkEOG();
}

describe("Armadas", () => {
    describe("prod 3p pre-resign fixture", () => {
        it("matches e9dbcad8 board: P1 and P2 have ships, P3 does not", () => {
            const g = buildArmadasThreePlayerPreResignProd();
            expect(g.gameover).to.be.false;
            expect(g.phase).to.equal("play");
            expect(playersWithShips(g)).to.deep.equal([1, 2]);
        });
    });

    describe("resign winner", () => {
        it(`assigns sole fleet holder when prod board resigns (${ARMADAS_PROD_PRE_RESIGN_GAME_ID})`, () => {
            const g = buildArmadasThreePlayerPreResignProd();
            g.resign(1);
            expect(g.gameover).to.be.true;
            expect(g.lastmove).to.equal("resign");
            expect(g.winner).to.deep.equal([2]);
        });

        it("defaults to co-win when more than one remaining fleet has ships", () => {
            const g = buildArmadasThreePlayerPreResignProd();
            g.ships.push(
                new Ship({ id: "Zeta", owner: 3, size: 1, cx: 400, cy: 400, facing: 0 }),
            );
            g.resign(1);
            expect(g.winner).to.have.members([2, 3]);
        });

        it("timeout uses the same winner logic as resign", () => {
            const g = buildArmadasThreePlayerPreResignProd();
            g.timeout(1);
            expect(g.winner).to.deep.equal([2]);
        });
    });

    describe("rules EOG", () => {
        it("declares a single winner when one player owns every ship", () => {
            const g = new ArmadasGame(3, ["twoislands"]);
            g.load(-1);
            g.phase = "play";
            g.gameover = false;
            g.winner = [];
            g.ships = [
                new Ship({ id: "Alpha", owner: 2, size: 1, cx: 300, cy: 300, facing: 0 }),
                new Ship({ id: "Beta", owner: 2, size: 2, cx: 350, cy: 350, facing: 90 }),
            ];
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });
    });
});
