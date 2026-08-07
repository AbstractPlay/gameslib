/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GuerrillaGame, IGuerrillaState, IMoveState, playerid } from "../../src/games/guerrilla";

type BoardCell = [string, playerid];

function guerrillaFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    insurgents?: number;
}): GuerrillaGame {
    const state: IGuerrillaState = {
        game: "guerrilla",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: [{
            _version: GuerrillaGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board),
            insurgents: opts.insurgents ?? 66,
        } as IMoveState],
    };
    return new GuerrillaGame(state);
}

describe("Guerrilla", () => {
    it("offers double placements on the opening turn", () => {
        const g = new GuerrillaGame();
        expect(g.moves().length).to.be.greaterThan(0);
        expect(g.moves()[0]).to.match(/^[^,]+\|[^,]+,[^,]+\|[^,]+$/);
    });

    it("places two insurgents and decrements the reserve", () => {
        const g = new GuerrillaGame();
        const mv = g.moves()[0]!;
        g.move(mv, {trusted: true});
        const [first, second] = mv.split(",");
        expect(g.board.get(first)).to.equal(1);
        expect(g.board.get(second)).to.equal(1);
        expect(g.insurgents).to.equal(64);
        expect(g.currplayer).to.equal(2);
    });

    it("captures an insurgent on a diagonal move", () => {
        const g = guerrillaFrom({
            board: [
                ["f4", 2],
                ["e3", 2],
                ["e3|f2", 1],
            ],
            currplayer: 2,
        });
        g.move("e3xf2", {trusted: true});
        expect(g.board.has("e3|f2")).to.be.false;
        expect(g.board.get("f2")).to.equal(2);
        expect(g.board.has("e3")).to.be.false;
    });

    it("requires continuing capture chains", () => {
        const g = guerrillaFrom({
            board: [
                ["e5", 2],
                ["e6|f5", 1],
                ["f7|g6", 1],
            ],
            currplayer: 2,
        });
        expect(g.moves().filter(m => m.includes("x"))).to.deep.equal(["e5xf6xg7"]);
    });

    it("ends when the security force is eliminated", () => {
        const g = guerrillaFrom({
            board: [["d3|e4", 1]],
            currplayer: 2,
            insurgents: 64,
        });
        (g as unknown as {checkEOG: () => void}).checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("awards P2 a win when P1 cannot place", () => {
        const g = guerrillaFrom({
            board: [
                ["f4", 2],
                ["d3|e4", 1],
            ],
            currplayer: 1,
            insurgents: 0,
        });
        expect(g.moves()).to.deep.equal([]);
        (g as unknown as {checkEOG: () => void}).checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });

    it("removes surrounded security forces after P1 placements", () => {
        const g = guerrillaFrom({
            board: [
                ["f4", 2],
                ["e5|f4", 1],
                ["f5|g4", 1],
                ["e4|f3", 1],
            ],
            currplayer: 1,
        });
        const mv = g.moves().find(m => m.split(",").includes("f4|g3"));
        expect(mv).to.not.equal(undefined);
        g.move(mv!, {trusted: true});
        expect(g.board.has("f4")).to.be.false;
        expect(g.results.some(r => r.type === "capture" && r.where === "f4")).to.be.true;
    });

    it("shows only the immediate next step during P2 partial moves", () => {
        const g = guerrillaFrom({
            board: [
                ["e5", 2],
                ["e6|f5", 1],
                ["f7|g6", 1],
            ],
            currplayer: 2,
        });
        const findPoints = (g as unknown as {findPoints: (m: string) => string[]}).findPoints.bind(g);
        expect(findPoints("e5")).to.include("f6");
        expect(findPoints("e5")).to.not.include("g7");
        expect(findPoints("e5xf6")).to.deep.equal(["g7"]);
    });

    it("renders the first insurgent during a partial P1 placement", () => {
        const g = new GuerrillaGame();
        const first = g.moves()[0]!.split(",")[0]!;
        g.move(first, {partial: true});
        const rep = g.render();
        expect((g as unknown as {partialPlacement?: string}).partialPlacement).to.equal(first);
        expect(rep.pieces).to.include("A");
        expect((g as unknown as {dots: string[]}).dots.length).to.be.greaterThan(0);
    });

    it("removes corner security forces enclosed by insurgents and the board edge", () => {
        const g = guerrillaFrom({
            board: [
                ["a8", 2],
            ],
            currplayer: 1,
        });
        const mv = g.moves().find(m => m.split(",").includes("a8|b7"));
        expect(mv).to.not.equal(undefined);
        g.move(mv!, {trusted: true});
        expect(g.board.has("a8")).to.be.false;
    });
});
