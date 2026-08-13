/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { EntropyGame } from "../../src/games/entropy";

type AnnotTarget = { col: number; row: number };

function enterTargets(rep: ReturnType<EntropyGame["render"]>): AnnotTarget[] {
    const targets: AnnotTarget[] = [];
    for (const a of rep.annotations ?? []) {
        if ("type" in a && a.type === "enter" && "targets" in a) {
            for (const t of a.targets) {
                if (t.col !== undefined && t.row !== undefined) {
                    targets.push({ col: t.col, row: t.row });
                }
            }
        }
    }
    return targets;
}

function moveSegments(rep: ReturnType<EntropyGame["render"]>): Array<[AnnotTarget, AnnotTarget]> {
    const segments: Array<[AnnotTarget, AnnotTarget]> = [];
    for (const a of rep.annotations ?? []) {
        if ("type" in a && a.type === "move" && "targets" in a && a.targets.length >= 2) {
            const [from, to] = a.targets;
            if (from.col !== undefined && from.row !== undefined
                && to.col !== undefined && to.row !== undefined) {
                segments.push([{ col: from.col, row: from.row }, { col: to.col, row: to.row }]);
            }
        }
    }
    return segments;
}

function combinedCol(g: EntropyGame, cell: string, playerIndex: 0 | 1, kind: "place" | "move"): number {
    const [col] = g.algebraic2coords(cell);
    if (kind === "place" && playerIndex === 0) {
        return col + g.boardsize;
    }
    if (kind === "move" && playerIndex === 1) {
        return col + g.boardsize;
    }
    return col;
}

describe("Entropy", () => {
    before(() => {
        addResource("en");
    });

    describe("render annotations", () => {
        it("does not duplicate enter markers on a complete chaos turn", () => {
            const g = new EntropyGame();
            g.move("d5, e4");
            const rep = g.render({ perspective: 2 });
            const [d5Col, d5Row] = g.algebraic2coords("d5");
            const expectedCol = d5Col + g.boardsize;
            const d5Enters = enterTargets(rep).filter(t => t.col === expectedCol && t.row === d5Row);
            expect(d5Enters).to.have.length(1);
        });

        it("shows a partial chaos placement on the correct board only", () => {
            const g = new EntropyGame();
            g.move("d5, ", { partial: true });
            const rep = g.render({ perspective: 2 });
            const [d5Col, d5Row] = g.algebraic2coords("d5");
            const expectedCol = d5Col + g.boardsize;
            const enters = enterTargets(rep);
            expect(enters).to.have.length(1);
            expect(enters[0]).to.deep.equal({ col: expectedCol, row: d5Row });
        });

        it("shows one enter per placement for observers without duplication", () => {
            const g = new EntropyGame();
            g.move("d5, e4");
            const rep = g.render({});
            const enters = enterTargets(rep);
            expect(enters).to.have.length(2);
            const [e4Col, e4Row] = g.algebraic2coords("e4");
            const [d5Col, d5Row] = g.algebraic2coords("d5");
            expect(enters).to.deep.include({ col: e4Col, row: e4Row });
            expect(enters).to.deep.include({ col: d5Col + g.boardsize, row: d5Row });
        });

        it("places order-phase move annotations on the correct boards", () => {
            const g = new EntropyGame();
            g.move("g7, a1");
            g.move("a1-a4, g7-g4");
            const rep = g.render({});
            const segments = moveSegments(rep);
            expect(segments.length).to.be.greaterThan(0);
            const p1FromCol = combinedCol(g, "a1", 0, "move");
            const p1ToCol = combinedCol(g, "a4", 0, "move");
            const p2FromCol = combinedCol(g, "g7", 1, "move");
            const p2ToCol = combinedCol(g, "g4", 1, "move");
            const [, a1Row] = g.algebraic2coords("a1");
            const [, a4Row] = g.algebraic2coords("a4");
            const [, g7Row] = g.algebraic2coords("g7");
            const [, g4Row] = g.algebraic2coords("g4");
            expect(segments).to.deep.include([
                { col: p1FromCol, row: a1Row },
                { col: p1ToCol, row: a4Row },
            ]);
            expect(segments).to.deep.include([
                { col: p2FromCol, row: g7Row },
                { col: p2ToCol, row: g4Row },
            ]);
            for (const [from, to] of segments) {
                const onLeftBoard = from.col < g.boardsize && to.col < g.boardsize;
                const onRightBoard = from.col >= g.boardsize && to.col >= g.boardsize;
                expect(onLeftBoard || onRightBoard).to.be.true;
            }
        });
    });
});
