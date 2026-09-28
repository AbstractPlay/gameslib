/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { AgofmarsGame } from "../../src/games/agofmars.js";
import {
    buildDrawPoolFromBoard,
    removeFromMultiset,
    startingMultiset,
} from "../../src/games/agofmars/bag.js";
import { scoreGame } from "../../src/games/agofmars/scoring.js";
import {
    freshPlayState,
    gameFrom,
    koUndoBlockedState,
    defaultObjectives,
    SETUP_MOVE_P1,
    SETUP_MOVE_P2,
} from "../fixtures/agofmars.js";

function finishSetup(g: AgofmarsGame, p1 = SETUP_MOVE_P1, p2 = SETUP_MOVE_P2): AgofmarsGame {
    return g.move(p1).move(p2);
}

describe("Agents of M.A.R.S.", () => {
    before(() => {
        addResource("en");
    });

    describe("setup", () => {
        it("returns setup instructions for an empty validateMove", () => {
            const g = new AgofmarsGame();
            const v = g.validateMove("");
            expect(v.valid).to.be.true;
            expect(v.complete).to.equal(-1);
            expect(v.message).to.include("Player 1 setup");
        });

        it("requires a valid permutation before play", () => {
            const g = new AgofmarsGame();
            expect(g.phase).to.equal("setup-1");
            expect(() => g.move("RD0,RD1")).to.throw();
        });

        it("persists pyramid selection in the move field across playground clicks", () => {
            const g = new AgofmarsGame();
            const picked = g.handleClick("", -1, -1, "RD2");
            expect(picked.move).to.equal("RD");
            const fresh = new AgofmarsGame(g.serialize());
            const placed = fresh.handleClick(picked.move, 0, 1);
            expect(placed.move).to.equal("RD1");
            expect(placed.complete).to.equal(0);
        });

        it("builds setup notation from pyramid and column clicks", () => {
            const g = new AgofmarsGame();
            let r = g.handleClick("", -1, -1, "RD2");
            expect(r.valid).to.be.true;
            expect(r.move).to.equal("RD");
            r = g.handleClick(r.move, 0, 2);
            expect(r.move).to.equal("RD0");
            expect(r.complete).to.equal(0);
            r = g.handleClick(r.move, -1, -1, "BU2");
            r = g.handleClick(r.move, 0, 1);
            r = g.handleClick(r.move, -1, -1, "GN2");
            r = g.handleClick(r.move, 0, 0);
            r = g.handleClick(r.move, -1, -1, "YE2");
            r = g.handleClick(r.move, 0, 3);
            expect(r.move).to.equal(SETUP_MOVE_P1);
            expect(r.complete).to.equal(1);
        });

        it("logs setup without revealing objective assignments", () => {
            const g = finishSetup(new AgofmarsGame());
            const lines = g.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            expect(lines.some(l => l.textKey === "apresults:OBJECTIVES.agofmars")).to.be.true;
            expect(lines.some(l => JSON.stringify(l).includes("RD0"))).to.be.false;
            const g2 = finishSetup(new AgofmarsGame());
            expect(g2.phase).to.equal("play");
            expect(g2.board.size).to.equal(0);
        });
    });

    describe("objective initiative", () => {
        it("skips setup with distinct permutations", () => {
            const g = new AgofmarsGame(undefined, ["objective-initiative"]);
            expect(g.phase).to.equal("play");
            expect(g.board.size).to.equal(0);
            const sig0 = g.objectives[0]!.join(",");
            const sig1 = g.objectives[1]!.join(",");
            expect(sig0).to.not.equal(sig1);
        });

        it("uses an 8×8 board with five-colour rules", () => {
            const g = new AgofmarsGame(undefined, ["five-colour-plus3", "objective-initiative"]);
            expect(g.boardWidth()).to.equal(8);
            expect(g.colourCount()).to.equal(5);
        });
    });

    describe("draw pool", () => {
        it("starts with 75 pyramids in the default four-colour set", () => {
            expect(startingMultiset([]).length).to.equal(75);
        });

        it("starts with 90 pyramids when a fifth chromatic stash is in play", () => {
            expect(startingMultiset(["five-colour-plus3"]).length).to.equal(90);
        });

        it("leaves 59 pyramids in the bag after default setup", () => {
            const objectives = defaultObjectives();
            const bag = buildDrawPoolFromBoard([], new Map(), objectives);
            expect(bag.length).to.equal(59);
        });

        it("removes coloured and black setup pyramids per seat", () => {
            const objectives = defaultObjectives();
            const pool = startingMultiset([]);
            const after = buildDrawPoolFromBoard([], new Map(), objectives);
            const count = (c: string, s: number) =>
                after.filter(([col, sz]) => col === c && sz === s).length;
            const startCount = (c: string, s: number) =>
                pool.filter(([col, sz]) => col === c && sz === s).length;
            expect(startCount("BK", 3) - count("BK", 3)).to.equal(4);
            expect(startCount("BK", 2) - count("BK", 2)).to.equal(4);
            expect(startCount("RD", 2) - count("RD", 2)).to.equal(1);
            expect(startCount("RD", 1) - count("RD", 1)).to.equal(1);
        });

        it("uses all large and medium black pyramids in five-colour setup", () => {
            const objectives = defaultObjectives(5);
            const after = buildDrawPoolFromBoard(["five-colour-plus3"], new Map(), objectives);
            const count = (c: string, s: number) =>
                after.filter(([col, sz]) => col === c && sz === s).length;
            expect(count("BK", 3)).to.equal(0);
            expect(count("BK", 2)).to.equal(0);
            expect(count("BK", 1)).to.equal(5);
            expect(after.length).to.equal(70);
        });

        it("leaves six pyramids in the bag when the five-colour board is full", () => {
            const objectives = defaultObjectives(5);
            let bag = buildDrawPoolFromBoard(["five-colour-plus3"], new Map(), objectives);
            expect(bag.length).to.equal(70);
            for (let i = 0; i < 64; i++) {
                const piece = bag[0]!;
                bag = removeFromMultiset(bag, piece);
            }
            expect(bag.length).to.equal(6);
        });

        it("subtracts objectives, board pieces, and pending draw", () => {
            const objectives = defaultObjectives();
            const board = new Map([["a1", ["RD", 1] as const]]);
            const start = startingMultiset([]);
            const withoutObj = buildDrawPoolFromBoard([], new Map(), objectives);
            expect(withoutObj.length).to.equal(start.length - 16);
            const withBoard = buildDrawPoolFromBoard([], board, objectives);
            expect(withBoard.length).to.equal(withoutObj.length - 1);
            const withPending = buildDrawPoolFromBoard([], board, objectives, ["BU", 2]);
            expect(withPending.length).to.equal(withBoard.length - 1);
        });
    });

    describe("results log", () => {
        it("reports declining and completing objective swaps by column", () => {
            const declined = finishSetup(new AgofmarsGame()).move("noObjSwap");
            const passLines = declined.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            expect(passLines.some(l => l.textKey === "apresults:PASS.agofmars_noObjSwap")).to.be.true;

            const swapped = finishSetup(new AgofmarsGame()).move("objSwap;2|-1");
            const swapLines = swapped.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            const swapLine = swapLines.find(l => l.textKey === "apresults:OBJECTIVE_SWAP.agofmars");
            expect(swapLine).to.not.equal(undefined);
            expect(swapLine!.textParams?.columnA).to.equal("2");
            expect(swapLine!.textParams?.columnB).to.match(/−1|-1/);
            expect(JSON.stringify(swapLine!.textParams)).to.not.match(/RD|YE|BU|GN/);
        });

        it("reports board moves and swaps with cell coordinates", () => {
            let g = finishSetup(new AgofmarsGame());
            g.board.set("a1", ["RD", 2]);
            g = g.move("noObjSwap").move("a1-a3");
            expect(g.lastmove).to.equal("RD@a1-a3");
            const moveLines = g.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            expect(moveLines.some(l => l.textKey === "apresults:MOVE.agofmars")).to.be.true;
            g.board.set("b1", ["BU", 2]);
            g = g.move("noObjSwap").move("b1|a3");
            expect(g.lastmove).to.equal("BU@b1|RD@a3");
            const swapLines = g.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            expect(swapLines.some(l => l.textKey === "apresults:SWAP.agofmars_board")).to.be.true;
        });
    });

    describe("turn commits", () => {
        it("gates objective then main action then optional place", () => {
            let g = finishSetup(new AgofmarsGame());
            expect(g.awaitingMainAction).to.be.false;
            g = g.move("noObjSwap");
            expect(g.awaitingMainAction).to.be.true;
            expect(g.currplayer).to.equal(1);
            g = g.move("draw");
            expect(g.pendingDraw).to.not.equal(undefined);
            expect(g.awaitingMainAction).to.be.false;
            const [drawnColour] = g.pendingDraw!;
            const place = g.move("a1");
            expect(place.lastmove).to.equal(AgofmarsGame.formatPlaceWire(drawnColour, "a1"));
            expect(place.getPlies().at(-1)?.move).to.equal(
                AgofmarsGame.formatPlaceWire(drawnColour, "a1"),
            );
            const logLines = place.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            expect(logLines.some(l => l.textKey === "apresults:PLACE.agofmars")).to.be.true;
            expect(place.pendingDraw).to.equal(undefined);
            expect(place.currplayer).to.equal(2);
            expect(place.stack.length).to.equal(6);
        });

        it("allows objective swap then move in two plies", () => {
            let g = finishSetup(new AgofmarsGame());
            g.board.set("a1", ["RD", 2]);
            g = g.move("obj1-3");
            expect(g.awaitingMainAction).to.be.true;
            g = g.move("a1-a3");
            expect(g.board.has("a3")).to.be.true;
            expect(g.currplayer).to.equal(2);
        });

        it("only swaps the acting player's objective row", () => {
            let g = finishSetup(new AgofmarsGame());
            const selfBefore = [...g.objectives[0]!];
            const oppBefore = [...g.objectives[1]!];
            g = g.move("objSwap;2|-1");
            const expected = [...selfBefore];
            expected[0] = selfBefore[3]!;
            expected[3] = selfBefore[0]!;
            expect(g.objectives[0]).to.deep.equal(expected);
            expect(g.objectives[1]).to.deep.equal(oppBefore);
            expect(g.objectivesRevealed[0]).to.deep.equal([true, false, false, true]);
            expect(g.objectivesRevealed[1]).to.deep.equal([false, false, false, false]);
        });

        it("rejects main action before noObjSwap", () => {
            const g = finishSetup(new AgofmarsGame());
            expect(g.validateMove("draw").valid).to.be.false;
        });

        it("arms objective swap from the objSwap button text", () => {
            const g = finishSetup(new AgofmarsGame());
            const v = g.validateMove("objSwap");
            expect(v.valid).to.be.true;
            expect(v.complete).to.equal(-1);
            expect(v.message).to.include("two objective columns");
        });

        it("builds obj swap wire from objective area piece clicks", () => {
            const g = finishSetup(new AgofmarsGame());
            const areaKey = (col: number) => `${g.objectives[0]![col]!}2`;
            const first = g.handleClick("objSwap", -1, -1, areaKey(0));
            expect(first.move).to.equal("objSwap;2|");
            expect(first.complete).to.equal(0);
            const second = g.handleClick(first.move, -1, -1, areaKey(2));
            expect(second.move).to.equal("objSwap;2|0");
            expect(second.complete).to.equal(1);
        });

        it("restores the first objective column from the move field on each click", () => {
            const committed = finishSetup(new AgofmarsGame()).serialize();
            const areaKey = (col: number) => {
                const g = new AgofmarsGame(committed);
                return `${g.objectives[0]![col]!}2`;
            };
            const first = new AgofmarsGame(committed).handleClick("objSwap", -1, -1, areaKey(0));
            expect(first.move).to.equal("objSwap;2|");
            const second = new AgofmarsGame(committed).handleClick(first.move, -1, -1, areaKey(2));
            expect(second.move).to.equal("objSwap;2|0");
            expect(second.complete).to.equal(1);
        });

        it("supports partial move() for objective-swap interim preview", () => {
            const g = finishSetup(new AgofmarsGame());
            expect(() => g.move("objSwap;2|", { partial: true })).to.not.throw();
            expect(() => g.move("objSwap", { partial: true })).to.not.throw();
        });

        it("rejects Move on an empty board with a clear message", () => {
            const g = finishSetup(new AgofmarsGame()).move("noObjSwap");
            const v = g.validateMove("move");
            expect(v.valid).to.be.false;
            expect(v.message).to.include("no pyramids");
        });

        it("does not commit move/swap tokens via move()", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["RD", 2]);
            g = g.move("noObjSwap");
            expect(() => g.move("move")).to.throw();
            const armed = g.handleClick("move", 7, 0);
            expect(armed.move).to.equal("move;a1");
            expect(armed.complete).to.equal(0);
            const committed = new AgofmarsGame(g.serialize()).handleClick(armed.move, 5, 0);
            expect(committed.complete).to.equal(1);
            expect(committed.move).to.equal("RD@a1-a3");
        });

        it("rejects moving a black pyramid with a clear message", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["BK", 2]);
            g.board.set("b1", ["RD", 2]);
            g = g.move("noObjSwap");
            const click = g.handleClick("move", 7, 0);
            expect(click.valid).to.be.false;
            expect(click.message).to.include("Black");
        });

        it("switches the selected pyramid when another is clicked during move", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["RD", 2]);
            g.board.set("b1", ["BU", 2]);
            g = g.move("noObjSwap");
            const first = g.handleClick("move", 7, 0);
            const second = new AgofmarsGame(g.serialize()).handleClick(first.move, 7, 1);
            expect(second.move).to.equal("move;b1");
            expect(second.valid).to.be.true;
        });
    });

    describe("movement and swap", () => {
        it("blocks black pyramids from moving", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["BK", 2]);
            g = g.move("noObjSwap");
            expect(g.validateMove("a1-a2").valid).to.be.false;
        });

        it("requires dissimilar pyramids for board swap", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["RD", 2]);
            g.board.set("a2", ["RD", 2]);
            g = g.move("noObjSwap");
            expect(g.validateMove("a1|a2").valid).to.be.false;
        });

        it("limits reach under step-move", () => {
            const raw = freshPlayState();
            raw.variants = ["step-move"];
            const state = gameFrom(raw);
            state.board.set("a1", ["RD", 2]);
            state.move("noObjSwap");
            expect(state.validateMove("a1-a4").valid).to.be.false;
            expect(state.validateMove("a1-a2").valid).to.be.true;
        });

        it("moves exactly the pip count in one cardinal direction", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["RD", 2]);
            g = g.move("noObjSwap");
            expect(g.validateMove("a1-a2").valid).to.be.false;
            expect(g.validateMove("a1-a3").valid).to.be.true;
            g.board.set("c1", ["RD", 3]);
            expect(g.validateMove("c1-c4").valid).to.be.true;
            expect(g.validateMove("c1-c3").valid).to.be.false;
        });
    });

    describe("ko", () => {
        it("rejects an immediate undo of the opponent board change", () => {
            const g = gameFrom(koUndoBlockedState());
            expect(g.validateMove("a2-a1").valid).to.be.false;
        });

        it("allows a different move that does not restore the prior board", () => {
            const g = gameFrom(koUndoBlockedState());
            expect(g.validateMove("c1-c3").valid).to.be.true;
        });
    });

    describe("objective swap gating", () => {
        it("disallows swap once four black pyramids are on the board", () => {
            let g = finishSetup(new AgofmarsGame());
            for (const cell of ["a1", "a2", "a3", "a4"]) {
                g.board.set(cell, ["BK", 1]);
            }
            expect(g.canObjectiveSwap(1)).to.be.false;
        });
    });

    describe("scoring", () => {
        it("ignores groups smaller than four by default", () => {
            const board = new Map([
                ["a1", ["GN", 1] as const],
                ["a2", ["GN", 1] as const],
                ["a3", ["GN", 1] as const],
            ]);
            const objectives = defaultObjectives();
            const scores = scoreGame(board, 7, 8, {
                variants: [],
                objectives,
                multipliers: [2, 1, 0, -1],
            });
            expect(scores[0]).to.equal(0);
            expect(scores[1]).to.equal(0);
        });

        it("scores a qualifying group with multipliers", () => {
            const board = new Map([
                ["a1", ["GN", 1] as const],
                ["b1", ["GN", 2] as const],
                ["c1", ["GN", 1] as const],
                ["d1", ["GN", 3] as const],
            ]);
            const objectives = defaultObjectives();
            const scores = scoreGame(board, 7, 8, {
                variants: [],
                objectives,
                multipliers: [2, 1, 0, -1],
            });
            const pip = 1 + 2 + 1 + 3;
            expect(scores[0]).to.equal(pip * 2);
            expect(scores[1]).to.equal(pip * 1);
        });
    });

    describe("hidden state", () => {
        it("redacts opponent objectives when stripped for a player", () => {
            const g = finishSetup(new AgofmarsGame());
            const view = g.state({ strip: true, player: 1 });
            const top = view.stack[view.stack.length - 1] as { objectives: string[][] };
            const opp = top.objectives[1]!;
            expect(opp.every(c => c === "BK")).to.be.true;
        });

        it("keeps pendingDraw visible in stripped state", () => {
            let g = finishSetup(new AgofmarsGame());
            g = g.move("noObjSwap").move("draw");
            const view = g.state({ strip: true, player: 2 });
            const top = view.stack[view.stack.length - 1] as { pendingDraw?: unknown };
            expect(top.pendingDraw).to.not.equal(undefined);
        });

        it("redacts setup lastmoves in stripped state and move history until game over", () => {
            const g = finishSetup(new AgofmarsGame());
            const stripped = g.state({ strip: true, player: 1 });
            expect(stripped.stack[1]!.lastmove).to.equal(AgofmarsGame.REDACTED_SETUP_LASTMOVE);
            expect(stripped.stack[2]!.lastmove).to.equal(AgofmarsGame.REDACTED_SETUP_LASTMOVE);
            expect(g.moveHistory().flat()).to.deep.equal([
                AgofmarsGame.REDACTED_SETUP_LASTMOVE,
                AgofmarsGame.REDACTED_SETUP_LASTMOVE,
            ]);
            const full = g.state({ strip: false });
            expect(full.stack[1]!.lastmove).to.equal(SETUP_MOVE_P1);
            g.gameover = true;
            expect(g.moveHistory().flat()).to.deep.equal([SETUP_MOVE_P1, SETUP_MOVE_P2]);
        });
    });
});
