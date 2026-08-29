/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { StreetcarGame } from '../../src/games';

import { CompassDirection, IEdge, hex2edges } from "../../src/common/hexes";
import { defineHex, Orientation, Grid, rectangle } from "honeycomb-grid";

const reEdge = /^([a-h]\d)(.+?)$/i;
const myHex = defineHex({
    offset: 1,
    orientation: Orientation.POINTY
});
const hexGrid = new Grid(myHex, rectangle({width: 8, height: 8}));

const str2edge = (str: string): IEdge|undefined => {
    const [,cell,dir] = str.match(reEdge)!;
    const [cellx, celly] = StreetcarGame.algebraic2coords(cell);
    const edgeHex = hexGrid.getHex({col: cellx, row: celly})!;
    return hex2edges(edgeHex).get(dir.toUpperCase() as CompassDirection)!;
}

describe("Streetcar Suburb", () => {
    it("Second-line handling", () => {
        const g = new StreetcarGame();
        g.claimed = [
            [
                str2edge("e6NW")!,
                str2edge("e6SW")!,
                str2edge("e6W")!,
                str2edge("g6NE")!,
                str2edge("g6E")!,
                str2edge("g6SE")!,
                str2edge("g7NW")!,
                str2edge("g7SW")!,
                str2edge("g7SE")!,
            ],
            [
                str2edge("f5NW")!,
                str2edge("f5W")!,
                str2edge("e7NW")!,
                str2edge("e7SW")!,
                str2edge("e7W")!,
            ],
        ];
        // in this case, "f6W" is the only valid line
        let result = g.validateMove("[f6W]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        // remove blue's "f5NW" to allow a second line
        g.claimed = [
            [
                str2edge("e6NW")!,
                str2edge("e6SW")!,
                str2edge("e6W")!,
                str2edge("g6NE")!,
                str2edge("g6E")!,
                str2edge("g6SE")!,
                str2edge("g7NW")!,
                str2edge("g7SW")!,
                str2edge("g7SE")!,
            ],
            [
                str2edge("f5W")!,
                str2edge("e7NW")!,
                str2edge("e7SW")!,
                str2edge("e7W")!,
            ],
        ];
        result = g.validateMove("[f6W]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(-1);

        // new case: "c5w" allows second line
        g.claimed = [
            [
                str2edge("d4W")!,
                str2edge("d4NW")!,
                str2edge("b4NW")!,
                str2edge("b4NE")!,
                str2edge("c4NW")!,
                str2edge("d4NW")!,
                str2edge("d4W")!,
                str2edge("b5W")!,
                str2edge("b5NW")!,
            ],
            [
                str2edge("d5W")!,
                str2edge("d5SW")!,
                str2edge("b3NW")!,
                str2edge("b3W")!,
            ],
        ];
        result = g.validateMove("[c5W]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(-1);
        // changing d4 and one c4 line does not
        g.claimed = [
            [
                str2edge("d4W")!,
                str2edge("d4NW")!,
                str2edge("b4NW")!,
                str2edge("b4NE")!,
                str2edge("b5W")!,
                str2edge("b5NW")!,
            ],
            [
                str2edge("c4NW")!,
                str2edge("d4NW")!,
                str2edge("d4W")!,
                str2edge("d5W")!,
                str2edge("d5SW")!,
                str2edge("b3NW")!,
                str2edge("b3W")!,
            ],
        ];
        result = g.validateMove("[c5W]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);

        // new case: a6SW only valid line
        g.claimed = [
            [
            ],
            [
                str2edge("a7NW")!,
                str2edge("a7NE")!,
                str2edge("a7E")!,
                str2edge("a7SE")!,
                str2edge("a5NE")!,
                str2edge("a5E")!,
            ],
        ];
        result = g.validateMove("[a6SE]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        // remove a5E to allow second line
        g.claimed = [
            [
            ],
            [
                str2edge("a7NW")!,
                str2edge("a7NE")!,
                str2edge("a7E")!,
                str2edge("a7SE")!,
                str2edge("a5NE")!,
            ],
        ];
        result = g.validateMove("[a6SE]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(-1);

        // new case: a5SE only line
        g.claimed = [
            [
            ],
            [
                str2edge("a5NW")!,
                str2edge("a5NE")!,
                str2edge("a5W")!,
                str2edge("a6NW")!,
                str2edge("a6SE")!,
                str2edge("a7SW")!,
            ],
        ];
        result = g.validateMove("[a5SE]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        // remove a6SE to allow second line
        g.claimed = [
            [
            ],
            [
                str2edge("a5NW")!,
                str2edge("a5NE")!,
                str2edge("a5W")!,
                str2edge("a6NW")!,
                str2edge("a7SW")!,
            ],
        ];
        result = g.validateMove("[a5SE]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(-1);

        // new case: a5E only option
        g.claimed = [
            [
                str2edge("a5NE")!,
                str2edge("a5SE")!,
                str2edge("a6NW")!,
                str2edge("a6SW")!,
            ],
            [
            ],
        ];
        result = g.validateMove("[a5E]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        // remove any line to allow placement
        g.claimed = [
            [
                str2edge("a5NE")!,
                str2edge("a5SE")!,
                str2edge("a6NW")!,
            ],
            [
            ],
        ];
        result = g.validateMove("[a5E]");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(-1);
    });
});

describe("Structured render labels", () => {
    it("emits seatAreaLabel on taken pieces areas", () => {
        const g = new StreetcarGame();
        g.taken = [[1, 2], []];
        const rep = g.render();
        expect(rep.areas).to.have.length(1);
        const area = rep.areas![0]!;
        expect(area.type).to.equal("pieces");
        expect(area.label).to.deep.equal({
            textKey: "apgames:validation.streetcar.TAKEN_LABEL",
            actor: { kind: "seat", seat: 1 },
        });
        expect(area.ownerMark).to.equal(1);
    });

    it("emits separate labels per seat when both players have taken pieces", () => {
        const g = new StreetcarGame();
        g.taken = [[1], [2]];
        const rep = g.render();
        expect(rep.areas).to.have.length(2);
        expect(rep.areas![0]!.label).to.deep.equal({
            textKey: "apgames:validation.streetcar.TAKEN_LABEL",
            actor: { kind: "seat", seat: 1 },
        });
        expect(rep.areas![1]!.label).to.deep.equal({
            textKey: "apgames:validation.streetcar.TAKEN_LABEL",
            actor: { kind: "seat", seat: 2 },
        });
    });
});