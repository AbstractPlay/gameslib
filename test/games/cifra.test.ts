/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { CifraGame } from "../../src/games/cifra";

function setupKingGame(): CifraGame {
    const g = new CifraGame(undefined, ["king"]);
    g.move("light,top");
    return g;
}

function clickCell(g: CifraGame, cell: string): [number, number] {
    const [col, row] = g.algebraic2coords(cell);
    return [row, col];
}

describe("Cifra", () => {
    it("setup click empty cell auto-places highest unplaced piece", () => {
        const g = setupKingGame();
        const home = g.getHomeCells(g.currplayer)!;
        const [row, col] = clickCell(g, home[0]);
        const result = g.handleClick("", row, col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal(`${g.boardSize}${home[0]}`);
    });

    it("setup click continues with next highest unplaced piece", () => {
        const g = setupKingGame();
        const home = g.getHomeCells(g.currplayer)!;
        const first = `${g.boardSize}${home[0]}`;
        const [row, col] = clickCell(g, home[1]);
        const result = g.handleClick(first, row, col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal(`${first},${g.boardSize - 1}${home[1]}`);
    });

    it("setup explicit hand selection is preserved", () => {
        const g = setupKingGame();
        const home = g.getHomeCells(g.currplayer)!;
        const hand = g.handleClick("", -1, -1, "p3");
        expect(hand.valid).to.be.true;
        expect(hand.move).to.equal("3");
        const [row, col] = clickCell(g, home[0]);
        const result = g.handleClick(hand.move!, row, col);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal(`3${home[0]}`);
    });
});
