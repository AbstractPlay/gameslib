import { expect } from "chai";
import i18next from "i18next";
import "mocha";
import { addResource } from "../../src";
import { GipfGame } from "../../src/games/gipf.js";
import type { CellPiece } from "../../src/games/gipf/types.js";
import { GipfGraph } from "../../src/games/gipf/graph.js";
import { formatCaptureMove, listCaptureConfirmMoves } from "../../src/games/gipf/capture-notation.js";
import { findAllCapturableRows } from "../../src/games/gipf/rows.js";
import { legalPushDestinations, pushEntrySpot, simulatePush } from "../../src/games/gipf/push.js";
import type { CapturePending, CapturableRow } from "../../src/games/gipf/types.js";
import type { ChatLogLine } from "../../src/common/chat-log.js";
import { formatChatLogLine } from "../../src/common/chat-log.js";

describe("GipfGame", () => {
    before(() => {
        addResource("en");
    });

    it("exposes automove for single-option plies", () => {
        expect(GipfGame.gameinfo.flags).to.include("automove");
    });

    it("legend paints basic and GIPF-piece borders via custom palettes", () => {
        const rep = new GipfGame().render();
        const p1Fill = { func: "custom", default: "#e31a1c", palette: 1 };
        const p2Fill = { func: "custom", default: "#1f78b4", palette: 2 };
        const expectBasicStack = (key: "A" | "C", fill: typeof p1Fill, borderPalette: number) => {
            expect(rep.legend![key]).to.be.an("array");
            const layers = rep.legend![key] as [
                { name: string; paint?: { fill: unknown; border: unknown } },
                { name: string; scale?: number; paint?: { fill: unknown; border: unknown } },
            ];
            expect(layers[0]!.name).to.equal("piece");
            expect(layers[0]!.paint!.fill).to.deep.equal(fill);
            expect(layers[0]!.paint!.border).to.equal("#000000");
            expect(layers[1]!.name).to.equal("piece");
            expect(layers[1]!.scale).to.equal(0.85);
            expect(layers[1]!.paint!.fill).to.deep.equal(fill);
            expect(layers[1]!.paint!.border).to.deep.equal({
                func: "custom",
                default: "#000000",
                palette: borderPalette,
            });
        };
        expectBasicStack("A", p1Fill, 3);
        expectBasicStack("C", p2Fill, 4);
        const b = rep.legend!.B!;
        const d = rep.legend!.D!;
        expect(b.name).to.equal("piece-chariot");
        expect(b.paint!.border).to.deep.equal({ func: "custom", default: "#000000", palette: 5 });
        expect(b.paint!.inner).to.deep.equal({ func: "custom", default: "#000000", palette: 6 });
        expect(d.paint!.border).to.deep.equal({ func: "custom", default: "#000000", palette: 7 });
        expect(d.paint!.inner).to.deep.equal({ func: "custom", default: "#000000", palette: 8 });
        expect(GipfGame.gameinfo.customizations).to.have.length(8);
    });
    it("Standard setup: reserve 12 each with three gipf on board", () => {
        const g = new GipfGame(undefined, []);
        expect(g.reserve).to.deep.equal([12, 12]);
        expect(g.gipfOnBoard(1)).to.equal(3);
        expect(g.gipfOnBoard(2)).to.equal(3);
    });

    it("Diagram 1: owners alternate clockwise on the six start spots", () => {
        const g = new GipfGame(undefined, []);
        const expectOwner = (cell: string, owner: 1 | 2) => {
            expect(g.board.get(cell)?.owner).to.equal(owner);
        };
        expectOwner("e8", 2);
        expectOwner("h5", 1);
        expectOwner("h2", 2);
        expectOwner("e2", 1);
        expectOwner("b2", 2);
        expectOwner("b5", 1);
    });

    it("Basic setup: reserve 12 with basic pieces only", () => {
        const g = new GipfGame(undefined, ["basic"]);
        expect(g.reserve).to.deep.equal([12, 12]);
        expect(g.gipfOnBoard(1)).to.equal(0);
        for (const p of g.board.values()) {
            expect(p.kind).to.equal("basic");
        }
    });

    it("Tournament setup: empty board, reserve 18", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        expect(g.reserve).to.deep.equal([18, 18]);
        expect(g.board.size).to.equal(0);
        expect(g.gipfLocked).to.deep.equal([false, false]);
    });

    it("push direction accepts any spot along the ray", () => {
        const graph = new GipfGraph();
        const dot = "e1";
        const line = graph.traceLine(dot, graph.dotEntrySteps(dot)[0]!);
        const far = line[line.length - 2]!;
        expect(graph.isSpot(far)).to.equal(true);
        expect(pushEntrySpot(graph, dot, far)).to.equal(line[1]);
        expect(pushEntrySpot(graph, dot, line[1]!)).to.equal(line[1]);
    });

    it("moves() lists only completed dot-push plies, not dot alone", () => {
        const g = new GipfGame();
        for (const m of g.moves()) {
            expect(m.startsWith("cap") || m.includes("-")).to.equal(
                true,
                `expected complete play or capture, got ${m}`,
            );
        }
    });

    it("standard and basic never use G suffix gipf entry notation", () => {
        for (const variants of [[], ["basic"] as const]) {
            const g = new GipfGame(undefined, [...variants]);
            for (const m of g.moves()) {
                expect(m.endsWith("G"), `move ${m} in ${variants.join(",") || "standard"}`).to.equal(false);
            }
        }
    });

    it("tournament GIPF pushes use G suffix in moves() and capital G in lastmove", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        const gipfMv = g.moves().find((m) => m.endsWith("G"));
        expect(gipfMv).to.not.equal(undefined);
        g.move(gipfMv!, { trusted: true });
        expect(g.lastmove).to.equal(gipfMv);
        expect(g.lastmove!.endsWith("G")).to.equal(true);
        expect(g.gameover).to.equal(false);
        expect(g.stack.length).to.equal(2);
    });

    it("tournament: no gipf EOG until both players have had an opening turn", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        const p1Gipf = g.moves().find((m) => m.endsWith("G"));
        expect(p1Gipf).to.not.equal(undefined);
        g.move(p1Gipf!, { trusted: true });
        expect(g.gipfOnBoard(1)).to.be.greaterThan(0);
        expect(g.gipfOnBoard(2)).to.equal(0);
        expect(g.gameover).to.equal(false);
        const p2Gipf = g.moves().find((m) => m.endsWith("G"));
        expect(p2Gipf).to.not.equal(undefined);
        g.move(p2Gipf!, { trusted: true });
        expect(g.stack.length).to.be.at.least(3);
        expect(g.gameover).to.equal(false);
    });

    it("tournament: after both openings, move list offers singles and GIPF entries", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        const p1Gipf = g.moves().find((m) => m.endsWith("G"));
        g.move(p1Gipf!, { trusted: true });
        const p2Gipf = g.moves().find((m) => m.endsWith("G"));
        g.move(p2Gipf!, { trusted: true });
        expect(g.currplayer).to.equal(1);
        expect(g.tournamentOpeningDone).to.deep.equal([true, true]);
        const list = g.moves();
        expect(list.some((m) => m.endsWith("G"))).to.equal(true);
        expect(list.some((m) => !m.endsWith("G") && m.includes("-"))).to.equal(true);
    });

    it("tournament opening: sole push from dot autocompletes on click", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        const dot = "e9";
        expect(g.moves().filter((m) => m.startsWith(`${dot}-`))).to.have.length(1);
        const v = g.validateMove(`g${dot}`);
        expect(v.autocomplete).to.equal("e9-e8G");
        expect(v.complete).to.equal(1);
        const [col, row] = g.graph.algebraic2coords(dot);
        const click = g.handleClick("", row, col);
        expect(click.move).to.equal("e9-e8G");
        expect(click.complete).to.equal(1);
    });

    it("tournament opening: pending GIPF on dot does not toggle", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        let dot: string | undefined;
        for (const node of g.graph.graph.nodes()) {
            if (!g.graph.isDot(node)) {
                continue;
            }
            const n = g.moves().filter((m) => m.startsWith(`${node}-`)).length;
            if (n >= 2) {
                dot = node;
                break;
            }
        }
        expect(dot).to.not.equal(undefined);
        g.move(`g${dot!}`, { trusted: true });
        expect(g.pendingDot?.kind).to.equal("gipf");
        const [col, row] = g.graph.algebraic2coords(dot!);
        const c2 = g.handleClick(`g${dot!}`, row, col);
        g.move(c2.move, { trusted: true });
        expect(g.pendingDot?.kind).to.equal("gipf");
    });

    it("handleClick toggles pending GIPF using move-box fragment (no committed pending)", () => {
        const state = new GipfGame(undefined, ["tournament"]);
        state.move(state.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        state.move(state.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        let dot: string | undefined;
        for (const node of state.graph.graph.nodes()) {
            if (!state.graph.isDot(node)) {
                continue;
            }
            if (state.moves().filter((m) => m.startsWith(`${node}-`)).length >= 2) {
                dot = node;
                break;
            }
        }
        expect(dot).to.not.equal(undefined);
        const [col, row] = state.graph.algebraic2coords(dot!);
        const place = state.handleClick("", row, col);
        expect(place.move).to.equal(`g${dot!}`);
        const g = new GipfGame(state.state());
        const toggle = g.handleClick(place.move, row, col);
        expect(toggle.valid).to.equal(true);
        expect(toggle.move).to.equal(dot!);
    });

    it("handleClick clear after basic pending empties the move box", () => {
        const state = new GipfGame(undefined, ["tournament"]);
        state.move(state.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        state.move(state.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        let dot: string | undefined;
        for (const node of state.graph.graph.nodes()) {
            if (!state.graph.isDot(node)) {
                continue;
            }
            if (state.moves().filter((m) => m.startsWith(`${node}-`)).length >= 2) {
                dot = node;
                break;
            }
        }
        expect(dot).to.not.equal(undefined);
        const [col, row] = state.graph.algebraic2coords(dot!);
        const place = state.handleClick("", row, col);
        const g = new GipfGame(state.state());
        const basic = g.handleClick(place.move, row, col);
        const cleared = g.handleClick(basic.move, row, col);
        expect(cleared.valid).to.equal(true);
        expect(cleared.move).to.equal("");
        expect(cleared.autocomplete).to.equal(`!${dot!}`);
        expect(cleared.canrender).to.equal(true);
        expect(() => new GipfGame(state.state()).move("", { trusted: true })).to.not.throw();
    });

    it("validateMove accepts dot clear when only the board shows interim placement", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        g.move(g.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        g.move(g.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        let dot: string | undefined;
        for (const node of g.graph.graph.nodes()) {
            if (g.graph.isDot(node) && g.moves().filter((m) => m.startsWith(`${node}-`)).length >= 2) {
                dot = node;
                break;
            }
        }
        expect(dot).to.not.equal(undefined);
        g.board.set(dot!, { owner: 1, kind: "basic" });
        const v = g.validateMove(`!${dot}`);
        expect(v.valid).to.equal(true);
        expect(v.message).to.not.match(/DEFAULT_HANDLER/i);
    });

    it("tournament: click dot cycles gipf, basic, clear after opening", () => {
        const g = new GipfGame(undefined, ["tournament"]);
        g.move(g.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        g.move(g.moves().find((m) => m.endsWith("G"))!, { trusted: true });
        let dot: string | undefined;
        for (const node of g.graph.graph.nodes()) {
            if (!g.graph.isDot(node)) {
                continue;
            }
            const n = g.moves().filter((m) => m.startsWith(`${node}-`)).length;
            if (n >= 2) {
                dot = node;
                break;
            }
        }
        expect(dot).to.not.equal(undefined);
        const [col, row] = g.graph.algebraic2coords(dot);
        const click = g.handleClick("", row, col);
        expect(click.move).to.equal(`g${dot}`);
        g.move(click.move, { trusted: true });
        expect(g.pendingDot?.kind).to.equal("gipf");
        const c2 = g.handleClick(click.move, row, col);
        expect(c2.move).to.equal(dot);
        g.move(c2.move, { trusted: true });
        expect(g.pendingDot?.kind).to.equal("basic");
        expect(g.reserve[0]).to.equal(15);
        const c3 = g.handleClick(c2.move, row, col);
        expect(c3.move).to.equal("");
        expect(c3.autocomplete).to.equal(`!${dot}`);
        g.move(c3.autocomplete!, { trusted: true });
        expect(g.pendingDot).to.equal(undefined);
        expect(g.board.has(dot!)).to.equal(false);
        expect(g.reserve[0]).to.equal(16);
    });

    it("Diagram 2 style: dot then push onto first spot", () => {
        const g = new GipfGame(undefined, ["basic"]);
        g.board.clear();
        g.reserve = [1, 1];
        g.currplayer = 1;
        expect(g.moves().every((m) => m.includes("-"))).to.equal(true);
        expect(g.moves().some((m) => m.startsWith("b1-"))).to.equal(true);
        const dest = g.moves().find((m) => m.match(/^b1-/))!;
        g.move(dest, { trusted: true });
        expect(g.graph.isSpot(dest.split("-")[1]!)).to.equal(true);
        expect(g.pendingDot).to.equal(undefined);
    });

    it("Diagram 4a: gap breaks four in a row", () => {
        const graph = new GipfGraph();
        const line = graph.traceLine("b1", graph.dotEntrySteps("b1")[0]!);
        const spots = line.filter((c) => graph.isSpot(c));
        const b: CellPiece = { owner: 1, kind: "basic" };
        const board = new Map<string, CellPiece>();
        board.set(spots[0]!, b);
        board.set(spots[1]!, b);
        board.set(spots[3]!, b);
        board.set(spots[4]!, b);
        expect(findAllCapturableRows(board, graph).length).to.equal(0);
    });

    it("Diagram 4b style: four same colour captures attached opponent", () => {
        const graph = new GipfGraph();
        const line = graph.traceLine("a1", graph.dotEntrySteps("a1")[0]!);
        const spots = line.filter((c) => graph.isSpot(c));
        const board = new Map<string, CellPiece>();
        for (let i = 0; i < 4; i++) {
            board.set(spots[i]!, { owner: 1, kind: "basic" });
        }
        board.set(spots[4]!, { owner: 2, kind: "basic" });
        const rows = findAllCapturableRows(board, graph);
        expect(rows.length).to.be.greaterThan(0);
        expect(rows[0]!.cells).to.include(spots[4]!);
    });

    it("Diagram 3 style: push chains from entry only, not distant spots on same line", () => {
        const g = new GipfGame(undefined, []);
        const piece: CellPiece = { owner: 1, kind: "basic" };
        const sim = simulatePush(g.board, g.graph, "e9", "e8", piece);
        expect(sim.ok).to.equal(true);
        if (sim.ok) {
            expect(sim.board.get("e7")?.owner).to.equal(2);
            expect(sim.board.get("e8")?.owner).to.equal(1);
            expect(sim.board.get("e2")?.owner).to.equal(1);
        }
    });

    it("push stops at a gap: non-adjacent pieces on the line do not shift", () => {
        const graph = new GipfGraph();
        const board = new Map<string, CellPiece>();
        board.set("e8", { owner: 2, kind: "basic" });
        board.set("e6", { owner: 2, kind: "basic" });
        const sim = simulatePush(board, graph, "e9", "e8", { owner: 1, kind: "basic" });
        expect(sim.ok).to.equal(true);
        if (sim.ok) {
            expect(sim.board.has("e6")).to.equal(true);
            expect(sim.board.get("e7")?.owner).to.equal(2);
        }
    });

    it("blocked line: full line cannot accept push", () => {
        const graph = new GipfGraph();
        const dot = "b1";
        const step = graph.dotEntrySteps(dot)[0]!;
        const line = graph.traceLine(dot, step);
        const spots = line.slice(1, line.length - 1);
        const board = new Map<string, CellPiece>();
        for (const s of spots) {
            board.set(s, { owner: 1, kind: "basic" });
        }
        const piece: CellPiece = { owner: 2, kind: "basic" };
        const sim = simulatePush(board, graph, dot, spots[0]!, piece);
        expect(sim.ok).to.equal(false);
    });

    it("blocked dot click returns BLOCKED_LINE instead of default handler", () => {
        const g = new GipfGame();
        g.board.clear();
        const setup: [string, CellPiece][] = [
            ["h2", { owner: 2, kind: "gipf" }],
            ["b5", { owner: 1, kind: "gipf" }],
            ["g2", { owner: 1, kind: "basic" }],
            ["f7", { owner: 1, kind: "basic" }],
            ["d4", { owner: 2, kind: "basic" }],
            ["c3", { owner: 2, kind: "basic" }],
            ["b2", { owner: 1, kind: "basic" }],
            ["e4", { owner: 1, kind: "gipf" }],
            ["f6", { owner: 1, kind: "basic" }],
            ["g6", { owner: 2, kind: "basic" }],
            ["e2", { owner: 2, kind: "basic" }],
            ["e5", { owner: 2, kind: "gipf" }],
            ["f5", { owner: 1, kind: "gipf" }],
            ["g5", { owner: 1, kind: "basic" }],
            ["h5", { owner: 1, kind: "basic" }],
        ];
        for (const [cell, piece] of setup) {
            g.board.set(cell, piece);
        }
        g.currplayer = 2;
        g.reserve = [6, 6];
        const dot = "i5";
        const piece: CellPiece = { owner: 2, kind: "basic" };
        expect(legalPushDestinations(g.board, g.graph, dot, piece)).to.have.length(0);
        expect(g.validateMove(dot).message).to.equal(i18next.t("apgames:validation.gipf.BLOCKED_LINE"));
        const [col, row] = g.graph.algebraic2coords(dot);
        const click = g.handleClick("", row, col);
        expect(click.valid).to.equal(false);
        expect(click.message).to.equal(i18next.t("apgames:validation.gipf.BLOCKED_LINE"));
    });

    it("serialize round-trip preserves pending dot after partial placement", () => {
        const g = new GipfGame(undefined, ["basic"]);
        g.board.clear();
        g.reserve = [5, 5];
        g.currplayer = 1;
        g.move("a1", { trusted: true });
        const g2 = new GipfGame(g.state());
        expect(g2.pendingDot?.cell).to.equal("a1");
    });

    it("autocompletes dot entry to sole push even when other dots have moves", () => {
        const g = new GipfGame();
        g.board.clear();
        g.reserve = [8, 8];
        g.currplayer = 1;
        g.board.set("e8", { owner: 1, kind: "basic" });
        g.board.set("e7", { owner: 1, kind: "basic" });
        g.board.set("e6", { owner: 1, kind: "basic" });
        const v = g.validateMove("e9");
        expect(v.autocomplete).to.equal("e9-e8");
        expect(v.complete).to.equal(1);
        const [col, row] = g.graph.algebraic2coords("e9");
        const click = g.handleClick("", row, col);
        expect(click.move).to.equal("e9-e8");
        expect(click.complete).to.equal(1);
    });

    it("autocompletes push when only one destination after dot placement", () => {
        const g = new GipfGame(undefined, ["basic"]);
        g.board.clear();
        g.reserve = [5, 5];
        g.currplayer = 1;
        let dot: string | undefined;
        const piece = { owner: 1 as const, kind: "basic" as const };
        for (const node of g.graph.graph.nodes()) {
            if (!g.graph.isDot(node)) {
                continue;
            }
            if (legalPushDestinations(g.board, g.graph, node, piece).length === 1) {
                dot = node;
                break;
            }
        }
        expect(dot).to.not.equal(undefined);
        g.move(dot!, { trusted: true });
        expect(g.moves().length).to.equal(1);
        const only = g.moves()[0]!;
        const blank = g.validateMove("");
        expect(blank.valid).to.equal(true);
        expect(blank.autocomplete).to.equal(only);
        expect(g.validateMove(dot!).autocomplete).to.equal(only);
        expect(blank.complete).to.equal(1);
        const push = g.moves()[0]!;
        expect(g.validateMove(push).complete).to.equal(1);
    });

    it("optional GIPF on capture: instructions and toggle before cap", () => {
        const row = {
            id: "1:e8,e7,e6,e5",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4"],
            core: ["e8", "e7", "e6", "e5"],
        };
        const take = new Set(["e8", "e7", "e6", "e5", "e4"]);
        const g = new GipfGame();
        g.board.clear();
        for (const c of ["e8", "e7", "e6", "e5"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.board.set("e4", { owner: 2, kind: "gipf" });
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 1,
                row,
                optionalGipf: ["e4"],
                take,
                selectionMask: 1,
            },
        } satisfies CapturePending;
        expect(g.moves().sort()).to.deep.equal(["xe8-e4", "xe8-e5"]);
        const empty = g.validateMove("");
        expect(empty.valid).to.equal(false);
        expect(empty.autocomplete).to.equal("xe8-e4");
        expect(empty.complete).to.equal(0);
        expect(g.validateMove("xe8-e5").complete).to.equal(0);
        expect(g.validateMove("xe8-e5").canrender).to.equal(true);
        g.move("xe8-e5", { partial: true });
        expect(g.capturePending).to.not.equal(undefined);
        expect(g.board.has("e4")).to.equal(true);
        const [colE4, rowE4] = g.graph.algebraic2coords("e4");
        const back = g.handleClick("xe8-e5", rowE4, colE4);
        expect(back.move).to.equal("xe8-e4");
        expect(back.complete).to.equal(0);
        g.move("xe8-e4", { partial: true });
        const phaseAfterFull = g.capturePending!.phase;
        expect(phaseAfterFull?.type).to.equal("confirm");
        if (phaseAfterFull?.type === "confirm") {
            expect(formatCaptureMove(row, phaseAfterFull.take)).to.equal("xe8-e4");
        }
        const again = g.handleClick("xe8-e4", rowE4, colE4);
        expect(again.move).to.equal("xe8-e5");
        expect(again.complete).to.equal(0);
        // Playground may update the move box before partial `move()` syncs `phase.take`.
        const withoutPartial = g.handleClick("xe8-e5", rowE4, colE4);
        expect(withoutPartial.move).to.equal("xe8-e4");
        expect(withoutPartial.complete).to.equal(0);
        g.move("xe8-e5");
        expect(g.capturePending).to.equal(undefined);
        expect(g.board.has("e4")).to.equal(true);
        expect(g.board.has("e8")).to.equal(false);
        expect(g.lastmove).to.equal("xe8-e5");
        const caps = g.results.filter((r) => r.type === "capture");
        expect(caps).to.have.length(1);
        expect(caps[0]).to.deep.include({
            how: "gipf-row",
            where: "e8, e7, e6, e5",
            count: 4,
            what: "0",
        });
        const lines: ChatLogLine[] = [];
        expect(g.collectChatLogLine(lines, caps[0]!, { defaultSeat: 1 })).to.equal(true);
        expect(lines).to.have.length(1);
        expect(lines[0]!.textKey).to.equal("apresults:gipf.CAPTURE.rowSummary");
        expect(lines[0]!.textParams?.cells).to.equal("e8, e7, e6, e5");
        expect(lines[0]!.textParams?.ownCount).to.equal(4);
        expect(lines[0]!.textParams?.enemyCount).to.equal(0);
    });

    it("collectChatLogLine EOG uses seat token for winner name substitution", () => {
        const g = new GipfGame();
        g.winner = [1];
        const lines: ChatLogLine[] = [];
        const ctx = { results: [{ type: "eog", reason: "reserve" }], currplayer: 1, defaultSeat: 1, players: ["Alice", "Bob"] };
        expect(g.collectChatLogLine(lines, { type: "eog", reason: "reserve" }, ctx)).to.equal(true);
        const body = formatChatLogLine(lines[0]!, ["Alice", "Bob"], (key, params) => i18next.t(key, params));
        expect(body).to.include("Alice");
        expect(body).to.not.match(/\b1 wins\b/);
    });

    it("formatEogSummary matches move-log EOG line with winner name", () => {
        const g = new GipfGame();
        g.gameover = true;
        g.winner = [1];
        g.stack = [{
            _version: GipfGame.gameinfo.version,
            _results: [
                { type: "eog", reason: "reserve" },
                { type: "winners", players: [1] },
            ],
            _timestamp: new Date(),
            currplayer: 1,
            board: new Map(),
            reserve: [2, 2],
        } as never];
        const names = ["Alice", "Bob"];
        const t = (key: string, params?: Record<string, unknown>): string => i18next.t(key, params);
        expect(g.formatEogSummary(names, t)).to.equal(
            i18next.t("apresults:gipf.EOG.reserve", { player: "Alice" }),
        );
    });

    it("collectChatLogLine counts GIPF pieces as two enemy units", () => {
        const g = new GipfGame();
        const lines: ChatLogLine[] = [];
        expect(
            g.collectChatLogLine(
                lines,
                {
                    type: "capture",
                    how: "gipf-row",
                    where: "e8, e7, e6, e5, e4",
                    count: 4,
                    what: "2",
                    whose: 1,
                },
                { defaultSeat: 1 },
            ),
        ).to.equal(true);
        expect(lines[0]!.textParams?.enemyCount).to.equal(2);
    });

    it("mandatory capture piece click fills full capture notation", () => {
        const row = {
            id: "1:e8,e7,e6,e5",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4"],
            core: ["e8", "e7", "e6", "e5"],
        };
        const take = new Set(["e8", "e7", "e6", "e5"]);
        const g = new GipfGame();
        g.board.clear();
        for (const c of ["e8", "e7", "e6", "e5"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.board.set("e4", { owner: 2, kind: "gipf" });
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 1,
                row,
                optionalGipf: ["e4"],
                take,
                selectionMask: 0,
            },
        } satisfies CapturePending;
        const [col, rowIdx] = g.graph.algebraic2coords("e8");
        const click = g.handleClick("", rowIdx, col);
        expect(click.move).to.equal("xe8-e4");
        expect(click.complete).to.equal(0);
        expect(click.canrender).to.equal(true);
    });

    it("mandatory capture click keeps own optional GIPF off the removal line", () => {
        const row = {
            id: "2:f5,e6,d6,c6",
            lineKey: "b6|c6|d6|e6|f5|g4|h3|i2",
            owner: 2,
            cells: ["f5", "e6", "d6", "c6"],
            core: ["f5", "e6", "d6", "c6"],
        };
        const take = new Set(["e6", "d6", "c6"]);
        const g = new GipfGame();
        g.board.clear();
        g.board.set("f5", { owner: 2, kind: "gipf" });
        for (const c of ["e6", "d6", "c6"] as const) {
            g.board.set(c, { owner: 2, kind: "basic" });
        }
        g.currplayer = 2;
        g.capturePending = {
            causedBy: 2,
            pending: [{ actor: 2, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 2,
                row,
                optionalGipf: ["f5"],
                take,
                selectionMask: 0,
            },
        } satisfies CapturePending;
        const [col, rowIdx] = g.graph.algebraic2coords("e6");
        const click = g.handleClick("", rowIdx, col);
        expect(click.move).to.equal(formatCaptureMove(row, take));
        expect(click.move).to.not.include("f5");
        g.move(click.move, { partial: true });
        const phase = g.capturePending!.phase;
        expect(phase?.type).to.equal("confirm");
        if (phase?.type === "confirm") {
            expect(phase.take.has("f5")).to.equal(false);
            expect(phase.selectionMask).to.equal(0);
        }
    });

    it("capture render highlights only occupied cells pending removal", () => {
        const row: CapturableRow = {
            id: "1:e8,e7,e6,e5",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4"],
            core: ["e8", "e7", "e6", "e5"],
        };
        const take = new Set(["e8", "e7", "e6", "e5"]);
        const g = new GipfGame();
        g.board.clear();
        for (const c of ["e8", "e7", "e6", "e5"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.board.set("e4", { owner: 2, kind: "gipf" });
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 1,
                row,
                optionalGipf: ["e4"],
                take,
                selectionMask: 0,
            },
        };
        const ann = (g.render() as { annotations?: Array<{ type: string; targets: unknown[] }> }).annotations ?? [];
        const exitCells = new Set(
            ann
                .filter((a) => a.type === "exit")
                .flatMap((a) => a.targets)
                .map((t) => g.graph.coords2algebraic((t as { col: number; row: number }).col, (t as { col: number; row: number }).row)),
        );
        expect(exitCells.has("e8")).to.equal(true);
        expect(exitCells.has("e4")).to.equal(false);
        expect(
            ann.some((a) => a.type === "line" && (a.targets as unknown[]).length > 4),
        ).to.equal(false);
        g.move("xe8-e5", { trusted: true });
        const after = (g.render() as { annotations?: Array<{ type: string; targets: unknown[] }> }).annotations ?? [];
        const exitAfter = new Set(
            after
                .filter((a) => a.type === "exit")
                .flatMap((a) => a.targets)
                .map((t) => g.graph.coords2algebraic((t as { col: number; row: number }).col, (t as { col: number; row: number }).row)),
        );
        expect(exitAfter.has("e8")).to.equal(true);
        expect(exitAfter.has("e5")).to.equal(true);
        expect(exitAfter.has("e4")).to.equal(false);
    });

    it("choose-row click fills default x span without parsing x as a dot", () => {
        const rowA: CapturableRow = {
            id: "1:h5,g5,f5,e5",
            lineKey: "a1|b2|c3|d4|e5|f5|g5|h5|i5",
            owner: 1,
            cells: ["h5", "g5", "f5", "e5"],
            core: ["h5", "g5", "f5", "e5"],
        };
        const rowB: CapturableRow = {
            id: "1:f5,e6,d6,c6",
            lineKey: "b6|c6|d6|e6|f5|g4|h3|i2",
            owner: 1,
            cells: ["f5", "e6", "d6", "c6"],
            core: ["f5", "e6", "d6", "c6"],
        };
        const g = new GipfGame();
        g.board.clear();
        for (const c of ["e8", "e7", "e6", "e5", "e4", "e3", "f5", "g5", "h5", "d6", "c6"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [rowA, rowB] }],
            phase: { type: "choose-row", actor: 1, options: [rowA, rowB] },
        };
        expect(g.validateMove("cap:0").valid).to.equal(false);
        expect(g.validateMove("xh5-e5").valid).to.equal(true);
        expect(g.validateMove("xf5-c6").valid).to.equal(true);
        expect(g.moves(1).sort()).to.deep.equal(["xf5-c6", "xh5-e5"]);
        const [colE6, rowE6] = g.graph.algebraic2coords("e6");
        const [colH5, rowH5] = g.graph.algebraic2coords("h5");
        const onB = g.handleClick("", rowE6, colE6);
        expect(onB.valid).to.equal(true);
        expect(onB.move).to.equal("xf5-c6");
        const onA = g.handleClick("", rowH5, colH5);
        expect(onA.valid).to.equal(true);
        expect(onA.move).to.equal("xh5-e5");
    });

    it("choose-row default x span opens confirm before removing pieces", () => {
        const rowA: CapturableRow = {
            id: "1:h5,g5,f5,e5",
            lineKey: "a1|b2|c3|d4|e5|f5|g5|h5|i5",
            owner: 1,
            cells: ["h5", "g5", "f5", "e5"],
            core: ["h5", "g5", "f5", "e5"],
        };
        const rowB: CapturableRow = {
            id: "1:f5,e6,d6,c6",
            lineKey: "b6|c6|d6|e6|f5|g4|h3|i2",
            owner: 1,
            cells: ["f5", "e6", "d6", "c6"],
            core: ["f5", "e6", "d6", "c6"],
        };
        const g = new GipfGame();
        g.board.clear();
        for (const c of ["h5", "g5", "f5", "e5", "e6", "d6", "c6"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [rowA, rowB] }],
            phase: { type: "choose-row", actor: 1, options: [rowA, rowB] },
        };
        const v = g.validateMove("xf5-c6");
        expect(v.valid).to.equal(true);
        expect(v.complete).to.equal(0);
        expect(v.canrender).to.equal(true);
        g.move("xf5-c6", { partial: true, trusted: true });
        expect(g.capturePending?.phase?.type).to.equal("confirm");
        expect(g.board.has("c6")).to.equal(true);
        const ann = (g.render().annotations ?? []).filter((a) => a.type === "exit");
        expect(ann.length).to.be.greaterThan(0);
    });

    it("choose-row capture clears unchosen overlapping rows from the queue", () => {
        const rowVertical: CapturableRow = {
            id: "1:e8,e7,e6,e5,e4,e3",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4", "e3"],
            core: ["e8", "e7", "e6", "e5", "e4", "e3"],
        };
        const rowNw: CapturableRow = {
            id: "1:h5,g5,f5,e5",
            lineKey: "a1|b2|c3|d4|e5|f5|g5|h5|i5",
            owner: 1,
            cells: ["h5", "g5", "f5", "e5"],
            core: ["h5", "g5", "f5", "e5"],
        };
        const rowSw: CapturableRow = {
            id: "1:f5,e6,d6,c6",
            lineKey: "b6|c6|d6|e6|f5|g4|h3|i2",
            owner: 1,
            cells: ["f5", "e6", "d6", "c6"],
            core: ["f5", "e6", "d6", "c6"],
        };
        const g = new GipfGame();
        g.board.clear();
        for (const c of [
            "e8", "e7", "e6", "e5", "e4", "e3",
            "f5", "g5", "h5", "d6", "c6",
        ] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [rowNw, rowSw, rowVertical] }],
            phase: { type: "choose-row", actor: 1, options: [rowNw, rowSw, rowVertical] },
        };
        g.move("xe8-e3", { trusted: true });
        expect(g.capturePending).to.equal(undefined);
        for (const c of rowVertical.cells) {
            expect(g.board.has(c)).to.equal(false);
        }
        expect(g.board.has("h5")).to.equal(true);
        expect(g.board.has("c6")).to.equal(true);
        const ann = (g.render() as { annotations?: Array<{ type: string; targets: unknown[] }> }).annotations ?? [];
        const exitCells = new Set(
            ann
                .filter((a) => a.type === "exit")
                .flatMap((a) => a.targets)
                .map((t) => g.graph.coords2algebraic((t as { col: number; row: number }).col, (t as { col: number; row: number }).row)),
        );
        for (const c of rowVertical.cells) {
            expect(exitCells.has(c)).to.equal(true);
        }
        expect(exitCells.has("h5")).to.equal(false);
        expect(exitCells.has("c6")).to.equal(false);
    });

    it("choose-row full submit removes pieces when confirm has no optional GIPF", () => {
        const row: CapturableRow = {
            id: "1:e8,e7,e6,e5,e4,e3",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4", "e3"],
            core: ["e8", "e7", "e6", "e5", "e4", "e3"],
        };
        const g = new GipfGame();
        g.board.clear();
        for (const c of row.cells) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [row] }],
            phase: { type: "choose-row", actor: 1, options: [row] },
        };
        g.move("xe8-e3", { trusted: true });
        for (const c of row.cells) {
            expect(g.board.has(c)).to.equal(false);
        }
        expect(g.capturePending).to.equal(undefined);
    });

    it("autocompletes compulsory capture when only confirm is legal", () => {
        const graph = new GipfGraph();
        const line = graph.traceLine("b1", graph.dotEntrySteps("b1")[0]!);
        const spots = line.filter((c) => graph.isSpot(c));
        const board = new Map<string, CellPiece>();
        for (let i = 0; i < 4; i++) {
            board.set(spots[i]!, { owner: 1, kind: "basic" });
        }
        const rows = findAllCapturableRows(board, graph);
        expect(rows.length).to.equal(1);
        const row = rows[0]!;
        const g = new GipfGame(undefined, ["basic"]);
        g.board = board;
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 1,
                row,
                optionalGipf: [],
                take: new Set(row.cells),
                selectionMask: 0,
            },
        } satisfies CapturePending;
        const only = listCaptureConfirmMoves(row, [])[0]!;
        expect(g.moves()).to.deep.equal([only]);
        expect(g.validateMove(only).complete).to.equal(1);
        expect(g.validateMove(only).canrender).to.not.equal(true);
        const empty = g.validateMove("");
        expect(empty.valid).to.equal(false);
        expect(empty.autocomplete).to.equal(only);
        expect(empty.complete).to.equal(1);
    });

    it("capture queue runs P1 confirm then P2 on disjoint rows", () => {
        const rows = {
            p1: {
                id: "1:h5,g5,f5,e5",
                lineKey: "a1|b2|c3|d4|e5|f5|g5|h5|i5",
                owner: 1 as const,
                cells: ["h5", "g5", "f5", "e5"],
                core: ["h5", "g5", "f5", "e5"],
            },
            p2: {
                id: "2:h4,g4,f4,e4",
                lineKey: "b1|c2|d3|e4|f4|g4|h4|i4",
                owner: 2 as const,
                cells: ["h4", "g4", "f4", "e4"],
                core: ["h4", "g4", "f4", "e4"],
            },
        };
        const g = new GipfGame(undefined, ["basic"]);
        g.board.clear();
        for (const c of rows.p1.cells) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        for (const c of rows.p2.cells) {
            g.board.set(c, { owner: 2, kind: "basic" });
        }
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [
                { actor: 1, rows: [rows.p1] },
                { actor: 2, rows: [rows.p2] },
            ],
            phase: {
                type: "confirm",
                actor: 1,
                row: rows.p1,
                optionalGipf: [],
                take: new Set(rows.p1.cells),
                selectionMask: 0,
            },
        };
        g.move("xh5-e5", { trusted: true });
        expect(g.currplayer).to.equal(2);
        expect(g.capturePending?.phase?.type).to.equal("confirm");
        expect(g.capturePending?.phase?.actor).to.equal(2);
        expect(g.board.has("h4")).to.equal(true);
        g.move("xh4-e4", { trusted: true });
        expect(g.capturePending).to.equal(undefined);
        expect(g.board.has("h4")).to.equal(false);
    });

    it("after capture caused by opponent push, same seat opens placement", () => {
        const row = {
            id: "1:e6,e5,e4,e3",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e7", "e6", "e5", "e4", "e3", "e2"],
            core: ["e6", "e5", "e4", "e3"],
        };
        const take = new Set(["e7", "e6", "e5", "e3", "e2"]);
        const g = new GipfGame();
        g.board.clear();
        g.board.set("e4", { owner: 1, kind: "gipf" });
        g.board.set("e2", { owner: 2, kind: "basic" });
        for (const c of ["e7", "e6", "e5", "e3"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 2,
            pending: [{ actor: 1, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 1,
                row,
                optionalGipf: ["e4"],
                take,
                selectionMask: 0,
            },
        } satisfies CapturePending;
        const confirm = listCaptureConfirmMoves(row, ["e4"]).find((m) => m.includes("e2"))!;
        g.move(confirm);
        expect(g.capturePending).to.equal(undefined);
        expect(g.currplayer).to.equal(1);
    });

    it("after capture from own push, opponent opens placement", () => {
        const row = {
            id: "1:e8,e7,e6,e5",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4"],
            core: ["e8", "e7", "e6", "e5"],
        };
        const g = new GipfGame();
        g.board.clear();
        for (const c of ["e8", "e7", "e6", "e5"] as const) {
            g.board.set(c, { owner: 1, kind: "basic" });
        }
        g.board.set("e4", { owner: 2, kind: "gipf" });
        g.board.set("h2", { owner: 2, kind: "gipf" });
        g.board.set("h5", { owner: 1, kind: "gipf" });
        g.currplayer = 1;
        g.capturePending = {
            causedBy: 1,
            pending: [{ actor: 1, rows: [row] }],
            phase: {
                type: "confirm",
                actor: 1,
                row,
                optionalGipf: ["e4"],
                take: new Set(["e8", "e7", "e6", "e5", "e4"]),
                selectionMask: 1,
            },
        } satisfies CapturePending;
        g.move("xe8-e4");
        expect(g.gameover).to.equal(false);
        expect(g.currplayer).to.equal(2);
    });
});