/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { RealmGame, type CellContents, type IMoveState, type IRealmState } from "../src/games/realm.js";

const VERSION = RealmGame.gameinfo.version;
const REALM_E8 = "e8";
const REALM_H8 = "h8";

function playBoard(realmPieces: [string, CellContents][]): Map<string, CellContents> {
    return new Map(realmPieces);
}

function moveState(overrides: Partial<IMoveState> & Pick<IMoveState, "currplayer">): IMoveState {
    return {
        _version: VERSION,
        _results: [],
        _timestamp: new Date(),
        board: playBoard([
            ["e8", [1, "B", undefined]],
            ["e9", [1, "P", undefined]],
        ]),
        pieces: [[10, 2, 8], [10, 2, 8]],
        captured: [0, 0],
        phase: "play",
        inhand: undefined,
        ...overrides,
    };
}

function realmFromStack(stack: IMoveState[]): RealmGame {
    const state: IRealmState = {
        game: "realm",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack,
    };
    return new RealmGame(state);
}

function p1ThirdRearrangeBlockedState(): RealmGame {
    const stack: IMoveState[] = [
        moveState({ currplayer: 1 }),
        moveState({ currplayer: 2, lastmove: `-${REALM_E8}; p1e9` }),
        moveState({ currplayer: 1, lastmove: "pf9g9" }),
        moveState({ currplayer: 2, lastmove: `-${REALM_E8}; p1e9` }),
        moveState({ currplayer: 1, lastmove: "pf9g9" }),
    ];
    return realmFromStack(stack);
}

function p1StreakResetState(): RealmGame {
    const stack: IMoveState[] = [
        moveState({ currplayer: 1 }),
        moveState({ currplayer: 2, lastmove: `-${REALM_E8}; p1e9` }),
        moveState({ currplayer: 1, lastmove: "pf9g9" }),
        moveState({ currplayer: 2, lastmove: `-${REALM_E8}; p1e9` }),
        moveState({ currplayer: 1, lastmove: "pf9g9" }),
        moveState({ currplayer: 2, lastmove: "pe9f9" }),
        moveState({ currplayer: 1, lastmove: "pf9g9" }),
    ];
    return realmFromStack(stack);
}

function p1DifferentRealmState(): RealmGame {
    const stack: IMoveState[] = [
        moveState({
            currplayer: 1,
            board: playBoard([
                ["e8", [1, "B", undefined]],
                ["e9", [1, "P", undefined]],
                ["h8", [1, "B", undefined]],
                ["h9", [1, "P", undefined]],
            ]),
        }),
        moveState({
            currplayer: 2,
            lastmove: `-${REALM_E8}; p1e9`,
            board: playBoard([
                ["e8", [1, "B", undefined]],
                ["e9", [1, "P", undefined]],
                ["h8", [1, "B", undefined]],
                ["h9", [1, "P", undefined]],
            ]),
        }),
        moveState({
            currplayer: 1,
            lastmove: "pf9g9",
            board: playBoard([
                ["e8", [1, "B", undefined]],
                ["e9", [1, "P", undefined]],
                ["h8", [1, "B", undefined]],
                ["h9", [1, "P", undefined]],
            ]),
        }),
        moveState({
            currplayer: 2,
            lastmove: `-${REALM_E8}; p1e9`,
            board: playBoard([
                ["e8", [1, "B", undefined]],
                ["e9", [1, "P", undefined]],
                ["h8", [1, "B", undefined]],
                ["h9", [1, "P", undefined]],
            ]),
        }),
        moveState({
            currplayer: 1,
            lastmove: "pf9g9",
            board: playBoard([
                ["e8", [1, "B", undefined]],
                ["e9", [1, "P", undefined]],
                ["h8", [1, "B", undefined]],
                ["h9", [1, "P", undefined]],
            ]),
        }),
    ];
    return realmFromStack(stack);
}

describe("Realm rearrange three-turn limit", () => {
    it("rearrangeRealmFromMove extracts realm from stored lastmove", () => {
        expect(RealmGame.rearrangeRealmFromMove("- e8; p1e9")).to.equal(REALM_E8);
        expect(RealmGame.rearrangeRealmFromMove("pe9f9")).to.be.undefined;
    });

    it("allows a second consecutive rearrange of the same realm", () => {
        const g = realmFromStack([
            moveState({ currplayer: 1 }),
            moveState({ currplayer: 2, lastmove: `-${REALM_E8}; p1e9` }),
            moveState({ currplayer: 1, lastmove: "pf9g9" }),
        ]);
        const result = g.validateMove(`-${REALM_E8}`);
        expect(result.valid).to.be.true;
    });

    it("rejects a third consecutive rearrange of the same realm", () => {
        const g = p1ThirdRearrangeBlockedState();
        const result = g.validateMove(`-${REALM_E8}`);
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(
            i18next.t("apgames:validation.realm.REARRANGE_THREE", { realm: REALM_E8 }),
        );
    });

    it("resets the streak after a non-rearrangement turn by the same player", () => {
        const g = p1StreakResetState();
        const result = g.validateMove(`-${REALM_E8}`);
        expect(result.valid).to.be.true;
    });

    it("does not block rearranging a different realm", () => {
        const g = p1DifferentRealmState();
        const result = g.validateMove(`-${REALM_H8}`);
        expect(result.valid).to.be.true;
    });
});
