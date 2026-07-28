/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { CanoeGame, CubeFace } from "../../src/games/canoe";

type StackCell = [string, { owner: 1 | 2; face: CubeFace; set?: boolean }];

function playFixture(
    board: StackCell[],
    opts: {
        currplayer?: 1 | 2;
        roll?: [number, number] | [number];
        firstPlayer?: 1 | 2;
        pocket?: [number, number];
        variants?: string[];
        canoeDone?: boolean;
        phase?: "setup-1" | "setup-2" | "play";
        setupRoll?: CubeFace[];
    } = {},
): CanoeGame {
    const state = {
        game: "canoe",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [] as number[],
        stack: [{
            _version: "20260725",
            _results: [],
            _timestamp: "2026-07-25T00:00:00.000Z",
            currplayer: opts.currplayer ?? 1,
            phase: opts.phase ?? "play",
            board: {
                dataType: "Map",
                value: board.map(([cell, stack]) => [cell, {...stack, set: stack.set ?? false}]),
            },
            roll: opts.roll,
            setupRoll: opts.setupRoll,
            gridCubes: [16, 8] as [CubeFace, CubeFace],
            pocket: opts.pocket ?? [0, 0],
            canoeDone: opts.canoeDone ?? false,
            firstPlayer: opts.firstPlayer ?? 1,
        }],
    };
    return new CanoeGame(JSON.stringify(state));
}

function clickCell(cell: string): [number, number] {
    const [col, row] = CanoeGame.algebraic2coords(cell);
    return [row, col];
}

function incompleteTurnFixture(): CanoeGame {
    return playFixture([
        ["d6", {owner: 1, face: 8}],
        ["e6", {owner: 1, face: 1}],
        ["e5", {owner: 2, face: 1}],
        ["g7", {owner: 2, face: 16, set: true}],
        ["c7", {owner: 1, face: 40}],
        ["d4", {owner: 1, face: 32}],
    ], {roll: [6, 3], currplayer: 2, canoeDone: true});
}

function playAfterOpening(
    board: StackCell[],
    opts: { roll?: [number, number] | [number]; currplayer?: 1 | 2; variants?: string[]; canoeDone?: boolean; pocket?: [number, number] } = {},
): CanoeGame {
    const prior = {
        _version: "20260725",
        _results: [],
        _timestamp: "2026-07-25T00:00:00.000Z",
        currplayer: 2 as const,
        phase: "play" as const,
        board: {dataType: "Map", value: [] as StackCell[]},
        gridCubes: [16, 8] as [CubeFace, CubeFace],
        pocket: [0, 0] as [number, number],
        canoeDone: false,
        firstPlayer: 1 as const,
        lastmove: "pass",
    };
    const state = {
        game: "canoe",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [] as number[],
        stack: [
            prior,
            {...prior, currplayer: 2, lastmove: "pass"},
            {...prior, currplayer: 1, lastmove: "pass"},
            {
                ...prior,
                currplayer: opts.currplayer ?? 1,
                board: {dataType: "Map", value: board.map(([cell, stack]) => [cell, {...stack, set: stack.set ?? false}])},
                roll: opts.roll ?? [2, 3],
                pocket: opts.pocket ?? [0, 0],
                canoeDone: opts.canoeDone ?? false,
                lastmove: undefined,
            },
        ],
    };
    return new CanoeGame(JSON.stringify(state));
}

function annotationDotCells(rep: ReturnType<CanoeGame["render"]>): string[] {
    const cells: string[] = [];
    for (const a of rep.annotations ?? []) {
        if ("type" in a && a.type === "dots" && "targets" in a) {
            for (const t of a.targets) {
                cells.push(CanoeGame.coords2algebraic(t.col, t.row));
            }
        }
    }
    return cells;
}

function annotationMoveSegments(rep: ReturnType<CanoeGame["render"]>): number {
    return (rep.annotations ?? []).filter(a => "type" in a && a.type === "move").length;
}

function moveResultHow(g: CanoeGame, from: string, to: string): string | undefined {
    const move = g.results.find(r => r.type === "move" && r.from === from && r.to === to) as {how?: string} | undefined;
    return move?.how;
}

