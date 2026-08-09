/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { HexTriGraph } from "../../src/common/graphs";
import {
    CircleOfLifeGame,
    ICircleOfLifeState,
    IMoveState,
    playerid,
} from "../../src/games/circleOfLife";
import {
    CAPTURE_THRESHOLD,
    SPECIES_COUNT,
    preyIndex,
    speciesIndex,
    speciesKeys,
} from "../../src/games/circleOfLife/species";
import { filledEcosystemWin } from "../fixtures/circleOfLife";
import { CIRCLE_OF_LIFE_RING_SPECIES_KEYS } from "../fixtures/circleOfLifeRing";

type BoardCell = [string, playerid];

function colFrom(opts: {
    board?: BoardCell[];
    currplayer?: playerid;
    scores?: [number, number];
    lastSpecies?: number;
    lastSpeciesBy?: playerid;
}): CircleOfLifeGame {
    const state: ICircleOfLifeState = {
        game: "circleOfLife",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: [{
            _version: CircleOfLifeGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board ?? []),
            scores: opts.scores ?? [0, 0],
            lastSpecies: opts.lastSpecies,
            lastSpeciesBy: opts.lastSpeciesBy,
        } as IMoveState],
    };
    return new CircleOfLifeGame(state);
}

function connectedGroups(graph: HexTriGraph, size: number): string[][] {
    if (size === 1) {
        return (graph.listCells(false) as string[]).map(c => [c]);
    }
    const all = graph.listCells(false) as string[];
    const seen = new Set<string>();
    const results: string[][] = [];
    let frontier: string[][] = all.map(c => [c]);

    for (let s = 1; s < size; s++) {
        const next: string[][] = [];
        for (const group of frontier) {
            const groupSet = new Set(group);
            for (const cell of group) {
                for (const n of graph.neighbours(cell)) {
                    if (groupSet.has(n)) { continue; }
                    const grown = [...group, n].sort();
                    const key = grown.join(",");
                    if (seen.has(key)) { continue; }
                    seen.add(key);
                    next.push(grown);
                    if (grown.length === size) {
                        results.push(grown);
                    }
                }
            }
        }
        frontier = next;
    }
    return results;
}

function exampleSpeciesCells(graph: HexTriGraph): Map<number, string[]> {
    const examples = new Map<number, string[]>();
    for (let size = 1; size <= 4; size++) {
        for (const group of connectedGroups(graph, size)) {
            const index = speciesIndex(group, graph);
            if (!examples.has(index)) {
                examples.set(index, group);
            }
        }
    }
    return examples;
}

function predatorPrefix(species: number, graph: HexTriGraph, examples: Map<number, string[]>): string[] {
    const template = examples.get(species)!;
    if (template.length <= 1) {
        return template;
    }
    const prefix = template.slice(0, template.length - 1);
    const groupSet = new Set(prefix);
    for (const cell of prefix) {
        for (const n of graph.neighbours(cell)) {
            if (groupSet.has(n)) { continue; }
            const grown = [...prefix, n].sort();
            if (speciesIndex(grown, graph) === species) {
                return prefix;
            }
        }
    }
    throw new Error(`No predator prefix for species ${species}`);
}

function adjacentCaptureFixture(
    predatorSpecies: number,
    preySpecies: number,
    graph: HexTriGraph,
    examples: Map<number, string[]>,
): { predator: string[]; prey: string[]; placement: string } {
    const preyTemplate = examples.get(preySpecies)!;
    const predator = predatorPrefix(predatorSpecies, graph, examples);
    const groupSet = new Set(predator);

    for (const cell of predator) {
        for (const n of graph.neighbours(cell)) {
            if (groupSet.has(n)) { continue; }
            const grown = [...predator, n].sort();
            if (speciesIndex(grown, graph) !== predatorSpecies) { continue; }

            for (const group of connectedGroups(graph, preyTemplate.length)) {
                if (speciesIndex(group, graph) !== preySpecies) { continue; }
                if (group.some(c => predator.includes(c) || c === n)) { continue; }
                if (group.some(c => grown.some(p => graph.neighbours(c).includes(p)))) {
                    return { predator, prey: group, placement: n };
                }
            }
        }
    }
    throw new Error(`No adjacent fixture for species ${predatorSpecies} devouring ${preySpecies}`);
}

function adjacentSingletonPreyFixture(
    preySpecies: number,
    graph: HexTriGraph,
    examples: Map<number, string[]>,
): { prey: string[]; placement: string } {
    const prey = examples.get(preySpecies)!;
    for (const cell of graph.listCells(false) as string[]) {
        if (prey.includes(cell)) { continue; }
        if (speciesIndex([cell], graph) !== 0) { continue; }
        if (prey.some(p => graph.neighbours(p).includes(cell))) {
            return { prey, placement: cell };
        }
    }
    throw new Error(`No singleton placement adjacent to species ${preySpecies}`);
}

