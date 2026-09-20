/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { AsliGame, type playerid, type IMoveState, type IAsliState } from "../../src/games/asli.js";
import { addResource } from "../../src";

type Setup = {
    board?: [string, playerid][];
    currplayer?: playerid;
    variants?: string[];
    prison?: [number, number];
    maxGroups?: [number, number];
    incursion?: boolean;
    komi?: number;
    plies?: number;
    lastmoves?: string[];
};

// Builds an in-progress game directly from a hand-made position.
// Defaults to the 9x9 board with preset komi, so there is no komi bid or pie ply
// to work around.
const buildGame = (setup: Setup): AsliGame => {
    const variants = setup.variants ?? ["board-9", "setkomi", "area"];
    const plies = setup.plies ?? 5;
    const stack: IMoveState[] = [];
    for (let i = 0; i < plies; i++) {
        const last = i === plies - 1;
        stack.push({
            _version: AsliGame.gameinfo.version,
            _results: [],
            _timestamp: new Date("2026-09-15T12:00:00.000Z"),
            currplayer: last ? (setup.currplayer ?? 1) : 1,
            lastmove: i === 0 ? undefined : (setup.lastmoves?.[i - 1] ?? "i9"),
            board: last ? new Map<string, playerid>(setup.board ?? []) : new Map<string, playerid>(),
            prison: last ? [...(setup.prison ?? [0, 0])] as [number, number] : [0, 0],
            maxGroups: last ? [...(setup.maxGroups ?? [1, 1])] as [number, number] : [0, 0],
            incursion: last ? (setup.incursion ?? false) : false,
            komi: last ? (setup.komi ?? 0) : 0,
        });
    }
    const state: IAsliState = {
        game: AsliGame.gameinfo.uid,
        numplayers: 2,
        variants,
        gameover: false,
        winner: [],
        stack,
    };
    return new AsliGame(state);
};

// p1 has two strings that see each other; joining them at b1 leaves p1 with a
// single string, which (having once had two) is stranded and cleared.
const suicideSetup = (variants?: string[]): Setup => ({
    variants,
    board: [["a1", 1], ["c1", 1], ["e5", 2]],
    currplayer: 1,
    maxGroups: [2, 1],
});

// The single empty cell a8 is enclosed entirely by p2 stones, so playing there
// is an incursion. It strands exactly one p2 string ({a9}), so it is minimal.
const minimalIncursionSetup = (extra?: Partial<Setup>): Setup => ({
    board: [["a9", 2], ["a7", 2], ["b8", 2], ["b9", 1]],
    currplayer: 1,
    maxGroups: [1, 3],
    ...extra,
});

