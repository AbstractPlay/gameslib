/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { ElOsoGame, type IMoveState, type Stack } from "../../src/games/elOso";
import type { APMoveResult } from "../../src/schemas/moveresults";
import { GameRng } from "../../src/common/rng";
import { assertReplayMatches } from "../../src/common/replay";
import { formatChatLogEntries } from "../../src/common/chat-log";
import { addResource } from "../../src";
import i18next from "i18next";

const SEED = "el-oso-setup-20260827";

function boardToObject(board: Map<string, Stack>): Record<string, Stack> {
    const out: Record<string, Stack> = {};
    for (const [cell, stack] of [...board.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        out[cell] = { ...stack };
    }
    return out;
}

function normalizeStackEntry(entry: IMoveState): Omit<IMoveState, "_timestamp"> & { _timestamp?: undefined } {
    const { _timestamp, board, frames, ...rest } = entry;
    void _timestamp;
    return {
        ...rest,
        board: boardToObject(board) as unknown as Map<string, Stack>,
        frames: frames.map((f) => ({
            ...f,
            board: boardToObject(f.board) as unknown as Map<string, Stack>,
        })),
    };
}

function totalOnBoard(g: ElOsoGame): number {
    let n = 0;
    for (const stack of g.board.values()) {
        n += stack.count;
    }
    return n;
}

function totalBears(g: ElOsoGame): number {
    let onBoard = 0;
    for (const stack of g.board.values()) {
        if (stack.owner === 2) {
            onBoard += stack.count;
        }
    }
    return onBoard + g.cave + g.ground;
}

function setBoard(g: ElOsoGame, entries: Record<string, [1 | 2, number]>): void {
    g.board.clear();
    for (const [cell, [owner, count]] of Object.entries(entries)) {
        g.board.set(cell, { owner, count });
    }
}

describe("El Oso", () => {
    before(() => {
        addResource("en");
    });

    after(() => {
        i18next.removeResourceBundle("en", "apgames");
        i18next.removeResourceBundle("en", "apresults");
    });

    it("same seed produces identical stack[0] opening", () => {
        const a = new ElOsoGame(undefined, SEED);
        const b = new ElOsoGame(undefined, SEED);
        expect(normalizeStackEntry(a.stack[0])).to.deep.equal(normalizeStackEntry(b.stack[0]));
    });

    it("different seeds produce different stack[0] openings", () => {
        const a = new ElOsoGame(undefined, SEED);
        const b = new ElOsoGame(undefined, "other-seed-20260827");
        expect(normalizeStackEntry(a.stack[0]).board).to.not.deep.equal(
            normalizeStackEntry(b.stack[0]).board,
        );
    });

    it("setup places 24 pieces on the board with stacks at most 5 high", () => {
        const g = new ElOsoGame(undefined, SEED);
        expect(totalOnBoard(g)).to.equal(24);
        for (const stack of g.board.values()) {
            expect(stack.count).to.be.at.most(5);
            expect(stack.count).to.be.at.least(1);
        }
        expect(g.stack[0]._results.length).to.be.at.most(22);
        const playerPlaces = g.stack[0]._results.filter(
            (r) => r.type === "place" && (r as { who?: number }).who === 1,
        );
        expect(playerPlaces.every((r) => (r.count ?? 1) >= 1)).to.be.true;
        expect(playerPlaces.some((r) => (r.count ?? 1) > 1)).to.be.true;
        expect(g.sky).to.equal(0);
        expect(g.cave).to.equal(0);
        expect(g.pit).to.equal(0);
        expect(g.ground).to.equal(0);
    });

    it("rejects straight north/south player moves", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a2: [1, 1] });
        const north = g.validateMove("a2-a3");
        expect(north.valid).to.be.false;
        const south = g.validateMove("a2-a1");
        expect(south.valid).to.be.false;
    });

    it("allows lateral and diagonal moves within stack height", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { c3: [1, 2] });
        const lateral = g.validateMove("c3-b3");
        expect(lateral.valid).to.be.true;
        const diag = g.validateMove("c3-d4");
        expect(diag.valid).to.be.true;
        const tooFar = g.validateMove("c3-c1");
        expect(tooFar.valid).to.be.false;
    });

    it("allows sky moves only from the top row", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a5: [1, 2], a1: [1, 1] });
        expect(g.validateMove("a5-sky").valid).to.be.true;
        expect(g.validateMove("a1-sky").valid).to.be.false;
    });

    it("partial stack selection sets canrender for playground interim preview", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { c3: [1, 2] });
        const partial = g.validateMove("c3");
        expect(partial.valid).to.be.true;
        expect(partial.complete).to.equal(-1);
        expect(partial.canrender).to.be.true;
    });

    it("partial move shows destination dots and a north buffer for sky", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { c3: [1, 2], a5: [1, 1] });
        g.move("c3", { partial: true });
        const mid = g.render().at(-1)!;
        const midDots = (mid.annotations ?? []).filter((a) => a.type === "dots");
        expect(midDots.length).to.equal(2);
        expect(mid.board.buffer).to.be.undefined;
        const boardDests = g.moves()
            .filter((m) => m.startsWith("c3-") && !m.endsWith("-pass") && !m.endsWith("-sky"))
            .map((m) => m.split("-")[1]!);
        expect(boardDests.length).to.be.greaterThan(0);

        g.move("a5", { partial: true });
        const top = g.render().at(-1)!;
        expect(top.board.buffer?.show).to.deep.equal(["N"]);
        const topDots = (top.annotations ?? []).filter((a) => a.type === "dots");
        expect(topDots.length).to.equal(2);
        const topTargets = topDots.flatMap((a) => ("targets" in a ? a.targets : []));
        expect(topTargets.some((t) => t.col === 1 && t.row === 1)).to.be.true;
        expect(topTargets.some((t) => t.col === 1 && t.row === 0)).to.be.true;
    });

    it("renders stacks as numbered pieces when nums display is selected", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a1: [1, 3], b5: [2, 2] });
        const stacked = g.render().at(-1)!;
        expect(stacked.renderer).to.equal("stacking-offset");
        expect(stacked.pieces).to.include("AAA");

        const nums = g.render({ altDisplay: "nums" }).at(-1)!;
        expect(nums.renderer).to.equal("default");
        expect(nums.pieces).to.include("pA3");
        expect(nums.pieces).to.include("pB2");
        expect(nums.legend?.pA3).to.deep.equal([
            { name: "piece", colour: 1 },
            { text: "3" },
        ]);
    });

    it("buffer click completes a sky move from the selected top-row stack", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a5: [1, 2] });
        const result = g.handleClick("a5", -1, -1);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("a5-sky");
    });

    it("partial help omits Sky except on the top row", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { c3: [1, 1] });
        expect(g.validateMove("c3").message).to.equal(
            i18next.t("apgames:validation.elOso.VALID_PARTIAL"),
        );
        setBoard(g, { a5: [1, 1] });
        expect(g.validateMove("a5").message).to.equal(
            i18next.t("apgames:validation.elOso.VALID_PARTIAL_TOP"),
        );
    });

    it("autocompletes when a stack can only pass", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, {
            c3: [1, 1],
            b2: [2, 1],
            b3: [2, 1],
            b4: [2, 1],
            c2: [2, 1],
            c4: [2, 1],
            d2: [2, 1],
            d3: [2, 1],
            d4: [2, 1],
        });
        expect(g.moves()).to.deep.equal(["c3-pass"]);
        expect(g.validateMove("c3").autocomplete).to.equal("c3-pass");
        const click = g.handleClick("", 2, 2);
        expect(click.move).to.equal("c3-pass");
        expect(click.complete).to.equal(1);
    });

    it("enables automove", () => {
        expect(ElOsoGame.gameinfo.flags).to.include("automove");
    });

    it("disables explore mode", () => {
        expect(ElOsoGame.gameinfo.flags).to.include("no-explore");
    });

    it("emulation previews the player move without running the bear phase", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { c3: [1, 2], a5: [2, 1] });
        g.saveState();
        const counterBefore = g.rng!.getCounter();
        g.move("c3-b3", { emulation: true });
        expect(g.board.get("b3")?.owner).to.equal(1);
        expect(g.results).to.have.length(1);
        expect(g.results[0]?.type).to.equal("_group");
        expect((g.results[0] as { who?: number }).who).to.equal(1);
        expect(g.frames).to.have.length(1);
        expect(g.rng!.getCounter()).to.equal(counterBefore);
        g.load(-1);
        expect(g.board.has("b3")).to.be.false;
        expect(g.board.get("c3")?.count).to.equal(2);
    });

    it("lists legal player moves for random move", () => {
        const g = new ElOsoGame(undefined, SEED);
        const moves = g.moves();
        expect(moves.length).to.be.greaterThan(0);
        for (const m of moves) {
            const v = g.validateMove(m);
            expect(v.valid).to.be.true;
            expect(v.complete).to.equal(1);
        }
        expect(moves.some((m) => m.endsWith("-pass"))).to.be.true;
        expect(moves).to.include(g.randomMove());
    });

    it("moving to sky scores and removes player pieces from the board", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a5: [1, 3] });
        g.move("a5-sky", { trusted: true });
        expect(g.sky).to.equal(3);
        expect(g.playerPiecesOnBoard()).to.equal(0);
        expect(g.gameover).to.be.true;
        expect(g.getPlayerScore(1)).to.equal(3);
        expect(g.getPlayerGrade(1)).to.equal("loss");
    });

    it("grades wins at 10, 11, and 12 sky pieces", () => {
        const g10 = new ElOsoGame(undefined, SEED);
        g10.sky = 10;
        g10.gameover = true;
        expect(g10.getPlayerGrade(1)).to.equal("win");

        const g11 = new ElOsoGame(undefined, SEED);
        g11.sky = 11;
        g11.gameover = true;
        expect(g11.getPlayerGrade(1)).to.equal("superior");

        const g12 = new ElOsoGame(undefined, SEED);
        g12.sky = 12;
        g12.gameover = true;
        expect(g12.getPlayerGrade(1)).to.equal("excellent");
    });

    it("bear capture annihilates pairwise into pit and cave", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a5: [2, 1], a4: [1, 1] });
        if (g.rng === undefined) {
            throw new Error("expected rng");
        }
        g.rng.randomInt = () => 1;
        g.move("a4-pass", { trusted: true });
        expect(g.pit).to.equal(1);
        expect(g.cave).to.equal(1);
        expect(g.board.has("a4")).to.be.false;
    });

    it("merges bear stacks when moving south onto another bear stack", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a1: [1, 1], b3: [2, 2], b4: [2, 3] });
        if (g.rng === undefined) {
            throw new Error("expected rng");
        }
        g.rng.randomInt = () => 2;
        g.move("a1-pass", { trusted: true });
        expect(g.board.get("b3")).to.deep.equal({ owner: 2, count: 5 });
        expect(g.board.has("b4")).to.be.false;
        expect(totalBears(g)).to.equal(5);
    });

    it("merges bear stacks with no height limit", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a1: [1, 1], b3: [2, 4], b4: [2, 3] });
        if (g.rng === undefined) {
            throw new Error("expected rng");
        }
        g.rng.randomInt = () => 2;
        g.move("a1-pass", { trusted: true });
        expect(g.board.get("b3")).to.deep.equal({ owner: 2, count: 7 });
        expect(g.cave).to.equal(0);
        expect(totalBears(g)).to.equal(7);
    });

    it("conserves bear pieces across a multi-die bear phase", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { a1: [1, 3], b2: [2, 2], b3: [2, 2], b4: [2, 2] });
        expect(totalBears(g)).to.equal(6);
        if (g.rng === undefined) {
            throw new Error("expected rng");
        }
        g.rng.randomInt = () => 2;
        g.move("a1-pass", { trusted: true });
        expect(totalBears(g)).to.equal(6);
    });

    it("keeps results and frames aligned after a move", () => {
        const g = new ElOsoGame(undefined, SEED);
        g.move("c1-pass", { trusted: true });
        const top = g.stack[g.stack.length - 1];
        expect(top.frames.length).to.equal(top._results.length);
        expect(g.render().length).to.equal(top.frames.length + 1);
    });

    it("replays committed moves from a challenge seed", () => {
        const moves = ["c1-pass", "d1-pass"];
        const golden = new ElOsoGame(undefined, SEED);
        for (const m of moves) {
            golden.move(m, { trusted: true });
        }
        assertReplayMatches(
            (seed?: string) => new ElOsoGame(undefined, seed),
            SEED,
            moves,
            golden.stack,
        );
    });

    it("runSetup is deterministic for a fixed rng stream", () => {
        const rng1 = new GameRng(SEED);
        const a = ElOsoGame.runSetup(rng1);
        const rng2 = new GameRng(SEED);
        const b = ElOsoGame.runSetup(rng2);
        expect(boardToObject(a.board)).to.deep.equal(boardToObject(b.board));
        expect(a.results).to.deep.equal(b.results);
    });

    it("setup results are player block then bear block with section headers", () => {
        const { results } = ElOsoGame.runSetup(new GameRng(SEED));
        expect(results[0]).to.deep.equal({ type: "announce", payload: ["playerSetup"] });
        expect(results[1]?.type).to.equal("roll");
        expect((results[1] as { who?: number }).who).to.equal(1);
        const firstPlayerPlace = results.findIndex(
            (r) => r.type === "place" && (r as { who?: number }).who === 1,
        );
        expect(firstPlayerPlace).to.be.greaterThan(1);
        const bearHeaderIdx = results.findIndex(
            (r) => r.type === "announce" && (r.payload as string[])[0] === "bearSetup",
        );
        expect(bearHeaderIdx).to.be.greaterThan(firstPlayerPlace);
        expect(results[bearHeaderIdx + 1]?.type).to.equal("roll");
        expect((results[bearHeaderIdx + 1] as { who?: number }).who).to.equal(2);
        const firstBearPlace = results.findIndex(
            (r) => r.type === "place" && (r as { who?: number }).who === 2,
        );
        expect(firstBearPlace).to.be.greaterThan(bearHeaderIdx + 1);
    });

    it("setup chat log lists each roll before its placements", () => {
        const g = new ElOsoGame(undefined, SEED);
        const lines = g.chatLogEntries(["Alice"]).flatMap((e) => e.lines);
        const rollIndices = lines
            .map((line, idx) => (/rolled/i.test(line.textKey) || line.textKey.includes("ROLL.elOso") ? idx : -1))
            .filter((idx) => idx >= 0);
        expect(rollIndices.length).to.equal(2);
        for (const rollIdx of rollIndices) {
            const next = lines[rollIdx + 1];
            expect(next).to.exist;
            expect(next!.textKey).to.include("PLACE.elOso");
        }
    });

    it("setup chat log includes grouped dice rolls for player and bear", () => {
        const g = new ElOsoGame(undefined, SEED);
        const formatted = formatChatLogEntries(
            g.chatLogEntries(["Alice"]),
            ["Alice"],
            (key, params) => i18next.t(key, params),
        );
        expect(formatted.filter((line) => /rolled/i.test(line)).length).to.equal(2);
    });

    it("setup placement counts include home-column seed and match board stacks", () => {
        const g = new ElOsoGame(undefined, SEED);
        for (const who of [1, 2] as const) {
            const places = g.stack[0]._results.filter(
                (r) => r.type === "place" && (r as { who?: number }).who === who,
            ) as Array<{ where?: string; count?: number }>;
            const reported = places.reduce((sum, r) => sum + (r.count ?? 1), 0);
            expect(reported).to.equal(12);
            for (const r of places) {
                expect(g.board.get(r.where!)?.count).to.equal(r.count ?? 1);
            }
            for (let col = 0; col < 5; col++) {
                const cell = ElOsoGame.homeCell(who, col);
                const stack = g.board.get(cell);
                expect(stack).to.exist;
                const reportedAtCell = places.find((r) => r.where === cell);
                expect(reportedAtCell).to.exist;
                expect(reportedAtCell!.count).to.equal(stack!.count);
            }
        }
    });

    it("bear phase reports roll at start of the primary bear group", () => {
        const g = new ElOsoGame(undefined, SEED);
        g.move("c1-pass", { trusted: true });
        const ply = g.stack[g.stack.length - 1];
        expect(ply._results.length).to.be.at.least(2);
        const bearGroups = ply._results.filter(
            (r): r is Extract<APMoveResult, { type: "_group" }> => r.type === "_group" && r.who === 2,
        );
        expect(bearGroups.length).to.be.at.least(1);
        expect(bearGroups[0]!.results[0].type).to.equal("roll");
    });

    it("rain from ground adds a frame per placement", () => {
        const g = new ElOsoGame(undefined, SEED);
        setBoard(g, { c1: [1, 1] });
        if (g.rng === undefined) {
            throw new Error("expected rng");
        }
        g.rng.randomInt = () => 1;
        g.ground = 2;
        g.move("c1-pass", { trusted: true });
        const ply = g.stack[g.stack.length - 1];
        const bearGroups = ply._results.filter((r) => r.type === "_group" && r.who === 2);
        expect(bearGroups.length).to.be.greaterThan(1);
        expect(bearGroups[0]!.type).to.equal("_group");
        if (bearGroups[0]!.type === "_group") {
            expect(bearGroups[0].results[0].type).to.equal("roll");
        }
        for (let i = 1; i < bearGroups.length; i++) {
            const group = bearGroups[i]!;
            if (group.type !== "_group") {
                continue;
            }
            expect(group.results[0]?.type).to.equal("roll");
            expect(group.results.every((r, idx) => idx === 0 || r.type === "place" || r.type === "capture")).to.be.true;
        }
        expect(ply.frames.length).to.equal(ply._results.length);
    });

    it("chatLogEntries attributes bear moves to label actor, not seat 2", () => {
        const g = new ElOsoGame(undefined, SEED);
        g.move("c1-pass", { trusted: true });
        const entries = g.chatLogEntries(["Alice"]);
        const lines = entries.flatMap((e) => e.lines);
        const bearLines = lines.filter((l) => l.actor.kind === "label");
        const seat2Lines = lines.filter((l) => l.actor.kind === "seat" && l.actor.seat === 2);
        expect(bearLines.length).to.be.greaterThan(0);
        expect(seat2Lines).to.have.length(0);
        for (const line of bearLines) {
            if (line.actor.kind === "label") {
                expect(line.actor.key).to.equal("apresults:ACTOR.elOso.bear");
            }
        }
        const playerLines = lines.filter((l) => l.actor.kind === "seat" && l.actor.seat === 1);
        expect(playerLines.length).to.be.greaterThan(0);
        for (const line of playerLines) {
            expect(line.textParams?.player).to.equal("Player 1");
        }
    });

    it("chatLog does not attribute bear lines to the human display name", () => {
        const g = new ElOsoGame(undefined, SEED);
        g.move("c1-pass", { trusted: true });
        const log = g.chatLog(["Alice"]).flatMap((node) => node.slice(1));
        const bearLabel = i18next.t("apresults:ACTOR.elOso.bear");
        const bearLines = log.filter((line) => line.includes(bearLabel));
        expect(bearLines.length).to.be.greaterThan(0);
        for (const line of bearLines) {
            expect(line).to.not.include("Alice");
        }
    });

    it("formatChatLogEntries includes bear dice roll text", () => {
        const g = new ElOsoGame(undefined, SEED);
        g.move("c1-pass", { trusted: true });
        expect(i18next.t("apresults:ROLL.elOso", { dice: "4, 5" })).to.equal("The Bear rolled: 4, 5.");
        const formatted = formatChatLogEntries(
            g.chatLogEntries(),
            ["Alice"],
            (key, params) => i18next.t(key, params),
        );
        expect(formatted.some((line) => /rolled/i.test(line))).to.be.true;
        const log = g.chatLog(["Alice"]).flatMap((node) => node.slice(1));
        expect(log.some((line) => /rolled/i.test(line))).to.be.true;
    });

    it("frameCaptionLines includes roll on the bear dice frame", () => {
        const g = new ElOsoGame(undefined, SEED);
        g.move("c1-pass", { trusted: true });
        const rollFrame = g.results.findIndex(
            (r) => r.type === "_group" && r.who === 2 && r.results[0]?.type === "roll",
        );
        expect(rollFrame).to.be.at.least(1);
        const lines = g.frameCaptionLines(rollFrame + 1);
        const formatted = formatChatLogEntries(
            [{ timestamp: "", lines }],
            ["Alice"],
            (key, params) => i18next.t(key, params),
        );
        expect(formatted.some((line) => /rolled/i.test(line))).to.be.true;
    });

    it("formatChatLogEntries substitutes only seat-actor player tokens", () => {
        const g = new ElOsoGame(undefined, SEED);
        const formatted = formatChatLogEntries(
            g.chatLogEntries(),
            ["Alice"],
            (key, params) => i18next.t(key, params),
        );
        expect(formatted.some((line) => line.includes("Alice"))).to.be.true;
        const bearLabel = i18next.t("apresults:ACTOR.elOso.bear");
        const bearFormatted = formatted.filter((line) => line.includes(bearLabel));
        expect(bearFormatted.length).to.be.greaterThan(0);
        for (const line of bearFormatted) {
            expect(line).to.not.include("Alice");
        }
    });
});
