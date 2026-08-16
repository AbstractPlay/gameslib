import "mocha";
import { expect } from "chai";
import { BaghChalGame } from '../../src/games';
import { BaghChalCellPair, allowedDirections } from "../../src/games/baghchal";


// const allCells: string[] = [
//     "a1", "a2", "a3", "a4", "a5",
//     "b1", "b2", "b3", "b4", "b5",
//     "c1", "c2", "c3", "c4", "c5",
//     "d1", "d2", "d3", "d4", "d5",
//     "e1", "e2", "e3", "e4", "e5",
// ]

const initiallyEmptyCells: string[] = [
          "a2", "a3", "a4",
    "b1", "b2", "b3", "b4", "b5",
    "c1", "c2", "c3", "c4", "c5",
    "d1", "d2", "d3", "d4", "d5",
          "e2", "e3", "e4",
]


describe("BaghChal", () => {
    it ("Cell pairs", () => {
        const pair1 = new BaghChalCellPair("a1", "a2");
        expect(pair1.fromX()).to.eql(0);
        expect(pair1.fromY()).to.eql(4);
        expect(pair1.toX()).to.eql(0);
        expect(pair1.toY()).to.eql(3);
        expect(pair1.deltaX()).to.eql(0);
        expect(pair1.deltaY()).to.eql(-1);
        expect(pair1.deltaString()).to.eql("0|-1");
        expect(pair1.direction()).to.eql("N");

        const pair2 = new BaghChalCellPair("c3", "d4");
        expect(pair2.deltaString()).to.eql("1|-1");
        expect(pair2.direction()).to.eql("NE");

        const pair3 = new BaghChalCellPair("a4", "b4");
        expect(pair3.deltaString()).to.eql("1|0");
        expect(pair3.direction()).to.eql("E");

        const pair4 = new BaghChalCellPair("d4", "e3");
        expect(pair4.deltaString()).to.eql("1|1");
        expect(pair4.direction()).to.eql("SE");

        const pair5 = new BaghChalCellPair("c3", "c2");
        expect(pair5.deltaString()).to.eql("0|1");
        expect(pair5.direction()).to.eql("S");

        const pair6 = new BaghChalCellPair("e5", "d4");
        expect(pair6.deltaString()).to.eql("-1|1");
        expect(pair6.direction()).to.eql("SW");

        const pair7 = new BaghChalCellPair("b2", "a2");
        expect(pair7.deltaString()).to.eql("-1|0");
        expect(pair7.direction()).to.eql("W");

        const pair8 = new BaghChalCellPair("c1", "b2");
        expect(pair8.deltaString()).to.eql("-1|-1");
        expect(pair8.direction()).to.eql("NW");
    });
    it ("Initial empty cells", () => {
        const g = new BaghChalGame();
        expect(g.emptyCells()).to.have.members(initiallyEmptyCells);
    });
    it ("Place goat", () => {
        const g = new BaghChalGame();
        g.placeGoat("b4");
        expect(g.goatsOnBoard()).to.eql(["b4"]);
        expect(g.goatsInHand).to.eql(19);
    });
    it ("Last goat placement, first goat move", () => {
        const g = new BaghChalGame();
        g.goatsInHand = 1;
        g.move("c4");
        expect(g.goatsInHand).to.eql(0);
        g.move("a1-b1")
        expect(g.moves()).to.have.members(["c4-c5", "c4-b4", "c4-d4", "c4-c3"]);
    });
    it("Allowed tiger jump directions", () => {
        expect(allowedDirections("N")).to.have.members(["W", "NW", "N", "NE", "E"]);
        expect(allowedDirections("NE")).to.have.members(["NW", "N", "NE", "E", "SE"]);
        expect(allowedDirections("E")).to.have.members(["N", "NE", "E", "SE", "S"]);
        expect(allowedDirections("SE")).to.have.members(["NE", "E", "SE", "S", "SW"]);
        expect(allowedDirections("S")).to.have.members(["E", "SE", "S", "SW", "W"]);
        expect(allowedDirections("SW")).to.have.members(["SE", "S", "SW", "W", "NW"]);
        expect(allowedDirections("W")).to.have.members(["S", "SW", "W", "NW", "N"]);
        expect(allowedDirections("NW")).to.have.members(["SW", "W", "NW", "N", "NE"]);
    });
    it("Partial move annotations", () => {
        const g = new BaghChalGame();

        g.move("c4"); // Full goat placement
        const render1 = g.render()
        expect(render1.annotations).to.eql([]);

        g.move("a5", { partial: true, trusted: false }); // Tiger selected
        const render2 = g.render()
        expect(render2.annotations![0]).to.eql({
            type: 'dots',
            targets: [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }]
        })

        g.move("a5-a4"); // Tiger moved
        const render3 = g.render()
        expect(render3.annotations).to.eql([]);
    });
    it ("Example game", () => {
        const g = new BaghChalGame();

        expect(g.tigersOnBoard()).to.eql(new Map([
            ["a1", "NE" ],
            ["a5", "SE" ],
            ["e1", "NW" ],
            ["e5", "SW" ],
        ]));

        expect(g.goatsOnBoard()).to.eql([]);
        expect(g.goatsInHand).to.eql(20);


        expect(g.currplayer === 1);
        // Place goat
        g.move("b4");
        expect(g.goatsOnBoard()).to.eql(["b4"]);
        expect(g.goatsInHand).to.eql(19);


        expect(g.currplayer === 2);
        // Simple tiger move
        g.move("a1-b1");

        expect(g.tigersOnBoard()).to.eql(new Map([
            ["b1", "E"],
            ["a5", "SE"],
            ["e1", "NW"],
            ["e5", "SW"],
        ]));


        expect(g.currplayer === 1);
        // Place goat
        g.move("e3");
        expect(g.goatsOnBoard()).to.have.members(["b4", "e3"]);
        expect(g.goatsInHand).to.eql(18);

        expect(g.currplayer === 2);

        expect(g.goatsCaptured).to.eql(0);
        // Tiger jumps and captures goat on b4
        g.move("a5-c3");
        expect(g.goatsCaptured).to.eql(1);

        expect(g.tigersOnBoard()).to.eql(new Map([
            ["b1", "E"],
            ["c3", "SE"],
            ["e1", "NW"],
            ["e5", "SW"],
        ]));

        expect(g.goatsOnBoard()).to.have.members(["e3"]);
    })
});