describe("Asli", () => {
    before(() => {
        addResource("en");
    });

    describe("area scoring variant", () => {
        it("allows suicide and clears the mover's own stranded strings", () => {
            const g = buildGame(suicideSetup());
            const result = g.validateMove("b1");
            expect(result.valid).to.be.true;
            expect(result.complete).to.equal(1);
            g.move("b1");
            expect([...g.board.keys()].sort()).to.deep.equal(["e5"]);
        });

        it("still rejects suicide in the base game", () => {
            const g = buildGame(suicideSetup(["board-9", "setkomi"]));
            const result = g.validateMove("b1");
            expect(result.valid).to.be.false;
        });

        it("tallies self-captured stones against the mover in the prison", () => {
            const g = buildGame({...suicideSetup(), prison: [0, 0]});
            g.move("b1");
            // a1, c1 and the newly placed b1
            expect(g.prison[0]).to.equal(3);
            expect(g.prison[1]).to.equal(0);
        });

        it("rejects a placement that leaves the board unchanged", () => {
            // a9 is cut off from the rest of the board for p1, and captures nothing,
            // so the stone would be cleared again immediately.
            const g = buildGame({
                board: [["a8", 2], ["b9", 2], ["e5", 1], ["g5", 1]],
                currplayer: 1,
                maxGroups: [2, 1],
            });
            const result = g.validateMove("a9");
            expect(result.valid).to.be.false;
            expect(g.validateMove("e4").valid).to.be.true;
        });

        it("allows a minimal incursion after an ordinary placement", () => {
            const g = buildGame(minimalIncursionSetup({incursion: false}));
            expect(g.validateMove("a8").valid).to.be.true;
            g.move("a8");
            expect(g.board.has("a9")).to.be.false;
            expect(g.board.get("a8")).to.equal(1);
            expect(g.incursion).to.be.true;
        });

        it("rejects a minimal incursion immediately after the opponent passes", () => {
            const before = buildGame(minimalIncursionSetup({currplayer: 2}));
            before.move("pass");
            expect(before.incursion).to.be.true;
            const g = buildGame(minimalIncursionSetup({incursion: true}));
            expect(g.validateMove("a8").valid).to.be.false;
        });

        it("always allows passing, without spending a prisoner", () => {
            const g = buildGame({board: [["e5", 1]], currplayer: 1, prison: [0, 0]});
            expect(g.validateMove("pass").valid).to.be.true;
            expect(g.getButtons().map(b => b.move)).to.deep.equal(["pass"]);
            g.move("pass");
            expect(g.prison).to.deep.equal([0, 0]);
        });

        it("ends on two consecutive passes but not on one", () => {
            const g = buildGame({board: [["e5", 1], ["g5", 2]], currplayer: 1});
            g.move("pass");
            expect(g.gameover).to.be.false;
            g.move("pass");
            expect(g.gameover).to.be.true;
        });

        it("does not count the ply-2 pie pass toward end of game", () => {
            const g = new AsliGame(undefined, ["board-9", "area"]);
            g.move("7");          // komi bid
            g.move("pass");       // decline the pie
            expect(g.gameover).to.be.false;
            g.move("pass");       // first real pass
            expect(g.gameover).to.be.false;
            g.move("pass");       // second real pass
            expect(g.gameover).to.be.true;
        });

        it("scores stones plus territory plus komi, ignoring the prison", () => {
            // a9 is the only owned territory (enclosed by a8 and b9); the rest of the
            // board touches both colours and so belongs to nobody.
            const setup: Setup = {
                board: [["a8", 1], ["b9", 1], ["i1", 2]],
                currplayer: 1,
                maxGroups: [2, 1],
                prison: [5, 0],
            };
            expect(buildGame({...setup, komi: 7}).areaScores()).to.deep.equal([3, 8]);
            expect(buildGame({...setup, komi: 0}).areaScores()).to.deep.equal([3, 1]);
            // negative komi counts in favour of player 1
            expect(buildGame({...setup, komi: -4}).areaScores()).to.deep.equal([7, 1]);
            const scores = buildGame({...setup, komi: 7}).sidebarScores()[0].scores;
            expect(scores).to.deep.equal([3, 8]);
        });

        it("nets komi and captures from both sides in the prison display", () => {
            const g = buildGame({...suicideSetup(), prison: [7, 0]});
            g.move("b1");
            // 7 komi against p1, plus the 3 stones p1 lost to its own suicide
            expect(g.prison).to.deep.equal([10, 0]);
            const g2 = buildGame({...suicideSetup(), prison: [0, 4]});
            g2.move("b1");
            // 4 already standing against p2, less the 3 p1 just lost
            expect(g2.prison).to.deep.equal([0, 1]);
        });

        it("declares a draw when the final scores are equal", () => {
            const g = buildGame({
                board: [["a8", 1], ["b9", 1], ["i1", 2]],
                currplayer: 1,
                maxGroups: [2, 1],
                komi: 2,
            });
            expect(g.areaScores()).to.deep.equal([3, 3]);
            g.move("pass");
            g.move("pass");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1, 2]);
        });

        it("rejects a half-integer komi bid", () => {
            const g = new AsliGame(undefined, ["board-9", "area"]);
            expect(g.validateMove("3.5").valid).to.be.false;
            expect(g.validateMove("-3.5").valid).to.be.false;
            expect(g.validateMove("3").valid).to.be.true;
        });

        it("leaves komi out of the capture tally", () => {
            const preset = new AsliGame(undefined, ["board-9", "area", "setkomi"]);
            expect(preset.komi).to.equal(7);
            expect(preset.prison).to.deep.equal([7, 0]);
            // komi is scored directly, so it is not shown as captures
            expect(preset.capturesTally()).to.deep.equal([0, 0]);
            expect(preset.getPrisonColour(false)).to.equal("_context_background");

            // the base game still shows the whole prison, komi included
            const stones = new AsliGame(undefined, ["board-9", "setkomi"]);
            expect(stones.capturesTally()).to.deep.equal([7, 0]);
            expect(stones.getPrisonColour(false)).to.equal(1);
        });

        it("nets captures against komi in the tally", () => {
            const g = buildGame({
                variants: ["board-9", "setkomi", "area"],
                prison: [10, 0],
                komi: 7,
            });
            expect(g.capturesTally()).to.deep.equal([3, 0]);
            expect(g.getPrisonColour(false)).to.equal(1);
        });

        it("picks the capture colour correctly before and after the pie swap", () => {
            // pie declined: seats stay put
            const kept = new AsliGame(undefined, ["board-9", "area"]);
            kept.move("7");
            kept.move("pass");
            expect(kept.komi).to.equal(7);
            expect(kept.prison).to.deep.equal([7, 0]);
            expect(kept.capturesTally()).to.deep.equal([0, 0]);

            // pie taken: seats swap, and komi swaps with them
            const swapped = new AsliGame(undefined, ["board-9", "area"]);
            swapped.move("7");
            swapped.move("e5");
            expect(swapped.komi).to.equal(-7);
            expect(swapped.prison).to.deep.equal([0, 7]);
            expect(swapped.capturesTally()).to.deep.equal([0, 0]);
            expect(swapped.getPlayerColour(1)).to.equal(2);

            // captures by each side move the tally to the other colour
            const captures = (prison: [number, number]) => buildGame({
                variants: ["board-9", "area"],
                prison,
                lastmoves: ["7", "pass", "e5", "e7"],
            }).getPrisonColour(false);
            expect(captures([0, 3])).to.equal(2);
            expect(captures([3, 0])).to.equal(1);
            expect(captures([0, 0])).to.equal("_context_background");
        });

        it("does not swap the capture colour on ply 2 of a setkomi game", () => {
            // setkomi games have no pie ply, so ply 2 never swaps seats
            const colour = (variants: string[], prison: [number, number], ply2: string) => buildGame({
                variants,
                prison,
                komi: 7,
                lastmoves: ["e5", ply2, "e6", "e7"],
            }).getPrisonColour(false);

            for (const ply2 of ["d4", "pass"]) {
                expect(colour(["board-9", "setkomi"], [7, 0], ply2)).to.equal(1);
                expect(colour(["board-9", "setkomi"], [0, 7], ply2)).to.equal(2);
                expect(colour(["board-9", "setkomi", "area"], [10, 0], ply2)).to.equal(1);
            }
        });

        it("logs a plain pass, with no mention of the prison", () => {
            const g = buildGame({board: [["e5", 1]], currplayer: 1});
            g.move("pass");
            const log = g.chatLog(["Alice", "Bob"]).flat();
            expect(log.some(l => l.includes("Alice passed their turn."))).to.be.true;
            expect(log.some(l => l.toLowerCase().includes("prison"))).to.be.false;
        });

        it("still mentions the prison when passing in the base game", () => {
            const g = buildGame({
                variants: ["board-9", "setkomi"],
                board: [["e5", 1]],
                currplayer: 1,
                prison: [0, 3],
            });
            g.move("pass");
            const log = g.chatLog(["Alice", "Bob"]).flat();
            expect(log.some(l => l.includes("from the prison"))).to.be.true;
        });

        it("blames the pass, not a previous incursion, for a blocked incursion", () => {
            const afterPass = buildGame(minimalIncursionSetup({currplayer: 2}));
            afterPass.move("pass");
            const blockedByPass = afterPass.validateMove("a8");
            expect(blockedByPass.valid).to.be.false;
            expect(blockedByPass.message).to.include("after your opponent passes");

            // a block caused by the opponent's own incursion keeps the original wording
            const blockedByIncursion = buildGame(minimalIncursionSetup({incursion: true})).validateMove("a8");
            expect(blockedByIncursion.valid).to.be.false;
            expect(blockedByIncursion.message).to.include("back-to-back");
        });

        it("describes komi in points rather than prisoners at the bid ply", () => {
            const area = new AsliGame(undefined, ["board-9", "area"]);
            expect(area.validateMove("").message).to.include("komi");
            expect(area.validateMove("").message.toLowerCase()).to.not.include("prison");
            expect(area.validateMove("3.5").message.toLowerCase()).to.not.include("prison");

            // the base game keeps its prison wording
            const stones = new AsliGame(undefined, ["board-9"]);
            expect(stones.validateMove("").message.toLowerCase()).to.include("prison");
            expect(stones.validateMove("3.5").message.toLowerCase()).to.include("prison");
        });

        it("combines with woven: no incursions are legal, and the game still ends", () => {
            const g = buildGame(minimalIncursionSetup({
                variants: ["board-9", "setkomi", "area", "woven"],
                plies: 6,
            }));
            expect(g.validateMove("a8").valid).to.be.false;
            g.move("pass");
            expect(g.gameover).to.be.false;
            g.move("pass");
            expect(g.gameover).to.be.true;
            // an ordinary placement outside enemy territory is still fine
            const g2 = buildGame(minimalIncursionSetup({
                variants: ["board-9", "setkomi", "area", "woven"],
                plies: 6,
            }));
            expect(g2.validateMove("e5").valid).to.be.true;
        });

        it("round-trips through serialization on a 9x9 board", () => {
            const g = new AsliGame(undefined, ["board-9", "area"]);
            g.move("7");
            g.move("pass");
            g.move("e5");
            g.move("e7");
            g.move("pass");
            const clone = g.clone();
            expect(clone.komi).to.equal(g.komi);
            expect(clone.prison).to.deep.equal(g.prison);
            expect(clone.incursion).to.equal(g.incursion);
            expect(clone.boardsize).to.equal(9);
            expect([...clone.board.entries()].sort()).to.deep.equal([...g.board.entries()].sort());
            expect(clone.areaScores()).to.deep.equal(g.areaScores());
        });

        it("defaults komi to 0 for states saved before the field existed", () => {
            const g = buildGame({board: [["e5", 1]], currplayer: 1});
            const raw = JSON.parse(g.serialize()) as IAsliState;
            for (const st of raw.stack) {
                delete st.komi;
            }
            const restored = new AsliGame(JSON.stringify(raw));
            expect(restored.komi).to.equal(0);
        });
    });

    describe("board-23 variant", () => {
        it("includes the 23x23 board size in the variant metadata", () => {
            expect(AsliGame.gameinfo.variants).to.deep.include({ uid: "board-23", group: "board" });
        });

        it("uses a 23x23 board when the board-23 variant is selected", () => {
            const game = new AsliGame(undefined, ["board-23"]);
            const rep = game.render();

            expect(game.boardsize).to.equal(23);
            expect(rep.board).to.include({ width: 23, height: 23 });
            expect(game.getGraph().graph.order).to.equal(23 * 23);
            expect(game.coords2algebraic(22, 0)).to.equal("w23");

            const restored = new AsliGame(game.serialize());
            expect(restored.variants).to.deep.equal(["board-23"]);
            expect(restored.boardsize).to.equal(23);
        });
    });
});
