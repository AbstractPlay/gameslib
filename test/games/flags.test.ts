/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import {
    BasaltGame,
    ConnectionsGame,
    CrossControlGame,
    PletoreGame,
    StigmergyGame,
    YavalathGame,
    GameFactory,
    resolveGameFlags,
} from "../../src/games";

const yavalath3pState = `{"game":"yavalath","numplayers":3,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20250112","_results":[],"_timestamp":"2025-01-23T17:17:29.832Z","currplayer":1,"board":{"dataType":"Map","value":[]}},{"_version":"20250112","_results":[{"type":"place","where":"e5"}],"_timestamp":"2025-01-23T22:12:49.748Z","currplayer":2,"lastmove":"e5","board":{"dataType":"Map","value":[["e5",1]]}}]}`;

const basaltPieMidTurn = `{"game":"basalt","numplayers":2,"variants":["pie"],"gameover":false,"winner":[],"stack":[{"_version":"20250118","_results":[],"_timestamp":"2025-01-01T00:00:00.000Z","currplayer":1,"board":{"dataType":"Map","value":[]},"connPath":[]},{"_version":"20250118","_results":[{"type":"place","where":"a1"}],"_timestamp":"2025-01-01T00:00:01.000Z","currplayer":2,"lastmove":"a1","board":{"dataType":"Map","value":[["a1",[1]]]},"connPath":[]}]}`;

function hasFlag(flags: readonly string[], name: string): boolean {
    return flags.includes(name);
}

describe("resolveFlags / getFlags", () => {
    describe("Basalt", () => {
        it("default has no pie-even", () => {
            const g = new BasaltGame();
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.false;
            expect(hasFlag(resolveGameFlags("basalt", {}), "pie-even")).to.be.false;
        });

        it("pie variant includes pie-even", () => {
            const g = new BasaltGame(undefined, ["pie"]);
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.true;
            expect(hasFlag(resolveGameFlags("basalt", { variants: ["pie"] }), "pie-even")).to.be.true;
        });

        it("resumed pie variant matches resolveGameFlags", () => {
            const g = GameFactory("basalt", basaltPieMidTurn)!;
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.true;
            expect(g.isPieTurn()).to.be.true;
            expect(
                hasFlag(resolveGameFlags("basalt", { variants: g.variants, numplayers: g.numplayers }), "pie-even"),
            ).to.be.true;
        });
    });

    describe("Yavalath", () => {
        it("2p includes pie", () => {
            const g = new YavalathGame(2);
            expect(hasFlag(g.getFlags(), "pie")).to.be.true;
            expect(hasFlag(resolveGameFlags("yavalath", { numplayers: 2 }), "pie")).to.be.true;
        });

        it("3p excludes pie", () => {
            const g = new YavalathGame(3);
            expect(hasFlag(g.getFlags(), "pie")).to.be.false;
            expect(hasFlag(resolveGameFlags("yavalath", { numplayers: 3 }), "pie")).to.be.false;
        });

        it("resumed 3p state excludes pie", () => {
            const g = GameFactory("yavalath", yavalath3pState)!;
            expect(g.numplayers).to.equal(3);
            expect(hasFlag(g.getFlags(), "pie")).to.be.false;
        });
    });

    describe("Pletore", () => {
        it("default includes pie-even", () => {
            const g = new PletoreGame();
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.true;
        });

        it("empty variants includes pie-even", () => {
            expect(hasFlag(resolveGameFlags("pletore", { variants: [] }), "pie-even")).to.be.true;
        });

        it("nokomi excludes pie-even", () => {
            const g = new PletoreGame(undefined, ["nokomi"]);
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.false;
        });
    });

    describe("Stigmergy", () => {
        it("default includes pie-even", () => {
            const g = new StigmergyGame();
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.true;
        });

        it("nokomi excludes pie-even", () => {
            const g = new StigmergyGame(undefined, ["nokomi"]);
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.false;
        });
    });

    describe("Crosscontrol", () => {
        it("default includes pie-even", () => {
            const g = new CrossControlGame();
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.true;
        });

        it("nokomi excludes pie-even", () => {
            const g = new CrossControlGame(undefined, ["nokomi"]);
            expect(hasFlag(g.getFlags(), "pie-even")).to.be.false;
        });
    });

    describe("Connections", () => {
        it("getFlags matches static gameinfo.flags", () => {
            const g = new ConnectionsGame();
            const staticFlags = ConnectionsGame.gameinfo.flags ?? [];
            expect([...g.getFlags()].sort()).to.deep.equal([...staticFlags].sort());
        });
    });
});
