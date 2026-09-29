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
import type { Colour } from "../../src/games/agofmars/types.js";
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

/** Play phase with optional variants and objective rows (skips manual setup). */
function playWithObjectives(
    variants: string[] = [],
    objectives = defaultObjectives(),
): AgofmarsGame {
    const n = objectives[0]!.length;
    const base = freshPlayState();
    return gameFrom({
        ...base,
        variants,
        stack: [
            {
                ...base.stack[0]!,
                objectives,
                objectivesRevealed: [Array(n).fill(false), Array(n).fill(false)],
            },
        ],
    });
}

describe("Agents of M.A.R.S.", () => {
    before(() => {
        addResource("en");
    });

    describe("render", () => {
        it("shows multiplier captions under each objective pyramid in play", () => {
            const g = finishSetup(new AgofmarsGame());
            const areas = g.render().areas!;
            expect(areas.length).to.be.at.least(2);
            const p1 = areas[0] as { type: string; pieces: { piece: string; text?: string; textPosition?: string }[] };
            expect(p1.type).to.equal("pieces");
            expect(p1.pieces[0]!.text).to.equal("2");
            expect(p1.pieces[0]!.textPosition).to.equal("below");
            expect(p1.pieces[3]!.text).to.match(/−1|-1/);
        });

        it("shows multiplier labels on setup board columns", () => {
            const g = new AgofmarsGame();
            const { board, areas } = g.render();
            expect(board!.columnLabels).to.deep.equal(["2", "1", "0", "−1"]);
            expect(areas).to.have.length(1);
            const pool = areas![0] as { type: string; pieces: string[] };
            expect(pool.type).to.equal("pieces");
            expect(pool.pieces).to.have.length(4);
        });

        it("shows dots on legal swap partners after the first pyramid is selected", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a3", ["GN", 3]);
            g.board.set("d3", ["RD", 1]);
            g = g.move("noObjSwap").move("swap;a3", { partial: true });
            const rep = g.render();
            const dots = rep.annotations?.filter(a => a.type === "dots") ?? [];
            expect(dots.length).to.equal(1);
            const targets = (dots[0] as { targets: { row: number; col: number }[] }).targets;
            expect(targets.some(t => t.row === 5 && t.col === 3)).to.be.true;
            const flood = rep.board.markers?.find(m => m.type === "flood");
            expect(flood).to.not.equal(undefined);
            expect((flood as { points: { row: number; col: number }[] }).points).to.deep.equal([
                { row: 5, col: 0 },
            ]);
        });

        it("annotates a newly placed pyramid with enter", () => {
            const g = finishSetup(new AgofmarsGame()).move("noObjSwap").move("draw").move("a1");
            const enter = g.render().annotations?.find(a => a.type === "enter");
            expect(enter).to.not.equal(undefined);
            expect((enter as { targets: { row: number; col: number }[] }).targets).to.deep.equal([
                { row: 7, col: 0 },
            ]);
        });

        it("previews placement before submit", () => {
            let g = finishSetup(new AgofmarsGame()).move("noObjSwap").move("draw");
            const [colour, size] = g.pendingDraw!;
            const wire = AgofmarsGame.formatPlaceWire(colour, size, "d3");
            const v = g.validateMove(wire);
            expect(v.valid).to.be.true;
            expect(v.complete).to.equal(1);
            const [col, row] = AgofmarsGame.algebraic2coords("d3", g.boardHeight());
            const click = g.handleClick("", row, col);
            expect(click.valid).to.be.true;
            expect(click.complete).to.equal(1);
            expect(click.move).to.equal(wire);
            g = g.move(wire, { partial: true });
            expect(g.board.has("d3")).to.be.true;
            expect(g.pendingDraw).to.not.equal(undefined);
            const rep = g.render();
            const rows = rep.pieces.split("\n");
            expect(rows[row]?.split(",")[col]).to.include(colour);
        });

        it("highlights the selected pyramid while choosing a move destination", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["RD", 2]);
            g = g.move("noObjSwap").move("move;a1", { partial: true });
            const flood = g.render().board.markers?.find(m => m.type === "flood");
            expect(flood).to.not.equal(undefined);
            expect((flood as { colour: string; opacity: number }).colour).to.equal("_context_fill");
            expect((flood as { opacity: number }).opacity).to.equal(0.25);
            expect((flood as { points: { row: number; col: number }[] }).points).to.deep.equal([
                { row: 7, col: 0 },
            ]);
        });
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

    describe("sidebar status", () => {
        it("emits structured bag-count label during play", () => {
            const g = new AgofmarsGame(undefined, ["objective-initiative"]);
            expect(g.phase).to.equal("play");
            const statuses = g.sidebarStatuses();
            expect(statuses).to.have.length(1);
            expect(statuses[0]!.key).to.deep.equal({
                textKey: "apgames:status.agofmars.bagCount",
                actor: { kind: "none" },
            });
            expect(statuses[0]!.value[0]).to.match(/^\d+$/);
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

        it("leaves 59 in the bag when opponent objectives are hidden (BK placeholders)", () => {
            const objectives: Colour[][] = [
                ["RD", "BU", "GN", "YE"],
                ["BK", "BK", "BK", "BK"],
            ];
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

        it("mirrors five-colour-plus3 bag counts for five-colour-minus2", () => {
            const objectives = defaultObjectives(5);
            const variants = ["five-colour-minus2"];
            expect(startingMultiset(variants).length).to.equal(90);
            const after = buildDrawPoolFromBoard(variants, new Map(), objectives);
            const count = (c: string, s: number) =>
                after.filter(([col, sz]) => col === c && sz === s).length;
            expect(count("BK", 3)).to.equal(0);
            expect(count("BK", 2)).to.equal(0);
            expect(count("BK", 1)).to.equal(5);
            expect(after.length).to.equal(70);
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

        it("reports a bag draw with pyramid colour and size", () => {
            const g = finishSetup(new AgofmarsGame()).move("noObjSwap").move("draw");
            const [colour, size] = g.pendingDraw!;
            const drawLine = g
                .chatLogEntries(["Alice", "Bob"])
                .flatMap(e => e.lines)
                .find(l => l.textKey === "apresults:DECKDRAW.agofmars");
            expect(drawLine).to.not.equal(undefined);
            expect(drawLine!.textParams?.colour).to.equal(colour);
            expect(drawLine!.textParams?.count).to.equal(size);
            expect(drawLine!.actor).to.deep.equal({ kind: "seat", seat: 1 });
        });

        it("attributes every ply of a draw-and-place turn to the acting player", () => {
            const g = finishSetup(new AgofmarsGame()).move("noObjSwap").move("draw").move("a1");
            const keys = new Set([
                "apresults:PASS.agofmars_noObjSwap",
                "apresults:DECKDRAW.agofmars",
                "apresults:PLACE.agofmars",
            ]);
            const turnLines = g
                .chatLogEntries(["Alice", "Bob"])
                .flatMap(e => e.lines)
                .filter(l => keys.has(l.textKey));
            expect(turnLines).to.have.length(3);
            for (const line of turnLines) {
                expect(line.actor).to.deep.equal({ kind: "seat", seat: 1 });
            }
        });

        it("reports board moves and swaps with cell coordinates", () => {
            let g = finishSetup(new AgofmarsGame());
            g.board.set("a1", ["RD", 2]);
            g = g.move("noObjSwap").move("a1-a3");
            expect(g.lastmove).to.equal("RD2@a1-a3");
            const moveLines = g.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            expect(moveLines.some(l => l.textKey === "apresults:MOVE.agofmars")).to.be.true;
            g.board.set("a3", ["GN", 3]);
            g.board.set("d3", ["RD", 1]);
            g = g.move("noObjSwap").move("a3|d3");
            expect(g.lastmove).to.equal("GN3@a3|RD1@d3");
            const swapLines = g.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
            const swapLine = swapLines.find(l => l.textKey === "apresults:SWAP.agofmars_board");
            expect(swapLine).to.not.equal(undefined);
            expect(swapLine!.textParams?.colour1).to.equal("GN");
            expect(swapLine!.textParams?.size1).to.equal(3);
            expect(swapLine!.textParams?.cell1).to.equal("a3");
            expect(swapLine!.textParams?.colour2).to.equal("RD");
            expect(swapLine!.textParams?.size2).to.equal(1);
            expect(swapLine!.textParams?.cell2).to.equal("d3");
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
            const [drawnColour, drawnSize] = g.pendingDraw!;
            const place = g.move("a1");
            expect(place.lastmove).to.equal(AgofmarsGame.formatPlaceWire(drawnColour, drawnSize, "a1"));
            expect(place.getPlies().at(-1)?.move).to.equal(
                AgofmarsGame.formatPlaceWire(drawnColour, drawnSize, "a1"),
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

        it("defers bag draw and key area for emulation draw", () => {
            const g = finishSetup(new AgofmarsGame()).move("noObjSwap");
            const poolBefore = g.buildDrawPool().length;
            const preview = new AgofmarsGame(g.serialize());
            preview.move("draw", { emulation: true, trusted: true });
            expect(preview.pendingDraw).to.equal(undefined);
            expect(preview.buildDrawPool().length).to.equal(poolBefore);
            expect(preview.validateMove("a1").valid).to.be.false;
            expect(preview.handleClick("draw", 7, 0).valid).to.be.false;
            const areas = preview.render().areas ?? [];
            expect(areas.some(a => (a as { type?: string }).type === "key")).to.equal(false);

            const committed = g.move("draw");
            expect(committed.pendingDraw).to.not.equal(undefined);
            const committedAreas = committed.render().areas ?? [];
            expect(committedAreas.some(a => (a as { type?: string }).type === "key")).to.equal(true);
        });

        it("does not commit move/swap tokens via move()", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a1", ["RD", 2]);
            g = g.move("noObjSwap");
            expect(() => g.move("move")).to.throw();
            const armed = g.handleClick("move", 7, 0);
            expect(armed.move).to.equal("move;a1");
            expect(armed.complete).to.equal(-1);
            expect(armed.canrender).to.equal(true);
            const validated = g.validateMove("move;a1");
            expect(validated.valid).to.be.true;
            expect(validated.complete).to.equal(-1);
            expect(validated.canrender).to.equal(true);
            expect(() => g.move("move;a1", { partial: true, emulation: true })).to.not.throw();
            const committed = new AgofmarsGame(g.serialize()).handleClick(armed.move, 5, 0);
            expect(committed.complete).to.equal(1);
            expect(committed.move).to.equal("RD2@a1-a3");
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

        it("allows swap when either pyramid can slide into the other", () => {
            let g = gameFrom(freshPlayState());
            g.board.set("a3", ["GN", 3]);
            g.board.set("d3", ["RD", 1]);
            g.board.set("g3", ["RD", 2]);
            g = g.move("noObjSwap");
            expect(g.validateMove("a3|d3").valid).to.be.true;
            expect(g.validateMove("d3|a3").valid).to.be.true;
            expect(g.validateMove("d3|g3").valid).to.be.false;
            expect(g.validateMove("g3|d3").valid).to.be.false;
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
            const g = finishSetup(new AgofmarsGame());
            for (const cell of ["a1", "a2", "a3", "a4"]) {
                g.board.set(cell, ["BK", 1]);
            }
            expect(g.canObjectiveSwap(1)).to.be.false;
        });

        it("black-trio-swap allows objective swap until small, medium, and large blacks appear", () => {
            const g = playWithObjectives(["black-trio-swap"]);
            expect(g.canObjectiveSwap(1)).to.be.true;
            g.board.set("a1", ["BK", 1]);
            g.board.set("a2", ["BK", 2]);
            expect(g.canObjectiveSwap(1)).to.be.true;
            g.board.set("a3", ["BK", 3]);
            expect(g.canObjectiveSwap(1)).to.be.false;
        });

    });

    describe("blind-agents", () => {
        it("hides the viewer's own objective colours in stripped state", () => {
            const normal = finishSetup(new AgofmarsGame()).state({ strip: true, player: 1 });
            const normalTop = normal.stack[normal.stack.length - 1] as { objectives: string[][] };
            expect(normalTop.objectives[0]!.some(c => c !== "BK")).to.be.true;

            const blind = finishSetup(new AgofmarsGame(undefined, ["blind-agents"])).state({
                strip: true,
                player: 1,
            });
            const blindTop = blind.stack[blind.stack.length - 1] as { objectives: string[][] };
            expect(blindTop.objectives[0]!.every(c => c === "BK")).to.be.true;
        });

        it("allows the active player to objective-swap while blind", () => {
            const g = playWithObjectives(["blind-agents"]);
            expect(g.canObjectiveSwap(1)).to.be.true;
        });

        it("objective swap only permutes the opponent's row", () => {
            let g = finishSetup(new AgofmarsGame(undefined, ["blind-agents"]));
            const selfBefore = [...g.objectives[0]!];
            const oppBefore = [...g.objectives[1]!];
            g = g.move("objSwap;2|-1");
            expect(g.objectives[0]).to.deep.equal(selfBefore);
            expect(g.objectives[1]).to.not.deep.equal(oppBefore);
        });
    });

    describe("scoring", () => {
        it("scores groups of any size by default", () => {
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
            expect(scores[0]).to.equal(3 * 2);
            expect(scores[1]).to.equal(3 * 1);
        });

        it("scores a full random game without zeroing every group", () => {
            const g = finishSetup(new AgofmarsGame());
            let guard = 0;
            while (!g.gameover && guard < 500) {
                g.move(g.randomMove());
                guard++;
            }
            expect(g.gameover).to.be.true;
            const scores = g.sidebarScores()[0]!.scores as number[];
            expect(scores[0]! + scores[1]!).to.be.greaterThan(0);
            const pool = buildDrawPoolFromBoard(g.variants, g.board, g.objectives, g.pendingDraw);
            expect(g.board.size + pool.length).to.equal(59);
            const tally = (pieces: readonly (readonly [string, number])[]) => {
                const m = new Map<string, number>();
                for (const [c, s] of pieces) {
                    const k = `${c}${s}`;
                    m.set(k, (m.get(k) ?? 0) + 1);
                }
                return m;
            };
            const setupPyramids = (objectives: typeof g.objectives): (readonly [string, number])[] => {
                const out: (readonly [string, number])[] = [];
                for (let seat = 0; seat < 2; seat++) {
                    const colourSize = seat === 0 ? 2 : 1;
                    const blackSize = seat === 0 ? 3 : 2;
                    for (const colour of objectives[seat]!) {
                        out.push([colour, colourSize], ["BK", blackSize]);
                    }
                }
                return out;
            };
            const start = tally(startingMultiset(g.variants));
            const seen = tally([
                ...g.board.values(),
                ...pool,
                ...setupPyramids(g.objectives),
            ]);
            for (const [key, n] of start) {
                expect(seen.get(key) ?? 0).to.equal(n);
            }
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

        it("biggest-group scores only the largest group per colour", () => {
            const board = new Map([
                ["a1", ["GN", 1] as const],
                ["a2", ["GN", 1] as const],
                ["c1", ["GN", 1] as const],
                ["d1", ["GN", 1] as const],
                ["e1", ["GN", 1] as const],
                ["f1", ["GN", 1] as const],
            ]);
            const objectives = defaultObjectives();
            const mults = [2, 1, 0, -1];
            const allGroups = scoreGame(board, 7, 8, {
                variants: [],
                objectives,
                multipliers: mults,
            });
            const biggestOnly = scoreGame(board, 7, 8, {
                variants: ["biggest-group"],
                objectives,
                multipliers: mults,
            });
            expect(allGroups[0]).to.equal((2 + 4) * 2);
            expect(biggestOnly[0]).to.equal(4 * 2);
            expect(biggestOnly[0]).to.be.lessThan(allGroups[0]!);
        });

        it("group-size-scoring adds group size to the pip sum before multiplying", () => {
            const board = new Map([["a1", ["GN", 2] as const]]);
            const objectives = defaultObjectives();
            const mults = [2, 1, 0, -1];
            const plain = scoreGame(board, 7, 8, { variants: [], objectives, multipliers: mults });
            const withSize = scoreGame(board, 7, 8, {
                variants: ["group-size-scoring"],
                objectives,
                multipliers: mults,
            });
            expect(plain[0]).to.equal(2 * 2);
            expect(withSize[0]).to.equal((2 + 1) * 2);
        });

        it("combines group-size-scoring with step-move without changing score inputs", () => {
            const board = new Map([
                ["a1", ["GN", 2] as const],
                ["a3", ["GN", 2] as const],
            ]);
            const objectives = defaultObjectives();
            const scores = scoreGame(board, 7, 8, {
                variants: ["step-move", "group-size-scoring"],
                objectives,
                multipliers: [2, 1, 0, -1],
            });
            expect(scores[0]).to.equal((3 + 3) * 2);
            let g = playWithObjectives(["step-move", "group-size-scoring"]);
            g.board.set("a1", ["GN", 2]);
            g = g.move("noObjSwap");
            expect(g.validateMove("a1-a2").valid).to.be.true;
            expect(g.validateMove("a1-a3").valid).to.be.false;
        });

        it("scores violet groups with five-colour-plus3 multipliers", () => {
            const board = new Map([
                ["a1", ["VT", 1] as const],
                ["b1", ["VT", 2] as const],
            ]);
            const objectives = defaultObjectives(5);
            const scores = scoreGame(board, 8, 8, {
                variants: ["five-colour-plus3"],
                objectives,
                multipliers: [2, 1, 0, -1, 3],
            });
            const pip = 3;
            const col = objectives[0]!.indexOf("VT");
            expect(col).to.equal(4);
            expect(scores[0]).to.equal(pip * 3);
            expect(scores[1]).to.equal(pip * 3);
        });

        it("scores violet groups with five-colour-minus2 multipliers", () => {
            const board = new Map([
                ["a1", ["VT", 3] as const],
                ["a2", ["VT", 3] as const],
            ]);
            const objectives = defaultObjectives(5);
            const scores = scoreGame(board, 8, 8, {
                variants: ["five-colour-minus2"],
                objectives,
                multipliers: [2, 1, 0, -1, -2],
            });
            const pip = 6;
            expect(scores[0]).to.equal(pip * -2);
        });
    });

    describe("randomMove", () => {
        it("always declines objective swap", () => {
            const g = finishSetup(new AgofmarsGame());
            expect(g.randomMove()).to.equal("noObjSwap");
        });

        it("prefers drawing from the bag over board move or swap", () => {
            let g = finishSetup(new AgofmarsGame());
            g.board.set("a1", ["RD", 2]);
            g.board.set("a3", ["GN", 3]);
            g.board.set("d3", ["RD", 1]);
            g = g.move("noObjSwap");
            let draws = 0;
            let boardActions = 0;
            const boardKinds = new Set<string>();
            const trials = 400;
            for (let i = 0; i < trials; i++) {
                const m = gameFrom(g.serialize()).randomMove();
                const v = g.validateMove(m);
                expect(v.valid).to.be.true;
                expect(v.complete).to.equal(1);
                if (m === "draw") {
                    draws++;
                } else {
                    boardActions++;
                    boardKinds.add(m.includes("|") ? "swap" : "move");
                }
            }
            expect(draws / trials).to.be.greaterThan(0.6);
            expect(draws / trials).to.be.lessThan(0.9);
            expect(boardActions).to.be.greaterThan(0);
            expect(boardKinds.has("move")).to.be.true;
            expect(boardKinds.has("swap")).to.be.true;
        });

        it("randomizes placement among empty cells", () => {
            const g = finishSetup(new AgofmarsGame()).move("noObjSwap").move("draw");
            const seen = new Set<string>();
            for (let i = 0; i < 50; i++) {
                seen.add(gameFrom(g.serialize()).randomMove());
            }
            expect(seen.size).to.be.greaterThan(1);
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
