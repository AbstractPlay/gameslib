/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { PacruGame } from '../../src/games';
import type {CellContents} from "../../src/games/pacru";
import { PacruGraph } from "../../src/games/pacru/graph";

const old2PStart = (): PacruGame => {
    const g = new PacruGame(2);
    // adjust starting position to pre-change
    const oldp: [string, CellContents][] = [
        ["a9", {chevron: {owner: 1, facing: "SE"}}],
        ["c9", {chevron: {owner: 2, facing: "S"}}],
        ["g9", {chevron: {owner: 1, facing: "S"}}],
        ["a5", {chevron: {owner: 2, facing: "E"}}],
        ["i5", {chevron: {owner: 1, facing: "W"}}],
        ["c1", {chevron: {owner: 2, facing: "N"}}],
        ["g1", {chevron: {owner: 1, facing: "N"}}],
        ["i1", {chevron: {owner: 2, facing: "NW"}}],
    ];
    g.board.clear();
    for (const [cell, contents] of oldp) {
        g.board.set(cell, contents);
    }
    return g;
}

describe("Pacru", () => {
    it ("Side effects detected", () => {
        const graph = new PacruGraph();
        let g = old2PStart();
        let effects = g.getSideEffects("g9", "f8");
        expect(effects.size).equal(1);
        expect(effects.has("blChange")).to.be.true;
        for (const cell of graph.ctr2cells("e8")) {
            if (cell === "f8") {
                g.board.set("f8", {tile: 1});
            } else {
                g.board.set(cell, {tile: 2});
            }
        }
        effects = g.getSideEffects("g9", "f8");
        expect(effects.size).equal(1);
        expect(effects.has("blTransform")).to.be.true;
        for (const cell of graph.ctr2cells("e8")) {
            g.board.delete(cell);
        }
        g.board.set("e7", {tile: 1});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        expect(g.baseMoves().includes("g9-e7")).to.be.true;
        effects = g.getSideEffects("g9", "e7");
        expect(effects.size).equal(2);
        expect(effects.has("blChange")).to.be.true;
        expect(effects.has("connChange")).to.be.true;
        expect(g.board.has("f8")).to.be.false;
        g.executeMove("g9-e7(*)");
        const contents = g.board.get("f8");
        expect(contents).to.not.be.undefined;
        expect(contents!.tile).equal(1);

        // check that blChange is triggered after pincer, too
        g = old2PStart();
        g.board.set("d9", {chevron: {owner: 1, facing: "S"}});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("i7", {tile: 1});
        g.board.set("e9", {tile: 1});
        g.board.set("e8", {tile: 1});
        g.board.set("e7", {tile: 1});
        g.board.set("d6", {chevron: {owner: 2, facing: "S"}});
        expect(g.baseMoves().includes("d9xd6")).to.be.true;
        effects = g.getSideEffects("d9", "d6", true);
        expect(effects.size).equal(1);
        expect(effects.has("blChange")).to.be.true;

        // check that blTransform is caught correctly after pincer
        g = old2PStart();
        g.board.set("d9", {chevron: {owner: 1, facing: "S"}});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("i7", {tile: 1});
        g.board.set("e9", {tile: 1});
        g.board.set("e8", {tile: 1});
        g.board.set("e7", {tile: 1});
        for (const cell of graph.ctr2cells("e5")) {
            if (cell === "d6") {
                g.board.set("d6", {tile: 2, chevron: {owner: 2, facing: "S"}});
            } else {
                g.board.set(cell, {tile: 2});
            }
        }
        expect(g.baseMoves().includes("d9xd6")).to.be.true;
        effects = g.getSideEffects("d9", "d6", true);
        expect(effects.size).equal(1);
        expect(effects.has("blTransform")).to.be.true;

        // blChange triggers even when you move into last neutral cell
        g = old2PStart();
        for (const cell of graph.ctr2cells("e8")) {
            if (cell === "f8") {
                continue
            } else {
                g.board.set(cell, {tile: 2});
            }
        }
        expect(g.baseMoves().includes("g9-f8")).to.be.true;
        effects = g.getSideEffects("g9", "f8");
        expect(effects.size).equal(1);
        expect(effects.has("blChange")).to.be.true;
        const results = g.validateMove("g9-f8(f8)");
        expect(results.valid).to.be.true;
        expect(results.complete).equal(1);
    });

    it ("Pincers detected and executed correctly", () => {
        const g = old2PStart();
        g.board.set("e9", {chevron: {owner: 1, facing: "S"}});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("d9", {tile: 1});
        g.board.set("d8", {tile: 1});
        g.board.set("e7", {chevron: {owner: 2, facing: "S"}});
        expect(g.baseMoves().includes("e9xe7")).to.be.true;
        expect(g.baseMoves().includes("g9xe7")).to.be.true;
        g.executeMove("e9xe7");
        const contents = g.board.get("e7");
        expect(contents).to.not.be.undefined;
        expect(contents?.tile).equal(1);
        expect(contents?.chevron).to.not.be.undefined;
        expect(contents?.chevron?.owner).equal(1);
    });

    it ("Meetings detected", () => {
        // not enough enemy tiles
        const graph = new PacruGraph();
        let g = old2PStart();
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g8", {tile: 1});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        g.executeMove("g9-g8");
        expect(g.isMeeting("g8")).to.be.false;

        // enough enemy tiles
        g = old2PStart();
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g8", {tile: 1});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        for (const cell of graph.ctr2cells("e5")) {
            g.board.set(cell, {tile: 2});
        }
        g.executeMove("g9-g8");
        expect(g.isMeeting("g8")).to.be.true;

        // `to` doesn't have a tile
        g = old2PStart();
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        for (const cell of graph.ctr2cells("e5")) {
            g.board.set(cell, {tile: 2});
        }
        g.executeMove("g9-g8");
        expect(g.isMeeting("g8")).to.be.false;

        // validation edge case where your meeting drops the threshold
        g = old2PStart();
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g8", {tile: 1});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        for (const cell of graph.ctr2cells("e5")) {
            g.board.set(cell, {tile: 2});
        }
        let results = g.validateMove("g9-g8(e5)");
        expect(results.valid).to.be.true;
        expect(results.complete).equal(1);

        // Meeting detected after placing a marker after blChange
        g = new PacruGame(bugstate2);
        results = g.validateMove("h3-f3(f3)");
        expect(results.valid).to.be.true;
        expect(results.complete).equal(-1);
    });

    it("Cell validation edge cases", () => {
        // combination capture + blChange + meeting
        const graph = new PacruGraph();
        const g = old2PStart();
        for (const cell of graph.ctr2cells("b5")) {
            g.board.set(cell, {tile: 2});
        }
        g.board.set("d3", {chevron: {owner: 1, facing: "N"}});
        g.board.set("e3", {chevron: {owner: 1, facing: "N"}});
        g.board.set("e4", {chevron: {owner: 2, facing: "N"}});
        g.board.set("e5", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("i8", {tile: 1});
        let result = g.validateMove("e3xe4(e6, i9)");
        expect(result.valid).to.be.true;
        expect(result.complete).equal(1);
        // move the first claim to outside the bl
        result = g.validateMove("e3xe4(e7, i9)");
        expect(result.valid).to.be.false;
        // try to claim the cell you just captured
        result = g.validateMove("e3xe4(e4, i9)");
        expect(result.valid).to.be.false;
        // try to claim an occupied cell
        result = g.validateMove("e3xe4(e6, g9)");
        expect(result.valid).to.be.false;
        // try to claim too many cells
        result = g.validateMove("e3xe4(e6, i9, i8)");
        expect(result.valid).to.be.false;
        // try to claim your own tile
        result = g.validateMove("e3xe4(e6, i8)");
        expect(result.valid).to.be.false;
    });

    it("Connection change bug", () => {
        const g = new PacruGame(bugstate);
        const results = g.validateMove("f7-i4(*)");
        expect(results.valid).to.be.true;
        expect(results.complete).equal(1);
    });
});

