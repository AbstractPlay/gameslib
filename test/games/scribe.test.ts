/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    ScribeGame,
    IScribeState,
    IMoveState,
    SCRIBE_GLYPHS,
    glyphScore,
    findGlyphMatches,
    scoringGlyphMatches,
    formationWhat,
    playerid,
} from "../../src/games/scribe";

const SCRIBE_SMALL_GLYPHS = ["Single", "Double", "Line", "Pipe", "Squat-T"] as const;

function localCellsFromKeys(keys: string[]): Set<string> {
    return new Set(keys);
}

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
        expect(findGlyphMatches(cells).filter(m => m.glyph.name === "Single").length).to.equal(3);
    });

    it("scores zero when a connected group is not an exact glyph", () => {
        const cells = new Set(["0,2", "1,0", "1,1", "1,2", "2,1", "2,2"]);
        expect(glyphScore(cells)).to.equal(0);
        expect(scoringGlyphMatches(cells)).to.deep.equal([]);
    });

    it("scores an exact glyph for a connected group", () => {
        const pipe = new Set(["2,0", "0,1", "1,1", "2,1"]);
        expect(glyphScore(pipe)).to.equal(4);
        expect(formationWhat(scoringGlyphMatches(pipe))).to.equal("Pipe");
    });

    it("scores separate groups independently like figure 3", () => {
        const cells = new Set(["0,0", "2,0", "0,2", "2,2"]);
        expect(glyphScore(cells)).to.equal(4);
        expect(scoringGlyphMatches(cells).every(m => m.glyph.name === "Single")).to.be.true;
    });

    it("does not score a pipe that is only a subset of a larger group", () => {
        const sixBlock = new Set(["0,0", "1,0", "2,0", "0,1", "1,1", "2,1"]);
        expect(glyphScore(sixBlock)).to.equal(6);
        expect(formationWhat(scoringGlyphMatches(sixBlock))).to.equal("6-block");
    });

    it("prefers a pipe over embedded doubles", () => {
        const pipe = new Set(["2,0", "0,1", "1,1", "2,1"]);
        expect(glyphScore(pipe)).to.equal(4);
        expect(scoringGlyphMatches(pipe).some(m => m.glyph.name === "Pipe")).to.be.true;
        expect(scoringGlyphMatches(pipe).some(m => m.glyph.name === "Double")).to.be.false;
    });

    it("recognizes pipe after reflection and translation toward the left column", () => {
        const pipe = new Set(["0,0", "0,1", "0,2", "1,2"]);
        expect(glyphScore(pipe)).to.equal(4);
        expect(formationWhat(scoringGlyphMatches(pipe))).to.equal("Pipe");
    });

    it("recognizes pipe on the opposite side of the mini grid", () => {
        const pipe = new Set(["1,2", "2,0", "2,1", "2,2"]);
        expect(formationWhat(scoringGlyphMatches(pipe))).to.equal("Pipe");
    });

    it("recognizes line along the b-file (off-centre vertical)", () => {
        const line = localCellsFromKeys(["1,0", "1,1", "1,2"]);
        expect(formationWhat(scoringGlyphMatches(line))).to.equal("Line");
        expect(glyphScore(line)).to.equal(3);
    });

    it("recognizes squat-T with the bar on the middle row", () => {
        const squat = localCellsFromKeys(["0,1", "1,1", "2,1", "1,2"]);
        expect(formationWhat(scoringGlyphMatches(squat))).to.equal("Squat-T");
        expect(glyphScore(squat)).to.equal(4);
    });

    it("recognizes double on the middle row toward the right", () => {
        const dbl = localCellsFromKeys(["1,1", "2,1"]);
        expect(formationWhat(scoringGlyphMatches(dbl))).to.equal("Double");
        expect(glyphScore(dbl)).to.equal(2);
    });

    it("recognizes single on the centre cell", () => {
        const single = localCellsFromKeys(["1,1"]);
        expect(formationWhat(scoringGlyphMatches(single))).to.equal("Single");
        expect(glyphScore(single)).to.equal(1);
    });

    it("scores every distinct in-bounds placement of Single, Double, Line, Pipe, and Squat-T", () => {
        const full = new Set<string>();
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                full.add(`${c},${r}`);
            }
        }
        const values = new Map(SCRIBE_SMALL_GLYPHS.map((name) => {
            const def = SCRIBE_GLYPHS.find(g => g.name === name);
            return [name, def!.value] as const;
        }));
        const placementCount = new Map<string, number>();
        const seen = new Set<string>();

        for (const m of findGlyphMatches(full)) {
            if (!(SCRIBE_SMALL_GLYPHS as readonly string[]).includes(m.glyph.name)) { continue; }
            const cellSet = new Set(m.cells.map(([c, r]) => `${c},${r}`));
            const placementKey = `${m.glyph.name}|${[...cellSet].sort().join("|")}`;
            if (seen.has(placementKey)) { continue; }
            seen.add(placementKey);
            placementCount.set(m.glyph.name, (placementCount.get(m.glyph.name) ?? 0) + 1);

            expect(formationWhat(scoringGlyphMatches(cellSet)), placementKey)
                .to.equal(m.glyph.name);
            expect(glyphScore(cellSet), placementKey).to.equal(values.get(m.glyph.name));
        }

        for (const name of SCRIBE_SMALL_GLYPHS) {
            expect(placementCount.get(name), `${name} placement count`).to.be.greaterThan(0);
        }
        // Pipe had 12 placements with only non-negative dc/dr; negative translation adds more.
        expect(placementCount.get("Pipe"), "Pipe placements").to.be.greaterThan(12);
        expect(seen.has("Pipe|0,0|0,1|0,2|1,2"), "left-column pipe").to.be.true;
    });

    it("awards bottom-left mini to P2 when a3 completes the pipe and double", () => {
        const board: BoardCell[] = [
            ["e5", 1], ["h5", 2], ["d5", 1], ["f5", 2], ["b4", 1], ["h4", 2], ["f2", 1], ["d2", 2], ["h6", 1],
            ["b5", 2], ["e8", 1], ["f6", 2], ["e6", 1], ["h8", 2], ["f8", 1], ["e4", 2], ["g5", 1], ["e2", 2],
            ["a5", 1], ["d6", 2], ["b6", 1], ["b8", 2], ["e7", 1], ["f4", 2], ["f1", 1], ["g2", 2], ["i2", 1],
            ["c5", 2], ["i5", 1], ["g4", 2], ["i6", 1], ["c2", 2], ["h7", 1], ["i4", 2], ["f3", 1], ["g1", 2],
            ["g7", 1], ["a2", 2], ["b3", 1], ["c6", 2], ["e9", 1], ["g8", 2], ["d8", 1], ["c4", 2], ["a6", 1],
            ["g3", 2], ["a7", 1], ["b7", 2], ["b2", 1], ["d1", 2], ["d4", 1], ["b1", 2], ["c1", 1], ["d3", 2],
            ["h2", 1], ["c8", 2], ["i7", 1], ["g6", 2], ["i3", 1], ["b9", 2], ["i8", 1], ["f7", 2], ["i9", 1],
            ["h3", 2], ["h9", 1], ["d9", 2], ["f9", 1], ["a8", 2], ["g9", 1], ["a4", 2], ["c9", 1], ["a1", 2],
            ["e1", 1], ["c3", 2], ["e3", 1], ["d7", 2], ["i1", 1],
        ];
        const g = scribeFrom({
            board,
            last: ["i1", "d7"],
            currplayer: 2,
            miniwinners: [
                ["1,1", 2], ["2,1", 2], ["2,0", 1], ["0,1", 2], ["1,2", 2], ["1,0", 2],
            ],
        });
        g.move("a3", {trusted: true});
        expect(g.miniwinners.get("0,2")).to.equal(2);
        const claim = g.stack[g.stack.length - 1]!._results.find(r => r.type === "claim");
        expect(claim?.who).to.equal(2);
        expect(claim?.what).to.equal("Pipe|Double");
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
        const claim = g.stack[g.stack.length - 1]!._results.find(r => r.type === "claim");
        const p1Cells = new Set<string>();
        for (const cell of ScribeGame.cellsInMini(0, 0)) {
            if (g.board.get(cell) === 1) {
                const [lx, ly] = ScribeGame.localInMini(cell);
                p1Cells.add(`${lx},${ly}`);
            }
        }
        expect(glyphScore(p1Cells)).to.equal(5);
        expect(claim?.what).to.equal(formationWhat(scoringGlyphMatches(p1Cells)));
    });

    it("announces both players' super formations at the end of the advanced game", () => {
        const winners: [string, playerid][] = [
            ["0,0", 1], ["1,0", 1], ["2,0", 1],
            ["0,1", 2], ["1,1", 2], ["2,1", 2],
            ["0,2", 1], ["1,2", 2], ["2,2", 1],
        ];
        const board: BoardCell[] = [];
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                board.push([ScribeGame.coords2algebraic(x, y), ((x + y) % 2) + 1 as playerid]);
            }
        }
        const g = scribeFrom({board, miniwinners: winners, currplayer: 1, variants: ["advanced"]});
        (g as unknown as {checkEOG(): ScribeGame}).checkEOG();
        const announce = g.results.find(r => r.type === "announce");
        expect(announce?.payload).to.deep.equal([
            {player: 1, formations: formationWhat(scoringGlyphMatches(new Set(["0,0", "1,0", "2,0", "0,2", "2,2"])))},
            {player: 2, formations: formationWhat(scoringGlyphMatches(new Set(["0,1", "1,1", "2,1", "1,2"])))},
        ]);
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
        const markers = (rep.board as {markers?: {type: string; points?: {tileRow?: number; corner?: string}[]}[]}).markers ?? [];
        expect(markers.some(m => m.type === "flood")).to.be.true;
        const lines = markers.filter(m => m.type === "line");
        expect(lines.length).to.equal(4);
        expect(lines.every(m => m.points?.[0]?.tileRow !== undefined && m.points?.[0]?.corner !== undefined)).to.be.true;
        expect(rep.annotations?.some(a => "type" in a && a.type === "dots")).to.be.true;
    });
});
