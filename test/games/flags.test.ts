/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import {
    BasaltGame,
    ConnectionsGame,
    CrossControlGame,
    LifelineGame,
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

function flagsEqual(a: readonly string[], b: readonly string[]): boolean {
    return [...a].sort().join() === [...b].sort().join();
}

describe("resolveFlags / getFlags", () => {
    it("resolveGameFlags returns [] for unknown uid", () => {
        expect(resolveGameFlags("not-a-real-game", {})).to.deep.equal([]);
    });

    describe("serialize round-trip", () => {
        it("Basalt pie flags stable after serialize → resume", () => {
            const before = new BasaltGame(undefined, ["pie"]);
            const flagsBefore = [...before.getFlags()];
            const resumed = GameFactory("basalt", before.serialize())!;
            expect([...resumed.getFlags()].sort()).to.deep.equal(flagsBefore.sort());
            expect(resumed.isPieTurn()).to.equal(before.isPieTurn());
        });

        it("Yavalath 3p flags stable after serialize → resume", () => {
            const before = GameFactory("yavalath", yavalath3pState)!;
            const flagsBefore = [...before.getFlags()];
            const resumed = GameFactory("yavalath", before.serialize())!;
            expect([...resumed.getFlags()].sort()).to.deep.equal(flagsBefore.sort());
            expect(hasFlag(resumed.getFlags(), "pie")).to.be.false;
        });
    });

    describe("resolveGameFlags matches instance getFlags", () => {
        const cases: Array<{ uid: string; variants?: string[]; numplayers?: number }> = [
            { uid: "basalt" },
            { uid: "basalt", variants: ["pie"] },
            { uid: "yavalath", numplayers: 2 },
            { uid: "yavalath", numplayers: 3 },
            { uid: "pletore" },
            { uid: "pletore", variants: ["nokomi"] },
            { uid: "stigmergy", variants: [] },
            { uid: "stigmergy", variants: ["nokomi"] },
            { uid: "crosscontrol" },
            { uid: "crosscontrol", variants: ["nokomi"] },
            { uid: "connections" },
            { uid: "lifeline" },
        ];

        for (const { uid, variants, numplayers } of cases) {
            it(`${uid} ${JSON.stringify({ variants, numplayers })}`, () => {
                const context = { variants, numplayers };
                const resolved = resolveGameFlags(uid, context);
                const instance = numplayers !== undefined
                    ? GameFactory(uid, numplayers, variants)
                    : GameFactory(uid, undefined, variants);
                expect(instance).to.not.equal(undefined);
                expect(flagsEqual(resolved, instance!.getFlags())).to.be.true;
            });
        }
    });

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

    describe("Lifeline", () => {
        it("always includes pie", () => {
            const g = new LifelineGame();
            expect(hasFlag(g.getFlags(), "pie")).to.be.true;
            expect(flagsEqual(resolveGameFlags("lifeline", {}), g.getFlags())).to.be.true;
        });
    });
});
