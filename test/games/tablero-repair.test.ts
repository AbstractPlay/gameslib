/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { TableroGame, type IMoveState, type ITableroState, type playerid } from "../../src/games/tablero.js";
import {
    isLegacyDuplicatePassFrame,
    isRedundantForcedPassFrame,
    repairTableroStack,
    repairTableroStackJson,
    verifyTableroStackIntegrity,
} from "../../src/games/tablero-repair.js";
import type { APMoveResult } from "../../src/schemas/moveresults.js";

function moveState(overrides: Partial<IMoveState> = {}): IMoveState {
    return {
        _version: TableroGame.gameinfo.version,
        _results: [],
        _timestamp: new Date(),
        currplayer: 1,
        board: new Map(),
        pieces: [12, 12],
        roll: [3, 4],
        ...overrides,
    };
}

function tableroState(stack: IMoveState[], overrides: Partial<ITableroState> = {}): ITableroState {
    return {
        game: "tablero",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack,
        ...overrides,
    };
}

describe("Tablero stack repair", () => {
    it("isLegacyDuplicatePassFrame detects duplicate pass rows", () => {
        const dupResults: APMoveResult[] = [
            {type: "take", from: "c3"},
            {type: "roll", values: [5, 6]},
        ];
        const stack = [
            moveState(),
            moveState({lastmove: "-c3", _results: dupResults}),
            moveState({lastmove: "pass", _results: dupResults}),
        ];
        expect(isLegacyDuplicatePassFrame(stack, 1)).to.be.false;
        expect(isLegacyDuplicatePassFrame(stack, 2)).to.be.true;
    });

    it("isRedundantForcedPassFrame detects pass row after take already replayed by engine", () => {
        const takeResults: APMoveResult[] = [
            {type: "take", from: "c3"},
            {type: "roll", values: [5, 6]},
        ];
        const stack = [
            moveState(),
            moveState({lastmove: "-c3", _results: takeResults, currplayer: 1}),
            moveState({lastmove: "pass", _results: [{type: "pass"}], currplayer: 2}),
        ];
        expect(isRedundantForcedPassFrame(stack, 2)).to.be.true;
        expect(isRedundantForcedPassFrame(stack, 1)).to.be.false;
    });

    it("verifyTableroStackIntegrity passes a clean post-Phase-1 take stack", () => {
        const g = new TableroGame(undefined, []);
        g.stack[0]!.board = new Map([["a3", [2]]]);
        g.currplayer = 2;
        g.roll = [6, 6];
        g.pieces = [12, 12];
        g.load(0);
        g.move("-a3", {trusted: true});
        const verify = verifyTableroStackIntegrity(g.state());
        expect(verify.ok).to.be.true;
    });

    it("repair merges legacy duplicate pass stack rows and fixes shared-array corruption", () => {
        const openingC3: playerid[] = [2, 2];
        const shared: playerid[] = [2, 2];
        const dupResults: APMoveResult[] = [
            {type: "take", from: "c3"},
            {type: "roll", values: [5, 6]},
        ];
        const stack: IMoveState[] = [
            moveState({currplayer: 2, roll: [5, 5], board: new Map([["c3", openingC3]])}),
            moveState({
                currplayer: 2,
                roll: [5, 6],
                lastmove: "-c3",
                _results: dupResults,
                board: new Map([["c3", shared]]),
                pieces: [12, 13],
            }),
            moveState({
                currplayer: 2,
                roll: [5, 6],
                lastmove: "pass",
                _results: dupResults,
                board: new Map([["c3", shared]]),
                pieces: [12, 13],
            }),
        ];
        shared.pop();
        expect(openingC3).to.deep.equal([2, 2]);
        expect(stack[1]!.board.get("c3")).to.deep.equal([2]);

        const before = verifyTableroStackIntegrity(tableroState(stack));
        expect(before.ok).to.be.false;

        const {state: repaired, repaired: didRepair} = repairTableroStack(tableroState(stack));
        expect(didRepair).to.be.true;
        expect(repaired.stack).to.have.length(3);
        expect(repaired.stack[0]!.board.get("c3")).to.deep.equal([2, 2]);
        expect(repaired.stack[1]!.board.get("c3")).to.deep.equal([2]);
        expect(repaired.stack[1]!._results!.map((r) => r.type)).to.deep.equal(["take", "roll"]);
        expect(repaired.stack[1]!.currplayer).to.equal(1);
        expect(repaired.stack[2]!.lastmove).to.equal("pass");
        expect(repaired.stack[2]!._results!.map((r) => r.type)).to.deep.equal(["pass"]);
        expect(repaired.stack[2]!.currplayer).to.equal(2);

        expect(verifyTableroStackIntegrity(repaired).ok).to.be.true;
    });

    it("repair normalizes stack when only tip currplayer differed before repair", () => {
        const g = new TableroGame(undefined, []);
        g.stack[0]!.board = new Map([["a3", [2]]]);
        g.stack[0]!.currplayer = 2;
        g.currplayer = 2;
        g.roll = [6, 6];
        g.pieces = [12, 12];
        g.load(0);
        g.move("-a3", {trusted: true});
        expect(g.stack[g.stack.length - 1]!.currplayer).to.equal(2);
        g.stack[g.stack.length - 1]!.currplayer = 1;
        const {state: repaired, repaired: didRepair} = repairTableroStack(g.state());
        expect(didRepair).to.be.true;
        expect(repaired.stack[repaired.stack.length - 1]!.currplayer).to.equal(2);
    });

    it("repair replaces corrupt playable tip when replay self-verifies", () => {
        const g = new TableroGame(undefined, []);
        g.stack[0]!.board = new Map([["a3", [2]]]);
        g.currplayer = 2;
        g.roll = [6, 6];
        g.pieces = [12, 12];
        g.load(0);
        g.move("-a3", {trusted: true});
        g.stack[g.stack.length - 1]!.pieces = [99, 99];
        const {state: repaired, repaired: didRepair, reason} = repairTableroStack(g.state());
        expect(didRepair, reason).to.be.true;
        expect(repaired.stack[repaired.stack.length - 1]!.pieces).to.deep.equal([13, 12]);
        expect(verifyTableroStackIntegrity(repaired).ok).to.be.true;
    });

    it("verifyTableroStackIntegrity replays resign ending stacks", () => {
        const g = new TableroGame(undefined, []);
        g.stack[0]!.board = new Map([["b2", [1, 1]]]);
        g.currplayer = 1;
        g.roll = [2, 3];
        g.pieces = [10, 11];
        g.load(0);
        g.move("+b2", {trusted: true});
        g.resign(2);
        const verify = verifyTableroStackIntegrity(g.state());
        expect(verify.ok, verify.reason).to.be.true;
    });

    it("verifyTableroStackIntegrity normalizes legacy plain-object stack boards", () => {
        const g = new TableroGame(undefined, []);
        g.stack[0]!.board = new Map([["a3", [2]]]);
        g.currplayer = 2;
        g.roll = [6, 6];
        g.pieces = [12, 12];
        g.load(0);
        g.move("-a3", {trusted: true});
        const withPlainBoards = g.state();
        for (const frame of withPlainBoards.stack) {
            frame.board = Object.fromEntries(frame.board) as unknown as Map<string, playerid[]>;
        }
        const verify = verifyTableroStackIntegrity(withPlainBoards);
        expect(verify.ok, verify.reason).to.be.true;
    });

    it("repairTableroStackJson round-trips repaired state", () => {
        const openingC3: playerid[] = [2, 2];
        const shared: playerid[] = [2, 2];
        const dupResults: APMoveResult[] = [
            {type: "take", from: "c3"},
            {type: "roll", values: [5, 6]},
        ];
        const stack: IMoveState[] = [
            moveState({currplayer: 2, roll: [5, 5], board: new Map([["c3", openingC3]])}),
            moveState({
                currplayer: 2,
                roll: [5, 6],
                lastmove: "-c3",
                _results: dupResults,
                board: new Map([["c3", shared]]),
                pieces: [12, 13],
            }),
            moveState({
                currplayer: 2,
                roll: [5, 6],
                lastmove: "pass",
                _results: dupResults,
                board: new Map([["c3", shared]]),
                pieces: [12, 13],
            }),
        ];
        shared.pop();
        const broken = tableroState(stack);
        const raw = new TableroGame(broken).serialize();
        const {stateJson, repaired, reason} = repairTableroStackJson(raw);
        expect(repaired, reason).to.be.true;
        const again = new TableroGame(stateJson);
        expect(verifyTableroStackIntegrity(again.state()).ok).to.be.true;
        expect(again.stack[0]!.board.get("c3")).to.deep.equal([2, 2]);
        expect(again.stack).to.have.length(3);
    });
});
