/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { TableroGame, type IMoveState, type ITableroState } from "../../src/games/tablero.js";
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { Glyph } from "@abstractplay/renderer/build/schemas/schema";

function moveState(overrides: Partial<IMoveState> = {}): IMoveState {
    return {
        _version: TableroGame.gameinfo.version,
        _results: [],
        _timestamp: new Date(),
        currplayer: 1,
        board: new Map(),
        pieces: [12, 12],
        roll: [3, 4],
        ...overrides,
    };
}

function gameFrom(partial: Partial<ITableroState> & Pick<ITableroState, "stack">): TableroGame {
    return new TableroGame({
        game: "tablero",
        numplayers: 2,
        variants: partial.variants ?? [],
        gameover: partial.gameover ?? false,
        winner: partial.winner ?? [],
        stack: partial.stack,
        spaceScores: partial.spaceScores,
    });
}

function scoreTileLegend(rep: APRenderRep, col: number): Glyph[] | undefined {
    const entry = rep.legend![`TS${col}`];
    return Array.isArray(entry) ? entry as Glyph[] : undefined;
}

describe("Tablero", () => {
    it("addVar: scoring uses stored space scores; column die mapping unchanged", () => {
        const g = gameFrom({
            variants: ["addVar"],
            spaceScores: [4, 9, 5, 7, 8, 10],
            stack: [
                moveState({
                    board: new Map([
                        ["a2", [1]],
                        ["c2", [2]],
                    ]),
                }),
            ],
        });
        expect(g.getPlayerScore(1)).to.equal(4);
        expect(g.getPlayerScore(2)).to.equal(5);
        const colCMoves = g.getFirstMoves(3).filter(m => m === "+c1" || m.startsWith("c1-"));
        expect(colCMoves.length).to.be.greaterThan(0);
        expect(g.getFirstMoves(3).some(m => m.startsWith("+a"))).to.be.false;
    });

    it("setVar: duplicate score values do not share a column die", () => {
        const g = gameFrom({
            variants: ["setVar"],
            spaceScores: [3, 2, 3, 5, 1, 6],
            stack: [moveState({roll: [3, 1]})],
        });
        expect(g.getPlayerScore(1)).to.equal(0);
        const threes = g.getFirstMoves(3).filter(m => m.startsWith("+"));
        expect(threes).to.deep.equal(["+c1"]);
        expect(g.getFirstMoves(3).some(m => m.startsWith("+a"))).to.be.false;
    });

    it("getHighestSpace: tiebreak by space score then rightmost column", () => {
        const g = gameFrom({
            variants: ["setVar"],
            spaceScores: [3, 2, 3, 5, 1, 6],
            stack: [
                moveState({
                    board: new Map([
                        ["a2", [1]],
                        ["c2", [2]],
                    ]),
                }),
            ],
        });
        expect(g.getHighestSpace()).to.equal(2);
    });

    it("5-10: decktet-style score tile on center cells", () => {
        const g = gameFrom({
            variants: ["5-10"],
            stack: [moveState()],
        });
        const layers = scoreTileLegend(g.render(), 0)!;
        expect(layers[0].name).to.equal("piece-square-borderless");
        expect(layers[0].opacity).to.equal(0);
        expect(layers[1].name).to.equal("d6-1");
        expect(layers[1].scale).to.equal(0.32);
        expect(layers[2].text).to.equal("5");
        expect(layers[2].orientation).to.equal("vertical");
    });

    it("default: center row die markers use paint; no score tiles", () => {
        const g = gameFrom({stack: [moveState()]});
        const rep = g.render();
        const td0 = rep.legend!.TD0 as {paint?: {fill?: unknown; border?: unknown; detail?: unknown}};
        expect(td0.paint?.fill).to.exist;
        expect(rep.legend!.TS0).to.be.undefined;
    });

    it("setVar: decktet-style tiles on every center cell", () => {
        const g = gameFrom({
            variants: ["setVar"],
            spaceScores: [5, 1, 2, 4, 5, 4],
            stack: [moveState()],
        });
        const rep = g.render();
        for (let col = 0; col < 6; col++) {
            expect(scoreTileLegend(rep, col)?.[2]?.text).to.equal(String(g.spaceScore(col)));
        }
        expect(rep.legend!.TD0).to.be.undefined;
    });

    it("setVar: prints space score on centre stack top with bestContrast text", () => {
        const g = gameFrom({
            variants: ["setVar"],
            spaceScores: [5, 1, 2, 4, 5, 4],
            stack: [
                moveState({
                    board: new Map([["a2", [1, 2, 1]]]),
                }),
            ],
        });
        const rep = g.render();
        const topKey = String.fromCharCode("C".charCodeAt(0));
        expect(rep.pieces).to.contain(`AB${topKey}`);
        const legend = rep.legend![topKey] as Glyph[];
        expect(legend[1].text).to.equal("5");
        expect(legend[1].colour).to.deep.equal({func: "bestContrast", bg: 1, fg: ["#fff", "#000"]});
    });

    it("default: centre stacks use plain A/B without score overlay", () => {
        const g = gameFrom({
            stack: [moveState({board: new Map([["a2", [1, 2, 1]]])})],
        });
        const rep = g.render();
        expect(rep.pieces).to.contain("ABA");
        expect(rep.legend!.C).to.be.undefined;
    });

    it("state() round-trips spaceScores", () => {
        const scores = [4, 9, 5, 7, 8, 10] as const;
        const g = gameFrom({
            variants: ["addVar"],
            spaceScores: [...scores],
            stack: [moveState()],
        });
        expect(g.state().spaceScores).to.deep.equal([...scores]);
    });
});
