import { expect } from "chai";
import "mocha";
import i18next from "i18next";
import { addResource } from "../../src";
import { TzaarGame, playStartStackIndex } from "../../src/games/tzaar.js";
import { TzaarGraph, TZAAR_BLOCKED_RENDER } from "../../src/games/tzaar/graph.js";
import { availablePieceCounts, buildFixedBoard, buildRandomBoard } from "../../src/games/tzaar/setup.js";
import {
    allCaptureMoves,
    applyCapture,
    applyStrengthen,
    cloneBoardForSim,
    hasForcedCapture,
    legalSlideDestinations,
} from "../../src/games/tzaar/move.js";
import { lacksTrinity, typesPresent } from "../../src/games/tzaar/win.js";
import { parsePlayMove } from "../../src/games/tzaar/notation.js";
import { PLAYABLE_INTERSECTIONS } from "../../src/games/tzaar/types.js";

describe("TzaarGraph", () => {
    it("has 60 playable intersections and a blocked centre", () => {
        const graph = new TzaarGraph();
        expect(graph.playableCells().length).to.equal(PLAYABLE_INTERSECTIONS);
        expect(graph.blockedCell).to.equal("e5");
        const cells = graph.listCells(true) as string[][];
        const blocked = cells[TZAAR_BLOCKED_RENDER[0]!.row]![TZAAR_BLOCKED_RENDER[0]!.col]!;
        expect(blocked).to.equal(graph.blockedCell);
        expect(graph.graph.hasNode(blocked)).to.equal(false);
    });

    it("ring distances match diagram 4 ring sizes", () => {
        const graph = new TzaarGraph();
        const counts = new Map<number, number>();
        for (const cell of graph.playableCells()) {
            const ring = graph.ringDistance(cell)!;
            counts.set(ring, (counts.get(ring) ?? 0) + 1);
        }
        expect(counts.get(1)).to.equal(6);
        expect(counts.get(2)).to.equal(12);
        expect(counts.get(3)).to.equal(18);
        expect(counts.get(4)).to.equal(24);
    });
});

describe("Tzaar setup", () => {
    const graph = new TzaarGraph();

    it("fixed board: 30 stacks per player and full trinity on tops", () => {
        const board = buildFixedBoard(graph);
        expect(board.size).to.equal(60);
        let p1 = 0;
        let p2 = 0;
        for (const stack of board.values()) {
            if (stack.owner === 1) {
                p1++;
            } else {
                p2++;
            }
        }
        expect(p1).to.equal(30);
        expect(p2).to.equal(30);
        expect(typesPresent(board, 1).size).to.equal(3);
        expect(typesPresent(board, 2).size).to.equal(3);
    });

    it("random board fills all intersections", () => {
        const board = buildRandomBoard(graph);
        expect(board.size).to.equal(60);
        expect(typesPresent(board, 1).size).to.equal(3);
        expect(typesPresent(board, 2).size).to.equal(3);
    });
});

