import "mocha";
import { expect } from "chai";
import {
    binarySizeToRowFromStack,
    classifyBinaryPairing,
    tryBuildBinarySizeToRow,
    traditionalRowsForRender,
    type HomeworldsStackSnapshot,
} from "../../../src/games/homeworlds/peripheralLayout.js";
import type { Star } from "../../../src/games/homeworlds.js";
import { HomeworldsGame } from "../../../src/games/homeworlds.js";
import { System } from "../../../src/games/homeworlds/system.js";

function snap(systems: { name: string; owner?: "N" | "S"; stars: Star[] }[]): HomeworldsStackSnapshot {
    return { systems };
}

describe("homeworlds peripheralLayout", () => {
    it("classifies large binary pairing", () => {
        const n: Star[] = [["Y", 3], ["G", 2]];
        const s: Star[] = [["G", 2], ["B", 1]];
        expect(classifyBinaryPairing(n, s)).to.equal("large");
        const map = tryBuildBinarySizeToRow(n, s)!;
        expect(map[1]).to.equal(0);
        expect(map[2]).to.equal(1);
        expect(map[3]).to.equal(2);
    });

    it("classifies small binary pairing", () => {
        const n: Star[] = [["R", 1], ["B", 2]];
        const s: Star[] = [["G", 1], ["Y", 2]];
        expect(classifyBinaryPairing(n, s)).to.equal("small");
        const map = tryBuildBinarySizeToRow(n, s)!;
        expect(map[3]).to.equal(0);
        expect(map[1]).to.equal(1);
        expect(map[2]).to.equal(2);
    });

    it("classifies micro binary pairing", () => {
        const n: Star[] = [["Y", 1], ["G", 2]];
        const s: Star[] = [["B", 3]];
        expect(classifyBinaryPairing(n, s)).to.equal("micro");
        const map = tryBuildBinarySizeToRow(n, s)!;
        expect(map[1]).to.equal(0);
        expect(map[2]).to.equal(0);
        expect(map[3]).to.equal(2);
    });

    it("micro with neutral size", () => {
        const n: Star[] = [["Y", 1]];
        const s: Star[] = [["B", 3]];
        const map = tryBuildBinarySizeToRow(n, s)!;
        expect(map[2]).to.equal(1);
    });

    it("binarySizeToRowFromStack reads stack[2] only", () => {
        const stack: HomeworldsStackSnapshot[] = [
            snap([]),
            snap([{ name: "North", owner: "N", stars: [["B", 3], ["G", 2]] }]),
            snap([
                { name: "North", owner: "N", stars: [["B", 3], ["G", 2]] },
                { name: "South", owner: "S", stars: [["G", 2], ["B", 1]] },
            ]),
        ];
        const map = binarySizeToRowFromStack(stack, 2)!;
        expect(map[1]).to.equal(0);
        expect(map[2]).to.equal(1);
        expect(map[3]).to.equal(2);
    });

    it("traditionalRowsForRender maps peripheries by star size", () => {
        const stack: HomeworldsStackSnapshot[] = [
            snap([]),
            snap([{ name: "North", owner: "N", stars: [["B", 3], ["G", 2]] }]),
            snap([
                { name: "North", owner: "N", stars: [["B", 3], ["G", 2]] },
                { name: "South", owner: "S", stars: [["G", 2], ["B", 1]] },
            ]),
        ];
        const systems = [
            new System("North", [["B", 3], ["G", 2]], "N"),
            new System("South", [["G", 2], ["B", 1]], "S"),
            new System("Pheedo", [["Y", 1]]),
            new System("Mid", [["G", 2]]),
        ];
        const rows = traditionalRowsForRender(systems, stack, 2)!;
        expect(rows.get("Pheedo")).to.equal(0);
        expect(rows.get("Mid")).to.equal(1);
    });
});

describe("Homeworlds Traditional render", () => {
    it("default render has no layout on board", () => {
        const g = new HomeworldsGame(2);
        g.systems = [
            new System("North", [["B", 3], ["G", 2]], "N"),
            new System("South", [["G", 2], ["B", 1]], "S"),
            new System("Pheedo", [["Y", 1]]),
        ];
        g.stack = [
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                systems: [],
                stash: g.stash,
            },
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 2,
                systems: [g.systems[0]!.clone()],
                stash: g.stash,
            },
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                systems: [g.systems[0]!.clone(), g.systems[1]!.clone()],
                stash: g.stash,
            },
        ];
        const rep = g.render();
        for (const entry of rep.board as { layout?: unknown }[]) {
            expect(entry.layout).to.equal(undefined);
        }
    });

    it("traditional display adds layout rows from stack[2] map", () => {
        const g = new HomeworldsGame(2);
        g.systems = [
            new System("North", [["B", 3], ["G", 2]], "N"),
            new System("South", [["G", 2], ["B", 1]], "S"),
            new System("Pheedo", [["Y", 1]]),
        ];
        g.stack = [
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                systems: [],
                stash: g.stash,
            },
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 2,
                systems: [g.systems[0]!.clone()],
                stash: g.stash,
            },
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                systems: [g.systems[0]!.clone(), g.systems[1]!.clone()],
                stash: g.stash,
            },
        ];
        const rep = g.render({ altDisplay: "traditional" });
        const board = rep.board as { name: string; seat?: string; layout?: { row: number } }[];
        expect(board.find((e) => e.name === "North")!.layout).to.equal(undefined);
        expect(board.find((e) => e.name === "Pheedo")!.layout).to.deep.equal({ row: 0 });
    });

    it("home star change does not change peripheral row map source", () => {
        const g = new HomeworldsGame(2);
        g.systems = [
            new System("North", [["B", 3]], "N"),
            new System("South", [["G", 2], ["B", 1]], "S"),
            new System("Pheedo", [["Y", 1]]),
        ];
        g.stack = [
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                systems: [],
                stash: g.stash,
            },
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 2,
                systems: [new System("North", [["B", 3], ["G", 2]], "N")],
                stash: g.stash,
            },
            {
                _version: "20211024",
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                systems: [
                    new System("North", [["B", 3], ["G", 2]], "N"),
                    new System("South", [["G", 2], ["B", 1]], "S"),
                ],
                stash: g.stash,
            },
        ];
        const rep = g.render({ altDisplay: "traditional" });
        const pheedo = (rep.board as { name: string; layout?: { row: number } }[]).find((e) => e.name === "Pheedo")!;
        expect(pheedo.layout).to.deep.equal({ row: 0 });
    });

    it("3-player never emits layout", () => {
        const g = new HomeworldsGame(3);
        const rep = g.render({ altDisplay: "traditional" });
        if (Array.isArray(rep.board)) {
            for (const entry of rep.board as { layout?: unknown }[]) {
                expect(entry.layout).to.equal(undefined);
            }
        }
    });
});