describe("Circle of Life species", () => {
    const graph = new HexTriGraph(5, 9);

    it("defines twelve distinct species keys", () => {
        expect(speciesKeys().length).to.equal(SPECIES_COUNT);
        expect(new Set(speciesKeys()).size).to.equal(SPECIES_COUNT);
        expect(speciesKeys()).to.deep.equal(CIRCLE_OF_LIFE_RING_SPECIES_KEYS);
    });

    it("classifies one example per species index", () => {
        const examples = exampleSpeciesCells(graph);
        expect(examples.size).to.equal(SPECIES_COUNT);
        for (let i = 0; i < SPECIES_COUNT; i++) {
            expect(examples.has(i), `missing example for species ${i}`).to.be.true;
            expect(speciesIndex(examples.get(i)!, graph)).to.equal(i);
        }
    });

    it("maps prey indices along the food chain", () => {
        expect(preyIndex(0)).to.equal(11);
        expect(preyIndex(1)).to.equal(0);
        expect(preyIndex(5)).to.equal(4);
    });
});

describe("Circle of Life", () => {
    const graph = new HexTriGraph(5, 9);
    const speciesExamples = exampleSpeciesCells(graph);

    it("allows opening placement on an empty hex", () => {
        const g = new CircleOfLifeGame();
        expect(g.moves().length).to.be.greaterThan(0);
        const after = g.move(g.moves()[0]!);
        expect(after.board.size).to.equal(1);
    });

    it("rejects placements that would exceed four stones", () => {
        const species4 = speciesExamples.get(5)!;
        const extra = graph.neighbours(species4[0]).find(n => !species4.includes(n))!;
        const g = colFrom({
            board: species4.map(c => [c, 1] as BoardCell),
            currplayer: 1,
        });
        expect(g.moves()).to.not.include(extra);
        const result = g.validateMove(extra);
        expect(result.valid).to.be.false;
    });

    it("species 5 devours adjacent opponent species 4 on placement", () => {
        const { predator, prey, placement } = adjacentCaptureFixture(5, 4, graph, speciesExamples);

        const g = colFrom({
            board: [
                ...predator.map(c => [c, 1] as BoardCell),
                ...prey.map(c => [c, 2] as BoardCell),
            ],
            currplayer: 1,
        });
        const after = g.move(placement);
        expect(after.board.has(prey[0]!)).to.be.false;
        expect(after.getPlayerScore(1)).to.equal(prey.length);
        expect(after.lastmove).to.equal(`${placement}x`);
        expect(after.results.some(r => r.type === "capture" && r.what === "4")).to.be.true;
    });

    it("species 0 devours adjacent opponent species 11", () => {
        const { prey, placement } = adjacentSingletonPreyFixture(11, graph, speciesExamples);

        const g = colFrom({
            board: prey.map(c => [c, 2] as BoardCell),
            currplayer: 1,
        });
        const after = g.move(placement);
        expect(after.getPlayerScore(1)).to.equal(prey.length);
        expect(after.results.some(r => r.type === "capture" && r.what === "11")).to.be.true;
    });

    it("species 1 devours adjacent opponent species 0", () => {
        const { predator, prey, placement } = adjacentCaptureFixture(1, 0, graph, speciesExamples);

        const g = colFrom({
            board: [
                ...predator.map(c => [c, 1] as BoardCell),
                ...prey.map(c => [c, 2] as BoardCell),
            ],
            currplayer: 1,
        });
        const after = g.move(placement);
        expect(after.board.has(prey[0]!)).to.be.false;
        expect(after.results.some(r => r.type === "capture" && r.what === "0")).to.be.true;
    });

    it("does not devour prey without a qualifying placement", () => {
        const predator = speciesExamples.get(5)!;
        const prey = speciesExamples.get(4)!;

        const g = colFrom({
            board: [
                ...predator.map(c => [c, 1] as BoardCell),
                ...prey.map(c => [c, 2] as BoardCell),
            ],
            currplayer: 1,
        });
        const unrelated = g.moves().find(m =>
            !predator.includes(m) && !prey.includes(m) &&
            !prey.some(p => graph.neighbours(p).includes(m)),
        )!;
        expect(unrelated).to.not.be.undefined;

        const after = g.move(unrelated);
        expect(after.board.has(prey[0]!)).to.be.true;
        expect(after.getPlayerScore(1)).to.equal(0);
        expect(after.lastmove).to.equal(unrelated);
    });

    it("accepts capture notation with a trailing x", () => {
        const { predator, prey, placement } = adjacentCaptureFixture(5, 4, graph, speciesExamples);
        const g = colFrom({
            board: [
                ...predator.map(c => [c, 1] as BoardCell),
                ...prey.map(c => [c, 2] as BoardCell),
            ],
            currplayer: 1,
        });
        expect(g.validateMove(`${placement}x`).valid).to.be.true;
        const after = g.move(`${placement}x`);
        expect(after.lastmove).to.equal(`${placement}x`);
    });

    it("devours multiple adjacent prey groups of the same species", () => {
        const predator = predatorPrefix(5, graph, speciesExamples);
        const groupSet = new Set(predator);
        let placement = "";
        let preyCandidates: string[][] = [];

        for (const cell of predator) {
            for (const n of graph.neighbours(cell)) {
                if (groupSet.has(n)) { continue; }
                const grown = [...predator, n].sort();
                if (speciesIndex(grown, graph) !== 5) { continue; }
                const candidates = connectedGroups(graph, speciesExamples.get(4)!.length)
                    .filter(group => speciesIndex(group, graph) === 4)
                    .filter(group => group.some(c => grown.some(p => graph.neighbours(c).includes(p))))
                    .filter(group => !group.some(c => predator.includes(c) || c === n));
                if (candidates.length >= 2) {
                    placement = n;
                    preyCandidates = candidates;
                    break;
                }
            }
            if (placement) { break; }
        }
        expect(placement).to.not.equal("");
        const preyA = preyCandidates[0]!;
        const preyB = preyCandidates.find(g =>
            !g.some(c => preyA.includes(c)) &&
            !g.some(c => preyA.some(a => graph.neighbours(c).includes(a))),
        )!;
        expect(preyB).to.not.be.undefined;

        const g = colFrom({
            board: [
                ...predator.map(c => [c, 1] as BoardCell),
                ...preyA.map(c => [c, 2] as BoardCell),
                ...preyB.map(c => [c, 2] as BoardCell),
            ],
            currplayer: 1,
        });
        const after = g.move(placement);
        expect(after.getPlayerScore(1)).to.equal(preyA.length + preyB.length);
        const captures = after.results.filter(r => r.type === "capture");
        expect(captures.length).to.equal(2);
    });

    it("ends when a player reaches the capture threshold", () => {
        const { predator, prey, placement } = adjacentCaptureFixture(5, 4, graph, speciesExamples);

        const g = colFrom({
            board: [
                ...predator.map(c => [c, 1] as BoardCell),
                ...prey.map(c => [c, 2] as BoardCell),
            ],
            currplayer: 1,
            scores: [CAPTURE_THRESHOLD - 1, 0],
        });
        const after = g.move(placement);
        expect(after.gameover).to.be.true;
        expect(after.winner).to.deep.equal([1]);
        expect(after.getPlayerScore(1)).to.be.at.least(CAPTURE_THRESHOLD);
    });

    it("awards a win when the next player has no legal placements", () => {
        const { board, currplayer, move } = filledEcosystemWin;
        const after = colFrom({ board, currplayer }).move(move);
        expect(after.moves().length).to.equal(0);
        expect(after.gameover).to.be.true;
        expect(after.getPlayerScore(1)).to.be.lessThan(CAPTURE_THRESHOLD);
        expect(after.getPlayerScore(2)).to.be.lessThan(CAPTURE_THRESHOLD);
        expect(after.winner).to.deep.equal([after.currplayer]);
    });

    it("includes the annulus species reference in render output", () => {
        const g = new CircleOfLifeGame();
        const rep = g.render();
        const board = rep.board as {reference?: {source?: string; layout?: string}};
        expect(board.reference?.source).to.equal("circle-of-life-ring");
        expect(board.reference?.layout).to.equal("annulus");
    });

    it("highlights the last-formed species with the mover colour", () => {
        const g = colFrom({
            board: [
                ["i3", 2], ["i4", 2], ["i5", 2], ["h5", 2],
            ] as BoardCell[],
            currplayer: 1,
            lastSpecies: 5,
            lastSpeciesBy: 2,
        });
        const styles = (g.render().board as {reference?: {styles?: Record<string, unknown>}})
            .reference?.styles;
        expect(styles?.["species-5"]).to.equal(2);
    });

    it("classifies the bent tetrahex from h5 placement as species 5", () => {
        const group = ["i3", "i4", "i5", "h5"];
        expect(speciesIndex(group, graph)).to.equal(5);
    });

    it("classifies the bent trihex from g5 placement as species 4", () => {
        const group = ["f5", "g4", "g5"];
        expect(speciesIndex(group, graph)).to.equal(4);
    });

    it("classifies the f1 tetrahex chain as species 6", () => {
        const group = ["f1", "e2", "d2", "c1"];
        expect(speciesIndex(group, graph)).to.equal(6);
    });

    it("classifies the h3 tetrahex chain as species 8", () => {
        const group = ["h3", "h4", "g5", "i2"];
        expect(speciesIndex(group, graph)).to.equal(8);
    });

    it("matches the circle-of-life-ring overlay slot order", () => {
        expect(speciesKeys()).to.deep.equal(CIRCLE_OF_LIFE_RING_SPECIES_KEYS);
    });
});