describe("TzaarGame", () => {
    before(() => {
        addResource("en");
    });

    it("sidebarScores show tott/tzarra/tzaar counts per player", () => {
        const g = new TzaarGame();
        const sections = g.sidebarScores();
        expect(sections).to.have.length(1);
        expect(sections[0]!.scores).to.deep.equal(["15/9/6", "15/9/6"]);
    });

    it("sidebarScores count only stack tops (buried types are excluded)", () => {
        const board = new Map([
            ["a1", { owner: 1 as const, pieces: ["tzaar" as const, "tott" as const] }],
            ["a2", { owner: 1 as const, pieces: ["tott" as const] }],
        ]);
        expect(availablePieceCounts(board, undefined, 1)).to.deep.equal({
            tott: 2,
            tzarra: 0,
            tzaar: 0,
        });
    });

    it("sidebarScores drop when a type is captured off the board", () => {
        const g = new TzaarGame();
        g.move("d5-d6", { trusted: true });
        const scores = g.sidebarScores()[0]!.scores as string[];
        expect(scores[0]).to.equal("15/9/6");
        expect(scores[1]).to.equal("15/9/5");
    });

    it("sidebarScores reflect strengthen burying a visible type", () => {
        const board = new Map([
            ["d4", { owner: 2 as const, pieces: ["tott" as const] }],
            ["e4", { owner: 2 as const, pieces: ["tzaar" as const] }],
        ]);
        expect(availablePieceCounts(board, undefined, 2)).to.deep.equal({ tott: 1, tzarra: 0, tzaar: 1 });
        applyStrengthen(board, "d4", "e4");
        expect(availablePieceCounts(board, undefined, 2)).to.deep.equal({ tott: 1, tzarra: 0, tzaar: 0 });
    });

    it("exposes automove and custom-buttons flags", () => {
        expect(TzaarGame.gameinfo.flags).to.include("automove");
        expect(TzaarGame.gameinfo.flags).to.include("custom-buttons");
    });

    it("starts in play on the fixed diagram with white to move", () => {
        const g = new TzaarGame();
        expect(g.phase).to.equal("play");
        expect(g.board.size).to.equal(60);
        expect(g.currplayer).to.equal(1);
        expect(g.isWhiteOpeningPly()).to.equal(true);
        expect(playStartStackIndex(g.stack)).to.equal(0);
    });

    it("reports when a selected stack has no capture targets", () => {
        const g = new TzaarGame();
        g.move("d5-d6", { trusted: true });
        g.move("e6-f5,e7-e8", { trusted: true });
        const v = g.validateMove("f7-");
        expect(v.valid).to.equal(false);
        expect(v.message).to.equal(
            i18next.t("apgames:validation.tzaar.NO_CAPTURES_FROM", { where: "f7" }),
        );
        const [fx, fy] = g.graph.algebraic2coords("f7");
        const click = g.handleClick("", fy, fx);
        expect(click.valid).to.equal(false);
        expect(click.move).to.equal("");
        expect(click.message).to.equal(v.message);
    });

    it("partial preview shows the in-progress first leg, not last turn arrows", () => {
        const g = new TzaarGame();
        g.move(g.moves()[0]!, { trusted: true });
        const first = "b1-a1";
        g.validateMove(first);
        const preview = g.move(first, { partial: true, trusted: true });
        const rep = preview.render() as { annotations?: Array<{ type: string }> };
        const arrows = rep.annotations?.filter((a) => a.type === "move") ?? [];
        expect(arrows).to.have.length(1);
    });

    it("handleClick: landing cell of first capture can start the second leg", () => {
        const g = new TzaarGame();
        g.move(g.moves()[0]!, { trusted: true });
        const [ax, ay] = g.graph.algebraic2coords("a1");
        const r = g.handleClick("b1-a1", ay, ax);
        expect(r.valid).to.equal(true);
        expect(r.move).to.equal("b1-a1,a1-");
    });

    it("handleClick: after first capture in the box, click adds a second-leg partial", () => {
        const g = new TzaarGame();
        g.move(g.moves()[0]!, { trusted: true });
        const full = g.moves().find((m) => m.startsWith("b1-a1,b2-"));
        expect(full).to.not.equal(undefined);
        const [bx, by] = g.graph.algebraic2coords("b2");
        const r = g.handleClick("b1-a1", by, bx);
        expect(r.valid).to.equal(true);
        expect(r.move).to.equal("b1-a1,b2-");
        expect(r.complete).to.equal(-1);
        const [tx, ty] = g.graph.algebraic2coords("b3");
        const r2 = g.handleClick(r.move!, ty, tx);
        expect(r2.valid).to.equal(true);
        expect(r2.move).to.equal("b1-a1,b2-b3");
        expect(r2.complete).to.equal(1);
    });

    it("handleClick: from then destination completes opening capture notation", () => {
        const g = new TzaarGame();
        const [x5, y5] = g.graph.algebraic2coords("d5");
        const [x6, y6] = g.graph.algebraic2coords("e6");
        let r = g.handleClick("", y5, x5);
        expect(r.valid).to.equal(true);
        expect(r.move).to.equal("d5-");
        r = g.handleClick(r.move, y6, x6);
        expect(r.valid).to.equal(true);
        expect(r.move).to.equal("d5-e6");
        expect(r.complete).to.equal(1);
    });

    it("partial move previews a capture without committing the stack", () => {
        const g = new TzaarGame();
        const cap = g.moves()[0]!;
        g.move(cap, { partial: true, trusted: true });
        expect(g.stack.length).to.equal(1);
        expect(g.currplayer).to.equal(1);
    });

    it("collectChatLogLine describes capture from, to, and piece kind", () => {
        const g = new TzaarGame();
        const lines: Array<{ textKey: string; textParams?: Record<string, string> }> = [];
        g.collectChatLogLine(
            lines,
            { type: "capture", where: "d6", how: "d5", what: "tzaar" },
            { defaultSeat: 1, results: [] },
        );
        expect(lines[0]!.textKey).to.equal("apresults:tzaar.MOVE.capture");
        expect(lines[0]!.textParams).to.include({
            from: "d5",
            to: "d6",
            piece: "Tzaar",
        });
    });

    it("opening: white plays a single capture without a second leg", () => {
        const g = new TzaarGame();
        const opens = g.moves();
        expect(opens.length).to.be.greaterThan(0);
        for (const m of opens) {
            expect(parsePlayMove(m)?.second).to.equal(undefined);
            expect(m).to.not.include(",");
        }
        g.move(opens[0]!, { trusted: true });
        expect(g.stack.length).to.equal(2);
        expect(g.currplayer).to.equal(2);
        expect(g.isWhiteOpeningPly()).to.equal(false);
    });

    it("two-step turn: capture then pass is one stack frame", () => {
        const g = new TzaarGame();
        g.move(g.moves()[0]!, { trusted: true });
        const caps = g.moves();
        const passMove = caps.find((m) => m.endsWith(",pass"));
        expect(passMove).to.not.equal(undefined);
        g.move(passMove!, { trusted: true });
        expect(g.stack.length).to.equal(3);
        expect(g.currplayer).to.equal(1);
    });

    it("stack capture requires height advantage", () => {
        const board = new Map([
            ["d4", { owner: 1 as const, pieces: ["tott" as const] }],
            ["e4", { owner: 2 as const, pieces: ["tott" as const, "tott" as const] }],
        ]);
        const graph = new TzaarGraph();
        expect(legalSlideDestinations(graph, board, "d4", 1, "capture-only")).to.not.include("e4");
        expect(legalSlideDestinations(graph, board, "e4", 2, "capture-only")).to.include("d4");
    });

    it("strengthen merges stacks on a friendly intersection", () => {
        const board = new Map([
            ["d4", { owner: 1 as const, pieces: ["tott" as const] }],
            ["e4", { owner: 1 as const, pieces: ["tzaar" as const] }],
        ]);
        applyStrengthen(board, "d4", "e4");
        expect(board.has("d4")).to.equal(false);
        expect(board.get("e4")!.pieces).to.deep.equal(["tzaar", "tott"]);
    });

    it("win by type elimination on stack tops only", () => {
        const board = new Map([
            ["a1", { owner: 2 as const, pieces: ["tott" as const, "tzaar" as const] }],
        ]);
        expect(lacksTrinity(board, 2)).to.equal(true);
    });

    it("tournament variant starts empty with reserves", () => {
        const g = new TzaarGame(undefined, ["tournament"]);
        expect(g.phase).to.equal("setup");
        expect(g.board.size).to.equal(0);
        expect(g.reserves![0].tott).to.equal(15);
        expect(g.reserves![1].tzaar).to.equal(6);
    });

    it("tournament setup sidebar counts placed pieces only", () => {
        const g = new TzaarGame(undefined, ["tournament"]);
        expect(g.sidebarScores()[0]!.scores).to.deep.equal(["0/0/0", "0/0/0"]);
        g.move("a1T", { trusted: true });
        expect(g.sidebarScores()[0]!.scores).to.deep.equal(["1/0/0", "0/0/0"]);
    });

    it("validateMove rejects setup place when that reserve type is exhausted", () => {
        const g = new TzaarGame(undefined, ["tournament"]);
        g.reserves![0].tott = 0;
        expect(g.validateMove("a1T").valid).to.equal(false);
        expect(g.moves().every((m) => !/^a1T$/i.test(m))).to.equal(true);
    });

    it("tournament setup click skips kinds with no reserve left", () => {
        const g = new TzaarGame(undefined, ["tournament"]);
        g.reserves![0].tott = 0;
        const [x, y] = g.graph.algebraic2coords("d4");
        const r = g.handleClick("", y, x) as { valid: boolean; move?: string };
        expect(r.valid).to.equal(true);
        expect(r.move).to.equal("d4R");
    });

    it("after tournament setup white has a single-capture opening only", () => {
        const g = new TzaarGame(undefined, ["tournament"]);
        let guard = 0;
        while (g.phase === "setup" && guard < 70) {
            const m = g.moves();
            if (m.length === 0) {
                break;
            }
            g.move(m[0]!, { trusted: true });
            guard++;
        }
        expect(g.phase).to.equal("play");
        expect(g.currplayer).to.equal(1);
        expect(g.isWhiteOpeningPly()).to.equal(true);
        for (const m of g.moves()) {
            expect(m).to.not.include(",");
        }
    });

    it("moveHistory includes tournament setup placements", () => {
        const g = new TzaarGame(undefined, ["tournament"]);
        const m1 = g.moves()[0]!;
        g.move(m1, { trusted: true });
        const g2 = new TzaarGame(g.state());
        const m2 = g2.moves()[0]!;
        g2.move(m2, { trusted: true });
        expect(g2.moveHistory()).to.deep.equal([[m1, m2]]);
    });

    it("collectChatLogLine names the placed piece type", () => {
        const g = new TzaarGame();
        const lines: Array<{ textKey: string; textParams?: Record<string, string> }> = [];
        g.collectChatLogLine(
            lines,
            { type: "place", who: 1, where: "e9", what: "tzarra" },
            { defaultSeat: 1, results: [] },
        );
        expect(lines[0]!.textKey).to.equal("apresults:tzaar.PLACE.default");
        expect(lines[0]!.textParams?.piece).to.equal("Tzarra");
    });

    it("tournament setup toggles piece kind from the move box across clicks", () => {
        const g0 = new TzaarGame(undefined, ["tournament"]);
        const [x, y] = g0.graph.algebraic2coords("d4");
        const r1 = g0.handleClick("", y, x) as { valid: boolean; move?: string };
        expect(r1.valid).to.equal(true);
        expect(r1.move).to.equal("d4T");
        const g1 = new TzaarGame(g0.state());
        const r2 = g1.handleClick(r1.move!, y, x) as { valid: boolean; move?: string };
        expect(r2.valid).to.equal(true);
        expect(r2.move).to.equal("d4R");
        const r3 = g1.handleClick(r2.move!, y, x) as { valid: boolean; move?: string };
        expect(r3.move).to.equal("d4Z");
        const preview = g1.move(r2.move!, { partial: true, trusted: true });
        expect(preview.board.get("d4")?.pieces).to.deep.equal(["tzarra"]);
    });

    it("random variant adds random-start flag", () => {
        const flags = TzaarGame.resolveFlags({ variants: ["random"] });
        expect(flags).to.include("random-start");
    });

    it("stackKey uses plain Tott glyphs under the visible top", () => {
        const g = new TzaarGame();
        g.board.set("a1", { owner: 2, pieces: ["tzaar", "tott", "tzarra"] });
        expect(g.stackKey("a1")).to.equal("XXY");
    });

    it("render uses stacking-offset on hex-of-tri", () => {
        const g = new TzaarGame();
        const rep = g.render();
        expect(rep.renderer).to.equal("stacking-offset");
        expect(rep.board?.style).to.equal("hex-of-tri");
        expect(rep.options).to.include("reverse-numbers");
    });

    it("tzarra legend stacking overlay wires border/inner slots 5–8", () => {
        const rep = new TzaarGame().render();
        const entry = rep.legend!["B"];
        expect(entry).to.be.an("array").with.length(2);
        const [base, overlay] = entry as [{ paint?: { border?: { palette?: number }; inner?: { palette?: number } } }, { paint?: { border?: { palette?: number }; inner?: { palette?: number } } }];
        expect(base.paint?.border?.palette).to.equal(5);
        expect(base.paint?.inner?.palette).to.equal(6);
        expect(overlay.paint?.border?.palette).to.equal(base.paint?.border?.palette);
        expect(overlay.paint?.inner?.palette).to.equal(base.paint?.inner?.palette);
    });

    it("tzaar legend wires chariot border/inner slots 9–12", () => {
        const rep = new TzaarGame().render();
        const c = rep.legend!["C"] as { paint?: { border?: { palette?: number }; inner?: { palette?: number } } };
        const z = rep.legend!["Z"] as { paint?: { border?: { palette?: number }; inner?: { palette?: number } } };
        expect(c.paint?.border?.palette).to.equal(9);
        expect(c.paint?.inner?.palette).to.equal(10);
        expect(z.paint?.border?.palette).to.equal(11);
        expect(z.paint?.inner?.palette).to.equal(12);
    });

    it("getButtons offers pass after the forced capture is chosen", () => {
        const g = new TzaarGame();
        g.move(g.moves()[0]!, { trusted: true });
        const cap = g.moves()[0]!;
        const first = cap.split(",")[0]!;
        g.validateMove(first);
        const buttons = g.getButtons();
        expect(buttons.length).to.equal(1);
        expect(buttons[0]!.move).to.equal(`${first},pass`);
    });
});

describe("Tzaar move helpers", () => {
    it("simulate capture exposes forced capture for next player check", () => {
        const graph = new TzaarGraph();
        const board = buildFixedBoard(graph);
        const first = allCaptureMoves(graph, board, 1)[0]!;
        const sim = cloneBoardForSim(board);
        applyCapture(sim, first.from, first.to);
        expect(hasForcedCapture(graph, sim, 2)).to.equal(true);
    });
});