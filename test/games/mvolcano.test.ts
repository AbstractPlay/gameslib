/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { MvolcanoGame, CellContents } from "../../src/games/mvolcano";
import type { IScores } from "../../src/games/_base";
import { isStructuredRenderLabel } from "../../src/common/render-label";
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";

function findScores(scores: IScores[], key: string): IScores {
    const found = scores.find((s) => isStructuredRenderLabel(s.name) && s.name.textKey === key);
    expect(found, key).to.not.be.undefined;
    return found!;
}

function colours(entry: unknown): number[] {
    expect(entry).to.be.an("array");
    return (entry as { kind: "sheet"; name: string; colour: number }[]).map((v) => {
        expect(v).to.deep.equal({ kind: "sheet", name: "piece", colour: v.colour });
        return v.colour;
    });
}

describe("Mega-Volcano", () => {
    describe("sidebarScores", () => {
        it("lists every colour as uncaptured and no pyramids captured at the start", () => {
            const scores = new MvolcanoGame().sidebarScores();
            expect(scores).to.have.lengthOf(3);
            expect(findScores(scores, "apgames:status.SCORES").spoiler).to.not.equal(true);

            const uncaptured = findScores(scores, "apgames:status.mvolcano.UNCAPTUREDCOLOURS");
            expect(uncaptured.spoiler).to.be.true;
            expect(colours(uncaptured.scores[0])).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(colours(uncaptured.scores[1])).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);

            const captured = findScores(scores, "apgames:status.mvolcano.PYRAMIDSCAPTURED");
            expect(captured.spoiler).to.be.true;
            expect(captured.scores).to.deep.equal([0, 0]);
        });

        it("drops captured colours in palette order and counts white pyramids", () => {
            const g = new MvolcanoGame();
            g.captured = [
                [["RD", 1], ["WH", 2], ["GN", 3], ["RD", 2]] as CellContents[],
                [["BN", 1]] as CellContents[],
            ];
            const scores = g.sidebarScores();

            const uncaptured = findScores(scores, "apgames:status.mvolcano.UNCAPTUREDCOLOURS");
            expect(colours(uncaptured.scores[0])).to.deep.equal([2, 4, 5, 6, 7]);
            expect(colours(uncaptured.scores[1])).to.deep.equal([1, 2, 3, 4, 5, 6]);

            const captured = findScores(scores, "apgames:status.mvolcano.PYRAMIDSCAPTURED");
            expect(captured.scores).to.deep.equal([4, 1]);
        });
    });
});

describe("Mega-Volcano frames", () => {
    const uniformBoard = () => {
        const board: CellContents[][][] = [];
        for (let row = 0; row < 6; row++) {
            const node: CellContents[][] = [];
            for (let col = 0; col < 6; col++) {
                node.push([["BU", 1], ["BU", 2], ["BU", 3]]);
            }
            board.push(node);
        }
        return board;
    };

    it("renders a turn of several cap moves one step at a time, then the whole turn", () => {
        const g = new MvolcanoGame();
        g.board = uniformBoard();
        g.caps = new Set(["b6"]);
        // west to the edge erupts nothing; south from the corner erupts down the a file
        g.move("b6-a6,a6-a5");
        const reps = g.render();
        expect(Array.isArray(reps)).to.be.true;
        const frames = reps as APRenderRep[];
        expect(frames).to.have.length(3);
        expect(frames[0].annotations!.map(a => (a as { type: string }).type)).to.deep.equal(["move"]);
        expect(frames[0].areas).to.be.undefined;
        expect(frames[1].annotations!.map(a => (a as { type: string }).type)).to.deep.equal(["move", "eject", "exit", "eject", "eject"]);
        expect(frames[1].areas).to.have.length(1);
        expect(frames[2].annotations).to.have.length(6);
        const restored = new MvolcanoGame(g.serialize());
        expect(restored.render()).to.have.length(3);
        const legacy = restored.state();
        delete legacy.stack[legacy.stack.length - 1].frames;
        expect(Array.isArray(new MvolcanoGame(legacy).render())).to.be.false;
    });

    it("shows the steps already taken while the next cap is selected", () => {
        const g = new MvolcanoGame();
        g.board = uniformBoard();
        g.caps = new Set(["b6"]);
        const selected = g.validateMove("b6-a6,a6");
        expect(selected.valid).to.be.true;
        expect(selected.canrender).to.be.true;
        g.move("b6-a6,a6", { partial: true });
        expect(g.caps.has("a6")).to.be.true;
        expect(g.caps.has("b6")).to.be.false;
    });

    it("renders a single-step turn as one board", () => {
        const g = new MvolcanoGame();
        g.board = uniformBoard();
        g.caps = new Set(["a6"]);
        g.move("a6-a5");
        expect(Array.isArray(g.render())).to.be.false;
        expect(g.stack[g.stack.length - 1].frames).to.be.undefined;
    });
});
