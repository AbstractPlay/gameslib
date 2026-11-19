/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { PolypodsGame } from '../../src/games';

function state(p1s: string[], p2s: string[], remains: string[], variants: string[] = []): PolypodsGame {
    const g = new PolypodsGame(undefined, variants);
    for(const m of p1s){
        g.board.set(m, {player: 1, type: "foot"});
    }
    for(const m of p2s){
        g.board.set(m, {player: 2, type: "foot"});
    }
    for(const m of remains){
        g.remains.add(m);
    }
    g.board = g.updatePolypods(g.board);
    return g;
}

/* Various end conditions.
Test with both p1 and p2 as the current player:
current player wins with normal stone
neutral stone, current player wins with only loop
neutral stone, other player wins with only loop
neutral stone, current player wins with shortest loop
neutral stone, other player wins with shortest loop
neutral stone, current player wins with equally long loop but fewer neutrals
neutral stone, other player wins with equally long loop but fewer neutrals
neutral stone, two loops of equal size and #neutrals, p2 wins
*/

describe("Polypods", () => {
    it("set feet and cores based on connectivity", () => {
        const moves = ["b6", "f4", "c6", "f5", "b5", "g4", "c4", "g5", "a5", "f6", "b7"]
        const g = new PolypodsGame()
        for(const m of moves) {
            g.move(m);
        }
        for (const c of ["b5", "b6", "f5", "g4"]) {
            expect(g.board.get(c)!.type).to.equal("core")
        }
        for (const c of ["a5", "b7", "c4", "c6", "f4", "f6", "g5"]) {
            expect(g.board.get(c)!.type).to.equal("foot")
        }
    })

    it("can't place adjacent to opponent core", () => {
        const g = state(
            [],
            ['d4', 'd5', 'd6'],
            []);
        const results = g.validateMove("e5");
        expect(results.valid).to.be.false;
    })

    it("can't place on remains", () => {
        const g = state(
            [],
            [],
            ['e4']);
        const results = g.validateMove('e4');
        expect(results.valid).to.be.false;
    })

    it("polypod death", () => {
        const ppod = ['c5', 'c6', 'd6', 'd7', 'e6', 'e7'];
        const g = state(
            ['b4', 'c4'],
            ppod,
            []);
        g.move('d4')
        for (const c of ppod) {
            expect(g.board.has(c)).to.be.false;
        }
    })
    
    it("polypod core revert to feet", () => {
        const g = state(
            ['d3', 'e3'],
            ['c6', 'd6', 'd5', 'e4'],
            []
        );
        expect(g.board.get('d5')!.type).to.equal("core")
        g.move('f3')
        expect(g.board.get('d5')!.type).to.equal("foot")
    })
        
    it("can't grow if it would have too few feet", () => {
        const g = state(
            ['c6', 'd6', 'd5', 'e4'],
            [],
            []
        );
        const results = g.validateMove('f4');
        expect(results.valid).to.be.false;
    })
        
    it("base game markers", () => {
        const ppod = ['c5', 'c6', 'd6', 'd7', 'e6', 'e7'];
        const g = state(
            ['b4', 'c4'],
            ppod,
            []
        );
        g.move('d4')
        const expectRemains = new Set(['c5']);
        expect(g.remains).to.deep.equal(expectRemains)
    })

    it("stoney-footed markers", () => {
        const ppod = ['c5', 'c6', 'd6', 'd7', 'e6', 'e7'];
        const g = state(
            ['b4', 'c4'],
            ppod,
            [],
            ['stoney-footed'],
        );
        g.move('d4')
        const expectRemains = new Set(['c5', 'c6', 'e7']);
        expect(g.remains).to.deep.equal(expectRemains)
    })

    it("energized markers", () => {
        const ppod = ['c5', 'c6', 'd6', 'd7', 'e6', 'e7'];
        const g = state(
            ['b4', 'c4'],
            ppod,
            [],
            ['energized'],
        );
        g.move('d4')
        const expectRemains = new Set(['c5', 'c6', 'e7', 'd6']);
        expect(g.remains).to.deep.equal(expectRemains)
    })

    it("scavenging markers", () => {
        const ppod = ['c5', 'c6', 'd6', 'd7', 'e6', 'e7'];
        const g = state(
            ['b4', 'c4'],
            ppod,
            [],
            ['scavenging'],
        );
        g.move('d4')
        const expectRemains = new Set(['c5', 'c6', 'd6', 'd7', 'e6', 'e7']);
        expect(g.remains).to.deep.equal(expectRemains)
    })

    it("energized bonus move", () => {
        const g = state(
            ['d3', 'd4'],
            [],
            ['e4'],
            ['energized'],
        );
        const results = g.validateMove('e4');
        expect(results.valid).to.be.true;
        expect(results.complete).to.equal(-1);
        const results2 = g.validateMove('e4;d2');
        expect(results2.complete).to.equal(1);
        expect(results2.valid).to.be.true;
    })

    it("energized bonus move not available", () => {
        const g = state(
            ['a2', 'b2', 'b1'],
            ['a4', 'b4', 'c4', 'd3', 'd2', 'd1'],
            ['a1'],
            ['energized'],
        );
        const results = g.validateMove('a1');
        expect(results.valid).to.be.false;
    })

    it("energized bonus move not on a marker", () => {
        const g = state(
            ['a2', 'b2', 'b1'],
            [],
            ['a1', 'b3'],
            ['energized'],
        );
        const results = g.validateMove('a1');
        expect(results.valid).to.be.true;
        expect(results.complete).to.equal(-1);

        const results2 = g.validateMove('a1;b3');
        expect(results2.valid).to.be.false;

        const results3 = g.validateMove('a1;c2');
        expect(results3.valid).to.be.true;
        expect(results3.complete).to.equal(1);
    })

    it("scavenging capture doesn't remove marker", () => {
        const g = state(
            ['d4', 'd5'],
            ['e4'],
            ['e6'],
            ['scavenging'],
        );
        g.move('e5');
        expect(g.remains).to.deep.equal(new Set(['e6', 'e4']))
    })

    it("scavenging non-capture must remove marker", () => {
        const g = state(
            ['d5'],
            ['e4'],
            ['e6'],
            ['scavenging'],
        );
        const result = g.validateMove('e5');
        expect(result.valid).to.be.true
        expect(result.complete).to.equal(-1)
    })

    it("scavenging non-capture on marker", () => {
        const g = state(
            ['d5'],
            ['e4'],
            ['e5'],
            ['scavenging'],
        );
        const result = g.validateMove('e5');
        expect(result.valid).to.be.true
        expect(result.complete).to.equal(1)
    })

    it("scavenging cannot capture while placing on marker", () => {
        const g = state(
            ['d4', 'd5'],
            ['e4'],
            ['e5'],
            ['scavenging'],
        );
        const result = g.validateMove('e5');
        expect(result.valid).to.be.false
    })

    it("p1 win", () => {
        const g = state(
            ['d4', 'd5', 'd6'],
            ['e4'],
            ['e5']
        );
        g.move('pass');
        g.move('pass');

        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("p2 win", () => {
        const g = state(
            ['d4', 'd5'],
            ['e4', 'e5', 'e6'],
            []
        );
        g.move('pass');
        g.move('pass');

        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });

    it("p1 win by tie-breaker", () => {
        const g = state(
            ['d4', 'd5', 'd6', 'd7'],
            ['a4', 'a5', 'a6', 'a7'],
            ['e5']
        );
        g.move('pass');
        g.move('pass');

        expect(g.gameover).to.be.true;
        expect(g.getPlayerScore(1)).to.equal(g.getPlayerScore(2))
        expect(g.winner).to.deep.equal([1]);
    });

    it("p2 win by tie-breaker", () => {
        const g = state(
            ['a4', 'a5', 'a6', 'a7'],
            ['d4', 'd5', 'd6', 'd7'],
            ['e5']
        );
        g.move('pass');
        g.move('pass');

        expect(g.gameover).to.be.true;
        expect(g.getPlayerScore(1)).to.equal(g.getPlayerScore(2))
        expect(g.winner).to.deep.equal([2]);
    });
});