describe("Canoe", () => {
    before(() => {
        addResource("en");
    });

    it("rotateFace wraps on even and odd dice", () => {
        expect(CanoeGame.rotateFace(40, 2)).to.equal(1);
        expect(CanoeGame.rotateFace(1, 3)).to.equal(40);
        expect(CanoeGame.rotateFace(8, 4)).to.equal(16);
        expect(CanoeGame.rotateFace(16, 5)).to.equal(8);
    });

    it("scoreFace treats 1 as zero points", () => {
        expect(CanoeGame.scoreFace(1)).to.equal(0);
        expect(CanoeGame.scoreFace(24)).to.equal(24);
    });

    it("setup moves() returns empty list", () => {
        const g = playFixture([], {phase: "setup-1", setupRoll: [1, 8, 16, 24, 32, 40]});
        expect(g.moves()).to.eql([]);
    });

    it("setup validateMove rejects invalid bank cells", () => {
        const g = playFixture([], {phase: "setup-1", setupRoll: [8, 16, 24, 32, 40, 1]});
        const bad = g.validateMove("8@a1");
        expect(bad.valid).to.be.false;
    });

    it("setup validateMove accepts six placements with complete 0", () => {
        const g = playFixture([], {phase: "setup-1", setupRoll: [8, 16, 24, 32, 40, 1]});
        const move = "8@b1,16@c1,24@d1,32@b2,40@c2,1@d2";
        const v = g.validateMove(move);
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(0);
    });

    it("setup click on occupied cell removes placement", () => {
        const g = playFixture([], {phase: "setup-1", setupRoll: [8, 16, 24, 32, 40, 1]});
        const [row, col] = clickCell("b1");
        const result = g.handleClick("8@b1", row, col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("");
    });

    it("setup click empty cell auto-places highest unplaced die", () => {
        const g = playFixture([], {phase: "setup-1", setupRoll: [8, 16, 24, 32, 40, 1]});
        const [row, col] = clickCell("c1");
        const result = g.handleClick("", row, col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("40@c1");
    });

    it("setup hand shows every die even when face values repeat", () => {
        const g = playFixture([], {phase: "setup-2", currplayer: 2, setupRoll: [8, 8, 16, 16, 24, 32]});
        const hand = g.render().areas?.find(a => a.type === "pieces");
        expect(hand?.type).to.equal("pieces");
        if (hand?.type === "pieces") {
            expect(hand.pieces).to.have.length(6);
            expect(hand.pieces).to.eql(["S0", "S1", "S2", "S3", "S4", "S5"]);
        }
        g.lastmove = "8@f4,16@g4";
        const handAfter = g.render().areas?.find(a => a.type === "pieces");
        expect(handAfter?.type).to.equal("pieces");
        if (handAfter?.type === "pieces") {
            expect(handAfter.pieces).to.have.length(4);
            expect(handAfter.pieces).to.eql(["S1", "S3", "S4", "S5"]);
        }
    });

    it("setup hand ignores prior player's lastmove at start of setup-2", () => {
        const state = {
            game: "canoe",
            numplayers: 2,
            variants: [],
            gameover: false,
            winner: [] as number[],
            stack: [{
                _version: "20260725",
                _results: [{type: "place", where: "c7"}],
                _timestamp: "2026-07-27T23:55:30.398Z",
                currplayer: 2 as const,
                phase: "setup-2" as const,
                board: {
                    dataType: "Map",
                    value: [
                        ["d1", {owner: 1, face: 40, set: false}],
                        ["c1", {owner: 1, face: 32, set: false}],
                        ["b1", {owner: 1, face: 32, set: false}],
                        ["b2", {owner: 1, face: 16, set: false}],
                        ["c2", {owner: 1, face: 8, set: false}],
                        ["d2", {owner: 1, face: 1, set: false}],
                        ["c7", {owner: 1, face: 16, set: false}],
                    ],
                },
                setupRoll: [16, 32, 1, 40, 8, 16] as CubeFace[],
                gridCubes: [16, 1] as [CubeFace, CubeFace],
                pocket: [0, 0] as [number, number],
                canoeDone: false,
                lastmove: "40@d1,32@c1,32@b1,16@b2,8@c2,1@d2",
            }],
        };
        const g = new CanoeGame(JSON.stringify(state));
        const hand = g.render().areas?.find(a => a.type === "pieces");
        expect(hand?.type).to.equal("pieces");
        if (hand?.type === "pieces") {
            expect(hand.pieces).to.have.length(6);
            expect(hand.pieces).to.eql(["S0", "S1", "S2", "S3", "S4", "S5"]);
        }
    });

    it("setup click ignores prior player's lastmove in move string", () => {
        const state = {
            game: "canoe",
            numplayers: 2,
            variants: [],
            gameover: false,
            winner: [] as number[],
            stack: [{
                _version: "20260725",
                _results: [{type: "place", where: "c7"}],
                _timestamp: "2026-07-27T23:55:30.398Z",
                currplayer: 2 as const,
                phase: "setup-2" as const,
                board: {
                    dataType: "Map",
                    value: [
                        ["d1", {owner: 1, face: 40, set: false}],
                        ["c1", {owner: 1, face: 32, set: false}],
                        ["b1", {owner: 1, face: 32, set: false}],
                        ["b2", {owner: 1, face: 16, set: false}],
                        ["c2", {owner: 1, face: 8, set: false}],
                        ["d2", {owner: 1, face: 1, set: false}],
                        ["c7", {owner: 1, face: 16, set: false}],
                    ],
                },
                setupRoll: [16, 32, 1, 40, 8, 16] as CubeFace[],
                gridCubes: [16, 1] as [CubeFace, CubeFace],
                pocket: [0, 0] as [number, number],
                canoeDone: false,
                lastmove: "40@d1,32@c1,32@b1,16@b2,8@c2,1@d2",
            }],
        };
        const g = new CanoeGame(JSON.stringify(state));
        const [f4Row, f4Col] = clickCell("f4");
        const result = g.handleClick("40@d1,32@c1,32@b1,16@b2,8@c2,1@d2", f4Row, f4Col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("40@f4");
    });

    it("play-phase dice render on f2 and g1", () => {
        const g = playFixture([["c7", {owner: 1, face: 16}]], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const rep = g.render();
        const pstr = rep.pieces as string;
        expect(pstr).to.include("D3");
        expect(pstr).to.include("D5");
        const [f2Col, f2Row] = CanoeGame.algebraic2coords("f2");
        const [g1Col, g1Row] = CanoeGame.algebraic2coords("g1");
        const boardRows = pstr.split("\n");
        expect(boardRows[f2Row].split(",")[f2Col]).to.equal("D3");
        expect(boardRows[g1Row].split(",")[g1Col]).to.equal("D5");
    });

    it("clicking a die stores selection in the move string", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const [f2Row, f2Col] = clickCell("f2");
        const byCell = g.handleClick("", f2Row, f2Col);
        expect(byCell.valid).to.be.true;
        expect(byCell.move).to.equal("3:");
        const byPiece = g.handleClick("", -1, -1, "D5");
        expect(byPiece.valid).to.be.true;
        expect(byPiece.move).to.equal("5:");
    });

    it("clicking a die after the first half begins the second half", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const twoHalf = g.moves().find(m => m.includes(","));
        expect(twoHalf).to.not.equal(undefined);
        const firstHalf = twoHalf!.split(",")[0];
        const [g1Row, g1Col] = clickCell("g1");
        const result = g.handleClick(firstHalf, g1Row, g1Col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal(`${firstHalf},5:`);
    });

    it("partial die selection does not throw on move", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        expect(() => g.move("3:", {partial: true})).to.not.throw();
        expect((g as unknown as {partialMove?: string}).partialMove).to.equal("3:");
    });

    it("partial die selection renders both dice visible", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        g.move("3:", {partial: true});
        const rep = g.render();
        const pstr = rep.pieces as string;
        const [f2Col, f2Row] = CanoeGame.algebraic2coords("f2");
        const [g1Col, g1Row] = CanoeGame.algebraic2coords("g1");
        const boardRows = pstr.split("\n");
        expect(boardRows[f2Row].split(",")[f2Col]).to.equal("D3");
        expect(boardRows[g1Row].split(",")[g1Col]).to.equal("D5");
    });

    it("load clears partial move ephemerals for dice rendering", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const twoHalf = g.moves().find(m => m.includes(","));
        expect(twoHalf).to.not.equal(undefined);
        const firstHalf = twoHalf!.split(",")[0];
        g.move(`${firstHalf},5:`, {partial: true});
        g.load();
        const rep = g.render();
        const pstr = rep.pieces as string;
        expect(pstr).to.not.include("U3");
        expect(pstr).to.include("D3");
        expect(pstr).to.include("D5");
    });

    it("partial from-only move sets destination highlights", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        g.move("3:e5", {partial: true});
        const rep = g.render();
        expect(rep.annotations?.some(a => "type" in a && a.type === "dots")).to.be.true;
    });

    it("partial from-only move previews rotated cube face", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        g.move("3:e5", {partial: true});
        const rep = g.render();
        const pstr = rep.pieces as string;
        const [e5Col, e5Row] = CanoeGame.algebraic2coords("e5");
        const boardRows = pstr.split("\n");
        expect(boardRows[e5Row].split(",")[e5Col]).to.equal("A8");
    });

    it("partial from-only move shows enter annotation on selected cube", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        g.move("3:e5", {partial: true});
        const rep = g.render();
        const [e5Col, e5Row] = CanoeGame.algebraic2coords("e5");
        expect(rep.annotations?.some(a => {
            if (!("type" in a) || a.type !== "enter" || !("targets" in a)) {
                return false;
            }
            return a.targets.some(t => t.row === e5Row && t.col === e5Col);
        })).to.be.true;
    });

    it("destination dots exclude false set targets after rotation", () => {
        const g = playAfterOpening([
            ["e5", {owner: 1, face: 16}],
            ["d5", {owner: 1, face: 1}],
        ], {roll: [3, 5]});
        g.move("3:e5", {partial: true});
        const dots = annotationDotCells(g.render());
        expect(dots).to.not.include("d5");
    });

    it("clicking a valid set target completes set formation", () => {
        const g = playAfterOpening([
            ["e5", {owner: 1, face: 40}],
            ["d5", {owner: 1, face: 1}],
        ], {roll: [2, 3]});
        const [d5Row, d5Col] = clickCell("d5");
        g.handleClick("3:", d5Row, d5Col);
        const [e5Row, e5Col] = clickCell("e5");
        const result = g.handleClick("3:d5", e5Row, e5Col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("3:d5+e5,2:");
    });

    it("set can jump over opponent toward pin", () => {
        const g = playAfterOpening([
            ["c3", {owner: 1, face: 40, set: true}],
            ["b3", {owner: 2, face: 1}],
        ], {roll: [3], currplayer: 1});
        expect(g.moves().some(m => m === "3:c3-b2" || m === "3:c3-a1")).to.be.true;
    });

    it("set cannot move to a cell farther from bear-off", () => {
        const g = playAfterOpening([
            ["a3", {owner: 1, face: 40, set: true}],
        ], {roll: [1, 2], currplayer: 1});
        expect(g.moves().some(m => m.includes("a3-a5") || m.includes("a3-a7"))).to.be.false;
        expect(g.moves().some(m => m.includes("a3-c2") || m.includes("a3-b1"))).to.be.true;
    });

    it("set cannot dilly-dally in the bank without approaching bear-off", () => {
        const g = playAfterOpening([
            ["d2", {owner: 1, face: 40, set: true}],
        ], {roll: [1], currplayer: 1});
        expect(g.moves().some(m => m.includes("d2-c2"))).to.be.false;
        expect(g.moves().some(m => m.includes("d2-e2"))).to.be.true;
    });

    it("set must maximize bear-off progress among destinations for a die", () => {
        const g = playAfterOpening([
            ["c7", {owner: 1, face: 16}],
            ["c4", {owner: 1, face: 40}],
            ["e6", {owner: 2, face: 40}],
            ["c6", {owner: 2, face: 1}],
            ["e4", {owner: 1, face: 16}],
            ["c5", {owner: 1, face: 16}],
            ["b4", {owner: 1, face: 24}],
            ["g3", {owner: 2, face: 8, set: true}],
        ], {roll: [5, 5], currplayer: 1, canoeDone: true, pocket: [64, 40]});
        expect(g.moves().some(m => m === "5:b4+e4,5:e4-a2")).to.be.true;
        expect(g.moves().some(m => m === "5:b4+e4,5:e4-a3")).to.be.false;
        g.move("5:b4+e4,5:e4", {partial: true, trusted: true});
        const dots = annotationDotCells(g.render());
        expect(dots).to.include("a2");
        expect(dots).to.not.include("a3");
    });

    it("undo restores cubes mutated during partial set formation", () => {
        const g = playAfterOpening([
            ["c7", {owner: 1, face: 16}],
            ["c4", {owner: 1, face: 40}],
            ["e6", {owner: 2, face: 40}],
            ["c6", {owner: 2, face: 1}],
            ["e4", {owner: 1, face: 16}],
            ["c5", {owner: 1, face: 16}],
            ["b4", {owner: 1, face: 24}],
            ["g3", {owner: 2, face: 8, set: true}],
        ], {roll: [5, 5], currplayer: 1, canoeDone: true, pocket: [64, 40]});
        g.move("5:b4+e4,5:e4-a2", {trusted: true});
        g.undo();
        g.load();
        expect(g.board.get("b4")).to.eql({owner: 1, face: 24, set: false});
        expect(g.board.get("e4")).to.eql({owner: 1, face: 16, set: false});
    });

    it("partial set formation does not mutate the saved stack entry", () => {
        const g = playAfterOpening([
            ["c7", {owner: 1, face: 16}],
            ["c4", {owner: 1, face: 40}],
            ["e6", {owner: 2, face: 40}],
            ["c6", {owner: 2, face: 1}],
            ["e4", {owner: 1, face: 16}],
            ["c5", {owner: 1, face: 16}],
            ["b4", {owner: 1, face: 24}],
            ["g3", {owner: 2, face: 8, set: true}],
        ], {roll: [5, 5], currplayer: 1, canoeDone: true, pocket: [64, 40]});
        g.move("5:b4+e4", {partial: true, trusted: true});
        const saved = g.stack[g.stack.length - 1].board.get("b4");
        expect(saved).to.eql({owner: 1, face: 24, set: false});
        expect(g.stack[g.stack.length - 1].board.get("e4")).to.eql({owner: 1, face: 16, set: false});
    });

    it("set formed on pin row can bear off with full-path die on second half", () => {
        const g = playAfterOpening([
            ["e7", {owner: 2, face: 16}],
            ["d6", {owner: 2, face: 8}],
            ["g5", {owner: 2, face: 1}],
        ], {roll: [2, 6], currplayer: 2});
        expect(g.moves().some(m => m === "2:d6+e7,6:e7-off")).to.be.true;
        g.move("2:d6+e7,6:e7-off", {trusted: true});
        expect(g.board.has("e7")).to.be.false;
        expect(g.canoeDone).to.be.true;
        expect(g.pocket[1]).to.equal(32);
    });

    it("highlights bear-off canoe cell when set can score from pin row", () => {
        const g = playAfterOpening([
            ["e7", {owner: 2, face: 16}],
            ["d6", {owner: 2, face: 8}],
            ["g5", {owner: 2, face: 1}],
        ], {roll: [2, 6], currplayer: 2});
        g.move("2:d6+e7,6:e7", {partial: true, trusted: true});
        const dots = annotationDotCells(g.render());
        expect(dots).to.include("g2");
    });

    it("set must bear off rather than stall on launch cell when die allows exit", () => {
        const board: StackCell[] = [
            ["b1", {owner: 1, face: 24}],
            ["c1", {owner: 1, face: 16}],
            ["d1", {owner: 1, face: 16}],
            ["c2", {owner: 1, face: 8}],
            ["f6", {owner: 2, face: 40}],
            ["g5", {owner: 2, face: 1}],
            ["g6", {owner: 2, face: 1}],
            ["a5", {owner: 2, face: 8}],
            ["e5", {owner: 1, face: 24}],
            ["a4", {owner: 1, face: 24, set: true}],
            ["d4", {owner: 2, face: 8}],
            ["c3", {owner: 2, face: 40, set: true}],
        ];
        const g = playAfterOpening(board, {roll: [4, 6], currplayer: 1});
        expect(g.moves().some(m => m === "4:d1-e4,6:a4-off")).to.be.true;
        expect(g.moves().some(m => m === "4:d1-e4,6:a4-e1")).to.be.false;
        g.move("4:d1-e4,6:a4", {partial: true, trusted: true});
        const dots = annotationDotCells(g.render());
        expect(dots).to.include("f1");
        expect(dots).to.not.include("e1");
        expect(g.moves().some(m => m.startsWith("6:a4-off"))).to.be.true;
        expect(g.moves().some(m => m === "4:d1-e4,6:a4-e1")).to.be.false;
    });

    it("cube moved in first half cannot move again in second half", () => {
        const g = playAfterOpening([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {roll: [3, 5], currplayer: 1});
        expect(g.moves().some(m => m.startsWith("3:e5-d") && m.includes(",5:e5"))).to.be.false;
        expect(g.moves().some(m => m.startsWith("3:e5-d") && m.includes(",5:c7"))).to.be.true;
    });

    it("set formed in first half may move again in second half", () => {
        const g = playAfterOpening([
            ["e5", {owner: 1, face: 40}],
            ["d5", {owner: 1, face: 1}],
            ["c7", {owner: 1, face: 8}],
        ], {roll: [2, 3], currplayer: 1});
        expect(g.moves().some(m => m.startsWith("3:d5+e5,2:e5-"))).to.be.true;
        expect(g.moves().some(m => m.startsWith("3:d5+e5,2:d5"))).to.be.false;
    });

    it("clicking a different friendly cube reselects when set is not possible", () => {
        const g = playAfterOpening([
            ["e5", {owner: 1, face: 16}],
            ["e4", {owner: 1, face: 24}],
        ], {roll: [3, 5]});
        const [e5Row, e5Col] = clickCell("e5");
        g.handleClick("3:", e5Row, e5Col);
        const [e4Row, e4Col] = clickCell("e4");
        const result = g.handleClick("3:e5", e4Row, e4Col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("3:e4");
    });

    it("completing first half auto-starts second die", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const twoHalf = g.moves().find(m => m.includes(","));
        expect(twoHalf).to.not.equal(undefined);
        const firstHalf = twoHalf!.split(",")[0];
        const dest = firstHalf.split("-")[1];
        const [destRow, destCol] = clickCell(dest);
        const [e5Row, e5Col] = clickCell("e5");
        g.handleClick("3:", e5Row, e5Col);
        const result = g.handleClick(`3:e5`, destRow, destCol);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal(`${firstHalf},5:`);
    });

    it("render dims used die after first half partial", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const twoHalf = g.moves().find(m => m.includes(","));
        expect(twoHalf).to.not.equal(undefined);
        const firstHalf = twoHalf!.split(",")[0];
        g.move(`${firstHalf},5:`, {partial: true});
        const rep = g.render();
        const pstr = rep.pieces as string;
        const [f2Col, f2Row] = CanoeGame.algebraic2coords("f2");
        const [g1Col, g1Row] = CanoeGame.algebraic2coords("g1");
        const boardRows = pstr.split("\n");
        expect(boardRows[f2Row].split(",")[f2Col]).to.equal("U3");
        expect(boardRows[g1Row].split(",")[g1Col]).to.equal("D5");
    });

    it("validateMove autocompletes remaining die after first complete half", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const firstHalf = g.moves().find(m => m.includes(","))!.split(",")[0];
        const result = g.validateMove(firstHalf);
        expect(result.valid).to.be.true;
        expect(result.autocomplete).to.equal(`${firstHalf},5:`);
    });

    it("render dims used die after first half without trailing die prefix", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const firstHalf = g.moves().find(m => m.includes(","))!.split(",")[0];
        g.move(firstHalf, {partial: true});
        expect(g.roll).to.eql([3, 5]);
        const rep = g.render();
        const pstr = rep.pieces as string;
        const [f2Col, f2Row] = CanoeGame.algebraic2coords("f2");
        const [g1Col, g1Row] = CanoeGame.algebraic2coords("g1");
        const boardRows = pstr.split("\n");
        expect(boardRows[f2Row].split(",")[f2Col]).to.equal("U3");
        expect(boardRows[g1Row].split(",")[g1Col]).to.equal("D5");
    });

    it("single complete half without partial does not end turn early", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const firstHalf = g.moves().find(m => m.includes(","))!.split(",")[0];
        g.move(firstHalf, {trusted: true});
        expect(g.currplayer).to.equal(1);
        expect(g.roll).to.eql([3, 5]);
    });

    it("completed turn does not dim dice for next player", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const full = g.moves().find(m => m.includes(","));
        expect(full).to.not.equal(undefined);
        g.move(full!, {trusted: true});
        const rep = g.render();
        const pstr = rep.pieces as string;
        expect(pstr).to.not.include("U3");
        expect(pstr).to.not.include("U5");
    });

    it("combined die selection without set moves is invalid", () => {
        const g = playFixture([["e5", {owner: 1, face: 16}]], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const result = g.validateMove("3+5:");
        expect(result.valid).to.be.false;
    });

    it("combined-dice set moves use dice-sum notation", () => {
        const g = playFixture([
            ["c5", {owner: 1, face: 40, set: true}],
            ["g3", {owner: 2, face: 16, set: true}],
            ["e6", {owner: 2, face: 1}],
        ], {roll: [3, 4], currplayer: 1, canoeDone: true});
        expect(g.moves()).to.eql(["3+4:c5-c2", "3+4:c5-b1"]);
        expect(g.validateMove("3:").valid).to.be.true;
        expect(g.validateMove("3+4:").valid).to.be.true;
        expect(g.validateMove("4+3:").valid).to.be.true;
        const [f2Row, f2Col] = clickCell("f2");
        const die3 = g.handleClick("", f2Row, f2Col);
        expect(die3.valid).to.be.true;
        expect(die3.move).to.equal("3:");
        const [g1Row, g1Col] = clickCell("g1");
        const both = g.handleClick(die3.move, g1Row, g1Col);
        expect(both.valid).to.be.true;
        expect(both.move).to.equal("3+4:");
        const g2 = playFixture([
            ["c5", {owner: 1, face: 40, set: true}],
            ["g3", {owner: 2, face: 16, set: true}],
            ["e6", {owner: 2, face: 1}],
        ], {roll: [3, 4], currplayer: 1, canoeDone: true});
        const die4 = g2.handleClick("", g1Row, g1Col);
        expect(die4.move).to.equal("4:");
        const bothReverse = g2.handleClick(die4.move, f2Row, f2Col);
        expect(bothReverse.valid).to.be.true;
        expect(bothReverse.move).to.equal("4+3:");
    });

    it("handleClick die then cube followed by partial move does not throw", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {phase: "play", roll: [3, 5], firstPlayer: 1});
        const [f2Row, f2Col] = clickCell("f2");
        const dieResult = g.handleClick("", f2Row, f2Col);
        expect(() => g.move(dieResult.move, {partial: true})).to.not.throw();
        const [e5Row, e5Col] = clickCell("e5");
        const cubeResult = g.handleClick(dieResult.move, e5Row, e5Col);
        expect(() => g.move(cubeResult.move, {partial: true})).to.not.throw();
        expect(cubeResult.move).to.equal("3:e5");
    });

    it("single-cube movement generates legal full-turn combinations", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["c7", {owner: 1, face: 8}],
        ], {roll: [1, 1]});
        expect(g.moves().length).to.be.greaterThan(0);
        expect(g.moves().some(m => m.includes("e5-d5") || m.includes("e5-d6"))).to.be.true;
    });

    it("pinch adds opponent face to pocket", () => {
        const g = playFixture([
            ["e5", {owner: 1, face: 16}],
            ["d5", {owner: 2, face: 24}],
        ], {roll: [2], firstPlayer: 1});
        g.move("2:e5xd5", {trusted: true});
        expect(g.pocket[0]).to.equal(24);
        expect(g.board.has("e5")).to.be.false;
        expect(g.board.has("d5")).to.be.true;
        expect(g.board.get("d5")!.owner).to.equal(1);
        const convertIdx = g.results.findIndex(r => r.type === "convert");
        const moveIdx = g.results.findIndex(r => r.type === "move");
        const captureIdx = g.results.findIndex(r => r.type === "capture");
        const deltaIdx = g.results.findIndex(r => r.type === "deltaScore" && (r as {delta: number}).delta === 24);
        expect(convertIdx).to.be.greaterThan(-1);
        expect(moveIdx).to.be.greaterThan(convertIdx);
        expect(captureIdx).to.be.greaterThan(moveIdx);
        expect(deltaIdx).to.be.greaterThan(captureIdx);
    });

    it("grid cube cannot move back into bank", () => {
        const g = playAfterOpening([["a3", {owner: 1, face: 16}]], {roll: [1, 1], currplayer: 1});
        expect(g.moves().some(m => m.includes("a3-a2") || m.includes("a3-a1"))).to.be.false;
    });

    it("cannot create a set on a bank cell", () => {
        const g = playAfterOpening([
            ["a3", {owner: 1, face: 16}],
            ["a2", {owner: 1, face: 8}],
        ], {roll: [1, 1], currplayer: 1});
        expect(g.moves().some(m => m.startsWith("1:a3+a2"))).to.be.false;
    });

    it("cannot form a set by leaving the bank onto another cube", () => {
        const g = playAfterOpening([
            ["b1", {owner: 1, face: 40}],
            ["b2", {owner: 1, face: 8}],
            ["d1", {owner: 1, face: 1}],
            ["c1", {owner: 1, face: 1}],
            ["c7", {owner: 1, face: 8}],
            ["c6", {owner: 1, face: 8}],
            ["b5", {owner: 1, face: 40}],
            ["f6", {owner: 2, face: 32}],
            ["g4", {owner: 2, face: 16}],
            ["g5", {owner: 2, face: 16}],
            ["g6", {owner: 2, face: 1}],
            ["a5", {owner: 2, face: 8}],
            ["e5", {owner: 2, face: 16}],
            ["e4", {owner: 2, face: 16}],
        ], {roll: [5, 5], currplayer: 1});
        expect(g.moves().some(m => m.includes("c1+b5"))).to.be.false;
    });

    it("cannot form a set with a cube that left the bank earlier this turn", () => {
        const g = playAfterOpening([
            ["d2", {owner: 1, face: 1}],
            ["b4", {owner: 1, face: 24}],
            ["e4", {owner: 1, face: 16}],
        ], {roll: [5, 5], currplayer: 1, canoeDone: true});
        g.move("5:d2-b5", {partial: true, trusted: true});
        expect(g.moves().some(m => m.includes("b4+e4"))).to.be.true;
        expect(g.moves().some(m => m.includes("b5+") || m.includes("+b5"))).to.be.false;
    });

    it("allows set formation with a cube that left the bank on a prior turn", () => {
        const g = playAfterOpening([
            ["b5", {owner: 1, face: 40}],
            ["b4", {owner: 1, face: 24}],
            ["e4", {owner: 1, face: 16}],
            ["b1", {owner: 1, face: 40}],
            ["f6", {owner: 2, face: 32}],
        ], {roll: [5, 5], currplayer: 1, canoeDone: true});
        expect(g.moves().some(m => m.includes("b4+e4"))).to.be.true;
    });

    it("existing set can move from grid into bank through pin", () => {
        const g = playAfterOpening([["a4", {owner: 1, face: 8, set: true}]], {roll: [1, 1], currplayer: 1});
        expect(g.moves().some(m => m.includes("a2"))).to.be.true;
    });

    it("set cannot enter home bank except through pin", () => {
        const g = playAfterOpening([["b4", {owner: 1, face: 8, set: true}]], {roll: [2, 3], currplayer: 1});
        expect(g.moves().some(m => m.includes("b2"))).to.be.false;
    });

    it("grid cube cannot enter opponent bank", () => {
        const g = playAfterOpening([["e5", {owner: 1, face: 16}]], {roll: [1, 1], currplayer: 1});
        expect(g.moves().some(m => m.includes("f5"))).to.be.false;
    });

    it("regular move emits convert before move with cube value", () => {
        const g = playFixture([["e5", {owner: 1, face: 16}]], {roll: [3], firstPlayer: 1});
        const move = g.moves().find(m => m.includes("e5-d"));
        expect(move).to.not.equal(undefined);
        g.move(move!, {trusted: true});
        const convertIdx = g.results.findIndex(r => r.type === "convert");
        const moveIdx = g.results.findIndex(r => r.type === "move");
        expect(convertIdx).to.be.greaterThan(-1);
        expect(moveIdx).to.be.greaterThan(convertIdx);
        const moveResult = g.results[moveIdx] as {type: "move"; what?: string; from: string; to: string};
        expect(moveResult.what).to.not.equal(undefined);
    });

    it("render has no set outline markers", () => {
        const g = playFixture([["c4", {owner: 1, face: 8, set: true}]], {roll: [2, 3]});
        const rep = g.render();
        expect(JSON.stringify(rep)).to.not.include('"type":"outline"');
    });

    it("set formation and combined-dice move", () => {
        const prior = {
            _version: "20260725",
            _results: [],
            _timestamp: "2026-07-25T00:00:00.000Z",
            currplayer: 2,
            phase: "play" as const,
            board: {dataType: "Map", value: [] as StackCell[]},
            gridCubes: [16, 8] as [CubeFace, CubeFace],
            pocket: [0, 0] as [number, number],
            canoeDone: false,
            firstPlayer: 1 as const,
            lastmove: "pass",
        };
        const board: StackCell[] = [
            ["c4", {owner: 1, face: 8}],
            ["e4", {owner: 1, face: 16}],
        ];
        const state = {
            game: "canoe",
            numplayers: 2,
            variants: [] as string[],
            gameover: false,
            winner: [] as number[],
            stack: [
                prior,
                {...prior, currplayer: 2, lastmove: "pass"},
                {...prior, currplayer: 1, lastmove: "pass"},
                {
                    ...prior,
                    currplayer: 1,
                    board: {dataType: "Map", value: board.map(([cell, stack]) => [cell, {...stack, set: stack.set ?? false}])},
                    roll: [2, 3] as [number, number],
                },
            ],
        };
        const g = new CanoeGame(JSON.stringify(state));
        g.move("2:c4+e4", {trusted: true});
        expect(g.board.get("e4")?.set).to.be.true;
        expect(g.board.has("c4")).to.be.false;
        expect(g.results.some(r => r.type === "promote")).to.be.true;
        expect(g.results.some(r => r.type === "move" && r.from === "c4" && r.to === "e4")).to.be.true;
        const rep = g.render();
        expect(annotationMoveSegments(rep)).to.be.greaterThan(0);

        const g2 = playFixture([["c4", {owner: 1, face: 8, set: true}]], {roll: [2, 3]});
        expect(g2.moves().some(m => m.startsWith("2+3:"))).to.be.true;
    });

    describe("move path annotations", () => {
        it("records multi-cell how for indirect single-cube routes", () => {
            const g = playFixture([["e5", {owner: 1, face: 16}]], {roll: [3]});
            expect(g.moves()).to.include("3:e5-c4");
            g.move("3:e5-c4", {trusted: true});
            const how = moveResultHow(g, "e5", "c4");
            expect(how).to.not.equal(undefined);
            expect(how!.split(",").length).to.be.at.least(3);
            expect(annotationMoveSegments(g.render())).to.be.greaterThan(1);
        });

        it("records multi-cell how for set slides with turns or jumps", () => {
            const g = playAfterOpening([
                ["c7", {owner: 1, face: 16}],
                ["c4", {owner: 1, face: 40}],
                ["e6", {owner: 2, face: 40}],
                ["c6", {owner: 2, face: 1}],
                ["e4", {owner: 1, face: 16}],
                ["c5", {owner: 1, face: 16}],
                ["b4", {owner: 1, face: 24}],
                ["g3", {owner: 2, face: 8, set: true}],
            ], {roll: [5, 5], currplayer: 1, canoeDone: true, pocket: [64, 40]});
            g.move("5:b4+e4,5:e4-a2", {trusted: true});
            const setSlide = moveResultHow(g, "e4", "a2");
            expect(setSlide).to.not.equal(undefined);
            expect(setSlide!.split(",").length).to.be.at.least(3);
            expect(annotationMoveSegments(g.render())).to.be.greaterThan(2);
        });

        it("renders one arrow for adjacent single-step moves", () => {
            const g = playFixture([["e5", {owner: 1, face: 16}]], {roll: [1]});
            g.move("1:e5-d5", {trusted: true});
            expect(moveResultHow(g, "e5", "d5")).to.equal("e5,d5");
            expect(annotationMoveSegments(g.render())).to.equal(1);
        });
    });

    it("stymie offers roll buttons and no auto-roll moves", () => {
        const g = playFixture([
            ["c3", {owner: 1, face: 8}],
            ["c6", {owner: 1, face: 8}],
        ]);
        expect(g.isStymieEligible()).to.be.true;
        expect(g.roll).to.equal(undefined);
        expect(g.moves()).to.eql([]);
        const buttons = g.getButtons();
        expect(buttons.map(b => b.move)).to.eql(["roll:1", "roll:2"]);
    });

    it("stymie roll:1 enables single-die moves", () => {
        const g = playFixture([
            ["c3", {owner: 1, face: 8}],
            ["c5", {owner: 1, face: 8}],
        ]);
        g.move("roll:1", {trusted: true});
        expect(g.roll).to.not.equal(undefined);
        expect(g.roll!.length).to.equal(1);
        expect(g.moves().length).to.be.greaterThan(0);
        expect(g.moves().every(m => !m.includes(","))).to.be.true;
    });

    it("pass is only valid with an empty move string and no legal moves", () => {
        const g = playFixture([["c3", {owner: 2, face: 8}]], {roll: [1, 2], currplayer: 1});
        expect(g.moves()).to.eql(["pass"]);
        expect(g.validateMove("pass").valid).to.be.true;
        expect(g.validateMove("1:a1-a2").valid).to.be.false;
    });

    it("bearing off scores with canoe first-bear-off rule", () => {
        const g = playFixture([["a2", {owner: 1, face: 8, set: true}]], {roll: [2]});
        g.move("2:a2-off", {trusted: true});
        expect(g.canoeDone).to.be.true;
        expect(g.pocket[0]).to.equal(16);
        expect(g.board.size).to.equal(0);
    });

    it("canoe bonus applies only to the first bear-off of the game", () => {
        const g = playFixture([["a3", {owner: 2, face: 8, set: true}]], {roll: [2], currplayer: 2, canoeDone: true});
        g.move("2:a3-off", {trusted: true});
        expect(g.pocket[1]).to.equal(8);
    });

    it("no-canoe variant scores only one cube on first set bear-off", () => {
        const g = playFixture([["a2", {owner: 1, face: 8, set: true}]], {roll: [2], variants: ["no-canoe"]});
        g.move("2:a2-off", {trusted: true});
        expect(g.canoeDone).to.be.true;
        expect(g.pocket[0]).to.equal(8);
    });

    it("leaky-canoe variant scores half of one cube on first bear-off", () => {
        const g = playFixture([["a2", {owner: 1, face: 8, set: true}]], {roll: [2], variants: ["leaky-canoe"]});
        g.move("2:a2-off", {trusted: true});
        expect(g.canoeDone).to.be.true;
        expect(g.pocket[0]).to.equal(4);
    });

    it("getPlayerScore returns pocketed points", () => {
        const g = playFixture([["a2", {owner: 1, face: 8, set: true}]], {roll: [2]});
        g.move("2:a2-off", {trusted: true});
        expect(g.getPlayerScore(1)).to.equal(g.pocket[0]);
        expect(g.getPlayerScore(1)).to.equal(16);
    });

    it("incomplete turn explains both dice must be used", () => {
        const g = incompleteTurnFixture();
        const result = g.validateMove("3:e5");
        expect(result.valid).to.be.false;
        expect(result.message).to.include("both dice");
    });

    it("final set bear-off may use one die when it clears the board", () => {
        const g = playAfterOpening([
            ["g3", {owner: 2, face: 16, set: true}],
            ["e6", {owner: 2, face: 1}],
            ["b1", {owner: 1, face: 40, set: true}],
        ], {roll: [5, 4], currplayer: 1, canoeDone: true, pocket: [80, 72]});
        expect(g.moves()).to.eql(["4:b1-off"]);
        expect(g.validateMove("4:b1-off").valid).to.be.true;
        g.move("4:b1-off", {trusted: true});
        expect(g.gameover).to.be.true;
        expect(g.board.has("g3")).to.be.false;
        expect(g.board.has("e6")).to.be.false;
    });

    it("seventh cube must move toward bear-off", () => {
        const seventh = playFixture([
            ["a3", {owner: 1, face: 40}],
            ["e6", {owner: 2, face: 1}],
        ], {roll: [1], canoeDone: true});
        expect(seventh.moves()).to.eql(["pass"]);
        const twoCubes = playFixture([
            ["a3", {owner: 1, face: 40}],
            ["c7", {owner: 1, face: 8}],
            ["e6", {owner: 2, face: 1}],
        ], {roll: [1], canoeDone: true});
        expect(twoCubes.moves().some(m => m === "1:a3-b3" || m === "1:a3-a4")).to.be.true;
    });

    it("seventh cube may use both dice as separate moves with rotation", () => {
        const g = playFixture([
            ["b3", {owner: 1, face: 40}],
            ["g3", {owner: 2, face: 16}],
        ], {roll: [2, 1], canoeDone: true});
        expect(g.moves()).to.include("1:b3-a3,2:a3-off");
        expect(g.moves().some(m => m.includes("+"))).to.be.false;
    });

    it("seventh cube single-die bear-off ends the game", () => {
        const g = playAfterOpening([
            ["a3", {owner: 1, face: 40}],
            ["e6", {owner: 2, face: 1}],
        ], {roll: [1, 2], currplayer: 1, canoeDone: true, pocket: [80, 72]});
        expect(g.moves()).to.eql(["2:a3-off"]);
        g.move("2:a3-off", {trusted: true});
        expect(g.gameover).to.be.true;
        expect(g.board.has("e6")).to.be.false;
    });

    it("die-only partial remains valid when a full turn exists", () => {
        const g = incompleteTurnFixture();
        expect(g.validateMove("3:").valid).to.be.true;
    });

    it("illegal opponent cube selection still reports invalid move", () => {
        const g = incompleteTurnFixture();
        const result = g.validateMove("3:c7");
        expect(result.valid).to.be.false;
        expect(result.message).to.not.include("both dice");
    });

    it("handleClick reports both-dice message for incomplete turn", () => {
        const g = incompleteTurnFixture();
        const [g1Row, g1Col] = clickCell("g1");
        const dieResult = g.handleClick("", g1Row, g1Col);
        const [e5Row, e5Col] = clickCell("e5");
        const result = g.handleClick(dieResult.move, e5Row, e5Col);
        expect(result.valid).to.be.false;
        expect(result.message).to.include("both dice");
    });

    it("move list uses from-to keys without path duplicates", () => {
        const g = playFixture([["c3", {owner: 1, face: 16}]], {roll: [3, 4]});
        const halves = new Set<string>();
        for (const m of g.moves()) {
            for (const half of m.split(",")) {
                halves.add(half.replace(/^\d+:/, ""));
            }
        }
        expect(halves.size).to.equal([...halves].length);
    });

    it("emulated replay does not push stack or re-roll", () => {
        const g = playAfterOpening([
            ["b1", {owner: 1, face: 24}],
            ["c1", {owner: 1, face: 16}],
            ["d1", {owner: 1, face: 16}],
            ["d2", {owner: 1, face: 16}],
            ["c2", {owner: 1, face: 8}],
            ["c7", {owner: 1, face: 24}],
            ["f6", {owner: 2, face: 40}],
            ["f5", {owner: 2, face: 16}],
            ["f4", {owner: 2, face: 8}],
            ["g4", {owner: 2, face: 1}],
            ["g5", {owner: 2, face: 1}],
            ["g6", {owner: 2, face: 1}],
            ["a5", {owner: 2, face: 8}],
            ["b2", {owner: 1, face: 40}],
        ], {roll: [3, 5], currplayer: 1});
        const stackLen = g.stack.length;
        const rollBefore = [...g.roll!] as [number, number];
        g.move("5:b2-b5,6:d2-e5", {trusted: true, emulation: true});
        expect(g.stack.length).to.equal(stackLen);
        expect(g.roll).to.eql(rollBefore);
        expect(g.currplayer).to.equal(1);
    });

    it("syncFromStackEntry restores deterministic fields after emulated move", () => {
        const g = playAfterOpening([
            ["b1", {owner: 1, face: 24}],
            ["c1", {owner: 1, face: 16}],
            ["d1", {owner: 1, face: 16}],
            ["c2", {owner: 1, face: 8}],
            ["c7", {owner: 1, face: 24}],
            ["f6", {owner: 2, face: 40}],
            ["f5", {owner: 2, face: 16}],
            ["f4", {owner: 2, face: 8}],
            ["g4", {owner: 2, face: 1}],
            ["g5", {owner: 2, face: 1}],
            ["g6", {owner: 2, face: 1}],
            ["a5", {owner: 2, face: 8}],
            ["b5", {owner: 1, face: 32}],
            ["e5", {owner: 1, face: 24}],
        ], {roll: [3, 5], currplayer: 1});
        const ref = new CanoeGame(JSON.stringify({
            game: "canoe",
            numplayers: 2,
            variants: [],
            gameover: false,
            winner: [],
            stack: [{
                _version: "20260725",
                _results: [],
                _timestamp: "2026-07-25T00:00:00.000Z",
                currplayer: 2,
                phase: "play",
                board: {
                    dataType: "Map",
                    value: [
                        ["b1", {owner: 1, face: 24, set: false}],
                        ["c1", {owner: 1, face: 16, set: false}],
                        ["d1", {owner: 1, face: 16, set: false}],
                        ["c2", {owner: 1, face: 8, set: false}],
                        ["c7", {owner: 1, face: 24, set: false}],
                        ["f6", {owner: 2, face: 40, set: false}],
                        ["f5", {owner: 2, face: 16, set: false}],
                        ["g5", {owner: 2, face: 1, set: false}],
                        ["g6", {owner: 2, face: 1, set: false}],
                        ["a5", {owner: 2, face: 8, set: false}],
                        ["b5", {owner: 1, face: 32, set: false}],
                        ["e5", {owner: 1, face: 24, set: false}],
                        ["d5", {owner: 2, face: 1, set: false}],
                        ["c3", {owner: 2, face: 40, set: false}],
                    ],
                },
                roll: [3, 4],
                gridCubes: [24, 8],
                pocket: [0, 0],
                canoeDone: false,
                firstPlayer: 1,
                lastmove: "3:f4-d5,5:g4-c3",
            }],
        }));
        g.move("3:f4-d5,5:g4-c3", {trusted: true, emulation: true});
        g.syncFromStackEntry(ref.stack[0]);
        expect(g.currplayer).to.equal(2);
        expect(g.roll).to.eql([3, 4]);
        expect(g.board.get("c3")).to.eql({owner: 2, face: 40, set: false});
    });

    it("constructor deep-clones stack entries so engines do not share boards", () => {
        const boardValue: StackCell[] = [["b1", {owner: 1, face: 24}]];
        const entry = {
            _version: "20260725",
            _results: [],
            _timestamp: "2026-07-25T00:00:00.000Z",
            currplayer: 1 as const,
            phase: "play" as const,
            board: {dataType: "Map", value: boardValue.map(([cell, stack]) => [cell, {...stack, set: stack.set ?? false}])},
            roll: [3, 5] as [number, number],
            gridCubes: [24, 8] as [CubeFace, CubeFace],
            pocket: [0, 0] as [number, number],
            canoeDone: false,
            firstPlayer: 1 as const,
        };
        const state = {
            game: "canoe",
            numplayers: 2,
            variants: [],
            gameover: false,
            winner: [] as (1 | 2)[],
            stack: [entry, {...entry, currplayer: 2 as const}],
        };
        const g1 = new CanoeGame(JSON.stringify(state));
        const g2 = new CanoeGame(JSON.stringify(state));
        g1.load(0);
        g1.board.set("c1", {owner: 1, face: 16, set: false});
        g2.load(0);
        expect(g2.board.has("c1")).to.be.false;
    });

    it("emulated replay of P2 turn preserves currplayer and roll from reference stack", () => {
        const preMoveBoard: StackCell[] = [
            ["b1", {owner: 1, face: 24}],
            ["c1", {owner: 1, face: 16}],
            ["d1", {owner: 1, face: 16}],
            ["c2", {owner: 1, face: 8}],
            ["f6", {owner: 2, face: 40}],
            ["f5", {owner: 2, face: 16}],
            ["g5", {owner: 2, face: 1}],
            ["g6", {owner: 2, face: 1}],
            ["a5", {owner: 2, face: 8}],
            ["e5", {owner: 1, face: 24}],
            ["a4", {owner: 1, face: 24, set: true}],
            ["d5", {owner: 2, face: 1}],
            ["c3", {owner: 2, face: 40}],
        ];
        const postMoveBoard: StackCell[] = [
            ["b1", {owner: 1, face: 24}],
            ["c1", {owner: 1, face: 16}],
            ["d1", {owner: 1, face: 16}],
            ["c2", {owner: 1, face: 8}],
            ["f6", {owner: 2, face: 40}],
            ["g5", {owner: 2, face: 1}],
            ["g6", {owner: 2, face: 1}],
            ["a5", {owner: 2, face: 8}],
            ["e5", {owner: 1, face: 24}],
            ["a4", {owner: 1, face: 24, set: true}],
            ["d4", {owner: 2, face: 8}],
            ["c3", {owner: 2, face: 40, set: true}],
        ];
        const base = {
            _version: "20260725",
            _results: [] as object[],
            _timestamp: "2026-07-25T00:00:00.000Z",
            gridCubes: [24, 8] as [CubeFace, CubeFace],
            pocket: [0, 0] as [number, number],
            canoeDone: false,
            firstPlayer: 1 as const,
        };
        const stack = [
            {...base, currplayer: 2 as const, phase: "play" as const, board: {dataType: "Map", value: preMoveBoard.map(([cell, s]) => [cell, {...s, set: s.set ?? false}])}, roll: [3, 3] as [number, number], lastmove: "3:b5+c7,4:c7-a4"},
            {...base, currplayer: 1 as const, phase: "play" as const, board: {dataType: "Map", value: postMoveBoard.map(([cell, s]) => [cell, {...s, set: s.set ?? false}])}, roll: [4, 6] as [number, number], lastmove: "3:f5-d4,3:d5+c3"},
        ];
        const state = {game: "canoe", numplayers: 2, variants: [], gameover: false, winner: [] as (1 | 2)[], stack};
        const replay = new CanoeGame(JSON.stringify({...state, stack: [stack[0]]}));
        replay.move("3:f5-d4,3:d5+c3", {trusted: true, emulation: true});
        const postEntry = new CanoeGame(JSON.stringify(state));
        postEntry.load(1);
        replay.syncFromStackEntry(postEntry.stack[1]);
        expect(replay.currplayer).to.equal(1);
        expect(replay.roll).to.eql([4, 6]);
        expect(replay.board.get("d4")).to.eql({owner: 2, face: 8, set: false});
        expect(replay.board.get("c3")).to.eql({owner: 2, face: 40, set: true});
    });
});
