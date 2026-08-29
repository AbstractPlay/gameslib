/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GuerrillaGame, IGuerrillaState, IMoveState, playerid } from "../../src/games/guerrilla";

type BoardCell = [string, playerid];

function guerrillaFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    insurgents?: number;
    variants?: string[];
    rolesSwapped?: boolean;
    g1insurgentScore?: number;
}): GuerrillaGame {
    const state: IGuerrillaState = {
        game: "guerrilla",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack: [{
            _version: GuerrillaGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board),
            insurgents: opts.insurgents ?? 66,
            rolesSwapped: opts.rolesSwapped,
            g1insurgentScore: opts.g1insurgentScore,
        } as IMoveState],
    };
    return new GuerrillaGame(state);
}

function checkEOG(g: GuerrillaGame): void {
    (g as unknown as {checkEOG: () => void}).checkEOG();
}

describe("Guerrilla", () => {
    it("defaults new games to match mode", () => {
        const g = new GuerrillaGame();
        expect(g.variants).to.deep.equal(["match"]);
        expect(g.isMatch()).to.be.true;
    });

    it("offers double placements on the opening turn", () => {
        const g = new GuerrillaGame(undefined, []);
        expect(g.moves().length).to.be.greaterThan(0);
        expect(g.moves()[0]).to.match(/^[^,]+\|[^,]+,[^,]+\|[^,]+$/);
    });

    it("places two insurgents and decrements the reserve", () => {
        const g = new GuerrillaGame(undefined, []);
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
        checkEOG(g);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("awards security a win when insurgents cannot place", () => {
        const g = guerrillaFrom({
            board: [
                ["f4", 2],
                ["d3|e4", 1],
            ],
            currplayer: 1,
            insurgents: 0,
        });
        expect(g.moves()).to.deep.equal([]);
        checkEOG(g);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });

    it("removes surrounded security forces after insurgent placements", () => {
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

    it("shows only the immediate next step during security partial moves", () => {
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

    it("renders the first insurgent during a partial placement", () => {
        const g = new GuerrillaGame(undefined, []);
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

    describe("legacy single-game (variants: [])", () => {
        it("is not match mode", () => {
            const g = guerrillaFrom({ board: [["f4", 2]], variants: [] });
            expect(g.isMatch()).to.be.false;
        });

        it("ends a single game when security is eliminated", () => {
            const g = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 64,
                variants: [],
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.rolesSwapped).to.be.false;
            expect(g.g1insurgentScore).to.equal(undefined);
        });

        it("ends a single game when insurgents are eliminated", () => {
            const g = guerrillaFrom({
                board: [["f4", 2]],
                currplayer: 2,
                variants: [],
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("ends a single game when insurgents cannot place", () => {
            const g = guerrillaFrom({
                board: [["f4", 2], ["d3|e4", 1]],
                currplayer: 1,
                insurgents: 0,
                variants: [],
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("does not reset for a second game", () => {
            const g = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 64,
                variants: [],
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.results.some(r => r.type === "reset")).to.be.false;
        });
    });

    describe("match variant", () => {
        it("resets for game 2 after game 1 ends", () => {
            const g = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 64,
                variants: ["match"],
            });
            checkEOG(g);
            expect(g.gameover).to.be.false;
            expect(g.rolesSwapped).to.be.true;
            expect(g.g1insurgentScore).to.equal(2);
            expect(g.currplayer).to.equal(2);
            expect(g.board.get("f4")).to.equal(2);
            expect(g.insurgents).to.equal(66);
            expect(g.results.map(r => r.type)).to.deep.equal(["winners", "reset"]);
        });

        it("announces the game 1 winner on the reset ply", () => {
            const g = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 64,
                variants: ["match"],
            });
            checkEOG(g);
            (g as unknown as {saveState: () => void}).saveState();
            const lines = g.chatLogEntries(["Alice", "Bob"]);
            expect(lines).to.have.length(1);
            expect(lines[0]!.lines).to.have.length(1);
            expect(lines[0]!.lines[0]!.textKey).to.equal("apresults:RESET.guerrilla");
            expect(lines[0]!.lines[0]!.textParams?.player).to.equal("Alice");
        });

        it("offers insurgent placements at the start of game 2", () => {
            const g = guerrillaFrom({
                board: [
                    ["f4", 2],
                    ["e3", 2], ["e5", 2],
                    ["d4", 2], ["d6", 2],
                    ["c5", 2],
                ],
                currplayer: 2,
                variants: ["match"],
                rolesSwapped: true,
            });
            expect(g.moves().length).to.be.greaterThan(0);
            expect(g.moves()[0]).to.match(/^[^,]+\|[^,]+,[^,]+\|[^,]+$/);
        });

        it("records 67 when security wins by eliminating insurgents in game 1", () => {
            const g = guerrillaFrom({
                board: [["f4", 2]],
                currplayer: 2,
                variants: ["match"],
            });
            checkEOG(g);
            expect(g.g1insurgentScore).to.equal(67);
            expect(g.gameover).to.be.false;
            expect(g.rolesSwapped).to.be.true;
        });

        it("records 67 when security wins a game", () => {
            const g = guerrillaFrom({
                board: [
                    ["f4", 2],
                    ["d3|e4", 1],
                ],
                currplayer: 1,
                insurgents: 0,
                variants: ["match"],
            });
            checkEOG(g);
            expect(g.g1insurgentScore).to.equal(67);
            expect(g.gameover).to.be.false;
        });

        it("awards the match to P1 on insurgent win plus security sweep (I+S)", () => {
            const g = guerrillaFrom({
                board: [
                    ["f4", 2],
                    ["d3|e4", 1],
                ],
                currplayer: 2,
                insurgents: 0,
                variants: ["match"],
                rolesSwapped: true,
                g1insurgentScore: 25,
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });

        it("awards the match to P2 on security sweep plus insurgent win (S+I)", () => {
            const g = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 50,
                variants: ["match"],
                rolesSwapped: true,
                g1insurgentScore: 67,
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("draws when both players only win as security (S+S)", () => {
            const g = guerrillaFrom({
                board: [
                    ["f4", 2],
                    ["d3|e4", 1],
                ],
                currplayer: 2,
                insurgents: 0,
                variants: ["match"],
                rolesSwapped: true,
                g1insurgentScore: 67,
            });
            checkEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1, 2]);
        });

        it("compares insurgent scores when both win as insurgents (I+I)", () => {
            const p1Wins = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 36,
                variants: ["match"],
                rolesSwapped: true,
                g1insurgentScore: 25,
            });
            checkEOG(p1Wins);
            expect(p1Wins.winner).to.deep.equal([1]);

            const p2Wins = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 50,
                variants: ["match"],
                rolesSwapped: true,
                g1insurgentScore: 30,
            });
            checkEOG(p2Wins);
            expect(p2Wins.winner).to.deep.equal([2]);

            const tie = guerrillaFrom({
                board: [["d3|e4", 1]],
                currplayer: 2,
                insurgents: 41,
                variants: ["match"],
                rolesSwapped: true,
                g1insurgentScore: 25,
            });
            checkEOG(tie);
            expect(tie.winner).to.deep.equal([1, 2]);
        });

        it("renders swapped role colours in game 2", () => {
            const g = guerrillaFrom({
                board: [["f4", 2]],
                variants: ["match"],
                rolesSwapped: true,
            });
            const rep = g.render();
            const insurgentGlyph = rep.legend.A;
            const securityGlyph = rep.legend.B;
            const insurgentColour = Array.isArray(insurgentGlyph) ? insurgentGlyph[0].colour : insurgentGlyph.colour;
            const securityColour = Array.isArray(securityGlyph) ? securityGlyph[0].colour : securityGlyph.colour;
            expect(insurgentColour).to.equal(2);
            expect(securityColour).to.equal(1);
        });
    });
});
