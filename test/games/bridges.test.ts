/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { BridgesGame, type IMoveState, type IBridgesState } from "../../src/games/bridges.js";
import type { HexDir } from "../../src/common/graphs/hextri.js";

function playerTwoBridgeAutocompleteState(): BridgesGame {
    const stack: IMoveState[] = [
        {
            _version: BridgesGame.gameinfo.version,
            _results: [],
            _timestamp: new Date("2026-09-06T15:40:48.895Z"),
            currplayer: 1,
            board: new Map(),
            scores: [0, 0],
            bridges: [[], []],
        },
        {
            _version: BridgesGame.gameinfo.version,
            _results: [{type: "place", where: "k3"}],
            _timestamp: new Date("2026-09-06T15:40:49.974Z"),
            currplayer: 2,
            lastmove: "k3",
            board: new Map([["k3", [1, 1, undefined, false]]]),
            scores: [0, 0],
            bridges: [[], []],
        },
        {
            _version: BridgesGame.gameinfo.version,
            _results: [
                {type: "place", where: "j13"},
                {type: "place", where: "a6"},
            ],
            _timestamp: new Date("2026-09-06T15:40:56.103Z"),
            currplayer: 1,
            lastmove: "j13,a6",
            board: new Map([
                ["k3", [1, 1, undefined, false]],
                ["j13", [2, 1, undefined, false]],
                ["a6", [2, 1, undefined, false]],
            ]),
            scores: [0, 0],
            bridges: [[7], []],
        },
        {
            _version: BridgesGame.gameinfo.version,
            _results: [
                {type: "place", where: "c6"},
                {type: "connect", p1: "c6", p2: "k3"},
            ],
            _timestamp: new Date("2026-09-06T15:41:01.409Z"),
            currplayer: 2,
            lastmove: "c6,c6-k3",
            board: new Map([
                ["k3", [1, 1, undefined, true]],
                ["j13", [2, 1, undefined, false]],
                ["a6", [2, 1, undefined, false]],
                ["c6", [1, 1, undefined, true]],
                ["d6", [1, 2, "NW" as HexDir, false]],
                ["e6", [1, 2, "NW" as HexDir, false]],
                ["f6", [1, 2, "NW" as HexDir, false]],
                ["g6", [1, 2, "NW" as HexDir, false]],
                ["h6", [1, 2, "NW" as HexDir, false]],
                ["i5", [1, 2, "NW" as HexDir, false]],
                ["j4", [1, 2, "NW" as HexDir, false]],
            ]),
            scores: [7, 0],
            bridges: [[7], []],
        },
    ];

    const state: IBridgesState = {
        game: "bridges",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack,
    };
    return new BridgesGame(state);
}

describe("Bridges", () => {
    it("autocompletes a bridge when only one endpoint is legal despite combo continuations", () => {
        const g = playerTwoBridgeAutocompleteState();
        expect(g.currplayer).to.equal(2);

        const result = g.validateMove("a6-");
        expect(result.valid).to.be.true;
        expect(result.autocomplete).to.equal("a6-j13");
    });

    it("records bridge segment cells on connect results", () => {
        const g = playerTwoBridgeAutocompleteState();
        g.move("a6-j13");

        const connect = g.results.find(r => r.type === "connect");
        expect(connect).to.deep.include({type: "connect", p1: "a6", p2: "j13"});
        expect(connect?.between).to.be.an("array").that.is.not.empty;
        expect(connect?.between).to.not.include("a6");
        expect(connect?.between).to.not.include("j13");
    });
});
