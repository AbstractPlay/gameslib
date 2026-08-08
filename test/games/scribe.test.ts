/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    ScribeGame,
    IScribeState,
    IMoveState,
    glyphScore,
    findGlyphMatches,
    playerid,
} from "../../src/games/scribe";

type BoardCell = [string, playerid];

function scribeFrom(opts: {
    board?: BoardCell[];
    last?: [string|undefined, string|undefined];
    miniwinners?: [string, playerid][];
    currplayer?: playerid;
    variants?: string[];
}): ScribeGame {
    const state: IScribeState = {
        game: "scribe",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack: [{
            _version: ScribeGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board ?? []),
            last: opts.last ?? [undefined, undefined],
            miniwinners: new Map(opts.miniwinners ?? []),
        } as IMoveState],
    };
    return new ScribeGame(state);
}

describe("Scribe", () => {
    it("allows any cell on a player's first turn", () => {
        const g = scribeFrom({
            board: [["e5", 1]],
            last: ["e5", undefined],
            currplayer: 2,
        });
        expect(g.moves()).to.include("a1");
        expect(g.moves()).to.include("i9");
        expect(g.moves().length).to.equal(80);
    });

    it("restricts later moves to the mapped mini grid", () => {
        const g = scribeFrom({
            board: [["e5", 1], ["a1", 2]],
            last: ["e5", "a1"],
            currplayer: 1,
        });
        const centreMini = ["d4", "e4", "f4", "d5", "f5", "d6", "e6", "f6"];
        for (const cell of centreMini) {
            expect(g.moves()).to.include(cell);
        }
        expect(g.moves()).to.not.include("a1");
        expect(g.moves()).to.not.include("i9");
    });

    it("allows any empty cell when the mapped mini grid is full", () => {
        const centreMini = ["d4", "e4", "f4", "d5", "e5", "f5", "d6", "e6", "f6"];
        const board: BoardCell[] = centreMini.map(cell => [cell, 1] as BoardCell);
        const g = scribeFrom({
            board,
            last: ["e5", undefined],
            currplayer: 1,
        });
        expect(g.moves().length).to.equal(81 - centreMini.length);
        expect(g.moves()).to.include("a1");
        expect(g.moves()).to.include("i9");
    });

    it("renders when last placements are null after deserialization", () => {
        const g = scribeFrom({board: [["e5", 1]]});
        g.last = [null, null] as unknown as [string|undefined, string|undefined];
        expect(() => g.render()).to.not.throw();
    });

    it("scores singles without double-counting subsets", () => {
        const cells = new Set(["0,0", "2,0", "1,2"]);
        expect(glyphScore(cells)).to.equal(3);
        expect(findGlyphMatches(cells).every(m => m.glyph.name === "Single")).to.be.true;
    });

    it("prefers a pipe over embedded doubles", () => {
        const pipe = new Set(["2,0", "0,1", "1,1", "2,1"]);
        expect(glyphScore(pipe)).to.equal(4);
        expect(findGlyphMatches(pipe).some(m => m.glyph.name === "Pipe")).to.be.true;
        expect(findGlyphMatches(pipe).some(m => m.glyph.name === "Double")).to.be.false;
    });

    it("awards a completed mini grid to the higher glyph score", () => {
        const topLeft: string[] = [];
        for (let ly = 0; ly < 3; ly++) {
            for (let lx = 0; lx < 3; lx++) {
                topLeft.push(ScribeGame.coords2algebraic(lx, ly));
            }
        }
        const board: BoardCell[] = [
            [topLeft[0]!, 1], [topLeft[1]!, 1], [topLeft[2]!, 1], [topLeft[3]!, 1],
            [topLeft[4]!, 2], [topLeft[5]!, 2], [topLeft[6]!, 2], [topLeft[7]!, 2],
        ];
        const g = scribeFrom({board, currplayer: 1});
        g.move(topLeft[8]!, {trusted: true});
        expect(g.miniwinners.get("0,0")).to.equal(1);
    });

    it("ends the standard game with the most mini grids won", () => {
        const winners: [string, playerid][] = [];
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 3; x++) {
                winners.push([`${x},${y}`, x + y < 4 ? 1 : 2]);
            }
        }
        const board: BoardCell[] = [];
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                board.push([ScribeGame.coords2algebraic(x, y), ((x + y) % 2) + 1 as playerid]);
            }
        }
        const g = scribeFrom({board, miniwinners: winners, currplayer: 1});
        (g as unknown as {checkEOG(): ScribeGame}).checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("renders with board reference and flood markers", () => {
        const g = scribeFrom({
            board: [["e5", 1], ["a1", 2]],
            last: ["e5", "a1"],
            miniwinners: [["1,1", 1]],
        });
        const rep = g.render();
        expect((rep.board as {reference?: {source?: string}}).reference?.source).to.equal("scribe-chart");
        const markers = (rep.board as {markers?: {type: string; points?: {tileRow?: number; corner?: string}[]}[]}).markers ?? [];
        expect(markers.some(m => m.type === "flood")).to.be.true;
        const lines = markers.filter(m => m.type === "line");
        expect(lines.length).to.equal(4);
        expect(lines.every(m => m.points?.[0]?.tileRow !== undefined && m.points?.[0]?.corner !== undefined)).to.be.true;
        expect(rep.annotations?.some(a => "type" in a && a.type === "dots")).to.be.true;
    });
});
