/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { SympleGame } from "../../src/games/symple.js";
import { GameBase } from "../../src/games/_base.js";

type EnterAnnotation = {
    type: string;
    colour?: number;
    targets: Array<{ row: number; col: number }>;
};

const boardSize = 19;

function enterAnnotations(g: SympleGame): EnterAnnotation[] {
    return (g.render().annotations ?? []).filter(a => a.type === "enter") as EnterAnnotation[];
}

function cellTarget(cell: string): { row: number; col: number } {
    const [col, row] = GameBase.algebraic2coords(cell, boardSize);
    return { row, col };
}

function hasEnterAt(g: SympleGame, cell: string, colour: number): boolean {
    const target = cellTarget(cell);
    return enterAnnotations(g).some(
        a => a.colour === colour && a.targets.some(t => t.row === target.row && t.col === target.col),
    );
}

describe("Symple", () => {
    it("shows a single committed placement with the mover's colour", () => {
        const g = new SympleGame();
        g.move("k10", { trusted: true });
        const enters = enterAnnotations(g);
        expect(enters).to.have.length(1);
        expect(enters[0].colour).to.equal(1);
        expect(enters[0].targets).to.deep.equal([cellTarget("k10")]);
    });

    it("shows enter highlights for the last two committed turns with distinct colours", () => {
        const g = new SympleGame();
        g.move("a1", { trusted: true });
        g.move("s19", { trusted: true });
        const enters = enterAnnotations(g);
        expect(enters).to.have.length(2);
        expect(hasEnterAt(g, "a1", 1)).to.be.true;
        expect(hasEnterAt(g, "s19", 2)).to.be.true;
    });

    it("shows in-progress growth plus the previous turn, colour-coded", () => {
        const g = new SympleGame();
        g.move("a1", { trusted: true });
        g.move("s19", { trusted: true });
        g.move("b1", { partial: true, trusted: true });
        expect(hasEnterAt(g, "s19", 2)).to.be.true;
        expect(hasEnterAt(g, "b1", 1)).to.be.true;
        expect(enterAnnotations(g)).to.have.length(2);
    });
});
