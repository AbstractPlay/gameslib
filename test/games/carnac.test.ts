/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { CarnacGame } from "../../src/games";

describe("Carnac", () => {
    it("opens with placement moves", () => {
        const g = new CarnacGame();
        expect(g.phase).to.equal("place");
        expect(g.moves().length).to.be.greaterThan(0);
        expect(g.moves()[0]).to.match(/^(11|12|21|22)-/);
    });

    it("alternates tip and place after first placement", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        expect(g.phase).to.equal("tip");
        expect(g.currplayer).to.equal(2);
        expect(g.pending).to.not.be.null;
    });

    it("allows pass instead of tip", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        g.move("pass");
        expect(g.phase).to.equal("place");
        expect(g.currplayer).to.equal(1);
        expect(g.pending).to.be.null;
        expect(g.board.has("a1")).to.be.true;
        expect(g.board.get("a1")).to.deep.equal({ kind: "stand", orient: "11" });
    });

    it("tips and places in one move", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        g.move(">n,11-a4");
        expect(g.currplayer).to.equal(1);
        expect(g.phase).to.equal("tip");
        expect(g.pending).to.not.be.null;
        expect(g.board.has("a1")).to.be.false;
        expect(g.board.has("a2")).to.be.true;
        expect(g.board.has("a3")).to.be.true;
        expect(g.board.has("a4")).to.be.true;
        expect(g.board.get("a4")).to.deep.equal({ kind: "stand", orient: "11" });
    });

    it("excludes tip target cells from post-tip placements", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        const northMoves = g.moves().filter(m => m.startsWith(">n,"));
        expect(northMoves.length).to.be.greaterThan(0);
        expect(northMoves).to.not.include(">n,11-a2");
        expect(northMoves).to.not.include(">n,11-a3");
        expect(northMoves).to.include(">n,11-a1");
    });

    it("validates partial tip with canrender", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        const result = g.validateMove(">n");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        expect(result.canrender).to.be.true;
    });

    it("tips using board-relative directions", () => {
        let g = new CarnacGame();
        g.move("11-a1");
        g.move(">n,11-a4");
        expect([...g.board.keys()].sort()).to.deep.equal(["a2", "a3", "a4"]);

        g = new CarnacGame();
        g.move("11-a3");
        g.move(">s,11-a6");
        expect([...g.board.keys()].sort()).to.deep.equal(["a1", "a2", "a6"]);

        g = new CarnacGame();
        g.move("12-a1");
        g.move(">e,12-d1");
        expect([...g.board.keys()].sort()).to.deep.equal(["b1", "c1", "d1"]);

        g = new CarnacGame();
        g.move("12-c1");
        g.move(">w,12-d1");
        expect([...g.board.keys()].sort()).to.deep.equal(["a1", "b1", "d1"]);
    });

    it("allows perpendicular tips regardless of placement", () => {
        const g = new CarnacGame();
        g.move("11-e4");
        expect(g.moves().some(m => m.startsWith(">e,"))).to.be.true;
        expect(g.moves().some(m => m.startsWith(">w,"))).to.be.true;
        expect(g.moves().some(m => m.startsWith(">n,"))).to.be.true;
        expect(g.moves().some(m => m.startsWith(">s,"))).to.be.true;
    });

    it("assigns tip colours from stacked cube geometry", () => {
        let g = new CarnacGame();
        g.move("12-a1");
        g.move(">n,12-a4");
        expect(g.scoringColour("a2")).to.equal(2);
        expect(g.scoringColour("a3")).to.equal(2);

        g = new CarnacGame();
        g.move("12-a3");
        g.move(">s,12-a6");
        expect(g.scoringColour("a2")).to.equal(2);
        expect(g.scoringColour("a1")).to.equal(2);

        g = new CarnacGame();
        g.move("12-a1");
        g.move(">e,12-d1");
        expect(g.scoringColour("b1")).to.equal(1);
        expect(g.scoringColour("c1")).to.equal(1);
    });

    it("stores lie orientation metadata on board", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        g.move(">n,11-a4");
        expect(g.board.get("a2")).to.deep.equal({ kind: "lie", orient: "11", tipDir: "N", slot: "near" });
        expect(g.board.get("a3")).to.deep.equal({ kind: "lie", orient: "11", tipDir: "N", slot: "far" });
    });

    it("lying cube faces for all orientations and tip directions", () => {
        const g = new CarnacGame();
        const cases: [string, string, { top: number; north: number; south: number; east: number; west: number }][] = [
            ["11", "N", { top: 1, north: 1, south: 2, east: 2, west: 2 }],
            ["11", "E", { top: 2, north: 1, south: 1, east: 1, west: 2 }],
            ["11", "S", { top: 1, north: 2, south: 1, east: 2, west: 2 }],
            ["11", "W", { top: 2, north: 1, south: 1, east: 2, west: 1 }],
            ["12", "N", { top: 2, north: 1, south: 2, east: 1, west: 1 }],
            ["12", "E", { top: 1, north: 2, south: 2, east: 1, west: 2 }],
            ["12", "S", { top: 2, north: 2, south: 1, east: 1, west: 1 }],
            ["12", "W", { top: 1, north: 2, south: 2, east: 2, west: 1 }],
            ["21", "N", { top: 1, north: 2, south: 1, east: 2, west: 2 }],
            ["21", "E", { top: 2, north: 1, south: 1, east: 2, west: 1 }],
            ["21", "S", { top: 1, north: 1, south: 2, east: 2, west: 2 }],
            ["21", "W", { top: 2, north: 1, south: 1, east: 1, west: 2 }],
            ["22", "N", { top: 2, north: 2, south: 1, east: 1, west: 1 }],
            ["22", "E", { top: 1, north: 2, south: 2, east: 2, west: 1 }],
            ["22", "S", { top: 2, north: 1, south: 2, east: 1, west: 1 }],
            ["22", "W", { top: 1, north: 2, south: 2, east: 1, west: 2 }],
        ];
        for (const [orient, tipDir, expected] of cases) {
            const o = orient as "11" | "12" | "21" | "22";
            const d = tipDir as "N" | "E" | "S" | "W";
            expect(g.lyingCubeFaces(o, d)).to.deep.equal(expected, `${orient} tipped ${tipDir}`);
        }
    });

    it("lying cube faces for 11 tipped north", () => {
        const g = new CarnacGame();
        const faces = { top: 1, north: 1, south: 2, east: 2, west: 2 };
        expect(g.lyingCubeFaces("11", "N")).to.deep.equal(faces);
    });

    it("lying cube faces for 11 tipped south", () => {
        const g = new CarnacGame();
        const faces = { top: 1, north: 2, south: 1, east: 2, west: 2 };
        expect(g.lyingCubeFaces("11", "S")).to.deep.equal(faces);
    });

    it("lying cube faces for 11 tipped east", () => {
        const g = new CarnacGame();
        const faces = { top: 2, north: 1, south: 1, east: 1, west: 2 };
        expect(g.lyingCubeFaces("11", "E")).to.deep.equal(faces);
    });

    it("lying cube faces for 22 tipped east preserves former top on east face", () => {
        const g = new CarnacGame();
        expect(g.lyingCubeFaces("22", "E")).to.deep.equal({
            top: 1, north: 2, south: 2, east: 2, west: 1,
        });
    });

    it("lying cube faces for other orientations", () => {
        const g = new CarnacGame();
        const east = { top: 1, north: 2, south: 2, east: 1, west: 2 };
        expect(g.lyingCubeFaces("12", "E")).to.deep.equal(east);
        const south = { top: 1, north: 1, south: 2, east: 2, west: 2 };
        expect(g.lyingCubeFaces("21", "S")).to.deep.equal(south);
        const west = { top: 1, north: 2, south: 2, east: 1, west: 2 };
        expect(g.lyingCubeFaces("22", "W")).to.deep.equal(west);
    });

    it("lying cube faces preserve colour when tipping east from standing", () => {
        const g = new CarnacGame();
        const tipped = g.lyingCubeFaces("22", "E");
        expect(tipped.east).to.equal(2);
        expect(tipped.west).to.equal(1);
        expect(tipped.top).to.equal(1);
    });

    it("restricts placements in enclosed holes to south-face-1 orientations", () => {
        const g = new CarnacGame();
        const lie = (orient: "11" | "12" | "21" | "22") => ({
            kind: "lie" as const, orient, tipDir: "N" as const, slot: "near" as const,
        });
        g.board.set("d4", lie("11"));
        g.board.set("f4", lie("11"));
        g.board.set("e3", lie("11"));
        g.board.set("e5", lie("11"));
        expect(g.moves()).to.include("11-e4");
        expect(g.moves()).to.include("21-e4");
        expect(g.moves()).to.not.include("12-e4");
        expect(g.moves()).to.not.include("22-e4");
    });

    it("skips tip phase when placing in a hole", () => {
        const g = new CarnacGame();
        const lie = (orient: "11" | "12" | "21" | "22") => ({
            kind: "lie" as const, orient, tipDir: "N" as const, slot: "near" as const,
        });
        g.board.set("d4", lie("11"));
        g.board.set("f4", lie("11"));
        g.board.set("e3", lie("11"));
        g.board.set("e5", lie("11"));
        g.move("11-e4", { trusted: true });
        expect(g.phase).to.equal("place");
        expect(g.currplayer).to.equal(2);
        expect(g.pending).to.be.null;
    });

    it("selects orientation from placement key clicks", () => {
        const g = new CarnacGame();
        expect(g.handleClick("", -1, -1, "11")).to.include({ valid: true, move: "11" });
        expect(g.handleClick("", -1, -1, "K3")).to.include({ valid: true, move: "21" });
        expect(g.handleClick("", -1, -1, "1")).to.include({ valid: true, move: "11" });
        expect(g.handleClick("", 6, 0, "11")).to.include({ valid: true, move: "11" });
        expect(g.handleClick("", 6, 0, "1")).to.include({ valid: true, move: "11" });
        expect(g.handleClick("11", 6, 0)).to.include({ valid: true, move: "11-a1" });
    });

    it("builds tip-and-place moves from clicks", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        const [col, row] = g.algebraic2coords("a7");
        const north = g.handleClick("", row, col);
        expect(north.valid).to.be.true;
        expect(north.move).to.equal(">n");

        const withOrient = g.handleClick(">n", -1, -1, "11");
        expect(withOrient.valid).to.be.true;
        expect(withOrient.move).to.equal(">n,11");

        const [pcol, prow] = g.algebraic2coords("a4");
        const placed = g.handleClick(">n,11", prow, pcol);
        expect(placed.valid).to.be.true;
        expect(placed.move).to.equal(">n,11-a4");

        const g2 = new CarnacGame();
        g2.move("11-a1");
        const [ecol, erow] = g2.algebraic2coords("j1");
        const east = g2.handleClick("", erow, ecol);
        expect(east.valid).to.be.true;
        expect(east.move).to.equal(">e");

        const g3 = new CarnacGame();
        g3.move("11-a1");
        const diag = g3.handleClick("", 0, 9);
        expect(diag.valid).to.be.false;
    });

    it("preserves valid tip after illegal post-tip placement click", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        const [ncol, nrow] = g.algebraic2coords("a7");
        g.handleClick("", nrow, ncol);
        g.handleClick(">n", -1, -1, "11");
        const [a2col, a2row] = g.algebraic2coords("a2");
        const illegal = g.handleClick(">n,11", a2row, a2col);
        expect(illegal.valid).to.be.false;
        expect(illegal.move).to.equal(">n");
        expect(illegal.canrender).to.be.true;

        const g2 = new CarnacGame();
        g2.move("11-a1");
        g2.handleClick("", nrow, ncol);
        const offRay = g2.handleClick(">n", 0, 9);
        expect(offRay.valid).to.be.false;
        expect(offRay.move).to.equal(">n");
    });

    it("renders flat view with comma-delimited multicharacter piece glyphs", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        const rep = g.render({ altDisplay: "flat" });
        const rows = (rep.pieces as string).split("\n");
        expect(rows).to.have.length(7);
        expect(rows.every(r => r.split(",").length === 10)).to.be.true;
        expect(rows.some(r => r.startsWith("C1,"))).to.be.true;
        const key = rep.areas![0] as { list: { piece: string; name: string; value: string }[] };
        expect(key.list).to.have.length(4);
        expect(key.list.map(e => e.value)).to.deep.equal(["11", "12", "21", "22"]);
    });

    it("renders isometric legend with unique cube face ids", () => {
        const g = new CarnacGame();
        g.move("11-a1");
        g.move("pass");
        g.move("12-b1");
        const rep = g.render();
        const legend = rep.legend as Record<string, unknown>;
        const cubeIds = Object.keys(legend).filter(k => k.startsWith("C"));
        expect(cubeIds).to.have.length(2);
        expect(cubeIds).to.include("C11122");
        expect(cubeIds).to.include("C12211");
    });

    it("scores dolmens at end of game", () => {
        const g = new CarnacGame(undefined, ["8x5"]);
        while (!g.gameover && g.moves().length > 0) {
            g.move(g.moves()[0]);
        }
        expect(g.gameover).to.be.true;
        expect(g.winner.length).to.be.greaterThan(0);
    });
});
