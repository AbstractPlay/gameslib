/**
 * Alien City golden oracle — regenerate with:
 *   UPDATE_ACITY_GOLDEN=1 npm run test0 -- test/games/acity-golden.test.ts
 */
import "mocha";
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { addResource } from "../../src";
import i18next from "i18next";
import { ACITY_GOLDEN_FIXTURES, ACITY_ALL_PIECES, gameFromGoldenFixture } from "../fixtures/acity-golden";
import { canPlaceLegacy } from "../fixtures/acity-legality-legacy";
import {
    assertGoldenHarnessGame,
    captureFullOracle,
    type ACityGoldenOracleFile,
} from "../fixtures/acity-golden-capture";

const ORACLE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/acity-golden-oracle.json");

function loadOracle(): ACityGoldenOracleFile {
    const raw = fs.readFileSync(ORACLE_PATH, "utf8");
    return JSON.parse(raw) as ACityGoldenOracleFile;
}

function emptyCells(g: ReturnType<typeof gameFromGoldenFixture>): string[] {
    return (g.graph.listCells() as string[]).filter((c) => !g.board.has(c));
}

describe("Alien City golden oracle", () => {
    before(() => {
        addResource("en");
        assertGoldenHarnessGame();
    });

    after(() => {
        i18next.removeResourceBundle("en", "apgames");
        i18next.removeResourceBundle("en", "apresults");
    });

    if (process.env.UPDATE_ACITY_GOLDEN === "1") {
        it("captures acity-golden-oracle.json", function () {
            this.timeout(600_000);
            const oracle = captureFullOracle();
            fs.writeFileSync(ORACLE_PATH, `${JSON.stringify(oracle, null, 2)}\n`, "utf8");
        });
        return;
    }

    const oracle = loadOracle();

    it("oracle file version is supported", () => {
        expect(oracle.version).to.equal(1);
        expect(Object.keys(oracle.fixtures).sort()).to.deep.equal(
            ACITY_GOLDEN_FIXTURES.map((f) => f.id).sort()
        );
    });

    for (const spec of ACITY_GOLDEN_FIXTURES) {
        describe(spec.id, () => {
            const expected = oracle.fixtures[spec.id]!;

            it("matches committed public API oracle", function () {
                if (spec.id === "fresh-open") {
                    this.timeout(30_000);
                }
                const g = gameFromGoldenFixture(spec);
                expect(g.isConnected()).to.equal(expected.isConnected);

                const pass = g.validateMove("pass");
                expect(pass.valid).to.equal(expected.pass.valid);
                expect(pass.complete).to.equal(expected.pass.complete);
                expect(pass.message).to.equal(expected.pass.message);

                g.currplayer = 1;
                expect(g.moves().slice().sort()).to.deep.equal(expected.moves1);
                g.currplayer = 2;
                expect(g.moves().slice().sort()).to.deep.equal(expected.moves2);
                g.currplayer = spec.currplayer;

                expect([g.getPlayerScore(1), g.getPlayerScore(2)]).to.deep.equal(expected.scores);

                for (const [key, dist] of Object.entries(expected.distances)) {
                    const [from, to] = key.split("|");
                    expect(g.goldenRealDistance(from!, to!)).to.equal(dist);
                }

                for (const [move, snap] of Object.entries(expected.extraValidations)) {
                    const r = g.validateMove(move);
                    expect(r.valid).to.equal(snap.valid);
                    expect(r.complete).to.equal(snap.complete);
                    expect(r.message).to.equal(snap.message);
                }

                for (const [key, snap] of Object.entries(expected.placementGrid)) {
                    const r = g.validateMove(key);
                    expect(r.valid, key).to.equal(snap.valid);
                    expect(r.complete, key).to.equal(snap.complete);
                    if (snap.canrender !== undefined) {
                        expect(r.canrender, key).to.equal(snap.canrender);
                    }
                    expect(r.message, key).to.equal(snap.message);
                }
            });

            it("legacy canPlace matches production goldenPlacementResult", () => {
                const g = gameFromGoldenFixture(spec);
                for (const piece of ACITY_ALL_PIECES) {
                    for (const cell of emptyCells(g)) {
                        const key = `${piece}-${cell}`;
                        expect(
                            canPlaceLegacy(g, piece, cell),
                            key
                        ).to.equal(expected.placementResults[key]);
                        expect(g.goldenPlacementResult(piece, cell), key).to.equal(expected.placementResults[key]);
                    }
                }
            });
        });
    }
});