const bugstate = `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`;

const bugstate2 = `H4sIAAAAAAAAA+2cyW7jOBCG34UnzcAkxEWb73OcvnQDA0wQBNQujJfAdhI0DL/7kEnMxJtYaslO0ubNsimaJr/6q4pFeY0qOS3QGN3LbPGARmj2ML2fyJ/FYonGbIQe5aKRs5W6uLkdPbedPxYLNC7lZFmM0FMzm+lL/eFyJbP/1Ms1ulNNls18prplPgt85geq57tFsXyYbLu6WzXTQt0yvX9thX2GqfjB6JgHYxqQ0I//VXdlD4vFy4DQmI5QOpeLHI3XKJcr+ePnvR763/Ie6ZFOHtTVzQ2SHI3WKKuLx4UewxrNn2avt5cya2aVuucvtNncjm5QQe1tv722bQD9/rNtm9jbft82ltHxxuzYgE90/L7t9+0gAP2aMZyYiPdtvz0P4nazGQHWeI1WL8szVcSoj8rFfKqu9OKg1Vy9SjnatIMQ8DGlhAfhPghqUBO5XD33rLvEqe4VwoZb787rrRqnUIvqyQbdsiEZhA1G4iQ5IhLv2aBY9eXY6MQGeLn1eBmAo/5opEY2MpBscJLwAzR2ZSPlOHOy0VU2oMut2mYXUg1mVAOEhiCJOPAoe6rBsHRodEQDvNyj0yHawKqRGdXIFRoj0yqbyGaqPnqqi4W+LiDgMEqCOGjXlIzjnHsF/8PB01FXoECotnmX+P657aqZqPmmw8WuUrThpD+148SJiIRFhziWwpPC4dQRpx6I6F8g3t5RvZ9dpvT0vnBVxxByAiLiA3J2hahJsOrrY6m5RhDUTXreYcbSU40ik0mHrWoUApjiCaGRb1GjCKehJ8OPVqOrZEWnZSHgd5sIK3w3nL6oFSYxLyGJuWDE51G7QBUUl9DE3MFxXjjUO+WJvG7HVodI1oQJodpFK4BwprJ8YRMtgWXo/QnVrN8MtUtyBMUajpr+hmBAGSvNTkHF2uCrKAS+mNCQtotcyXDFvIo6+j4NfXtAqXcqAI/br6zokOlkaLQwatXCCIBjwAjn3KKFIZaRJyOH42Wc6qCsmYTqcnnpcwb5kpeCEFTuOD4o2u4qYh3jOrpi/L48UdqETswf3Z/rnkmH2RXJIbsiQUSixLKvXyQ4h+6KdNofc0Rdhig9fycEnB0IeD/8KhMs1pDqQKA3UCw5b8VwDS0rXS9+nxkp3TFgAofIlHPjfLPW6DBLrHSKsU8Js0WHeYyzyMuSc0SHjtB+hMKh04VYwGQbnLNkwAS7NgWyprVAVtu3pBWzgrDEoqg1x43wavCWtGP2csz2wVBPv+iAfB3u/LyhCitaW09TnNrDUkVxQMLAlpdHOEvOs0d5TRBfkFCrvWx/Vh+K9RTGQ6qz4bpu3Xuv7ccXFNcxEcxyGqaOcB16Nfj4ggO7BexPDeuxrzhmcXs8627EgMqdvW0ZtCp3DomZKSURPdjg31XuLMF54uUuZv5Ywj8LvXoluljeAGlibYoIdXvIbS+oCn1sOmCWpy3qENfCBStfm3gIzlCr6E68/qZgZzQ9z8+9BTb2OoWiPCExPfZw2fvzc9F56hQO298J25Z840Czesq8OTdTt55kb+xHF8SYMxKHlqdjaoFr7jVnObrgjODcRvAhhAP3KU0ZdsizFG+5bQVxAVyQ8DDQofvZa+VcwNXT/+tE66m8kHcw++4lbc17Qd4hJn5iO8bBcUm93HmHq7ePHsyrtiXgEQEzTfmQDqMyDqNsLa+WkK0iQYnvs3Z3UkW4jLzyLFtFzmS+tsn0MQN9exeLG7Le23AEPyOjzEQQP7B4lobDz8g47B32v4Y9MLAbIDTLTUmibC1JFCA/E5AosfiZPMFlh2Kys6HL29CnNxCwkXc+oT2Q48mN4wH8dYPQz+oEtqNEOccF+D8/3huCbcPRwO5sxdnKB9hKaiqEKaQGGPiEMouPSUOcBpe1FYf/1eKv5y0ArNprsHa7+R89pMJu1VIAAA==`;