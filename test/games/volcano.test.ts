/* eslint-disable @typescript-eslint/no-unused-expressions */
/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { VolcanoGame } from '../../src/games';
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";

describe("Volcano", () => {
    it ("Captured pieces stack properly", () => {
        const g = new VolcanoGame();
        g.captured[0] = [["RD", 1]];
        let org = g.organizeCaps(1);
        expect(org.miscellaneous).to.have.deep.members([["RD", 1]]);
        g.captured[0] = [["RD", 1], ["OG", 1]];
        org = g.organizeCaps(1);
        expect(org.miscellaneous).to.have.deep.members([["RD", 1], ["OG", 1]]);
        g.captured[0] = [["RD", 1], ["OG", 2]];
        org = g.organizeCaps(1);
        expect(org.partialsMixed).to.have.deep.members([[["OG", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["RD", 2]];
        org = g.organizeCaps(1);
        expect(org.partialsMono).to.have.deep.members([[["RD", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["RD", 2], ["RD", 3]];
        org = g.organizeCaps(1);
        expect(org.triosMono).to.have.deep.members([[["RD", 3], ["RD", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["OG", 2], ["RD", 3]];
        org = g.organizeCaps(1);
        expect(org.triosMixed).to.have.deep.members([[["RD", 3], ["OG", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["OG", 2], ["RD", 3], ["PK", 1], ["PK", 2], ["PK", 3]];
        org = g.organizeCaps(1);
        expect(org.triosMixed).to.have.deep.members([[["RD", 3], ["OG", 2], ["RD", 1]]]);
        expect(org.triosMono).to.have.deep.members([[["PK", 3], ["PK", 2], ["PK", 1]]]);
        // g.captured[0] = [["RD", 1], ["OG", 2], ["RD", 3], ["PK", 1], ["PK", 2], ["PK", 3], ["YE", 3], ["YE", 1]];
        // org = g.organizeCaps(1);
        // expect(org.triosMixed).to.have.deep.members([[["RD", 3], ["OG", 2], ["RD", 1]]]);
        // expect(org.triosMono).to.have.deep.members([[["PK", 3], ["PK", 2], ["PK", 1]]]);
        // expect(org.miscellaneous).to.have.deep.members([["YE", 1], ["YE", 3]]);
    });

    it("emits structured label on captured localStash areas", () => {
        const g = new VolcanoGame();
        g.captured[0] = [["RD", 1]];
        const rep = g.render();
        expect(rep.areas).to.have.length(1);
        const area = rep.areas![0]!;
        expect(area.type).to.equal("localStash");
        expect(area.label).to.deep.equal({
            textKey: "apgames:validation.volcano.CAPTURED_LABEL",
            actor: { kind: "seat", seat: 1 },
        });
    });

    it("emits dense localStash columns without spacers (3D capture)", () => {
        const g = new VolcanoGame();
        g.captured[0] = [["RD", 3], ["OG", 2], ["RD", 1]];
        const rep = g.render();
        const stash = rep.areas![0]!.stash;
        expect(stash).to.deep.include.members([["RD3", "OG2", "RD1"]]);
        for (const column of stash) {
            expect(column).to.not.include("-");
        }
    });
});


describe("Volcano frames", () => {
    // every volcano the same colour, the centre empty
    const uniformBoard = () => {
        const board: Array<Array<[string, number][]>> = [];
        for (let row = 0; row < 5; row++) {
            const node: Array<[string, number][]> = [];
            for (let col = 0; col < 5; col++) {
                node.push(row === 2 && col === 2 ? [] : [["BU", 1], ["BU", 2], ["BU", 3]]);
            }
            board.push(node);
        }
        return board as VolcanoGame["board"];
    };
    const stackAt = (rep: APRenderRep, row: number, col: number): string[] => (rep.pieces as string[][][])[row][col];
    const pyramids = (stack: string[]): string[] => stack.filter(p => p !== "X" && p !== "-");

    it("renders a turn of several cap moves one step at a time, then the whole turn", () => {
        const g = new VolcanoGame();
        g.board = uniformBoard();
        g.caps = new Set(["c3"]);
        // the first cap move erupts nothing (the centre is empty); the second erupts c4 eastward
        g.move("c3-c4,c4-d4");
        const reps = g.render();
        expect(Array.isArray(reps)).to.be.true;
        const frames = reps as APRenderRep[];
        expect(frames).to.have.length(3);
        // first step: the cap now sits on c4, whose volcano is still whole
        expect(frames[0].annotations!.map(a => (a as { type: string }).type)).to.deep.equal(["move"]);
        const c4 = stackAt(frames[0], 1, 2);
        expect(c4[c4.length - 1]).to.equal("X");
        expect(pyramids(c4)).to.have.length(3);
        expect(frames[0].areas).to.be.undefined;
        // second step: the eruption, with its capture
        expect(frames[1].annotations!.map(a => (a as { type: string }).type)).to.deep.equal(["move", "eject", "exit"]);
        expect(pyramids(stackAt(frames[1], 1, 2))).to.have.length(2);
        expect(frames[1].areas).to.have.length(1);
        // the whole turn on the final position
        expect(frames[2].annotations!.map(a => (a as { type: string }).type)).to.deep.equal(["move", "move", "eject", "exit"]);
        expect(pyramids(stackAt(frames[2], 1, 2))).to.have.length(2);
        expect(frames[2].areas).to.have.length(1);

        // the frames survive a round trip and belong to their own turn
        const restored = new VolcanoGame(g.serialize());
        expect(restored.render()).to.have.length(3);
        // a game saved before frames existed renders its final board alone
        const legacy = restored.state();
        delete legacy.stack[legacy.stack.length - 1].frames;
        expect(Array.isArray(new VolcanoGame(legacy).render())).to.be.false;
    });

    it("shows the steps already taken while the next cap is selected", () => {
        const g = new VolcanoGame();
        g.board = uniformBoard();
        g.caps = new Set(["c3"]);
        const selected = g.validateMove("c3-c4,c4");
        expect(selected.valid).to.be.true;
        expect(selected.complete).to.equal(-1);
        expect(selected.canrender).to.be.true;
        g.move("c3-c4,c4", { partial: true });
        expect(g.caps.has("c4")).to.be.true;
        expect(g.caps.has("c3")).to.be.false;
        expect(Array.isArray(g.render())).to.be.false;
    });

    it("renders a single-step turn and a move in progress as one board", () => {
        const g = new VolcanoGame();
        g.board = uniformBoard();
        g.caps = new Set(["a5", "c3"]);
        const partial = new VolcanoGame();
        partial.board = uniformBoard();
        partial.caps = new Set(["a5", "c3"]);
        partial.move("c3-c4", { partial: true });
        expect(Array.isArray(partial.render())).to.be.false;
        g.move("a5-b5");
        expect(Array.isArray(g.render())).to.be.false;
        expect(g.stack[g.stack.length - 1].frames).to.be.undefined;
    });
});
