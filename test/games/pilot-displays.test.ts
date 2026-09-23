/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    StigmergyGame,
} from "../../src/games/stigmergy.js";
import { ControlGame } from "../../src/games/control.js";
import { tumbleweedFrom } from "./tumbleweed.test.js";

describe("pilot game display options", () => {
    describe("Stigmergy", () => {
        it("vertex-style switches board style", () => {
            const g = new StigmergyGame();
            expect(g.render({}).board.style).to.equal("hex-of-hex");
            expect(g.render({ altDisplays: ["vertex-style"] }).board.style).to.equal("hex-of-tri");
        });

        it("combines vertex-style with hide-influence", () => {
            const g = new StigmergyGame();
            const rep = g.render({ altDisplays: ["hide-influence", "vertex-style"] });
            expect(rep.board.style).to.equal("hex-of-tri");
        });

        it("legacy hide-both matches explicit overlay pair", () => {
            const g = new StigmergyGame();
            const legacy = g.render({ altDisplay: "hide-both" });
            const explicit = g.render({ altDisplays: ["hide-threatened", "hide-influence"] });
            expect(legacy.board).to.deep.equal(explicit.board);
        });

        it("resolveActiveDisplays keeps overlay and vertex toggles together", () => {
            const g = new StigmergyGame();
            expect(
                g.resolveActiveDisplays({ altDisplays: ["hide-influence", "vertex-style"] }).sort(),
            ).to.deep.equal(["hide-influence", "vertex-style"]);
        });
    });

    describe("Control", () => {
        function controlWithBoard(cells: [string, 1 | 2][]): ControlGame {
            const state = {
                game: "control",
                numplayers: 2,
                variants: [] as string[],
                gameover: false,
                winner: [] as (1 | 2)[],
                stack: [
                    {
                        _version: ControlGame.gameinfo.version,
                        _results: [],
                        _timestamp: new Date(),
                        currplayer: 1 as const,
                        board: new Map(cells),
                        scores: [0, 0] as [number, number],
                    },
                ],
            };
            return new ControlGame(state);
        }

        it("combines hide-control with vertex-style", () => {
            const g = controlWithBoard([["h8", 1]]);
            const rep = g.render({ altDisplays: ["hide-control", "vertex-style"] });
            expect(rep.board.style).to.equal("hex-of-tri");
            const withControl = g.render({ altDisplays: ["vertex-style"] });
            expect(withControl.annotations?.some((a) => a.type === "dots")).to.be.true;
            expect(rep.annotations?.some((a) => a.type === "dots")).to.not.equal(true);
        });
    });

    describe("Tumbleweed", () => {
        it("legacy hide-both matches explicit overlay pair on piece map", () => {
            const g = tumbleweedFrom({
                board: [
                    ["h8", [3, 2]],
                    ["o1", [1, 1]],
                    ["o2", [2, 1]],
                ],
                currplayer: 1,
                lastmove: "o2",
                stackDepth: 4,
            });
            const legacy = g.render({ altDisplay: "hide-both" });
            const explicit = g.render({ altDisplays: ["hide-threatened", "hide-influence"] });
            expect(legacy.pieces).to.equal(explicit.pieces);
            expect(legacy.board).to.deep.equal(explicit.board);
        });
    });
});
