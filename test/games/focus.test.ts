/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { FocusGame, IFocusState, IMoveState, playerid } from "../../src/games/focus";

type BoardCell = [string, playerid[]];

function focusFrom(opts: {
    board?: BoardCell[];
    currplayer?: playerid;
    inhand?: [number, number];
    captures?: [number, number];
    variants?: string[];
}): FocusGame {
    const state: IFocusState = {
        game: "focus",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack: [{
            _version: FocusGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board ?? []),
            inhand: opts.inhand ?? [0, 0],
            captures: opts.captures ?? [0, 0],
        } as IMoveState],
    };
    return new FocusGame(state);
}

describe("Focus", () => {
    it("getControlled counts stacks topped by each player", () => {
        const g = focusFrom({
            board: [
                ["c3", [1]],
                ["d3", [2, 1]],
                ["e3", [2]],
            ],
        });
        expect(g.getControlled(1)).to.equal(2);
        expect(g.getControlled(2)).to.equal(1);
    });

    it("increments captures when overflow removes enemy pieces", () => {
        const g = focusFrom({
            board: [
                ["c3", [1]],
                ["d3", [2, 2, 2, 2, 2]],
            ],
            currplayer: 1,
        });
        g.move("c3-d3", { trusted: true });
        expect(g.captures).to.deep.equal([1, 0]);
    });

    it("ends on capture target when a mover reaches the threshold", () => {
        const g = focusFrom({
            variants: ["captures-6"],
            captures: [5, 0],
            board: [
                ["c3", [1]],
                ["d3", [2, 2, 2, 2, 2]],
            ],
            currplayer: 1,
        });
        const after = g.move("c3-d3", { trusted: true });
        expect(after.gameover).to.be.true;
        expect(after.winner).to.deep.equal([1]);
        expect(after.captures[0]).to.equal(6);
    });

    it("ends hegemony when one player controls no stacks", () => {
        const g = focusFrom({
            variants: ["hegemony"],
            board: [
                ["c3", [1]],
                ["d4", [1]],
            ],
            currplayer: 1,
        });
        const after = g.move("c3-c4", { trusted: true });
        expect(after.gameover).to.be.true;
        expect(after.winner).to.deep.equal([1]);
        expect(after.getControlled(2)).to.equal(0);
    });

    it("default goal awards immobilize win when the next player has no moves", () => {
        const g = focusFrom({
            board: [["c3", [1]]],
            currplayer: 1,
            inhand: [0, 0],
        });
        const after = g.move("c3-d3", { trusted: true });
        expect(after.gameover).to.be.true;
        expect(after.winner).to.deep.equal([1]);
    });

    it("sidebarScores omits Captures unless a capture-target variant is active", () => {
        const defaultRows = new FocusGame().sidebarScores();
        expect(defaultRows.length).to.equal(2);

        const captureRows = focusFrom({ variants: ["captures-6"] }).sidebarScores();
        expect(captureRows.length).to.equal(3);
        expect(captureRows[1]!.scores).to.deep.equal([0, 0]);
    });
});
