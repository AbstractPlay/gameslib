import "mocha";
import { expect } from "chai";
import { LinageGame, type ILinageState, type playerid } from "../../src/games/linage.js";

/** Three-cell vertical strip c4–c6 on 11×11; vertical-only owned region (3 points). */
function swappedFirstVerticalStripState(archiveVersion: string): ILinageState {
    const board = new Map<string, playerid>();
    const surround: string[] = [
        "b4", "b5", "b6",
        "d4", "d5", "d6",
        "c3", "c7",
    ];
    for (const cell of surround) {
        board.set(cell, 1);
    }
    const moveState = {
        _version: archiveVersion,
        _results: [] as const,
        _timestamp: new Date(0),
        currplayer: 1 as playerid,
        board,
        swapped: true,
        komi: 0,
        lastmove: "k6",
    };
    return {
        game: "linage",
        numplayers: 2,
        variants: ["size-11"],
        gameover: false,
        winner: [],
        stack: [moveState],
    };
}

describe("Linage", () => {
    describe("vertical-first scoring (pie placement by seat 2)", () => {
        it("attributes vertical-only territory to seat 2 when archive version is current", () => {
            const g = new LinageGame(
                swappedFirstVerticalStripState(LinageGame.gameinfo.version),
            );
            expect(g.getPlayerScore(2)).to.equal(3);
            expect(g.getPlayerScore(1)).to.equal(0);
            const scores = g.sidebarScores()[0]!.scores!;
            expect(scores[0]).to.include("Horizontal");
            expect(scores[1]).to.include("Vertical");
        });

        it("keeps legacy seat mapping when stack[0] predates the fix", () => {
            const g = new LinageGame(swappedFirstVerticalStripState("20260601"));
            expect(g.getPlayerScore(1)).to.equal(3);
            expect(g.getPlayerScore(2)).to.equal(0);
            const scores = g.sidebarScores()[0]!.scores!;
            expect(scores[0]).to.include("Vertical");
            expect(scores[1]).to.include("Horizontal");
        });
    });

    describe("button at end of game", () => {
        it("awards the button to the non-passer after consecutive passes when archive is current", () => {
            const g = new LinageGame(undefined, ["size-11"]);
            g.move("0");
            g.move("play-second");
            g.move("pass");
            g.move("pass");
            expect(g.gameover).to.equal(true);
            expect(g.buttontaker).to.equal(1);
            expect(g.getPlayerScore(1)).to.equal(0.5);
            expect(g.getPlayerScore(2)).to.equal(0);
            expect(g.winner).to.deep.equal([1]);
        });

        it("does not auto-award the button when stack[0] predates 20261020", () => {
            const g = new LinageGame(undefined, ["size-11"]);
            g.move("0");
            g.move("play-second");
            g.stack[0]!._version = "20260601";
            g.move("pass");
            g.move("pass");
            expect(g.gameover).to.equal(true);
            expect(g.buttontaker).to.equal(undefined);
            expect(g.getPlayerScore(1)).to.equal(0);
            expect(g.getPlayerScore(2)).to.equal(0);
            expect(g.winner).to.deep.equal([1, 2]);
        });
    });
});
