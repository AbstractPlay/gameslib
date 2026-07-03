import "mocha";
import { expect } from "chai";
import { HexMoonGraph } from '../../../src/common';

describe("HexMoonGraph", () => {
    it ("Nodes", () => {
        const g = new HexMoonGraph();
        const cells = g.listCells(false) as string[];
        const uniques = new Set<string>(cells);
        expect(cells.length).equal(uniques.size);
    });
    it("Round-trip coordinate transforms", () => {
        const g = new HexMoonGraph();
        const ordered = g.listCells(true) as string[][];
        for (let row = 0; row < ordered.length; row++) {
            for (let col = 0; col < ordered[row].length; col++) {
                const cell = ordered[row][col];
                // console.log(JSON.stringify({row, col, cell}));
                const c2aCell = g.coords2algebraic(col, row);
                expect(cell).eq(c2aCell);
                const [txCol, txRow] = g.algebraic2coords(cell);
                expect(txCol).eq(col);
                expect(txRow).eq(row);
                const txCell = g.coords2algebraic(txCol, txRow);
                expect(txCell).eq(cell);
            }
        }
    });
});
