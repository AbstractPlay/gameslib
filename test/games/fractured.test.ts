/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    CITIES,
    FracturedGame,
    IFracturedState,
    IMoveState,
    SIZE_COLOUR,
    TRACK_CENTER,
    playerid,
} from "../../src/games/fractured";

type BoardCell = [string, playerid];

function fracturedFrom(opts: {
    board?: BoardCell[];
    reserve?: [number, number];
    scoreIndex?: number;
    currplayer?: playerid;
    gameover?: boolean;
    winner?: playerid[];
}): FracturedGame {
    const state: IFracturedState = {
        game: "fractured",
        numplayers: 2,
        variants: [],
        gameover: opts.gameover ?? false,
        winner: opts.winner ?? [],
        stack: [{
            _version: FracturedGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board ?? []),
            reserve: opts.reserve ?? [15, 16],
            scoreIndex: opts.scoreIndex ?? TRACK_CENTER,
        } as IMoveState],
    };
    return new FracturedGame(state);
}

function openSize2Cell(g: FracturedGame): string {
    for (const cell of g.graph.graph.nodes()) {
        if (g.cellSize(cell) === 2 && !g.board.has(cell)) {
            return cell.toLowerCase();
        }
    }
    throw new Error("no size-2 cell");
}

describe("FracturedFlatGame", () => {
    it("starts with P1 reserve 15, P2 reserve 16, centred score track, empty board", () => {
        const g = new FracturedGame();
        expect(g.reserve).to.deep.equal([15, 16]);
        expect(g.scoreIndex).to.equal(TRACK_CENTER);
        expect(g.board.size).to.equal(0);
        expect(g.getPlayerScore(1)).to.equal(0);
        expect(g.getPlayerScore(2)).to.equal(0);
    });

    it("treats size-2 regions as always open and locks larger tiers until smaller tiers fill", () => {
        const g = new FracturedGame();
        const size3 = [...g.graph.graph.nodes()].find(c => g.cellSize(c) === 3)!;
        expect(g.isOpen(size3, 1)).to.be.false;

        for (const cell of g.graph.graph.nodes()) {
            if (g.cellSize(cell) === 2) {
                g.board.set(cell, 1);
            }
        }
        expect(g.isOpen(size3, 1)).to.be.true;
    });

    it("opens a tier for a player who already occupies that size", () => {
        const g = new FracturedGame();
        const size3cells = [...g.graph.graph.nodes()].filter(c => g.cellSize(c) === 3);
        g.board.set(size3cells[0]!, 1);
        expect(g.isOpen(size3cells[1]!, 1)).to.be.true;
        expect(g.isOpen(size3cells[1]!, 2)).to.be.false;
    });

    it("rejects illegal placements and accepts open empty cells", () => {
        const g = new FracturedGame();
        const place = openSize2Cell(g);
        expect(g.validateMove(place).valid).to.be.true;

        g.board.set(place.toUpperCase(), 2);
        expect(g.validateMove(place).valid).to.be.false;

        const g2 = fracturedFrom({ reserve: [0, 16], currplayer: 1 });
        expect(g2.validateMove(place).valid).to.be.false;
    });

    it("only allows moves to empty adjacent cells one size larger", () => {
        const g = new FracturedGame();
        let from: string|undefined;
        let to: string|undefined;
        for (const cell of g.graph.graph.nodes()) {
            const dests = g.validDestinations(cell);
            if (dests.length > 0) {
                from = cell;
                to = dests[0];
                break;
            }
        }
        expect(from).to.not.equal(undefined);
        expect(to).to.not.equal(undefined);

        g.board.set(from!, 1);
        const move = `${from!.toLowerCase()}-${to!.toLowerCase()}`;
        expect(g.moves()).to.include(move);

        g.board.set(to!, 2);
        expect(g.moves()).to.not.include(move);
    });

    it("scores cities and adjacent enemies and shifts the shared track marker", () => {
        const g = fracturedFrom({
            board: [["B4", 2]],
            currplayer: 1,
        });
        const before = g.scoreIndex;
        g.move("a2");
        expect(g.getPlayerScore(1)).to.equal(TRACK_CENTER - g.scoreIndex);
        expect(g.scoreIndex).to.be.lessThan(before);
        expect(g.board.has("A2")).to.be.true;
    });

    it("ends when a player places their last stone", () => {
        const g = fracturedFrom({
            reserve: [1, 16],
            currplayer: 1,
        });
        const place = openSize2Cell(g);
        g.move(place);
        expect(g.gameover).to.be.true;
        expect(g.reserve[0]).to.equal(0);
    });

    it("awards track overflow wins to the scoring player", () => {
        const g = fracturedFrom({
            board: [["B4", 2]],
            scoreIndex: 0,
            currplayer: 1,
            reserve: [10, 16],
        });
        g.move("a2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
        const rep = g.render();
        const track = rep.areas![0] as {
            pieces?: string;
            annotations?: Array<{ type: string; targets: Array<{ col: number }> }>;
        };
        expect(track.pieces).to.not.include("S");
        expect(track.annotations).to.have.length(1);
        expect(track.annotations![0]!.type).to.equal("exit");
        expect(track.annotations![0]!.targets[0]!.col).to.equal(0);
    });

    it("resolves a zero tie in favour of P1 at game end", () => {
        const g = fracturedFrom({
            reserve: [10, 1],
            currplayer: 2,
            scoreIndex: TRACK_CENTER,
        });
        g.move("a3");
        expect(g.gameover).to.be.true;
        expect(g.scoreIndex).to.equal(TRACK_CENTER);
        expect(g.winner).to.deep.equal([1]);
    });

    it("renders fractured-flat board with track area and size floods", () => {
        const g = new FracturedGame();
        const rep = g.render();
        const board = rep.board as { style: string; markers?: Array<{ type: string; colour?: number; points?: unknown[] }> };
        expect(board.style).to.equal("fractured-flat");
        expect(rep.areas).to.have.length(1);
        expect(rep.areas![0]!.type).to.equal("track");

        const floods = board.markers?.filter(m => m.type === "flood") ?? [];
        const colours = new Set(floods.map(m => m.colour));
        for (const colour of Object.values(SIZE_COLOUR)) {
            expect(colours.has(colour)).to.be.true;
        }

        const cities = board.markers?.filter(m => m.type === "glyph") ?? [];
        expect(cities).to.have.length(1);
        expect(cities[0]!.points?.length).to.equal(CITIES.size);

        const track = rep.areas![0] as { board: { markers?: Array<{ colour: number; points: Array<{ col: number }> }> }; pieces?: string };
        const trackFloods = track.board.markers ?? [];
        const p1Cols = new Set((trackFloods.find(m => m.colour === 6)?.points ?? []).map(p => p.col));
        const p2Cols = new Set((trackFloods.find(m => m.colour === 7)?.points ?? []).map(p => p.col));
        expect([...p1Cols]).to.deep.equal([0, 1, 2, 3, 4, 5]);
        expect([...p2Cols]).to.deep.equal([7, 8, 9, 10, 11, 12]);
        expect(track.pieces?.split(",")[TRACK_CENTER]).to.equal("S");
    });

    it("adds a track annotation for the scoring shift on the current turn", () => {
        const g = fracturedFrom({
            board: [["B4", 2]],
            currplayer: 1,
        });
        g.move("a2");
        const rep = g.render();
        const track = rep.areas![0] as { annotations?: Array<{ type: string; targets: Array<{ col: number }> }> };
        expect(track.annotations).to.have.length(1);
        expect(track.annotations![0]!.type).to.equal("move");
        const cols = track.annotations![0]!.targets.map(t => t.col);
        expect(cols[0]).to.be.greaterThan(cols[1]!);
    });
});
