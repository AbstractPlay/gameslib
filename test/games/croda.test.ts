/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { CrodaGame, ICrodaState, IMoveState, playerid, CellContents } from "../../src/games/croda";

type BoardCell = [string, CellContents];

function crodaFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    stack?: IMoveState[];
}): CrodaGame {
    const moveState: IMoveState = {
        _version: CrodaGame.gameinfo.version,
        _results: [],
        _timestamp: new Date(),
        currplayer: opts.currplayer ?? 1,
        board: new Map(opts.board),
    };
    const state: ICrodaState = {
        game: "croda",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: opts.stack ?? [moveState],
    };
    return new CrodaGame(state);
}

function moveIncreasesY(g: CrodaGame, mv: string): boolean {
    const cells = mv.split("-");
    const [, y0] = g.algebraic2coords(cells[0]);
    const [, y1] = g.algebraic2coords(cells[cells.length - 1]);
    return y1 > y0;
}

function moveDecreasesY(g: CrodaGame, mv: string): boolean {
    const cells = mv.split("-");
    const [, y0] = g.algebraic2coords(cells[0]);
    const [, y1] = g.algebraic2coords(cells[cells.length - 1]);
    return y1 < y0;
}

describe("Croda", () => {
    it("starts with 24 men per side on y 0–2 and 5–7; y 3–4 empty", () => {
        const g = new CrodaGame();
        expect(g.board.size).to.equal(48);
        for (let y = 0; y < 8; y++) {
            for (let col = 0; col < 8; col++) {
                const cell = g.coords2algebraic(col, y);
                if (y <= 2) {
                    expect(g.board.get(cell)).to.deep.equal([2, 1]);
                } else if (y >= 5) {
                    expect(g.board.get(cell)).to.deep.equal([1, 1]);
                } else {
                    expect(g.board.has(cell)).to.be.false;
                }
            }
        }
    });

    it("uses a checkered board", () => {
        const g = new CrodaGame();
        expect(g.render().board?.style).to.equal("squares-checkered");
    });

    it("allows a diagonal forward quiet step", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [["d5", [1, 1]]],
        });
        expect(g.moves()).to.include("d5-e6");
    });

    it("forbids backward and sideways-only quiet moves", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [["e5", [1, 1]]],
        });
        const moves = g.moves();
        for (const mv of moves) {
            expect(moveIncreasesY(g, mv)).to.be.false;
        }
        expect(moves).to.not.include("e5-d5");
        expect(moves).to.not.include("e5-f5");
    });

    it("allows backward orthogonal capture", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [
                ["e5", [1, 1]],
                ["e6", [2, 1]],
            ],
        });
        expect(g.moves()).to.include("e5-e7");
    });

    it("requires maximal capture", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 1]],
                ["d4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        expect(g.moves()).to.deep.equal(["e4-c4-a4"]);
    });

    it("promotes when a quiet move ends on the back rank", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [["a7", [1, 1]]],
        });
        g.move("a7-a8");
        expect(g.board.get("a8")).to.deep.equal([1, 2]);
        expect(g.results.some(r => r.type === "promote")).to.be.true;
    });

    it("does not promote when the back rank is visited mid-capture but the move ends elsewhere", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [
                ["b2", [1, 1]],
                ["b3", [2, 1]],
                ["d5", [2, 1]],
            ],
        });
        g.move("b2-b1-d3", { trusted: true });
        expect(g.board.get("d3")).to.deep.equal([1, 1]);
        expect(g.results.some(r => r.type === "promote")).to.be.false;
    });

    it("keeps captured pieces on the board until the capture sequence ends", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 1]],
                ["d4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        g.move("e4-c4", { trusted: true, partial: true });
        expect(g.board.has("d4")).to.be.true;
        expect(g.results.filter(r => r.type === "capture")).to.be.empty;
    });

    it("removes all captures only after the full capture move", () => {
        const g = crodaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 1]],
                ["d4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        g.move("e4-c4-a4");
        expect(g.board.has("d4")).to.be.false;
        expect(g.board.has("b4")).to.be.false;
    });

    it("draws on threefold repetition", () => {
        const board = new Map<string, CellContents>([
            ["a1", [1, 2]],
            ["b1", [2, 2]],
        ]);
        const frame: IMoveState = {
            _version: CrodaGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1 as playerid,
            board: new Map(board),
        };
        const state: ICrodaState = {
            game: "croda",
            numplayers: 2,
            variants: [],
            gameover: false,
            winner: [],
            stack: [frame, { ...frame, board: new Map(board) }],
        };
        const g = new CrodaGame(state);
        g.checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
    });

    it("player 2 quiet moves do not move backward", () => {
        const g = crodaFrom({
            currplayer: 2,
            board: [["e6", [2, 1]]],
        });
        const moves = g.moves();
        for (const mv of moves) {
            expect(moveDecreasesY(g, mv)).to.be.false;
        }
        expect(moves).to.include("e6-e5");
        expect(moves).to.include("e6-f5");
    });
});
